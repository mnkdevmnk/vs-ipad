/* ==========================================================================
   VS iPad – çevrimdışı C derleyicisi
   C kaynak kodu → tip denetimli AST → JavaScript → çalıştır
   Destek: preprocessor (#include "x.h", #define, #if…), int/char/short/long/
   long long/float/double/unsigned, pointer, dizi (çok boyutlu, VLA), struct,
   union, enum, typedef, fonksiyon pointer, özyineleme, malloc/free,
   stdio (printf/scanf/fgets/dosya), string.h, math.h, ctype.h, stdlib.h, time.h
   Bellek: düz 64 MB adres alanı (gerçek C gibi pointer aritmetiği çalışır).
   ========================================================================== */
(function (root) {
'use strict';

const MEM_SIZE = 64 * 1024 * 1024;
const STACK_SIZE = 8 * 1024 * 1024;
const GLOBAL_BASE = 4096;
const STACK_LO = MEM_SIZE - STACK_SIZE;
const ALLOC_MAGIC = 0xA110C8ED, FREED_MAGIC = 0xF4EEF4EE;

class CError extends Error { constructor(msg, tok, sev) { super(msg); this.tok = tok; this.sev = sev || 'error'; } }
class ExitSignal { constructor(code) { this.code = code; } }
class RuntimeErr { constructor(msg, code) { this.msg = msg; this.code = code == null ? 139 : code; } }

const enc = new TextEncoder();
const strToBytes = (s) => Array.from(enc.encode(s));
const bytesToLatin = (b) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.slice(i, i + 8192)); return s; };
const latinToBytes = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const utf8ToLatin = (s) => bytesToLatin(Array.from(enc.encode(s)));
const latinToUtf8 = (s) => new TextDecoder().decode(latinToBytes(s));

// =================================================================== LEXER
const PUNCT = ['...', '<<=', '>>=', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '*=', '/=', '%=', '+=', '-=', '&=', '^=', '|=', '##',
  '[', ']', '(', ')', '{', '}', '.', '&', '*', '+', '-', '~', '!', '/', '%', '<', '>', '^', '|', '?', ':', ';', '=', ',', '#'];
const isIdStart = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$' || ch.charCodeAt(0) > 127;
const isDigit = (ch) => ch >= '0' && ch <= '9';
const isIdChar = (ch) => isIdStart(ch) || isDigit(ch);

function lex(src, file) {
  const toks = [];
  let i = 0, line = 1, col = 1, bol = true, sp = false;
  const n = src.length;
  while (i < n) {
    let c = src[i];
    if (c === '\n') { i++; line++; col = 1; bol = true; sp = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') { i++; col++; sp = true; continue; }
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { i += src[i + 1] === '\r' ? 3 : 2; line++; col = 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; sp = true; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const sl = line, sc = col;
      i += 2; col += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; }
      if (i >= n) toks.push({ k: 'bad', v: '/*', msg: 'unterminated comment', file, line: sl, col: sc, bol, sp });
      i += 2; col += 2; sp = true; continue;
    }
    const tok = { k: '', v: '', file, line, col, bol, sp };
    bol = false; sp = false;
    const st = i;
    if ((c === 'L' || c === 'U' || c === 'u') && (src[i + 1] === '"' || src[i + 1] === "'")) { i++; c = src[i]; }
    else if (c === 'u' && src[i + 1] === '8' && src[i + 2] === '"') { i += 2; c = src[i]; }
    if (c === '"' || c === "'") {
      const q = c; i++;
      const bytes = [];
      let bad = false;
      while (i < n && src[i] !== q) {
        if (src[i] === '\n') { bad = true; break; }
        if (src[i] === '\\') {
          i++;
          const e = src[i];
          if (e === 'n') { bytes.push(10); i++; }
          else if (e === 't') { bytes.push(9); i++; }
          else if (e === 'r') { bytes.push(13); i++; }
          else if (e === 'a') { bytes.push(7); i++; }
          else if (e === 'b') { bytes.push(8); i++; }
          else if (e === 'f') { bytes.push(12); i++; }
          else if (e === 'v') { bytes.push(11); i++; }
          else if (e === 'e') { bytes.push(27); i++; }
          else if (e >= '0' && e <= '7') { let v = 0, k = 0; while (k < 3 && src[i] >= '0' && src[i] <= '7') { v = v * 8 + (src.charCodeAt(i) - 48); i++; k++; } bytes.push(v & 255); }
          else if (e === 'x') { i++; let v = 0, k = 0; while (/[0-9a-fA-F]/.test(src[i] || '')) { v = v * 16 + parseInt(src[i], 16); i++; k++; } bytes.push(v & 255); }
          else if (e === 'u' || e === 'U') { i++; const len = e === 'u' ? 4 : 8; const cp = parseInt(src.substr(i, len), 16); i += len; for (const b of strToBytes(String.fromCodePoint(cp || 63))) bytes.push(b); }
          else if (e === '\n') { i++; line++; }
          else { bytes.push(src.charCodeAt(i) & 255); i++; }
        } else {
          const cp = src.codePointAt(i);
          const ch = String.fromCodePoint(cp);
          if (cp < 128) bytes.push(cp); else for (const b of strToBytes(ch)) bytes.push(b);
          i += ch.length;
        }
      }
      if (bad || i >= n) {
        tok.k = 'bad'; tok.msg = `missing terminating ${q} character`; tok.v = q;
        col += i - st; toks.push(tok); continue;
      }
      i++;
      if (q === '"') { tok.k = 'str'; tok.bytes = bytes; }
      else {
        tok.k = 'chr';
        if (!bytes.length) { tok.k = 'bad'; tok.msg = 'empty character constant'; }
        else tok.v = bytes.length === 1 ? (bytes[0] << 24 >> 24) : bytes.slice(-4).reduce((a, b) => ((a << 8) | b) | 0, 0);
        tok.multi = bytes.length > 1;
      }
      col += i - st; toks.push(tok); continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      tok.k = 'id'; tok.v = src.slice(i, j);
      col += j - i; i = j; toks.push(tok); continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      let j = i;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) { j += 2; while (/[0-9a-fA-F]/.test(src[j] || '')) j++; }
      else if (c === '0' && (src[i + 1] === 'b' || src[i + 1] === 'B')) { j += 2; while (src[j] === '0' || src[j] === '1') j++; }
      else {
        while (isDigit(src[j] || '')) j++;
        if (src[j] === '.') { j++; while (isDigit(src[j] || '')) j++; }
        if ((src[j] === 'e' || src[j] === 'E') && /[0-9+\-]/.test(src[j + 1] || '')) { j++; if (src[j] === '+' || src[j] === '-') j++; while (isDigit(src[j] || '')) j++; }
      }
      let k = j;
      while (/[a-zA-Z0-9_]/.test(src[k] || '')) k++;
      tok.k = 'num'; tok.text = src.slice(i, j); tok.suffix = src.slice(j, k).toLowerCase();
      col += k - i; i = k; toks.push(tok); continue;
    }
    let p = null;
    for (const P of PUNCT) if (src.startsWith(P, i)) { p = P; break; }
    if (!p) {
      tok.k = 'bad'; tok.v = c; tok.msg = `stray '${c}' in program`;
      toks.push(tok); i++; col++; continue;
    }
    tok.k = 'p'; tok.v = p; i += p.length; col += p.length;
    toks.push(tok);
  }
  return toks;
}

function escBytes(b) {
  let s = '';
  for (const x of b) {
    if (x === 34) s += '\\"'; else if (x === 92) s += '\\\\'; else if (x === 10) s += '\\n'; else if (x === 9) s += '\\t';
    else if (x < 32 || x === 127) s += '\\' + x.toString(8).padStart(3, '0'); else s += String.fromCharCode(x);
  }
  return s;
}
function tokText(t) {
  if (!t) return '';
  if (t.k === 'num') return t.text + (t.suffix || '');
  if (t.k === 'str') { try { return '"' + new TextDecoder().decode(new Uint8Array(t.bytes)).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'; } catch (e) { return '"' + escBytes(t.bytes) + '"'; } }
  if (t.k === 'chr') return t.text || ("'" + (t.v >= 32 && t.v < 127 ? String.fromCharCode(t.v) : '\\' + (t.v & 255).toString(8)) + "'");
  if (t.k === 'eof') return 'end of input';
  return String(t.v);
}

// =================================================================== PREPROCESSOR
const STD_HEADERS = new Set(['stdio.h', 'stdlib.h', 'string.h', 'math.h', 'ctype.h', 'stdbool.h', 'limits.h', 'time.h', 'stddef.h', 'stdint.h',
  'assert.h', 'float.h', 'stdarg.h', 'errno.h', 'locale.h', 'wchar.h', 'inttypes.h', 'unistd.h', 'strings.h', 'iso646.h', 'signal.h', 'setjmp.h',
  'sys/types.h', 'stdnoreturn.h', 'tgmath.h', 'complex.h', 'fenv.h', 'memory.h', 'malloc.h']);

function normPath(p) {
  const out = [];
  for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
  return out.join('/');
}
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const baseOf = (p) => p.split('/').pop();

class Preprocessor {
  constructor(files, diags) {
    this.files = files; this.diags = diags; this.macros = new Map(); this.once = new Set(); this.depth = 0;
    this.includedStd = new Set();
  }
  err(msg, t, sev) { this.diags.push({ sev: sev || 'error', msg, file: t ? t.file : '', line: t ? t.line : 0, col: t ? t.col : 0 }); }
  defineText(text) { const out = []; this.processTokens(lex(text, '<built-in>'), '<built-in>', out); return out; }
  processFile(path, out, fromTok) {
    const text = this.files.get(path);
    if (text == null) { this.err(`${path}: No such file or directory`, fromTok); return; }
    this.processTokens(lex(text, path), path, out);
  }
  processTokens(toks, path, out) {
    const cond = [];
    let i = 0;
    const active = () => cond.every((c) => c.active);
    while (i < toks.length) {
      const t = toks[i];
      if (t.k === 'p' && t.v === '#' && t.bol) {
        let j = i + 1;
        const line = [];
        while (j < toks.length && !toks[j].bol) { line.push(toks[j]); j++; }
        i = j;
        this.directive(line, cond, path, t, out);
        continue;
      }
      if (!active()) { i++; continue; }
      let j = i;
      while (j < toks.length && !(toks[j].k === 'p' && toks[j].v === '#' && toks[j].bol)) j++;
      const seg = toks.slice(i, j);
      i = j;
      for (const x of this.expand(seg, new Set())) out.push(x);
    }
    if (cond.length) this.err('unterminated conditional directive', cond[cond.length - 1].tok);
  }
  directive(line, cond, path, hash, out) {
    if (!line.length) return;
    const nameTok = line[0];
    const name = nameTok.k === 'id' ? nameTok.v : (nameTok.k === 'num' ? 'line' : '');
    const rest = line.slice(1);
    const isActive = cond.every((c) => c.active);
    const top = cond[cond.length - 1];
    switch (name) {
      case 'ifdef': case 'ifndef': {
        if (!isActive) { cond.push({ active: false, taken: true, tok: hash }); return; }
        const d = !!(rest[0] && this.macros.has(rest[0].v));
        const v = name === 'ifdef' ? d : !d;
        cond.push({ active: v, taken: v, tok: hash }); return;
      }
      case 'if': {
        if (!isActive) { cond.push({ active: false, taken: true, tok: hash }); return; }
        const v = this.evalIf(rest, hash);
        cond.push({ active: v, taken: v, tok: hash }); return;
      }
      case 'elif': {
        if (!top) { this.err('#elif without #if', hash); return; }
        if (top.taken) { top.active = false; return; }
        if (cond.slice(0, -1).every((c) => c.active)) { const v = this.evalIf(rest, hash); top.active = v; top.taken = v; }
        return;
      }
      case 'else':
        if (!top) { this.err('#else without #if', hash); return; }
        top.active = !top.taken; top.taken = true; return;
      case 'endif':
        if (!top) { this.err('#endif without #if', hash); return; }
        cond.pop(); return;
    }
    if (!isActive) return;
    switch (name) {
      case 'define': this.define(rest, hash); return;
      case 'undef': if (rest[0]) this.macros.delete(rest[0].v); return;
      case 'include': this.include(rest, path, hash, out); return;
      case 'pragma': if (rest[0] && rest[0].v === 'once') this.once.add(path); return;
      case 'error': this.err('#error ' + rest.map(tokText).join(' '), hash); return;
      case 'warning': this.err('#warning ' + rest.map(tokText).join(' '), hash, 'warning'); return;
      case 'line': case 'ident': case 'sccs': return;
      default: this.err(`invalid preprocessing directive #${tokText(nameTok)}`, nameTok);
    }
  }
  define(rest, hash) {
    const nt = rest[0];
    if (!nt || nt.k !== 'id') { this.err('macro names must be identifiers', nt || hash); return; }
    let params = null, variadic = false, body;
    if (rest[1] && rest[1].k === 'p' && rest[1].v === '(' && !rest[1].sp) {
      params = [];
      let k = 2;
      while (k < rest.length && rest[k].v !== ')') {
        if (rest[k].v === '...') { variadic = true; params.push('__VA_ARGS__'); }
        else if (rest[k].k === 'id') params.push(rest[k].v);
        k++;
      }
      body = rest.slice(k + 1);
    } else body = rest.slice(1);
    this.macros.set(nt.v, { params, variadic, body, name: nt.v });
  }
  resolve(name, from) {
    const cands = [normPath(dirOf(from) + '/' + name), normPath(name), normPath((this.mainDir || '') + '/' + name)];
    for (const c of cands) if (this.files.has(c)) return c;
    // büyük/küçük harf duyarsız deneme
    const low = cands.map((c) => c.toLowerCase());
    for (const k of this.files.keys()) if (low.includes(k.toLowerCase())) return k;
    return null;
  }
  include(rest, path, hash, out) {
    let name = null, sys = false;
    if (rest[0] && rest[0].k === 'str') name = new TextDecoder().decode(new Uint8Array(rest[0].bytes));
    else if (rest[0] && rest[0].v === '<') {
      sys = true;
      const end = rest.findIndex((t) => t.v === '>');
      name = rest.slice(1, end < 0 ? rest.length : end).map(tokText).join('');
    } else {
      const ex = this.expand(rest, new Set());
      if (ex[0] && ex[0].k === 'str') name = new TextDecoder().decode(new Uint8Array(ex[0].bytes));
    }
    if (!name) { this.err('#include expects "FILENAME" or <FILENAME>', hash); return; }
    const resolved = this.resolve(name, path);
    if (resolved == null) {
      if (STD_HEADERS.has(name)) { this.includedStd.add(name); return; }
      const hint = /^(conio\.h|windows\.h|dos\.h)$/i.test(name) ? ' (Windows\'a özel başlık; getch() yerine getchar(), system("cls") gerekmez)' : (/^(iostream|vector|string|algorithm|map|cstdio|cstdlib|cmath)$/.test(name) ? ' (bu bir C++ başlığı – dosyayı .cpp olarak kaydet)' : '');
      this.err(`${name}: No such file or directory${hint}`, rest[0] || hash, 'fatal');
      return;
    }
    if (this.once.has(resolved)) return;
    if (this.depth > 40) { this.err('#include nested too deeply', hash); return; }
    this.depth++;
    this.processFile(resolved, out, hash);
    this.depth--;
  }
  evalIf(rest, hash) {
    const pre = [];
    for (let k = 0; k < rest.length; k++) {
      const t = rest[k];
      if (t.k === 'id' && t.v === 'defined') {
        let nameT;
        if (rest[k + 1] && rest[k + 1].v === '(') { nameT = rest[k + 2]; k += 3; } else { nameT = rest[k + 1]; k += 1; }
        pre.push({ k: 'num', text: this.macros.has(nameT && nameT.v) ? '1' : '0', suffix: '', file: t.file, line: t.line, col: t.col });
      } else pre.push(t);
    }
    const ex = this.expand(pre, new Set());
    let js = '';
    for (const t of ex) {
      if (t.k === 'num') { let v = t.text; if (/^0[0-7]+$/.test(v)) v = '0o' + v.slice(1); js += ' ' + (/[.eE]/.test(v) && !/^0x/i.test(v) ? v : Number(BigInt(v))) + ' '; }
      else if (t.k === 'chr') js += ' ' + t.v + ' ';
      else if (t.k === 'id') js += ' 0 ';
      else if (t.k === 'p' && /^(\(|\)|\+|-|\*|\/|%|<<|>>|<|>|<=|>=|==|!=|&&|\|\||!|~|&|\||\^|\?|:)$/.test(t.v)) js += ' ' + t.v + ' ';
      else { this.err('token "' + tokText(t) + '" is not valid in preprocessor expressions', t); return false; }
    }
    try { return !!Function('return (' + (js.trim() || '0') + ');')(); }
    catch (e) { this.err('invalid preprocessor expression', hash); return false; }
  }
  expand(toks, hide) {
    const out = [];
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      if (t.k === 'id' && !(t.noexp)) {
        if (t.v === '__LINE__') { out.push({ k: 'num', text: String(t.line), suffix: '', file: t.file, line: t.line, col: t.col, sp: t.sp }); i++; continue; }
        if (t.v === '__FILE__') { out.push({ k: 'str', bytes: strToBytes(baseOf(t.file)), file: t.file, line: t.line, col: t.col, sp: t.sp }); i++; continue; }
        if (t.v === '__func__' || t.v === '__FUNCTION__') { out.push(t); i++; continue; }
        const m = this.macros.get(t.v);
        if (m && hide.has(t.v)) { out.push(Object.assign({}, t, { noexp: true })); i++; continue; }
        if (m) {
          if (m.params === null) {
            const body = m.body.map((b, bi) => Object.assign({}, b, { file: t.file, line: t.line, col: t.col, sp: bi === 0 ? t.sp : b.sp, bol: false }));
            const nh = new Set(hide); nh.add(t.v);
            // sonucu kalan tokenlarla birlikte yeniden tara (fonksiyon-benzeri makro ismi üretebilir)
            const expanded = this.expand(this.paste(body), nh);
            const restToks = toks.slice(i + 1);
            if (expanded.length && expanded[expanded.length - 1].k === 'id' && this.macros.get(expanded[expanded.length - 1].v) && this.macros.get(expanded[expanded.length - 1].v).params && restToks[0] && restToks[0].v === '(') {
              const lastT = expanded.pop();
              for (const x of expanded) out.push(x);
              toks = [lastT].concat(restToks); i = 0; continue;
            }
            for (const x of expanded) out.push(x);
            i++; continue;
          }
          let j = i + 1;
          if (toks[j] && toks[j].k === 'p' && toks[j].v === '(') {
            const args = [];
            let depth = 0, cur = [];
            j++;
            for (; j < toks.length; j++) {
              const a = toks[j];
              if (a.k === 'p' && a.v === '(') { depth++; cur.push(a); }
              else if (a.k === 'p' && a.v === ')') { if (depth === 0) break; depth--; cur.push(a); }
              else if (a.k === 'p' && a.v === ',' && depth === 0 && !(m.variadic && args.length >= m.params.length - 1)) { args.push(cur); cur = []; }
              else cur.push(a);
            }
            if (j >= toks.length) { this.err(`unterminated argument list invoking macro "${t.v}"`, t); i++; continue; }
            args.push(cur);
            if (m.params.length === 0 && args.length === 1 && !args[0].length) args.length = 0;
            if (m.variadic && args.length === m.params.length - 1) args.push([]);
            if (args.length !== m.params.length) {
              this.err(`macro "${t.v}" ${args.length > m.params.length ? 'passed ' + args.length + ' arguments, but takes just ' + m.params.length : 'requires ' + m.params.length + ' arguments, but only ' + args.length + ' given'}`, t);
              i = j + 1; continue;
            }
            const body = this.substitute(m, args, hide, t);
            const nh = new Set(hide); nh.add(t.v);
            for (const x of this.expand(body, nh)) out.push(x);
            i = j + 1; continue;
          }
        }
      }
      out.push(t); i++;
    }
    return out;
  }
  substitute(m, args, hide, site) {
    const res = [];
    const b = m.body;
    const loc = (x) => Object.assign({}, x, { file: site.file, line: site.line, col: site.col, bol: false });
    for (let k = 0; k < b.length; k++) {
      const bt = b[k];
      if (bt.k === 'p' && bt.v === '#' && b[k + 1] && b[k + 1].k === 'id' && m.params.includes(b[k + 1].v)) {
        const a = args[m.params.indexOf(b[k + 1].v)] || [];
        const text = a.map((x, ix) => (ix && x.sp ? ' ' : '') + tokText(x)).join('');
        res.push(loc({ k: 'str', bytes: strToBytes(text), sp: bt.sp })); k++; continue;
      }
      const pi = bt.k === 'id' ? m.params.indexOf(bt.v) : -1;
      if (pi >= 0) {
        const raw = args[pi] || [];
        const pasteAdj = (b[k + 1] && b[k + 1].v === '##') || (b[k - 1] && b[k - 1].v === '##');
        const sub = pasteAdj ? raw : this.expand(raw, hide);
        sub.forEach((x, xi) => res.push(Object.assign(loc(x), { sp: xi === 0 ? bt.sp : x.sp })));
        if (!sub.length && pasteAdj) res.push(loc({ k: 'placeholder', v: '' }));
        continue;
      }
      res.push(loc(bt));
    }
    return this.paste(res);
  }
  paste(toks) {
    if (!toks.some((t) => t.k === 'p' && t.v === '##')) return toks.filter((t) => t.k !== 'placeholder');
    const out = [];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.k === 'p' && t.v === '##' && out.length && toks[k + 1]) {
        const a = out.pop(), b2 = toks[k + 1];
        const text = (a.k === 'placeholder' ? '' : tokText(a)) + (b2.k === 'placeholder' ? '' : tokText(b2));
        const lt = lex(text, a.file);
        lt.forEach((x) => { x.file = a.file; x.line = a.line; x.col = a.col; x.sp = a.sp; x.bol = false; out.push(x); });
        k++;
      } else out.push(t);
    }
    return out.filter((t) => t.k !== 'placeholder');
  }
}

