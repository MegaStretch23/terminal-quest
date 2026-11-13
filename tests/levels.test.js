'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shell.js');
const L = require('../levels.js');

function play(level, lines, dialect) {
  const g = L.newGame(level);
  for (const l of lines) g.history.push(S.run(g, l, dialect));
  return g;
}

test('at least 10 levels, each complete', () => {
  assert.ok(L.LEVELS.length >= 10);
  assert.deepEqual(L.LEVELS.map(l => l.id), L.LEVELS.map((_, i) => i + 1));
  for (const lv of L.LEVELS) {
    assert.ok(lv.title && lv.story && lv.goal, 'level ' + lv.id);
    assert.ok(lv.hints.length >= 2, 'hints of level ' + lv.id);
    assert.ok(lv.solution.linux.length && lv.solution.powershell.length, 'solutions of level ' + lv.id);
  }
});

test('no level is solved before the player does anything', () => {
  for (const lv of L.LEVELS) assert.equal(lv.check(L.newGame(lv)), false, 'level ' + lv.id);
});

test('every level is solvable in Linux and in PowerShell, every solution line succeeds', () => {
  for (const lv of L.LEVELS) for (const d of ['linux', 'powershell']) {
    const g = L.newGame(lv);
    for (const l of lv.solution[d]) {
      const r = S.run(g, l, d); g.history.push(r);
      assert.ok(r.ok, `level ${lv.id} ${d}: ${l} -> ${r.errors.join(' | ')}`);
    }
    assert.ok(lv.check(g), `level ${lv.id} ${d} not won`);
  }
});

test('each level starts from a fresh filesystem', () => {
  const lv = L.LEVELS[6]; const a = L.newGame(lv), b = L.newGame(lv);
  S.run(a, 'mkdir stuff', 'linux');
  assert.ok(a.fs.isDir(S.HOME + '/stuff') && !b.fs.isDir(S.HOME + '/stuff'));
});

test('wrong attempts do not win', () => {
  const lv = n => L.LEVELS[n - 1];
  assert.ok(!lv(3).check(play(lv(3), ['cat notes/todo.txt'], 'linux')), 'a different file is not readme.txt');
  assert.ok(!lv(4).check(play(lv(4), ['cd notes'], 'linux')));
  assert.ok(!lv(6).check(play(lv(6), ['ls -a'], 'linux')), 'listing is not reading');
  assert.ok(!lv(6).check(play(lv(6), ['cat readme.txt'], 'linux')));
  assert.ok(!lv(10).check(play(lv(10), ['mv docs/report.txt backup/'], 'linux')), 'moving removes the original');
  assert.ok(!lv(11).check(play(lv(11), ['cp draft.txt plan.txt'], 'linux')), 'copy keeps draft.txt');
  assert.ok(!lv(12).check(play(lv(12), ['grep -i error logs/app.log > errors.txt'], 'linux')), 'case-insensitive grep also catches the INFO line');
  assert.ok(!lv(12).check(play(lv(12), ['Select-String ERROR logs/app.log > errors.txt'], 'powershell')), 'Select-String ignores case unless -CaseSensitive');
  assert.ok(!lv(13).check(play(lv(13), ['head -n 2 logs/app.log > top.txt'], 'linux')));
  assert.ok(!lv(14).check(play(lv(14), ['rm tmp/*'], 'linux')), 'keep.txt must survive');
  assert.ok(!lv(14).check(play(lv(14), ['rm tmp/a.tmp'], 'linux')));
  assert.ok(!lv(15).check(play(lv(15), ['rm -r docs'], 'linux')), 'only docs/old may go');
  assert.ok(!lv(16).check(play(lv(16), ['mkdir site', 'echo hello > site/index.txt'], 'linux')), 'readme copy missing');
});

test('other correct ways also win (the check looks at the result, not the exact command)', () => {
  const lv = n => L.LEVELS[n - 1];
  assert.ok(lv(5).check(play(lv(5), ['cd'], 'linux')));
  assert.ok(lv(5).check(play(lv(5), ['cd ~'], 'linux')));
  assert.ok(lv(9).check(play(lv(9), ['echo hello terminal > hello.txt'], 'linux')));
  assert.ok(lv(13).check(play(lv(13), ['cat logs/app.log | head -n 3 > top.txt'], 'linux')));
  assert.ok(lv(14).check(play(lv(14), ['rm tmp/a.tmp tmp/b.tmp tmp/c.tmp'], 'linux')));
  assert.ok(lv(11).check(play(lv(11), ['mv ./draft.txt ./plan.txt'], 'linux')));
  assert.ok(lv(3).check(play(lv(3), ['cd docs', 'cat ../readme.txt'], 'linux')), 'a relative path from another folder counts');
});

function fakeStorage(init) { const m = Object.assign({}, init); return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; }

test('progress is saved and restored', () => {
  const st = fakeStorage();
  const p = L.makeProgress(st); p.load();
  assert.deepEqual(p.state.done, []); assert.equal(p.state.current, 1); assert.equal(p.state.mode, 'both');
  p.markDone(2); p.markDone(1); p.markDone(2); p.setCurrent(3); p.setMode('powershell');
  const q = L.makeProgress(st); q.load();
  assert.deepEqual(q.state.done, [1, 2]); assert.equal(q.state.current, 3); assert.equal(q.state.mode, 'powershell');
  assert.ok(q.isDone(1) && !q.isDone(3));
  q.reset(); const r = L.makeProgress(st); r.load(); assert.deepEqual(r.state.done, []); assert.equal(r.state.current, 1);
});

test('progress survives corrupt or unavailable storage', () => {
  const bad = L.makeProgress(fakeStorage({ [L.KEY]: '{not json' })); assert.doesNotThrow(() => bad.load()); assert.deepEqual(bad.state.done, []);
  const odd = L.makeProgress(fakeStorage({ [L.KEY]: JSON.stringify({ v: 1, done: [1, 999, 'x'], current: 999, mode: 'zsh' }) })); odd.load();
  assert.deepEqual(odd.state.done, [1]); assert.equal(odd.state.current, 1); assert.equal(odd.state.mode, 'both');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const t = L.makeProgress(throwing); assert.doesNotThrow(() => t.load()); assert.equal(t.markDone(1), false);
});
