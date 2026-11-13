'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shell.js');

function sandbox(extra) {
  const fs = new S.VFS(Object.assign({ home: { player: {
    'a.txt': 'hello\nWorld\nhello again\n', 'b.txt': 'one\ntwo\n', '.hid': 'x\n', 'n.log': 'no newline at end',
    docs: { 'r.txt': 'R\n', sub: { 'deep.txt': 'D\n' } }, empty: {} } } }, extra || {}));
  return { fs, cwd: S.HOME };
}
const run = (st, line, d) => S.run(st, line, d || 'linux');
const out = (st, line, d) => { const r = run(st, line, d); assert.ok(r.ok, line + ' -> ' + r.errors.join(' | ')); return r.lines; };

test('tokenizer: quotes, pipes and redirects', () => {
  assert.deepEqual(S.tokenize('echo "a b" | grep a>>f').map(t => t.op || t.v), ['echo', 'a b', '|', 'grep', 'a', '>>', 'f']);
  assert.throws(() => S.tokenize('echo "oops'), /unterminated/);
});

test('pwd, cd and paths (.., ~, absolute)', () => {
  const st = sandbox();
  assert.deepEqual(out(st, 'pwd'), [S.HOME]);
  out(st, 'cd docs/sub'); assert.equal(st.cwd, S.HOME + '/docs/sub');
  out(st, 'cd ../..'); assert.equal(st.cwd, S.HOME);
  out(st, 'cd /'); assert.equal(st.cwd, '/');
  out(st, 'cd ~'); assert.equal(st.cwd, S.HOME);
  out(st, 'cd docs'); out(st, 'cd'); assert.equal(st.cwd, S.HOME, 'plain cd goes home');
  assert.match(run(st, 'cd nope').errors[0], /No such file or directory/);
  assert.match(run(st, 'cd a.txt').errors[0], /Not a directory/);
  assert.equal(st.cwd, S.HOME);
});

test('ls: sorted, folders end with /, hidden only with -a / -Force', () => {
  const st = sandbox();
  assert.deepEqual(out(st, 'ls'), ['a.txt', 'b.txt', 'docs/', 'empty/', 'n.log']);
  assert.deepEqual(out(st, 'ls -a'), ['.', '..', '.hid', 'a.txt', 'b.txt', 'docs/', 'empty/', 'n.log']);
  assert.deepEqual(out(st, 'Get-ChildItem -Force', 'powershell'), ['.hid', 'a.txt', 'b.txt', 'docs/', 'empty/', 'n.log']);
  assert.deepEqual(out(st, 'ls docs/sub'), ['deep.txt']);
  assert.deepEqual(out(st, 'ls *.txt'), ['a.txt', 'b.txt']);
  assert.match(run(st, 'ls nope').errors[0], /cannot access 'nope'/);
  assert.match(run(st, 'ls -l').errors[0], /not supported/);
});

test('cat and head (also a file without a trailing newline)', () => {
  const st = sandbox();
  assert.deepEqual(out(st, 'cat b.txt'), ['one', 'two']);
  assert.deepEqual(out(st, 'cat n.log'), ['no newline at end']);
  assert.deepEqual(out(st, 'head -n 1 a.txt'), ['hello']);
  assert.deepEqual(out(st, 'head -2 a.txt'), ['hello', 'World']);
  assert.equal(out(st, 'head a.txt').length, 3);
  assert.deepEqual(out(st, 'Get-Content a.txt -TotalCount 2', 'powershell'), ['hello', 'World']);
  assert.match(run(st, 'cat docs').errors[0], /Is a directory/);
  assert.match(run(st, 'cat nope').errors[0], /No such file/);
});

test('grep: case, line numbers, files, pipe, bad regex', () => {
  const st = sandbox();
  assert.deepEqual(out(st, 'grep hello a.txt'), ['hello', 'hello again']);
  assert.deepEqual(out(st, 'grep -i WORLD a.txt'), ['World']);
  assert.deepEqual(out(st, 'grep WORLD a.txt'), []);
  assert.deepEqual(out(st, 'grep -n hello a.txt'), ['1:hello', '3:hello again']);
  assert.deepEqual(out(st, 'grep one a.txt b.txt'), ['b.txt:one']);
  assert.deepEqual(out(st, 'cat a.txt | grep ^h | head -n 1'), ['hello']);
  assert.match(run(st, 'grep [ a.txt').errors[0], /invalid regular expression/);
  assert.match(run(st, 'grep x').errors[0], /needs a file/);
  // PowerShell: Select-String ignores case unless -CaseSensitive
  assert.deepEqual(out(st, 'Select-String world a.txt', 'powershell'), ['a.txt:2:World']);
  assert.deepEqual(out(st, 'Select-String -Pattern world -Path a.txt -CaseSensitive', 'powershell'), []);
  assert.deepEqual(out(st, 'Get-Content a.txt | Select-String hello', 'powershell'), ['hello', 'hello again']);
});