// =================================================================== TYPES
const mkInt = (size, uns, name) => ({ k: 'int', size, align: size, uns, name });
const T_VOID = { k: 'void', size: 1, align: 1, name: 'void' };
const T_CHAR = mkInt(1, false, 'char'), T_SCHAR = mkInt(1, false, 'signed char'), T_UCHAR = mkInt(1, true, 'unsigned char');
const T_SHORT = mkInt(2, false, 'short'), T_USHORT = mkInt(2, true, 'unsigned short');
const T_INT = mkInt(4, false, 'int'), T_UINT = mkInt(4, true, 'unsigned int');
const T_LONG = mkInt(8, false, 'long'), T_ULONG = mkInt(8, true, 'unsigned long');
const T_LLONG = mkInt(8, false, 'long long'), T_ULLONG = mkInt(8, true, 'unsigned long long');
const T_BOOL = { k: 'int', size: 1, align: 1, uns: true, bool: true, name: '_Bool' };
const T_FLOAT = { k: 'flt', size: 4, align: 4, name: 'float' };
const T_DOUBLE = { k: 'flt', size: 8, align: 8, name: 'double' };
const T_LDOUBLE = { k: 'flt', size: 8, align: 8, name: 'long double' };
const ptrTo = (t) => ({ k: 'ptr', to: t, size: 8, align: 8 });
const arrOf = (t, len) => ({ k: 'arr', of: t, len, size: len != null && t.size != null ? len * t.size : (len === 0 ? 0 : null), align: t.align || 1 });
const T_CHARP = ptrTo(T_CHAR);
const T_VOIDP = ptrTo(T_VOID);

const isInt = (t) => t.k === 'int';
const isFlt = (t) => t.k === 'flt';
const isArith = (t) => t.k === 'int' || t.k === 'flt';
const isPtr = (t) => t.k === 'ptr';
const isScalar = (t) => isArith(t) || isPtr(t);
const is64 = (t) => t.k === 'int' && t.size === 8;
const isAgg = (t) => t.k === 'arr' || t.k === 'struct';
const isCharT = (t) => t.k === 'int' && t.size === 1 && !t.bool;
const isVoidP = (t) => isPtr(t) && t.to.k === 'void';

function typeStr(t) {
  if (!t) return '?';
  switch (t.k) {
    case 'void': case 'int': case 'flt': return t.name;
    case 'struct': return (t.union ? 'union ' : 'struct ') + (t.tag || '<anonymous>');
    case 'ptr': if (t.to.k === 'func') return typeStr(t.to.ret) + ' (*)(' + t.to.params.map(typeStr).join(', ') + ')'; return typeStr(t.to) + (t.to.k === 'ptr' ? '*' : ' *');
    case 'arr': return typeStr(t.of) + '[' + (t.len != null ? t.len : '') + ']';
    case 'func': return typeStr(t.ret) + ' (' + t.params.map(typeStr).join(', ') + ')';
  }
  return '?';
}
function sameType(a, b) {
  if (a === b) return true;
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'void': return true;
    case 'int': return a.size === b.size && a.uns === b.uns && !!a.bool === !!b.bool;
    case 'flt': return a.size === b.size;
    case 'ptr': return sameType(a.to, b.to) || a.to.k === 'void' || b.to.k === 'void';
    case 'arr': return sameType(a.of, b.of);
    case 'struct': return a === b;
    case 'func': return sameType(a.ret, b.ret);
  }
  return false;
}
function promote(t) { if (t.k === 'int' && t.size < 4) return T_INT; return t; }
function arithConv(a, b) {
  if (isFlt(a) || isFlt(b)) { if ((isFlt(a) && a.size === 8) || (isFlt(b) && b.size === 8)) return T_DOUBLE; return T_FLOAT; }
  a = promote(a); b = promote(b);
  if (a.size === 8 || b.size === 8) { const u = (a.size === 8 && a.uns) || (b.size === 8 && b.uns); return u ? T_ULONG : T_LONG; }
  return (a.uns || b.uns) ? T_UINT : T_INT;
}

function convConst(v, from, to) {
  if (to.k === 'void') return 0;
  if (to.bool) return (typeof v === 'bigint' ? v !== 0n : v !== 0) ? 1 : 0;
  if (to.k === 'int' || to.k === 'ptr') {
    let x;
    if (typeof v === 'bigint') x = v;
    else if (from && from.k === 'flt') { if (!isFinite(v)) x = to.size === 8 ? -(1n << 63n) : -2147483648n; else x = BigInt(Math.trunc(v)); }
    else x = BigInt(Math.trunc(v));
    const bits = to.k === 'ptr' ? 32 : to.size * 8;
    const uns = to.k === 'ptr' ? true : to.uns;
    const r = uns ? BigInt.asUintN(bits, x) : BigInt.asIntN(bits, x);
    return bits === 64 ? r : Number(r);
  }
  if (to.k === 'flt') { const n = Number(v); return to.size === 4 ? Math.fround(n) : n; }
  return v;
}

// =================================================================== PRELUDE (standart kütüphane başlıkları)
const PRELUDE = `
typedef unsigned int size_t; typedef int ssize_t; typedef int ptrdiff_t; typedef int intptr_t; typedef unsigned int uintptr_t;
typedef signed char int8_t; typedef unsigned char uint8_t; typedef short int16_t; typedef unsigned short uint16_t;
typedef int int32_t; typedef unsigned int uint32_t; typedef long long int64_t; typedef unsigned long long uint64_t;
typedef long intmax_t; typedef unsigned long uintmax_t; typedef long time_t; typedef long clock_t; typedef int wchar_t;
typedef struct __vsc_FILE { int __fd; } FILE;
typedef struct { int quot; int rem; } div_t;
typedef struct { long quot; long rem; } ldiv_t;
typedef char *va_list;
struct tm { int tm_sec; int tm_min; int tm_hour; int tm_mday; int tm_mon; int tm_year; int tm_wday; int tm_yday; int tm_isdst; };
#define NULL ((void*)0)
#define EOF (-1)
#define stdin ((FILE*)1)
#define stdout ((FILE*)2)
#define stderr ((FILE*)3)
#define bool _Bool
#define true 1
#define false 0
#define CHAR_BIT 8
#define SCHAR_MIN (-128)
#define SCHAR_MAX 127
#define UCHAR_MAX 255
#define CHAR_MIN (-128)
#define CHAR_MAX 127
#define SHRT_MIN (-32768)
#define SHRT_MAX 32767
#define USHRT_MAX 65535
#define INT_MIN (-2147483647-1)
#define INT_MAX 2147483647
#define UINT_MAX 4294967295U
#define LONG_MIN (-9223372036854775807L-1)
#define LONG_MAX 9223372036854775807L
#define ULONG_MAX 18446744073709551615UL
#define LLONG_MIN (-9223372036854775807LL-1)
#define LLONG_MAX 9223372036854775807LL
#define ULLONG_MAX 18446744073709551615ULL
#define INT8_MIN (-128)
#define INT8_MAX 127
#define UINT8_MAX 255
#define INT16_MIN (-32768)
#define INT16_MAX 32767
#define UINT16_MAX 65535
#define INT32_MIN (-2147483647-1)
#define INT32_MAX 2147483647
#define UINT32_MAX 4294967295U
#define INT64_MIN (-9223372036854775807LL-1)
#define INT64_MAX 9223372036854775807LL
#define UINT64_MAX 18446744073709551615ULL
#define SIZE_MAX 4294967295U
#define FLT_MAX 3.40282347e+38F
#define FLT_MIN 1.17549435e-38F
#define FLT_EPSILON 1.19209290e-07F
#define DBL_MAX 1.7976931348623157e+308
#define DBL_MIN 2.2250738585072014e-308
#define DBL_EPSILON 2.2204460492503131e-16
#define RAND_MAX 2147483647
#define CLOCKS_PER_SEC 1000000L
#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
#define BUFSIZ 8192
#define M_PI 3.14159265358979323846
#define M_PI_2 1.57079632679489661923
#define M_E 2.7182818284590452354
#define M_SQRT2 1.41421356237309504880
#define M_LN2 0.69314718055994530942
#define INFINITY __builtin_inf()
#define HUGE_VAL __builtin_inf()
#define NAN __builtin_nan()
#define isnan(x) __builtin_isnan(x)
#define isinf(x) __builtin_isinf(x)
#define isfinite(x) __builtin_isfinite(x)
#define assert(e) ((e) ? (void)0 : __assert_fail(#e, __FILE__, __LINE__))
#define __STDC__ 1
#define __STDC_VERSION__ 201710L
#define PRId64 "lld"
#define PRIu64 "llu"
#define va_start(ap, last) __vsc_va_unsupported()
#define va_end(ap) ((void)0)
int printf(const char *, ...); int scanf(const char *, ...); int sprintf(char *, const char *, ...); int snprintf(char *, size_t, const char *, ...);
int sscanf(const char *, const char *, ...); int fprintf(FILE *, const char *, ...); int fscanf(FILE *, const char *, ...);
int puts(const char *); int putchar(int); int getchar(void); char *fgets(char *, int, FILE *); char *gets(char *);
int fputs(const char *, FILE *); int fputc(int, FILE *); int putc(int, FILE *); int fgetc(FILE *); int getc(FILE *); int ungetc(int, FILE *);
FILE *fopen(const char *, const char *); int fclose(FILE *); int feof(FILE *); int ferror(FILE *); int fflush(FILE *); void rewind(FILE *);
int fseek(FILE *, long, int); long ftell(FILE *); size_t fread(void *, size_t, size_t, FILE *); size_t fwrite(const void *, size_t, size_t, FILE *);
void perror(const char *); int remove(const char *); int rename(const char *, const char *); void setbuf(FILE *, char *); int setvbuf(FILE *, char *, int, size_t);
void *malloc(size_t); void *calloc(size_t, size_t); void *realloc(void *, size_t); void free(void *); void exit(int); void abort(void); int atexit(void (*)(void));
int abs(int); long labs(long); long long llabs(long long); int atoi(const char *); long atol(const char *); long long atoll(const char *); double atof(const char *);
long strtol(const char *, char **, int); unsigned long strtoul(const char *, char **, int); long long strtoll(const char *, char **, int); double strtod(const char *, char **); float strtof(const char *, char **);
int rand(void); void srand(unsigned int); void qsort(void *, size_t, size_t, int (*)(const void *, const void *));
void *bsearch(const void *, const void *, size_t, size_t, int (*)(const void *, const void *)); int system(const char *); div_t div(int, int); char *getenv(const char *);
size_t strlen(const char *); char *strcpy(char *, const char *); char *strncpy(char *, const char *, size_t); char *strcat(char *, const char *);
char *strncat(char *, const char *, size_t); int strcmp(const char *, const char *); int strncmp(const char *, const char *, size_t);
int strcasecmp(const char *, const char *); int strncasecmp(const char *, const char *, size_t); int strcoll(const char *, const char *);
char *strchr(const char *, int); char *strrchr(const char *, int); char *strstr(const char *, const char *); char *strtok(char *, const char *);
char *strdup(const char *); char *strndup(const char *, size_t); size_t strspn(const char *, const char *); size_t strcspn(const char *, const char *); char *strpbrk(const char *, const char *);
char *strerror(int); char *strrev(char *); char *strupr(char *); char *strlwr(char *);
void *memset(void *, int, size_t); void *memcpy(void *, const void *, size_t); void *memmove(void *, const void *, size_t); int memcmp(const void *, const void *, size_t); void *memchr(const void *, int, size_t);
double sqrt(double); double pow(double, double); double fabs(double); double floor(double); double ceil(double); double round(double); double trunc(double);
double sin(double); double cos(double); double tan(double); double asin(double); double acos(double); double atan(double); double atan2(double, double);
double sinh(double); double cosh(double); double tanh(double); double exp(double); double exp2(double); double log(double); double log10(double); double log2(double); double log1p(double);
double fmod(double, double); double hypot(double, double); double cbrt(double); double fmax(double, double); double fmin(double, double); double copysign(double, double);
double modf(double, double *); double frexp(double, int *); double ldexp(double, int); long lround(double); long long llround(double); double rint(double); double nearbyint(double);
float sqrtf(float); float powf(float, float); float fabsf(float); float floorf(float); float ceilf(float); float roundf(float); float sinf(float); float cosf(float); float expf(float); float logf(float);
double __builtin_inf(void); double __builtin_nan(void); int __builtin_isnan(double); int __builtin_isinf(double); int __builtin_isfinite(double);
int isdigit(int); int isalpha(int); int isalnum(int); int isspace(int); int isupper(int); int islower(int); int ispunct(int); int isxdigit(int);
int isprint(int); int iscntrl(int); int isgraph(int); int isblank(int); int toupper(int); int tolower(int);
time_t time(time_t *); clock_t clock(void); double difftime(time_t, time_t); struct tm *localtime(const time_t *); char *ctime(const time_t *);
unsigned int sleep(unsigned int); int usleep(unsigned int);
void __assert_fail(const char *, const char *, int); void __vsc_va_unsupported(void);
`;

// =================================================================== PARSER + TİP DENETİMİ
const TYPE_KW = new Set(['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool', 'struct', 'union', 'enum',
  'const', 'volatile', 'static', 'extern', 'register', 'auto', 'inline', 'typedef', 'restrict', '_Noreturn', '__inline', '__restrict', '__inline__', '_Thread_local', '__extension__', '_Atomic', '_Complex']);
