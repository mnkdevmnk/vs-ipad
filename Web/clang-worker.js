/* ==========================================================================
   VS iPad – gerçek Clang (LLVM 8, WebAssembly) ile çevrimdışı C / C++ derleme
   Derleyici dosyaları: Web/clang/{clang.wasm, lld.wasm, memfs.wasm, sysroot.tar}
   Kaynak: github.com/binji/wasm-clang (Apache-2.0, © Ben Smith) – çalışma zamanı
   bu proje için yeniden yazıldı: çoklu dosya, C/C++ seçimi, interaktif stdin,
   ayrı stdout/stderr, gcc biçimli hata listesi, zaman fonksiyonları.

   İleti protokolü c-interp.js ile aynıdır (Run.runCLocal ikisini de kullanır):
     in : {type:'run', files:{path:content}, sources:[path], main, lang:'c'|'cpp',
           cwd, argv, progName, stdin?, flags?}
     out: diag{text,diags,ok} · stdout{text} · stderr{text} · stdin-request ·
          stdin-done · stdin-broken · status{text} · done{rc,error,ms,compileMs,compileFailed}
   ========================================================================== */
'use strict';
const BASE = 'clang/';
const post = (type, extra) => self.postMessage(Object.assign({ type }, extra || {}));

class ProcExit extends Error { constructor(code) { super('exit ' + code); this.code = code; } }
const ESUCCESS = 0, EBADF = 8;

class Mem {
  constructor(memory) { this.memory = memory; this.refresh(); }
  refresh() { this.buffer = this.memory.buffer; this.u8 = new Uint8Array(this.buffer); this.dv = new DataView(this.buffer); }
  check() { if (this.buffer !== this.memory.buffer || this.buffer.byteLength === 0) this.refresh(); }
  r32(o) { return this.dv.getUint32(o, true); }
  w32(o, v) { this.dv.setUint32(o, v >>> 0, true); }
  w64(o, lo, hi = 0) { this.w32(o, lo); this.w32(o + 4, hi); }
  bytes(o, n) { return this.u8.subarray(o, o + n); }
  write(o, data) {
    if (typeof data === 'string') { for (let i = 0; i < data.length; i++) this.u8[o + i] = data.charCodeAt(i) & 255; return data.length; }
    const u = data instanceof ArrayBuffer ? new Uint8Array(data) : data; this.u8.set(u, o); return u.length;
  }
  writeZ(o, s) { const n = this.write(o, s); this.u8[o + n] = 0; return n + 1; }
}
const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
const utf8Latin = (str) => unescape(encodeURIComponent(str)); // UTF-8 baytlarını latin1 dizesi olarak

// ------------------------------------------------------------------ bellek-içi dosya sistemi (memfs.wasm)
class MemFS {
  constructor(module) {
    this.hostMem = null;
    this.onWrite = () => {};
    const env = {
      abort: () => { throw new Error('memfs abort'); },
      host_write: (fd, iovs, n, nwritten) => this.hostWrite(fd, iovs, n, nwritten),
      memfs_log: (buf, len) => { this.mem.check(); console.log(latin1(this.mem.bytes(buf, len))); },
      copy_out: (dst, src, size) => { this.hostMem.check(); this.mem.check(); this.hostMem.u8.set(this.mem.bytes(src, size), dst); },
      copy_in: (dst, src, size) => { this.mem.check(); this.hostMem.check(); this.mem.u8.set(this.hostMem.bytes(src, size), dst); }
    };
    this.ready = WebAssembly.instantiate(module, { env }).then((inst) => {
      this.exports = inst.exports; this.mem = new Mem(inst.exports.memory); this.exports.init();
    });
  }
  hostWrite(fd, iovs, n, nwritten) {
    const m = this.hostMem; m.check();
    const parts = []; let size = 0;
    for (let i = 0; i < n; i++) { const buf = m.r32(iovs + i * 8), len = m.r32(iovs + i * 8 + 4); parts.push(m.bytes(buf, len).slice()); size += len; }
    m.w32(nwritten, size);
    const all = new Uint8Array(size); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    this.onWrite(fd, all);
    return ESUCCESS;
  }
  setPath(p) { this.mem.check(); this.mem.write(this.exports.GetPathBuf(), p); return p.length; }
  addDirectory(p) { this.exports.AddDirectoryNode(this.setPath(p)); }
  addFile(p, contents) {
    const data = typeof contents === 'string' ? contents : contents;
    const len = typeof data === 'string' ? data.length : data.length;
    const inode = this.exports.AddFileNode(this.setPath(p), len);
    const addr = this.exports.GetFileNodeAddress(inode);
    this.mem.check(); this.mem.write(addr, data);
  }
  exists(p) { const ino = this.exports.FindNode(this.setPath(p)); return ino !== 0 && ino !== -1 && ino !== 0xffffffff; }
  read(p) {
    const inode = this.exports.FindNode(this.setPath(p));
    const addr = this.exports.GetFileNodeAddress(inode), size = this.exports.GetFileNodeSize(inode);
    this.mem.check(); return this.mem.bytes(addr, size).slice();
  }
}