test('mkdir, touch, echo, redirects', () => {
  const st = sandbox();
  out(st, 'mkdir new'); assert.ok(st.fs.isDir(S.HOME + '/new'));
  assert.match(run(st, 'mkdir new').errors[0], /File exists/);
  assert.match(run(st, 'mkdir x/y').errors[0], /No such file or directory/);
  out(st, 'mkdir -p x/y/z'); assert.ok(st.fs.isDir(S.HOME + '/x/y/z'));
  out(st, 'touch new/t.txt'); assert.equal(st.fs.read(S.HOME + '/new/t.txt'), '');
  out(st, 'echo hi there > new/t.txt'); assert.equal(st.fs.read(S.HOME + '/new/t.txt'), 'hi there\n');
  out(st, 'echo more >> new/t.txt'); assert.equal(st.fs.read(S.HOME + '/new/t.txt'), 'hi there\nmore\n');
  out(st, 'touch new/t.txt'); assert.equal(st.fs.read(S.HOME + '/new/t.txt'), 'hi there\nmore\n', 'touch leaves an existing file alone');
  assert.match(run(st, 'echo x > nope/f').errors[0], /No such file or directory/);
  assert.match(run(st, 'echo x > docs').errors[0], /Is a directory/);
  // PowerShell
  out(st, 'New-Item -ItemType Directory -Path p/q', 'powershell'); assert.ok(st.fs.isDir(S.HOME + '/p/q'));
  out(st, 'New-Item -ItemType File -Name f.txt -Path p', 'powershell'); assert.ok(st.fs.isFile(S.HOME + '/p/f.txt'));
  assert.match(run(st, 'New-Item -ItemType File -Path p/f.txt', 'powershell').errors[0], /already exists/);
  assert.match(run(st, 'New-Item p/z', 'powershell').errors[0], /-ItemType/);
  out(st, 'mkdir m', 'powershell'); assert.ok(st.fs.isDir(S.HOME + '/m'));
  out(st, 'Write-Output "a b" > p\\w.txt', 'powershell'); assert.equal(st.fs.read(S.HOME + '/p/w.txt'), 'a b\n');
});

test('cp, mv', () => {
  const st = sandbox();
  out(st, 'cp b.txt empty'); assert.equal(st.fs.read(S.HOME + '/empty/b.txt'), 'one\ntwo\n'); assert.ok(st.fs.isFile(S.HOME + '/b.txt'));
  out(st, 'cp b.txt c.txt'); assert.equal(st.fs.read(S.HOME + '/c.txt'), 'one\ntwo\n');
  assert.match(run(st, 'cp docs empty').errors[0], /-r not specified/);
  out(st, 'cp -r docs empty'); assert.ok(st.fs.isFile(S.HOME + '/empty/docs/sub/deep.txt'));
  out(st, 'mv c.txt d.txt'); assert.ok(!st.fs.exists(S.HOME + '/c.txt') && st.fs.isFile(S.HOME + '/d.txt'));
  out(st, 'mv d.txt docs'); assert.ok(st.fs.isFile(S.HOME + '/docs/d.txt'));
  assert.match(run(st, 'mv nope x').errors[0], /No such file/);
  assert.match(run(st, 'mv docs docs/sub').errors[0], /into itself/);
  assert.match(run(st, 'cp a.txt b.txt n.log').errors[0], /not a directory/);
  out(st, 'Copy-Item docs/r.txt -Destination empty', 'powershell'); assert.ok(st.fs.isFile(S.HOME + '/empty/r.txt'));
  out(st, 'Move-Item empty/r.txt r2.txt', 'powershell'); assert.ok(st.fs.isFile(S.HOME + '/r2.txt'));
  out(st, 'Copy-Item docs docs2', 'powershell'); assert.deepEqual(st.fs.list(S.HOME + '/docs2'), [], 'Copy-Item without -Recurse copies the folder only');
  out(st, 'Copy-Item docs docs3 -Recurse', 'powershell'); assert.ok(st.fs.isFile(S.HOME + '/docs3/sub/deep.txt'));
});