const QUALS = new Set(['const', 'volatile', 'restrict', '__restrict', 'inline', '__inline', '__inline__', '_Noreturn', 'register', 'auto', '_Thread_local', '__extension__', '_Atomic']);
const BASE_KW = new Set(['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool', '_Complex']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);
const BIN_PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const RESERVED_NO_ID = new Set(['if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'sizeof']);

let symCounter = 0;

class Parser {
  constructor(toks, prog, diags) {
    this.toks = toks; this.i = 0; this.prog = prog; this.diags = diags;
    this.scopes = [prog.globalScope]; this.tags = [prog.tagScope];
    this.fn = null; this.loopDepth = 0; this.switchStack = [];
    this.eof = { k: 'eof', v: '', file: toks.length ? toks[toks.length - 1].file : '', line: toks.length ? toks[toks.length - 1].line : 1, col: 1 };
  }
  // ---- token yardımcıları
  peek(o = 0) { return this.toks[this.i + o] || this.eof; }
  prev() { return this.toks[this.i - 1] || this.eof; }
  next() { const t = this.peek(); this.i++; return t; }
  is(v, o = 0) { const t = this.peek(o); return t.k === 'p' && t.v === v; }
  isKw(v, o = 0) { const t = this.peek(o); return t.k === 'id' && t.v === v; }
  accept(v) { if (this.is(v)) { this.i++; return true; } return false; }
  error(msg, tok) { throw new CError(msg, tok || this.peek()); }
  warn(msg, tok) { const t = tok || this.peek(); this.diags.push({ sev: 'warning', msg, file: t.file, line: t.line, col: t.col }); }
  expect(v) {
    if (this.accept(v)) return;
    const t = this.peek();
    if (t.k === 'bad') this.error(t.msg, t);
    if (v === ';' || v === ')' || v === ']') {
      const p = this.prev();
      const loc = { file: p.file, line: p.line, col: p.col + Math.max(1, tokText(p).length) };
      throw new CError(`expected '${v}' before ${t.k === 'eof' ? 'end of input' : "'" + tokText(t) + "'"}`, loc);
    }
    this.error(`expected '${v}' before ${t.k === 'eof' ? 'end of input' : "'" + tokText(t) + "'"}`, t);
  }
  expectId() {
    const t = this.peek();
    if (t.k !== 'id' || TYPE_KW.has(t.v) || RESERVED_NO_ID.has(t.v)) this.error(`expected identifier before '${tokText(t)}'`, t);
    this.i++; return t;
  }
  // ---- kapsam
  pushScope(m) { this.scopes.push(m || new Map()); this.tags.push(new Map()); }
  popScope() { this.scopes.pop(); this.tags.pop(); }
  lookup(name) { for (let k = this.scopes.length - 1; k >= 0; k--) { const s = this.scopes[k].get(name); if (s) return s; } return null; }
  lookupTag(name) { for (let k = this.tags.length - 1; k >= 0; k--) { const s = this.tags[k].get(name); if (s) return s; } return null; }
  isTypeName(t) {
    if (!t || t.k !== 'id') return false;
    if (TYPE_KW.has(t.v)) return true;
    const s = this.lookup(t.v);
    return !!(s && s.kind === 'typedef');
  }
  isDeclStart() { return this.isTypeName(this.peek()); }

  // ---- program
  parseTU() {
    while (this.peek().k !== 'eof') {
      const start = this.i;
      try {
        if (this.accept(';')) continue;
        this.externalDecl();
      } catch (e) {
        if (!(e instanceof CError)) throw e;
        this.report(e);
        if (this.diags.filter((d) => d.sev !== 'warning').length > 40) return;
        this.recoverTop(start);
      }
    }
  }
  report(e) { const t = e.tok || this.peek(); this.diags.push({ sev: e.sev || 'error', msg: e.message, file: t.file, line: t.line, col: t.col }); }
  recoverTop(start) {
    if (this.i === start) this.i++;
    let depth = 0;
    while (this.peek().k !== 'eof') {
      const t = this.next();
      if (t.k === 'p') {
        if (t.v === '{') depth++;
        else if (t.v === '}') { depth--; if (depth <= 0) { if (this.is(';')) this.i++; return; } }
        else if (t.v === ';' && depth <= 0) return;
      }
    }
  }
  externalDecl() {
    const ds = this.declSpec();
    if (!ds) {
      const t = this.peek();
      if (t.k === 'bad') this.error(t.msg, t);
      if (t.k === 'id' && this.is('(', 1)) { // dönüş tipi yazılmamış fonksiyon:  main() { ... }
        this.warn(`return type defaults to 'int'`, t);
        return this.declRest({ type: T_INT, storage: null, typedef: false }, true);
      }
      this.error(t.k === 'id' ? `unknown type name '${t.v}'` : `expected identifier or '(' before '${tokText(t)}'`, t);
    }
    return this.declRest(ds, true);
  }

  // ---- bildirim belirteçleri
  declSpec() {
    let storage = null, typedef = false, base = null, any = false;
    const cnt = {};
    const tok0 = this.peek();
    for (;;) {
      const t = this.peek();
      if (t.k !== 'id') break;
      const v = t.v;
      if (QUALS.has(v)) { this.i++; any = true; continue; }
      if (v === 'static' || v === 'extern') { storage = v; this.i++; any = true; continue; }
      if (v === 'typedef') { typedef = true; this.i++; any = true; continue; }
      if (BASE_KW.has(v)) {
        if (base) this.error(`two or more data types in declaration specifiers`, t);
        cnt[v] = (cnt[v] || 0) + 1; this.i++; any = true; continue;
      }
      if (v === 'struct' || v === 'union') { if (base || Object.keys(cnt).length) this.error('two or more data types in declaration specifiers', t); base = this.structSpec(); any = true; continue; }
      if (v === 'enum') { base = this.enumSpec(); any = true; continue; }
      if (!base && !Object.keys(cnt).length) {
        const s = this.lookup(v);
        if (s && s.kind === 'typedef') { base = s.type; this.i++; any = true; continue; }
      }
      break;
    }
    if (!any) return null;
    if (!base) base = this.combine(cnt, tok0);
    return { type: base, storage, typedef };
  }
  combine(c, tok) {
    if (c.void) return T_VOID;
    if (c._Bool) return T_BOOL;
    if (c.float) return T_FLOAT;
    if (c.double) return c.long ? T_LDOUBLE : T_DOUBLE;
    if (c.signed && c.unsigned) this.error("both 'signed' and 'unsigned' in declaration specifiers", tok);
    if (c.char) return c.unsigned ? T_UCHAR : (c.signed ? T_SCHAR : T_CHAR);
    if (c.short) return c.unsigned ? T_USHORT : T_SHORT;
    if (c.long) return c.long >= 2 ? (c.unsigned ? T_ULLONG : T_LLONG) : (c.unsigned ? T_ULONG : T_LONG);
    return c.unsigned ? T_UINT : T_INT;
  }
  structSpec() {
    const kwTok = this.next();
    const isUnion = kwTok.v === 'union';
    let tag = null;
    if (this.peek().k === 'id' && !this.is('{')) tag = this.next().v;
    if (this.is('{')) {
      let st = tag ? this.tags[this.tags.length - 1].get(tag) : null;
      if (st && st.complete) this.error(`redefinition of '${isUnion ? 'union' : 'struct'} ${tag}'`, kwTok);
      if (!st) { st = { k: 'struct', tag, union: isUnion, fields: [], size: 0, align: 1, complete: false }; if (tag) this.tags[this.tags.length - 1].set(tag, st); }
      this.i++;
      const fields = [];
      while (!this.is('}')) {
        if (this.peek().k === 'eof') this.error("expected '}' at end of input");
        const ds = this.declSpec();
        if (!ds) this.error(`expected specifier-qualifier-list before '${tokText(this.peek())}'`);
        if (this.accept(';')) { if (ds.type.k === 'struct') fields.push({ anon: true, type: ds.type }); continue; }
        do {
          let d = { name: null, type: ds.type, tok: this.peek() };
          if (!this.is(':')) d = this.declarator(ds.type);
          if (this.accept(':')) this.condExpr();
          if (d.type.k === 'func') this.error(`field '${d.name}' declared as a function`, d.tok);
          if (d.type.k === 'struct' && !d.type.complete) this.error(`field '${d.name}' has incomplete type`, d.tok);
          fields.push({ name: d.name, type: d.type, tok: d.tok });
        } while (this.accept(','));
        this.expect(';');
      }
      this.i++;
      this.layout(st, fields);
      return st;
    }
    if (!tag) this.error(`expected '{' before '${tokText(this.peek())}'`);
    let st = this.lookupTag(tag);
    if (!st) { st = { k: 'struct', tag, union: isUnion, fields: [], size: 0, align: 1, complete: false }; this.tags[this.tags.length - 1].set(tag, st); }
    return st;
  }
  layout(st, fields) {
    let off = 0, align = 1, size = 0;
    const flat = [];
    const add = (f, base) => {
      if (f.anon) {
        for (const sf of f.type.fields) flat.push({ name: sf.name, type: sf.type, offset: base + sf.offset });
        return;
      }
      flat.push({ name: f.name, type: f.type, offset: base });
    };
    for (const f of fields) {
      const t = f.type;
      const a = t.align || 1;
      const sz = t.size == null ? 0 : t.size;
      align = Math.max(align, a);
      if (st.union) { add(f, 0); size = Math.max(size, sz); }
      else { off = (off + a - 1) & ~(a - 1); add(f, off); off += sz; }
    }
    if (!st.union) size = off;
    st.size = (size + align - 1) & ~(align - 1);
    st.align = align;
    st.fields = flat;
    st.fieldMap = new Map(flat.filter((f) => f.name).map((f) => [f.name, f]));
    st.complete = true;
  }
  enumSpec() {
    this.next();
    let tag = null;
    if (this.peek().k === 'id' && !this.is('{')) tag = this.next().v;
    if (this.accept('{')) {
      let v = 0;
      while (!this.is('}')) {
        const nt = this.expectId();
        if (this.accept('=')) {
          const e = this.condExpr();
          const cv = this.constEval(e);
          if (cv == null) this.error('enumerator value for \'' + nt.v + '\' is not an integer constant', nt);
          v = Number(cv);
        }
        this.declareSym({ kind: 'enum', name: nt.v, type: T_INT, value: v | 0, tok: nt });
        v++;
        if (!this.accept(',')) break;
      }
      this.expect('}');
      if (tag) this.tags[this.tags.length - 1].set('enum ' + tag, true);
    }
    return T_INT;
  }

  // ---- declarator
  declarator(base, abstract) {
    const d = this.declInner(abstract);
    return { name: d.name, tok: d.tok, type: d.wrap(base), fnInfo: d.fnInfo };
  }
  declInner(abstract) {
    let nptr = 0;
    while (this.accept('*')) { nptr++; while (this.peek().k === 'id' && QUALS.has(this.peek().v)) this.i++; }
    let inner = null, name = null, tok = this.peek();
    if (this.is('(') && (this.is('*', 1) || this.is('(', 1) || (this.peek(1).k === 'id' && !this.isTypeName(this.peek(1)) && !abstract))) {
      this.i++;
      inner = this.declInner(abstract);
      this.expect(')');
    } else if (this.peek().k === 'id' && !TYPE_KW.has(this.peek().v) && !this.isTypeName(this.peek()) && !RESERVED_NO_ID.has(this.peek().v)) {
      name = this.next().v;
    } else if (this.peek().k === 'id' && !abstract && this.isTypeName(this.peek()) && !TYPE_KW.has(this.peek().v)) {
      // typedef ismiyle aynı değişken ismi (gölgeleme) – izin ver
      name = this.next().v;
    }
    const suffixes = [];
    for (;;) {
      if (this.accept('[')) {
        while (this.isKw('static') || (this.peek().k === 'id' && QUALS.has(this.peek().v))) this.i++;
        if (this.accept(']')) { suffixes.push({ arr: true, len: null }); continue; }
        if (this.is('*') && this.is(']', 1)) { this.i += 2; suffixes.push({ arr: true, len: null }); continue; }
        const e = this.assignExpr();
        this.expect(']');
        const cv = this.constEval(e);
        if (cv != null) {
          if (Number(cv) < 0) this.error(`size of array ${name ? "'" + name + "' " : ''}is negative`, tok);
          suffixes.push({ arr: true, len: Number(cv) });
        } else {
          if (!isInt(this.rval(e).type)) this.error(`size of array ${name ? "'" + name + "' " : ''}has non-integer type`, tok);
          suffixes.push({ arr: true, len: null, vla: e });
        }
        continue;
      }
      if (this.is('(')) { this.i++; suffixes.push({ fn: this.paramList() }); continue; }
      break;
    }
    let fnInfo = null;
    for (const s of suffixes) if (s.fn) { fnInfo = s.fn; break; }
    const self = this;
    const wrap = (t) => {
      for (let k = 0; k < nptr; k++) t = ptrTo(t);
      for (let k = suffixes.length - 1; k >= 0; k--) {
        const s = suffixes[k];
        if (s.arr) {
          if (t.k === 'func') self.error(`declaration of ${name ? "'" + name + "' " : ''}as array of functions`, tok);
          if (t.k === 'void') self.error(`declaration of ${name ? "'" + name + "' " : ''}as array of voids`, tok);
          const a = arrOf(t, s.len);
          if (s.vla || t.vla) { a.vla = true; a.vlaExpr = s.vla || null; a.size = null; }
          t = a;
        } else {
          if (t.k === 'arr') self.error(`'${name}' declared as function returning an array`, tok);
          t = { k: 'func', ret: t, params: s.fn.types, variadic: s.fn.variadic, noProto: s.fn.noProto, pnames: s.fn.names, ptoks: s.fn.toks, pscope: s.fn.scope, psyms: s.fn.syms, size: 1, align: 1 };
        }
      }
      return inner ? inner.wrap(t) : t;
    };
    return { name: inner ? inner.name : name, tok: inner ? inner.tok : tok, wrap, fnInfo: inner ? (inner.fnInfo || fnInfo) : fnInfo };
  }
  paramList() {
    const res = { types: [], names: [], toks: [], syms: [], variadic: false, noProto: false, scope: new Map() };
    if (this.accept(')')) { res.noProto = true; return res; }
    if (this.isKw('void') && this.is(')', 1)) { this.i += 2; return res; }
    this.pushScope(res.scope);
    try {
      do {
        if (this.accept('...')) { res.variadic = true; break; }
        const ds = this.declSpec();
        if (!ds) {
          const t = this.peek();
          this.error(t.k === 'id' ? `unknown type name '${t.v}'` : `expected declaration specifiers or '...' before '${tokText(t)}'`, t);
        }
        const d = this.declarator(ds.type, true);
        let t = d.type;
        if (t.k === 'arr') { const p = ptrTo(t.of); if (t.vlaExpr || t.of.vla) p.fromVla = t; t = p; }
        else if (t.k === 'func') t = ptrTo(t);
        if (t.k === 'void' && !d.name) this.error("'void' must be the only parameter", d.tok);
        res.types.push(t); res.names.push(d.name); res.toks.push(d.tok);
        const sym = d.name ? { kind: 'var', name: d.name, type: t, storage: 'param', id: ++symCounter, tok: d.tok, addrTaken: false, vlaSrc: t.fromVla } : null;
        res.syms.push(sym);
        if (sym) res.scope.set(d.name, sym);
      } while (this.accept(','));
    } finally { this.popScope(); }
    this.expect(')');
    return res;
  }
  typeName() {
    const ds = this.declSpec();
    if (!ds) this.error(`expected type name before '${tokText(this.peek())}'`);
    return this.declarator(ds.type, true).type;
  }

  // ---- bildirimler
  declareSym(sym) {
    const scope = this.scopes[this.scopes.length - 1];
    const old = scope.get(sym.name);
    if (old) {
      if (old.kind === 'func' && sym.kind === 'func') return old;
      if (old.kind === 'var' && sym.kind === 'var' && (old.storage === 'extern' || sym.storage === 'extern' || (this.scopes.length === 1 && !(old.init && sym.init)))) {
        if (!sameType(old.type, sym.type) && !(old.type.k === 'arr' && sym.type.k === 'arr')) this.error(`conflicting types for '${sym.name}'`, sym.tok);
        if (sym.storage !== 'extern') old.storage = old.storage === 'extern' ? sym.storage : old.storage;
        if (old.type.k === 'arr' && old.type.len == null && sym.type.len != null) old.type = sym.type;
        return old;
      }
      if (old.kind === 'typedef' && sym.kind === 'typedef' && sameType(old.type, sym.type)) return old;
      this.error(old.kind !== sym.kind && (old.kind === 'typedef' || sym.kind === 'typedef') ? `'${sym.name}' redeclared as different kind of symbol` : `redefinition of '${sym.name}'`, sym.tok);
    }
    scope.set(sym.name, sym);
    return sym;
  }
  declRest(ds, isGlobal) {
    const out = [];
    for (;;) {
      const d = this.declarator(ds.type);
      if (!d.name) { if (ds.type.k === 'struct' && this.is(';')) { this.i++; return out; } this.error(`expected identifier or '(' before '${tokText(this.peek())}'`); }
      if (ds.typedef) {
        this.declareSym({ kind: 'typedef', name: d.name, type: d.type, tok: d.tok });
      } else if (d.type.k === 'func') {
        let sym = this.lookup(d.name);
        if (sym && sym.kind === 'func') {
          if (!sameType(sym.type.ret, d.type.ret) && !sym.builtinDecl) this.error(`conflicting types for '${d.name}'`, d.tok);
          if (sym.builtinDecl) { sym.type = d.type; sym.builtinDecl = false; }
          if (sym.type.noProto && !d.type.noProto) sym.type = d.type;
        } else {
          sym = { kind: 'func', name: d.name, type: d.type, tok: d.tok, id: ++symCounter, storage: ds.storage };
          if (isGlobal) this.declareSym(sym); else { this.prog.globalScope.has(d.name) ? (sym = this.prog.globalScope.get(d.name)) : this.prog.globalScope.set(d.name, sym); this.scopes[this.scopes.length - 1].set(d.name, sym); }
        }
        if (this.is('{')) {
          if (!isGlobal) this.error('function definition is not allowed here', d.tok);
          this.funcDef(sym, d.type, d.tok);
          return null;
        }
      } else {
        if (d.type.k === 'void') this.error(`variable or field '${d.name}' declared void`, d.tok);
        const storage = isGlobal ? (ds.storage === 'extern' ? 'extern' : 'global') : (ds.storage === 'static' ? 'static' : ds.storage === 'extern' ? 'extern' : 'local');
        let sym = { kind: 'var', name: d.name, type: d.type, storage, id: ++symCounter, tok: d.tok, addrTaken: false, fileStatic: isGlobal && ds.storage === 'static' };
        if (this.accept('=')) {
          if (storage === 'extern' && !isGlobal) this.error(`'${d.name}' has both 'extern' and initializer`, d.tok);
          const initTok = this.peek();
          sym = this.declareSym(sym);
          const init = this.initializer();
          if (sym.type.vla) this.error('variable-sized object may not be initialized', initTok);
          sym.init = this.checkInit(sym.type, init, initTok);
          if (sym.storage === 'extern') sym.storage = 'global';
        } else {
          sym = this.declareSym(sym);
        }
        if (sym.type.k === 'struct' && !sym.type.complete && storage !== 'extern') this.error(`storage size of '${d.name}' isn't known`, d.tok);
        if (sym.type.k === 'arr' && sym.type.len == null && !sym.type.vla && storage === 'local') this.error(`array size missing in '${d.name}'`, d.tok);
        if (sym.type.vla && isGlobal) this.error(`variably modified '${d.name}' at file scope`, d.tok);
        if (!isGlobal) {
          if (storage === 'static') { sym.storage = 'static'; this.prog.statics.push(sym); }
          else if (storage === 'local') this.fn.locals.push(sym);
        } else if (!this.prog.globals.includes(sym)) this.prog.globals.push(sym);
        out.push(sym);
      }
      if (this.accept(',')) continue;
      this.expect(';');
      return out;
    }
  }
  initializer() {
    const tok = this.peek();
    if (this.accept('{')) {
      const items = [];
      while (!this.is('}')) {
        let desig = null;
        if (this.is('.') || this.is('[')) {
          desig = [];
          for (;;) {
            if (this.accept('.')) desig.push({ field: this.expectId().v });
            else if (this.accept('[')) { const e = this.condExpr(); this.expect(']'); const v = this.constEval(e); if (v == null) this.error('array index in initializer not of integer type'); desig.push({ index: Number(v) }); }
            else break;
          }
          this.expect('=');
        }
        items.push({ desig, init: this.initializer() });
        if (!this.accept(',')) break;
      }
      this.expect('}');
      return { list: items, tok };
    }
    return { expr: this.assignExpr(), tok };
  }
  // başlatıcıyı {off, type, expr|bytes} listesine düzleştir
  checkInit(type, init, tok) {
    const out = [];
    if (init.expr && !isAgg(type)) { out.push({ off: 0, type, expr: this.convAssign(init.expr, type, init.tok) }); return out; }
    this.flatInit(type, init, 0, out);
    return out;
  }
  flatInit(type, init, off, out) {
    if (init.expr) {
      const e = init.expr;
      if (type.k === 'arr' && isCharT(type.of) && e.n === 'str') {
        if (type.len == null) { type.len = e.bytes.length + 1; type.size = type.len; }
        else if (e.bytes.length > type.len) this.warn('initializer-string for array of \'char\' is too long', init.tok);
        out.push({ off, bytes: e.bytes.slice(0, type.len), type });
        return;
      }
      if (type.k === 'struct' && e.type && e.type.k === 'struct') { out.push({ off, type, expr: this.convAssign(e, type, init.tok) }); return; }
      if (isAgg(type)) { const it = { items: [{ desig: null, init }], i: 0 }; this.fillAgg(type, off, it, out); return; }
      out.push({ off, type, expr: this.convAssign(e, type, init.tok) });
      return;
    }
    if (!isAgg(type)) {
      if (!init.list.length) { out.push({ off, type, expr: { n: 'num', v: convConst(0, T_INT, type), type } }); return; }
      if (init.list.length > 1) this.warn('excess elements in scalar initializer', init.tok);
      this.flatInit(type, init.list[0].init, off, out);
      return;
    }
    const it = { items: init.list, i: 0 };
    this.fillAgg(type, off, it, out);
    if (it.i < it.items.length) this.warn(`excess elements in ${type.k === 'arr' ? 'array' : 'struct'} initializer`, init.tok);
  }
  fillAgg(type, off, it, out) {
    if (type.k === 'arr') {
      const esz = type.of.size;
      let idx = 0, max = 0;
      while (it.i < it.items.length && (type.len == null || idx < type.len || (it.items[it.i].desig && it.items[it.i].desig[0].index != null))) {
        const item = it.items[it.i];
        if (item.desig) {
          if (item.desig[0].index == null) break;
          idx = item.desig[0].index;
          if (type.len != null && idx >= type.len) this.error('array index in initializer exceeds array bounds', item.init.tok);
          if (item.desig.length > 1) { it.i++; this.flatInit(this.desigType(type.of, item.desig.slice(1)).type, item.init, off + idx * esz + this.desigType(type.of, item.desig.slice(1)).off, out); idx++; max = Math.max(max, idx); continue; }
          item.desig = null;
        }
        this.elemInit(type.of, off + idx * esz, it, out);
        idx++; max = Math.max(max, idx);
      }
      if (type.len == null) { type.len = max; type.size = max * esz; }
      return;
    }
    if (type.k === 'struct') {
      if (!type.complete) this.error(`variable has incomplete type '${typeStr(type)}'`);
      const fields = type.fields.filter((f) => f.name);
      let fi = 0;
      while (it.i < it.items.length && fi < (type.union ? 1 : fields.length) + 0) {
        const item = it.items[it.i];
        if (item.desig) {
          if (item.desig[0].field == null) break;
          const k = fields.findIndex((f) => f.name === item.desig[0].field);
          if (k < 0) this.error(`'${typeStr(type)}' has no member named '${item.desig[0].field}'`, item.init.tok);
          fi = k;
          if (item.desig.length > 1) { const dt = this.desigType(fields[fi].type, item.desig.slice(1)); it.i++; this.flatInit(dt.type, item.init, off + fields[fi].offset + dt.off, out); fi++; continue; }
          item.desig = null;
        }
        if (fi >= fields.length) break;
        this.elemInit(fields[fi].type, off + fields[fi].offset, it, out);
        fi++;
        if (type.union) break;
      }
    }
  }
  desigType(t, d) {
    let off = 0;
    for (const x of d) {
      if (x.field != null) { const f = t.fieldMap && t.fieldMap.get(x.field); if (!f) this.error(`unknown field '${x.field}' specified in initializer`); off += f.offset; t = f.type; }
      else { off += x.index * t.of.size; t = t.of; }
    }
    return { type: t, off };
  }
  elemInit(t, off, it, out) {
    const item = it.items[it.i];
    if (item.init.list) { it.i++; this.flatInit(t, item.init, off, out); return; }
    const e = item.init.expr;
    if (isAgg(t) && !(t.k === 'arr' && isCharT(t.of) && e.n === 'str') && !(t.k === 'struct' && e.type && e.type.k === 'struct')) { this.fillAgg(t, off, it, out); return; }
    it.i++;
    this.flatInit(t, item.init, off, out);
  }

  // ---- fonksiyon tanımı
  funcDef(sym, ftype, tok) {
    if (sym.defined) this.error(`redefinition of '${sym.name}'`, tok);
    sym.defined = true; sym.type = ftype; sym.tok = tok;
    const fn = { sym, type: ftype, params: [], locals: [], tok, name: sym.name };
    if (ftype.ret.k === 'arr') this.error('function cannot return array type', tok);
    const scope = ftype.pscope || new Map();
    (ftype.psyms || []).forEach((p, k) => { if (!p && !ftype.noProto) this.error(`parameter name omitted`, ftype.ptoks[k]); });
    fn.params = (ftype.psyms || []).filter(Boolean);
    const saveFn = this.fn;
    this.fn = fn;
    this.pushScope(scope);
    scope.set('__func__', { kind: 'var', name: '__func__', funcName: true, type: arrOf(T_CHAR, sym.name.length + 1) });
    try { fn.body = this.compound(true); }
    finally { this.popScope(); this.fn = saveFn; }
    this.prog.funcs.push(fn);
  }

  // ---- ifadeler (statements)
  compound(noScope) {
    const open = this.peek();
    this.expect('{');
    if (!noScope) this.pushScope();
    const items = [];
    const blk = { s: 'block', items, hasVla: false, tok: open };
    try {
      while (!this.is('}')) {
        if (this.peek().k === 'eof') this.error("expected declaration or statement at end of input");
        const start = this.i;
        try {
          const st = this.statementOrDecl(blk);
          if (st) items.push(st);
        } catch (e) {
          if (!(e instanceof CError)) throw e;
          this.report(e);
          if (this.diags.filter((d) => d.sev !== 'warning').length > 40) throw e;
          this.recoverStmt(start);
        }
      }
      this.i++;
    } finally { if (!noScope) this.popScope(); }
    return blk;
  }
  recoverStmt(start) {
    if (this.i === start) this.i++;
    let depth = 0;
    while (this.peek().k !== 'eof') {
      const t = this.peek();
      if (t.k === 'p') {
        if (t.v === '{') depth++;
        else if (t.v === '}') { if (depth === 0) return; depth--; if (depth === 0) { this.i++; return; } }
        else if (t.v === ';' && depth === 0) { this.i++; return; }
      }
      this.i++;
    }
  }
  statementOrDecl(blk) {
    const t = this.peek();
    if (this.isDeclStart() && !(t.k === 'id' && this.is(':', 1) && !TYPE_KW.has(t.v))) {
      const ds = this.declSpec();
      if (this.accept(';')) return null;
      const syms = this.declRest(ds, false);
      if (!syms) return null;
      const vars = syms.filter((s) => s.kind === 'var' && s.storage === 'local');
      if (vars.some((s) => s.type.vla)) blk.hasVla = true;
      return vars.length ? { s: 'decl', syms: vars, tok: t } : null;
    }
    return this.statement();
  }
  statement() {
    const t = this.peek();
    if (t.k === 'bad') this.error(t.msg, t);
    if (t.k === 'p') {
      if (t.v === '{') return this.compound(false);
      if (t.v === ';') { this.i++; return { s: 'empty', tok: t }; }
    }
    if (t.k === 'id') {
      switch (t.v) {
        case 'if': {
          this.i++; this.expect('(');
          const c = this.cond(this.expr());
          this.expect(')');
          const a = this.subStmt();
          let b = null;
          if (this.isKw('else')) { this.i++; b = this.subStmt(); }
          return { s: 'if', c, a, b, tok: t };
        }
        case 'while': {
          this.i++; this.expect('(');
          const c = this.cond(this.expr());
          this.expect(')');
          this.loopDepth++;
          const body = this.subStmt();
          this.loopDepth--;
          return { s: 'while', c, body, tok: t };
        }
        case 'do': {
          this.i++;
          this.loopDepth++;
          const body = this.subStmt();
          this.loopDepth--;
          if (!this.isKw('while')) this.error(`expected 'while' before '${tokText(this.peek())}'`);
          this.i++; this.expect('(');
          const c = this.cond(this.expr());
          this.expect(')'); this.expect(';');
          return { s: 'do', c, body, tok: t };
        }
        case 'for': {
          this.i++; this.expect('(');
          this.pushScope();
          const blk = { s: 'block', items: [], hasVla: false, tok: t };
          try {
            let init = null;
            if (this.isDeclStart()) { const ds = this.declSpec(); const syms = this.declRest(ds, false) || []; const vars = syms.filter((s) => s.kind === 'var' && s.storage === 'local'); init = vars.length ? { s: 'decl', syms: vars, tok: t } : null; }
            else if (!this.accept(';')) { init = { s: 'expr', e: this.expr(), tok: t }; this.expect(';'); }
            const c = this.is(';') ? null : this.cond(this.expr());
            this.expect(';');
            const step = this.is(')') ? null : this.expr();
            this.expect(')');
            this.loopDepth++;
            const body = this.subStmt();
            this.loopDepth--;
            blk.items.push({ s: 'for', init, c, step, body, tok: t });
          } finally { this.popScope(); }
          return blk;
        }
        case 'switch': {
          this.i++; this.expect('(');
          let e = this.rval(this.expr());
          if (!isInt(e.type)) this.error('switch quantity not an integer', t);
          e = this.cast(e, promote(e.type));
          this.expect(')');
          const sw = { s: 'switch', e, body: null, cases: [], tok: t };
          this.switchStack.push(sw);
          try { sw.body = this.subStmt(); } finally { this.switchStack.pop(); }
          return sw;
        }
        case 'case': {
          this.i++;
          const sw = this.switchStack[this.switchStack.length - 1];
          if (!sw) this.error("case label not within a switch statement", t);
          const e = this.condExpr();
          const v = this.constEval(e);
          if (v == null) this.error('case label does not reduce to an integer constant', t);
          let v2 = null;
          if (this.accept('...')) { const e2 = this.condExpr(); v2 = this.constEval(e2); }
          this.expect(':');
          const cv = convConst(v, this.rval(e).type, sw.e.type);
          if (sw.cases.some((c) => c === cv || (typeof c === 'bigint' && c === cv))) this.error('duplicate case value', t);
          sw.cases.push(cv);
          const vals = [cv];
          if (v2 != null) for (let x = Number(v) + 1; x <= Number(v2); x++) vals.push(convConst(x, T_INT, sw.e.type));
          return { s: 'case', vals, tok: t };
        }
        case 'default': {
          if (this.is(':', 1)) {
            this.i += 2;
            const sw = this.switchStack[this.switchStack.length - 1];
            if (!sw) this.error("'default' label not within a switch statement", t);
            if (sw.hasDefault) this.error('multiple default labels in one switch', t);
            sw.hasDefault = true;
            return { s: 'default', tok: t };
          }
          break;
        }
        case 'break':
          this.i++; this.expect(';');
          if (!this.loopDepth && !this.switchStack.length) this.error('break statement not within loop or switch', t);
          return { s: 'break', tok: t };
        case 'continue':
          this.i++; this.expect(';');
          if (!this.loopDepth) this.error('continue statement not within a loop', t);
          return { s: 'continue', tok: t };
        case 'return': {
          this.i++;
          const rt = this.fn.type.ret;
          let e = null;
          if (!this.is(';')) {
            e = this.expr();
            if (rt.k === 'void') { this.warn(`'return' with a value, in function returning void`, t); e = this.cast(this.rval(e), T_VOID); }
            else e = this.convAssign(e, rt, t, 'return');
          } else if (rt.k !== 'void' && this.fn.name !== 'main') this.warn(`'return' with no value, in function returning non-void`, t);
          this.expect(';');
          return { s: 'return', e, tok: t };
        }
        case 'goto':
          this.error("'goto' bu derleyicide desteklenmiyor (döngü/break kullan)", t);
          break;
        case 'else':
          this.error(`'else' without a previous 'if'`, t);
      }
      if (this.is(':', 1) && !TYPE_KW.has(t.v)) { this.i += 2; return this.is('}') ? { s: 'empty', tok: t } : this.statement(); }
    }
    const e = this.expr();
    this.expect(';');
    return { s: 'expr', e, tok: t };
  }
  subStmt() {
    const blk = { s: 'block', items: [], hasVla: false, tok: this.peek() };
    this.pushScope();
    try {
      if (this.isDeclStart()) this.error(`a label can only be part of a statement and a declaration is not a statement`);
      const st = this.statement();
      return st;
    } finally { this.popScope(); }
  }
  cond(e) {
    e = this.rval(e);
    if (!isScalar(e.type)) this.error(`used ${typeStr(e.type)} type value where scalar is required`, e.tok);
    return e;
  }

  // ---- ifade (expression) ayrıştırma
  expr() {
    let e = this.assignExpr();
    while (this.is(',')) {
      const t = this.next();
      const b = this.assignExpr();
      e = { n: 'comma', a: e, b: this.rval(b), type: this.rval(b).type, tok: t };
    }
    return e;
  }
  assignExpr() {
    const l = this.condExpr();
    const t = this.peek();
    if (t.k === 'p' && ASSIGN_OPS.has(t.v)) {
      this.i++;
      const r = this.assignExpr();
      return this.mkAssign(t.v, l, r, t);
    }
    return l;
  }
  condExpr() {
    const c = this.binary(1);
    if (this.is('?')) {
      const t = this.next();
      const a = this.expr();
      this.expect(':');
      const b = this.condExpr();
      return this.mkCond(c, a, b, t);
    }
    return c;
  }
  binary(minPrec) {
    let l = this.castExpr();
    for (;;) {
      const t = this.peek();
      if (t.k !== 'p') break;
      const p = BIN_PREC[t.v];
      if (!p || p < minPrec) break;
      this.i++;
      const r = this.binary(p + 1);
      l = this.mkBin(t.v, l, r, t);
    }
    return l;
  }
  castExpr() {
    if (this.is('(') && this.isTypeName(this.peek(1))) {
      const t = this.next();
      const type = this.typeName();
      this.expect(')');
      if (this.is('{')) { // bileşik değişmez (compound literal)
        const init = this.initializer();
        if (!this.fn) this.error('compound literal at file scope not supported', t);
        const sym = { kind: 'var', name: '$cl' + (++symCounter), type, storage: 'local', id: symCounter, tok: t, addrTaken: true };
        sym.init = this.checkInit(type, init, t);
        this.fn.locals.push(sym);
        return { n: 'cl', sym, type, lv: true, tok: t };
      }
      const e = this.castExpr();
      return this.mkCast(type, e, t, true);
    }
    return this.unary();
  }
  unary() {
    const t = this.peek();
    if (t.k === 'p') {
      switch (t.v) {
        case '++': case '--': { this.i++; const e = this.unary(); return this.mkIncDec(t.v, e, true, t); }
        case '&': { this.i++; return this.mkAddr(this.castExpr(), t); }
        case '*': { this.i++; return this.mkDeref(this.castExpr(), t); }
        case '+': case '-': case '~': case '!': { this.i++; return this.mkUnary(t.v, this.castExpr(), t); }
      }
    }
    if (t.k === 'id' && (t.v === 'sizeof' || t.v === '_Alignof' || t.v === 'alignof')) {
      this.i++;
      let type;
      if (this.is('(') && this.isTypeName(this.peek(1))) { this.i++; type = this.typeName(); this.expect(')'); }
      else { const e = this.unary(); type = e.type; if (e.n === 'decay') type = e.e.type; }
      if (type.k === 'func') this.error("invalid application of 'sizeof' to a function type", t);
      if (type.k === 'void') return { n: 'num', v: 1, type: T_UINT, tok: t };
      if (t.v !== 'sizeof') return { n: 'num', v: type.align || 1, type: T_UINT, tok: t };
      if (type.vla) return { n: 'vlasize', vtype: type, type: T_UINT, tok: t };
      if (type.size == null || (type.k === 'struct' && !type.complete)) this.error(`invalid application of 'sizeof' to incomplete type '${typeStr(type)}'`, t);
      return { n: 'num', v: type.size, type: T_UINT, tok: t };
    }
    return this.postfix();
  }
  postfix() {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (t.k !== 'p') break;
      if (t.v === '[') {
        this.i++;
        const idx = this.expr();
        this.expect(']');
        const a = this.rval(e), b = this.rval(idx);
        if (!isPtr(a.type) && !isPtr(b.type)) this.error('subscripted value is neither array nor pointer nor vector', t);
        if (isPtr(a.type) && !isInt(b.type)) this.error('array subscript is not an integer', t);
        e = this.mkDeref(this.mkBin('+', a, b, t), t);
        continue;
      }
      if (t.v === '(') { this.i++; e = this.mkCall(e, t); continue; }
      if (t.v === '.' || t.v === '->') {
        this.i++;
        const nt = this.expectId();
        e = this.mkMember(e, nt.v, t.v === '->', t, nt);
        continue;
      }
      if (t.v === '++' || t.v === '--') { this.i++; e = this.mkIncDec(t.v, e, false, t); continue; }
      break;
    }
    return e;
  }
  primary() {
    const t = this.next();
    switch (t.k) {
      case 'num': return this.numNode(t);
      case 'chr':
        if (t.multi) this.warn('multi-character character constant', t);
        return { n: 'num', v: t.v, type: T_INT, tok: t };
      case 'str': {
        let bytes = t.bytes.slice();
        while (this.peek().k === 'str') bytes = bytes.concat(this.next().bytes);
        return { n: 'str', bytes, type: arrOf(T_CHAR, bytes.length + 1), lv: true, tok: t };
      }
      case 'id': {
        if (TYPE_KW.has(t.v)) this.error(`expected expression before '${t.v}'`, t);
        if (RESERVED_NO_ID.has(t.v) || t.v === 'else') this.error(`expected expression before '${t.v}'`, t);
        const s = this.lookup(t.v);
        if (!s) {
          if (this.is('(')) this.error(`implicit declaration of function '${t.v}'${SUGGEST[t.v] ? '; did you mean \'' + SUGGEST[t.v] + '\'?' : ''}`, t);
          this.error(`'${t.v}' undeclared${this.fn ? ' (first use in this function)' : ' here (not in a function)'}`, t);
        }
        if (s.kind === 'typedef') this.error(`expected expression before '${t.v}'`, t);
        if (s.kind === 'enum') return { n: 'num', v: s.value, type: T_INT, tok: t };
        if (s.funcName) return { n: 'str', bytes: strToBytes(this.fn ? this.fn.name : ''), type: arrOf(T_CHAR, (this.fn ? this.fn.name.length : 0) + 1), lv: true, tok: t };
        s.used = true;
        return { n: 'var', sym: s, type: s.type, lv: s.kind === 'var', tok: t };
      }
      case 'p':
        if (t.v === '(') {
          if (this.is('{')) this.error('statement expressions are not supported', t);
          const e = this.expr();
          this.expect(')');
          e.paren = true;
          return e;
        }
        break;
      case 'bad': this.error(t.msg, t);
    }
    if (t.k === 'eof') this.error('expected expression at end of input', t);
    this.error(`expected expression before '${tokText(t)}'`, t);
  }
  numNode(t) {
    const text = t.text, s = t.suffix || '';
    const isHex = /^0[xX]/.test(text), isBin = /^0[bB]/.test(text);
    if (!/^(u|l|ul|lu|ll|ull|llu|f|lf|uz|z)?$/.test(s) && !(isHex && /^[ul]*$/.test(s))) this.error(`invalid suffix "${t.suffix}" on ${/[.eE]/.test(text) && !isHex ? 'floating' : 'integer'} constant`, t);
    if (!isHex && !isBin && (/[.eE]/.test(text) || s.includes('f'))) {
      const v = parseFloat(text);
      if (s === 'f') return { n: 'num', v: Math.fround(v), type: T_FLOAT, tok: t };
      return { n: 'num', v, type: T_DOUBLE, tok: t };
    }
    let v;
    if (isHex) v = BigInt(text);
    else if (isBin) v = BigInt('0b' + text.slice(2));
    else if (text.length > 1 && text[0] === '0') { if (/[89]/.test(text)) this.error(`invalid digit "${text.match(/[89]/)[0]}" in octal constant`, t); v = BigInt('0o' + text.slice(1)); }
    else v = BigInt(text);
    const u = s.includes('u'), l = s.includes('l');
    let type;
    if (l) type = u ? T_ULONG : (v <= 0x7fffffffffffffffn ? T_LONG : T_ULONG);
    else if (u) type = v <= 0xffffffffn ? T_UINT : T_ULONG;
    else if (v <= 0x7fffffffn) type = T_INT;
    else if ((isHex || isBin || text[0] === '0') && v <= 0xffffffffn) type = T_UINT;
    else if (v <= 0x7fffffffffffffffn) type = T_LONG;
    else { this.warn('integer constant is so large that it is unsigned', t); type = T_ULONG; }
    return { n: 'num', v: convConst(v, T_LONG, type), type, tok: t };
  }

  // ---- tip denetimli düğüm kurucular
  rval(e) {
    if (!e.type) return e;
    if (e.type.k === 'arr') return { n: 'decay', e, type: ptrTo(e.type.of), tok: e.tok };
    if (e.type.k === 'func') return { n: 'fnaddr', e, type: ptrTo(e.type), tok: e.tok };
    return e;
  }
  cast(e, type) {
    if (e.type === type) return e;
    if (type.k === 'void') return { n: 'cast', e, type, tok: e.tok };
    if (e.type.k === type.k && (type.k === 'ptr' || ((type.k === 'int' || type.k === 'flt') && e.type.size === type.size && e.type.uns === type.uns && !!e.type.bool === !!type.bool))) {
      if (e.n === 'num') return Object.assign({}, e, { type });
      return { n: 'cast', e, type, tok: e.tok, nop: true };
    }
    if (e.n === 'num' && isScalar(type) && isScalar(e.type)) return { n: 'num', v: convConst(e.v, e.type, type), type, tok: e.tok };
    return { n: 'cast', e, type, tok: e.tok };
  }
  isNullConst(e) { return e.n === 'num' && isInt(e.type) && Number(e.v) === 0 || (e.n === 'cast' && isVoidP(e.type) && e.e.n === 'num' && Number(e.e.v) === 0); }
  convAssign(e, t, tok, ctx) {
    e = this.rval(e);
    const et = e.type;
    const where = ctx === 'return' ? 'returning' : ctx === 'arg' ? 'passing argument' : 'assignment';
    if (t.k === 'struct') {
      if (et !== t) this.error(`incompatible types when ${ctx === 'return' ? 'returning type' : ctx === 'arg' ? 'passing' : 'assigning to type'} '${typeStr(t)}' ${ctx === 'arg' ? '' : 'from type'} '${typeStr(et)}'`, tok);
      return e;
    }
    if (et.k === 'void') this.error('void value not ignored as it ought to be', tok);
    if (et.k === 'struct') this.error(`incompatible types when ${ctx === 'return' ? 'returning' : 'assigning to'} type '${typeStr(t)}' from type '${typeStr(et)}'`, tok);
    if (isPtr(t)) {
      if (isInt(et)) { if (!this.isNullConst(e)) this.warn(`${where} makes pointer from integer without a cast [-Wint-conversion]`, tok); }
      else if (isPtr(et)) {
        if (!sameType(t, et) && !isVoidP(t) && !isVoidP(et) && !(isCharT(t.to) && isCharT(et.to))) this.warn(`${where} from incompatible pointer type '${typeStr(et)}' to '${typeStr(t)}' [-Wincompatible-pointer-types]`, tok);
      } else if (isFlt(et)) this.error(`incompatible types when ${where === 'assignment' ? 'assigning to' : 'initializing'} type '${typeStr(t)}' from type '${typeStr(et)}'`, tok);
    } else if (isArith(t) && isPtr(et)) {
      if (t.bool) return this.cast(e, t);
      if (isFlt(t)) this.error(`incompatible types when assigning to type '${typeStr(t)}' from type '${typeStr(et)}'`, tok);
      this.warn(`${where} makes integer from pointer without a cast [-Wint-conversion]`, tok);
    }
    return this.cast(e, t);
  }
  mkCast(type, e, tok, explicit) {
    e = this.rval(e);
    if (type.k === 'void') return { n: 'cast', e, type: T_VOID, tok };
    if (type.k === 'struct' || type.k === 'arr') this.error(`conversion to non-scalar type requested`, tok);
    if (!isScalar(e.type)) this.error(`${e.type.k === 'void' ? 'void value not ignored as it ought to be' : 'aggregate value used where a scalar was expected'}`, tok);
    if ((isPtr(type) && isFlt(e.type)) || (isFlt(type) && isPtr(e.type))) this.error(`cannot convert to a pointer type`, tok);
    return this.cast(e, type);
  }
  mkUnary(op, e, tok) {
    e = this.rval(e);
    if (op === '!') {
      if (!isScalar(e.type)) this.error(`wrong type argument to unary exclamation mark`, tok);
      if (e.n === 'num') return { n: 'num', v: (typeof e.v === 'bigint' ? e.v === 0n : e.v === 0) ? 1 : 0, type: T_INT, tok };
      return { n: 'not', e, type: T_INT, tok };
    }
    if (!isArith(e.type) || (op === '~' && !isInt(e.type))) this.error(`wrong type argument to ${op === '~' ? 'bit-complement' : 'unary ' + (op === '-' ? 'minus' : 'plus')}`, tok);
    const t = isInt(e.type) ? promote(e.type) : e.type;
    e = this.cast(e, t);
    if (op === '+') return e;
    if (e.n === 'num') {
      if (isFlt(t)) return { n: 'num', v: op === '-' ? -e.v : e.v, type: t, tok };
      const v = BigInt(e.v);
      return { n: 'num', v: convConst(op === '-' ? -v : ~v, T_LONG, t), type: t, tok };
    }
    return { n: op === '-' ? 'neg' : 'bnot', e, type: t, tok };
  }
  mkBin(op, l, r, tok) {
    l = this.rval(l); r = this.rval(r);
    const lt = l.type, rt = r.type;
    const bad = () => this.error(`invalid operands to binary ${op} (have '${typeStr(lt)}' and '${typeStr(rt)}')`, tok);
    if (lt.k === 'void' || rt.k === 'void' || lt.k === 'struct' || rt.k === 'struct') bad();
    switch (op) {
      case '+': case '-': {
        if (isPtr(lt) && isInt(rt)) { if (lt.to.k === 'void' || lt.to.k === 'func') this.warn('pointer of type \'void *\' used in arithmetic', tok); return { n: 'padd', p: l, i: this.cast(r, is64(rt) ? T_INT : promote(rt)), neg: op === '-', type: lt, tok }; }
        if (op === '+' && isInt(lt) && isPtr(rt)) return { n: 'padd', p: r, i: this.cast(l, is64(lt) ? T_INT : promote(lt)), neg: false, type: rt, tok };
        if (op === '-' && isPtr(lt) && isPtr(rt)) { if (!sameType(lt.to, rt.to)) this.error(`invalid operands to binary - (have '${typeStr(lt)}' and '${typeStr(rt)}')`, tok); return { n: 'pdiff', a: l, b: r, elem: lt.to, type: T_INT, tok }; }
        if (!isArith(lt) || !isArith(rt)) bad();
        return this.arith(op, l, r, tok);
      }
      case '*': case '/':
        if (!isArith(lt) || !isArith(rt)) bad();
        return this.arith(op, l, r, tok);
      case '%': case '&': case '|': case '^':
        if (!isInt(lt) || !isInt(rt)) bad();
        return this.arith(op, l, r, tok);
      case '<<': case '>>': {
        if (!isInt(lt) || !isInt(rt)) bad();
        const t = promote(lt);
        const L = this.cast(l, t), R = this.cast(r, T_INT);
        if (L.n === 'num' && R.n === 'num') {
          const s = BigInt(R.v & 63);
          return { n: 'num', v: convConst(op === '<<' ? BigInt(L.v) << s : BigInt(L.v) >> s, T_LONG, t), type: t, tok };
        }
        return { n: 'bin', op, l: L, r: R, type: t, tok };
      }
      case '<': case '>': case '<=': case '>=': case '==': case '!=': {
        if (isArith(lt) && isArith(rt)) {
          const t = arithConv(lt, rt);
          const L = this.cast(l, t), R = this.cast(r, t);
          if (L.n === 'num' && R.n === 'num') { const a = L.v, b = R.v; const res = op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : op === '>=' ? a >= b : op === '==' ? a === b : a !== b; return { n: 'num', v: res ? 1 : 0, type: T_INT, tok }; }
          if (lt.uns !== rt.uns && isInt(lt) && isInt(rt) && promote(lt).size === 4 && promote(rt).size === 4 && (op[0] === '<' || op[0] === '>') && !(l.n === 'num' && Number(l.v) >= 0) && !(r.n === 'num' && Number(r.v) >= 0)) this.warn(`comparison of integer expressions of different signedness: '${typeStr(lt)}' and '${typeStr(rt)}' [-Wsign-compare]`, tok);
          return { n: 'cmp', op, l: L, r: R, type: T_INT, tok };
        }
        if (isPtr(lt) && isPtr(rt)) return { n: 'cmp', op, l, r, type: T_INT, tok };
        if (isPtr(lt) && isInt(rt)) { if (!this.isNullConst(r)) this.warn('comparison between pointer and integer', tok); return { n: 'cmp', op, l, r: this.cast(r, lt), type: T_INT, tok }; }
        if (isInt(lt) && isPtr(rt)) { if (!this.isNullConst(l)) this.warn('comparison between pointer and integer', tok); return { n: 'cmp', op, l: this.cast(l, rt), r, type: T_INT, tok }; }
        bad();
      }
      case '&&': case '||':
        if (!isScalar(lt) || !isScalar(rt)) bad();
        return { n: 'logic', op, l, r, type: T_INT, tok };
    }
    bad();
  }
  arith(op, l, r, tok) {
    const t = arithConv(l.type, r.type);
    const L = this.cast(l, t), R = this.cast(r, t);
    if (L.n === 'num' && R.n === 'num') {
      if (isFlt(t)) {
        let v = op === '+' ? L.v + R.v : op === '-' ? L.v - R.v : op === '*' ? L.v * R.v : L.v / R.v;
        return { n: 'num', v: t.size === 4 ? Math.fround(v) : v, type: t, tok };
      }
      const a = BigInt(L.v), b = BigInt(R.v);
      if ((op === '/' || op === '%') && b === 0n) { this.warn('division by zero [-Wdiv-by-zero]', tok); return { n: 'bin', op, l: L, r: R, type: t, tok }; }
      const v = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : op === '%' ? a % b : op === '&' ? a & b : op === '|' ? a | b : a ^ b;
      return { n: 'num', v: convConst(v, T_LONG, t), type: t, tok };
    }
    if ((op === '/' || op === '%') && R.n === 'num' && isInt(t) && Number(R.v) === 0) this.warn('division by zero [-Wdiv-by-zero]', tok);
    return { n: 'bin', op, l: L, r: R, type: t, tok };
  }
  mkCond(c, a, b, tok) {
    c = this.cond(c); a = this.rval(a); b = this.rval(b);
    let t;
    if (isArith(a.type) && isArith(b.type)) t = arithConv(a.type, b.type);
    else if (a.type.k === 'void' || b.type.k === 'void') t = T_VOID;
    else if (a.type.k === 'struct' && a.type === b.type) t = a.type;
    else if (isPtr(a.type) && isPtr(b.type)) t = isVoidP(a.type) ? b.type : a.type;
    else if (isPtr(a.type) && this.isNullConst(b)) t = a.type;
    else if (isPtr(b.type) && this.isNullConst(a)) t = b.type;
    else if (isPtr(a.type) && isInt(b.type)) { this.warn('pointer/integer type mismatch in conditional expression', tok); t = a.type; }
    else if (isPtr(b.type) && isInt(a.type)) { this.warn('pointer/integer type mismatch in conditional expression', tok); t = b.type; }
    else this.error('type mismatch in conditional expression', tok);
    if (t.k !== 'struct' && t.k !== 'void') { a = this.cast(a, t); b = this.cast(b, t); }
    if (c.n === 'num') return (typeof c.v === 'bigint' ? c.v !== 0n : c.v !== 0) ? a : b;
    return { n: 'cond', c, a, b, type: t, tok };
  }
  checkLvalue(e, tok, what) {
    if (!e.lv) this.error(`lvalue required as ${what || 'left operand of assignment'}`, tok);
    if (e.type.k === 'arr') this.error(`assignment to expression with array type`, tok);
    if (e.type.k === 'func') this.error(`lvalue required as ${what || 'left operand of assignment'}`, tok);
  }
  mkAssign(op, l, r, tok) {
    this.checkLvalue(l, tok);
    if (l.type.k === 'struct' && !l.type.complete) this.error('invalid use of incomplete type', tok);
    if (op === '=') {
      const rr = this.rval(r);
      if (r.n === 'assign' && false) {}
      return { n: 'assign', l, r: this.convAssign(rr, l.type, tok), type: l.type, tok };
    }
    const bop = op.slice(0, -1);
    const ph = { n: 'ph', type: l.type, tok };
    const opNode = this.mkBin(bop, ph, r, tok);
    const val = this.convAssign(opNode, l.type, tok);
    return { n: 'cassign', l, ph, val, type: l.type, tok };
  }
  mkIncDec(op, e, pre, tok) {
    this.checkLvalue(e, tok, (pre ? (op === '++' ? 'increment' : 'decrement') + ' operand' : (op === '++' ? 'increment' : 'decrement') + ' operand'));
    if (!isScalar(e.type)) this.error(`wrong type argument to ${op === '++' ? 'increment' : 'decrement'}`, tok);
    const ph = { n: 'ph', type: e.type, tok };
    const one = { n: 'num', v: 1, type: T_INT, tok };
    const val = this.cast(this.mkBin(op === '++' ? '+' : '-', ph, one, tok), e.type);
    return { n: pre ? 'preinc' : 'postinc', l: e, ph, val, type: e.type, tok };
  }
  mkAddr(e, tok) {
    if (e.n === 'deref') return this.rval(e.e).type.k === 'ptr' ? Object.assign({}, this.rval(e.e), { type: ptrTo(e.type) }) : e.e;
    if (e.type.k === 'func') { if (e.n === 'var') return { n: 'fnaddr', e, type: ptrTo(e.type), tok }; }
    if (!e.lv) this.error('lvalue required as unary \'&\' operand', tok);
    if (e.n === 'var') {
      if (e.sym.kind !== 'var') this.error('lvalue required as unary \'&\' operand', tok);
      e.sym.addrTaken = true;
    }
    return { n: 'addr', e, type: ptrTo(e.type), tok };
  }
  mkDeref(e, tok) {
    e = this.rval(e);
    if (!isPtr(e.type)) this.error(`invalid type argument of unary '*' (have '${typeStr(e.type)}')`, tok);
    if (e.type.to.k === 'func') return e;
    if (e.type.to.k === 'void') this.error("dereferencing 'void *' pointer", tok);
    if (e.type.to.k === 'struct' && !e.type.to.complete) this.error(`dereferencing pointer to incomplete type '${typeStr(e.type.to)}'`, tok);
    return { n: 'deref', e, type: e.type.to, lv: true, tok };
  }
  mkMember(e, name, arrow, tok, nt) {
    let base = e;
    if (arrow) {
      const r = this.rval(e);
      if (!isPtr(r.type) || r.type.to.k !== 'struct') {
        if (r.type.k === 'struct') this.error(`invalid type argument of '->' (have '${typeStr(r.type)}'); did you mean '.'?`, tok);
        this.error(`invalid type argument of '->' (have '${typeStr(r.type)}')`, tok);
      }
      base = this.mkDeref(r, tok);
    } else if (e.type.k !== 'struct') {
      if (isPtr(e.type) && e.type.to.k === 'struct') this.error(`'${typeStr(e.type)}' is a pointer; did you mean to use '->'?`, tok);
      this.error(`request for member '${name}' in something not a structure or union`, tok);
    }
    const st = base.type;
    if (!st.complete) this.error(`invalid use of incomplete typedef '${typeStr(st)}'`, tok);
    const f = st.fieldMap.get(name);
    if (!f) this.error(`'${typeStr(st)}' has no member named '${name}'`, nt);
    return { n: 'member', e: base, off: f.offset, type: f.type, lv: base.lv !== false, tok };
  }
  mkCall(f, tok) {
    const args = [];
    if (!this.is(')')) {
      do { args.push(this.assignExpr()); } while (this.accept(','));
    }
    this.expect(')');
    let ft;
    let direct = null;
    if (f.n === 'var' && f.sym.kind === 'func') { ft = f.sym.type; direct = f.sym; }
    else {
      const r = this.rval(f);
      if (isPtr(r.type) && r.type.to.k === 'func') { ft = r.type.to; f = r; }
      else this.error(`called object ${f.n === 'var' ? "'" + f.sym.name + "' " : ''}is not a function or function pointer`, tok);
    }
    const name = direct ? direct.name : 'function';
    const np = ft.params.length;
    if (!ft.noProto) {
      if (args.length < np) this.error(`too few arguments to function '${name}'`, tok);
      if (args.length > np && !ft.variadic) this.error(`too many arguments to function '${name}'`, tok);
    }
    const conv = args.map((a, k) => {
      if (k < np && !ft.noProto) return this.convAssign(a, ft.params[k], a.tok || tok, 'arg');
      let r = this.rval(a);
      if (r.type.k === 'void') this.error('invalid use of void expression', tok);
      if (isFlt(r.type) && r.type.size === 4) r = this.cast(r, T_DOUBLE);
      else if (isInt(r.type)) r = this.cast(r, promote(r.type));
      return r;
    });
    if (direct && FORMAT_FUNCS[direct.name] != null && !direct.defined) this.checkFormat(direct.name, conv, FORMAT_FUNCS[direct.name], tok);
    const node = { n: 'call', f, direct, args: conv, type: ft.ret, ftype: ft, tok };
    if (ft.ret.k === 'struct' && this.fn) { const sym = { kind: 'var', name: '$sr' + (++symCounter), type: ft.ret, storage: 'local', id: symCounter, addrTaken: true }; this.fn.locals.push(sym); node.retSym = sym; }
    return node;
  }
  checkFormat(name, args, fi, tok) {
    const fmtArg = args[fi];
    if (!fmtArg) return;
    let fe = fmtArg;
    while (fe.n === 'cast' || fe.n === 'decay') fe = fe.e;
    if (fe.n !== 'str') return;
    const fmt = bytesToLatin(fe.bytes);
    const isScan = /scanf$/.test(name);
    let ai = fi + 1;
    const re = /%([-+ #0]*)(\*?)(\d+|\*)?(?:\.(\d+|\*))?(hh|h|ll|l|L|z|j|t)?([diouxXcsfFeEgGpn%]|\[\^?\]?[^\]]*\])/g;
    let m;
    while ((m = re.exec(fmt))) {
      const conv = m[6], len = m[5] || '';
      if (conv === '%') continue;
      if (!isScan && m[3] === '*') ai++;
      if (!isScan && m[4] === '*') ai++;
      if (isScan && m[2] === '*') continue;
      const a = args[ai];
      const argNo = ai + 1;
      if (!a) { this.warn(`format '%${len}${conv}' expects a matching argument [-Wformat=]`, tok); return; }
      ai++;
      const t = a.type;
      let want = null, ok = true;
      if (!isScan) {
        if ('diouxXc'.includes(conv)) { want = (len === 'l' || len === 'll') ? 'long' : 'int'; ok = isInt(t); }
        else if ('fFeEgG'.includes(conv)) { want = 'double'; ok = isFlt(t); }
        else if (conv === 's') { want = 'char *'; ok = isPtr(t) && (isCharT(t.to) || t.to.k === 'void'); }
        else if (conv === 'p') { want = 'void *'; ok = isPtr(t); }
        else continue;
        if (!ok) this.warn(`format '%${len}${conv}' expects argument of type '${want === 'long' ? (conv === 'u' || conv === 'x' ? 'long unsigned int' : 'long int') : want === 'int' ? (conv === 'u' || conv === 'x' || conv === 'X' || conv === 'o' ? 'unsigned int' : 'int') : want}', but argument ${argNo} has type '${typeStr(t)}' [-Wformat=]`, a.tok || tok);
      } else {
        if (!isPtr(t)) {
          this.warn(`format '%${len}${conv}' expects argument of type '${conv === 's' || conv === 'c' || conv[0] === '[' ? 'char *' : 'fFeEgG'.includes(conv) ? (len === 'l' ? 'double *' : 'float *') : (len === 'l' || len === 'll' ? 'long int *' : 'int *')}', but argument ${argNo} has type '${typeStr(t)}' [-Wformat=]${isArith(t) ? "  (& unutulmuş olabilir)" : ''}`, a.tok || tok);
          continue;
        }
        const to = t.to;
        if ('di'.includes(conv) || 'uoxX'.includes(conv)) { const sz = len === 'hh' ? 1 : len === 'h' ? 2 : len === 'l' || len === 'll' ? 8 : 4; ok = isInt(to) && to.size === sz; want = (len === 'l' || len === 'll' ? 'long int *' : len === 'h' ? 'short int *' : len === 'hh' ? 'char *' : 'int *'); }
        else if ('fFeEgG'.includes(conv)) { const sz = len === 'l' || len === 'L' ? 8 : 4; ok = isFlt(to) && to.size === sz; want = sz === 8 ? 'double *' : 'float *'; }
        else if (conv === 's' || conv === 'c' || conv[0] === '[') { ok = isCharT(to); want = 'char *'; }
        else continue;
        if (!ok) this.warn(`format '%${len}${conv}' expects argument of type '${want}', but argument ${argNo} has type '${typeStr(t)}' [-Wformat=]`, a.tok || tok);
      }
    }
    if (ai < args.length && !isScan) this.warn('too many arguments for format [-Wformat-extra-args]', tok);
  }

  // ---- sabit değerlendirme
  constEval(e) {
    if (!e) return null;
    e = this.rval(e);
    if (e.n === 'num' && (isInt(e.type) || isPtr(e.type))) return e.v;
    if (e.n === 'num' && isFlt(e.type)) return null;
    if (e.n === 'cast' && isInt(e.type)) { const v = this.constEval(e.e); return v == null ? null : convConst(v, e.e.type, e.type); }
    return null;
  }
}

const SUGGEST = { prinf: 'printf', pritnf: 'printf', printF: 'printf', print: 'printf', scnaf: 'scanf', sacnf: 'scanf', scanF: 'scanf', mallco: 'malloc', srtlen: 'strlen', strlenght: 'strlen', getch: 'getchar', clrscr: 'printf' };
const FORMAT_FUNCS = { printf: 0, scanf: 0, sprintf: 1, fprintf: 1, fscanf: 1, sscanf: 1, snprintf: 2 };

// =================================================================== CODEGEN (C AST → JavaScript)
const JS_RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'enum', 'await', 'implements', 'package', 'protected', 'interface', 'private', 'public', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity', 'arguments', 'eval']);
const mangle = (name) => name.replace(/[^A-Za-z0-9_]/g, (c) => '_u' + c.charCodeAt(0).toString(16) + '_');

class CodeGen {
  constructor(prog, fileIndex) {
    this.prog = prog; this.fileIndex = fileIndex;
    this.dataTop = GLOBAL_BASE;
    this.strs = new Map();
    this.dataInit = [];
    this.ft = []; this.ftIndex = new Map();
    this.linkErrors = [];
    this.vlaCounter = 0;
  }
  allocData(size, align) { this.dataTop = (this.dataTop + (align || 1) - 1) & ~((align || 1) - 1); const a = this.dataTop; this.dataTop += Math.max(size, 1); return a; }
  strAddr(bytes) {
    const key = bytes.join(',');
    if (this.strs.has(key)) return this.strs.get(key);
    const a = this.allocData(bytes.length + 1, 1);
    this.strs.set(key, a);
    this.dataInit.push([a, bytes]);
    return a;
  }
  lineId(tok) { if (!tok || !tok.file) return 0; let fi = this.fileIndex.indexOf(tok.file); if (fi < 0) { this.fileIndex.push(tok.file); fi = this.fileIndex.length - 1; } return fi * 1000000 + (tok.line || 0); }
  fnIndex(sym) {
    if (this.ftIndex.has(sym)) return this.ftIndex.get(sym);
    const k = this.ft.length + 1;
    this.ft.push(sym); this.ftIndex.set(sym, k);
    return k;
  }
  // ---- program
  generate() {
    const P = this.prog;
    const funcsByName = new Map();
    for (const f of P.funcs) funcsByName.set(f.sym.name, f);
    this.funcsByName = funcsByName;
    // global değişkenler
    for (const g of P.globals.concat(P.statics)) {
      if (g.storage === 'extern' && !g.init) { g.addr = g.addr || null; continue; }
      if (g.type.k === 'arr' && g.type.len == null) { g.type.len = 1; g.type.size = g.type.of.size; }
      g.addr = this.allocData(g.type.size || 1, g.type.align || 1);
    }
    for (const g of P.globals) if (g.storage === 'extern' && g.addr == null) {
      this.linkErrors.push({ msg: `undefined reference to \`${g.name}'`, tok: g.tok });
      g.addr = this.allocData(Math.max(g.type.size || 4, 4), 8);
    }
    const parts = [];
    for (const f of P.funcs) parts.push(this.genFunc(f));
    // başlatma
    this.cur = { temps: 0, frame: 0, fn: null, jsLocals: [] };
    const initLines = [];
    for (const g of P.globals.concat(P.statics)) if (g.init) initLines.push(this.genInit(g.init, String(g.addr)));
    const initBody = initLines.join('\n');
    const temps = this.tempDecl();
    const dataLines = this.dataInit.map(([a, b]) => `$U8.set(${JSON.stringify(b)},${a});`).join('\n');
    const ftCode = '[null,' + this.ft.map((s) => this.funcRef(s, true)).join(',') + ']';
    const mainF = funcsByName.get('main');
    const code = `"use strict";
const {$I8,$U8,$I16,$U16,$I32,$U32,$F32,$F64,$B,$c,$stp,$ld64,$ldu64,$st64,$div,$mod,$divu,$modu,$div64,$mod64,$divu64,$modu64,$f2l,$f2ul,$f2i,$memcpy,$memset,$sov,$segv,$fcall,$SLO} = $E;
let SP = ${MEM_SIZE}; let $L = 0;
${parts.join('\n')}
const $FT = ${ftCode};
function $init(){ ${temps}
${dataLines}
${initBody}
}
return { main: ${mainF ? 'f_' + mangle('main') : 'null'}, mainArity: ${mainF ? mainF.params.length : 0}, init: $init, FT: $FT, getL: () => $L, getSP: () => SP, setSP: (v) => { SP = v; } };`;
    return { code, dataTop: (this.dataTop + 15) & ~15, linkErrors: this.linkErrors };
  }
  funcRef(sym, forTable) {
    if (this.funcsByName.has(sym.name)) return 'f_' + mangle(sym.name);
    if (BUILTIN_NAMES.has(sym.name)) return forTable ? `$B.${sym.name}` : `$B.${sym.name}`;
    this.linkErrors.push({ msg: `undefined reference to \`${sym.name}'`, tok: sym.tok });
    return `(()=>{throw new Error("undefined function ${sym.name}")})`;
  }
  tempDecl() {
    const c = this.cur;
    const names = [];
    for (let k = 0; k < c.temps; k++) names.push('$t' + k);
    for (const j of c.jsLocals) names.push(j);
    return names.length ? 'let ' + names.join(', ') + ';' : '';
  }
  tmp() { return '$t' + (this.cur.temps++); }
  frameAlloc(size, align) {
    align = Math.max(align || 1, 1);
    this.cur.frame = (this.cur.frame + align - 1) & ~(align - 1);
    const off = this.cur.frame;
    this.cur.frame += Math.max(size, 1);
    return off;
  }
  genFunc(fn) {
    this.cur = { temps: 0, frame: 0, fn, jsLocals: [], vlaInits: [] };
    const retStruct = fn.type.ret.k === 'struct';
    const pnames = [];
    const entry = [];
    for (const [k, p] of fn.params.entries()) {
      const pn = '$p' + k;
      pnames.push(pn);
      p.mem = p.addrTaken || p.type.k === 'struct';
      if (p.mem) {
        p.off = this.frameAlloc(p.type.size, p.type.align);
        if (p.type.k === 'struct') entry.push(`$memcpy(($bp+${p.off}),${pn},${p.type.size});`);
        else entry.push(this.st(p.type, `($bp+${p.off})`, pn) + ';');
      } else {
        p.js = 'v_' + mangle(p.name) + '_' + p.id;
        entry.push(`let ${p.js} = ${pn};`);
      }
    }
    // VLA parametre boyutları
    for (const p of fn.params) this.collectVla(p.type, entry, true);
    for (const l of fn.locals) {
      if (l.type.vla) { l.mem = true; l.addrVar = '$va' + l.id; this.cur.jsLocals.push(l.addrVar); continue; }
      l.mem = l.addrTaken || isAgg(l.type);
      if (l.mem) l.off = this.frameAlloc(l.type.size, l.type.align);
      else { l.js = 'v_' + mangle(l.name) + '_' + l.id; this.cur.jsLocals.push(`${l.js} = ${is64(l.type) ? '0n' : '0'}`); }
    }
    const body = this.genBlockItems(fn.body.items, fn.body.hasVla);
    const frame = (this.cur.frame + 15) & ~15;
    const isMain = fn.sym.name === 'main';
    const defRet = isMain ? '0' : (fn.type.ret.k === 'void' ? '' : (is64(fn.type.ret) ? '0n' : retStruct ? '$ret' : '0'));
    this.cur.frameSize = frame;
    return `function f_${mangle(fn.sym.name)}(${retStruct ? '$ret' + (pnames.length ? ',' : '') : ''}${pnames.join(',')}) {
const $bp = (SP = SP - ${frame}); if ($bp < $SLO) $sov();
${this.tempDecl()}
${entry.join('\n')}
${body}
SP = $bp + ${frame}; return ${defRet};
}`.replace(/\$FRAME/g, String(frame));
  }
  collectVla(type, out, isParam) {
    // tip içindeki VLA boyutlarını değerlendir
    const visit = (t) => {
      if (!t) return;
      if (t.k === 'ptr') { if (t.fromVla) visit(t.fromVla); visit(t.to); return; }
      if (t.k === 'arr') {
        visit(t.of);
        if (t.vlaExpr && !t.vlaVar) {
          t.vlaVar = '$vl' + (++this.vlaCounter);
          this.cur.jsLocals.push(t.vlaVar);
          out.push(`${t.vlaVar} = ${this.conv(this.gen(t.vlaExpr), this.rtype(t.vlaExpr), T_INT)};`);
          if (!isParam) out.push(`if (${t.vlaVar} < 0) $B.__rterr("VLA boyutu negatif: " + ${t.vlaVar});`);
        }
      }
    };
    visit(type);
  }
  rtype(e) { return e.type.k === 'arr' ? ptrTo(e.type.of) : e.type; }
  sizeCode(t) {
    if (t.k === 'arr' && t.vla) return `(${t.vlaExpr ? t.vlaVar : t.len}*${this.sizeCode(t.of)})`;
    return String(t.size == null ? 0 : t.size);
  }
  // ---- deyimler
  genBlockItems(items, hasVla) {
    const code = items.map((s) => this.genStmt(s)).join('\n');
    if (hasVla) { const t = this.tmp(); return `${t} = SP; try {\n${code}\n} finally { SP = ${t}; }`; }
    return code;
  }
  L(tok) { return `$L=${this.lineId(tok)};`; }
  Lc(tok) { return `$L=${this.lineId(tok)},`; }
  genStmt(s) {
    if (!s) return '';
    switch (s.s) {
      case 'block': return '{\n' + this.genBlockItems(s.items, s.hasVla) + '\n}';
      case 'empty': return ';';
      case 'expr': return this.L(s.tok) + this.genVoid(s.e) + ';';
      case 'decl': return s.syms.map((sym) => this.genLocalDecl(sym)).join('\n');
      case 'if': return `${this.L(s.tok)}if (${this.truth(s.c)}) ${this.wrapStmt(s.a)}${s.b ? ' else ' + this.wrapStmt(s.b) : ''}`;
      case 'while': return `while (${this.Lc(s.tok)}${this.truth(s.c)}) ${this.wrapStmt(s.body)}`;
      case 'do': return `do ${this.wrapStmt(s.body)} while (${this.Lc(s.tok)}${this.truth(s.c)});`;
      case 'for': {
        const init = s.init ? this.genStmt(s.init) : '';
        const c = s.c ? this.truth(s.c) : 'true';
        const step = s.step ? this.genVoid(s.step) : '';
        return `${init}\nfor (; ${this.Lc(s.tok)}${c}; ${step}) ${this.wrapStmt(s.body)}`;
      }
      case 'switch': return `${this.L(s.tok)}switch (${this.gen(s.e)}) ${this.wrapStmt(s.body)}`;
      case 'case': return s.vals.map((v) => `case ${typeof v === 'bigint' ? v + 'n' : v}:`).join(' ');
      case 'default': return 'default:';
      case 'break': return 'break;';
      case 'continue': return 'continue;';
      case 'return': {
        const fr = '$FRAME';
        if (!s.e) return `${this.L(s.tok)}{ SP = $bp + ${fr}; return ${this.cur.fn && this.cur.fn.sym.name === 'main' ? '0' : ''}; }`;
        if (s.e.type.k === 'struct') return `${this.L(s.tok)}{ $memcpy($ret, ${this.gen(s.e)}, ${s.e.type.size}); SP = $bp + ${fr}; return $ret; }`;
        if (s.e.type.k === 'void') return `${this.L(s.tok)}{ ${this.gen(s.e)}; SP = $bp + ${fr}; return; }`;
        const t = this.tmp();
        return `${this.L(s.tok)}{ ${t} = ${this.gen(s.e)}; SP = $bp + ${fr}; return ${t}; }`;
      }
    }
    throw new Error('internal: stmt ' + s.s);
  }
  wrapStmt(s) { const c = this.genStmt(s); return s && s.s === 'block' ? c : '{ ' + c + ' }'; }
  genLocalDecl(sym) {
    const out = [this.L(sym.tok)];
    if (sym.type.vla) {
      this.collectVla(sym.type, out, false);
      out.push(`${sym.addrVar} = (SP = (SP - ((${this.sizeCode(sym.type)} + 7) & ~7))); if (SP < $SLO) $sov();`);
      return out.join(' ');
    }
    if (!sym.init) return out.join('');
    if (!sym.mem) {
      const it = sym.init[0];
      out.push(`${sym.js} = ${this.gen(it.expr)};`);
      return out.join(' ');
    }
    out.push(this.genInit(sym.init, this.addrOf(sym), sym.type));
    return out.join(' ');
  }
  genInit(items, base, type) { return this.genInitList(items, base, type).map((x) => x + ';').join(' '); }
  genInitList(items, base, type) {
    const out = [];
    const agg = items.length && (items.length > 1 || items[0].off !== 0 || items[0].bytes || (type && isAgg(type) && items[0].type !== type));
    if (type && isAgg(type) && (agg || items.some((i) => i.bytes))) out.push(`$memset(${base}, 0, ${type.size})`);
    for (const it of items) {
      const addr = it.off ? `(${base}+${it.off})` : base;
      if (it.bytes) { out.push(`$U8.set(${JSON.stringify(it.bytes)}, ${addr})`); continue; }
      if (it.type.k === 'struct') { out.push(`$memcpy(${addr}, ${this.gen(it.expr)}, ${it.type.size})`); continue; }
      out.push(this.st(it.type, addr, this.gen(it.expr)));
    }
    return out;
  }
  // ---- bellek erişimi
  ld(t, a) {
    if (t.k === 'ptr') return `$U32[$c(${a})>>2]`;
    if (t.k === 'flt') return t.size === 4 ? `$F32[$c(${a})>>2]` : `$F64[$c(${a})>>3]`;
    if (t.k === 'int') {
      switch (t.size) {
        case 1: return t.uns ? `$U8[$c(${a})]` : `$I8[$c(${a})]`;
        case 2: return t.uns ? `$U16[$c(${a})>>1]` : `$I16[$c(${a})>>1]`;
        case 4: return t.uns ? `$U32[$c(${a})>>2]` : `$I32[$c(${a})>>2]`;
        case 8: return t.uns ? `$ldu64(${a})` : `$ld64(${a})`;
      }
    }
    throw new Error('internal: load ' + typeStr(t));
  }
  st(t, a, v) {
    if (t.k === 'ptr') return `$stp(${a},${v})`;
    if (t.k === 'flt') return t.size === 4 ? `($F32[$c(${a})>>2]=${v})` : `($F64[$c(${a})>>3]=${v})`;
    if (t.k === 'int') {
      switch (t.size) {
        case 1: return t.uns ? `($U8[$c(${a})]=${v})` : `($I8[$c(${a})]=${v})`;
        case 2: return t.uns ? `($U16[$c(${a})>>1]=${v})` : `($I16[$c(${a})>>1]=${v})`;
        case 4: return t.uns ? `($U32[$c(${a})>>2]=${v})` : `($I32[$c(${a})>>2]=${v})`;
        case 8: return `$st64(${a},${v})`;
      }
    }
    throw new Error('internal: store ' + typeStr(t));
  }
  addrOf(sym) {
    if (sym.storage === 'global' || sym.storage === 'static' || sym.storage === 'extern') return String(sym.addr);
    if (sym.addrVar) return sym.addrVar;
    return `($bp+${sym.off})`;
  }
  isMemLv(e) { return !(e.n === 'var' && e.sym.kind === 'var' && !this.symInMem(e.sym)); }
  symInMem(s) { return s.storage === 'global' || s.storage === 'static' || s.storage === 'extern' || s.mem; }
  genAddr(e) {
    switch (e.n) {
      case 'var': return this.addrOf(e.sym);
      case 'cl': return this.gen(e);
      case 'deref': return this.gen(e.e);
      case 'member': return `(${this.genAddr(e.e)}+${e.off})`;
      case 'str': return String(this.strAddr(e.bytes));
    }
    if (e.type && e.type.k === 'struct') return this.gen(e);
    throw new Error('internal: addr of ' + e.n);
  }
  // ---- dönüşümler
  conv(code, from, to) {
    if (to.k === 'void') return code;
    if (from.k === 'arr') from = ptrTo(from.of);
    if (to.bool) return is64(from) ? `(${code}!==0n?1:0)` : `(${code}?1:0)`;
    const fk = from.k === 'ptr' ? { k: 'int', size: 4, uns: true } : from;
    const tk = to.k === 'ptr' ? { k: 'int', size: 4, uns: true } : to;
    if (tk.k === 'int') {
      if (tk.size === 8) {
        let big;
        if (fk.k === 'flt') big = tk.uns ? `$f2ul(${code})` : `$f2l(${code})`;
        else if (fk.size === 8) { if (fk.uns === tk.uns) return code; big = code; }
        else big = `BigInt(${code})`;
        return tk.uns ? (fk.k === 'int' && fk.uns && fk.size < 8 ? big : `BigInt.asUintN(64,${big})`) : (fk.k === 'int' && fk.size < 8 ? big : (fk.k === 'flt' ? big : `BigInt.asIntN(64,${big})`));
      }
      let src;
      if (fk.k === 'flt') src = `$f2i(${code})`;
      else if (fk.size === 8) src = `Number(BigInt.asIntN(32,${code}))`;
      else {
        // daralma gerekmiyor mu?
        if (fk.size < tk.size && (tk.uns ? fk.uns : true)) return code;
        if (fk.size === tk.size && fk.uns === tk.uns) return code;
        src = code;
      }
      switch (tk.size) {
        case 4: return tk.uns ? `(${src}>>>0)` : `(${src}|0)`;
        case 2: return tk.uns ? `(${src}&65535)` : `(${src}<<16>>16)`;
        case 1: return tk.uns ? `(${src}&255)` : `(${src}<<24>>24)`;
      }
    }
    if (tk.k === 'flt') {
      let n = code;
      if (fk.k === 'int' && fk.size === 8) n = `Number(${code})`;
      if (tk.size === 4 && !(fk.k === 'flt' && fk.size === 4)) return `Math.fround(${n})`;
      return n;
    }
    return code;
  }
  truth(e) { return `(${this.gen(e)})`; }
  genVoid(e) { return this.gen(e); }
  num(v, t) {
    if (typeof v === 'bigint') return `(${v}n)`;
    if (isFlt(t)) { if (Number.isNaN(v)) return 'NaN'; if (v === Infinity) return 'Infinity'; if (v === -Infinity) return '(-Infinity)'; if (Object.is(v, -0)) return '(-0)'; }
    return v < 0 ? `(${v})` : String(v);
  }
  // ---- ifadeler
  gen(e) {
    switch (e.n) {
      case 'num': return this.num(e.v, e.type);
      case 'str': return String(this.strAddr(e.bytes));
      case 'cl': {
        const a = this.addrOf(e.sym);
        const init = this.genInitList(e.sym.init || [], a, e.type);
        return `(${init.concat([isAgg(e.type) ? a : this.ld(e.type, a)]).join(',')})`;
      }
      case 'var': {
        const s = e.sym;
        if (s.kind === 'func') return String(this.fnIndex(s));
        if (isAgg(s.type)) return this.addrOf(s);
        if (this.symInMem(s)) return this.ld(s.type, this.addrOf(s));
        return s.js;
      }
      case 'deref': case 'member':
        if (isAgg(e.type)) return this.genAddr(e);
        return this.ld(e.type, this.genAddr(e));
      case 'decay': return this.genAddr(e.e);
      case 'fnaddr': {
        const inner = e.e;
        if (inner.n === 'var' && inner.sym.kind === 'func') return String(this.fnIndex(inner.sym));
        return this.gen(inner);
      }
      case 'addr': return this.genAddr(e.e);
      case 'vlasize': return `(${this.sizeCode(e.vtype)}>>>0)`;
      case 'ph': return e.js;
      case 'cast': {
        if (e.type.k === 'void') return `(${this.gen(e.e)},0)`;
        if (e.nop) return this.gen(e.e);
        return this.conv(this.gen(e.e), e.e.type, e.type);
      }
      case 'not': return is64(e.e.type) ? `(${this.gen(e.e)}===0n?1:0)` : `(${this.gen(e.e)}?0:1)`;
      case 'neg': {
        const a = this.gen(e.e), t = e.type;
        if (isFlt(t)) return `(-${a})`;
        if (is64(t)) return t.uns ? `BigInt.asUintN(64,-${a})` : `BigInt.asIntN(64,-${a})`;
        return t.uns ? `((-${a})>>>0)` : `((-${a})|0)`;
      }
      case 'bnot': {
        const a = this.gen(e.e), t = e.type;
        if (is64(t)) return t.uns ? `BigInt.asUintN(64,~${a})` : `BigInt.asIntN(64,~${a})`;
        return t.uns ? `((~${a})>>>0)` : `(~${a})`;
      }
      case 'bin': return this.genBin(e.op, this.gen(e.l), this.gen(e.r), e.type);
      case 'cmp': {
        const op = e.op === '==' ? '===' : e.op === '!=' ? '!==' : e.op;
        return `(${this.gen(e.l)}${op}${this.gen(e.r)}?1:0)`;
      }
      case 'logic': return `((${this.gen(e.l)})${e.op}(${this.gen(e.r)})?1:0)`;
      case 'padd': {
        const sz = this.sizeCode(e.type.to.k === 'void' || e.type.to.k === 'func' ? { size: 1 } : e.type.to);
        let i = this.gen(e.i);
        if (e.i.type.uns && e.i.type.size === 4) i = `(${i}|0)`;
        const scaled = sz === '1' ? i : `Math.imul(${i},${sz})`;
        return `((${this.gen(e.p)}${e.neg ? '-' : '+'}${scaled})>>>0)`;
      }
      case 'pdiff': {
        const sz = this.sizeCode(e.elem);
        return `(((${this.gen(e.a)}-${this.gen(e.b)})/${sz})|0)`;
      }
      case 'cond': return `(${this.truth(e.c)}?${this.gen(e.a)}:${this.gen(e.b)})`;
      case 'comma': return `(${this.gen(e.a)},${this.gen(e.b)})`;
      case 'assign': {
        const l = e.l, v = this.gen(e.r);
        if (l.type.k === 'struct') return `$memcpy(${this.genAddr(l)},${v},${l.type.size})`;
        if (!this.isMemLv(l)) return `(${l.sym.js}=${v})`;
        return this.st(l.type, this.genAddr(l), v);
      }
      case 'cassign': case 'preinc': {
        const l = e.l;
        if (!this.isMemLv(l)) { e.ph.js = l.sym.js; return `(${l.sym.js}=${this.gen(e.val)})`; }
        const ta = this.tmp();
        e.ph.js = this.ld(l.type, ta);
        return `(${ta}=${this.genAddr(l)},${this.st(l.type, ta, this.gen(e.val))})`;
      }
      case 'postinc': {
        const l = e.l;
        const tv = this.tmp();
        e.ph.js = tv;
        if (!this.isMemLv(l)) return `(${tv}=${l.sym.js},${l.sym.js}=${this.gen(e.val)},${tv})`;
        const ta = this.tmp();
        return `(${ta}=${this.genAddr(l)},${tv}=${this.ld(l.type, ta)},${this.st(l.type, ta, this.gen(e.val))},${tv})`;
      }
      case 'call': {
        let args = e.args.map((a) => this.gen(a));
        let pre = '';
        // gcc (x86-64) argümanları sağdan sola değerlendirir; yan etkili argümanlarda aynı sırayı uygula
        if (args.length > 1 && e.args.filter((a) => this.sideFx(a)).length >= 1 && e.args.some((a, k) => k > 0 && this.sideFx(a))) {
          const ts = args.map(() => this.tmp());
          for (let k = args.length - 1; k >= 0; k--) pre += `${ts[k]}=${args[k]},`;
          args = ts;
        }
        if (pre) return `(${pre}${this.callCode(e, args)})`;
        return this.callCode(e, args);
      }
    }
    throw new Error('internal: expr ' + e.n);
  }
  sideFx(e) {
    if (!e || typeof e !== 'object') return false;
    if (e.n === 'assign' || e.n === 'cassign' || e.n === 'preinc' || e.n === 'postinc' || e.n === 'call') return true;
    for (const k of ['e', 'l', 'r', 'a', 'b', 'c', 'p', 'i', 'val']) if (e[k] && typeof e[k] === 'object' && e[k].n && this.sideFx(e[k])) return true;
    return false;
  }
  callCode(e, args) {
    {
        if (e.retSym) { e.retSym.mem = true; if (e.retSym.off == null) e.retSym.off = this.frameAlloc(e.type.size, e.type.align); args.unshift(this.addrOf(e.retSym)); }
        if (e.direct) {
          const name = e.direct.name;
          if (this.funcsByName.has(name)) return `f_${mangle(name)}(${args.join(',')})`;
          if (BUILTIN_NAMES.has(name)) return `$B.${name}(${args.join(',')})`;
          this.linkErrors.push({ msg: `undefined reference to \`${name}'`, tok: e.tok });
          return '0';
        }
        return `$fcall(${this.gen(e.f)})(${args.join(',')})`;
    }
  }
  genBin(op, a, b, t) {
    if (isFlt(t)) {
      const r = `(${a}${op}${b})`;
      return t.size === 4 ? `Math.fround${r}` : r;
    }
    if (is64(t)) {
      const W = t.uns ? 'BigInt.asUintN(64,' : 'BigInt.asIntN(64,';
      switch (op) {
        case '+': case '-': case '*': return `${W}${a}${op}${b})`;
        case '/': return t.uns ? `$divu64(${a},${b})` : `$div64(${a},${b})`;
        case '%': return t.uns ? `$modu64(${a},${b})` : `$mod64(${a},${b})`;
        case '&': case '|': case '^': return `(${a}${op}${b})`;
        case '<<': return `${W}${a}<<BigInt((${b})&63))`;
        case '>>': return `(${a}>>BigInt((${b})&63))`;
      }
    }
    if (t.uns) {
      switch (op) {
        case '+': case '-': return `((${a}${op}${b})>>>0)`;
        case '*': return `(Math.imul(${a},${b})>>>0)`;
        case '/': return `$divu(${a},${b})`;
        case '%': return `$modu(${a},${b})`;
        case '&': case '|': case '^': case '<<': return `((${a}${op}${b})>>>0)`;
        case '>>': return `(${a}>>>${b})`;
      }
    }
    switch (op) {
      case '+': case '-': return `((${a}${op}${b})|0)`;
      case '*': return `Math.imul(${a},${b})`;
      case '/': return `$div(${a},${b})`;
      case '%': return `$mod(${a},${b})`;
      case '&': case '|': case '^': case '<<': case '>>': return `(${a}${op}${b})`;
    }
    throw new Error('internal: binop ' + op);
  }
}

// =================================================================== RUNTIME + STANDART KÜTÜPHANE
const BUILTIN_NAMES = new Set();

function createRuntime(io, namesOnly) {
  const mem = new ArrayBuffer(namesOnly ? 64 : MEM_SIZE);
  const I8 = new Int8Array(mem), U8 = new Uint8Array(mem), I16 = new Int16Array(mem), U16 = new Uint16Array(mem);
  const I32 = new Int32Array(mem), U32 = new Uint32Array(mem), F32 = new Float32Array(mem), F64 = new Float64Array(mem);
  const DV = new DataView(mem);
  let heapStart = 0, heapTop = 0;
  const freeLists = new Map();
  let prog = null;
  const HEAP_LIMIT = STACK_LO - 65536;

  const rterr = (msg, code) => { throw new RuntimeErr(msg, code); };
  const c = (a) => { if (a < GLOBAL_BASE || a >= MEM_SIZE) { if (a === 0) rterr('Segmentation fault: NULL pointer dereference (NULL göstericiye erişim)'); rterr(`Segmentation fault: geçersiz bellek adresi 0x${(a >>> 0).toString(16)}`); } return a; };
  const div = (a, b) => { if (b === 0) rterr('Floating point exception: integer division by zero (sıfıra bölme)', 136); return (a / b) | 0; };
  const mod = (a, b) => { if (b === 0) rterr('Floating point exception: integer modulo by zero (sıfıra bölme)', 136); return (a % b) | 0; };
  const divu = (a, b) => { if (b === 0) rterr('Floating point exception: integer division by zero', 136); return (a / b) >>> 0; };
  const modu = (a, b) => { if (b === 0) rterr('Floating point exception: integer modulo by zero', 136); return (a % b) >>> 0; };
  const div64 = (a, b) => { if (b === 0n) rterr('Floating point exception: integer division by zero', 136); return BigInt.asIntN(64, a / b); };
  const mod64 = (a, b) => { if (b === 0n) rterr('Floating point exception: integer modulo by zero', 136); return BigInt.asIntN(64, a % b); };
  const divu64 = (a, b) => { if (b === 0n) rterr('Floating point exception: integer division by zero', 136); return a / b; };
  const modu64 = (a, b) => { if (b === 0n) rterr('Floating point exception: integer modulo by zero', 136); return a % b; };
  const f2i = (x) => (x !== x || x === Infinity || x === -Infinity || x >= 2147483648 || x < -2147483648) ? (x !== x || !isFinite(x) ? -2147483648 : (x | 0)) : (x | 0);
  const f2l = (x) => (x !== x || !isFinite(x)) ? -(1n << 63n) : BigInt.asIntN(64, BigInt(Math.trunc(x)));
  const f2ul = (x) => (x !== x || !isFinite(x)) ? 0n : BigInt.asUintN(64, BigInt(Math.trunc(x)));
  const ld64 = (a) => DV.getBigInt64(c(a), true);
  const ldu64 = (a) => DV.getBigUint64(c(a), true);
  const st64 = (a, v) => { DV.setBigUint64(c(a), BigInt.asUintN(64, v), true); return v; };
  const stp = (a, v) => { c(a); U32[(a >> 2) + 1] = 0; U32[a >> 2] = v; return v; };
  const memcpy = (d, s, n) => { if (n > 0) { c(d); c(s); c(d + n - 1); c(s + n - 1); U8.copyWithin(d, s, s + n); } return d; };
  const memset = (d, v, n) => { if (n > 0) { c(d); c(d + n - 1); U8.fill(v & 255, d, d + n); } return d; };
  const sov = () => rterr('Stack overflow: yığın taştı (çok derin özyineleme veya çok büyük yerel dizi)', 139);
  const fcall = (p) => { const f = prog && prog.FT[p]; if (!f) rterr(p === 0 ? 'Segmentation fault: NULL fonksiyon gösterici çağrısı' : 'Segmentation fault: geçersiz fonksiyon gösterici'); return f; };

  // ---- yığın (heap)
  function malloc(n) {
    n = Number(n) >>> 0;
    const sz = Math.max(8, (n + 7) & ~7);
    const fl = freeLists.get(sz);
    let a;
    if (fl && fl.length) a = fl.pop();
    else {
      a = heapTop + 8;
      if (a + sz > HEAP_LIMIT) return 0;
      heapTop = a + sz;
    }
    U32[(a - 8) >> 2] = sz; U32[(a - 4) >> 2] = ALLOC_MAGIC;
    return a;
  }
  function free(a) {
    if (!a) return;
    if (a < heapStart || a >= heapTop) rterr('free(): invalid pointer (malloc ile alınmamış bir adres)', 134);
    const m = U32[(a - 4) >> 2];
    if (m === FREED_MAGIC) rterr('free(): double free detected (aynı bellek iki kez serbest bırakıldı)', 134);
    if (m !== ALLOC_MAGIC) rterr('free(): invalid pointer', 134);
    U32[(a - 4) >> 2] = FREED_MAGIC;
    const sz = U32[(a - 8) >> 2];
    let fl = freeLists.get(sz);
    if (!fl) freeLists.set(sz, fl = []);
    fl.push(a);
  }
  function realloc(a, n) {
    if (!a) return malloc(n);
    if (!n) { free(a); return 0; }
    if (U32[(a - 4) >> 2] !== ALLOC_MAGIC) rterr('realloc(): invalid pointer', 134);
    const old = U32[(a - 8) >> 2];
    if (n <= old) return a;
    const b = malloc(n);
    if (!b) return 0;
    U8.copyWithin(b, a, a + old);
    free(a);
    return b;
  }

  // ---- string yardımcıları
  const cstr = (a) => { c(a); let e = a; while (U8[e]) e++; let s = ''; for (let i = a; i < e; i += 8192) s += String.fromCharCode.apply(null, U8.subarray(i, Math.min(e, i + 8192))); return s; };
  const cstrn = (a, n) => { let s = ''; for (let i = 0; i < n && U8[a + i]; i++) s += String.fromCharCode(U8[a + i]); return s; };
  const wstr = (a, s) => { c(a); c(a + s.length); for (let i = 0; i < s.length; i++) U8[a + i] = s.charCodeAt(i); U8[a + s.length] = 0; return a; };
  const strlen = (a) => { c(a); let e = a; while (U8[e]) e++; return e - a; };

  // ---- çıktı
  let out = '', err = '', lastFlush = Date.now(), outTotal = 0;
  function flush() {
    if (out) { io.write(out, false); out = ''; }
    if (err) { io.write(err, true); err = ''; }
    lastFlush = Date.now();
  }
  function write(fd, s) {
    if (!s) return;
    outTotal += s.length;
    if (outTotal > 20000000) { flush(); rterr('Çıktı sınırı aşıldı (20 MB) – sonsuz döngü olabilir', 1); }
    if (fd === 3) { err += s; flush(); return; }
    out += s;
    if (out.length > 16384 || (s.indexOf('\n') >= 0 && Date.now() - lastFlush > 40)) flush();
  }

  // ---- girdi (stdin) – satır satır, gerektiğinde bloklayarak okunur
  let inBuf = '', inPos = 0, inEOF = false;
  const stdinStream = {
    peek() {
      if (inPos >= inBuf.length) {
        if (inEOF) return -1;
        flush();
        const line = io.readLine();
        if (line == null) { inEOF = true; return -1; }
        inBuf = utf8ToLatin(line) + '\n'; inPos = 0;
      }
      return inBuf.charCodeAt(inPos);
    },
    get() { const ch = this.peek(); if (ch >= 0) inPos++; return ch; },
    unget(ch) { if (ch >= 0) { if (inPos > 0) inPos--; else { inBuf = String.fromCharCode(ch) + inBuf.slice(inPos); inPos = 0; } } },
    eof() { return inEOF && inPos >= inBuf.length; }
  };
  const strStream = (s) => { let p = 0; return { peek: () => (p < s.length ? s.charCodeAt(p) : -1), get: () => (p < s.length ? s.charCodeAt(p++) : -1), unget: (ch) => { if (ch >= 0 && p > 0) p--; }, eof: () => p >= s.length, pos: () => p }; };

  // ---- dosyalar
  const files = new Map(); // ad -> latin1 içerik
  for (const [name, text] of Object.entries(io.files || {})) files.set(name, utf8ToLatin(text));
  const changed = new Set();
  const handles = new Map();
  let nextHandle = 16;
  const resolveName = (n) => { n = n.replace(/^\.\//, ''); if (files.has(n)) return n; const cand = io.cwd ? normPath(io.cwd + '/' + n) : n; return cand; };
  function fileStream(h) {
    return {
      peek() { return h.pos < h.data.length ? h.data.charCodeAt(h.pos) : -1; },
      get() { if (h.pos < h.data.length) return h.data.charCodeAt(h.pos++); h.eof = true; return -1; },
      unget(ch) { if (ch >= 0 && h.pos > 0) { h.pos--; h.eof = false; } },
      eof() { return h.pos >= h.data.length; }
    };
  }
  function streamOf(fp) {
    if (fp === 1) return stdinStream;
    const h = handles.get(fp);
    if (!h) rterr(fp === 0 ? 'Segmentation fault: NULL FILE* kullanıldı (fopen başarısız olmuş olabilir)' : 'geçersiz FILE*');
    return h.stream;
  }
  function fwriteStr(fp, s) {
    if (fp === 2 || fp === 3) { write(fp, s); return; }
    const h = handles.get(fp);
    if (!h) rterr(fp === 0 ? 'Segmentation fault: NULL FILE* kullanıldı (fopen başarısız olmuş olabilir)' : 'geçersiz FILE*');
    if (!h.w) return;
    h.data = h.data.slice(0, h.pos) + s + h.data.slice(h.pos + s.length);
    h.pos += s.length;
    files.set(h.name, h.data); changed.add(h.name);
  }

  // ---- printf
  function fmtNum(conv, v, flags, width, prec, len) {
    let s, neg = false;
    const isBig = typeof v === 'bigint';
    switch (conv) {
      case 'd': case 'i': {
        let x = isBig ? v : BigInt(Math.trunc(Number(v)));
        if (len === 'hh') x = BigInt.asIntN(8, x); else if (len === 'h') x = BigInt.asIntN(16, x); else if (len === 'l' || len === 'll' || len === 'j') x = BigInt.asIntN(64, x); else if (len !== 'z') x = BigInt.asIntN(32, x);
        neg = x < 0n; s = (neg ? -x : x).toString();
        break;
      }
      case 'u': case 'x': case 'X': case 'o': {
        let x = isBig ? v : BigInt(Math.trunc(Number(v)));
        const bits = len === 'hh' ? 8 : len === 'h' ? 16 : (len === 'l' || len === 'll' || len === 'j') ? 64 : 32;
        x = BigInt.asUintN(bits, x);
        s = x.toString(conv === 'u' ? 10 : conv === 'o' ? 8 : 16);
        if (conv === 'X') s = s.toUpperCase();
        if (flags.includes('#') && x !== 0n) s = (conv === 'o' ? '0' : conv === 'x' ? '0x' : conv === 'X' ? '0X' : '') + s;
        break;
      }
    }
    if (prec != null) { const body = s.replace(/^0[xX]/, ''); const pre = s.length - body.length; if (body.length < prec) s = s.slice(0, pre) + body.padStart(prec, '0'); if (prec === 0 && s === '0') s = ''; }
    const sign = neg ? '-' : (conv === 'd' || conv === 'i') ? (flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') : '';
    return pad(sign, s, flags, width, prec == null);
  }
  function pad(sign, s, flags, width, zeroOk) {
    const total = sign.length + s.length;
    if (width && total < width) {
      if (flags.includes('-')) return sign + s + ' '.repeat(width - total);
      if (flags.includes('0') && zeroOk) return sign + '0'.repeat(width - total) + s;
      return ' '.repeat(width - total) + sign + s;
    }
    return sign + s;
  }
  function fmtFloat(conv, v, flags, width, prec) {
    v = Number(v);
    let neg = v < 0 || Object.is(v, -0);
    let a = Math.abs(v);
    let s;
    const up = conv === 'F' || conv === 'E' || conv === 'G';
    if (!isFinite(a)) { s = a !== a ? 'nan' : 'inf'; if (a !== a) neg = v < 0; if (up) s = s.toUpperCase(); return pad(neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '', s, flags.replace('0', ''), width, false); }
    if (prec == null) prec = 6;
    const expo = (x, p) => { let t = x.toExponential(Math.min(p, 100)); let [m, e] = t.split('e'); const en = parseInt(e, 10); return m + (up ? 'E' : 'e') + (en < 0 ? '-' : '+') + String(Math.abs(en)).padStart(2, '0'); };
    const fixed = (x, p) => {
      if (x >= 1e21) { return BigInt(Math.round(x)).toString() + (p > 0 ? '.' + '0'.repeat(p) : ''); }
      if (p >= 100) return x.toFixed(100);
      const full = x.toFixed(100);
      const dot = full.indexOf('.');
      const ip = full.slice(0, dot), fp = full.slice(dot + 1);
      const keep = fp.slice(0, p), rest = fp.slice(p);
      let up = false;
      if (rest[0] > '5') up = true;
      else if (rest[0] === '5') { if (/[1-9]/.test(rest.slice(1))) up = true; else { const last = p ? keep[p - 1] : ip[ip.length - 1]; up = (parseInt(last, 10) % 2) === 1; } }
      let digits = ip + keep;
      if (up) {
        const arr = digits.split('');
        let k = arr.length - 1;
        while (k >= 0) { if (arr[k] === '9') { arr[k] = '0'; k--; } else { arr[k] = String(+arr[k] + 1); break; } }
        if (k < 0) arr.unshift('1');
        digits = arr.join('');
      }
      const il = digits.length - p;
      return p ? digits.slice(0, il) + '.' + digits.slice(il) : digits;
    };
    if (conv === 'f' || conv === 'F') s = fixed(a, prec);
    else if (conv === 'e' || conv === 'E') s = expo(a, prec);
    else {
      let P = prec === 0 ? 1 : prec;
      let X = a === 0 ? 0 : parseInt(a.toExponential(P - 1).split('e')[1], 10);
      if (P > X && X >= -4) s = fixed(a, P - 1 - X); else s = expo(a, P - 1);
      if (!flags.includes('#')) { if (s.includes('e') || s.includes('E')) { let [m, e] = s.split(/(?=[eE])/); if (m.includes('.')) m = m.replace(/\.?0+$/, ''); s = m + e; } else if (s.includes('.')) s = s.replace(/\.?0+$/, ''); }
    }
    if (flags.includes('#') && !s.includes('.') && (conv === 'f' || conv === 'F')) s += '.';
    const sign = neg && !(s.match(/^[0.]+$/) && false) ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    return pad(sign, s, flags, width, true);
  }
  function format(fmt, args) {
    let o = '', ai = 0;
    const next = () => args[ai++];
    for (let i = 0; i < fmt.length; i++) {
      const ch = fmt[i];
      if (ch !== '%') { o += ch; continue; }
      const m = /^%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d*))?(hh|h|ll|l|L|z|j|t|q)?([diouxXcsfFeEgGpaA%n])/.exec(fmt.slice(i));
      if (!m) { o += ch; continue; }
      i += m[0].length - 1;
      let [, flags, w, p, len = '', conv] = m;
      let width = w === '*' ? Number(next()) : w ? parseInt(w, 10) : 0;
      if (width < 0) { flags += '-'; width = -width; }
      let prec = p === undefined ? null : p === '*' ? Number(next()) : p === '' ? 0 : parseInt(p, 10);
      if (prec != null && prec < 0) prec = null;
      switch (conv) {
        case '%': o += '%'; break;
        case 'd': case 'i': case 'u': case 'x': case 'X': case 'o': { const v = next(); o += fmtNum(conv, v === undefined ? 0 : v, flags, width, prec, len); break; }
        case 'c': { const v = next(); o += pad('', String.fromCharCode(Number(v) & 255), flags, width, false); break; }
        case 's': { const a = next(); let s = !a ? '(null)' : (prec != null ? cstrn(a, prec) : cstr(a)); if (prec != null && !a) s = s.slice(0, prec); o += pad('', s, flags, width, false); break; }
        case 'f': case 'F': case 'e': case 'E': case 'g': case 'G': case 'a': case 'A': { const v = next(); o += fmtFloat(conv === 'a' ? 'e' : conv === 'A' ? 'E' : conv, v === undefined ? 0 : v, flags, width, prec); break; }
        case 'p': { const v = Number(next()); o += pad('', v ? '0x' + (v >>> 0).toString(16) : '(nil)', flags, width, false); break; }
        case 'n': next(); break;
      }
    }
    return o;
  }

  // ---- scanf
  const isSpace = (ch) => ch === 32 || (ch >= 9 && ch <= 13);
  function scan(st, fmt, ptrs) {
    let count = 0, pi = 0, consumed = 0, fail = false;
    const get = () => { const ch = st.get(); if (ch >= 0) consumed++; return ch; };
    const unget = (ch) => { if (ch >= 0) { st.unget(ch); consumed--; } };
    const skipWs = () => { let ch; while ((ch = st.peek()) >= 0 && isSpace(ch)) get(); };
    for (let i = 0; i < fmt.length && !fail; i++) {
      const fc = fmt.charCodeAt(i);
      if (isSpace(fc)) { skipWs(); continue; }
      if (fmt[i] !== '%') {
        const ch = st.peek();
        if (ch < 0) { if (!count) return -1; break; }
        if (ch === fc) { get(); continue; }
        break;
      }
      const m = /^%(\*?)(\d+)?(hh|h|ll|l|L|z|j|t|q)?([diouxXcsfFeEgGaApn%]|\[\^?\]?[^\]]*\])/.exec(fmt.slice(i));
      if (!m) break;
      i += m[0].length - 1;
      const [, star, w, len = '', conv] = m;
      const width = w ? parseInt(w, 10) : Infinity;
      if (conv === '%') { skipWs(); if (st.peek() === 37) { get(); continue; } break; }
      if (conv === 'n') { if (!star) { const p = ptrs[pi++]; I32[c(p) >> 2] = consumed; } continue; }
      if (conv !== 'c' && conv[0] !== '[') skipWs();
      if (st.peek() < 0) { if (!count) return -1; break; }
      const store = (type, v) => {
        if (star) return;
        const p = ptrs[pi++];
        if (p == null) rterr('scanf: eksik argüman (format ile argüman sayısı uyuşmuyor)', 139);
        if (p < GLOBAL_BASE) rterr(`scanf: argüman bir adres değil (değer: ${p}). Değişkenin başına & koymayı unuttun mu?`, 139);
        switch (type) {
          case 'i8': I8[c(p)] = Number(v); break; case 'i16': I16[c(p) >> 1] = Number(v); break;
          case 'i32': I32[c(p) >> 2] = Number(BigInt.asIntN(32, BigInt(v))); break; case 'i64': DV.setBigInt64(c(p), BigInt.asIntN(64, BigInt(v)), true); break;
          case 'f32': F32[c(p) >> 2] = Number(v); break; case 'f64': F64[c(p) >> 3] = Number(v); break;
        }
        count++;
      };
      if ('diouxX'.includes(conv)) {
        let s = '', n = 0, ch;
        ch = st.peek();
        if ((ch === 43 || ch === 45) && n < width) { s += String.fromCharCode(get()); n++; }
        let base = conv === 'o' ? 8 : (conv === 'x' || conv === 'X') ? 16 : 10;
        if ((conv === 'i' || base === 16) && st.peek() === 48 && n < width) {
          s += String.fromCharCode(get()); n++;
          const c2 = st.peek();
          if ((c2 === 120 || c2 === 88) && n < width) { get(); n++; base = 16; s = s.slice(0, -1); }
          else if (conv === 'i') base = 8;
        }
        const ok = (cc) => base === 16 ? /[0-9a-fA-F]/.test(cc) : base === 8 ? /[0-7]/.test(cc) : /[0-9]/.test(cc);
        while (n < width && (ch = st.peek()) >= 0 && ok(String.fromCharCode(ch))) { s += String.fromCharCode(get()); n++; }
        const digits = s.replace(/^[+-]/, '');
        if (!digits.length) { fail = true; break; }
        let v = BigInt((s[0] === '-' ? '-' : '') + (base === 16 ? '0x' : base === 8 ? '0o' : '') + digits);
        const T = len === 'hh' ? 'i8' : len === 'h' ? 'i16' : (len === 'l' || len === 'll' || len === 'j' || len === 'q') ? 'i64' : 'i32';
        store(T, v);
      } else if ('fFeEgGaA'.includes(conv)) {
        let s = '', n = 0, ch;
        const take = () => { s += String.fromCharCode(get()); n++; };
        ch = st.peek(); if ((ch === 43 || ch === 45) && n < width) take();
        let digits = 0;
        while (n < width && (ch = st.peek()) >= 48 && ch <= 57) { take(); digits++; }
        if (n < width && st.peek() === 46) { take(); while (n < width && (ch = st.peek()) >= 48 && ch <= 57) { take(); digits++; } }
        if (digits && n < width && ((ch = st.peek()) === 101 || ch === 69)) {
          take(); ch = st.peek(); if (ch === 43 || ch === 45) take();
          while (n < width && (ch = st.peek()) >= 48 && ch <= 57) take();
        }
        if (!digits) {
          const rest = [];
          while (n < width && (ch = st.peek()) >= 0 && /[a-zA-Z]/.test(String.fromCharCode(ch)) && rest.length < 8) { rest.push(get()); n++; }
          const word = String.fromCharCode(...rest).toLowerCase();
          if (word === 'inf' || word === 'infinity' || word === 'nan') { store(len === 'l' || len === 'L' ? 'f64' : 'f32', word === 'nan' ? NaN : (s === '-' ? -Infinity : Infinity)); continue; }
          for (let k = rest.length - 1; k >= 0; k--) unget(rest[k]);
          fail = true; break;
        }
        store(len === 'l' || len === 'L' ? 'f64' : 'f32', parseFloat(s));
      } else if (conv === 's') {
        let n = 0, ch, a = star ? 0 : ptrs[pi];
        if (!star) { if (a == null) rterr('scanf: eksik argüman'); if (a < GLOBAL_BASE) rterr(`scanf %s: argüman bir adres değil (değer: ${a})`); }
        let k = 0;
        while (n < width && (ch = st.peek()) >= 0 && !isSpace(ch)) { get(); if (!star) U8[c(a + k)] = ch; k++; n++; }
        if (!star) { U8[c(a + k)] = 0; pi++; count++; }
      } else if (conv === 'c') {
        const wn = w ? width : 1;
        const a = star ? 0 : ptrs[pi];
        if (!star && (a == null || a < GLOBAL_BASE)) rterr(`scanf %c: argüman bir adres değil. Değişkenin başına & koymayı unuttun mu?`);
        let k = 0, ch;
        while (k < wn && (ch = st.peek()) >= 0) { get(); if (!star) U8[c(a + k)] = ch; k++; }
        if (!k) { fail = true; break; }
        if (!star) { pi++; count++; }
      } else if (conv[0] === '[') {
        let body = conv.slice(1, -1), neg = false;
        if (body[0] === '^') { neg = true; body = body.slice(1); }
        const set = new Set();
        for (let k = 0; k < body.length; k++) {
          if (body[k + 1] === '-' && k + 2 < body.length) { for (let x = body.charCodeAt(k); x <= body.charCodeAt(k + 2); x++) set.add(x); k += 2; }
          else set.add(body.charCodeAt(k));
        }
        const a = star ? 0 : ptrs[pi];
        let k = 0, ch;
        while (k < width && (ch = st.peek()) >= 0 && (set.has(ch) !== neg)) { get(); if (!star) U8[c(a + k)] = ch; k++; }
        if (!k) { fail = true; break; }
        if (!star) { U8[c(a + k)] = 0; pi++; count++; }
      }
    }
    return count;
  }

  // ---- fgets
  function fgetsImpl(buf, n, st) {
    if (n <= 0) return 0;
    let k = 0, ch;
    while (k < n - 1) {
      ch = st.get();
      if (ch < 0) break;
      U8[c(buf + k)] = ch; k++;
      if (ch === 10) break;
    }
    if (!k) return 0;
    U8[c(buf + k)] = 0;
    return buf;
  }

  // ---- strtol / strtod
  function strtolImpl(s, endp, base, bits, uns) {
    let a = s, ch;
    while (isSpace(U8[c(a)])) a++;
    let neg = false;
    if (U8[a] === 45) { neg = true; a++; } else if (U8[a] === 43) a++;
    if ((base === 0 || base === 16) && U8[a] === 48 && (U8[a + 1] === 120 || U8[a + 1] === 88)) { base = 16; a += 2; }
    else if (base === 0 && U8[a] === 48) base = 8;
    else if (base === 0) base = 10;
    let v = 0n, any = false;
    for (;;) {
      ch = U8[a];
      let d = ch >= 48 && ch <= 57 ? ch - 48 : ch >= 97 && ch <= 122 ? ch - 87 : ch >= 65 && ch <= 90 ? ch - 55 : 99;
      if (d >= base) break;
      v = v * BigInt(base) + BigInt(d); a++; any = true;
    }
    if (endp) stp(endp, any ? a : s);
    if (neg) v = -v;
    const max = (1n << BigInt(bits - (uns ? 0 : 1))) - 1n;
    if (!uns && v > max) v = max; if (!uns && v < -max - 1n) v = -max - 1n;
    return uns ? BigInt.asUintN(bits, v) : v;
  }
  function strtodImpl(s, endp) {
    let a = s;
    while (isSpace(U8[c(a)])) a++;
    const rest = cstrn(a, 400);
    const m = /^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|inf(inity)?|nan)/i.exec(rest);
    if (!m) { if (endp) stp(endp, s); return 0; }
    if (endp) stp(endp, a + m[0].length);
    const t = m[0].toLowerCase();
    if (t.includes('inf')) return t[0] === '-' ? -Infinity : Infinity;
    if (t.includes('nan')) return NaN;
    return parseFloat(m[0]);
  }

  let randState = 1;
  let strtokPtr = 0;
  const staticBufs = {};
  const sbuf = (k, n) => staticBufs[k] || (staticBufs[k] = malloc(n));
  const exitHandlers = [];
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const B = {
    // stdio
    printf: (f, ...a) => { const s = format(cstr(f), a); write(2, s); return s.length; },
    fprintf: (fp, f, ...a) => { const s = format(cstr(f), a); fwriteStr(fp, s); return s.length; },
    sprintf: (buf, f, ...a) => { const s = format(cstr(f), a); wstr(buf, s); return s.length; },
    snprintf: (buf, n, f, ...a) => { const s = format(cstr(f), a); if (n > 0) wstr(buf, s.slice(0, n - 1)); return s.length; },
    puts: (s) => { write(2, cstr(s) + '\n'); return 1; },
    putchar: (ch) => { write(2, String.fromCharCode(ch & 255)); return ch & 255; },
    fputs: (s, fp) => { fwriteStr(fp, cstr(s)); return 1; },
    fputc: (ch, fp) => { fwriteStr(fp, String.fromCharCode(ch & 255)); return ch & 255; },
    putc: (ch, fp) => B.fputc(ch, fp),
    getchar: () => stdinStream.get(),
    fgetc: (fp) => streamOf(fp).get(),
    getc: (fp) => streamOf(fp).get(),
    ungetc: (ch, fp) => { streamOf(fp).unget(ch); return ch; },
    scanf: (f, ...p) => scan(stdinStream, cstr(f), p),
    fscanf: (fp, f, ...p) => scan(streamOf(fp), cstr(f), p),
    sscanf: (s, f, ...p) => scan(strStream(cstr(s)), cstr(f), p),
    fgets: (buf, n, fp) => fgetsImpl(buf, n, streamOf(fp)),
    gets: (buf) => { let k = 0, ch; ch = stdinStream.get(); if (ch < 0) return 0; while (ch >= 0 && ch !== 10) { U8[c(buf + k)] = ch; k++; ch = stdinStream.get(); } U8[c(buf + k)] = 0; return buf; },
    fflush: (fp) => { if (fp === 2 || fp === 3 || !fp) flush(); return 0; },
    setbuf: () => {}, setvbuf: () => 0,
    perror: (s) => { write(3, (s ? cstr(s) + ': ' : '') + 'Error\n'); },
    fopen: (n, m) => {
      const name = resolveName(cstr(n)); const mode = cstr(m);
      const exists = files.has(name);
      if (mode[0] === 'r' && !exists) return 0;
      const h = { name, data: mode[0] === 'w' ? '' : (files.get(name) || ''), pos: 0, w: mode[0] !== 'r' || mode.includes('+'), eof: false };
      if (mode[0] === 'a') h.pos = h.data.length;
      if (mode[0] === 'w' || mode[0] === 'a') { files.set(name, h.data); changed.add(name); }
      h.stream = fileStream(h);
      const fp = nextHandle++; handles.set(fp, h);
      return fp;
    },
    fclose: (fp) => { handles.delete(fp); return 0; },
    feof: (fp) => { if (fp === 1) return stdinStream.eof() ? 1 : 0; const h = handles.get(fp); if (!h) rterr('feof: geçersiz FILE* (NULL olabilir)'); return h.pos >= h.data.length && h.eof ? 1 : 0; },
    ferror: () => 0,
    rewind: (fp) => { const h = handles.get(fp); if (h) { h.pos = 0; h.eof = false; } },
    fseek: (fp, off, wh) => { const h = handles.get(fp); if (!h) return -1; off = Number(off); h.pos = Math.max(0, wh === 0 ? off : wh === 1 ? h.pos + off : h.data.length + off); h.eof = false; return 0; },
    ftell: (fp) => { const h = handles.get(fp); return BigInt(h ? h.pos : -1); },
    fread: (p, size, n, fp) => { const st = streamOf(fp); let total = size * n, k = 0, ch; while (k < total && (ch = st.get()) >= 0) { U8[c(p + k)] = ch; k++; } return (k / size) >>> 0; },
    fwrite: (p, size, n, fp) => { let s = ''; for (let k = 0; k < size * n; k++) s += String.fromCharCode(U8[c(p + k)]); fwriteStr(fp, s); return n; },
    remove: (n) => { const name = resolveName(cstr(n)); if (!files.has(name)) return -1; files.delete(name); changed.add(name); return 0; },
    rename: () => -1,
    // stdlib
    malloc: (n) => malloc(n),
    calloc: (n, s) => { const t = n * s; const a = malloc(t); if (a) U8.fill(0, a, a + t); return a; },
    realloc: (a, n) => realloc(a, n),
    free: (a) => free(a),
    exit: (code) => { throw new ExitSignal(code | 0); },
    abort: () => { rterr('Aborted (abort çağrıldı)', 134); },
    atexit: (f) => { exitHandlers.push(f); return 0; },
    abs: (x) => (x < 0 ? (-x) | 0 : x), labs: (x) => (x < 0n ? -x : x), llabs: (x) => (x < 0n ? -x : x),
    atoi: (s) => Number(BigInt.asIntN(32, strtolImpl(s, 0, 10, 64, false))),
    atol: (s) => strtolImpl(s, 0, 10, 64, false), atoll: (s) => strtolImpl(s, 0, 10, 64, false),
    atof: (s) => strtodImpl(s, 0),
    strtol: (s, e, b) => strtolImpl(s, e, b, 64, false), strtoll: (s, e, b) => strtolImpl(s, e, b, 64, false),
    strtoul: (s, e, b) => strtolImpl(s, e, b, 64, true),
    strtod: (s, e) => strtodImpl(s, e), strtof: (s, e) => Math.fround(strtodImpl(s, e)),
    rand: () => { randState = (Math.imul(randState, 1103515245) + 12345) >>> 0; return (randState >>> 1) & 0x7fffffff; },
    srand: (s) => { randState = s >>> 0; },
    qsort: (base, n, size, cmp) => {
      if (n < 2) return;
      const f = fcall(cmp);
      const tmp = malloc(n * size);
      U8.copyWithin(tmp, base, base + n * size);
      const idx = Array.from({ length: n }, (_, k) => k);
      idx.sort((x, y) => f(tmp + x * size, tmp + y * size));
      for (let k = 0; k < n; k++) U8.copyWithin(base + k * size, tmp + idx[k] * size, tmp + idx[k] * size + size);
      free(tmp);
    },
    bsearch: (key, base, n, size, cmp) => {
      const f = fcall(cmp);
      let lo = 0, hi = n - 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; const r = f(key, base + mid * size); if (r === 0) return base + mid * size; if (r < 0) hi = mid - 1; else lo = mid + 1; }
      return 0;
    },
    system: (s) => { const cmd = cstr(s); if (/^(cls|clear)$/.test(cmd.trim())) { write(2, '\x1b[2J'); return 0; } if (/^pause/.test(cmd.trim())) return 0; return -1; },
    div: (ret, a, b) => { I32[c(ret) >> 2] = div(a, b); I32[(ret + 4) >> 2] = mod(a, b); return ret; },
    getenv: () => 0,
    // string.h
    strlen: (s) => strlen(s),
    strcpy: (d, s) => { const n = strlen(s); memcpy(d, s, n + 1); return d; },
    strncpy: (d, s, n) => { const l = Math.min(strlen(s), n); memcpy(d, s, l); if (l < n) memset(d + l, 0, n - l); return d; },
    strcat: (d, s) => { const dl = strlen(d), n = strlen(s); memcpy(d + dl, s, n + 1); return d; },
    strncat: (d, s, n) => { const dl = strlen(d); let k = 0; while (k < n && U8[c(s + k)]) { U8[c(d + dl + k)] = U8[s + k]; k++; } U8[c(d + dl + k)] = 0; return d; },
    strcmp: (a, b) => { c(a); c(b); for (;;) { const x = U8[a++], y = U8[b++]; if (x !== y) return x < y ? -1 : 1; if (!x) return 0; } },
    strncmp: (a, b, n) => { for (let k = 0; k < n; k++) { const x = U8[c(a + k)], y = U8[c(b + k)]; if (x !== y) return x < y ? -1 : 1; if (!x) return 0; } return 0; },
    strcasecmp: (a, b) => { for (;;) { let x = U8[c(a++)], y = U8[c(b++)]; if (x >= 65 && x <= 90) x += 32; if (y >= 65 && y <= 90) y += 32; if (x !== y) return x < y ? -1 : 1; if (!x) return 0; } },
    strncasecmp: (a, b, n) => { for (let k = 0; k < n; k++) { let x = U8[c(a + k)], y = U8[c(b + k)]; if (x >= 65 && x <= 90) x += 32; if (y >= 65 && y <= 90) y += 32; if (x !== y) return x < y ? -1 : 1; if (!x) return 0; } return 0; },
    strcoll: (a, b) => B.strcmp(a, b),
    strchr: (s, ch) => { ch &= 255; c(s); for (let a = s; ; a++) { if (U8[a] === ch) return a; if (!U8[a]) return 0; } },
    strrchr: (s, ch) => { ch &= 255; c(s); let r = 0; for (let a = s; ; a++) { if (U8[a] === ch) r = a; if (!U8[a]) return r; } },
    strstr: (h, n) => { const H = cstr(h), N = cstr(n); const k = H.indexOf(N); return k < 0 ? 0 : h + k; },
    strpbrk: (s, acc) => { const A = cstr(acc); for (let a = s; U8[c(a)]; a++) if (A.indexOf(String.fromCharCode(U8[a])) >= 0) return a; return 0; },
    strspn: (s, acc) => { const A = cstr(acc); let k = 0; while (U8[c(s + k)] && A.indexOf(String.fromCharCode(U8[s + k])) >= 0) k++; return k; },
    strcspn: (s, rej) => { const R = cstr(rej); let k = 0; while (U8[c(s + k)] && R.indexOf(String.fromCharCode(U8[s + k])) < 0) k++; return k; },
    strtok: (s, d) => {
      const D = cstr(d);
      let p = s ? s : strtokPtr;
      if (!p) return 0;
      while (U8[c(p)] && D.indexOf(String.fromCharCode(U8[p])) >= 0) p++;
      if (!U8[p]) { strtokPtr = 0; return 0; }
      const start = p;
      while (U8[p] && D.indexOf(String.fromCharCode(U8[p])) < 0) p++;
      if (U8[p]) { U8[p] = 0; strtokPtr = p + 1; } else strtokPtr = 0;
      return start;
    },
    strdup: (s) => { const n = strlen(s); const d = malloc(n + 1); memcpy(d, s, n + 1); return d; },
    strndup: (s, n) => { const l = Math.min(strlen(s), n); const d = malloc(l + 1); memcpy(d, s, l); U8[d + l] = 0; return d; },
    strerror: () => wstr(sbuf('strerror', 32), 'Unknown error'),
    strrev: (s) => { const n = strlen(s); for (let i = 0, j = n - 1; i < j; i++, j--) { const t = U8[s + i]; U8[s + i] = U8[s + j]; U8[s + j] = t; } return s; },
    strupr: (s) => { for (let a = s; U8[c(a)]; a++) if (U8[a] >= 97 && U8[a] <= 122) U8[a] -= 32; return s; },
    strlwr: (s) => { for (let a = s; U8[c(a)]; a++) if (U8[a] >= 65 && U8[a] <= 90) U8[a] += 32; return s; },
    memset: (d, v, n) => memset(d, v, n),
    memcpy: (d, s, n) => memcpy(d, s, n),
    memmove: (d, s, n) => memcpy(d, s, n),
    memcmp: (a, b, n) => { for (let k = 0; k < n; k++) { const x = U8[c(a + k)], y = U8[c(b + k)]; if (x !== y) return x < y ? -1 : 1; } return 0; },
    memchr: (s, ch, n) => { for (let k = 0; k < n; k++) if (U8[c(s + k)] === (ch & 255)) return s + k; return 0; },
    // math
    sqrt: Math.sqrt, pow: Math.pow, fabs: Math.abs, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc,
    round: (x) => (x < 0 ? -Math.round(-x) : Math.round(x)), rint: (x) => { const r = Math.round(x); return (Math.abs(x % 1) === 0.5) ? 2 * Math.round(x / 2) : r; }, nearbyint: (x) => B.rint(x),
    lround: (x) => BigInt(B.round(x)), llround: (x) => BigInt(B.round(x)),
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, exp2: (x) => Math.pow(2, x), log: Math.log, log10: Math.log10, log2: Math.log2, log1p: Math.log1p,
    fmod: (a, b) => a % b, hypot: Math.hypot, cbrt: Math.cbrt, fmax: Math.max, fmin: Math.min, copysign: (a, b) => (Math.sign(b) < 0 || Object.is(b, -0) ? -Math.abs(a) : Math.abs(a)),
    modf: (x, ip) => { const i = Math.trunc(x); F64[c(ip) >> 3] = i; return x - i; },
    frexp: (x, ep) => { if (x === 0 || !isFinite(x)) { I32[c(ep) >> 2] = 0; return x; } let e = Math.ceil(Math.log2(Math.abs(x))); let m = x / Math.pow(2, e); if (Math.abs(m) >= 1) { m /= 2; e++; } if (Math.abs(m) < 0.5) { m *= 2; e--; } I32[c(ep) >> 2] = e; return m; },
    ldexp: (x, e) => x * Math.pow(2, e),
    sqrtf: (x) => Math.fround(Math.sqrt(x)), powf: (a, b) => Math.fround(Math.pow(a, b)), fabsf: (x) => Math.fround(Math.abs(x)), floorf: (x) => Math.fround(Math.floor(x)),
    ceilf: (x) => Math.fround(Math.ceil(x)), roundf: (x) => Math.fround(B.round(x)), sinf: (x) => Math.fround(Math.sin(x)), cosf: (x) => Math.fround(Math.cos(x)), expf: (x) => Math.fround(Math.exp(x)), logf: (x) => Math.fround(Math.log(x)),
    __builtin_inf: () => Infinity, __builtin_nan: () => NaN, __builtin_isnan: (x) => (x !== x ? 1 : 0), __builtin_isinf: (x) => (x === Infinity ? 1 : x === -Infinity ? -1 : 0), __builtin_isfinite: (x) => (isFinite(x) ? 1 : 0),
    // ctype
    isdigit: (ch) => (ch >= 48 && ch <= 57 ? 2048 : 0), isalpha: (ch) => ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) ? 1024 : 0),
    isalnum: (ch) => ((ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) ? 8 : 0), isspace: (ch) => (isSpace(ch) ? 8192 : 0),
    isupper: (ch) => (ch >= 65 && ch <= 90 ? 256 : 0), islower: (ch) => (ch >= 97 && ch <= 122 ? 512 : 0),
    ispunct: (ch) => (ch > 32 && ch < 127 && !/[A-Za-z0-9]/.test(String.fromCharCode(ch)) ? 4 : 0), isxdigit: (ch) => (/[0-9a-fA-F]/.test(String.fromCharCode(ch & 255)) && ch < 128 ? 4096 : 0),
    isprint: (ch) => (ch >= 32 && ch < 127 ? 16384 : 0), iscntrl: (ch) => ((ch >= 0 && ch < 32) || ch === 127 ? 2 : 0), isgraph: (ch) => (ch > 32 && ch < 127 ? 32768 : 0), isblank: (ch) => (ch === 32 || ch === 9 ? 1 : 0),
    toupper: (ch) => (ch >= 97 && ch <= 122 ? ch - 32 : ch), tolower: (ch) => (ch >= 65 && ch <= 90 ? ch + 32 : ch),
    // time
    time: (p) => { const t = BigInt(Math.floor(Date.now() / 1000)); if (p) DV.setBigInt64(c(p), t, true); return t; },
    clock: () => BigInt(Math.floor(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 1000)),
    difftime: (a, b) => Number(a - b),
    localtime: (p) => {
      const t = Number(DV.getBigInt64(c(p), true)); const d = new Date(t * 1000); const tm = sbuf('tm', 36);
      const v = [d.getSeconds(), d.getMinutes(), d.getHours(), d.getDate(), d.getMonth(), d.getFullYear() - 1900, d.getDay(), Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 864e5), 0];
      v.forEach((x, k) => { I32[(tm >> 2) + k] = x; }); return tm;
    },
    ctime: (p) => { const t = Number(DV.getBigInt64(c(p), true)); return wstr(sbuf('ctime', 32), new Date(t * 1000).toString().slice(0, 24) + '\n'); },
    sleep: () => 0, usleep: () => 0,
    __assert_fail: (e, f, l) => { flush(); write(3, `Assertion failed: ${cstr(e)}, file ${cstr(f)}, line ${l}\n`); rterr('Aborted (assert başarısız)', 134); },
    __vsc_va_unsupported: () => rterr('va_list / değişken argümanlı kullanıcı fonksiyonları desteklenmiyor'),
    __rterr: (m) => rterr(m)
  };
  // div(): yapı döndüren builtin – derleyici gizli $ret argümanı geçirir
  Object.keys(B).forEach((k) => BUILTIN_NAMES.add(k));

  const env = {
    $I8: I8, $U8: U8, $I16: I16, $U16: U16, $I32: I32, $U32: U32, $F32: F32, $F64: F64, $B: B, $c: c, $stp: stp,
    $ld64: ld64, $ldu64: ldu64, $st64: st64, $div: div, $mod: mod, $divu: divu, $modu: modu, $div64: div64, $mod64: mod64, $divu64: divu64, $modu64: modu64,
    $f2l: f2l, $f2ul: f2ul, $f2i: f2i, $memcpy: memcpy, $memset: memset, $sov: sov, $segv: (a) => c(a), $fcall: fcall, $SLO: STACK_LO
  };
  return {
    env, flush, write,
    setProg(p) { prog = p; },
    setHeap(start) { heapStart = heapTop = (start + 15) & ~15; },
    argv(list) {
      const arr = malloc(8 * (list.length + 1));
      U8.fill(0, arr, arr + 8 * (list.length + 1));
      list.forEach((s, k) => { const b = utf8ToLatin(s); const a = malloc(b.length + 1); wstr(a, b); U32[(arr >> 2) + 2 * k] = a; });
      return arr;
    },
    runExit() { for (let k = exitHandlers.length - 1; k >= 0; k--) fcall(exitHandlers[k])(); },
    changedFiles() { return Array.from(changed).map((n) => ({ path: n, content: files.has(n) ? latinToUtf8(files.get(n)) : null })); }
  };
}
// isimleri runtime oluşturmadan da bilmek için
createRuntime({ write() {}, readLine() { return null; }, files: {} }, true);

