'use strict';
// Plays the built-in solution of every level through the real shell and prints the transcript.
// `node tests/sample_run.js --write` saves it to examples/sample-run.txt (the README quotes that file; tests/readme.test.js checks they match).
const fsx = require('fs'), path = require('path');
const S = require('../shell.js'), L = require('../levels.js');

function transcript() {
  const out = ['Terminal Quest: transcript of the built-in solutions, played through shell.js + levels.js (no editing).', ''];
  for (const d of ['linux', 'powershell']) {
    out.push('=== ' + (d === 'linux' ? 'Linux mode' : 'PowerShell mode') + ' ===');
    for (const lv of L.LEVELS) {
      const g = L.newGame(lv);
      out.push('', 'Level ' + lv.id + ': ' + lv.title + '  (start in ' + g.cwd + ')', 'Goal: ' + lv.goal);
      for (const line of lv.solution[d]) {
        const prompt = d === 'linux' ? 'player@quest:' + (g.cwd === S.HOME ? '~' : g.cwd.replace(S.HOME, '~')) + '$ ' : 'PS ' + g.cwd + '> ';
        const r = S.run(g, line, d); g.history.push(r);
        out.push(prompt + line);
        r.lines.forEach(l => out.push(l)); r.errors.forEach(l => out.push('ERROR ' + l));
      }
      out.push(lv.check(g) ? '-> level complete' : '-> NOT COMPLETE');
    }
    out.push('');
  }
  return out.join('\n') + '\n';
}
module.exports = { transcript };
if (require.main === module) {
  const t = transcript();
  if (process.argv.includes('--write')) {
    const f = path.join(__dirname, '..', 'examples', 'sample-run.txt'); fsx.mkdirSync(path.dirname(f), { recursive: true }); fsx.writeFileSync(f, t); console.log('wrote', f, t.length, 'bytes');
  } else process.stdout.write(t);
}
