'use strict';
// UI smoke test with a tiny fake DOM: plays the whole game through the page code, in both shells.
const test = require('node:test');
const assert = require('node:assert');
const TQ = require('../tq.js');
const { start } = require('../app.js');

function fakeDoc() {
  const els = {};
  const mk = () => ({ children: [], listeners: {}, attrs: {}, style: {}, value: '', textContent: '', className: '', scrollTop: 0, scrollHeight: 0,
    appendChild(c) { this.children.push(c); }, addEventListener(t, f) { this.listeners[t] = f; }, setAttribute(k, v) { this.attrs[k] = v; }, focus() {} });
  return { els, getElementById: (id) => (els[id] = els[id] || mk()), createElement: () => mk() };
}
const text = (term) => term.children.map((c) => c.textContent).join('\n');

for (const mode of ['linux', 'ps']) {
  test(`ui ${mode}: whole game through the page`, () => {
    const mem = {}; mem['tq.mode'] = mode;
    const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
    const doc = fakeDoc();
    const app = start(doc, TQ, store);
    assert.strictEqual(app.game.mode, mode);
    TQ.LEVELS.forEach((lv) => lv.solve[mode].forEach((c) => app.submit(c)));
    assert.ok(app.game.won);
    assert.match(text(app.term), /You finished the quest/);
    assert.strictEqual(mem['tq.level.' + mode], String(TQ.LEVELS.length));
    assert.strictEqual(doc.els['bar'].style.width, '100%');
  });
}

test('ui: hint, reset, resume from storage, errors shown', () => {
  const mem = {};
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  let doc = fakeDoc(), app = start(doc, TQ, store);
  app.submit('hint'); assert.match(text(app.term), /Type: pwd/);
  app.submit('bogus'); assert.match(text(app.term), /command not found/);
  app.submit('pwd'); app.submit('ls'); app.submit('cd quest');
  assert.strictEqual(mem['tq.level.linux'], '3');
  doc = fakeDoc(); app = start(doc, TQ, store);          // reload: resumes at level 4, in quest
  assert.strictEqual(app.game.level, 3); assert.strictEqual(app.game.cwd.join('/'), 'home/player/quest');
  assert.match(doc.els['lvl-title'].textContent, /Read the note/);
  app.submit('rm -r /'); app.submit('reset'); assert.match(text(app.term), /World rebuilt/);
});