// =================================================================== SÜRÜCÜ (derle + çalıştır)
function compile(opts) {
  // opts: { files: {path: text}, sources: [path...], main: path }
  const t0 = Date.now();
  const diags = [];
  const files = new Map(Object.entries(opts.files));
  const pp = new Preprocessor(files, diags);
  pp.mainDir = dirOf(opts.main || opts.sources[0]);
  const prog = { globalScope: new Map(), tagScope: new Map(), funcs: [], globals: [], statics: [] };
  // prelude
  const preToks = [];
  pp.processTokens(lex(PRELUDE, '<built-in>'), '<built-in>', preToks);
  const p0 = new Parser(preToks, prog, diags);
  p0.parseTU();
  for (const s of prog.globalScope.values()) if (s.kind === 'func') { s.builtinDecl = true; s.builtin = true; }
  if (diags.length) { return { ok: false, diags: diags.map((d) => Object.assign(d, { msg: '[prelude] ' + d.msg })) }; }
  for (const src of opts.sources) {
    const toks = [];
    pp.processFile(src, toks);
    if (diags.some((d) => d.sev === 'fatal')) break;
    const p = new Parser(toks, prog, diags);
    p.parseTU();
  }
  const errs = () => diags.filter((d) => d.sev !== 'warning');
  if (!errs().length) {
    const mainSym = prog.globalScope.get('main');
    if (!mainSym || !mainSym.defined) diags.push({ sev: 'error', msg: "undefined reference to `main'", file: opts.main || opts.sources[0], line: 1, col: 1 });
  }
  if (errs().length) return { ok: false, diags, ms: Date.now() - t0 };
  const fileIndex = [];
  const cg = new CodeGen(prog, fileIndex);
  let gen;
  try { gen = cg.generate(); }
  catch (e) { diags.push({ sev: 'error', msg: 'internal compiler error: ' + (e.message || e), file: opts.main, line: 1, col: 1 }); return { ok: false, diags }; }
  for (const le of gen.linkErrors) diags.push({ sev: 'error', msg: le.msg, file: le.tok ? le.tok.file : opts.main, line: le.tok ? le.tok.line : 1, col: le.tok ? le.tok.col : 1, link: true });
  if (errs().length) return { ok: false, diags, ms: Date.now() - t0 };
  let factory;
  try { factory = new Function('$E', gen.code); }
  catch (e) { diags.push({ sev: 'error', msg: 'internal compiler error (codegen): ' + e.message, file: opts.main, line: 1, col: 1 }); return { ok: false, diags, code: gen.code }; }
  return { ok: true, diags, factory, dataTop: gen.dataTop, fileIndex, code: gen.code, ms: Date.now() - t0 };
}