function untar(memfs, buf) {
  const u8 = new Uint8Array(buf); let off = 0;
  const str = (o, n) => { let s = ''; for (let i = o; i < o + n && u8[i]; i++) s += String.fromCharCode(u8[i]); return s; };
  while (off + 512 <= u8.length) {
    const name = str(off, 100); if (!name) break;
    const size = parseInt(str(off + 124, 12), 8) || 0, type = String.fromCharCode(u8[off + 156]);
    const prefix = str(off + 345, 155);
    const full = (prefix ? prefix + '/' : '') + name;
    off += 512;
    if (type === '5') memfs.addDirectory(full.replace(/\/$/, ''));
    else if (type === '0' || type === '\0') memfs.addFile(full, u8.subarray(off, off + size));
    off += Math.ceil(size / 512) * 512;
  }
}

// ------------------------------------------------------------------ WASI süreci
class Proc {
  constructor(module, memfs, argv, io) {
    this.argv = argv; this.memfs = memfs; this.io = io; this.env = { HOME: '/', USER: 'ipad', LANG: 'C.UTF-8' };
    this.stdinBuf = new Uint8Array(0); this.stdinPos = 0; this.stdinEOF = false;
    const self_ = this;
    const wasi = Object.assign({}, memfs.exports);
    const own = {
      proc_exit(code) { throw new ProcExit(code); },
      environ_sizes_get(cnt, size) { const e = self_.envList(); self_.m.check(); self_.m.w32(cnt, e.length); self_.m.w32(size, e.reduce((a, s) => a + s.length + 1, 0)); return ESUCCESS; },
      environ_get(ptrs, buf) { self_.m.check(); for (const s of self_.envList()) { self_.m.w32(ptrs, buf); ptrs += 4; buf += self_.m.writeZ(buf, s); } return ESUCCESS; },
      args_sizes_get(cnt, size) { self_.m.check(); const a = self_.argv.map(utf8Latin); self_.m.w32(cnt, a.length); self_.m.w32(size, a.reduce((x, s) => x + s.length + 1, 0)); return ESUCCESS; },
      args_get(ptrs, buf) { self_.m.check(); for (const s of self_.argv.map(utf8Latin)) { self_.m.w32(ptrs, buf); ptrs += 4; buf += self_.m.writeZ(buf, s); } return ESUCCESS; },
      random_get(buf, len) { self_.m.check(); crypto.getRandomValues(self_.m.bytes(buf, len)); return ESUCCESS; },
      clock_time_get(id, precisionLo, precisionHi, out) {
        // imza: (clock_id: i32, precision: i64, time_out: i32) — i64 JS'e BigInt olarak gelebilir
        if (out === undefined) { out = precisionHi; }
        self_.m.check();
        const ns = id === 0 ? BigInt(Date.now()) * 1000000n : BigInt(Math.round(performance.now() * 1e6));
        self_.m.dv.setBigUint64(out, ns, true);
        return ESUCCESS;
      },
      clock_res_get(id, out) { self_.m.check(); self_.m.dv.setBigUint64(out, 1000n, true); return ESUCCESS; },
      poll_oneoff(inp, outp, nsub, nevents) { self_.m.check(); self_.m.w32(nevents, 0); return ESUCCESS; },
      sched_yield() { return ESUCCESS; },
      fd_read(fd, iovs, n, nread) {
        if (fd !== 0) return memfs.exports.fd_read(fd, iovs, n, nread);
        return self_.readStdin(iovs, n, nread);
      }
    };
    Object.assign(wasi, own);
    // modülün istediği ama tanımlı olmayan her içe aktarmayı güvenli bir saplamayla doldur
    const imports = { wasi_unstable: {}, wasi_snapshot_preview1: {}, env: {} };
    for (const imp of WebAssembly.Module.imports(module)) {
      if (imp.kind !== 'function') continue;
      const ns = imports[imp.module] || (imports[imp.module] = {});
      if (imp.module.startsWith('wasi') && wasi[imp.name]) ns[imp.name] = wasi[imp.name];
      else ns[imp.name] = () => { if (imp.module.startsWith('wasi')) return 52; /* ENOSYS */ throw new Error(`${imp.module}.${imp.name} bu ortamda desteklenmiyor`); };
    }
    this.module = module; this.imports = imports;
  }
  envList() { return Object.entries(this.env).map(([k, v]) => `${k}=${v}`); }
  readStdin(iovs, n, nread) {
    const m = this.m; m.check();
    let total = 0;
    for (let i = 0; i < n; i++) {
      const buf = m.r32(iovs + i * 8), len = m.r32(iovs + i * 8 + 4);
      if (this.stdinPos >= this.stdinBuf.length && !this.stdinEOF && total === 0) this.refill();
      const avail = this.stdinBuf.length - this.stdinPos;
      if (avail <= 0) break;
      const k = Math.min(avail, len);
      m.check(); m.u8.set(this.stdinBuf.subarray(this.stdinPos, this.stdinPos + k), buf);
      this.stdinPos += k; total += k;
      if (k < len) break;
    }
    m.check(); m.w32(nread, total);
    return ESUCCESS;
  }
  refill() {
    const line = this.io.readLine();
    if (line == null) { this.stdinEOF = true; this.stdinBuf = new Uint8Array(0); this.stdinPos = 0; return; }
    this.stdinBuf = new TextEncoder().encode(line + '\n'); this.stdinPos = 0;
  }
  async start() {
    this.instance = await WebAssembly.instantiate(this.module, this.imports);
    this.m = new Mem(this.instance.exports.memory);
    this.memfs.hostMem = this.m;
    try { this.instance.exports._start(); return 0; }
    catch (e) { if (e instanceof ProcExit) return e.code; throw e; }
  }
}

