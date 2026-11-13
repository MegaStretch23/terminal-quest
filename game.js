/* Terminal Quest - browser UI. Uses TQ.shell and TQ.levels. No network calls; progress goes to localStorage only. */
(function () {
  'use strict';
  var S = window.TQ.shell, LV = window.TQ.levels;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  function storage() {
    try { var t = window.localStorage; t.setItem('tq-probe', '1'); t.removeItem('tq-probe'); return t; }
    catch (e) { var m = {}; return { getItem: function (k) { return m[k] === undefined ? null : m[k]; }, setItem: function (k, v) { m[k] = String(v); } }; }
  }
  var progress = LV.makeProgress(storage());
  progress.load();
  var game = null, level = null, won = false, hintsShown = 0;
  var panes = { linux: $('#pane-linux'), powershell: $('#pane-powershell') };
  var histories = { linux: [], powershell: [] }, hpos = { linux: 0, powershell: 0 };

  var SHEET = [
    ['Where am I', 'pwd', 'Get-Location (pwd)'], ['List files', 'ls  /  ls -a (hidden too)', 'Get-ChildItem  /  -Force (ls, dir)'],
    ['Change folder', 'cd DIR', 'Set-Location DIR (cd)'], ['Print a file', 'cat FILE', 'Get-Content FILE (cat, type)'],
    ['Search text', 'grep [-i] [-n] PATTERN FILE', 'Select-String -Pattern P -Path FILE [-CaseSensitive] (sls)'],
    ['New folder', 'mkdir [-p] DIR', 'mkdir DIR  /  New-Item -ItemType Directory -Path DIR'], ['New empty file', 'touch FILE', 'New-Item -ItemType File -Path FILE'],
    ['Copy', 'cp [-r] SRC DEST', 'Copy-Item SRC DEST [-Recurse] (cp, copy)'], ['Move or rename', 'mv SRC DEST', 'Move-Item SRC DEST (mv, move)'],
    ['Delete', 'rm [-r] [-f] PATH', 'Remove-Item PATH [-Recurse] (rm, del)'], ['Print text', 'echo TEXT', 'Write-Output TEXT (echo)'],
    ['First lines', 'head -n N FILE', 'Get-Content FILE -TotalCount N  /  ... | Select-Object -First N']];
  SHEET.forEach(function (r) {
    var tr = document.createElement('tr');
    r.forEach(function (c) { var td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
    $('#sheetBody').appendChild(tr);
  });

  function mode() { return progress.state.mode; }
  function shown() { return mode() === 'both' ? ['linux', 'powershell'] : [mode()]; }
  function print(d, text, cls) {
    var log = $('.log', panes[d]), line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text; log.appendChild(line); log.scrollTop = log.scrollHeight;
  }
  function promptText(d) {
    var rel = game.cwd === S.HOME ? '~' : game.cwd.indexOf(S.HOME + '/') === 0 ? '~' + game.cwd.slice(S.HOME.length) : game.cwd;
    return d === 'linux' ? 'player@quest:' + rel + '$' : 'PS ' + game.cwd + '>';
  }
  function refreshPrompts() { ['linux', 'powershell'].forEach(function (d) { $('.prompt', panes[d]).textContent = promptText(d); }); }
  function applyMode() {
    var m = mode();
    document.querySelectorAll('input[name=mode]').forEach(function (r) { r.checked = r.value === m; });
    panes.linux.hidden = m === 'powershell'; panes.powershell.hidden = m === 'linux';
    $('#panes').className = m === 'both' ? '' : 'single';
    var first = shown()[0]; $('input', panes[first]).focus();
  }
  function renderQuest() {
    $('#qTitle').textContent = 'Level ' + level.id + ': ' + level.title;
    $('#qStory').textContent = level.story; $('#qGoal').textContent = level.goal;
    $('#qStatus').textContent = ''; $('#qStatus').className = 'status';
    $('#qHints').textContent = ''; hintsShown = 0; $('#nextBtn').hidden = true; won = false;
    renderPicker();
  }
  function renderPicker() {
    var sel = $('#level'); sel.textContent = '';
    LV.LEVELS.forEach(function (l) {
      var o = document.createElement('option'); o.value = l.id; o.textContent = (progress.isDone(l.id) ? '✓ ' : '') + l.id + '. ' + l.title;
      if (l.id === level.id) o.selected = true; sel.appendChild(o);
    });
    $('#progress').textContent = progress.state.done.length + ' of ' + LV.LEVELS.length + ' done';
  }
  function startLevel(id) {
    level = LV.LEVELS.filter(function (l) { return l.id === id; })[0] || LV.LEVELS[0];
    game = LV.newGame(level); progress.setCurrent(level.id);
    ['linux', 'powershell'].forEach(function (d) { $('.log', panes[d]).textContent = ''; print(d, 'Level ' + level.id + ': ' + level.title + ' - type hint for a nudge, help for the commands.', 'info'); });
    renderQuest(); refreshPrompts(); applyMode();
  }
  function showHint() {
    if (hintsShown >= level.hints.length) { print(shown()[0], 'No more hints for this level. Compare the cheat sheet below.', 'info'); return; }
    var li = document.createElement('li'); li.textContent = level.hints[hintsShown++]; $('#qHints').appendChild(li);
  }
  function help(d) {
    ['Commands (' + (d === 'linux' ? 'Linux' : 'PowerShell') + ' style): ' + (d === 'linux' ? S.CMDS.join(' ') : 'Get-Location Get-ChildItem Set-Location Get-Content Select-String mkdir New-Item Copy-Item Move-Item Remove-Item Write-Output Select-Object'),
      'Also: hint, help, clear. Pipes | and one redirect > or >> at the end work. This is a simulation: a subset of each command with simplified output.']
      .forEach(function (t) { print(d, t, 'info'); });
  }
  function win() {
    won = true; progress.markDone(level.id); renderPicker();
    $('#qStatus').textContent = 'Level complete!'; $('#qStatus').className = 'status won';
    var last = level.id >= LV.LEVELS.length;
    $('#nextBtn').hidden = last; $('#nextBtn').textContent = 'Next level';
    shown().forEach(function (d) { print(d, last ? 'All ' + LV.LEVELS.length + ' levels complete. Well done.' : 'Level complete! Press "Next level".', 'win'); });
    if (last) $('#qStatus').textContent = 'All ' + LV.LEVELS.length + ' levels complete!';
  }
  function submit(d, text) {
    var other = d === 'linux' ? 'powershell' : 'linux', both = mode() === 'both', before = promptText(d), beforeOther = promptText(other);
    print(d, before + ' ' + text, 'in');
    if (text.trim()) { histories[d].push(text); hpos[d] = histories[d].length; }
    var r = S.run(game, text, d);
    if (r.meta === 'clear') { shown().forEach(function (x) { $('.log', panes[x]).textContent = ''; }); refreshPrompts(); return; }
    if (r.meta === 'help') { help(d); return; }
    if (r.meta === 'hint') { showHint(); return; }
    if (r.meta === 'empty') return;
    r.lines.forEach(function (l) { print(d, l); });
    r.errors.forEach(function (l) { print(d, l, 'err'); });
    if (both && r.parsed) {
      print(other, beforeOther + ' ' + S.render(r.parsed, other), 'mirror');
      if (r.ok) (r.linesAlt[other] || []).forEach(function (l) { print(other, l, 'mirror'); }); else print(other, '(the same command failed in the ' + (d === 'linux' ? 'Linux' : 'PowerShell') + ' pane; see its message)', 'info');
    }
    game.history.push(r); refreshPrompts();
    if (!won && level.check(game)) win();
  }
  ['linux', 'powershell'].forEach(function (d) {
    var form = $('form', panes[d]), input = $('input', form);
    form.addEventListener('submit', function (e) { e.preventDefault(); var t = input.value; input.value = ''; submit(d, t); });
    input.addEventListener('keydown', function (e) {
      var h = histories[d];
      if (e.key === 'ArrowUp' && h.length) { hpos[d] = Math.max(0, hpos[d] - 1); input.value = h[hpos[d]]; e.preventDefault(); }
      else if (e.key === 'ArrowDown' && h.length) { hpos[d] = Math.min(h.length, hpos[d] + 1); input.value = h[hpos[d]] || ''; e.preventDefault(); }
    });
    panes[d].addEventListener('click', function (e) { if (!window.getSelection().toString() && e.target.tagName !== 'INPUT') input.focus(); });
  });
  document.querySelectorAll('input[name=mode]').forEach(function (r) { r.addEventListener('change', function () { progress.setMode(r.value); applyMode(); }); });
  $('#level').addEventListener('change', function (e) { startLevel(parseInt(e.target.value, 10)); });
  $('#hintBtn').addEventListener('click', showHint);
  $('#resetLevel').addEventListener('click', function () { startLevel(level.id); });
  $('#resetAll').addEventListener('click', function () { if (window.confirm('Erase your saved progress in this browser?')) { progress.reset(); startLevel(1); } });
  $('#nextBtn').addEventListener('click', function () { startLevel(Math.min(level.id + 1, LV.LEVELS.length)); });
  startLevel(progress.state.current);
})();