function run(compiled, io) {
  // io: { write(latin1Text, isErr), readLine() -> string|null, files: {name: text}, cwd, argv: [] }
  const rt = createRuntime(io);
  const prog = compiled.factory(rt.env);
  rt.setProg(prog);
  rt.setHeap(compiled.dataTop);
  let rc = 0, error = null;
  const loc = () => { const L = prog.getL(); const fi = Math.floor(L / 1000000); return { file: compiled.fileIndex[fi] || '', line: L % 1000000 }; };
  try {
    prog.init();
    const argv = rt.argv([io.progName || 'a.out'].concat(io.argv || []));
    const r = prog.mainArity >= 2 ? prog.main(1 + (io.argv || []).length, argv) : prog.mainArity === 1 ? prog.main(1 + (io.argv || []).length) : prog.main();
    rc = typeof r === 'bigint' ? Number(BigInt.asIntN(32, r)) : (r | 0);
    rt.runExit();
  } catch (e) {
    if (e instanceof ExitSignal) { rc = e.code; try { rt.runExit(); } catch (x) {} }
    else if (e instanceof RuntimeErr) { rc = e.code; error = Object.assign({ msg: e.msg }, loc()); }
    else if (e instanceof RangeError && /call stack|stack size/i.test(e.message)) { rc = 139; error = Object.assign({ msg: 'Stack overflow: özyineleme çok derin (sonlanmayan özyineleme olabilir)' }, loc()); }
    else { rc = 1; error = Object.assign({ msg: 'Internal error: ' + (e && e.message || e) }, loc()); }
  }
  try { rt.flush(); } catch (e) {}
  return { rc: rc & 255, error, changed: rt.changedFiles() };
}

