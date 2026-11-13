/* Terminal Quest engine: a tiny pretend shell (Linux bash and Windows PowerShell flavours) over an in-memory file tree.
 * Nothing here touches your real files. Works in the browser (window.TQ) and in Node (require('./tq.js')).
 * MIT licensed. */
(function (root) {
  'use strict';

  const HOME = ['home', 'player'];
  const D = (c) => ({ t: 'd', c: c || {} });
  const F = (s) => ({ t: 'f', s: s });

  function initialFS() {
    return D({
      home: D({
        player: D({
          '.bashrc': F('# nothing to see here\n'),
          quest: D({
            'readme.txt': F('Welcome, adventurer.\nThe cave lies to the north. Keep your torch lit.\nGood luck!\n'),
            'map.txt': F('treasure: under the old oak\n'),
            'treasure.tmp': F('100 gold coins\n'),
            cave: D({ 'bats.txt': F('squeak squeak\n') }),
            logs: D({
              'app.log': F('2026-11-13 08:00 INFO start\n2026-11-13 08:01 ERROR torch went out\n2026-11-13 08:02 INFO retry\n' +
                '2026-11-13 08:03 ERROR bridge broken\n2026-11-13 08:04 WARN low health\n2026-11-13 08:05 ERROR dragon nearby\n'),
              'server.log': F('2026-11-13 08:00 INFO boot ok\n2026-11-13 08:01 INFO KEY=quest-7731\n2026-11-13 08:02 WARN disk 91%\n'),
              old: D({ 'archive.log': F('2026-10-01 INFO archived\n') }),
            }),
            trash: D({ 'junk1.tmp': F('x\n'), 'junk2.tmp': F('y\n'), sub: D({ 'junk3.tmp': F('z\n') }) }),
          }),
        }),
      }),
    });
  }

  function clone(n) {
    if (n.t === 'f') return F(n.s);
    const c = {};
    for (const k of Object.keys(n.c)) c[k] = clone(n.c[k]);
    return D(c);
  }

  // ---- tokenizer: whitespace, quotes, and the operators | > >> ----
  function tokenize(line) {
    const toks = [];
    let cur = '', has = false, q = null;
    const push = () => { if (has) toks.push({ v: cur, op: false }); cur = ''; has = false; };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === q) q = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (/\s/.test(ch)) { push(); continue; }
      if (ch === '|') { push(); toks.push({ v: '|', op: true }); continue; }
      if (ch === '>') {
        push();
        if (line[i + 1] === '>') { toks.push({ v: '>>', op: true }); i++; } else toks.push({ v: '>', op: true });
        continue;
      }
      cur += ch; has = true;
    }
    if (q) return { err: 'unexpected EOF while looking for matching quote' };
    push();
    return { toks };
  }

  const lines = (t) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));
  const globRe = (g, ci) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', ci ? 'i' : '');

  // ---- command table: canonical name -> names per mode ----
  const CMDS = {
    pwd: { linux: ['pwd'], ps: ['get-location', 'pwd', 'gl'], psName: 'Get-Location' },
    ls: { linux: ['ls'], ps: ['get-childitem', 'ls', 'dir', 'gci'], psName: 'Get-ChildItem' },
    cd: { linux: ['cd'], ps: ['set-location', 'cd', 'sl', 'chdir'], psName: 'Set-Location' },
    cat: { linux: ['cat'], ps: ['get-content', 'cat', 'gc', 'type'], psName: 'Get-Content' },
    echo: { linux: ['echo'], ps: ['write-output', 'echo', 'write-host'], psName: 'Write-Output' },
    mkdir: { linux: ['mkdir'], ps: ['mkdir', 'md'], psName: 'New-Item -ItemType Directory' },
    touch: { linux: ['touch'], ps: ['new-item', 'ni'], psName: 'New-Item' },
    cp: { linux: ['cp'], ps: ['copy-item', 'copy', 'cp', 'cpi'], psName: 'Copy-Item' },
    mv: { linux: ['mv'], ps: ['move-item', 'move', 'mv', 'mi', 'rename-item', 'ren', 'rni'], psName: 'Move-Item' },
    rm: { linux: ['rm'], ps: ['remove-item', 'rm', 'del', 'erase', 'ri', 'rmdir', 'rd'], psName: 'Remove-Item' },
    grep: { linux: ['grep'], ps: ['select-string', 'sls'], psName: 'Select-String' },
    find: { linux: ['find'], ps: [], psName: 'Get-ChildItem -Recurse -Filter' },
    head: { linux: ['head'], ps: ['select-object', 'select'], psName: 'Select-Object -First' },
    tail: { linux: ['tail'], ps: [], psName: 'Select-Object -Last' },
    wc: { linux: ['wc'], ps: ['measure-object', 'measure'], psName: 'Measure-Object' },
    sort: { linux: ['sort'], ps: ['sort-object', 'sort'], psName: 'Sort-Object' },
    set: { linux: [], ps: ['set-content', 'sc', 'add-content', 'ac'], psName: 'Set-Content' },
    whoami: { linux: ['whoami'], ps: ['whoami'], psName: 'whoami' },
    clear: { linux: ['clear'], ps: ['clear-host', 'cls', 'clear'], psName: 'Clear-Host' },
    help: { linux: ['help'], ps: ['help', 'get-help'], psName: 'Get-Help' },
  };
  // linux name / ps name (lowercase) -> canonical
  const BY = { linux: {}, ps: {} };
  for (const k of Object.keys(CMDS)) {
    for (const n of CMDS[k].linux) BY.linux[n] = k;
    for (const n of CMDS[k].ps) BY.ps[n] = k;
  }
  BY.linux.rmdir = 'rm'; // rmdir only removes empty dirs for real; treated like rm -r here, fine for a game

  function psResolve(n, names) {
    if (names.includes(n)) return n;
    return names.find((x) => x.startsWith(n)) || null;
  }

  // flag parser. spec: {names:[ps flag names], value:[flag names that take a value], words:[single-dash multi-letter linux flags], num:bool}
  function parseArgs(args, mode, spec) {
    const pos = [], f = {};
    spec = spec || {};
    const names = spec.names || [], value = spec.value || [], words = spec.words || [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--') { pos.push(...args.slice(i + 1)); break; }
      if (mode === 'ps' && /^-[A-Za-z]/.test(a)) {
        const nm = psResolve(a.slice(1).replace(/:$/, '').toLowerCase(), names);
        if (!nm) return { err: `A parameter cannot be found that matches parameter name '${a.slice(1)}'.` };
        if (value.includes(nm)) {
          if (args[i + 1] === undefined) return { err: `Missing an argument for parameter '${a.slice(1)}'.` };
          f[nm] = args[++i];
        } else f[nm] = true;
      } else if (mode === 'linux' && /^-\d+$/.test(a) && spec.num) {
        f.n = a.slice(1);
      } else if (mode === 'linux' && /^--?[A-Za-z]/.test(a)) {
        if (a.startsWith('--')) { f[a.slice(2)] = true; continue; }
        const w = a.slice(1);
        if (words.includes(w)) {
          if (value.includes(w)) { if (args[i + 1] === undefined) return { err: `missing argument to '${a}'` }; f[w] = args[++i]; } else f[w] = true;
          continue;
        }
        for (let j = 0; j < w.length; j++) {
          const c = w[j];
          if (value.includes(c)) {
            const rest = w.slice(j + 1);
            if (rest) f[c] = rest;
            else { if (args[i + 1] === undefined) return { err: `option requires an argument -- '${c}'` }; f[c] = args[++i]; }
            break;
          }
          f[c] = true;
        }
      } else pos.push(a);
    }
    return { pos, f };
  }

  class Game {
    constructor(mode) {
      this.mode = mode === 'ps' ? 'ps' : 'linux';
      this.reset();
    }

    reset() {
      this.fs = initialFS();
      this.cwd = HOME.slice();
      this.history = [];
      this.level = 0;
      this.won = false;
    }

    // ---- paths ----
    dispPath(parts) {
      if (this.mode === 'ps') return parts[0] === 'home' ? ['C:', 'Users', ...parts.slice(1)].join('\\') : 'C:\\' + parts.join('\\');
      return '/' + parts.join('/');
    }

    prompt() {
      if (this.mode === 'ps') return `PS ${this.dispPath(this.cwd)}> `;
      const inHome = this.cwd.length >= 2 && this.cwd[0] === 'home' && this.cwd[1] === 'player';
      const shown = inHome ? '~' + (this.cwd.length > 2 ? '/' + this.cwd.slice(2).join('/') : '') : this.dispPath(this.cwd);
      return `player@tq:${shown}$ `;
    }

    child(dir, name) {
      if (!dir || dir.t !== 'd') return null;
      if (name in dir.c) return name;
      if (this.mode === 'ps') { const l = name.toLowerCase(); return Object.keys(dir.c).find((k) => k.toLowerCase() === l) || null; }
      return null;
    }

    resolve(p) {
      let s = p;
      if (this.mode === 'ps') s = s.replace(/\\/g, '/');
      let abs = false, base = this.cwd.slice();
      if (this.mode === 'ps' && /^[A-Za-z]:/.test(s)) { s = s.slice(2); if (!s.startsWith('/')) s = '/' + s; }
      if (s === '~' || s.startsWith('~/')) { base = HOME.slice(); s = s.slice(1); } else if (s.startsWith('/')) { abs = true; base = []; }
      let segs = s.split('/').filter((x) => x !== '' && x !== '.');
      if (abs && this.mode === 'ps' && segs[0] && segs[0].toLowerCase() === 'users') segs[0] = 'home';
      const out = [];
      let node = this.fs;
      for (const part of base.concat(segs)) {
        if (part === '..') { out.pop(); node = this.nodeAt(out); continue; }
        const key = node ? this.child(node, part) : null;
        out.push(key || part);
        node = key ? node.c[key] : null;
      }
      return out;
    }

    nodeAt(parts) {
      let n = this.fs;
      for (const p of parts) { n = n && n.t === 'd' ? n.c[p] : null; if (!n) return null; }
      return n;
    }

    expand(arg) {
      if (!/[*?]/.test(arg)) return [arg];
      const idx = Math.max(arg.lastIndexOf('/'), this.mode === 'ps' ? arg.lastIndexOf('\\') : -1);
      const dirStr = arg.slice(0, idx + 1), pat = arg.slice(idx + 1);
      if (/[*?]/.test(dirStr)) return [arg];
      const d = this.nodeAt(this.resolve(dirStr || '.'));
      if (!d || d.t !== 'd') return [arg];
      const re = globRe(pat, this.mode === 'ps');
      const hit = Object.keys(d.c).filter((k) => re.test(k) && (!k.startsWith('.') || pat.startsWith('.'))).sort();
      return hit.length ? hit.map((k) => dirStr + k) : [arg];
    }

    // ---- error strings ----
    nofile(cmd, arg, parts) {
      if (this.mode === 'ps') return `${CMDS[cmd].psName.split(' ')[0]} : Cannot find path '${this.dispPath(parts)}' because it does not exist.`;
      const v = { ls: 'cannot access ', cp: 'cannot stat ', mv: 'cannot stat ', rm: 'cannot remove ', mkdir: 'cannot create directory ', touch: 'cannot touch ' }[cmd];
      if (cmd === 'cd') return `bash: cd: ${arg}: No such file or directory`;
      return v ? `${cmd}: ${v}'${arg}': No such file or directory` : `${cmd}: ${arg}: No such file or directory`;
    }

    // ---- run one input line ----
    run(line) {
      line = String(line || '').trim();
      if (!line) return { line, out: '', err: '', ok: true, canon: [], pipe: false, blank: true };
      const t = tokenize(line);
      if (t.err) return this.record({ line, out: '', err: (this.mode === 'ps' ? 'ParserError: ' : 'bash: ') + t.err, ok: false, canon: [], pipe: false });
      const stages = [[]];
      let redirect = null;
      for (let i = 0; i < t.toks.length; i++) {
        const k = t.toks[i];
        if (k.op && k.v === '|') { stages.push([]); continue; }
        if (k.op) {
          const nx = t.toks[i + 1];
          if (!nx || nx.op) return this.record({ line, out: '', err: this.mode === 'ps' ? 'ParserError: Missing file specification after redirection operator.' : "bash: syntax error near unexpected token `newline'", ok: false, canon: [], pipe: false });
          redirect = { path: nx.v, append: k.v === '>>' }; i++; continue;
        }
        stages[stages.length - 1].push(k.v);
      }
      if (stages.some((s) => !s.length)) return this.record({ line, out: '', err: this.mode === 'ps' ? 'ParserError: An empty pipe element is not allowed.' : "bash: syntax error near unexpected token `|'", ok: false, canon: [], pipe: false });
      let input = null, canon = [], err = '', out = '';
      for (const st of stages) {
        const r = this.exec(st[0], st.slice(1), input);
        if (r.clear) return { line, out: '', err: '', ok: true, canon: ['clear'], pipe: false, clear: true };
        canon.push(r.canon);
        if (r.err) { out = r.out || ''; err = r.err; break; }
        input = out = r.out;
      }
      if (!err && redirect) {
        const parts = this.resolve(redirect.path);
        const dir = this.nodeAt(parts.slice(0, -1));
        const name = parts[parts.length - 1];
        if (!dir || dir.t !== 'd' || !name) err = this.nofile('cat', redirect.path, parts).replace(/^cat: /, 'bash: ');
        else {
          const ex = dir.c[name];
          if (ex && ex.t === 'd') err = this.mode === 'ps' ? `Out-File : Access to the path '${this.dispPath(parts)}' is denied.` : `bash: ${redirect.path}: Is a directory`;
          else { const body = out === '' ? '' : out + '\n'; dir.c[name] = F(redirect.append && ex ? ex.s + body : body); out = ''; }
        }
      }
      return this.record({ line, out, err, ok: !err, canon, pipe: stages.length > 1 });
    }

    record(r) { this.history.push(r); return r; }

    // Run a line, then say whether the current level is now complete.
    step(line) {
      const r = this.run(line);
      if (!r.blank && !r.clear && !this.won && LEVELS[this.level] && LEVELS[this.level].check(this, r)) r.levelDone = true;
      return r;
    }

    next() { this.level++; if (this.level >= LEVELS.length) this.won = true; return this.level; }

    // Rebuild the world as it would be at the start of level n (replays the reference solutions silently).
    restoreTo(n) {
      this.reset();
      for (let i = 0; i < n && i < LEVELS.length; i++) { for (const c of LEVELS[i].solve[this.mode]) this.run(c); this.next(); }
      this.history = [];
      return this;
    }

    exec(name, args, stdin) {
      const m = this.mode;
      const canon = m === 'ps' ? BY.ps[name.toLowerCase()] : BY.linux[name];
      if (!canon) return this.notFound(name);
      const fn = this['c_' + canon];
      const r = fn.call(this, args, stdin);
      return Object.assign({ canon, out: '', err: '' }, r);
    }

    notFound(name) {
      const low = name.toLowerCase();
      if (this.mode === 'linux') {
        const other = BY.ps[low];
        if (other) return { canon: '?', out: '', err: `${name}: command not found. That is a PowerShell cmdlet. Switch to PowerShell mode, or in Linux use: ${CMDS[other].linux[0] || CMDS[other].psName}` };
        return { canon: '?', out: '', err: `${name}: command not found` };
      }
      const other = BY.linux[low];
      if (other) return { canon: '?', out: '', err: `${name} : The term '${name}' is not recognized as the name of a cmdlet, function, script file, or operable program. That is a Linux command. In PowerShell use: ${CMDS[other].psName}` };
      return { canon: '?', out: '', err: `${name} : The term '${name}' is not recognized as the name of a cmdlet, function, script file, or operable program.` };
    }

    // ---- listing helpers ----
    psTable(dirParts, items) {
      const out = ['', `    Directory: ${this.dispPath(dirParts)}`, '', 'Mode        Length Name', '----        ------ ----'];
      for (const [name, n] of items) out.push(`${n.t === 'd' ? 'd-----' : '-a----'} ${(n.t === 'f' ? String(n.s.length) : '').padStart(10)} ${name}`);
      out.push('');
      return out.join('\n');
    }

    // ---- commands ----
    c_pwd() {
      const p = this.dispPath(this.cwd);
      return { out: this.mode === 'ps' ? `\nPath\n----\n${p}\n` : p };
    }

    c_whoami() { return { out: this.mode === 'ps' ? 'tq\\player' : 'player' }; }
    c_clear() { return { clear: true }; }

    c_help() {
      const names = this.mode === 'ps'
        ? 'Get-Location  Get-ChildItem  Set-Location  Get-Content  Write-Output  New-Item  Copy-Item  Move-Item  Remove-Item  Select-String  Select-Object  Measure-Object  Sort-Object  Set-Content'
        : 'pwd  ls  cd  cat  echo  mkdir  touch  cp  mv  rm  grep  find  head  tail  wc  sort  whoami  clear';
      return { out: `Commands in this ${this.mode === 'ps' ? 'PowerShell' : 'Linux'} sandbox:\n${names}\nGame commands: hint (nudge for this level), reset (rebuild the world), help.` };
    }

    c_echo(args) { return { out: args.join(' ') }; }

    c_cd(args) {
      const p = this.mode === 'ps' ? parseArgs(args, 'ps', { names: ['path'], value: ['path'] }) : { pos: args, f: {} };
      if (p.err) return { err: 'Set-Location : ' + p.err };
      const target = p.f.path || p.pos[0];
      const parts = target === undefined ? HOME.slice() : this.resolve(target);
      const n = this.nodeAt(parts);
      if (!n) return { err: this.nofile('cd', target, parts) };
      if (n.t !== 'd') return { err: this.mode === 'ps' ? `Set-Location : Cannot find path '${this.dispPath(parts)}' because it is not a directory.` : `bash: cd: ${target}: Not a directory` };
      this.cwd = parts;
      return { out: '' };
    }

    c_ls(args) {
      const p = parseArgs(args, this.mode, { names: ['recurse', 'force', 'filter', 'path', 'name'], value: ['filter', 'path'] });
      if (p.err) return { err: 'Get-ChildItem : ' + p.err };
      const ps = this.mode === 'ps';
      if (ps && p.f.recurse) return this.c_find(args, null, true);
      let targets = p.f.path ? [p.f.path] : p.pos.length ? p.pos.flatMap((a) => this.expand(a)) : ['.'];
      const showHidden = ps ? !!p.f.force : !!p.f.a;
      const out = [], errs = [];
      const filt = ps && p.f.filter ? globRe(p.f.filter, true) : null;
      targets.forEach((a, i) => {
        const parts = this.resolve(a);
        const n = this.nodeAt(parts);
        if (!n) { errs.push(this.nofile('ls', a, parts)); return; }
        let items = n.t === 'd' ? Object.keys(n.c).sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())).map((k) => [k, n.c[k]]) : [[a, n]];
        if (n.t === 'd' && !showHidden) items = items.filter(([k]) => !k.startsWith('.'));
        if (filt) items = items.filter(([k]) => filt.test(k));
        if (n.t === 'd' && !ps && p.f.a) items = [['.', n], ['..', n]].concat(items);
        if (ps) { out.push(this.psTable(n.t === 'd' ? parts : parts.slice(0, -1), items)); return; }
        if (targets.length > 1) out.push((i ? '\n' : '') + a + ':');
        if (p.f.l) for (const [k, c] of items) out.push(`${c.t === 'd' ? 'drwxr-xr-x' : '-rw-r--r--'} 1 player player ${String(c.t === 'f' ? c.s.length : 4096).padStart(5)} ${k}`);
        else out.push(items.map(([k]) => k).join('  '));
      });
      return { out: out.join('\n'), err: errs.join('\n') };
    }

    c_find(args, stdin, fromLs) {
      const ps = this.mode === 'ps';
      const p = parseArgs(args, this.mode, { names: ['recurse', 'force', 'filter', 'path', 'name'], value: ['filter', 'path', 'name', 'iname', 'type', 'maxdepth'], words: ['name', 'iname', 'type', 'maxdepth'] });
      if (p.err) return { err: p.err };
      const start = ps ? (p.f.path || p.pos[0] || '.') : (p.pos[0] || '.');
      const pat = ps ? p.f.filter : (p.f.name || p.f.iname);
      const ci = ps || !!p.f.iname;
      const parts = this.resolve(start);
      const n = this.nodeAt(parts);
      if (!n) return { err: ps ? this.nofile('ls', start, parts) : `find: '${start}': No such file or directory` };
      const re = pat ? globRe(pat, ci) : null;
      const res = [];
      const rel = (ps ? start.replace(/\\/g, '/') : start).replace(/\/$/, '') || '.';
      const walk = (node, name, shown, depth) => {
        const typeOk = !p.f.type || (p.f.type === 'f' && node.t === 'f') || (p.f.type === 'd' && node.t === 'd');
        if ((!re || re.test(name)) && typeOk && !(ps && depth === 0)) res.push(shown);
        if (node.t === 'd') for (const k of Object.keys(node.c).sort()) walk(node.c[k], k, (shown === '.' && !ps ? '.' : shown) + '/' + k, depth + 1);
      };
      walk(n, parts[parts.length - 1] || '/', rel, 0);
      const outp = ps ? res.map((s) => this.dispPath(this.resolve(s))) : res;
      return { canon: 'find', out: outp.join('\n') };
    }

    c_cat(args, stdin) {
      const ps = this.mode === 'ps';
      const p = parseArgs(args, this.mode, { names: ['path', 'totalcount', 'head', 'tail'], value: ['path', 'totalcount', 'head', 'tail'] });
      if (p.err) return { err: 'Get-Content : ' + p.err };
      const files = p.f.path ? [p.f.path] : p.pos.flatMap((a) => this.expand(a));
      if (!files.length) return stdin !== null && stdin !== undefined ? { out: stdin } : { out: '' };
      const out = [], errs = [];
      for (const a of files) {
        const parts = this.resolve(a), n = this.nodeAt(parts);
        if (!n) { errs.push(this.nofile('cat', a, parts)); continue; }
        if (n.t === 'd') { errs.push(ps ? `Get-Content : Access to the path '${this.dispPath(parts)}' is denied.` : `cat: ${a}: Is a directory`); continue; }
        let ls = lines(n.s);
        if (p.f.totalcount || p.f.head) ls = ls.slice(0, parseInt(p.f.totalcount || p.f.head, 10));
        if (p.f.tail) ls = ls.slice(-parseInt(p.f.tail, 10));
        out.push(...ls);
      }
      return { out: out.join('\n'), err: errs.join('\n'), canon: p.f.totalcount || p.f.head ? 'head' : 'cat' };
    }

    // create dir(s)/file(s)
    makeDir(arg, parents, cmd) {
      const parts = this.resolve(arg);
      if (!parts.length) return this.mode === 'ps' ? 'mkdir : Cannot create the root.' : `mkdir: cannot create directory '${arg}': File exists`;
      const parent = this.nodeAt(parts.slice(0, -1));
      const name = parts[parts.length - 1];
      if (this.nodeAt(parts)) return this.mode === 'ps' ? `New-Item : An item with the specified name ${this.dispPath(parts)} already exists.` : (parents ? '' : `mkdir: cannot create directory '${arg}': File exists`);
      if (!parent || parent.t !== 'd') {
        if (!parents) return this.nofile('mkdir', arg, parts);
        let n = this.fs;
        for (const s of parts) { if (!n.c[s]) n.c[s] = D(); n = n.c[s]; }
        return '';
      }
      parent.c[name] = D();
      return '';
    }

    c_mkdir(args) {
      const p = parseArgs(args, this.mode, { names: ['path', 'name', 'force'], value: ['path', 'name'] });
      if (p.err) return { err: p.err };
      const list = p.pos.concat(p.f.path ? [p.f.path] : []);
      const errs = [];
      for (const a of list) { const e = this.makeDir(a, !!p.f.p || !!p.f.force, 'mkdir'); if (e) errs.push(e); }
      if (!list.length) return { err: this.mode === 'ps' ? 'mkdir : Missing an argument for parameter Path.' : 'mkdir: missing operand' };
      if (this.mode === 'ps' && !errs.length) {
        const last = this.resolve(list[list.length - 1]);
        return { out: this.psTable(last.slice(0, -1), [[last[last.length - 1], D()]]) };
      }
      return { err: errs.join('\n') };
    }

    c_touch(args) {
      const ps = this.mode === 'ps';
      const p = parseArgs(args, this.mode, { names: ['itemtype', 'name', 'path', 'value', 'force'], value: ['itemtype', 'name', 'path', 'value'] });
      if (p.err) return { err: (ps ? 'New-Item : ' : '') + p.err };
      if (ps) {
        let target = p.f.name ? (p.f.path || p.pos[0] || '.').replace(/[\\/]$/, '') + '/' + p.f.name : (p.f.path || p.pos[0]);
        if (!target) return { err: 'New-Item : Missing an argument for parameter Path.' };
        const type = (p.f.itemtype || '').toLowerCase();
        if (!type) return { err: "New-Item : Missing -ItemType. Try: New-Item -ItemType File -Name notes.txt   or   New-Item -ItemType Directory -Name camp" };
        if (type.startsWith('d') || type === 'directory') {
          const e = this.makeDir(target, !!p.f.force, 'mkdir');
          if (e) return { err: e };
          const last = this.resolve(target);
          return { canon: 'mkdir', out: this.psTable(last.slice(0, -1), [[last[last.length - 1], D()]]) };
        }
        if (!(type.startsWith('f') || type === 'file')) return { err: `New-Item : Unsupported ItemType '${p.f.itemtype}'. Use File or Directory.` };
        const parts = this.resolve(target), parent = this.nodeAt(parts.slice(0, -1)), name = parts[parts.length - 1];
        if (!parent || parent.t !== 'd') return { err: this.nofile('touch', target, parts) };
        if (parent.c[name] && !p.f.force) return { err: `New-Item : The file '${this.dispPath(parts)}' already exists.` };
        parent.c[name] = F(p.f.value ? p.f.value + '\n' : '');
        return { out: this.psTable(parts.slice(0, -1), [[name, parent.c[name]]]) };
      }
      if (!p.pos.length) return { err: 'touch: missing file operand' };
      const errs = [];
      for (const a of p.pos) {
        const parts = this.resolve(a), parent = this.nodeAt(parts.slice(0, -1)), name = parts[parts.length - 1];
        if (!parent || parent.t !== 'd' || !name) { errs.push(this.nofile('touch', a, parts)); continue; }
        if (!parent.c[name]) parent.c[name] = F('');
      }
      return { err: errs.join('\n') };
    }

    c_set(args) { // Set-Content / Add-Content path value
      const p = parseArgs(args, 'ps', { names: ['path', 'value'], value: ['path', 'value'] });
      if (p.err) return { err: 'Set-Content : ' + p.err };
      const target = p.f.path || p.pos[0], val = p.f.value !== undefined ? p.f.value : p.pos[1];
      if (!target || val === undefined) return { err: 'Set-Content : Usage: Set-Content <path> <value>' };
      const parts = this.resolve(target), parent = this.nodeAt(parts.slice(0, -1)), name = parts[parts.length - 1];
      if (!parent || parent.t !== 'd') return { err: this.nofile('cat', target, parts).replace('Get-Content', 'Set-Content') };
      parent.c[name] = F(val + '\n');
      return { out: '' };
    }

    transfer(args, move, cmd) {
      const ps = this.mode === 'ps';
      const p = parseArgs(args, this.mode, { names: ['path', 'destination', 'recurse', 'force', 'newname'], value: ['path', 'destination', 'newname'] });
      if (p.err) return { err: p.err };
      const rename = ps && /^(rename-item|ren|rni)$/i.test(this._name || '');
      let srcs, dest;
      if (ps) {
        srcs = p.f.path ? [p.f.path] : [];
        const pos = p.pos.slice();
        if (!srcs.length && pos.length) srcs = [pos.shift()];
        dest = p.f.destination || p.f.newname || pos.shift();
        if (rename && dest) { const sp = this.resolve(srcs[0]); dest = this.dispPath(sp.slice(0, -1)) + '\\' + dest; }
        srcs = srcs.flatMap((a) => this.expand(a));
      } else {
        const all = p.pos.slice();
        dest = all.pop();
        srcs = all.flatMap((a) => this.expand(a));
        if (!srcs.length) return { err: dest === undefined ? `${cmd}: missing file operand` : `${cmd}: missing destination file operand after '${dest}'` };
      }
      if (!srcs.length || dest === undefined) return { err: ps ? `${CMDS[cmd].psName} : Missing an argument for parameter. Usage: ${CMDS[cmd].psName} <source> <destination>` : `${cmd}: missing file operand` };
      const dparts = this.resolve(dest), dnode = this.nodeAt(dparts);
      if (srcs.length > 1 && !(dnode && dnode.t === 'd')) return { err: ps ? `${CMDS[cmd].psName} : Destination must be an existing directory for multiple sources.` : `${cmd}: target '${dest}': Not a directory` };
      const errs = [];
      for (const a of srcs) {
        const sp = this.resolve(a), sn = this.nodeAt(sp);
        if (!sn) { errs.push(this.nofile(cmd, a, sp)); continue; }
        if (!sp.length) { errs.push(`${cmd}: cannot move the root`); continue; }
        if (sn.t === 'd' && !move && !(ps || p.f.r || p.f.R || p.f.recurse || p.f.a)) { errs.push(`cp: -r not specified; omitting directory '${a}'`); continue; }
        let tparts = dnode && dnode.t === 'd' ? dparts.concat([sp[sp.length - 1]]) : dparts;
        if (tparts.length >= sp.length && sp.every((s, i) => tparts[i] === s) && sn.t === 'd') { errs.push(ps ? `${CMDS[cmd].psName} : Cannot move/copy a directory into itself.` : `${cmd}: cannot ${move ? 'move' : 'copy'} '${a}' to a subdirectory of itself, '${dest}'`); continue; }
        const par = this.nodeAt(tparts.slice(0, -1)), tname = tparts[tparts.length - 1];
        if (!par || par.t !== 'd') { errs.push(this.nofile(cmd, dest, dparts)); continue; }
        const ex = par.c[tname];
        if (ex && ex.t === 'd' && sn.t === 'f') { errs.push(`${cmd}: cannot overwrite directory '${dest}' with non-directory`); continue; }
        if (move && tparts.join('/') === sp.join('/')) continue;
        par.c[tname] = ps && !move && sn.t === 'd' && !(p.f.recurse) ? D() : clone(sn);
        if (move) { const sp2 = this.nodeAt(sp.slice(0, -1)); delete sp2.c[sp[sp.length - 1]]; }
      }
      // keep cwd valid if a moved directory contained it
      while (this.cwd.length && !this.nodeAt(this.cwd)) this.cwd.pop();
      return { err: errs.join('\n') };
    }

    c_cp(args) { return this.transfer(args, false, 'cp'); }
    c_mv(args) { return this.transfer(args, true, 'mv'); }

    c_rm(args) {
      const ps = this.mode === 'ps';
      const p = parseArgs(args, this.mode, { names: ['recurse', 'force', 'path'], value: ['path'] });
      if (p.err) return { err: 'Remove-Item : ' + p.err };
      const list = (p.f.path ? [p.f.path] : []).concat(p.pos.flatMap((a) => this.expand(a)));
      if (!list.length) return { err: ps ? 'Remove-Item : Missing an argument for parameter Path.' : 'rm: missing operand' };
      const rec = ps ? !!p.f.recurse : !!(p.f.r || p.f.R || p.f.recursive);
      const force = ps ? !!p.f.force : !!p.f.f;
      const errs = [];
      for (const a of list) {
        const parts = this.resolve(a), n = this.nodeAt(parts);
        if (!n) { if (!force || ps) errs.push(this.nofile('rm', a, parts)); continue; }
        if (!parts.length || (parts.length <= this.cwd.length && parts.every((s, i) => this.cwd[i] === s))) { errs.push(ps ? `Remove-Item : Cannot remove ${this.dispPath(parts)}: it is your current location or a parent of it. cd out first.` : `rm: refusing to remove '${a}': it is your current directory or a parent of it`); continue; }
        if (n.t === 'd' && !rec) {
          if (ps) { if (Object.keys(n.c).length) { errs.push(`Remove-Item : The item at ${this.dispPath(parts)} has children and the Recurse parameter was not specified.`); continue; } } else { errs.push(`rm: cannot remove '${a}': Is a directory`); continue; }
        }
        delete this.nodeAt(parts.slice(0, -1)).c[parts[parts.length - 1]];
      }
      return { err: errs.join('\n') };
    }

    // ---- text tools ----
    c_grep(args, stdin) {
      const ps = this.mode === 'ps';
      const p = parseArgs(args, this.mode, { names: ['pattern', 'path', 'casesensitive', 'simplematch'], value: ['pattern', 'path'] });
      if (p.err) return { err: 'Select-String : ' + p.err };
      const pos = p.pos.slice();
      const pat = ps ? (p.f.pattern !== undefined ? p.f.pattern : pos.shift()) : pos.shift();
      if (pat === undefined) return { err: ps ? 'Select-String : Missing -Pattern.' : 'Usage: grep [OPTION]... PATTERNS [FILE]...' };
      const files = (p.f.path ? [p.f.path] : pos).flatMap((a) => this.expand(a));
      const ci = ps ? !p.f.casesensitive : !!p.f.i;
      let re;
      try { re = new RegExp(p.f.simplematch ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pat, ci ? 'i' : ''); } catch (e) { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci ? 'i' : ''); }
      const inv = !!p.f.v;
      const out = [], errs = [];
      const scan = (text, label) => {
        let c = 0;
        lines(text).forEach((ln, i) => {
          if (re.test(ln) === inv) return;
          c++;
          if (p.f.c) return;
          out.push((label ? label + ':' : '') + (p.f.n || ps ? (i + 1) + ':' : '') + ln);
        });
        if (p.f.c) out.push((label ? label + ':' : '') + c);
      };
      const walkDir = (n, shown) => { for (const k of Object.keys(n.c).sort()) { const c = n.c[k]; if (c.t === 'd') walkDir(c, shown + '/' + k); else scan(c.s, shown + '/' + k); } };
      if (!files.length) {
        if (stdin === null || stdin === undefined) return { err: ps ? 'Select-String : Provide -Path or pipe text in.' : '' };
        const saved = ps ? null : null; // piped lines carry no file label
        scan(stdin, saved);
        if (ps && !p.f.c) { /* PowerShell prints just the line for piped strings */ const clean = out.map((s) => s.replace(/^\d+:/, '')); return { out: clean.join('\n') }; }
        return { out: out.join('\n') };
      }
      for (const a of files) {
        const parts = this.resolve(a), n = this.nodeAt(parts);
        if (!n) { errs.push(ps ? this.nofile('cat', a, parts).replace('Get-Content', 'Select-String') : `grep: ${a}: No such file or directory`); continue; }
        if (n.t === 'd') { if (p.f.r) walkDir(n, a.replace(/\/$/, '')); else errs.push(`grep: ${a}: Is a directory`); continue; }
        scan(n.s, files.length > 1 || p.f.r || ps ? a : '');
      }
      return { out: out.join('\n'), err: errs.join('\n') };
    }

    c_head(args, stdin, tail) {
      const ps = this.mode === 'ps';
      const p = parseArgs(args, this.mode, { names: ['first', 'last', 'skip'], value: ['n', 'first', 'last', 'skip'], num: true });
      if (p.err) return { err: p.err };
      if (ps && stdin !== null && stdin !== undefined && !p.f.first && !p.f.last) return { err: 'Select-Object : Try: Select-Object -First 2   (or -Last 2)' };
      if (ps && (p.f.last && !p.f.first)) tail = true;
      const n = parseInt(ps ? (p.f.first || p.f.last || 10) : (p.f.n || 10), 10);
      const files = p.pos.flatMap((a) => this.expand(a));
      let text = stdin;
      if (files.length) {
        const parts = this.resolve(files[0]), nd = this.nodeAt(parts);
        if (!nd) return { err: this.nofile(tail ? 'tail' : 'head', files[0], parts).replace(/^(head|tail): /, (m) => m) };
        if (nd.t === 'd') return { err: `${tail ? 'tail' : 'head'}: error reading '${files[0]}': Is a directory` };
        text = nd.s;
      }
      if (text === null || text === undefined) return { err: ps ? 'Select-String : pipe some text in first, e.g. Get-Content file.txt | Select-Object -First 3' : '' };
      const ls = lines(text);
      return { canon: tail ? 'tail' : 'head', out: (tail ? ls.slice(-n) : ls.slice(0, n)).join('\n') };
    }

    c_tail(args, stdin) { return this.c_head(args, stdin, true); }

    c_wc(args, stdin) {
      const ps = this.mode === 'ps';
      const p = parseArgs(args, this.mode, { names: ['line', 'word', 'character'] });
      if (p.err) return { err: p.err };
      let text = stdin, label = '';
      if (!ps && p.pos.length) {
        const parts = this.resolve(p.pos[0]), nd = this.nodeAt(parts);
        if (!nd) return { err: `wc: ${p.pos[0]}: No such file or directory` };
        if (nd.t === 'd') return { err: `wc: ${p.pos[0]}: Is a directory` };
        text = nd.s; label = ' ' + p.pos[0];
      }
      if (text === null || text === undefined) return { err: ps ? 'Measure-Object : pipe some text in first, e.g. Get-Content file.txt | Measure-Object' : '' };
      const L = lines(text).length, W = text.split(/\s+/).filter(Boolean).length, B = text.length;
      if (ps) return { out: `\nCount    : ${L}\nAverage  :\nSum      :\nMaximum  :\nMinimum  :\nProperty :\n` };
      if (p.f.l) return { out: L + label };
      if (p.f.w) return { out: W + label };
      if (p.f.c) return { out: B + label };
      return { out: `${L} ${W} ${B}${label}` };
    }

    c_sort(args, stdin) {
      const ps = this.mode === 'ps';
      const p = parseArgs(args, this.mode, { names: ['descending'] });
      if (p.err) return { err: p.err };
      let text = stdin;
      if (p.pos.length && !ps) {
        const nd = this.nodeAt(this.resolve(p.pos[0]));
        if (!nd || nd.t !== 'f') return { err: `sort: cannot read: ${p.pos[0]}: No such file or directory` };
        text = nd.s;
      }
      if (text === null || text === undefined) return { err: 'sort: pipe some text in first' };
      const ls = lines(text).sort((a, b) => (ps ? a.toLowerCase().localeCompare(b.toLowerCase()) : a < b ? -1 : a > b ? 1 : 0));
      if (p.f.r || p.f.descending) ls.reverse();
      return { out: ls.join('\n') };
    }
  }

  // PowerShell aliases that share one implementation: remember which name was typed (Rename-Item needs it).
  const baseExec = Game.prototype.exec;
  Game.prototype.exec = function (name, args, stdin) { this._name = name; return baseExec.call(this, name, args, stdin); };

  // ---- levels. check(game, last) runs after every command; solve = reference solution per mode (used by tests and resume). ----
  const inQuest = (g) => g.cwd.join('/') === 'home/player/quest';
  const LEVELS = [
    { title: 'Where am I?', story: 'You wake up in a dark corridor. First, find out where you are standing.',
      task: { linux: 'Print your working directory.', ps: 'Print your current location.' },
      hint: { linux: 'Type: pwd   (print working directory)', ps: 'Type: Get-Location   (the short alias pwd works too)' },
      solve: { linux: ['pwd'], ps: ['Get-Location'] }, check: (g, l) => l.ok && l.canon[0] === 'pwd' },
    { title: 'Look around', story: 'A torch flickers. List what is in the room.',
      task: { linux: 'List the files and folders here.', ps: 'List the files and folders here.' },
      hint: { linux: 'Type: ls   (add -l for a long listing, -a to include hidden files)', ps: 'Type: Get-ChildItem   (aliases: ls, dir, gci)' },
      solve: { linux: ['ls'], ps: ['Get-ChildItem'] }, check: (g, l) => l.ok && l.canon[0] === 'ls' },
    { title: 'Enter the quest', story: 'One folder looks interesting: quest. Walk into it.',
      task: { linux: 'Change directory into quest.', ps: 'Change location into quest.' },
      hint: { linux: 'Type: cd quest   (cd .. goes back up, cd on its own goes home)', ps: 'Type: Set-Location quest   (alias: cd quest)' },
      solve: { linux: ['cd quest'], ps: ['Set-Location quest'] }, check: (g, l) => l.ok && inQuest(g) },
    { title: 'Read the note', story: 'A note is pinned to the wall. Read readme.txt.',
      task: { linux: 'Print the contents of readme.txt.', ps: 'Print the contents of readme.txt.' },
      hint: { linux: 'Type: cat readme.txt', ps: 'Type: Get-Content readme.txt   (aliases: cat, gc, type)' },
      solve: { linux: ['cat readme.txt'], ps: ['Get-Content readme.txt'] }, check: (g, l) => l.ok && l.canon.includes('cat') && /adventurer/.test(l.out) },
    { title: 'Make camp', story: 'Night falls. Create a directory called camp inside quest.',
      task: { linux: 'Create a directory named camp here.', ps: 'Create a directory named camp here.' },
      hint: { linux: 'Type: mkdir camp', ps: 'Type: New-Item -ItemType Directory -Name camp   (or just mkdir camp)' },
      solve: { linux: ['mkdir camp'], ps: ['New-Item -ItemType Directory -Name camp'] }, check: (g) => { const n = g.nodeAt([...HOME, 'quest', 'camp']); return !!n && n.t === 'd'; } },
    { title: 'Light the torch', story: 'Write the word lit into a new file camp/torch.txt. In both shells, > sends output into a file.',
      task: { linux: 'Make camp/torch.txt contain the word lit.', ps: 'Make camp\\torch.txt contain the word lit.' },
      hint: { linux: 'Type: echo lit > camp/torch.txt', ps: 'Type: echo lit > camp\\torch.txt   (or Set-Content camp\\torch.txt lit)' },
      solve: { linux: ['echo lit > camp/torch.txt'], ps: ['echo lit > camp\\torch.txt'] }, check: (g) => { const n = g.nodeAt([...HOME, 'quest', 'camp', 'torch.txt']); return !!n && n.t === 'f' && /\blit\b/.test(n.s); } },
    { title: 'Copy the map', story: 'Take a copy of map.txt into camp. Keep the original too.',
      task: { linux: 'Copy map.txt into camp.', ps: 'Copy map.txt into camp.' },
      hint: { linux: 'Type: cp map.txt camp', ps: 'Type: Copy-Item map.txt camp   (aliases: cp, copy)' },
      solve: { linux: ['cp map.txt camp'], ps: ['Copy-Item map.txt camp'] }, check: (g) => !!g.nodeAt([...HOME, 'quest', 'camp', 'map.txt']) && !!g.nodeAt([...HOME, 'quest', 'map.txt']) },
    { title: 'Stash the treasure', story: 'treasure.tmp is gold! Move it into camp and rename it treasure.txt in the same step.',
      task: { linux: 'Move treasure.tmp to camp/treasure.txt.', ps: 'Move treasure.tmp to camp\\treasure.txt.' },
      hint: { linux: 'Type: mv treasure.tmp camp/treasure.txt', ps: 'Type: Move-Item treasure.tmp camp\\treasure.txt   (aliases: mv, move)' },
      solve: { linux: ['mv treasure.tmp camp/treasure.txt'], ps: ['Move-Item treasure.tmp camp\\treasure.txt'] }, check: (g) => !!g.nodeAt([...HOME, 'quest', 'camp', 'treasure.txt']) && !g.nodeAt([...HOME, 'quest', 'treasure.tmp']) },
    { title: 'Find the key', story: 'The server log holds a secret line containing KEY. Search logs/server.log for it.',
      task: { linux: 'Show only the lines of logs/server.log that contain KEY.', ps: 'Show only the lines of logs\\server.log that contain KEY.' },
      hint: { linux: 'Type: grep KEY logs/server.log', ps: 'Type: Select-String KEY logs\\server.log   (alias: sls)' },
      solve: { linux: ['grep KEY logs/server.log'], ps: ['Select-String KEY logs\\server.log'] }, check: (g, l) => l.ok && l.canon.includes('grep') && /KEY=quest-7731/.test(l.out) },
    { title: 'Hunt the logs', story: 'Logs are hiding in subfolders too. List every file ending in .log below here.',
      task: { linux: 'Find every *.log file under the current directory.', ps: 'Find every *.log file under the current directory.' },
      hint: { linux: 'Type: find . -name "*.log"', ps: 'Type: Get-ChildItem -Recurse -Filter *.log' },
      solve: { linux: ['find . -name "*.log"'], ps: ['Get-ChildItem -Recurse -Filter *.log'] }, check: (g, l) => l.ok && l.canon.includes('find') && /archive\.log/.test(l.out) && /app\.log/.test(l.out) && /server\.log/.test(l.out) },
    { title: 'Take out the trash', story: 'The trash folder is full of junk, with a folder inside it. Remove the whole thing.',
      task: { linux: 'Delete the trash folder and everything in it.', ps: 'Delete the trash folder and everything in it.' },
      hint: { linux: 'Type: rm -r trash   (-r = recursive; be careful, there is no recycle bin)', ps: 'Type: Remove-Item -Recurse trash   (aliases: rm, del)' },
      solve: { linux: ['rm -r trash'], ps: ['Remove-Item -Recurse trash'] }, check: (g) => !g.nodeAt([...HOME, 'quest', 'trash']) },
    { title: 'Count the dragons', story: 'Final test: how many ERROR lines are in logs/app.log? Chain two commands with a pipe, |, so the output of one feeds the next.',
      task: { linux: 'Print the number of ERROR lines in logs/app.log using one pipeline.', ps: 'Count the ERROR lines in logs\\app.log using one pipeline.' },
      hint: { linux: 'Type: grep ERROR logs/app.log | wc -l', ps: 'Type: Select-String ERROR logs\\app.log | Measure-Object' },
      solve: { linux: ['grep ERROR logs/app.log | wc -l'], ps: ['Select-String ERROR logs\\app.log | Measure-Object'] }, check: (g, l) => l.ok && l.pipe && l.canon.includes('grep') && l.canon.includes('wc') && /(^|\D)3(\D|$)/.test(l.out) },
  ];

  const API = { Game, LEVELS, CMDS, tokenize, initialFS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.TQ = API;
})(typeof window !== 'undefined' ? window : globalThis);
