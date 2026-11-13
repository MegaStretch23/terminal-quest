/* Terminal Quest UI: wires tq.js to the page. No dependencies. */
(function (root) {
  'use strict';
  function start(doc, TQ, store) {
    const $ = (id) => doc.getElementById(id);
    const term = $('term'), input = $('cmd'), promptEl = $('prompt');
    let mode = 'linux';
    try { const q = new URLSearchParams((root.location && root.location.search) || '').get('mode'); mode = q === 'ps' ? 'ps' : (store.getItem('tq.mode') === 'ps' ? 'ps' : 'linux'); } catch (e) { /* storage blocked */ }
    let g = null, hist = [], hi = 0;

    const save = () => { try { store.setItem('tq.mode', mode); store.setItem('tq.level.' + mode, String(g.level)); } catch (e) { /* ignore */ } };
    const load = () => { try { return Math.min(parseInt(store.getItem('tq.level.' + mode) || '0', 10) || 0, TQ.LEVELS.length); } catch (e) { return 0; } };
    function print(text, cls) {
      const d = doc.createElement('div');
      if (cls) d.className = cls;
      d.textContent = text;
      term.appendChild(d);
      term.scrollTop = term.scrollHeight;
    }
    function panel() {
      const n = TQ.LEVELS.length;
      $('m-linux').setAttribute('aria-pressed', String(mode === 'linux'));
      $('m-ps').setAttribute('aria-pressed', String(mode === 'ps'));
      promptEl.textContent = g.prompt();
      if (g.won) {
        $('lvl-meta').textContent = `All ${n} levels done`;
        $('bar').style.width = '100%';
        $('lvl-title').textContent = 'Quest complete';
        $('lvl-story').textContent = 'You can navigate, read, create, copy, move, search and delete from a command line. Try the other shell with the buttons above, or run the same commands in a real terminal.';
        $('lvl-task').textContent = 'Keep playing in the sandbox: type help.';
        return;
      }
      const lv = TQ.LEVELS[g.level];
      $('lvl-meta').textContent = `Level ${g.level + 1} of ${n}`;
      $('bar').style.width = Math.round((g.level / n) * 100) + '%';
      $('lvl-title').textContent = lv.title;
      $('lvl-story').textContent = lv.story;
      $('lvl-task').textContent = 'Your task: ' + lv.task[mode];
    }
    function newGame(m, lvl) {
      mode = m;
      g = new TQ.Game(mode).restoreTo(lvl);
      term.textContent = '';
      print(`Terminal Quest. ${mode === 'ps' ? 'Windows PowerShell' : 'Linux bash'} mode. Follow the task on the left.`, 'sys');
      if (!g.won) print('Level ' + (g.level + 1) + ': ' + TQ.LEVELS[g.level].title + '. ' + TQ.LEVELS[g.level].task[mode], 'sys');
      panel(); save(); input.focus && input.focus();
    }
    function submit(line) {
      print(g.prompt() + line, 'cmd');
      const t = line.trim();
      if (t) { hist.push(t); hi = hist.length; }
      if (t === 'hint') { print(g.won ? 'You finished every level.' : TQ.LEVELS[g.level].hint[mode], 'sys'); return; }
      if (t === 'reset') { newGame(mode, g.level); print('World rebuilt to the start of this level.', 'sys'); return; }
      const r = g.step(line);
      if (r.clear) { term.textContent = ''; panel(); return; }
      if (r.out) print(r.out);
      if (r.err) print(r.err, 'err');
      if (r.levelDone) {
        print(`Level ${g.level + 1} complete: ${TQ.LEVELS[g.level].title}`, 'ok');
        g.next(); save();
        if (g.won) print('You finished the quest! Switch shells with the buttons above and play it again.', 'ok');
        else print('Level ' + (g.level + 1) + ': ' + TQ.LEVELS[g.level].title + '. ' + TQ.LEVELS[g.level].task[mode], 'sys');
      }
      panel();
    }
    function complete() {
      const v = input.value, m = /(\S*)$/.exec(v), word = m ? m[1] : '';
      const slash = Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\'));
      const dirStr = word.slice(0, slash + 1), frag = word.slice(slash + 1);
      const d = g.nodeAt(g.resolve(dirStr || '.'));
      if (!d || d.t !== 'd') return;
      const ci = mode === 'ps';
      const hits = Object.keys(d.c).filter((k) => (ci ? k.toLowerCase().startsWith(frag.toLowerCase()) : k.startsWith(frag)) && (frag || !k.startsWith('.')));
      if (hits.length === 1) input.value = v.slice(0, v.length - word.length) + dirStr + hits[0] + (d.c[hits[0]].t === 'd' ? (ci ? '\\' : '/') : ' ');
      else if (hits.length > 1) print(hits.sort().join('  '), 'sys');
    }

    $('form').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; submit(v); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); if (hi > 0) input.value = hist[--hi]; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hi + 1, hist.length); input.value = hist[hi] || ''; }
      else if (e.key === 'Tab') { e.preventDefault(); complete(); }
    });
    $('m-linux').addEventListener('click', () => { if (mode !== 'linux') { mode = 'linux'; newGame('linux', load()); } });
    $('m-ps').addEventListener('click', () => { if (mode !== 'ps') { mode = 'ps'; newGame('ps', load()); } });
    $('b-hint').addEventListener('click', () => submit('hint'));
    $('b-reset').addEventListener('click', () => submit('reset'));
    $('b-restart').addEventListener('click', () => newGame(mode, 0));
    newGame(mode, load());
    return { submit, get game() { return g; }, term };
  }
  if (typeof document !== 'undefined' && root.TQ) {
    let store; try { store = root.localStorage; store.getItem('x'); } catch (e) { const m = {}; store = { getItem: (k) => m[k] || null, setItem: (k, v) => { m[k] = v; } }; }
    start(document, root.TQ, store);
  }
  const api = { start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