function formatDiag(d, files) {
  const head = `${d.file ? baseOf(d.file) + ':' : ''}${d.line ? d.line + ':' + (d.col || 1) + ':' : ''} ${d.sev === 'fatal' ? 'fatal error' : d.sev}: ${d.msg}`;
  const src = d.file && files && files[d.file];
  if (!src || !d.line) return head;
  const ln = src.split('\n')[d.line - 1];
  if (ln == null) return head;
  const num = String(d.line).padStart(5);
  return `${head}\n${num} | ${ln.replace(/\t/g, '    ')}\n${' '.repeat(5)} | ${' '.repeat(Math.max(0, (d.col || 1) - 1 + (ln.slice(0, (d.col || 1) - 1).match(/\t/g) || []).length * 3))}^`;
}

const CC = { compile, run, formatDiag, lex, MEM_SIZE };

// =================================================================== WORKER / HOST
const IN_WORKER = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;
if (typeof module !== 'undefined' && module.exports) module.exports = CC;
else root.VSC_CC = CC;

let postFn = IN_WORKER ? (m) => self.postMessage(m) : null;
const post = (type, extra) => postFn && postFn(Object.assign({ type }, extra || {}));
function readLineXHR() {
  if (!IN_WORKER) {
    const v = root.prompt ? root.prompt('Program girdi bekliyor (stdin):', '') : null;
    if (v == null) return null;
    post('stdout', { text: v + '\n', echo: true });
    return v;
  }
  post('stdin-request');
  try {
    const x = new XMLHttpRequest();
    x.open('GET', '/__stdin?t=' + Date.now() + '_' + Math.random(), false);
    x.send(null);
    post('stdin-done');
    if (x.getResponseHeader('X-EOF') === '1') return null;
    return x.responseText;
  } catch (e) {
    post('stdin-broken', { message: String(e) });
    return null;
  }
}
function handle(m) {
  if (m.type !== 'run') return;
  const t0 = Date.now();
  const comp = compile({ files: m.files, sources: m.sources, main: m.main });
  const text = comp.diags.map((d) => formatDiag(d, m.files)).join('\n');
  post('diag', { diags: comp.diags.map((d) => ({ sev: d.sev === 'fatal' ? 'error' : d.sev, msg: d.msg, file: d.file, line: d.line, col: d.col })), text, ok: comp.ok, ms: comp.ms });
  if (!comp.ok) { post('done', { rc: 1, compileFailed: true, ms: Date.now() - t0 }); return; }
  const decOut = new TextDecoder(), decErr = new TextDecoder();
  const t1 = Date.now();
  const res = run(comp, {
    write: (s, isErr) => { const b = latinToBytes(s); const txt = (isErr ? decErr : decOut).decode(b, { stream: true }); if (txt) post(isErr ? 'stderr' : 'stdout', { text: txt }); },
    readLine: m.stdin != null ? (() => { const q = m.stdin.replace(/\r/g, '').split('\n'); if (q.length && q[q.length - 1] === '') q.pop(); return () => (q.length ? q.shift() : null); })() : readLineXHR,
    files: m.dataFiles || {}, cwd: m.cwd || '', argv: m.argv || [], progName: './' + (m.progName || 'a.out')
  });
  const rest = decOut.decode(); if (rest) post('stdout', { text: rest });
  post('done', { rc: res.rc, error: res.error, changed: res.changed, ms: Date.now() - t1, compileMs: comp.ms });
}
if (IN_WORKER) self.onmessage = (ev) => { try { handle(ev.data); } catch (e) { post('done', { rc: 1, error: { msg: 'Internal error: ' + (e && e.stack || e) } }); } };
else if (typeof module === 'undefined') root.__cHost = { setPost(fn) { postFn = fn; }, handle: (m) => { try { handle(m); } catch (e) { post('done', { rc: 1, error: { msg: 'Internal error: ' + (e && e.message || e) } }); } } };
})(typeof self !== 'undefined' ? self : this);
