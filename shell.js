/* Terminal Quest - simulated shell: virtual filesystem, command parser, executor.
 * Plain JS, no dependencies, no network. Works in a browser (window.TQ.shell) and in Node (require).
 * Two dialects: "linux" (a bash-like subset) and "powershell" (a PowerShell-like subset). Both parse into the same
 * canonical stage object { cmd, flags, args, pattern, count } so a command can be shown in the other dialect (render). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.TQ = root.TQ || {}; root.TQ.shell = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var HOME = '/home/player';
  var CMDS = ['ls', 'cd', 'pwd', 'cat', 'grep', 'mkdir', 'touch', 'cp', 'mv', 'rm', 'echo', 'head'];

  /* ---------- virtual filesystem ---------- */
  function build(spec) {
    var d = { type: 'dir', children: {} };
    Object.keys(spec || {}).forEach(function (k) {
      var v = spec[k];
      d.children[k] = typeof v === 'string' ? { type: 'file', content: v } : build(v);
    });
    return d;
  }
  function cloneNode(n, shallow) {
    if (n.type === 'file') return { type: 'file', content: n.content };
    var c = { type: 'dir', children: {} };
    if (!shallow) Object.keys(n.children).forEach(function (k) { c.children[k] = cloneNode(n.children[k]); });
    return c;
  }
  function VFS(spec) { this.root = build(spec); }
  VFS.prototype.normalize = function (cwd, p) {
    p = String(p);
    if (p === '~' || p.indexOf('~/') === 0) p = HOME + p.slice(1);
    var parts = (p.charAt(0) === '/' ? p : cwd + '/' + p).split('/'), out = [];
    parts.forEach(function (s) {
      if (s === '' || s === '.') return;
      if (s === '..') out.pop(); else out.push(s);
    });
    return '/' + out.join('/');
  };
  VFS.prototype.node = function (abs) {
    var n = this.root;
    var parts = abs.split('/').filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      if (n.type !== 'dir' || !Object.prototype.hasOwnProperty.call(n.children, parts[i])) return null;
      n = n.children[parts[i]];
    }
    return n;
  };
  VFS.prototype.exists = function (abs) { return !!this.node(abs); };
  VFS.prototype.isDir = function (abs) { var n = this.node(abs); return !!n && n.type === 'dir'; };
  VFS.prototype.isFile = function (abs) { var n = this.node(abs); return !!n && n.type === 'file'; };
  VFS.prototype.read = function (abs) { var n = this.node(abs); return n && n.type === 'file' ? n.content : null; };
  VFS.prototype.list = function (abs) {
    var n = this.node(abs);
    return n && n.type === 'dir' ? Object.keys(n.children).sort(cmpName) : [];
  };
  function split(abs) { var i = abs.lastIndexOf('/'); return [i <= 0 ? '/' : abs.slice(0, i), abs.slice(i + 1)]; }
  function cmpName(a, b) { var x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0; }
  VFS.prototype.put = function (abs, node) {
    var s = split(abs), p = this.node(s[0]);
    if (!p || p.type !== 'dir' || !s[1]) throw fsErr('ENOENT', abs);
    p.children[s[1]] = node;
  };
  VFS.prototype.writeFile = function (abs, content, append) {
    var n = this.node(abs);
    if (n && n.type === 'dir') throw fsErr('EISDIR', abs);
    if (n) { n.content = append ? n.content + content : content; return; }
    this.put(abs, { type: 'file', content: content });
  };
  VFS.prototype.mkdir = function (abs, parents) {
    var parts = abs.split('/').filter(Boolean), n = this.root, cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur += '/' + parts[i];
      var c = Object.prototype.hasOwnProperty.call(n.children, parts[i]) ? n.children[parts[i]] : null;
      if (!c) {
        if (i < parts.length - 1 && !parents) throw fsErr('ENOENT', abs);
        c = n.children[parts[i]] = { type: 'dir', children: {} };
      } else if (c.type !== 'dir') throw fsErr('ENOTDIR', cur);
      else if (i === parts.length - 1 && !parents) throw fsErr('EEXIST', abs);
      n = c;
    }
  };
  VFS.prototype.remove = function (abs) {
    var s = split(abs), p = this.node(s[0]);
    if (!p || !s[1] || !p.children[s[1]]) throw fsErr('ENOENT', abs);
    delete p.children[s[1]];
  };
  VFS.prototype.copyNode = function (src, dst, shallow) { this.put(dst, cloneNode(this.node(src), shallow)); };
  VFS.prototype.moveNode = function (src, dst) { var n = this.node(src); this.remove(src); this.put(dst, n); };
  VFS.prototype.snapshot = function () { return JSON.stringify(this.root); };
  function fsErr(code, path) { var e = new Error(code + ' ' + path); e.code = code; e.path = path; return e; }

  /* ---------- tokenizer ---------- */
  function tokenize(line) {
    var toks = [], i = 0, n = line.length;
    while (i < n) {
      var ch = line.charAt(i);
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '|') { toks.push({ op: '|' }); i++; continue; }
      if (ch === '>') {
        if (line.charAt(i + 1) === '>') { toks.push({ op: '>>' }); i += 2; } else { toks.push({ op: '>' }); i++; }
        continue;
      }
      var v = '', quoted = false;
      while (i < n) {
        ch = line.charAt(i);
        if (ch === ' ' || ch === '\t' || ch === '|' || ch === '>') break;
        if (ch === '"' || ch === "'") {
          var j = line.indexOf(ch, i + 1);
          if (j < 0) throw synErr('unterminated quote');
          v += line.slice(i + 1, j); quoted = true; i = j + 1;
        } else { v += ch; i++; }
      }
      toks.push({ v: v, quoted: quoted });
    }
    return toks;
  }
  function synErr(msg) { var e = new Error(msg); e.syntax = true; return e; }

  /* ---------- parsing ---------- */
  // Linux: flags per command -> canonical flag name
  var LX = {
    ls: { a: 'all' }, cd: {}, pwd: {}, cat: {}, grep: { i: 'ignoreCase', n: 'lineNumbers' }, mkdir: { p: 'parents' },
    touch: {}, cp: { r: 'recursive', R: 'recursive' }, mv: {}, rm: { r: 'recursive', R: 'recursive', f: 'force' }, echo: {}, head: {}
  };
  function parseLinux(words) {
    var name = words[0].v;
    if (CMDS.indexOf(name) < 0) throw cmdErr('linux', name);
    var st = { cmd: name, flags: {}, args: [], quoted: [] }, i = 1, endFlags = false;
    for (; i < words.length; i++) {
      var w = words[i], v = w.v;
      if (!endFlags && !w.quoted && v === '--') { endFlags = true; continue; }
      if (!endFlags && !w.quoted && /^-[A-Za-z]/.test(v)) {
        if (name === 'head' && /^-n/.test(v)) {
          var num = v.length > 2 ? v.slice(2) : (words[++i] || {}).v;
          if (!/^\d+$/.test(String(num))) throw usage('head: invalid number of lines: ' + (num === undefined ? '' : "'" + num + "'"));
          st.count = parseInt(num, 10); continue;
        }
        for (var k = 1; k < v.length; k++) {
          var f = LX[name][v.charAt(k)];
          if (!f) throw usage(name + ": option '-" + v.charAt(k) + "' is not supported in this game");
          st.flags[f] = true;
        }
        continue;
      }
      if (name === 'head' && !endFlags && !w.quoted && /^-\d+$/.test(v)) { st.count = parseInt(v.slice(1), 10); continue; }
      st.args.push(v); st.quoted.push(!!w.quoted);
    }
    if (name === 'grep') {
      if (!st.args.length) throw usage('Usage: grep [-i] [-n] PATTERN [FILE...]');
      st.pattern = st.args.shift(); st.quoted.shift();
    }
    if (name === 'head' && st.count === undefined) st.count = 10;
    if (name === 'echo') st.args = [st.args.join(' ')];
    return st;
  }

  // PowerShell: command names and aliases (lower-case) -> { cmd, name }
  var PSN = {};
  function alias(names, cmd) { names.forEach(function (n) { PSN[n.toLowerCase()] = cmd; }); }
  alias(['Get-ChildItem', 'gci', 'ls', 'dir'], 'ls');
  alias(['Set-Location', 'sl', 'cd', 'chdir'], 'cd');
  alias(['Get-Location', 'gl', 'pwd'], 'pwd');
  alias(['Get-Content', 'gc', 'cat', 'type'], 'cat');
  alias(['Select-String', 'sls'], 'grep');
  alias(['mkdir', 'md'], 'mkdir');
  alias(['New-Item', 'ni'], 'newitem');
  alias(['Copy-Item', 'cpi', 'cp', 'copy'], 'cp');
  alias(['Move-Item', 'mi', 'mv', 'move'], 'mv');
  alias(['Remove-Item', 'ri', 'rm', 'del', 'erase', 'rmdir', 'rd'], 'rm');
  alias(['Write-Output', 'Write-Host', 'echo', 'write'], 'echo');
  alias(['Select-Object', 'select'], 'select');
  // parameters per PS command: name -> [canonical, takesValue]
  var PP = {
    ls: { path: ['path', 1], force: ['force', 0] }, cd: { path: ['path', 1] }, pwd: {},
    cat: { path: ['path', 1], totalcount: ['count', 1], first: ['count', 1], head: ['count', 1] },
    grep: { pattern: ['pattern', 1], path: ['path', 1], casesensitive: ['caseSensitive', 0] },
    mkdir: { path: ['path', 1], force: ['force', 0] },
    newitem: { path: ['path', 1], name: ['name', 1], itemtype: ['itemtype', 1], force: ['force', 0] },
    cp: { path: ['path', 1], destination: ['dest', 1], recurse: ['recursive', 0] },
    mv: { path: ['path', 1], destination: ['dest', 1] },
    rm: { path: ['path', 1], recurse: ['recursive', 0], force: ['force', 0] },
    echo: {}, select: { first: ['count', 1] }
  };
  function commas(w) { return w.quoted ? [w.v] : w.v.split(',').filter(function (x) { return x !== ''; }); }
  function parsePS(words) {
    var key = words[0].v.toLowerCase(), c = PSN[key];
    if (!c) throw cmdErr('powershell', words[0].v);
    var disp = words[0].v;
    var defs = PP[c], got = { path: [], pos: [], flags: {} }, i = 1, st;
    for (; i < words.length; i++) {
      var w = words[i], v = w.v;
      if (c !== 'echo' && !w.quoted && /^-[A-Za-z]/.test(v)) {
        var pn = v.slice(1).toLowerCase(), cands = Object.keys(defs).filter(function (d) { return d === pn; });
        if (!cands.length) cands = Object.keys(defs).filter(function (d) { return d.indexOf(pn) === 0; });
        if (cands.length !== 1) throw usage(disp + ": A parameter cannot be found that matches parameter name '" + v.slice(1) + "'.");
        var def = defs[cands[0]];
        if (def[1]) {
          var val = words[++i];
          if (!val) throw usage(disp + ": Missing an argument for parameter '" + v.slice(1) + "'.");
          if (def[0] === 'path') got.path = got.path.concat(commas(val));
          else got[def[0]] = val.v;
          if (def[0] === 'path') got.pathQuoted = true;
        } else got.flags[def[0]] = true;
        continue;
      }
      got.pos.push(w);
    }
    var pos = got.pos;
    st = { cmd: c, flags: got.flags, args: [], quoted: [] };
    if (c === 'echo') { st.args = [pos.map(function (w) { return w.v; }).join(' ')]; return st; }
    if (c === 'select') {
      if (got.count === undefined) throw usage('Select-Object: this game supports only: Select-Object -First N');
      st.cmd = 'head'; st.count = toCount(got.count, disp); st.args = []; return st;
    }
    if (c === 'grep') {
      var pat = got.pattern !== undefined ? got.pattern : (pos.length ? pos.shift().v : undefined);
      if (pat === undefined) throw usage('Select-String: Cannot bind argument: -Pattern is required.');
      st.pattern = pat;
      if (!got.flags.caseSensitive) st.flags.ignoreCase = true;
    }
    var paths = got.path.slice();
    pos.forEach(function (w) { commas(w).forEach(function (x) { paths.push(x); }); });
    if (c === 'cp' || c === 'mv') {
      if (got.dest !== undefined) paths.push(got.dest);
      else if (paths.length < 2) throw usage(disp + ': Cannot bind argument: -Destination is required.');
    }
    if (c === 'newitem') {
      var it = (got.itemtype || '').toLowerCase();
      if (it !== 'directory' && it !== 'file') throw usage("New-Item: this game supports -ItemType Directory and -ItemType File.");
      st.cmd = it === 'directory' ? 'mkdir' : 'touch';
      if (got.name !== undefined) paths = (paths.length ? paths : ['.']).map(function (p) { return p.replace(/\/+$/, '') + '/' + got.name; });
      if (!paths.length) throw usage('New-Item: Cannot bind argument: -Path is required.');
    }
    if (st.cmd === 'mkdir') st.flags.parents = true;
    if (c === 'cat' && got.count !== undefined) { st.cmd = 'head'; st.count = toCount(got.count, disp); }
    st.args = paths.map(function (p) { return p.replace(/\\/g, '/'); });
    if (c === 'cat' && !st.args.length) throw usage('Get-Content: Cannot bind argument: -Path is required.');
    if (c === 'echo' || c === 'pwd') st.args = [];
    return st;
  }
  function toCount(s, disp) { if (!/^\d+$/.test(String(s))) throw usage(disp + ": Cannot convert '" + s + "' to a number of lines."); return parseInt(s, 10); }
  function usage(msg) { var e = new Error(msg); e.usage = true; return e; }
  function cmdErr(dialect, name) {
    var e = new Error(dialect === 'linux' ? 'bash: ' + name + ': command not found'
      : "The term '" + name + "' is not recognized as a name of a cmdlet, function, script file, or executable program.");
    e.usage = true; e.notFound = true; return e;
  }

  /* parse a full line -> { stages:[...], redirect:{mode,target}|null } ; throws Error with .usage / .syntax */
  function parse(line, dialect) {
    var toks = tokenize(line), stages = [], cur = [], redirect = null;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.op === '|') {
        if (!cur.length) throw synErr('empty command in pipeline');
        stages.push(cur); cur = [];
      } else if (t.op === '>' || t.op === '>>') {
        var tg = toks[i + 1];
        if (!tg || tg.op) throw synErr('missing file name after ' + t.op);
        if (i + 2 < toks.length) throw synErr('only one redirect, at the end of the line, is supported');
        redirect = { mode: t.op, target: tg.v }; break;
      } else cur.push(t);
    }
    if (!cur.length) throw synErr(stages.length || redirect ? 'empty command' : 'empty');
    stages.push(cur);
    return {
      stages: stages.map(function (ws) { return dialect === 'powershell' ? parsePS(ws) : parseLinux(ws); }),
      redirect: redirect && { mode: redirect.mode, target: dialect === 'powershell' ? redirect.target.replace(/\\/g, '/') : redirect.target }
    };
  }

  /* ---------- render a canonical pipeline in a dialect ---------- */
  function q(s) {
    if (s !== '' && /^[\w.\/~@%+=:,*?^$\-\[\]]*$/.test(s)) return s;
    return s.indexOf('"') < 0 ? '"' + s + '"' : "'" + s + "'";
  }
  function renderStage(st, dialect, idx) {
    var a = st.args, f = st.flags, L = dialect === 'linux', piped = idx > 0;
    switch (st.cmd) {
      case 'ls': return L ? j(['ls', f.all && '-a'].concat(a.map(q))) : j(['Get-ChildItem', f.force || f.all ? '-Force' : '', a.length ? '-Path ' + a.map(q).join(',') : '']);
      case 'cd': return L ? j(['cd'].concat(a.map(q))) : j(['Set-Location'].concat(a.map(q)));
      case 'pwd': return L ? 'pwd' : 'Get-Location';
      case 'cat': return L ? j(['cat'].concat(a.map(q))) : 'Get-Content -Path ' + a.map(q).join(',');
      case 'grep':
        if (L) return j(['grep', f.ignoreCase && '-i', f.lineNumbers && '-n', q(st.pattern)].concat(a.map(q)));
        return j(['Select-String -Pattern', q(st.pattern), a.length ? '-Path ' + a.map(q).join(',') : '', f.ignoreCase ? '' : '-CaseSensitive']);
      case 'mkdir': return L ? j(['mkdir', f.parents && '-p'].concat(a.map(q))) : 'New-Item -ItemType Directory -Path ' + a.map(q).join(',') + (f.parents && !f.noForce ? ' -Force' : '');
      case 'touch': return L ? j(['touch'].concat(a.map(q))) : 'New-Item -ItemType File -Path ' + a.map(q).join(',');
      case 'cp': return L ? j(['cp', f.recursive && '-r'].concat(a.map(q))) : 'Copy-Item -Path ' + a.slice(0, -1).map(q).join(',') + ' -Destination ' + q(a[a.length - 1]) + (f.recursive ? ' -Recurse' : '');
      case 'mv': return L ? j(['mv'].concat(a.map(q))) : 'Move-Item -Path ' + a.slice(0, -1).map(q).join(',') + ' -Destination ' + q(a[a.length - 1]);
      case 'rm': return L ? j(['rm', f.recursive && '-r', f.force && '-f'].concat(a.map(q))) : j(['Remove-Item -Path', a.map(q).join(','), f.recursive && '-Recurse', f.force && '-Force']);
      case 'echo': return L ? j(['echo'].concat(a.map(q))) : j(['Write-Output', a.length ? q(a.join(' ')) : '""']);
      case 'head':
        if (L) return j(['head', '-n', String(st.count)].concat(a.map(q)));
        return piped || !a.length ? 'Select-Object -First ' + st.count : 'Get-Content -Path ' + a.map(q).join(',') + ' -TotalCount ' + st.count;
    }
    return st.cmd;
  }
  function j(parts) { return parts.filter(function (x) { return x; }).join(' '); }
  function render(parsed, dialect) {
    var s = parsed.stages.map(function (st, i) { return renderStage(st, dialect, i); }).join(' | ');
    if (parsed.redirect) s += ' ' + parsed.redirect.mode + ' ' + q(parsed.redirect.target);
    return s;
  }

  /* ---------- execution ---------- */
  function toLines(c) { if (c === '') return []; return (c.slice(-1) === '\n' ? c.slice(0, -1) : c).split('\n'); }
  function glob(fs, cwd, arg, quoted) {
    if (quoted || !/[*?]/.test(arg)) return [arg];
    var abs = fs.normalize(cwd, arg), s = split(abs);
    if (/[*?]/.test(s[0])) return [arg];
    var rx = new RegExp('^' + s[1].replace(/[.+^${}()|\\\[\]]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    var hits = fs.list(s[0]).filter(function (n) { return rx.test(n) && (n.charAt(0) !== '.' || s[1].charAt(0) === '.'); });
    if (!hits.length) return [arg];
    var dirPart = arg.indexOf('/') >= 0 ? arg.slice(0, arg.lastIndexOf('/') + 1) : '';
    return hits.map(function (n) { return dirPart + n; });
  }
  // error text per dialect for a filesystem error
  function fmtFsErr(dialect, cmdName, shown, abs, code, extra) {
    var L = dialect === 'linux';
    var lx = { ENOENT: 'No such file or directory', EEXIST: 'File exists', ENOTDIR: 'Not a directory', EISDIR: 'Is a directory' };
    if (L) return cmdName + ': ' + (extra || '') + "'" + shown + "': " + lx[code];
    var ps = {
      ENOENT: "Cannot find path '" + abs + "' because it does not exist.",
      EEXIST: 'An item with the specified name ' + abs + ' already exists.',
      ENOTDIR: "Cannot find a part of the path '" + abs + "' because it is not a directory.",
      EISDIR: "Access to the path '" + abs + "' is denied (it is a directory)."
    };
    return cmdName + ': ' + ps[code];
  }
  var PSNAME = { ls: 'Get-ChildItem', cd: 'Set-Location', pwd: 'Get-Location', cat: 'Get-Content', grep: 'Select-String', mkdir: 'New-Item', touch: 'New-Item', cp: 'Copy-Item', mv: 'Move-Item', rm: 'Remove-Item', echo: 'Write-Output', head: 'Get-Content' };

  function execStage(state, st, dialect, input) {
    var fs = state.fs, cwd = state.cwd, L = dialect === 'linux', name = L ? st.cmd : PSNAME[st.cmd];
    var out = { lines: [], hits: null }, errs = [];
    var abs = function (p) { return fs.normalize(cwd, p); };
    var files = function () {
      var r = [];
      st.args.forEach(function (a, i) { glob(fs, cwd, a, st.quoted && st.quoted[i]).forEach(function (x) { r.push(x); }); });
      return r;
    };
    var fail = function (code, shown, extra) { errs.push(fmtFsErr(dialect, name, shown, abs(shown), code, extra)); };
    var i;
    switch (st.cmd) {
      case 'pwd': out.lines.push(cwd); break;
      case 'echo': out.lines.push(st.args.join(' ')); break;   // args is one joined string (see the parsers)
      case 'cd': {
        var tgt = st.args.length ? st.args[0] : HOME;
        if (st.args.length > 1) { errs.push(L ? 'bash: cd: too many arguments' : 'Set-Location: A positional parameter cannot be found that accepts argument \'' + st.args[1] + "'."); break; }
        var a = abs(tgt);
        if (!fs.exists(a)) errs.push(L ? 'bash: cd: ' + tgt + ': No such file or directory' : "Set-Location: Cannot find path '" + a + "' because it does not exist.");
        else if (!fs.isDir(a)) errs.push(L ? 'bash: cd: ' + tgt + ': Not a directory' : "Set-Location: Cannot set location: '" + a + "' is not a directory.");
        else state.cwd = a;
        break;
      }
      case 'ls': {
        var targets = files(); if (!targets.length) targets = ['.'];
        var okT = targets.filter(function (t) {
          if (fs.exists(abs(t))) return true;
          errs.push(L ? "ls: cannot access '" + t + "': No such file or directory" : "Get-ChildItem: Cannot find path '" + abs(t) + "' because it does not exist.");
          return false;
        });
        var fileT = okT.filter(function (t) { return fs.isFile(abs(t)); }), dirT = okT.filter(function (t) { return fs.isDir(abs(t)); });
        fileT.forEach(function (t) { out.lines.push(t); });
        dirT.forEach(function (t, di) {
          var p = abs(t), showAll = st.flags.all || st.flags.force;
          if (okT.length > 1) { if (di || fileT.length) out.lines.push(''); out.lines.push(t + ':'); }
          var names = fs.list(p).filter(function (n) { return showAll || n.charAt(0) !== '.'; });
          if (L && st.flags.all) names = ['.', '..'].concat(names);
          names.forEach(function (n) { out.lines.push(n + (fs.isDir(p === '/' ? '/' + n : p + '/' + n) ? '/' : '')); });
        });
        break;
      }
      case 'cat': case 'head': {
        var fl = files(), isHead = st.cmd === 'head';
        if (!fl.length) {
          if (input) out.lines = isHead ? input.slice(0, st.count) : input.slice();
          else errs.push(L ? name + ': needs a file name or a pipe in this game' : name + ': Cannot bind argument: -Path is required.');
          break;
        }
        fl.forEach(function (f) {
          var p = abs(f);
          if (!fs.exists(p)) return fail('ENOENT', f, L ? 'cannot open ' : '');
          if (fs.isDir(p)) return fail('EISDIR', f);
          var ls = toLines(fs.read(p)); if (isHead) ls = ls.slice(0, st.count);
          if (isHead && L && fl.length > 1) out.lines.push('==> ' + f + ' <==');
          out.lines = out.lines.concat(ls);
        });
        break;
      }
      case 'grep': {
        var rx;
        try { rx = new RegExp(st.pattern, st.flags.ignoreCase ? 'i' : ''); }
        catch (e) { errs.push(L ? 'grep: invalid regular expression: ' + st.pattern : 'Select-String: Cannot parse the pattern: ' + st.pattern); break; }
        var gf = files(), hits = [];
        if (!gf.length) {
          if (!input) { errs.push(L ? 'grep: needs a file name or a pipe in this game' : 'Select-String: Cannot bind argument: -Path is required.'); break; }
          input.forEach(function (t, n) { if (rx.test(t)) hits.push({ file: null, n: n + 1, text: t }); });
        } else gf.forEach(function (f) {
          var p = abs(f);
          if (!fs.exists(p)) return fail('ENOENT', f, L ? '' : '');
          if (fs.isDir(p)) return fail('EISDIR', f);
          toLines(fs.read(p)).forEach(function (t, n) { if (rx.test(t)) hits.push({ file: f, n: n + 1, text: t }); });
        });
        out.hits = hits;
        out.lines = hits.map(function (h) {
          if (L) return (gf.length > 1 ? h.file + ':' : '') + (st.flags.lineNumbers ? h.n + ':' : '') + h.text;
          return h.file === null ? h.text : h.file + ':' + h.n + ':' + h.text;
        });
        break;
      }
      case 'mkdir':
        st.args.forEach(function (d) {
          var p = abs(d);
          try {
            if (!L && fs.isDir(p) && !st.flags.force) throw fsErr('EEXIST', p);
            if (!L && fs.isDir(p)) return;
            fs.mkdir(p, !!st.flags.parents);
          } catch (e) { if (!e.code) throw e; errs.push(L ? "mkdir: cannot create directory '" + d + "': " + ({ ENOENT: 'No such file or directory', EEXIST: 'File exists', ENOTDIR: 'Not a directory' })[e.code] : fmtFsErr(dialect, name, d, p, e.code)); }
        });
        if (!st.args.length) errs.push(L ? 'mkdir: missing operand' : 'New-Item: Cannot bind argument: -Path is required.');
        break;
      case 'touch':
        if (!st.args.length) errs.push(L ? 'touch: missing file operand' : 'New-Item: Cannot bind argument: -Path is required.');
        st.args.forEach(function (f) {
          var p = abs(f), s = split(p);
          if (!fs.isDir(s[0])) return errs.push(L ? "touch: cannot touch '" + f + "': No such file or directory" : "New-Item: Could not find a part of the path '" + p + "'.");
          if (fs.isDir(p)) return L ? null : fail('EEXIST', f);
          if (fs.isFile(p)) { if (!L) fail('EEXIST', f); return; }
          fs.writeFile(p, '', false);
        });
        break;
      case 'cp': case 'mv': {
        var srcs = [], all = st.args.slice();
        if (all.length < 2) { errs.push(L ? name + ': missing destination file operand after \'' + (all[0] || '') + "'" : name + ': Cannot bind argument: -Destination is required.'); break; }
        var dst = all.pop(); all.forEach(function (x, ix) { glob(fs, cwd, x, st.quoted && st.quoted[ix]).forEach(function (y) { srcs.push(y); }); });
        var dAbs = abs(dst), dIsDir = fs.isDir(dAbs);
        if (srcs.length > 1 && !dIsDir) { errs.push(L ? name + ": target '" + dst + "' is not a directory" : name + ": The destination '" + dAbs + "' must be an existing directory for several sources."); break; }
        srcs.forEach(function (sv) {
          var sAbs = abs(sv);
          if (!fs.exists(sAbs)) return errs.push(L ? name + ": cannot " + (st.cmd === 'cp' ? 'stat' : 'stat') + " '" + sv + "': No such file or directory" : fmtFsErr(dialect, name, sv, sAbs, 'ENOENT'));
          var target = dIsDir ? (dAbs === '/' ? '' : dAbs) + '/' + split(sAbs)[1] : dAbs;
          if (target === sAbs) return errs.push(L ? name + ": '" + sv + "' and '" + dst + "' are the same file" : name + ': Cannot overwrite the item with itself.');
          if (fs.isDir(sAbs) && (target + '/').indexOf(sAbs + '/') === 0) return errs.push(L ? name + ": cannot copy or move '" + sv + "' into itself" : name + ': Cannot move or copy a directory into itself.');
          if (!fs.isDir(split(target)[0])) return errs.push(L ? name + ": cannot create '" + dst + "': No such file or directory" : fmtFsErr(dialect, name, dst, dAbs, 'ENOENT'));
          if (fs.isDir(target) && !fs.isDir(sAbs)) return errs.push(L ? name + ": cannot overwrite directory '" + dst + "' with non-directory" : name + ": Cannot overwrite the directory '" + target + "' with a file.");
          if (fs.exists(target) && fs.isDir(sAbs) && !fs.isDir(target)) return errs.push(L ? name + ": cannot overwrite non-directory '" + dst + "' with directory '" + sv + "'" : name + ': Cannot overwrite a file with a directory.');
          if (st.cmd === 'cp') {
            if (fs.isDir(sAbs) && !st.flags.recursive) {
              if (L) return errs.push("cp: -r not specified; omitting directory '" + sv + "'");
              return fs.copyNode(sAbs, target, true);   // PowerShell without -Recurse copies the folder only, empty
            }
            fs.copyNode(sAbs, target);
          } else fs.moveNode(sAbs, target);
        });
        break;
      }
      case 'rm':
        if (!st.args.length) errs.push(L ? 'rm: missing operand' : 'Remove-Item: Cannot bind argument: -Path is required.');
        files().forEach(function (f) {
          var p = abs(f);
          if (p === '/' || cwd === p || (cwd + '/').indexOf(p + '/') === 0) return errs.push(L ? "rm: refusing to remove '" + f + "' (it is, or contains, your current folder)" : "Remove-Item: Refusing to remove '" + p + "' (it is, or contains, your current folder).");
          if (!fs.exists(p)) { if (L && st.flags.force) return; return errs.push(L ? "rm: cannot remove '" + f + "': No such file or directory" : fmtFsErr(dialect, name, f, p, 'ENOENT')); }
          if (fs.isDir(p) && !st.flags.recursive) {
            if (L) return errs.push("rm: cannot remove '" + f + "': Is a directory");
            if (fs.list(p).length) return errs.push("Remove-Item: The item at " + p + ' has children and the -Recurse parameter was not specified.');
          }
          fs.remove(p);
        });
        break;
    }
    return { out: out, errs: errs };
  }

  /* run one input line. state = { fs, cwd }. Returns
   * { ok, meta, stages, parsed, lines, linesAlt:{linux,powershell}, errors, cmdText } ; state is mutated. */
  function run(state, line, dialect) {
    var res = { ok: true, meta: null, stages: [], parsed: null, lines: [], linesAlt: null, errors: [], line: line, dialect: dialect, cwdBefore: state.cwd };
    var t = line.trim();
    if (!t) { res.meta = 'empty'; return res; }
    var m = t.toLowerCase();
    if (m === 'help' || m === 'hint' || m === 'clear' || (dialect === 'powershell' && m === 'cls')) { res.meta = m === 'cls' ? 'clear' : m; return res; }
    var parsed;
    try { parsed = parse(t, dialect); }
    catch (e) {
      if (!e.usage && !e.syntax) throw e;
      res.ok = false; res.errors.push(e.syntax ? (dialect === 'linux' ? 'bash: syntax error: ' : 'ParserError: ') + e.message : e.message); return res;
    }
    res.parsed = parsed; res.stages = parsed.stages;
    var input = null, last = null, alt = { linux: null, powershell: null };
    for (var i = 0; i < parsed.stages.length; i++) {
      var r = execStage(state, parsed.stages[i], dialect, input);
      if (r.errs.length) { res.ok = false; res.errors = res.errors.concat(r.errs); if (parsed.stages.length > 1) break; }
      input = r.out.lines; last = r.out;
    }
    if (res.ok && last) {
      res.lines = last.lines;
      if (last.hits) {
        var lastSt = parsed.stages[parsed.stages.length - 1], multi = lastSt.args.length > 1;
        alt.linux = last.hits.map(function (h) { return (multi ? h.file + ':' : '') + (lastSt.flags.lineNumbers ? h.n + ':' : '') + h.text; });
        alt.powershell = last.hits.map(function (h) { return h.file === null ? h.text : h.file + ':' + h.n + ':' + h.text; });
      }
      if (parsed.redirect) {
        var p = state.fs.normalize(state.cwd, parsed.redirect.target), s = split(p), rn = dialect === 'linux' ? 'bash' : 'Out-File';
        if (!state.fs.isDir(s[0])) { res.ok = false; res.errors.push(dialect === 'linux' ? 'bash: ' + parsed.redirect.target + ': No such file or directory' : "Out-File: Could not find a part of the path '" + p + "'."); }
        else if (state.fs.isDir(p)) { res.ok = false; res.errors.push(rn + ': ' + parsed.redirect.target + ': Is a directory'); }
        else { state.fs.writeFile(p, last.lines.map(function (x) { return x + '\n'; }).join(''), parsed.redirect.mode === '>>'); res.lines = []; }
      }
    }
    res.linesAlt = { linux: alt.linux || res.lines, powershell: alt.powershell || res.lines };
    return res;
  }

  return { HOME: HOME, CMDS: CMDS, VFS: VFS, tokenize: tokenize, parse: parse, render: render, run: run, toLines: toLines };
});
