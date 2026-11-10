/* Python çalıştırıcı (Pyodide / WebAssembly) – ayrı bir Worker'da çalışır.
 * input()  -> senkron XHR ile vscpad://app/__stdin  (Swift, kullanıcı terminale yazana kadar bekletir)
 * Sonsuz döngüde "Stop" worker'ı tamamen sonlandırır, uygulama donmaz. */
'use strict';
(function () {
const IN_WORKER = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
let py = null;
let indexURL = '';
const decOut = new TextDecoder(), decErr = new TextDecoder();
let postFn = (m) => self.postMessage(m);
function post(type, extra) { postFn(Object.assign({ type }, extra || {})); }

function readStdin() {
  if (!IN_WORKER) {
    // ana thread modu: native metin diyaloğu
    const v = self.prompt('Program girdi bekliyor (input):', '');
    if (v == null) return null;
    post('stdout', { text: v + '\n' });
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

function loadScriptMain(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('yüklenemedi: ' + src)); document.head.appendChild(s); });
}

const BOOT = `
import sys, os, traceback, time, builtins

def __vsc_run(src, filename, cwd, argv):
    os.makedirs(cwd, exist_ok=True)
    os.chdir(cwd)
    if cwd not in sys.path:
        sys.path.insert(0, cwd)
    for m in list(sys.modules):
        f = getattr(sys.modules.get(m), '__file__', None) or ''
        if f.startswith('/ws/'):
            del sys.modules[m]
    sys.argv = [filename] + list(argv)
    g = {'__name__': '__main__', '__file__': filename, '__builtins__': builtins}
    rc = 0
    try:
        code = compile(src, filename, 'exec')
        exec(code, g)
    except SystemExit as e:
        c = e.code
        rc = c if isinstance(c, int) else (0 if c is None else 1)
        if c is not None and not isinstance(c, int):
            print(c, file=sys.stderr)
    except KeyboardInterrupt:
        print('KeyboardInterrupt', file=sys.stderr)
        rc = 130
    except BaseException:
        et, ev, tb = sys.exc_info()
        traceback.print_exception(et, ev, tb.tb_next)
        rc = 1
    finally:
        try:
            sys.stdout.flush(); sys.stderr.flush()
        except Exception:
            pass
    return rc

import code as __code
__repl = None
def __vsc_repl_start():
    global __repl
    os.makedirs('/ws', exist_ok=True)
    __repl = __code.InteractiveConsole({'__name__': '__console__'})
    print('Python %s on pyodide' % sys.version.split()[0])
    print('Type "help", "copyright", "credits" or "license" for more information.')
def __vsc_repl_push(line):
    more = __repl.push(line)
    sys.stdout.flush(); sys.stderr.flush()
    return more
`;

async function init(url) {
  indexURL = url;
  post('progress', { msg: 'Python (Pyodide) yükleniyor…' });
  if (IN_WORKER) importScripts(indexURL + 'pyodide.js');
  else if (typeof loadPyodide === 'undefined') await loadScriptMain(indexURL + 'pyodide.js');
  py = await loadPyodide({ indexURL, fullStdLib: false });
  py.setStdout({ write: (b) => { post('stdout', { text: decOut.decode(b, { stream: true }) }); return b.length; }, isatty: true });
  py.setStderr({ write: (b) => { post('stderr', { text: decErr.decode(b, { stream: true }) }); return b.length; }, isatty: true });
  py.setStdin({ stdin: readStdin, isatty: true });
  py.runPython(BOOT);
  try { py.FS.mkdir('/ws'); } catch (e) {}
  post('ready', { version: py.version });
}

function ensureDir(p) {
  const parts = p.split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try { py.FS.mkdir(cur); } catch (e) {}
  }
}

function snapshot(dir) {
  const out = {};
  function walk(d) {
    let names = [];
    try { names = py.FS.readdir(d); } catch (e) { return; }
    for (const n of names) {
      if (n === '.' || n === '..' || n === '__pycache__') continue;
      const p = d + '/' + n;
      let st;
      try { st = py.FS.stat(p); } catch (e) { continue; }
      if (py.FS.isDir(st.mode)) walk(p);
      else out[p] = st.mtime.getTime() + ':' + st.size;
    }
  }
  walk(dir);
  return out;
}

async function run(msg) {
  const t0 = performance.now();
  // çalışma klasörünün dosyalarını sanal FS'e yaz (open('veri.txt') çalışsın)
  for (const f of msg.files || []) {
    const p = '/ws/' + f.path;
    ensureDir(p.substring(0, p.lastIndexOf('/')));
    py.FS.writeFile(p, f.content);
  }
  const before = snapshot('/ws');
  try {
    await py.loadPackagesFromImports(msg.code, {
      messageCallback: (m) => post('info', { text: m + '\n' }),
      errorCallback: (m) => post('stderr', { text: m + '\n' })
    });
  } catch (e) { /* paket yoksa çalıştırmayı yine de dene */ }
  const fn = py.globals.get('__vsc_run');
  let rc = 1;
  try { rc = fn(msg.code, '/ws/' + msg.path, '/ws/' + (msg.cwd || ''), py.toPy(msg.argv || [])); }
  catch (e) { post('stderr', { text: String(e) + '\n' }); }
  finally { fn.destroy && fn.destroy(); }
  // flush kalan çözücü baytlar
  const restOut = decOut.decode(), restErr = decErr.decode();
  if (restOut) post('stdout', { text: restOut });
  if (restErr) post('stderr', { text: restErr });
  // program yeni dosya yazdıysa workspace'e geri gönder
  const after = snapshot('/ws');
  const changed = [];
  for (const p in after) {
    if (before[p] !== after[p] && !p.endsWith('.pyc')) {
      try {
        const st = py.FS.stat(p);
        if (st.size < 2000000) changed.push({ path: p.substring(4), content: py.FS.readFile(p, { encoding: 'utf8' }) });
      } catch (e) {}
    }
  }
  post('done', { id: msg.id, rc, ms: Math.round(performance.now() - t0), changed });
}

async function handle(m) {
  try {
    if (m.type === 'init') await init(m.indexURL);
    else if (m.type === 'run') await run(m);
    else if (m.type === 'repl-start') { py.globals.get('__vsc_repl_start')(); post('repl-more', { more: false }); }
    else if (m.type === 'repl-line') {
      const more = py.globals.get('__vsc_repl_push')(m.line);
      post('repl-more', { more: !!more });
    }
  } catch (e) {
    post('error', { message: (e && e.message) || String(e), id: m.id });
  }
}

if (IN_WORKER) self.onmessage = (ev) => handle(ev.data);
else self.__pyHost = { setPost(fn) { postFn = fn; }, handle };
})();
