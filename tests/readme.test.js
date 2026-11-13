'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const L = require('../levels.js'), S = require('../shell.js');

test('saved sample run matches what the code produces now', () => {
  assert.equal(read('examples/sample-run.txt'), require('./sample_run.js').transcript(), 'run: node tests/sample_run.js --write');
});

test('README quotes the saved run and its quickstart is there', () => {
  const rd = read('README.md'), sample = read('examples/sample-run.txt');
  assert.ok(rd.includes('python -m http.server'));
  const block = rd.split('## Sample output')[1].split('```')[1].split('\n').map(l => l.trimEnd()).filter(Boolean);
  assert.ok(block.length > 10);
  for (const line of block) assert.ok(sample.includes(line), 'README line not in sample-run.txt: ' + line);
});

test('README numbers match the code', () => {
  const rd = read('README.md');
  assert.ok(rd.includes(`${L.LEVELS.length} short levels`));
  assert.equal(S.CMDS.length, 12); assert.ok(rd.includes('## The 12 commands'));
  for (const lv of L.LEVELS) assert.ok(rd.includes(lv.id + ' ' + lv.title), 'level missing in README: ' + lv.title);
});

test('"more from the author" links carry the verified prices and the right hosts', () => {
  const rd = read('README.md').split('## More from the author')[1];
  const links = [...rd.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map(m => new URL(m[1]).host);
  for (const h of links) assert.ok(['apify.com', 'vedovino.gumroad.com', 'github.com'].includes(h), h);
  for (const p of ['$0.0004', '$0.02', '$0.002', '$15', '$19']) assert.ok(rd.includes(p), p);
});

test('no network API, no external resource, no tracking in the shipped page code', () => {
  const NET = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|navigator\.geolocation|document\.cookie|indexedDB)\b/;
  for (const f of ['shell.js', 'levels.js', 'game.js']) assert.ok(!NET.test(read(f)), f);
  const html = read('index.html');
  for (const ref of html.match(/(?:src|href)="[^"]+"/g)) {
    const u = ref.slice(ref.indexOf('"') + 1, -1);
    if (/^https?:/.test(u)) assert.equal(u, 'https://github.com/MegaStretch23/terminal-quest', 'only the repo link may be external: ' + u);
    else assert.ok(fs.existsSync(path.join(root, u)), 'missing ' + u);
  }
  assert.ok(!/<script[^>]+src="https?:/.test(html));
});

test('page claims are ones the code backs', () => {
  const html = read('index.html');
  assert.ok(html.includes('16 short levels') && L.LEVELS.length === 16);
  assert.ok(html.includes('localStorage') && read('levels.js').includes("'terminal-quest-v1'"));
  assert.ok(!/\b(guarantee|AI-powered|certified|official)\b/i.test(html + read('README.md')));
});
