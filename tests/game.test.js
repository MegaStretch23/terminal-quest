'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, LEVELS } = require('../tq.js');

for (const mode of ['linux', 'ps']) {
  test(`${mode}: every level is solved by its reference solution, and only by then`, () => {
    const g = new Game(mode);
    LEVELS.forEach((lv, i) => {
      assert.strictEqual(g.level, i);
      const cmds = lv.solve[mode];
      cmds.forEach((c, j) => {
        const r = g.step(c);
        assert.ok(r.ok, `level ${i + 1} cmd "${c}" failed: ${r.err}`);
        assert.strictEqual(!!r.levelDone, j === cmds.length - 1, `level ${i + 1} done flag`);
      });
      g.next();
    });
    assert.ok(g.won);
  });

  test(`${mode}: a level is not completed by an unrelated command`, () => {
    const g = new Game(mode);
    assert.ok(!g.step('whoami').levelDone);
    assert.ok(!g.step('nonsense').levelDone);
  });

  test(`${mode}: restoreTo rebuilds the same world as playing`, () => {
    const a = new Game(mode);
    for (let i = 0; i < 8; i++) { LEVELS[i].solve[mode].forEach((c) => a.run(c)); a.next(); }
    const b = new Game(mode).restoreTo(8);
    assert.deepStrictEqual(b.fs, a.fs);
    assert.deepStrictEqual(b.cwd, a.cwd);
    assert.strictEqual(b.level, 8);
  });

  test(`${mode}: hints and tasks exist for every level`, () => {
    for (const lv of LEVELS) { assert.ok(lv.task[mode] && lv.hint[mode] && lv.solve[mode].length && lv.story && lv.title); }
  });
}

test('linux: basics and errors', () => {
  const g = new Game('linux');
  assert.strictEqual(g.run('pwd').out, '/home/player');
  assert.strictEqual(g.run('ls').out, 'quest');
  assert.match(g.run('ls -a').out, /\.bashrc/);
  assert.match(g.run('ls nope').err, /cannot access 'nope': No such file or directory/);
  assert.match(g.run('cd nope').err, /No such file or directory/);
  g.run('cd quest');
  assert.strictEqual(g.prompt(), 'player@tq:~/quest$ ');
  assert.match(g.run('cat nothere.txt').err, /No such file/);
  assert.match(g.run('rm cave').err, /Is a directory/);
  assert.match(g.run('mkdir cave').err, /File exists/);
  assert.match(g.run('echo "unterminated').err, /EOF/);
  assert.match(g.run('cd /').out + g.prompt(), /player@tq:\/\$ /);
});

test('linux: redirect, append, glob, pipes', () => {
  const g = new Game('linux'); g.run('cd quest');
  g.run('echo one > a.txt'); g.run('echo two >> a.txt');
  assert.strictEqual(g.run('cat a.txt').out, 'one\ntwo');
  assert.strictEqual(g.run('cat *.txt | wc -l').out, '6'); // a.txt 2 + map.txt 1 + readme.txt 3
  assert.strictEqual(g.run('cat a.txt | sort -r | head -n 1').out, 'two');
  assert.strictEqual(g.run('grep -c ERROR logs/app.log').out, '3');
  assert.strictEqual(g.run('grep -i error logs/app.log | wc -l').out, '3');
  assert.strictEqual(g.run('head -2 logs/app.log').out.split('\n').length, 2);
  assert.strictEqual(g.run('tail -n 1 logs/app.log').out.split('\n').length, 1);
  assert.match(g.run('find . -name "*.tmp"').out, /\.\/trash\/junk1\.tmp\n.*\.\/treasure\.tmp/s);
  assert.match(g.run('ls -l').out, /^drwxr-xr-x/m);
  assert.match(g.run('cp -r logs logs2').err || 'ok', /ok/);
  assert.ok(g.nodeAt(['home', 'player', 'quest', 'logs2', 'old', 'archive.log']));
  assert.match(g.run('cp logs logs3').err, /-r not specified/);
  assert.match(g.run('mv nope x').err, /cannot stat/);
  g.run('mkdir -p deep/er/still'); assert.ok(g.nodeAt(['home', 'player', 'quest', 'deep', 'er', 'still']));
  g.run('touch fresh.txt'); assert.strictEqual(g.run('cat fresh.txt').out, '');
});