test('rm: files, globs, -r, -f, safety', () => {
  const st = sandbox();
  out(st, 'rm n.log'); assert.ok(!st.fs.exists(S.HOME + '/n.log'));
  assert.match(run(st, 'rm docs').errors[0], /Is a directory/);
  assert.match(run(st, 'rm nope').errors[0], /No such file/);
  assert.ok(run(st, 'rm -f nope').ok);
  out(st, 'rm *.txt'); assert.deepEqual(st.fs.list(S.HOME).filter(n => /\.txt$/.test(n)), []);
  out(st, 'rm -r docs'); assert.ok(!st.fs.exists(S.HOME + '/docs'));
  out(st, 'cd empty'); assert.match(run(st, 'rm -r ../empty').errors[0], /refusing/);
  assert.match(run(st, 'rm -r /').errors[0], /refusing/);
  const p = sandbox();
  assert.match(run(p, 'Remove-Item docs', 'powershell').errors[0], /has children/);
  out(p, 'Remove-Item docs -Recurse', 'powershell'); assert.ok(!p.fs.exists(S.HOME + '/docs'));
  out(p, 'Remove-Item empty', 'powershell'); assert.ok(!p.fs.exists(S.HOME + '/empty'));
});

test('each shell only knows its own words', () => {
  const st = sandbox();
  assert.match(run(st, 'Get-ChildItem').errors[0], /command not found/);
  assert.match(run(st, 'head -x a.txt').errors[0], /not supported/);
  assert.match(run(st, 'touch', 'linux').errors[0], /missing file operand/);
  const e = run(st, 'touch f', 'powershell'); assert.match(e.errors[0], /not recognized/);
  assert.match(run(st, 'head a.txt', 'powershell').errors[0], /not recognized/);
  assert.match(run(st, 'ls -a', 'powershell').errors[0], /parameter cannot be found/);
  assert.match(run(st, 'GET-CHILDITEM', 'powershell').ok ? 'ok' : 'bad', /ok/, 'PowerShell names are case-insensitive');
  assert.ok(!run(st, 'LS', 'linux').ok, 'Linux names are case-sensitive');
  assert.equal(run(st, 'hint').meta, 'hint'); assert.equal(run(st, 'clear').meta, 'clear'); assert.equal(run(st, '   ').meta, 'empty');
  assert.match(run(st, 'echo hi >').errors[0], /missing file name/);
  assert.match(run(st, '| ls').errors[0], /empty command/);
});

test('every command parses in one dialect, renders in the other, and parses back to the same thing', () => {
  const lines = ['pwd', 'ls', 'ls -a docs', 'cd docs', 'cat a.txt b.txt', 'grep hello a.txt', 'grep -i -n "hello again" a.txt', 'mkdir -p a/b', 'touch f.txt',
    'cp -r docs backup', 'mv a b', 'rm -r -f docs', 'echo hello world', 'head -n 5 a.txt', 'cat a.txt | grep x | head -n 2', 'echo hi > f.txt'];
  const key = p => JSON.stringify([p.stages.map(s => [s.cmd, s.args, s.pattern, s.count, Object.keys(s.flags).filter(k => s.flags[k]).sort()]), p.redirect]);
  for (const l of lines) {
    const a = S.parse(l, 'linux'), ps = S.render(a, 'powershell'), b = S.parse(ps, 'powershell');
    const strip = x => JSON.parse(key(x)).map ? x : x;
    const ka = JSON.parse(key(a)), kb = JSON.parse(key(b));
    // PowerShell always creates parents for mkdir, never has -f, and so on: compare command, args, pattern, count
    assert.deepEqual(ka[0].map(s => s.slice(0, 4)), kb[0].map(s => s.slice(0, 4)), l + '  =>  ' + ps);
    const back = S.render(b, 'linux'), c = S.parse(back, 'linux');
    assert.deepEqual(JSON.parse(key(c))[0].map(s => s.slice(0, 4)), ka[0].map(s => s.slice(0, 4)), ps + '  =>  ' + back);
  }
  assert.equal(S.render(S.parse('ls -a', 'linux'), 'powershell'), 'Get-ChildItem -Force');
  assert.equal(S.render(S.parse('head -n 3 f', 'linux'), 'powershell'), 'Get-Content -Path f -TotalCount 3');
  assert.equal(S.render(S.parse('Get-Content f -TotalCount 3', 'powershell'), 'linux'), 'head -n 3 f');
  assert.equal(S.render(S.parse('grep hi f', 'linux'), 'powershell'), 'Select-String -Pattern hi -Path f -CaseSensitive');
  assert.equal(S.render(S.parse('rm -r d', 'linux'), 'powershell'), 'Remove-Item -Path d -Recurse');
  assert.equal(S.CMDS.length, 12);
});
