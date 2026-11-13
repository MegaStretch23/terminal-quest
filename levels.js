/* Terminal Quest - levels, win checks and progress storage. Plain JS, no dependencies.
 * Each level: { id, title, story, goal, cwd, tree(), hints[], solution:{linux[],powershell[]}, check(ctx) }.
 * ctx = { fs, cwd, history } where history = the results of run() for this level (see shell.js).
 * solution[] is only used by the tests (every level must be solvable in both dialects) and by the last hint. */
(function (root, factory) {
  var shell = typeof module === 'object' && module.exports ? require('./shell.js') : root.TQ.shell;
  var api = factory(shell);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.TQ = root.TQ || {}; root.TQ.levels = api; }
})(typeof self !== 'undefined' ? self : this, function (shell) {
  'use strict';
  var H = shell.HOME;
  var LOG = [
    '2026-11-01 08:00:01 INFO server started', '2026-11-01 08:00:05 INFO listening on port 8080', '2026-11-01 08:01:12 WARN slow response from cache',
    '2026-11-01 08:02:40 ERROR database connection refused', '2026-11-01 08:02:41 INFO retry after error recovered', '2026-11-01 08:03:00 INFO user login ok',
    '2026-11-01 08:04:19 ERROR timeout reading config', '2026-11-01 08:05:30 INFO cache warmed', '2026-11-01 08:06:02 WARN disk at 85 percent',
    '2026-11-01 08:07:45 ERROR payment service unreachable', '2026-11-01 08:08:10 INFO nightly job finished', '2026-11-01 08:09:00 INFO server stopped'];
  var README = 'Welcome to Terminal Quest!\nYou are in your home folder.\nEvery level has a goal. Type hint for a nudge.\n';
  var REPORT = 'Q3 report\nrevenue: up\ncosts: flat\n';

  function home() {   // a fresh copy of the starting filesystem for every level
    var player = {
      'readme.txt': README,
      '.secret': 'the hidden word is: lantern\n',
      notes: { 'todo.txt': 'buy milk\nwalk the dog\nwater the plants\n', 'ideas.txt': 'a game about terminals\nlearn grep\n' },
      docs: { 'report.txt': REPORT, 'draft.txt': 'first draft of the plan\n', old: { 'archive.txt': 'very old notes\n' } },
      logs: { 'app.log': LOG.join('\n') + '\n' },
      tmp: { 'a.tmp': 'x\n', 'b.tmp': 'y\n', 'c.tmp': 'z\n', 'keep.txt': 'keep me\n' },
      backup: {},
      projects: {}
    };
    return { home: { player: player } };
  }
  function abs(ctx, p, base) { return ctx.fs.normalize(base || H, p); }
  // true when a successful command in the history used one of cmds on the path (resolved against the folder it ran in)
  function touched(ctx, cmds, path) {
    return ctx.history.some(function (h) {
      return h.ok && h.stages.some(function (st) {
        return cmds.indexOf(st.cmd) >= 0 && st.args.some(function (a) { return ctx.fs.normalize(h.cwdBefore, a) === path; });
      });
    });
  }
  function ranCmd(ctx, cmd) { return ctx.history.some(function (h) { return h.ok && h.stages.some(function (st) { return st.cmd === cmd; }); }); }
  function same(ctx, p, text) { return ctx.fs.read(p) === text; }

  var LEVELS = [
    { id: 1, title: 'Where am I?', story: 'You wake up in a terminal. First, find out which folder you are standing in.',
      goal: 'Print your current folder.', cwd: H, tree: home,
      hints: ['There is a command that prints the working directory.', 'Linux: pwd. PowerShell: Get-Location (alias pwd).'],
      solution: { linux: ['pwd'], powershell: ['Get-Location'] }, check: function (c) { return ranCmd(c, 'pwd'); } },
    { id: 2, title: 'Look around', story: 'Folders hold files and other folders. See what is in this one.',
      goal: 'List the files in the current folder.', cwd: H, tree: home,
      hints: ['You want a command that lists a folder.', 'Linux: ls. PowerShell: Get-ChildItem (aliases ls, dir).'],
      solution: { linux: ['ls'], powershell: ['Get-ChildItem'] }, check: function (c) { return ranCmd(c, 'ls'); } },
    { id: 3, title: 'Read a file', story: 'There is a file called readme.txt here. Read it.',
      goal: 'Print the contents of readme.txt.', cwd: H, tree: home,
      hints: ['A command prints a whole file to the screen.', 'Linux: cat readme.txt. PowerShell: Get-Content readme.txt (alias cat).'],
      solution: { linux: ['cat readme.txt'], powershell: ['Get-Content readme.txt'] }, check: function (c) { return touched(c, ['cat'], H + '/readme.txt'); } },
    { id: 4, title: 'Step into a folder', story: 'Your documents live in the docs folder. Go there.',
      goal: 'Change into the docs folder.', cwd: H, tree: home,
      hints: ['Changing folder is "change directory" or "set location".', 'Linux: cd docs. PowerShell: Set-Location docs (alias cd).'],
      solution: { linux: ['cd docs'], powershell: ['Set-Location docs'] }, check: function (c) { return c.cwd === H + '/docs'; } },
    { id: 5, title: 'Back out', story: 'You are deep inside docs/old. Get back to your home folder, /home/player.',
      goal: 'Be in /home/player.', cwd: H + '/docs/old', tree: home,
      hints: ['.. means "the folder above". You can chain it: ../..', 'cd ../.. goes up two folders. A plain cd with no argument also goes home.'],
      solution: { linux: ['cd ../..'], powershell: ['Set-Location ../..'] }, check: function (c) { return c.cwd === H; } },
    { id: 6, title: 'Hidden things', story: 'A file whose name starts with a dot is hidden. There is one here with a word in it.',
      goal: 'Read the hidden file .secret.', cwd: H, tree: home,
      hints: ['A normal listing skips names that start with a dot.', 'Linux: ls -a shows them. PowerShell: Get-ChildItem -Force. Then read the file as before.'],
      solution: { linux: ['ls -a', 'cat .secret'], powershell: ['Get-ChildItem -Force', 'Get-Content .secret'] }, check: function (c) { return touched(c, ['cat'], H + '/.secret'); } },
    { id: 7, title: 'Make a folder', story: 'Time to organise. Create a new folder called stuff in your home folder.',
      goal: 'Create a folder named stuff.', cwd: H, tree: home,
      hints: ['Creating a folder: "make directory".', 'Linux: mkdir stuff. PowerShell: mkdir stuff, or New-Item -ItemType Directory -Path stuff.'],
      solution: { linux: ['mkdir stuff'], powershell: ['New-Item -ItemType Directory -Path stuff'] }, check: function (c) { return c.fs.isDir(H + '/stuff'); } },
    { id: 8, title: 'Make a file', story: 'Create an empty file called ideas.txt inside the projects folder (do not cd, use a path).',
      goal: 'Create projects/ideas.txt (empty).', cwd: H, tree: home,
      hints: ['A path can go through folders: projects/ideas.txt.', 'Linux: touch projects/ideas.txt. PowerShell: New-Item -ItemType File -Path projects/ideas.txt.'],
      solution: { linux: ['touch projects/ideas.txt'], powershell: ['New-Item -ItemType File -Path projects/ideas.txt'] },
      check: function (c) { return same(c, H + '/projects/ideas.txt', ''); } },
    { id: 9, title: 'Say it into a file', story: 'echo prints text. The > sign sends that text into a file instead of the screen.',
      goal: 'Create hello.txt containing the line: hello terminal', cwd: H, tree: home,
      hints: ['Put the text in quotes, then > and the file name.', 'echo "hello terminal" > hello.txt (PowerShell accepts the same, or Write-Output "hello terminal" > hello.txt).'],
      solution: { linux: ['echo "hello terminal" > hello.txt'], powershell: ['Write-Output "hello terminal" > hello.txt'] },
      check: function (c) { return same(c, H + '/hello.txt', 'hello terminal\n'); } },
    { id: 10, title: 'Make a copy', story: 'Back up docs/report.txt: put a copy in the backup folder. The original must stay.',
      goal: 'Copy docs/report.txt into backup/.', cwd: H, tree: home,
      hints: ['Copy takes a source and a destination folder or name.', 'Linux: cp docs/report.txt backup/. PowerShell: Copy-Item docs/report.txt backup/.'],
      solution: { linux: ['cp docs/report.txt backup/'], powershell: ['Copy-Item docs/report.txt backup/'] },
      check: function (c) { return same(c, H + '/backup/report.txt', REPORT) && same(c, H + '/docs/report.txt', REPORT); } },
    { id: 11, title: 'Rename', story: 'You are in docs. The draft is final now: rename draft.txt to plan.txt.',
      goal: 'Rename draft.txt to plan.txt.', cwd: H + '/docs', tree: home,
      hints: ['Renaming is moving a file to a new name.', 'Linux: mv draft.txt plan.txt. PowerShell: Move-Item draft.txt plan.txt.'],
      solution: { linux: ['mv draft.txt plan.txt'], powershell: ['Move-Item draft.txt plan.txt'] },
      check: function (c) { return same(c, H + '/docs/plan.txt', 'first draft of the plan\n') && !c.fs.exists(H + '/docs/draft.txt'); } },
    { id: 12, title: 'Find the errors', story: 'logs/app.log has INFO, WARN and ERROR lines. Save only the ERROR lines into errors.txt. Watch the case: one INFO line contains the lowercase word error.',
      goal: 'Create errors.txt with exactly the 3 ERROR lines of logs/app.log.', cwd: H, tree: home,
      hints: ['Search a file for text, and send the matches to a file with >.', 'Linux: grep ERROR logs/app.log > errors.txt. PowerShell ignores case by default: add -CaseSensitive.',
        'PowerShell: Get-Content logs/app.log | Select-String -CaseSensitive ERROR > errors.txt (Select-String with -Path puts file:line: in front of each match).'],
      solution: { linux: ['grep ERROR logs/app.log > errors.txt'], powershell: ['Get-Content logs/app.log | Select-String -CaseSensitive ERROR > errors.txt'] },
      check: function (c) {
        var want = LOG.filter(function (l) { return / ERROR /.test(l); }), got = shell.toLines(c.fs.read(H + '/errors.txt') || '');
        return got.length === want.length && want.every(function (w, i) { return got[i].slice(-w.length) === w; });
      } },
    { id: 13, title: 'Just the top', story: 'The log is long. Save only its first 3 lines into top.txt.',
      goal: 'Create top.txt with the first 3 lines of logs/app.log.', cwd: H, tree: home,
      hints: ['There is a command for the first lines of a file.', 'Linux: head -n 3 logs/app.log > top.txt. PowerShell: Get-Content logs/app.log -TotalCount 3 > top.txt.'],
      solution: { linux: ['head -n 3 logs/app.log > top.txt'], powershell: ['Get-Content logs/app.log -TotalCount 3 > top.txt'] },
      check: function (c) { return same(c, H + '/top.txt', LOG.slice(0, 3).join('\n') + '\n'); } },
    { id: 14, title: 'Clean up', story: 'tmp has three .tmp files and one file worth keeping. A * matches any characters.',
      goal: 'Delete every .tmp file in tmp/ but keep keep.txt.', cwd: H, tree: home,
      hints: ['Remove with the name pattern *.tmp.', 'Linux: rm tmp/*.tmp. PowerShell: Remove-Item tmp/*.tmp.'],
      solution: { linux: ['rm tmp/*.tmp'], powershell: ['Remove-Item tmp/*.tmp'] },
      check: function (c) { return c.fs.list(H + '/tmp').join(',') === 'keep.txt' && same(c, H + '/tmp/keep.txt', 'keep me\n'); } },
    { id: 15, title: 'Remove a folder', story: 'docs/old is no longer needed. Remove the folder and what is in it, but not the rest of docs.',
      goal: 'Remove docs/old.', cwd: H, tree: home,
      hints: ['A folder with files in it needs a "recursive" option.', 'Linux: rm -r docs/old. PowerShell: Remove-Item docs/old -Recurse.'],
      solution: { linux: ['rm -r docs/old'], powershell: ['Remove-Item docs/old -Recurse'] },
      check: function (c) { return !c.fs.exists(H + '/docs/old') && c.fs.isFile(H + '/docs/report.txt') && c.fs.isFile(H + '/docs/draft.txt'); } },
    { id: 16, title: 'Mini project', story: 'Put it all together. Make a folder site with a file index.txt containing the line hello, and a copy of readme.txt inside it.',
      goal: 'site/index.txt contains "hello" and site/readme.txt is a copy of readme.txt.', cwd: H, tree: home,
      hints: ['Three steps: make the folder, write the file, copy the readme.', 'Linux: mkdir site, then echo hello > site/index.txt, then cp readme.txt site/.',
        'PowerShell: mkdir site, Write-Output hello > site/index.txt, Copy-Item readme.txt site/.'],
      solution: { linux: ['mkdir site', 'echo hello > site/index.txt', 'cp readme.txt site/'], powershell: ['mkdir site', 'Write-Output hello > site/index.txt', 'Copy-Item readme.txt site/'] },
      check: function (c) { return same(c, H + '/site/index.txt', 'hello\n') && same(c, H + '/site/readme.txt', README); } }
  ];

  /* progress in localStorage (the only thing the game stores; nothing leaves the browser). storage = any object with getItem/setItem. */
  var KEY = 'terminal-quest-v1';
  function makeProgress(storage) {
    var st = { v: 1, done: [], current: 1, mode: 'both' };
    function save() { try { storage.setItem(KEY, JSON.stringify(st)); return true; } catch (e) { return false; } }
    function load() {
      try {
        var o = JSON.parse(storage.getItem(KEY) || 'null');
        if (o && o.v === 1 && Array.isArray(o.done)) {
          st.done = o.done.filter(function (n) { return LEVELS.some(function (l) { return l.id === n; }); });
          if (LEVELS.some(function (l) { return l.id === o.current; })) st.current = o.current;
          if (['linux', 'powershell', 'both'].indexOf(o.mode) >= 0) st.mode = o.mode;
        }
      } catch (e) { /* corrupt or unavailable storage: start fresh */ }
      return st;
    }
    return {
      state: st, load: load, save: save,
      markDone: function (id) { if (st.done.indexOf(id) < 0) st.done.push(id); st.done.sort(function (a, b) { return a - b; }); return save(); },
      isDone: function (id) { return st.done.indexOf(id) >= 0; },
      setCurrent: function (id) { st.current = id; return save(); },
      setMode: function (m) { st.mode = m; return save(); },
      reset: function () { st.done = []; st.current = 1; return save(); }
    };
  }

  function newGame(level) {   // fresh state for a level
    return { fs: new shell.VFS(level.tree()), cwd: level.cwd, history: [] };
  }
  return { LEVELS: LEVELS, KEY: KEY, makeProgress: makeProgress, newGame: newGame, README: README };
});