test('linux: cannot delete the directory you stand in', () => {
  const g = new Game('linux'); g.run('cd quest/trash');
  assert.match(g.run('rm -r ../trash').err, /refusing/);
  assert.match(g.run('rm -r /').err, /refusing/);
  assert.ok(g.nodeAt(['home', 'player', 'quest', 'trash']));
});

test('powershell: basics, case-insensitive, both slashes, drive paths', () => {
  const g = new Game('ps');
  assert.match(g.run('get-location').out, /C:\\Users\\player/);
  assert.strictEqual(g.prompt(), 'PS C:\\Users\\player> ');
  g.run('SET-LOCATION QUEST\\Logs'); assert.strictEqual(g.prompt(), 'PS C:\\Users\\player\\quest\\logs> ');
  g.run('cd C:\\Users\\player\\quest'); assert.strictEqual(g.cwd.join('/'), 'home/player/quest');
  g.run('cd ./cave'); assert.strictEqual(g.cwd.join('/'), 'home/player/quest/cave');
  assert.match(g.run('Get-ChildItem').out, /-a---- +14 bats\.txt/);
  assert.match(g.run('cd nowhere').err, /Cannot find path 'C:\\Users\\player\\quest\\cave\\nowhere' because it does not exist/);
});

test('powershell: cmdlets', () => {
  const g = new Game('ps'); g.run('cd quest');
  assert.match(g.run('New-Item -ItemType File -Name n.txt').out, /n\.txt/);
  assert.match(g.run('New-Item n2.txt').err, /ItemType/);
  g.run('Set-Content n.txt hello'); assert.strictEqual(g.run('Get-Content n.txt').out, 'hello');
  assert.strictEqual(g.run('Get-Content logs\\app.log -TotalCount 2').out.split('\n').length, 2);
  assert.strictEqual(g.run('Get-Content logs\\app.log | Select-Object -First 2').out.split('\n').length, 2);
  assert.strictEqual(g.run('Get-Content logs\\app.log | Select-Object -Last 1').out.split('\n').length, 1);
  assert.match(g.run('select-string error logs\\app.log').out, /^logs\\app\.log:2:.*ERROR/m); // case-insensitive by default
  assert.strictEqual(g.run('Select-String -CaseSensitive error logs\\app.log').out, '');
  assert.match(g.run('Get-Content logs\\app.log | Select-String -Pattern ERROR | Measure-Object').out, /Count\s+: 3/);
  assert.match(g.run('Get-ChildItem -Recurse -Filter *.log').out, /C:\\Users\\player\\quest\\logs\\old\\archive\.log/);
  g.run('Rename-Item n.txt m.txt'); assert.ok(g.nodeAt(['home', 'player', 'quest', 'm.txt'])); assert.ok(!g.nodeAt(['home', 'player', 'quest', 'n.txt']));
  g.run('Copy-Item logs logscopy -Recurse'); assert.ok(g.nodeAt(['home', 'player', 'quest', 'logscopy', 'old', 'archive.log']));
  assert.match(g.run('Remove-Item trash').err, /has children and the Recurse parameter was not specified/);
  assert.match(g.run('Remove-Item -Bogus x').err, /parameter name 'Bogus'/);
  g.run('rm -Recurse -Force trash'); assert.ok(!g.nodeAt(['home', 'player', 'quest', 'trash']));
  g.run('Get-ChildItem -rec -fil *.txt'); // prefix abbreviations
});

test('wrong-shell hints teach the equivalent', () => {
  const l = new Game('linux'), p = new Game('ps');
  assert.match(l.run('Get-ChildItem').err, /Use: ls|use: ls/);
  assert.match(p.run('grep foo x').err, /Select-String/);
  assert.match(p.run('find . -name x').err, /Get-ChildItem -Recurse -Filter/);
  assert.match(p.run('touch x').err, /New-Item/);
  assert.match(l.run('foo').err, /command not found/);
});

test('help lists the commands of the active shell', () => {
  assert.match(new Game('linux').run('help').out, /grep/);
  assert.match(new Game('ps').run('help').out, /Select-String/);
});