// ------------------------------------------------------------------ derleyici durumu (worker boyunca önbellekte)
const S = { clang: null, lld: null, sysroot: null, memfsMod: null, loading: null, rtObj: null, rtSrc: null };
async function fetchBuf(name) { const r = await fetch(BASE + name); if (!r.ok) throw new Error(`${name} bulunamadı (HTTP ${r.status})`); return r.arrayBuffer(); }
async function ensure() {
  if (S.loading) return S.loading;
  S.loading = (async () => {
    post('status', { text: 'Clang yükleniyor (ilk seferde 10-30 sn)…' });
    const [memfsMod, sysroot] = await Promise.all([fetchBuf('memfs.wasm').then((b) => WebAssembly.compile(b)), fetchBuf('sysroot.tar')]);
    S.sysroot = sysroot; S.memfsMod = memfsMod;
    try { S.rtSrc = await (await fetch(BASE + 'rt.c')).text(); } catch (e) { S.rtSrc = null; }
    [S.clang, S.lld] = await Promise.all([fetchBuf('clang.wasm').then((b) => WebAssembly.compile(b)), fetchBuf('lld.wasm').then((b) => WebAssembly.compile(b))]);
  })();
  try { await S.loading; } catch (e) { S.loading = null; throw e; }
  return S.loading;
}
async function freshFS() {
  // her çalıştırmada temiz dosya sistemi (önceki programın dosyaları karışmasın)
  const fs = new MemFS(S.memfsMod); await fs.ready;
  untar(fs, S.sysroot);
  return fs;
}

function readLineXHR() {
  post('stdin-request');
  try {
    const x = new XMLHttpRequest();
    x.open('GET', '/__stdin?t=' + Date.now() + '_' + Math.random(), false);
    x.send(null);
    post('stdin-done');
    if (x.getResponseHeader('X-EOF') === '1') return null;
    return x.responseText;
  } catch (e) { post('stdin-broken', { message: String(e) }); return null; }
}

function parseDiags(text, mapName) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(.+?):(\d+):(\d+):\s+(fatal error|error|warning):\s+(.*)$/);
    if (m) out.push({ file: mapName(m[1]), line: +m[2], col: +m[3], sev: m[4] === 'warning' ? 'warning' : 'error', msg: m[5] });
  }
  return out;
}

async function handle(msg) {
  const t0 = Date.now();
  await ensure();
  const fs = await freshFS();
  const dir = msg.cwd || '';
  const rel = (p) => (dir && p.startsWith(dir + '/') ? p.slice(dir.length + 1) : p);
  const SRC = 'src/';
  const toVfs = (p) => SRC + rel(p);
  const fromVfs = (n) => { n = n.replace(/^\.\//, '').replace(/^\//, ''); return n.startsWith(SRC) ? (dir ? dir + '/' : '') + n.slice(SRC.length) : n; };
  // kaynaklar + başlıklar + veri dosyaları
  const created = new Set(['src']);
  fs.addDirectory('src');
  const mkdirs = (p) => { const parts = p.split('/'); let acc = ''; for (let i = 0; i < parts.length - 1; i++) { acc = acc ? acc + '/' + parts[i] : parts[i]; if (!created.has(acc)) { created.add(acc); try { fs.addDirectory(acc); } catch (e) {} } } };
  for (const [p, c] of Object.entries(msg.files || {})) {
    if (dir && !p.startsWith(dir + '/')) continue;
    const v = toVfs(p); mkdirs(v); fs.addFile(v, utf8Latin(c));
    // program "veri.txt" gibi göreli yollarla da açabilsin
    const r = rel(p);
    if (!/^(include|lib)\//.test(r) && !/\.(c|cc|cpp|cxx|h|hpp)$/i.test(r)) { mkdirs(r); try { fs.addFile(r, utf8Latin(c)); } catch (e) {} }
  }
  const lang = msg.lang === 'cpp' ? 'cpp' : 'c';
  const userFlags = (msg.flags || []).filter((f) => /^-(D|U|W|O|std=)/.test(f));
  const stdFlag = userFlags.find((f) => f.startsWith('-std=')) || (lang === 'cpp' ? '-std=c++17' : '-std=gnu17');
  const common = ['-disable-free', '-isysroot', '/', '-internal-isystem', '/include/c++/v1', '-internal-isystem', '/include', '-internal-isystem', '/lib/clang/8.0.1/include',
    '-ferror-limit', '19', '-fmessage-length', '0', '-I', 'src', '-triple', 'wasm32-unknown-wasi', '-fno-common'];
  if (lang === 'c' && stdFlag === '-std=c17') { /* clang 8: c17 → gnu17 desteklenir */ }

  let ccText = '';
  fs.onWrite = (fd, bytes) => { ccText += new TextDecoder().decode(bytes); };
  const objs = [];
  // derleyici yardımcıları (long double, __int128) – ilk çalıştırmada bir kez derlenir
  if (!S.rtObj && S.rtSrc) {
    fs.addFile('rt.c', utf8Latin(S.rtSrc));
    const saved = fs.onWrite; let rtLog = ''; fs.onWrite = (fd, b) => { rtLog += new TextDecoder().decode(b); };
    try {
      const rc = await new Proc(S.clang, fs, ['clang', '-cc1', '-emit-obj', ...common, '-O2', '-std=gnu11', '-o', 'rt.o', '-x', 'c', 'rt.c'], {}).start();
      if (rc === 0) S.rtObj = fs.read('rt.o'); else console.warn('rt.c derlenemedi:\n' + rtLog);
    } catch (e) { console.warn('rt.c', e); }
    fs.onWrite = saved;
  }
  if (S.rtObj) fs.addFile('rt.o', S.rtObj);
  let ok = true;
  for (const src of msg.sources) {
    const isCpp = lang === 'cpp' || /\.(cc|cpp|cxx)$/i.test(src);
    const obj = 'obj' + objs.length + '.o';
    const args = ['clang', '-cc1', '-emit-obj', ...common, '-O1', isCpp ? (stdFlag.includes('++') ? stdFlag : '-std=c++17') : (stdFlag.includes('++') ? '-std=gnu17' : stdFlag),
      ...userFlags.filter((f) => !f.startsWith('-std=') && !f.startsWith('-O')), '-Wall', '-o', obj, '-x', isCpp ? 'c++' : 'c', toVfs(src)];
    post('status', { text: `clang ${src.split('/').pop()}…` });
    let rc;
    try { rc = await new Proc(S.clang, fs, args, {}).start(); }
    catch (e) { ccText += `\nclang çöktü: ${e.message}\n`; rc = 1; }
    if (rc !== 0) ok = false; else objs.push(obj);
  }
  const compileMs0 = Date.now() - t0;
  if (ok) {
    const lib = 'lib/wasm32-wasi';
    const largs = ['wasm-ld', '--no-threads', '-z', 'stack-size=8388608', `-L${lib}`, `${lib}/crt1.o`, ...objs, ...(S.rtObj ? ['rt.o'] : []), '-lc', ...(lang === 'cpp' || msg.sources.some((s) => /\.(cc|cpp|cxx)$/i.test(s)) ? ['-lc++', '-lc++abi'] : []), '-o', 'a.wasm'];
    post('status', { text: 'bağlanıyor (lld)…' });
    let rc;
    try { rc = await new Proc(S.lld, fs, largs, {}).start(); }
    catch (e) { ccText += `\nlld çöktü: ${e.message}\n`; rc = 1; }
    if (rc !== 0) ok = false;
  }
  // tanılamalar: src/main.c:3:5 → gerçek yol
  ccText = ccText.replace(/(^|\n)src\//g, '$1');
  const shownName = (n) => (dir ? dir + '/' : '') + n.replace(/^\.\//, '');
  const diags = parseDiags(ccText, (n) => (n.startsWith(SRC) ? fromVfs(n) : shownName(n)));
  const compileMs = Date.now() - t0;
  post('diag', { text: ccText.replace(/\n+$/, ''), diags, ok });
  if (!ok) { post('done', { rc: 1, compileFailed: true, ms: compileMs, compileMs }); return; }

  // ---- programı çalıştır
  let mod;
  try { mod = await WebAssembly.compile(fs.read('a.wasm')); }
  catch (e) { post('done', { rc: 1, error: { msg: 'Çıktı yüklenemedi: ' + e.message }, compileMs }); return; }
  const decOut = new TextDecoder(), decErr = new TextDecoder();
  fs.onWrite = (fd, bytes) => {
    const t = (fd === 2 ? decErr : decOut).decode(bytes, { stream: true });
    if (t) post(fd === 2 ? 'stderr' : 'stdout', { text: t });
  };
  const q = msg.stdin != null ? msg.stdin.replace(/\r/g, '').split('\n') : null;
  if (q && q.length && q[q.length - 1] === '') q.pop();
  const io = { readLine: q ? () => (q.length ? q.shift() : null) : readLineXHR };
  const t1 = Date.now();
  let rc = 0, error = null;
  try { rc = await new Proc(mod, fs, ['./' + (msg.progName || 'a.out'), ...(msg.argv || [])], io).start(); }
  catch (e) {
    rc = 134;
    const m = String(e && e.message || e);
    const tr = /out of bounds/i.test(m) ? 'Segmentation fault (geçersiz bellek erişimi: dizi sınırı / NULL / serbest bırakılmış işaretçi)'
      : /unreachable/i.test(m) ? 'Abort (program beklenmedik biçimde durdu – abort(), assert ya da tanımsız davranış)'
      : /divide by zero|integer divide/i.test(m) ? 'Floating point exception (sıfıra bölme)'
      : /call stack|recursion/i.test(m) ? 'Stack overflow (çok derin özyineleme)'
      : 'Çalışma zamanı hatası: ' + m;
    error = { msg: tr };
  }
  const r1 = decOut.decode(); if (r1) post('stdout', { text: r1 });
  const r2 = decErr.decode(); if (r2) post('stderr', { text: r2 });
  post('done', { rc, error, ms: Date.now() - t1, compileMs });
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'preload') { ensure().then(() => post('ready'), (e) => post('load-error', { message: String(e.message || e) })); return; }
  if (m.type !== 'run') return;
  handle(m).catch((e) => post('done', { rc: 1, error: { msg: 'Clang hatası: ' + (e && e.message || e) }, compileFailed: /bulunamadı|fetch|Load failed/i.test(String(e && e.message)) }));
};
