/* ==========================================================================
   VS iPad – workbench.js
   VS Code arayüzü (Monaco editör) + dosya sistemi + terminal + derleyiciler
   ========================================================================== */
(() => {
'use strict';

// ---------------------------------------------------------------- sabitler
const IS_NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge);
const CDN = IS_NATIVE ? '/cdn/jsd/' : 'https://cdn.jsdelivr.net/';
const MONACO_VER = '0.52.2';
const PYODIDE_VER = '0.26.4';
const MONACO_BASE = CDN + 'npm/monaco-editor@' + MONACO_VER + '/min';
const PYODIDE_URL = CDN + 'pyodide/v' + PYODIDE_VER + '/full/';
const SQLJS_BASE = CDN + 'npm/sql.js@1.10.3/dist/';
const CODICON_CSS = CDN + 'npm/@vscode/codicons@0.0.36/dist/codicon.css';
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ---------------------------------------------------------------- yardımcılar
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const basename = (p) => p.split('/').pop();
const dirname = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const join = (a, b) => (a ? (b ? a + '/' + b : a) : b);
const extOf = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i + 1).toLowerCase(); };
const stem = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? b : b.slice(0, i); };
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function normPath(cwd, p) {
  if (p == null) return cwd;
  if (p === '~' || p === '/' ) return '';
  let parts = (p.startsWith('~/') || p.startsWith('/')) ? [] : (cwd ? cwd.split('/') : []);
  for (const seg of p.replace(/^~\//, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}
function fmtBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }

// ---------------------------------------------------------------- native köprü
function native(cmd, args = {}) {
  if (IS_NATIVE) return window.webkit.messageHandlers.bridge.postMessage({ cmd, args });
  return Mock.handle(cmd, args);
}

// Tarayıcıda (Mac'te Safari/Chrome ile önizleme) çalışırken sahte dosya sistemi
const Mock = {
  fs: null,
  load() { try { this.fs = JSON.parse(localStorage.getItem('mockfs') || 'null'); } catch (e) {} if (!this.fs) this.fs = {}; },
  save() { try { localStorage.setItem('mockfs', JSON.stringify(this.fs)); } catch (e) {} },
  async handle(cmd, a) {
    if (!this.fs) this.load();
    const fs = this.fs;
    switch (cmd) {
      case 'ws.info': case 'ws.useDefault': case 'ws.openFolder': return { name: 'VS iPad', external: false, path: '/browser' };
      case 'fs.tree': {
        const dirs = new Set();
        for (const p of Object.keys(fs)) {
          const parts = p.split('/');
          for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
          if (fs[p] === null) dirs.add(p);
        }
        const out = [];
        dirs.forEach((d) => out.push({ path: d, dir: true, size: 0 }));
        for (const p of Object.keys(fs)) if (fs[p] !== null) out.push({ path: p, dir: false, size: fs[p].length });
        return out;
      }
      case 'fs.read': if (typeof fs[a.path] !== 'string') throw new Error('ENOENT: ' + a.path); return { content: fs[a.path], binary: false };
      case 'fs.write': fs[a.path] = a.content; this.save(); return true;
      case 'fs.mkdir': fs[a.path] = null; this.save(); return true;
      case 'fs.delete': for (const p of Object.keys(fs)) if (p === a.path || p.startsWith(a.path + '/')) delete fs[p]; this.save(); return true;
      case 'fs.rename':
        for (const p of Object.keys(fs)) if (p === a.from || p.startsWith(a.from + '/')) { fs[a.to + p.slice(a.from.length)] = fs[p]; delete fs[p]; }
        this.save(); return true;
      case 'fs.exists': return Object.keys(fs).some((p) => p === a.path || p.startsWith(a.path + '/'));
      case 'fs.readB64': { const v = fs[a.path]; if (typeof v !== 'string') throw new Error('ENOENT: ' + a.path); return { b64: v.startsWith('\u0000b64:') ? v.slice(5) : btoa(unescape(encodeURIComponent(v))) }; }
      case 'fs.writeB64': { let txt; try { txt = decodeURIComponent(escape(atob(a.b64))); if (/\u0000/.test(txt)) throw 0; } catch (e) { txt = '\u0000b64:' + a.b64; } fs[a.path] = txt; this.save(); return true; }
      case 'secret.get': try { return localStorage.getItem('secret.' + a.key); } catch (e) { return null; }
      case 'secret.set': try { a.value ? localStorage.setItem('secret.' + a.key, a.value) : localStorage.removeItem('secret.' + a.key); } catch (e) {} return true;
      case 'kv.get': try { return localStorage.getItem('kv.' + a.key); } catch (e) { return null; }
      case 'kv.set': try { a.value == null ? localStorage.removeItem('kv.' + a.key) : localStorage.setItem('kv.' + a.key, a.value); } catch (e) {} return true;
      case 'http.request': {
        const body = a.bodyB64 ? Uint8Array.from(atob(a.bodyB64), (c) => c.charCodeAt(0)) : a.body;
        const r = await fetch(a.url, { method: a.method || 'GET', headers: a.headers, body });
        if (a.responseB64) { const u = new Uint8Array(await r.arrayBuffer()); let t = ''; for (let i = 0; i < u.length; i += 8192) t += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return { status: r.status, b64: btoa(t) }; }
        return { status: r.status, body: await r.text() };
      }
      case 'cache.info': return { bytes: 0, files: 0 };
      case 'cache.has': return false;
      case 'stdin.provide': case 'stdin.reset': case 'cache.clear': case 'app.share': case 'app.dismissKeyboard': return true;
      case 'app.openURL': window.open(a.url, '_blank'); return true;
      default: return null;
    }
  }
};

// ---------------------------------------------------------------- ayarlar
const DEFAULTS = {
  theme: 'Dark 2026', fontSize: 14, tabSize: 4, wordWrap: 'off', minimap: true, autoSave: true,
  runner: 'auto', pyRunner: 'local', cRunner: 'ask', cppRunner: 'ask', cflags: '', sideW: 260, panelH: 240, sidebar: true, panel: true,
  fixQuotes: true, stdin: '', args: '', view: 'explorer', lineNumbers: 'on', stickyScroll: true,
  lang: 'tr', ext: {}, pets: [{ type: 'cat', color: 'orange' }], petsBg: 'none', petsOpen: true,
  themeCustom: {}, userThemes: [], agent: { provider: 'claude', model: '', autoApprove: false }
};
const SET = Object.assign({}, DEFAULTS);
const saveSettings = debounce(() => native('kv.set', { key: 'settings', value: JSON.stringify(SET) }), 300);
async function loadSettings() {
  try { const s = await native('kv.get', { key: 'settings' }); if (s) Object.assign(SET, JSON.parse(s)); } catch (e) {}
}

// ---------------------------------------------------------------- diller
// ext -> [monacoId, görünen ad, çalıştırma türü]
const EXT = {
  c: ['c', 'C', 'c'], h: ['cpp', 'C++', null], ino: ['cpp', 'Arduino', 'ino'],
  cpp: ['cpp', 'C++', 'cpp'], cc: ['cpp', 'C++', 'cpp'], cxx: ['cpp', 'C++', 'cpp'], 'c++': ['cpp', 'C++', 'cpp'],
  hpp: ['cpp', 'C++', null], hh: ['cpp', 'C++', null], hxx: ['cpp', 'C++', null],
  cs: ['csharp', 'C#', 'cs'], java: ['java', 'Java', 'java'], py: ['python', 'Python', 'py'], pyw: ['python', 'Python', 'py'],
  js: ['javascript', 'JavaScript', 'js'], mjs: ['javascript', 'JavaScript', 'js'], cjs: ['javascript', 'JavaScript', 'js'],
  ts: ['typescript', 'TypeScript', null], json: ['json', 'JSON', null], md: ['markdown', 'Markdown', null], markdown: ['markdown', 'Markdown', null],
  html: ['html', 'HTML', 'html'], htm: ['html', 'HTML', 'html'], css: ['css', 'CSS', null], scss: ['scss', 'SCSS', null],
  txt: ['plaintext', 'Plain Text', null], csv: ['plaintext', 'CSV', null], sh: ['shell', 'Shell Script', null], zsh: ['shell', 'Shell Script', null],
  swift: ['swift', 'Swift', null], go: ['go', 'Go', null], rs: ['rust', 'Rust', 'rs'], kt: ['kotlin', 'Kotlin', null], sql: ['sql', 'SQL', 'sql'],
  xml: ['xml', 'XML', null], yml: ['yaml', 'YAML', null], yaml: ['yaml', 'YAML', null], php: ['php', 'PHP', null], rb: ['ruby', 'Ruby', null],
  lua: ['lua', 'Lua', null], r: ['r', 'R', null], m: ['objective-c', 'Objective-C', null], asm: ['mips', 'Assembly', null], s: ['mips', 'Assembly', null],
  v: ['systemverilog', 'Verilog', null], sv: ['systemverilog', 'SystemVerilog', null], vhd: ['plaintext', 'VHDL', null]
};
function langOf(path) { const e = EXT[extOf(path)]; return e ? { id: e[0], name: e[1], run: e[2] } : { id: 'plaintext', name: 'Plain Text', run: null }; }
const TEXT_EXT = new Set(Object.keys(EXT).concat(['in', 'out', 'dat', 'tsv', 'log', 'ini', 'cfg', 'toml', 'gitignore', 'makefile', '']));

const ICONS = {
  c: ['C', '#519aba'], h: ['h', '#a074c4'], cpp: ['C++', '#f34b7d'], cc: ['C++', '#f34b7d'], cxx: ['C++', '#f34b7d'], hpp: ['h', '#a074c4'],
  cs: ['C#', '#a074c4'], ino: ['∞', '#00979d'], java: ['J', '#cc3e44'], py: ['py', '#4b8bbe'], js: ['JS', '#cbcb41'], ts: ['TS', '#519aba'], html: ['<>', '#e37933'],
  css: ['#', '#519aba'], swift: ['S', '#e37933'], go: ['GO', '#519aba'], rs: ['RS', '#e37933'], kt: ['K', '#a074c4'], sh: ['$', '#4d5a5e'],
  sql: ['DB', '#f55385'], php: ['php', '#a074c4'], rb: ['rb', '#cc3e44'], csv: ['csv', '#8dc149']
};
const CODICON_ICONS = { md: ['markdown', '#519aba'], json: ['json', '#cbcb41'], txt: ['file', '#6d8086'], png: ['file-media', '#a074c4'], jpg: ['file-media', '#a074c4'],
  pdf: ['file-pdf', '#cc3e44'], zip: ['file-zip', '#6d8086'], xml: ['code', '#e37933'], yml: ['settings', '#a074c4'], yaml: ['settings', '#a074c4'] };
const X = () => window.VSCExt;
const t = (s, k) => (X() ? X().t(s, k) : s);
const tr = t;
const extOn = (id) => !(SET.ext && SET.ext[id] === false);
const matOn = () => extOn('pkief.material-icon-theme') && X() && X().Material.data;
function folderIconHTML(path, expanded, isRoot) { return matOn() ? X().Material.folderIcon(path, expanded, isRoot) : ''; }
function iconHTML(path) {
  if (matOn()) { const m = X().Material.fileIcon(path, langOf(path).id); if (m) return m; }
  const e = extOf(path);
  if (ICONS[e]) { const [t, c] = ICONS[e]; return `<span class="ficon-badge" style="color:${c}">${esc(t)}</span>`; }
  const ci = CODICON_ICONS[e] || ['file', '#6d8086'];
  return `<i class="codicon codicon-${ci[0]}" style="color:${ci[1]}"></i>`;
}

// ---------------------------------------------------------------- bildirimler & diyalog
function notify(kind, msg, opts = {}) {
  const icon = { info: 'info', error: 'error', warning: 'warning', success: 'check' }[kind] || 'info';
  const el = h('div', 'toast', `<i class="codicon codicon-${icon}"></i><div class="t-msg"><div class="t-text"></div><div class="t-actions"></div><div class="progress hidden"></div></div><i class="codicon codicon-close t-close"></i>`);
  $('.t-text', el).textContent = msg;
  const acts = $('.t-actions', el);
  (opts.actions || []).forEach((a, i) => {
    const b = h('button', i === 0 ? 'btn-mini' : 'btn-mini secondary'); b.textContent = a.label;
    b.onclick = () => { close(); a.run && a.run(); }; acts.appendChild(b);
  });
  if (!opts.actions || !opts.actions.length) acts.remove();
  const close = () => { el.remove(); };
  $('.t-close', el).onclick = close;
  $('#notifications').appendChild(el);
  const timeout = opts.timeout === undefined ? (kind === 'error' ? 10000 : 5000) : opts.timeout;
  if (timeout) setTimeout(close, timeout);
  return {
    close, el,
    text(m) { $('.t-text', el).textContent = m; },
    progress(p) { const pr = $('.progress', el); pr.classList.remove('hidden'); pr.style.width = Math.round(p * 100) + '%'; }
  };
}

function dialog(msg, detail = '', buttons = ['OK'], primary = 0) {
  return new Promise((resolve) => {
    $('#dlgMsg').textContent = msg; $('#dlgDetail').textContent = detail;
    const bw = $('#dlgButtons'); bw.innerHTML = '';
    buttons.forEach((b, i) => {
      const btn = h('button', i === primary ? 'btn-primary' : 'btn-secondary'); btn.textContent = t(b, b + '_btn');
      btn.onclick = () => { $('#dialog').classList.add('hidden'); resolve(i); };
      bw.appendChild(btn);
    });
    $('#dialog').classList.remove('hidden');
  });
}

// ---------------------------------------------------------------- editör katmanı (Monaco / yedek)
let monaco = null, editor = null;
let fallbackTA = null, fallbackModel = null;

const Ed = {
  createModel(path, text) {
    if (monaco) {
      const uri = monaco.Uri.from({ scheme: 'file', path: '/' + path + '#' + Math.random().toString(36).slice(2, 7) });
      const m = monaco.editor.createModel(text, langOf(path).id, uri);
      m.updateOptions({ tabSize: CTX.Settings ? +CTX.Settings.eff('tabSize') : SET.tabSize, insertSpaces: CTX.Settings ? CTX.Settings.eff('insertSpaces') !== false : true });
      return m;
    }
    return { value: text, path, listeners: [], fallback: true };
  },
  setModel(m, viewState) {
    if (monaco) {
      editor.setModel(m || null);
      if (m && viewState) editor.restoreViewState(viewState);
      return;
    }
    fallbackModel = m;
    fallbackTA.style.display = m ? '' : 'none';
    if (m) fallbackTA.value = m.value;
  },
  saveViewState() { return monaco && editor ? editor.saveViewState() : null; },
  getValue(m) { return m.fallback ? m.value : m.getValue(); },
  setValue(m, text) {
    if (m.fallback) { m.value = text; if (fallbackModel === m) fallbackTA.value = text; return; }
    if (m.getValue() === text) return;
    m.pushEditOperations([], [{ range: m.getFullModelRange(), text }], () => null);
  },
  dispose(m) { if (m && !m.fallback) m.dispose(); },
  setLanguage(m, path) { if (monaco && m && !m.fallback) monaco.editor.setModelLanguage(m, langOf(path).id); },
  markSaved(tab) { tab.savedVer = tab.model.fallback ? tab.model.value : tab.model.getAlternativeVersionId(); },
  isDirty(tab) { return tab.model.fallback ? tab.model.value !== tab.savedVer : tab.model.getAlternativeVersionId() !== tab.savedVer; },
  focus() { if (monaco && editor) editor.focus(); else if (fallbackTA) fallbackTA.focus(); },
  layout() { if (monaco && editor) editor.layout(); },
  reveal(line, col) {
    if (monaco && editor) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: col || 1 }); editor.focus(); return; }
    if (fallbackTA) {
      const lines = fallbackTA.value.split('\n'); let pos = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      fallbackTA.focus(); fallbackTA.setSelectionRange(pos, pos);
    }
  },
  setMarkers(m, list) {
    if (!monaco || !m || m.fallback) return;
    const S = monaco.MarkerSeverity;
    monaco.editor.setModelMarkers(m, 'run', list.map((d) => ({
      startLineNumber: d.line, startColumn: d.col || 1, endLineNumber: d.line, endColumn: d.col ? d.col + 1 : 1000,
      message: d.msg, severity: d.sev === 'error' ? S.Error : d.sev === 'warning' ? S.Warning : S.Info, source: d.source || ''
    })));
  },
  action(id) { if (monaco && editor) { const a = editor.getAction(id); if (a) { editor.focus(); a.run(); return true; } } return false; },
  trigger(handlerId, payload) { if (monaco && editor) { editor.focus(); editor.trigger('menu', handlerId, payload); } },
  cursor() {
    if (monaco && editor) { const p = editor.getPosition(); const sel = editor.getSelection(); const n = sel ? editor.getModel().getValueInRange(sel).length : 0; return { line: p ? p.lineNumber : 1, col: p ? p.column : 1, sel: n }; }
    if (fallbackTA) { const v = fallbackTA.value.slice(0, fallbackTA.selectionStart); const l = v.split('\n'); return { line: l.length, col: l[l.length - 1].length + 1, sel: fallbackTA.selectionEnd - fallbackTA.selectionStart }; }
    return { line: 1, col: 1, sel: 0 };
  },
  options() {
    if (!monaco || !editor) { if (fallbackTA) { fallbackTA.style.fontSize = SET.fontSize + 'px'; fallbackTA.style.whiteSpace = SET.wordWrap === 'on' ? 'pre-wrap' : 'pre'; } return; }
    const o = { fontSize: SET.fontSize, wordWrap: SET.wordWrap, minimap: { enabled: SET.minimap }, lineNumbers: SET.lineNumbers, stickyScroll: { enabled: SET.stickyScroll } };
    const x = CTX.Settings ? CTX.Settings.editorOptions() : {};
    for (const k of Object.keys(x)) o[k] = (x[k] && typeof x[k] === 'object' && !Array.isArray(x[k]) && o[k] && typeof o[k] === 'object') ? Object.assign({}, o[k], x[k]) : x[k];
    editor.updateOptions(o);
    if (x.fontFamily || x.fontSize || x.lineHeight || x.letterSpacing) { try { monaco.editor.remeasureFonts(); } catch (e) {} }
  }
};

function loadScript(src, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src;
    const t = setTimeout(() => reject(new Error('timeout: ' + src)), timeout);
    s.onload = () => { clearTimeout(t); resolve(); };
    s.onerror = () => { clearTimeout(t); reject(new Error('yüklenemedi: ' + src)); };
    document.head.appendChild(s);
  });
}

async function loadMonaco() {
  await loadScript(MONACO_BASE + '/vs/loader.js');
  window.require.config({ paths: { vs: MONACO_BASE + '/vs' } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Monaco timeout')), 90000);
    window.require(['vs/editor/editor.main'], () => { clearTimeout(t); resolve(); }, (e) => { clearTimeout(t); reject(e); });
  });
  return window.monaco;
}

function defineThemes() {
  const rulesDark = [
    { token: 'keyword.directive', foreground: 'C586C0' }, { token: 'keyword.directive.include', foreground: 'C586C0' },
    { token: 'keyword.control', foreground: 'C586C0' }, { token: 'annotation', foreground: 'DCDCAA' },
    { token: 'type.identifier', foreground: '4EC9B0' }, { token: 'number', foreground: 'B5CEA8' }
  ];
  monaco.editor.defineTheme('dark-modern', {
    base: 'vs-dark', inherit: true, rules: rulesDark,
    colors: {
      'editor.background': '#1F1F1F', 'editor.foreground': '#CCCCCC', 'editorGutter.background': '#1F1F1F',
      'editorLineNumber.foreground': '#6E7681', 'editorLineNumber.activeForeground': '#CCCCCC',
      'editor.lineHighlightBorder': '#282828', 'editorWidget.background': '#202020', 'editorWidget.border': '#313131',
      'editorSuggestWidget.background': '#202020', 'editorSuggestWidget.border': '#454545', 'editorHoverWidget.background': '#202020',
      'editorIndentGuide.background1': '#404040', 'editorIndentGuide.activeBackground1': '#707070', 'minimap.background': '#1F1F1F',
      'editorStickyScroll.background': '#1F1F1F', 'editorStickyScrollHover.background': '#2A2D2E', 'input.background': '#313131', 'input.border': '#3C3C3C',
      'focusBorder': '#0078D4', 'editorOverviewRuler.border': '#010409', 'scrollbarSlider.background': '#79797966', 'textLink.foreground': '#4daafc'
    }
  });
  monaco.editor.defineTheme('vsc-theme', { base: 'vs-dark', inherit: true, rules: rulesDark, colors: { 'editor.background': '#1F1F1F' } });
  monaco.editor.defineTheme('dark-plus', { base: 'vs-dark', inherit: true, rules: rulesDark, colors: { 'editor.background': '#1E1E1E' } });
  monaco.editor.defineTheme('light-modern', {
    base: 'vs', inherit: true, rules: [{ token: 'keyword.directive', foreground: 'AF00DB' }, { token: 'keyword.control', foreground: 'AF00DB' }],
    colors: { 'editor.background': '#FFFFFF', 'editorLineNumber.foreground': '#6E7681', 'editorLineNumber.activeForeground': '#171184',
      'editor.lineHighlightBorder': '#EEEEEE', 'editorWidget.background': '#F8F8F8', 'focusBorder': '#005FB8', 'minimap.background': '#FFFFFF' }
  });
}

const SNIPPETS = {
  c: [
    ['main', '#include <stdio.h>\n\nint main(void) {\n\t$0\n\treturn 0;\n}', 'main() iskeleti'],
    ['for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for döngüsü'],
    ['while', 'while (${1:kosul}) {\n\t$0\n}', 'while döngüsü'],
    ['if', 'if (${1:kosul}) {\n\t$0\n}', 'if'],
    ['printf', 'printf("${1:%d}\\n", ${2:x});', 'printf'],
    ['scanf', 'scanf("${1:%d}", &${2:x});', 'scanf'],
    ['inc', '#include <${1:stdlib.h}>', '#include'],
    ['struct', 'typedef struct ${1:Node} {\n\t${2:int data;}\n\tstruct ${1:Node} *next;\n} ${1:Node};', 'typedef struct (linked list)'],
    ['malloc', '${1:int} *${2:p} = (${1:int} *)malloc(${3:n} * sizeof(${1:int}));\nif (${2:p} == NULL) { return 1; }', 'malloc'],
    ['func', '${1:int} ${2:fonksiyon}(${3:void}) {\n\t$0\n}', 'fonksiyon']
  ],
  cpp: [
    ['main', '#include <iostream>\nusing namespace std;\n\nint main() {\n\t$0\n\treturn 0;\n}', 'main() iskeleti'],
    ['for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for döngüsü'],
    ['forr', 'for (auto &${1:x} : ${2:v}) {\n\t$0\n}', 'range-based for'],
    ['cout', 'cout << ${1} << endl;', 'cout'], ['cin', 'cin >> ${1};', 'cin'],
    ['class', 'class ${1:Sinif} {\npublic:\n\t${1:Sinif}();\n\t~${1:Sinif}();\n\t$0\nprivate:\n};', 'class'],
    ['vector', 'vector<${1:int}> ${2:v};', 'vector'], ['inc', '#include <${1:vector}>', '#include'],
    ['if', 'if (${1:kosul}) {\n\t$0\n}', 'if'], ['while', 'while (${1:kosul}) {\n\t$0\n}', 'while']
  ],
  java: [
    ['main', 'public static void main(String[] args) {\n\t$0\n}', 'main metodu'],
    ['psvm', 'public static void main(String[] args) {\n\t$0\n}', 'main metodu'],
    ['sout', 'System.out.println(${1});', 'System.out.println'], ['souf', 'System.out.printf("${1:%d}%n", ${2});', 'printf'],
    ['class', 'public class ${1:Main} {\n\t$0\n}', 'class'],
    ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for'],
    ['foreach', 'for (${1:int} ${2:x} : ${3:dizi}) {\n\t$0\n}', 'for-each'],
    ['scanner', 'Scanner ${1:sc} = new Scanner(System.in);', 'Scanner (import java.util.Scanner)'],
    ['ctor', 'public ${1:Sinif}(${2}) {\n\t$0\n}', 'constructor'],
    ['getset', 'public ${1:int} get${2:Ad}() { return ${3:ad}; }\npublic void set${2:Ad}(${1:int} ${3:ad}) { this.${3:ad} = ${3:ad}; }', 'getter + setter'],
    ['try', 'try {\n\t$0\n} catch (${1:Exception} e) {\n\te.printStackTrace();\n}', 'try/catch']
  ],
  csharp: [
    ['main', 'static void Main(string[] args)\n{\n\t$0\n}', 'Main'], ['cw', 'Console.WriteLine(${1});', 'Console.WriteLine'],
    ['class', 'public class ${1:Sinif}\n{\n\t$0\n}', 'class'], ['for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++)\n{\n\t$0\n}', 'for'],
    ['foreach', 'foreach (var ${1:x} in ${2:liste})\n{\n\t$0\n}', 'foreach'], ['prop', 'public ${1:int} ${2:Ad} { get; set; }', 'property'],
    ['rl', 'string ${1:satir} = Console.ReadLine();', 'Console.ReadLine']
  ],
  rust: [
    ['main', 'fn main() {\n\t$0\n}', 'fn main()'], ['fn', 'fn ${1:isim}(${2}) -> ${3:i32} {\n\t$0\n}', 'fonksiyon'],
    ['println', 'println!("${1:{}}", ${2});', 'println!'], ['let', 'let mut ${1:x} = ${2:0};', 'let mut'],
    ['for', 'for ${1:i} in ${2:0..n} {\n\t$0\n}', 'for'], ['match', 'match ${1:x} {\n\t${2:_} => ${3:{}},\n}', 'match'],
    ['struct', 'struct ${1:Isim} {\n\t${2:alan}: ${3:i32},\n}', 'struct'], ['impl', 'impl ${1:Isim} {\n\t$0\n}', 'impl'],
    ['vec', 'let mut ${1:v}: Vec<${2:i32}> = Vec::new();', 'Vec'],
    ['input', 'let mut ${1:satir} = String::new();\nstd::io::stdin().read_line(&mut ${1:satir}).unwrap();\nlet ${2:n}: ${3:i32} = ${1:satir}.trim().parse().unwrap();', 'stdin satır oku']
  ],
  sql: [
    ['create', 'CREATE TABLE ${1:tablo} (\n\tid INTEGER PRIMARY KEY,\n\t${2:ad} TEXT NOT NULL$0\n);', 'CREATE TABLE'],
    ['insert', 'INSERT INTO ${1:tablo} (${2:ad}) VALUES (${3:\'deger\'});', 'INSERT'],
    ['select', 'SELECT ${1:*} FROM ${2:tablo}${3: WHERE ${4:kosul}};', 'SELECT'],
    ['join', 'SELECT ${1:*}\nFROM ${2:a}\nJOIN ${3:b} ON ${2:a}.${4:id} = ${3:b}.${5:a_id};', 'JOIN'],
    ['group', 'SELECT ${1:sutun}, COUNT(*) AS adet\nFROM ${2:tablo}\nGROUP BY ${1:sutun}\nORDER BY adet DESC;', 'GROUP BY'],
    ['update', 'UPDATE ${1:tablo} SET ${2:sutun} = ${3:deger} WHERE ${4:kosul};', 'UPDATE'],
    ['delete', 'DELETE FROM ${1:tablo} WHERE ${2:kosul};', 'DELETE']
  ],
  python: [
    ['main', 'def main():\n\t$0\n\n\nif __name__ == "__main__":\n\tmain()', 'main iskeleti'],
    ['def', 'def ${1:fonksiyon}(${2}):\n\t$0', 'fonksiyon'], ['class', 'class ${1:Sinif}:\n\tdef __init__(self${2}):\n\t\t$0', 'class'],
    ['for', 'for ${1:i} in range(${2:n}):\n\t$0', 'for'], ['ifmain', 'if __name__ == "__main__":\n\t$0', '__main__'],
    ['with', 'with open("${1:dosya.txt}", "${2:r}", encoding="utf-8") as ${3:f}:\n\t$0', 'dosya aç'],
    ['try', 'try:\n\t$0\nexcept ${1:Exception} as e:\n\tprint(e)', 'try/except']
  ]
};

function setupMonaco() {
  defineThemes();
  editor = monaco.editor.create($('#editor-container'), {
    model: null, theme: monacoTheme(), automaticLayout: true, fontFamily: 'Menlo, ui-monospace, "SF Mono", monospace',
    fontSize: SET.fontSize, lineHeight: 0, minimap: { enabled: SET.minimap }, wordWrap: SET.wordWrap, lineNumbers: SET.lineNumbers,
    renderLineHighlight: 'all', bracketPairColorization: { enabled: true }, guides: { bracketPairs: 'active', indentation: true },
    stickyScroll: { enabled: SET.stickyScroll }, smoothScrolling: true, cursorSmoothCaretAnimation: 'off', scrollBeyondLastLine: true,
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true }, fixedOverflowWidgets: true, tabSize: SET.tabSize,
    mouseWheelZoom: false, contextmenu: true, padding: { top: 0 }, 'semanticHighlighting.enabled': false, dragAndDrop: true,
    suggest: { showWords: true }, quickSuggestions: { other: true, comments: false, strings: false }
  });
  // iPad klavyesinin otomatik büyük harf / düzeltme yapmasını kapat
  // (yoksa "int" yazıyorsun "Int" oluyor, "printf" yazıyorsun "printer" oluyor amk)
  const fixTA = () => $$('.monaco-editor textarea').forEach((t) => {
    t.setAttribute('autocapitalize', 'off'); t.setAttribute('autocorrect', 'off'); t.setAttribute('spellcheck', 'false'); t.setAttribute('autocomplete', 'off');
  });
  fixTA(); setTimeout(fixTA, 500);

  for (const [lang, list] of Object.entries(SNIPPETS)) {
    const langs = lang === 'c' ? ['c'] : lang === 'cpp' ? ['cpp'] : [lang];
    langs.forEach((L) => monaco.languages.registerCompletionItemProvider(L, {
      provideCompletionItems(model, pos) {
        const w = model.getWordUntilPosition(pos);
        const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
        return { suggestions: list.map(([label, body, doc]) => ({
          label, kind: monaco.languages.CompletionItemKind.Snippet, insertText: body, documentation: doc, detail: doc,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range
        })) };
      }
    }));
  }

  if (CTX.Sync) CTX.Sync.registerSnippets(monaco);
  editor.onDidChangeCursorPosition(updateCursorStatus);
  editor.onDidChangeCursorSelection(updateCursorStatus);
  editor.onDidChangeModelContent((e) => {
    const tab = Tabs.active; if (!tab || tab.virtual) return;
    scheduleBC(tab.model);
    if (SET.fixQuotes && !['markdown', 'plaintext'].includes(langOf(tab.path).id)) fixSmartQuotes(tab.model, e);
    Tabs.onContentChanged(tab);
  });
  editor.onDidFocusEditorText(() => { $('#fileTree').blur(); });
  // Monaco kısayollarına ek
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => Run.runActive());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => Tabs.save());
}

let bcTimer = null;
function applyBC(model) { if (!X() || !monaco) return; if (extOn('aaron-bond.better-comments')) X().BetterComments.apply(monaco, model); else X().BetterComments.clear(model); }
function scheduleBC(model) { clearTimeout(bcTimer); bcTimer = setTimeout(() => applyBC(model), 250); }
function fixSmartQuotes(model, e) {
  if (e.isUndoing || e.isRedoing) return;
  const bad = /[\u201C\u201D\u201E\u2018\u2019\u2014\u2013]/;
  if (!e.changes.some((c) => bad.test(c.text))) return;
  setTimeout(() => {
    const edits = [];
    for (const c of e.changes) {
      if (!bad.test(c.text)) continue;
      const start = model.getPositionAt(c.rangeOffset);
      const end = model.getPositionAt(c.rangeOffset + c.text.length);
      const fixed = c.text.replace(/[\u201C\u201D\u201E]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/\u2014/g, '--').replace(/\u2013/g, '-');
      edits.push({ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: fixed });
    }
    if (edits.length) model.pushEditOperations([], edits, () => null);
  }, 0);
}

function setupFallback() {
  fallbackTA = h('textarea', 'fallback-editor');
  fallbackTA.setAttribute('autocapitalize', 'off'); fallbackTA.setAttribute('autocorrect', 'off'); fallbackTA.setAttribute('spellcheck', 'false');
  fallbackTA.style.display = 'none';
  $('#editor-container').appendChild(fallbackTA);
  fallbackTA.addEventListener('input', () => {
    if (!fallbackModel) return;
    let v = fallbackTA.value;
    if (SET.fixQuotes && /[\u201C\u201D\u2018\u2019]/.test(v)) {
      const p = fallbackTA.selectionStart;
      v = v.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
      fallbackTA.value = v; fallbackTA.setSelectionRange(p, p);
    }
    fallbackModel.value = v;
    if (Tabs.active) Tabs.onContentChanged(Tabs.active);
  });
  fallbackTA.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, ' '.repeat(SET.tabSize)); }
  });
  ['keyup', 'click', 'select'].forEach((ev) => fallbackTA.addEventListener(ev, updateCursorStatus));
  Ed.options();
}

// ---------------------------------------------------------------- tema
const THEME_MIGRATE = { 'dark-modern': 'Dark Modern', 'dark-plus': 'Dark+', 'light-modern': 'Light Modern' };
function monacoTheme() { return 'vsc-theme'; }
function applyTheme() {
  if (THEME_MIGRATE[SET.theme]) { SET.theme = THEME_MIGRATE[SET.theme]; saveSettings(); }
  const T = CTX.Themes;
  if (T && T.list.length) T.apply(SET.theme);
  else {
    const light = /light/i.test(SET.theme);
    document.body.classList.remove('theme-dark-modern', 'theme-dark-plus', 'theme-light-modern');
    document.body.classList.add(light ? 'theme-light-modern' : 'theme-dark-modern');
    document.body.dataset.themeKind = light ? 'light' : 'dark';
    if (monaco) monaco.editor.setTheme(light ? 'light-modern' : 'vsc-theme');
  }
  if (typeof PetsUI !== 'undefined' && document.getElementById('petsStage')) PetsUI.bg();
  try { native('app.chrome', { bg: getComputedStyle(document.body).getPropertyValue('--title-bg').trim(), dark: document.body.dataset.themeKind !== 'light' }); } catch (e) {}
}
// eklenti modülleri (themes.js, git.js, agent.js) için ortak bağlam
const CTX = {};

// ---------------------------------------------------------------- fark görünümü (git / agent)
let diffEditor = null;
function openDiff(title, base, cur, path, opts = {}) {
  const lang = langOf(path || title).id;
  return Tabs.openVirtual('diff:' + (opts.id || path || title), title + (opts.suffix || (SET.lang === 'tr' ? ' (Değişiklikler)' : ' (Working Tree)')), '<i class="codicon codicon-diff"></i>', (root) => {
    root.classList.add('vd-diff');
    if (diffEditor) { try { const m = diffEditor.getModel(); diffEditor.dispose(); if (m) { m.original.dispose(); m.modified.dispose(); } } catch (e) {} diffEditor = null; }
    if (!monaco) {
      root.innerHTML = `<pre class="diff-plain">${esc(simpleDiff(base, cur))}</pre>`;
      return;
    }
    const box = h('div', 'diff-host'); root.appendChild(box);
    diffEditor = monaco.editor.createDiffEditor(box, {
      automaticLayout: true, readOnly: true, originalEditable: false, renderSideBySide: root.clientWidth > 760, fontSize: SET.fontSize,
      fontFamily: 'Menlo, ui-monospace, "SF Mono", monospace', minimap: { enabled: false }, scrollBeyondLastLine: false, renderOverviewRuler: false
    });
    diffEditor.setModel({ original: monaco.editor.createModel(base || '', lang), modified: monaco.editor.createModel(cur || '', lang) });
  });
}
function simpleDiff(a, b) {
  const A = (a || '').split('\n'), B = (b || '').split('\n'), out = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (A[i] === B[j]) { out.push('  ' + A[i]); i++; j++; }
    else if (j < B.length && A.indexOf(B[j], i) < 0) { out.push('+ ' + B[j]); j++; }
    else { out.push('- ' + A[i]); i++; }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- dosya ağacı (Explorer)
const Explorer = {
  entries: [], root: null, map: {}, expanded: new Set(), selected: null, ws: { name: 'VS iPad' },

  async refresh() {
    try { this.entries = await native('fs.tree'); } catch (e) { notify('error', 'Dosyalar okunamadı: ' + (e.message || e)); this.entries = []; }
    this.build(); this.render();
    if (CTX.Git) CTX.Git.scheduleRefresh();
  },
  build() {
    const root = { name: '', path: '', dir: true, children: [] };
    const map = { '': root };
    const sorted = this.entries.slice().sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    for (const e of sorted) {
      const parent = dirname(e.path);
      if (!map[parent]) { // eksik ara klasörleri oluştur
        let acc = '';
        for (const seg of parent.split('/')) {
          const np = join(acc, seg);
          if (!map[np]) { map[np] = { name: seg, path: np, dir: true, children: [] }; map[acc].children.push(map[np]); }
          acc = np;
        }
      }
      if (map[e.path]) continue;
      const node = { name: basename(e.path), path: e.path, dir: e.dir, size: e.size, children: [] };
      map[e.path] = node; map[parent].children.push(node);
    }
    const sortRec = (n) => {
      n.children.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, 'tr', { numeric: true, sensitivity: 'base' })));
      n.children.forEach(sortRec);
    };
    sortRec(root);
    this.root = root; this.map = map;
  },
  files() { return this.entries.filter((e) => !e.dir).map((e) => e.path); },
  gitDeco: null,
  gitDirDeco(dir) { for (const [p, k] of Object.entries(this.gitDeco)) if (k !== 'D' && p.startsWith(dir + '/')) return k === 'C' ? 'C' : 'M'; return null; },
  isDir(p) { return !!(this.map[p] && this.map[p].dir); },
  exists(p) { return !!this.map[p]; },

  render() {
    const cont = $('#fileTree');
    const scroll = cont.scrollTop;
    cont.innerHTML = '';
    if (!this.root || !this.root.children.length) {
      cont.innerHTML = `<div class="empty-view"><p class="dim">${t('You have not yet opened a folder.')}</p><button class="btn-primary wide" id="emptyNewFile">${t('New File...')}</button><p></p><button class="btn-secondary" id="emptyOpenFolder" style="width:100%">${t('Open Folder')}</button></div>`;
      $('#emptyNewFile').onclick = () => this.inlineCreate('', false);
      $('#emptyOpenFolder').onclick = () => Workspace.openFolder();
      return;
    }
    const frag = document.createDocumentFragment();
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        frag.appendChild(this.row(n, depth));
        if (n.dir && this.expanded.has(n.path)) {
          if (this.pendingCreate && this.pendingCreate.parent === n.path) frag.appendChild(this.createRow(depth + 1));
          walk(n.children, depth + 1);
        }
      }
    };
    if (this.pendingCreate && this.pendingCreate.parent === '') frag.appendChild(this.createRow(0));
    walk(this.root.children, 0);
    cont.appendChild(frag);
    cont.scrollTop = scroll;
    const inp = $('input.inline-edit', cont);
    if (inp) { inp.focus(); const v = inp.value; const dot = v.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 && !this.pendingRenameIsDir ? dot : v.length); }
  },
  row(n, depth) {
    const r = h('div', 'row' + (this.selected === n.path ? ' selected' : ''));
    r.dataset.path = n.path;
    r.style.paddingLeft = (depth * 8 + 8) + 'px';
    let guides = '';
    for (let i = 0; i < depth; i++) guides += `<span class="indent-guide" style="left:${i * 8 + 15}px"></span>`;
    const tw = n.dir ? `<i class="codicon codicon-chevron-${this.expanded.has(n.path) ? 'down' : 'right'}"></i>` : '';
    const icon = n.dir ? folderIconHTML(n.path, this.expanded.has(n.path)) : iconHTML(n.path);
    if (this.pendingRename === n.path) {
      r.innerHTML = `${guides}<span class="twist">${tw}</span>${icon ? `<span class="ficon">${icon}</span>` : ''}<input class="inline-edit" value="${esc(n.name)}" autocapitalize="off" autocorrect="off" spellcheck="false">`;
      this.bindInline($('input', r), (val) => this.finishRename(n.path, val));
    } else {
      const dirty = Tabs.list.some((t) => t.path === n.path && t.dirty);
      const g = this.gitDeco && (n.dir ? this.gitDirDeco(n.path) : this.gitDeco[n.path]);
      const gcls = g ? ' git-' + g.toLowerCase() : '';
      r.innerHTML = `${guides}<span class="twist">${tw}</span>${icon ? `<span class="ficon">${icon}</span>` : ''}<span class="label${gcls}">${esc(n.name)}${dirty ? ' <span class="dim">●</span>' : ''}</span>${g ? `<span class="git-deco${gcls}">${n.dir ? '●' : g}</span>` : ''}`;
    }
    return r;
  },
  createRow(depth) {
    const pc = this.pendingCreate;
    const r = h('div', 'row');
    r.style.paddingLeft = (depth * 8 + 8) + 'px';
    r.innerHTML = `<span class="twist">${pc.folder ? '<i class="codicon codicon-chevron-right"></i>' : ''}</span><span class="ficon">${pc.folder ? folderIconHTML('x', false) : (matOn() ? X().Material.fileIcon('x.txt', 'plaintext') : '<i class="codicon codicon-file"></i>')}</span><input class="inline-edit" value="" autocapitalize="off" autocorrect="off" spellcheck="false">`;
    this.bindInline($('input', r), (val) => this.finishCreate(val));
    return r;
  },
  bindInline(inp, done) {
    let finished = false;
    const finish = (val) => { if (finished) return; finished = true; done(val); };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(inp.value.trim()); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    });
    inp.addEventListener('blur', () => setTimeout(() => finish(inp.value.trim() || null), 150));
    inp.addEventListener('click', (e) => e.stopPropagation());
  },
  targetDir() {
    const s = this.selected;
    if (s == null || s === '') return '';
    return this.isDir(s) ? s : dirname(s);
  },
  inlineCreate(parent, folder) {
    showView('explorer');
    if (parent == null) parent = this.targetDir();
    if (parent) { let acc = ''; for (const seg of parent.split('/')) { acc = join(acc, seg); this.expanded.add(acc); } }
    this.pendingRename = null;
    this.pendingCreate = { parent, folder };
    this.render();
  },
  async finishCreate(name) {
    const pc = this.pendingCreate; this.pendingCreate = null;
    if (!name) { this.render(); return; }
    if (/[\\:*?"<>|]/.test(name)) { notify('error', `The name ${name} is not valid as a file or folder name.`); this.render(); return; }
    const path = normPath(pc.parent, name);
    if (this.exists(path)) { notify('error', `A file or folder ${name} already exists at this location.`); this.render(); return; }
    try {
      if (pc.folder) { await native('fs.mkdir', { path }); this.expanded.add(path); }
      else { await native('fs.write', { path, content: '' }); }
      this.selected = path;
      await this.refresh();
      if (!pc.folder) Tabs.open(path, { preview: false });
    } catch (e) { notify('error', String(e.message || e)); this.render(); }
  },
  startRename(path) { this.pendingCreate = null; this.pendingRename = path; this.pendingRenameIsDir = this.isDir(path); this.render(); },
  async finishRename(path, name) {
    this.pendingRename = null;
    if (!name || name === basename(path)) { this.render(); return; }
    const to = join(dirname(path), name);
    try {
      await native('fs.rename', { from: path, to });
      Tabs.list.forEach((t) => {
        if (t.path === path || t.path.startsWith(path + '/')) { t.path = to + t.path.slice(path.length); Ed.setLanguage(t.model, t.path); }
      });
      if (this.expanded.has(path)) { this.expanded.delete(path); this.expanded.add(to); }
      this.selected = to;
      await this.refresh(); Tabs.render(); Tabs.updateChrome(); saveSession();
    } catch (e) { notify('error', String(e.message || e)); this.render(); }
  },
  async remove(path) {
    const isDir = this.isDir(path);
    const i = await dialog(SET.lang === 'tr' ? `'${basename(path)}' ${isDir ? 'klasörünü ve içeriğini' : 'öğesini'} silmek istediğinizden emin misiniz?` : `Are you sure you want to delete '${basename(path)}'${isDir ? ' and its contents' : ''}?`, 'This action is irreversible!', ['Delete', 'Cancel'], 0);
    if (i !== 0) return;
    try {
      await native('fs.delete', { path });
      Tabs.list.filter((t) => t.path === path || t.path.startsWith(path + '/')).forEach((t) => Tabs.close(t, true, true));
      if (this.selected === path) this.selected = null;
      await this.refresh();
    } catch (e) { notify('error', String(e.message || e)); }
  },
  reveal(path) {
    let acc = '';
    const parts = dirname(path).split('/').filter(Boolean);
    for (const seg of parts) { acc = join(acc, seg); this.expanded.add(acc); }
    this.selected = path; this.render();
    const r = $(`#fileTree .row[data-path="${CSS.escape(path)}"]`);
    if (r) r.scrollIntoView({ block: 'nearest' });
  },
  toggle(path) { if (this.expanded.has(path)) this.expanded.delete(path); else this.expanded.add(path); this.render(); saveSession(); },
  contextMenu(path, x, y) {
    const isDir = path === '' || this.isDir(path);
    const run = !isDir && langOf(path).run;
    const items = [];
    if (!isDir) items.push({ label: 'Open to the Side', run: () => Tabs.open(path, { preview: false }) });
    if (run) items.push({ label: 'Run Code', kb: '⌘↵', run: () => Run.runFile(path) });
    if (extOf(path) === 'md') items.push({ label: 'Open Preview', run: () => { Tabs.open(path, { preview: false }).then(() => MD.toggle(true)); } });
    if (items.length) items.push('-');
    items.push({ label: 'New File...', run: () => this.inlineCreate(isDir ? path : dirname(path), false) });
    items.push({ label: 'New Folder...', run: () => this.inlineCreate(isDir ? path : dirname(path), true) });
    items.push({ label: 'Open in Integrated Terminal', run: () => { Term.cwd = isDir ? path : dirname(path); Term.updatePrompt(); Panel.show('terminal'); Term.focus(); } });
    items.push('-');
    items.push({ label: 'Find in Folder...', run: () => { showView('search'); $('#searchInput').focus(); Search.folder = isDir ? path : dirname(path); } });
    items.push('-');
    if (path !== '') {
      items.push({ label: 'Copy Path', kb: '⌥⌘C', run: () => copyText(path) });
      items.push({ label: 'Copy Name', run: () => copyText(basename(path)) });
      items.push('-');
      if (!isDir) items.push({ label: 'Share…', run: () => native('app.share', { path }) });
      items.push({ label: 'Duplicate', run: () => this.duplicate(path), disabled: isDir });
      items.push({ label: 'Rename...', kb: '↵', run: () => this.startRename(path) });
      items.push({ label: 'Delete', kb: '⌘⌫', run: () => this.remove(path) });
    }
    Menu.show(items, x, y);
  },
  async duplicate(path) {
    const d = dirname(path), s = stem(path), e = extOf(path);
    let n = 1, np;
    do { np = join(d, `${s} copy${n > 1 ? ' ' + n : ''}${e ? '.' + e : ''}`); n++; } while (this.exists(np));
    const r = await native('fs.read', { path });
    await native('fs.write', { path: np, content: r.content });
    this.selected = np; await this.refresh();
  }
};

function copyText(t) {
  try { navigator.clipboard.writeText(t); notify('info', 'Kopyalandı: ' + t, { timeout: 2000 }); }
  catch (e) { const ta = h('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
}

function bindContext(el, fn) {
  let last = 0;
  const fire = (x, y, e) => { const now = Date.now(); if (now - last < 700) return; last = now; fn(x, y, e); };
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); fire(e.clientX, e.clientY, e); });
  let timer = null, sx = 0, sy = 0, fired = false;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; fired = false;
    clearTimeout(timer);
    timer = setTimeout(() => { fired = true; fire(sx, sy, e); }, 520);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) clearTimeout(timer); }, { passive: true });
  el.addEventListener('touchend', (e) => { clearTimeout(timer); if (fired) { e.preventDefault(); el.dataset.suppressClick = '1'; setTimeout(() => delete el.dataset.suppressClick, 400); } });
  el.addEventListener('touchcancel', () => clearTimeout(timer));
}

// ---------------------------------------------------------------- sekmeler
const Tabs = {
  list: [], active: null, history: [], histPos: -1,

  async open(path, opts = {}) {
    if (CTX.Viewer && CTX.Viewer.canView(path)) { CTX.Viewer.openViewer(path); return null; }
    const preview = opts.preview !== false;
    let tab = this.list.find((t) => t.path === path);
    const isNew = !tab;
    if (!tab) {
      let res;
      try { res = await native('fs.read', { path }); }
      catch (e) { notify('error', `Unable to open '${basename(path)}': ${e.message || e}`); return null; }
      if (res.binary) { notify('warning', `'${basename(path)}' is binary or uses an unsupported text encoding.`); return null; }
      const model = Ed.createModel(path, res.content);
      tab = { path, model, preview, dirty: false, viewState: null };
      Ed.markSaved(tab);
      const old = preview ? this.list.find((t) => t.preview && !t.dirty) : null;
      const idx = this.active ? this.list.indexOf(this.active) + 1 : this.list.length;
      if (old) { const oi = this.list.indexOf(old); this.list.splice(oi, 1, tab); Ed.dispose(old.model); }
      else this.list.splice(idx, 0, tab);
      const probs = Problems.byFile(path);
      if (probs.length) Ed.setMarkers(model, probs);
    } else if (!preview) tab.preview = false;
    if (isNew && /\.(md|markdown)$/i.test(path) && SET.mdReading !== false && opts.reading !== false && !opts.line) tab.reading = true;
    this.activate(tab, opts.focus !== false && !tab.reading);
    if (opts.line) setTimeout(() => Ed.reveal(opts.line, opts.col), 30);
    return tab;
  },
  openVirtual(id, title, iconHtml, renderFn) {
    let tab = this.list.find((x) => x.path === 'virtual:' + id);
    if (!tab) {
      tab = { path: 'virtual:' + id, virtual: true, title, iconHtml, renderFn, model: null, dirty: false, preview: false };
      const idx = this.active ? this.list.indexOf(this.active) + 1 : this.list.length;
      this.list.splice(idx, 0, tab);
    } else { tab.title = title; tab.renderFn = renderFn; if (iconHtml) tab.iconHtml = iconHtml; }
    this.activate(tab, false);
    return tab;
  },
  activate(tab, focus) {
    if (this.active && this.active !== tab && !this.active.virtual) this.active.viewState = Ed.saveViewState();
    this.active = tab;
    const vd = $('#virtual-doc');
    if (tab && tab.virtual) {
      Ed.setModel(null);
      vd.classList.remove('hidden', 'vd-diff'); vd.innerHTML = ''; tab.renderFn(vd); vd.scrollTop = 0;
    } else {
      vd.classList.add('hidden'); vd.innerHTML = '';
      Ed.setModel(tab ? tab.model : null, tab ? tab.viewState : null);
    }
    if (tab && !tab.virtual) {
      if (this.history[this.histPos] !== tab.path) { this.history = this.history.slice(0, this.histPos + 1); this.history.push(tab.path); this.histPos = this.history.length - 1; }
      Explorer.selected = tab.path; Explorer.reveal(tab.path);
      if (focus && !IS_TOUCH) Ed.focus();
      if (monaco && tab.model && !tab.model.fallback) applyBC(tab.model);
    }
    const wantReading = tab && tab.reading;
    MD.toggle(false);
    if (wantReading) MD.toggle(true);
    this.render(); this.updateChrome(); saveSession();
    if (CTX.Esp && SET.view === 'esp32') CTX.Esp.renderView();
  },
  render() {
    const cont = $('#tabs'); cont.innerHTML = '';
    const names = {}; this.list.forEach((t) => { const b = basename(t.path); names[b] = (names[b] || 0) + 1; });
    for (const t of this.list) {
      const el = h('div', 'tab' + (t === this.active ? ' active' : '') + (t.preview ? ' preview' : '') + (t.dirty ? ' dirty' : ''));
      el.dataset.path = t.path;
      const desc = !t.virtual && names[basename(t.path)] > 1 ? `<span class="tab-desc">${esc(dirname(t.path) || '~')}</span>` : '';
      el.innerHTML = `<span class="ficon">${t.virtual ? t.iconHtml : iconHTML(t.path)}</span><span class="tab-label">${esc(t.virtual ? t.title : basename(t.path))}</span>${desc}<span class="tab-close"><i class="codicon codicon-close"></i></span>`;
      el.addEventListener('click', (e) => {
        if (el.dataset.suppressClick) return;
        if (e.target.closest('.tab-close')) { this.close(t); return; }
        this.activate(t, true);
      });
      el.addEventListener('dblclick', () => { t.preview = false; this.render(); });
      bindContext(el, (x, y) => Menu.show([
        { label: 'Close', kb: '⌘W', run: () => this.close(t) },
        { label: 'Close Others', run: () => this.list.filter((o) => o !== t).forEach((o) => this.close(o)) },
        { label: 'Close to the Right', run: () => this.list.slice(this.list.indexOf(t) + 1).forEach((o) => this.close(o)) },
        { label: 'Close Saved', run: () => this.list.filter((o) => !o.dirty).forEach((o) => this.close(o)) },
        { label: 'Close All', run: () => this.closeAll() }, '-',
        { label: 'Copy Path', run: () => copyText(t.path) },
        { label: 'Reveal in Explorer View', run: () => { showView('explorer'); Explorer.reveal(t.path); } }, '-',
        { label: t.preview ? 'Keep Open' : 'Pin', run: () => { t.preview = false; this.render(); } }
      ], x, y));
      cont.appendChild(el);
    }
    const a = $('.tab.active', cont); if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('#watermark').classList.toggle('hidden', !!this.active);
    $('#breadcrumbs').classList.toggle('hidden', !this.active);
  },
  updateChrome() {
    const t = this.active;
    const bc = $('#breadcrumbs'); bc.innerHTML = '';
    ['sbCursor', 'sbIndent', 'sbEnc', 'sbEol', 'sbLang'].forEach((id) => $('#' + id).classList.toggle('hidden', !t));
    $('#eaPreview').classList.toggle('hidden', !(t && extOf(t.path) === 'md'));
    $('#eaRunGroup').classList.toggle('hidden', !(t && langOf(t.path).run));
    if (!t) { $('#runFileInfo').textContent = '— (açık dosya yok)'; $('#cc-label').textContent = Explorer.ws.name; return; }
    if (t.virtual) {
      ['sbCursor', 'sbIndent', 'sbEnc', 'sbEol', 'sbLang'].forEach((id) => $('#' + id).classList.add('hidden'));
      $('#eaRunGroup').classList.add('hidden');
      bc.appendChild(h('span', 'bc', `<span class="ficon">${t.iconHtml}</span>` + esc(t.title)));
      return;
    }
    const parts = t.path.split('/');
    parts.forEach((p, i) => {
      if (i) bc.appendChild(h('i', 'codicon codicon-chevron-right sep'));
      const last = i === parts.length - 1;
      const s = h('span', 'bc', (last ? `<span class="ficon">${iconHTML(t.path)}</span>` : '') + esc(p));
      const sub = parts.slice(0, i + 1).join('/');
      s.onclick = () => { if (!last) { showView('explorer'); Explorer.expanded.add(sub); Explorer.reveal(sub); } };
      bc.appendChild(s);
    });
    const L = langOf(t.path);
    $('#sbLangText').textContent = L.name;
    $('#sbIndent').textContent = tr('Spaces') + ': ' + SET.tabSize;
    $('#cc-label').textContent = Explorer.ws.name;
    Run.updateInfo();
    updateCursorStatus();
  },
  onContentChanged(tab) {
    const was = tab.dirty;
    tab.dirty = Ed.isDirty(tab);
    if (tab.preview) { tab.preview = false; this.render(); }
    else if (was !== tab.dirty) this.render();
    if (SET.autoSave && tab.dirty) this.scheduleSave(tab);
  },
  scheduleSave(tab) {
    clearTimeout(tab._saveT);
    tab._saveT = setTimeout(() => this.save(tab, true), 1000);
  },
  async save(tab = this.active, silent = false) {
    if (!tab || tab.virtual) return;
    clearTimeout(tab._saveT);
    if (CTX.Settings) await CTX.Settings.beforeSave(tab);
    const content = Ed.getValue(tab.model);
    try {
      await native('fs.write', { path: tab.path, content });
      if (Ed.getValue(tab.model) === content) { Ed.markSaved(tab); tab.dirty = false; } else tab.dirty = Ed.isDirty(tab);
      this.render();
      if (!Explorer.exists(tab.path)) Explorer.refresh(); else if (CTX.Git) CTX.Git.scheduleRefresh();
      if (CTX.Settings) CTX.Settings.onFileSaved(tab.path);
    } catch (e) { notify('error', `Failed to save '${basename(tab.path)}': ${e.message || e}`); }
  },
  async saveAll() { for (const t of this.list) if (t.dirty) await this.save(t, true); },
  async close(tab, force = false, noSave = false) {
    if (!tab) return;
    if (tab.dirty && !noSave) {
      if (SET.autoSave || force) await this.save(tab, true);
      else {
        const i = await dialog(SET.lang === 'tr' ? `${basename(tab.path)} dosyasında yaptığınız değişiklikleri kaydetmek istiyor musunuz?` : `Do you want to save the changes you made to ${basename(tab.path)}?`, "Your changes will be lost if you don't save them.", ['Save', "Don't Save", 'Cancel']);
        if (i === 2) return;
        if (i === 0) await this.save(tab, true);
      }
    }
    const idx = this.list.indexOf(tab);
    if (idx < 0) return;
    this.list.splice(idx, 1);
    if (this.active === tab) {
      const next = this.list[idx] || this.list[idx - 1] || null;
      this.active = null;
      if (next) this.activate(next, false);
      else { Ed.setModel(null); this.render(); this.updateChrome(); }
    } else this.render();
    Ed.dispose(tab.model);
    saveSession();
  },
  async closeAll() { for (const t of this.list.slice()) await this.close(t); },
  next(d) {
    if (!this.list.length) return;
    const i = (this.list.indexOf(this.active) + d + this.list.length) % this.list.length;
    this.activate(this.list[i], true);
  },
  async reloadFromDisk(path) {
    const t = this.list.find((x) => x.path === path);
    if (!t || t.dirty) return;
    try { const r = await native('fs.read', { path }); Ed.setValue(t.model, r.content); Ed.markSaved(t); t.dirty = false; this.render(); } catch (e) {}
  },
  navigate(d) {
    const np = this.histPos + d;
    if (np < 0 || np >= this.history.length) return;
    this.histPos = np;
    this.open(this.history[np], { preview: false });
  }
};

function updateCursorStatus() {
  if (!Tabs.active) return;
  const c = Ed.cursor();
  $('#sbCursor').textContent = `${t('Ln')} ${c.line}, ${t('Col')} ${c.col}` + (c.sel ? ` (${c.sel} ${t('selected')})` : '');
}

const saveSession = debounce(() => {
  const s = { tabs: Tabs.list.filter((x) => !x.virtual).map((x) => ({ path: x.path, preview: x.preview })), active: Tabs.active && !Tabs.active.virtual && Tabs.active.path, expanded: Array.from(Explorer.expanded), cwd: Term.cwd };
  native('kv.set', { key: 'session', value: JSON.stringify(s) });
}, 500);

// ---------------------------------------------------------------- workspace
const Workspace = {
  set(info) {
    Explorer.ws = info;
    $('#wsName').textContent = (info.name || 'VS iPad').toUpperCase();
    $('#cc-label').textContent = info.name;
    if (CTX.Settings) CTX.Settings.loadWorkspace();
  },
  async openFolder() {
    const before = Explorer.ws.path;
    const info = await native('ws.openFolder');
    if (!info || info.path === before) return;
    await Tabs.closeAll();
    this.set(info); Explorer.expanded.clear(); Explorer.selected = null; Term.cwd = '';
    await Explorer.refresh(); Term.updatePrompt();
    notify('info', `Klasör açıldı: ${info.name}`);
  },
  async useDefault() {
    await Tabs.closeAll();
    const info = await native('ws.useDefault');
    this.set(info); Explorer.expanded.clear(); Term.cwd = '';
    await Explorer.refresh(); Term.updatePrompt();
  }
};

// ---------------------------------------------------------------- görünümler / layout
function showView(name) {
  if (name === 'agent') name = 'claude';
  SET.view = name; saveSettings();
  $$('.ab-item[data-view]').forEach((e) => e.classList.toggle('active', e.dataset.view === name));
  $$('#sidebar .view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + name));
  setSidebar(true);
  if (name === 'search') setTimeout(() => $('#searchInput').focus(), 50);
  if (name === 'run') Run.updateInfo();
  if (name === 'scm' && CTX.Git) CTX.Git.refresh(true);
  if (name === 'claude' || name === 'ag') SET.auxView = name;
  syncTitleButtons();
  if (CTX.Agents && CTX.Agents[name]) CTX.Agents[name].focus();
  if (name === 'esp32' && CTX.Esp) CTX.Esp.renderView();
}
function syncTitleButtons() {
  const sb = $('#tbToggleSidebar'), pn = $('#tbTogglePanel'), ax = $('#tbToggleAux');
  if (!sb) return;
  sb.className = 'codicon tb-btn codicon-layout-sidebar-left' + (SET.sidebar ? '' : '-off');
  pn.className = 'codicon tb-btn codicon-layout-panel' + (SET.panel ? '' : '-off');
  const ai = SET.sidebar && (SET.view === 'claude' || SET.view === 'ag');
  ax.className = 'codicon tb-btn codicon-layout-sidebar-right' + (ai ? '' : '-off');
}
function setSidebar(on) {
  SET.sidebar = on; saveSettings();
  document.body.classList.toggle('no-sidebar', !on);
  if (!on) $$('.ab-item[data-view]').forEach((e) => e.classList.remove('active'));
  else $$('.ab-item[data-view]').forEach((e) => e.classList.toggle('active', e.dataset.view === SET.view));
  syncTitleButtons();
  setTimeout(() => Ed.layout(), 10);
}
const Panel = {
  current: 'terminal',
  show(name) {
    if (name) this.current = name;
    this.setVisible(true);
    $$('.ptab').forEach((e) => e.classList.toggle('active', e.dataset.ptab === this.current));
    $$('.pview').forEach((v) => v.classList.toggle('hidden', v.id !== 'pview-' + this.current));
    $('#termLabel').classList.toggle('hidden', this.current !== 'terminal');
    $('#paNewTerm').classList.toggle('hidden', this.current !== 'terminal');
    if (this.current === 'terminal') Term.scroll();
  },
  setVisible(on) {
    SET.panel = on; saveSettings();
    document.body.classList.toggle('no-panel', !on);
    if (typeof syncTitleButtons === 'function') syncTitleButtons();
    if (!on) document.body.classList.remove('panel-max');
    setTimeout(() => Ed.layout(), 10);
  },
  toggle() { if (SET.panel) this.setVisible(false); else this.show(); },
  toggleMax() { document.body.classList.toggle('panel-max'); $('#paMax').className = 'codicon pa-btn codicon-chevron-' + (document.body.classList.contains('panel-max') ? 'down' : 'up'); setTimeout(() => Ed.layout(), 10); }
};
// tema değişkenleri body üzerinde tanımlı → düzen değişkenlerini hem :root hem body'ye yaz
function setLayoutVar(k, px) { document.documentElement.style.setProperty(k, px + 'px'); document.body.style.setProperty(k, px + 'px'); }
function applyLayout() {
  setLayoutVar('--side-w', SET.sideW);
  setLayoutVar('--panel-h', SET.panelH);
  setSidebar(SET.sidebar);
  Panel.setVisible(SET.panel);
}
function bindSashes() {
  const drag = (sash, onMove, onReset) => {
    let active = false, lastTap = 0;
    const end = () => { if (!active) return; active = false; sash.classList.remove('active'); document.body.classList.remove('sash-dragging'); saveSettings(); Ed.layout(); };
    const start = () => {
      active = true; sash.classList.add('active'); document.body.classList.add('sash-dragging');
      const now = Date.now(); if (now - lastTap < 350 && onReset) { onReset(); end(); } lastTap = now;
    };
    sash.addEventListener('pointerdown', (e) => { e.preventDefault(); try { sash.setPointerCapture(e.pointerId); } catch (er) {} start(); });
    window.addEventListener('pointermove', (e) => { if (active) { onMove(e); Ed.layout(); } });
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    // iPad (WKWebView): kaydırma hareketi pointer olaylarını iptal etmesin
    // pointercancel yüzünden panel boyutlandırma yarım saat çalışmadı, touch ile zorla hallettik
    sash.addEventListener('touchstart', (e) => { e.preventDefault(); if (!active) start(); }, { passive: false });
    window.addEventListener('touchmove', (e) => { if (!active) return; e.preventDefault(); const t = e.touches[0]; onMove({ clientX: t.clientX, clientY: t.clientY }); Ed.layout(); }, { passive: false });
    window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
  };
  drag($('#sashSide'), (e) => {
    const left = $('#sidebar').getBoundingClientRect().left;
    SET.sideW = Math.max(170, Math.min(window.innerWidth * 0.6, e.clientX - left));
    setLayoutVar('--side-w', SET.sideW);
  }, () => { SET.sideW = DEFAULTS.sideW; setLayoutVar('--side-w', SET.sideW); });
  drag($('#sashPanel'), (e) => {
    const bottom = $('#editor-and-panel').getBoundingClientRect().bottom;
    SET.panelH = Math.max(80, Math.min(bottom - 120, bottom - e.clientY));
    setLayoutVar('--panel-h', SET.panelH);
  }, () => { SET.panelH = DEFAULTS.panelH; setLayoutVar('--panel-h', SET.panelH); });
}
function fitViewport() {
  const vv = window.visualViewport;
  const hgt = vv ? vv.height : window.innerHeight;
  setLayoutVar('--vh', Math.round(hgt));
  if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  Ed.layout();
}

// ---------------------------------------------------------------- menüler
const Menu = {
  show(items, x, y, opts = {}) {
    const layer = $('#menuLayer');
    layer.innerHTML = ''; layer.classList.remove('hidden');
    const m = h('div', 'menu');
    for (const it of items) {
      if (it === '-') { m.appendChild(h('div', 'menu-sep')); continue; }
      const mi = h('div', 'menu-item' + (it.disabled ? ' disabled' : ''),
        `${it.checked ? '<i class="codicon codicon-check mi-check"></i>' : ''}<span>${esc(t(it.label))}</span>${it.kb ? `<span class="mi-kb">${esc(it.kb)}</span>` : ''}`);
      mi.addEventListener('click', (e) => { e.stopPropagation(); this.hide(); it.run && setTimeout(it.run, 0); });
      m.appendChild(mi);
    }
    layer.appendChild(m);
    const r = m.getBoundingClientRect();
    const vw = window.innerWidth, vh = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--vh')) || window.innerHeight;
    m.style.left = Math.max(4, Math.min(x, vw - r.width - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, vh - r.height - 4)) + 'px';
    layer.onclick = (e) => { if (e.target === layer) this.hide(); };
    layer.oncontextmenu = (e) => { e.preventDefault(); this.hide(); };
    this.onHide = opts.onHide;
  },
  hide() { $('#menuLayer').classList.add('hidden'); $('#menuLayer').innerHTML = ''; $$('.menu-title.open').forEach((e) => e.classList.remove('open')); this.onHide && this.onHide(); this.onHide = null; }
};

function menubarItems(name) {
  const C = (id) => { const c = Commands.get(id); return c ? { label: c.menuLabel || c.label.replace(/^[^:]+: /, ''), kb: c.kb, run: c.run, checked: c.checked && c.checked() } : null; };
  const M = {
    file: ['file.newFile', 'file.newFolder', '-', 'ws.openFolder', 'ws.useDefault', '-', 'file.save', 'file.saveAll', '-', 'file.autoSave', '-', 'file.share', 'file.revert', 'editor.close', 'editor.closeAll', '-', 'dev.reload'],
    edit: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', '-', 'edit.find', 'edit.replace', '-', 'view.search', '-', 'edit.comment', 'edit.blockComment', '-', 'edit.format'],
    selection: ['sel.all', 'sel.expand', 'sel.shrink', '-', 'sel.copyLineUp', 'sel.copyLineDown', 'sel.moveLineUp', 'sel.moveLineDown', '-', 'sel.cursorAbove', 'sel.cursorBelow', 'sel.nextOccurrence', 'sel.allOccurrences'],
    view: ['palette', 'quickOpen', '-', 'view.explorer', 'view.search', 'view.run', 'view.extensions', '-', 'view.problems', 'view.output', 'view.terminal', '-', 'view.sidebar', 'view.panel', '-', 'view.wordWrap', 'view.minimap', 'view.stickyScroll', '-', 'view.zoomIn', 'view.zoomOut', 'view.zoomReset'],
    go: ['go.back', 'go.forward', '-', 'quickOpen', 'go.line', 'go.symbol', '-', 'go.nextProblem', 'go.prevProblem', '-', 'tabs.next', 'tabs.prev'],
    run: ['run.run', 'run.withInput', 'run.stop', '-', 'run.cRunner', 'run.selectRunner', 'run.pyRunner', '-', 'run.prepareOffline'],
    terminal: ['term.new', 'term.clear', '-', 'run.run', 'term.python'],
    help: ['help.welcome', 'help.shortcuts', 'pref.language', 'help.about']
  };
  return (M[name] || []).map((id) => (id === '-' ? '-' : C(id))).filter(Boolean);
}
function bindMenubar() {
  let openName = null;
  // </> simgesi: iPad'de üst menü çubuğu gizli olduğundan tüm menülere buradan ulaşılır (Windows/Linux VS Code'daki ☰ gibi)
  const appMenu = $('#tbAppMenu');
  if (appMenu) appMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = appMenu.getBoundingClientRect(), tr = SET.lang !== 'en';
    const names = [['file', tr ? 'Dosya' : 'File'], ['edit', tr ? 'Düzenle' : 'Edit'], ['selection', tr ? 'Seçim' : 'Selection'], ['view', tr ? 'Görünüm' : 'View'], ['go', tr ? 'Git' : 'Go'], ['run', tr ? 'Çalıştır' : 'Run'], ['terminal', 'Terminal'], ['help', tr ? 'Yardım' : 'Help']];
    appMenu.classList.add('open');
    const open = (n, label) => Menu.show([{ label: '‹ ' + (tr ? 'Geri' : 'Back'), run: () => setTimeout(() => appMenu.click(), 0) }, '-'].concat(menubarItems(n)), r.left, r.bottom + 2, { onHide: () => appMenu.classList.remove('open') });
    Menu.show(names.map(([n, l]) => ({ label: l + '  ›', run: () => open(n, l) })).concat(['-',
      { label: tr ? 'Komut Paleti…' : 'Command Palette…', kb: '⇧⌘P', run: () => openQuickOpen('>') },
      { label: tr ? 'Ayarlar' : 'Settings', kb: '⌘,', run: () => Commands.run('pref.settings') }]), r.left, r.bottom + 2, { onHide: () => appMenu.classList.remove('open') });
  });
  $$('.menu-title').forEach((t) => {
    const open = () => {
      $$('.menu-title.open').forEach((e) => e.classList.remove('open'));
      t.classList.add('open'); openName = t.dataset.menu;
      const r = t.getBoundingClientRect();
      Menu.show(menubarItems(t.dataset.menu), r.left, r.bottom + 2, { onHide: () => { openName = null; } });
      t.classList.add('open');
    };
    t.addEventListener('click', (e) => { e.stopPropagation(); if (openName === t.dataset.menu) Menu.hide(); else open(); });
    t.addEventListener('mouseenter', () => { if (openName && openName !== t.dataset.menu) open(); });
  });
}

// ---------------------------------------------------------------- Quick Input (komut paleti, dosya aç)
function fuzzy(q, s) {
  if (!q) return { score: 0, idx: [] };
  const ql = q.toLowerCase(), sl = s.toLowerCase();
  const c = sl.indexOf(ql);
  if (c >= 0) { const idx = []; for (let k = 0; k < ql.length; k++) idx.push(c + k); return { score: 1000 - c * 2 - s.length * 0.1, idx }; }
  let i = 0, score = 0, last = -2; const idx = [];
  for (let k = 0; k < sl.length && i < ql.length; k++) {
    if (sl[k] === ql[i]) { idx.push(k); score += k === last + 1 ? 5 : 1; last = k; i++; }
  }
  return i === ql.length ? { score, idx } : null;
}
function hl(s, idx) { const set = new Set(idx); let o = ''; for (let i = 0; i < s.length; i++) o += set.has(i) ? '<b>' + esc(s[i]) + '</b>' : esc(s[i]); return o; }

const QI = {
  opts: null, items: [], sel: 0,
  open(opts) {
    this.opts = opts; this._lastActive = undefined;
    const inp = $('#qiInput');
    inp.value = opts.value || '';
    inp.placeholder = opts.placeholder || '';
    $('#qiTitle').classList.toggle('hidden', !opts.title); $('#qiTitle').textContent = opts.title || '';
    $('#qiMsg').classList.toggle('hidden', !opts.message); $('#qiMsg').textContent = opts.message || '';
    $('#quickinput').classList.remove('hidden');
    this.update();
    setTimeout(() => { inp.focus(); if (opts.selectAll) inp.select(); }, 20);
  },
  close() { $('#quickinput').classList.add('hidden'); const o = this.opts; this.opts = null; if (o && o.onCancel) o.onCancel(); },
  update() {
    const o = this.opts; if (!o) return;
    const v = $('#qiInput').value;
    if (o.onChange) { const r = o.onChange(v); if (r && r.redirect) return; }
    let items = typeof o.items === 'function' ? o.items(v) : (o.items || []);
    if (o.filter !== false && typeof o.items !== 'function') {
      const q = v.trim();
      items = items.map((it) => { const f = fuzzy(q, it.label); return f ? Object.assign({}, it, { _f: f }) : null; }).filter(Boolean);
      if (q) items.sort((a, b) => b._f.score - a._f.score);
    }
    this.items = items; this.sel = 0;
    this.renderList();
  },
  renderList() {
    const list = $('#qiList'); list.innerHTML = '';
    this.items.slice(0, 300).forEach((it, i) => {
      if (it.sep) list.appendChild(h('div', 'qi-sep', esc(it.sep)));
      const el = h('div', 'qi-item' + (i === this.sel ? ' sel' : ''));
      const label = it._f ? hl(it.label, it._f.idx) : esc(it.label);
      el.innerHTML = `${it.icon || ''}<span class="qi-label">${label}</span>${it.desc ? `<span class="qi-desc">${esc(it.desc)}</span>` : ''}${it.kb ? `<span class="qi-kb">${it.kb.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>` : ''}`;
      el.addEventListener('click', () => { this.sel = i; this.accept(); });
      list.appendChild(el);
    });
    if (!this.items.length && this.opts && this.opts.emptyText) list.appendChild(h('div', 'qi-item', `<span class="qi-desc">${esc(this.opts.emptyText)}</span>`));
    const s = $('.qi-item.sel', list); if (s) s.scrollIntoView({ block: 'nearest' });
    if (this.opts && this.opts.onActive) { const it = this.items[this.sel]; if (it !== this._lastActive) { this._lastActive = it; try { this.opts.onActive(it); } catch (e) { console.error(e); } } }
  },
  accept() {
    const o = this.opts; if (!o) return;
    const it = this.items[this.sel];
    const v = $('#qiInput').value;
    this.opts = null;
    $('#quickinput').classList.add('hidden');
    if (o.onAccept) o.onAccept(it, v);
  }
};
function bindQuickInput() {
  const inp = $('#qiInput');
  inp.addEventListener('input', () => QI.update());
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); QI.sel = Math.min(QI.items.length - 1, QI.sel + 1); QI.renderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); QI.sel = Math.max(0, QI.sel - 1); QI.renderList(); }
    else if (e.key === 'Enter') { e.preventDefault(); QI.accept(); }
    else if (e.key === 'Escape') { e.preventDefault(); QI.close(); }
  });
  $('#quickinput').addEventListener('click', (e) => { if (e.target.id === 'quickinput') QI.close(); });
}

function inputBox(opts) {
  return new Promise((resolve) => {
    QI.open({
      placeholder: opts.placeholder, value: opts.value, title: opts.title, message: opts.prompt, filter: false, selectAll: true,
      items: () => [], onAccept: (_, v) => resolve(v), onCancel: () => resolve(null)
    });
  });
}
function quickPick(items, opts = {}) {
  return new Promise((resolve) => {
    QI.open({ placeholder: opts.placeholder, title: opts.title, items, onAccept: (it) => resolve(it || null), onCancel: () => resolve(null) });
  });
}

function openQuickOpen(prefix = '') {
  const recent = Tabs.history.slice().reverse().filter((p, i, a) => a.indexOf(p) === i);
  QI.open({
    value: prefix, placeholder: t('Search files by name (append : to go to line or @ to go to symbol)'), filter: false,
    items: (v) => {
      if (v.startsWith('>')) return commandItems(v.slice(1));
      if (v.startsWith(':')) {
        const n = parseInt(v.slice(1), 10);
        return [{ label: isNaN(n) ? t('Type a line number to navigate to.') : (SET.lang === 'tr' ? `${n}. satıra git` : `Go to line ${n}`), line: n }];
      }
      if (v.startsWith('?')) return [{ label: '…  Go to File', pre: '' }, { label: '>  Show and Run Commands', pre: '>' }, { label: ':  Go to Line', pre: ':' }];
      const q = v.trim();
      const files = Explorer.files();
      let items;
      if (!q) {
        const rec = recent.filter((p) => files.includes(p)).map((p, i) => ({ label: basename(p), desc: dirname(p), path: p, icon: `<span class="ficon">${iconHTML(p)}</span>`, sep: i === 0 ? t('recently opened') : null }));
        const rest = files.filter((p) => !recent.includes(p)).slice(0, 200).map((p, i) => ({ label: basename(p), desc: dirname(p), path: p, icon: `<span class="ficon">${iconHTML(p)}</span>`, sep: i === 0 && rec.length ? t('files') : null }));
        items = rec.concat(rest);
      } else {
        items = files.map((p) => {
          const f = fuzzy(q, basename(p)) || (fuzzy(q, p) ? { score: fuzzy(q, p).score - 500, idx: [] } : null);
          return f ? { label: basename(p), desc: dirname(p), path: p, _f: f, icon: `<span class="ficon">${iconHTML(p)}</span>` } : null;
        }).filter(Boolean).sort((a, b) => b._f.score - a._f.score);
      }
      return items;
    },
    emptyText: t('No matching results'),
    onAccept: (it, v) => {
      if (!it) return;
      if (v.startsWith('>')) { it.run && it.run(); return; }
      if (it.pre != null) { setTimeout(() => openQuickOpen(it.pre), 30); return; }
      if (it.line) { Ed.reveal(it.line, 1); return; }
      if (it.path) Tabs.open(it.path, { preview: false });
    }
  });
}
function commandItems(q) {
  q = (q || '').trim();
  let items = Commands.list.filter((c) => !c.hidden).map((c) => ({ label: t(c.label, c.label + '_cmd'), kb: c.kb, run: c.run }));
  if (q) items = items.map((it) => { const f = fuzzy(q, it.label); return f ? Object.assign(it, { _f: f }) : null; }).filter(Boolean).sort((a, b) => b._f.score - a._f.score);
  else items.sort((a, b) => a.label.localeCompare(b.label));
  return items;
}

// ---------------------------------------------------------------- komutlar
const Commands = {
  list: [],
  add(id, label, run, kb, extra) { this.list.push(Object.assign({ id, label, run, kb }, extra || {})); },
  get(id) { return this.list.find((c) => c.id === id); },
  run(id) { const c = this.get(id); if (c) c.run(); }
};
// ---------------------------------------------------------------- "Claude'a sor": Claude uygulamasına aktar
// API anahtarı gerekmez (Pro abonelik uygulamada). Aktif dosya + seçim + hatalar + son terminal
// çıktısı panoya kopyalanır, sonra Claude uygulaması (yoksa claude.ai) açılır → ⌘V.
async function askClaudeApp() {
  const tr = SET.lang !== 'en';
  const tab = Tabs.active;
  const parts = [];
  let file = null, lang = '', code = '', selText = '', selFrom = 0, selTo = 0;
  if (tab && !tab.virtual) {
    file = tab.path; lang = langOf(file).id || '';
    try {
      if (monaco && editor && editor.getModel()) {
        code = editor.getModel().getValue();
        const sel = editor.getSelection();
        if (sel && !sel.isEmpty()) { selText = editor.getModel().getValueInRange(sel); selFrom = sel.startLineNumber; selTo = sel.endLineNumber; }
      } else if (tab.model && tab.model.getValue) code = tab.model.getValue();
    } catch (e) {}
  }
  const question = await inputBox({ title: tr ? "Claude'a sor" : 'Ask Claude', prompt: tr ? 'Sorunu yaz (boş bırakırsan: "Bu kodu incele, hataları açıkla ve düzelt")' : 'Your question (optional)', value: '' });
  if (question == null) return;
  const fence = (s, l) => '```' + (l || '') + '\n' + s.replace(/\n$/, '') + '\n```';
  const fenceLang = { c: 'c', cpp: 'cpp', python: 'python', java: 'java', javascript: 'js', sql: 'sql', html: 'html', markdown: 'md', csharp: 'csharp', rust: 'rust' }[String(lang).toLowerCase()] || (file ? extOf(file) : '');
  parts.push(question.trim() || (tr ? 'Bu kodu incele, hataları açıkla ve düzeltilmiş tam dosyayı ver.' : 'Review this code, explain the errors and give the fixed full file.'));
  parts.push(tr ? '(VS iPad editöründen gönderildi.)' : '(Sent from VS iPad.)');
  if (file) {
    const MAX = 60000;
    parts.push(`${tr ? 'Dosya' : 'File'}: ${file}`);
    if (selText) parts.push(`${tr ? 'Seçili kısım' : 'Selection'} (${tr ? 'satır' : 'lines'} ${selFrom}-${selTo}):\n` + fence(selText, fenceLang));
    if (code) parts.push((tr ? 'Dosyanın tamamı:' : 'Full file:') + '\n' + fence(code.length > MAX ? code.slice(0, MAX) + '\n… (' + (tr ? 'kısaltıldı' : 'truncated') + ')' : code, fenceLang));
  }
  const probs = (Problems.list || []).slice(0, 40);
  if (probs.length) parts.push((tr ? 'Derleyici / Sorunlar paneli:' : 'Problems:') + '\n' + fence(probs.map((d) => `${d.file}:${d.line}:${d.col || 1}: ${d.sev}: ${d.msg}`).join('\n')));
  const term = ($('#termOut') ? $('#termOut').textContent : '').trim();
  if (term) parts.push((tr ? 'Son terminal çıktısı:' : 'Recent terminal output:') + '\n' + fence(term.slice(-3000)));
  const text = parts.join('\n\n');
  try { await native('app.copy', { text }); }
  catch (e) { try { await navigator.clipboard.writeText(text); } catch (er) {} }
  notify('info', tr ? `Panoya kopyalandı (${(text.length / 1024).toFixed(1)} KB). Claude açılıyor – mesaj kutusuna ⌘V ile yapıştır.` : 'Copied. Opening Claude – paste with ⌘V.', { timeout: 6000 });
  try { await native('app.openClaude', { q: text.length < 6000 ? text : '' }); } catch (e) {}
}
function registerCommands() {
  const A = (id, label, run, kb, extra) => Commands.add(id, label, run, kb, extra);
  A('palette', 'Show All Commands', () => openQuickOpen('>'), '⇧ ⌘ P', { menuLabel: 'Command Palette...' });
  A('quickOpen', 'Go to File...', () => openQuickOpen(''), '⌘ P');
  A('file.newFile', 'File: New File...', () => Explorer.inlineCreate(null, false), '⌘ N', { menuLabel: 'New File...' });
  A('file.newFolder', 'File: New Folder...', () => Explorer.inlineCreate(null, true), '', { menuLabel: 'New Folder...' });
  A('ws.openFolder', 'File: Open Folder...', () => Workspace.openFolder(), '', { menuLabel: 'Open Folder... (iCloud Drive / Dosyalar)' });
  A('ws.useDefault', 'File: Open App Documents Folder', () => Workspace.useDefault(), '', { menuLabel: 'Open App Folder (On My iPad)' });
  A('file.save', 'File: Save', () => Tabs.save(), '⌘ S', { menuLabel: 'Save' });
  A('file.saveAll', 'File: Save All', () => Tabs.saveAll(), '⌥ ⌘ S', { menuLabel: 'Save All' });
  A('file.autoSave', 'File: Toggle Auto Save', () => { SET.autoSave = !SET.autoSave; saveSettings(); notify('info', 'Auto Save: ' + (SET.autoSave ? 'afterDelay' : 'off'), { timeout: 2000 }); }, '', { menuLabel: 'Auto Save', checked: () => SET.autoSave });
  A('file.revert', 'File: Revert File', async () => { const t = Tabs.active; if (!t) return; const r = await native('fs.read', { path: t.path }); Ed.setValue(t.model, r.content); Ed.markSaved(t); t.dirty = false; Tabs.render(); }, '', { menuLabel: 'Revert File' });
  A('file.share', 'File: Share Active File…', () => { if (Tabs.active) native('app.share', { path: Tabs.active.path }); }, '', { menuLabel: 'Share… (AirDrop, Files)' });
  A('editor.close', 'View: Close Editor', () => Tabs.close(Tabs.active), '⌘ W', { menuLabel: 'Close Editor' });
  A('editor.closeAll', 'View: Close All Editors', () => Tabs.closeAll(), '', { menuLabel: 'Close All Editors' });
  const inPlainField = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || (a.tagName === 'TEXTAREA' && !a.closest('.monaco-editor'))); };
  A('edit.undo', 'Undo', () => { if (inPlainField()) document.execCommand('undo'); else Ed.trigger('undo'); }, '⌘ Z', { hidden: true });
  A('edit.redo', 'Redo', () => { if (inPlainField()) document.execCommand('redo'); else Ed.trigger('redo'); }, '⇧ ⌘ Z', { hidden: true });
  A('edit.cut', 'Cut', () => { Ed.focus(); document.execCommand('cut'); }, '⌘ X', { hidden: true });
  A('edit.copy', 'Copy', () => { Ed.focus(); document.execCommand('copy'); }, '⌘ C', { hidden: true });
  A('edit.paste', 'Paste', async () => { try { const t = await navigator.clipboard.readText(); Ed.trigger('type', { text: t }); } catch (e) { notify('info', 'Yapıştırmak için ⌘V kullan veya editöre uzun bas.'); } }, '⌘ V', { hidden: true });
  A('edit.find', 'Find', () => { if (inPlainField()) return; Ed.action('actions.find'); }, '⌘ F', { hidden: true });
  A('edit.replace', 'Replace', () => Ed.action('editor.action.startFindReplaceAction'), '⌥ ⌘ F', { hidden: true });
  A('edit.comment', 'Toggle Line Comment', () => Ed.action('editor.action.commentLine'), '⌘ /');
  A('edit.blockComment', 'Toggle Block Comment', () => Ed.action('editor.action.blockComment'), '⇧ ⌥ A');
  A('edit.format', 'Format Document', () => { if (!Ed.action('editor.action.formatDocument')) notify('info', 'Bu dil için biçimlendirici yok.'); }, '⇧ ⌥ F');
  A('sel.all', 'Select All', () => Ed.action('editor.action.selectAll'), '⌘ A', { hidden: true });
  A('sel.expand', 'Expand Selection', () => Ed.action('editor.action.smartSelect.expand'), '⌃ ⇧ ⌘ →');
  A('sel.shrink', 'Shrink Selection', () => Ed.action('editor.action.smartSelect.shrink'), '⌃ ⇧ ⌘ ←');
  A('sel.copyLineUp', 'Copy Line Up', () => Ed.action('editor.action.copyLinesUpAction'), '⇧ ⌥ ↑');
  A('sel.copyLineDown', 'Copy Line Down', () => Ed.action('editor.action.copyLinesDownAction'), '⇧ ⌥ ↓');
  A('sel.moveLineUp', 'Move Line Up', () => Ed.action('editor.action.moveLinesUpAction'), '⌥ ↑');
  A('sel.moveLineDown', 'Move Line Down', () => Ed.action('editor.action.moveLinesDownAction'), '⌥ ↓');
  A('sel.cursorAbove', 'Add Cursor Above', () => Ed.action('editor.action.insertCursorAbove'), '⌥ ⌘ ↑');
  A('sel.cursorBelow', 'Add Cursor Below', () => Ed.action('editor.action.insertCursorBelow'), '⌥ ⌘ ↓');
  A('sel.nextOccurrence', 'Add Next Occurrence', () => Ed.action('editor.action.addSelectionToNextFindMatch'), '⌘ D');
  A('sel.allOccurrences', 'Select All Occurrences', () => Ed.action('editor.action.selectHighlights'), '⇧ ⌘ L');
  A('view.explorer', 'View: Show Explorer', () => showView('explorer'), '⇧ ⌘ E', { menuLabel: 'Explorer' });
  A('view.search', 'View: Show Search', () => showView('search'), '⇧ ⌘ F', { menuLabel: 'Search' });
  A('view.run', 'View: Show Run and Debug', () => showView('run'), '⇧ ⌘ D', { menuLabel: 'Run' });
  A('view.extensions', 'View: Show Extensions', () => showView('extensions'), '⇧ ⌘ X', { menuLabel: 'Extensions' });
  A('view.problems', 'View: Toggle Problems', () => Panel.show('problems'), '⇧ ⌘ M', { menuLabel: 'Problems' });
  A('view.output', 'View: Toggle Output', () => Panel.show('output'), '⇧ ⌘ U', { menuLabel: 'Output' });
  A('view.terminal', 'View: Toggle Terminal', () => { if (SET.panel && Panel.current === 'terminal') Panel.setVisible(false); else { Panel.show('terminal'); Term.focus(); } }, '⌃ `', { menuLabel: 'Terminal' });
  A('view.sidebar', 'View: Toggle Primary Side Bar Visibility', () => setSidebar(!SET.sidebar), '⌘ B', { menuLabel: 'Primary Side Bar', checked: () => SET.sidebar });
  A('view.panel', 'View: Toggle Panel Visibility', () => Panel.toggle(), '⌘ J', { menuLabel: 'Panel', checked: () => SET.panel });
  A('view.wordWrap', 'View: Toggle Word Wrap', () => { SET.wordWrap = SET.wordWrap === 'on' ? 'off' : 'on'; saveSettings(); Ed.options(); }, '⌥ Z', { menuLabel: 'Word Wrap', checked: () => SET.wordWrap === 'on' });
  A('view.minimap', 'View: Toggle Minimap', () => { SET.minimap = !SET.minimap; saveSettings(); Ed.options(); }, '', { menuLabel: 'Minimap', checked: () => SET.minimap });
  A('view.stickyScroll', 'View: Toggle Sticky Scroll', () => { SET.stickyScroll = !SET.stickyScroll; saveSettings(); Ed.options(); }, '', { menuLabel: 'Sticky Scroll', checked: () => SET.stickyScroll });
  A('view.zoomIn', 'View: Zoom In (Editor Font)', () => { SET.fontSize = Math.min(32, SET.fontSize + 1); saveSettings(); Ed.options(); }, '⌘ =', { menuLabel: 'Zoom In' });
  A('view.zoomOut', 'View: Zoom Out (Editor Font)', () => { SET.fontSize = Math.max(8, SET.fontSize - 1); saveSettings(); Ed.options(); }, '⌘ -', { menuLabel: 'Zoom Out' });
  A('view.zoomReset', 'View: Reset Zoom', () => { SET.fontSize = DEFAULTS.fontSize; saveSettings(); Ed.options(); }, '⌘ 0', { menuLabel: 'Reset Zoom' });
  A('go.back', 'Go Back', () => Tabs.navigate(-1), '⌃ -', { menuLabel: 'Back' });
  A('go.forward', 'Go Forward', () => Tabs.navigate(1), '⌃ ⇧ -', { menuLabel: 'Forward' });
  A('go.line', 'Go to Line/Column...', () => openQuickOpen(':'), '⌃ G', { menuLabel: 'Go to Line/Column...' });
  A('go.symbol', 'Go to Symbol in Editor...', () => { if (!Ed.action('editor.action.quickOutline')) notify('info', 'Sembol listesi bu dil için yok.'); }, '⇧ ⌘ O', { menuLabel: 'Go to Symbol in Editor...' });
  A('go.nextProblem', 'Go to Next Problem', () => Ed.action('editor.action.marker.nextInFiles'), 'F8', { menuLabel: 'Next Problem' });
  A('go.prevProblem', 'Go to Previous Problem', () => Ed.action('editor.action.marker.prevInFiles'), '⇧ F8', { menuLabel: 'Previous Problem' });
  A('tabs.next', 'View: Open Next Editor', () => Tabs.next(1), '⌃ Tab', { menuLabel: 'Next Editor' });
  A('tabs.prev', 'View: Open Previous Editor', () => Tabs.next(-1), '⌃ ⇧ Tab', { menuLabel: 'Previous Editor' });
  A('run.run', 'Run: Run Code', () => Run.runActive(), '⌘ ↵', { menuLabel: 'Run Code (F5)' });
  A('run.withInput', 'Run: Run Code with Input...', () => Run.runActive({ askInput: true }), '', { menuLabel: 'Run with Input...' });
  A('run.stop', 'Run: Stop', () => Run.stop(), '⇧ F5', { menuLabel: 'Stop' });
  A('run.selectRunner', 'Run: Select Compiler Service', async () => {
    const it = await quickPick([{ label: 'Auto', desc: 'Wandbox, olmazsa Compiler Explorer', v: 'auto' }, { label: 'Wandbox', desc: 'wandbox.org', v: 'wandbox' }, { label: 'Compiler Explorer', desc: 'godbolt.org', v: 'godbolt' }], { placeholder: 'C / C++ / Java / C# için derleme servisi' });
    if (it) { SET.runner = it.v; saveSettings(); syncRunControls(); }
  }, '', { menuLabel: 'Select Compiler Service...' });
  A('run.cRunner', 'C: Select Compiler (local / online)', async () => {
    const it = await quickPick([{ label: 'Her çalıştırmada sor', desc: 'Mac\'teki VS Code gibi', v: 'ask' }].concat(Run.compilerChoices('c')), { placeholder: 'C dosyaları için varsayılan derleyici' });
    if (it) { SET.cRunner = it.v; saveSettings(); syncRunControls(); notify('info', 'C derleyicisi: ' + it.label, { timeout: 2500 }); }
  }, '', { menuLabel: 'Select C Compiler...' });
  A('run.cppRunner', 'C++: Select Compiler (Clang local / online g++)', async () => {
    const it = await quickPick([{ label: 'Her çalıştırmada sor', desc: 'Mac\'teki VS Code gibi', v: 'ask' }].concat(Run.compilerChoices('cpp')), { placeholder: 'C++ dosyaları için varsayılan derleyici' });
    if (it) { SET.cppRunner = it.v; saveSettings(); syncRunControls(); notify('info', 'C++ derleyicisi: ' + it.label, { timeout: 2500 }); }
  }, '', { menuLabel: 'Select C++ Compiler...' });
  A('run.pyRunner', 'Python: Select Interpreter', async () => {
    const it = await quickPick([{ label: 'Python 3 (Pyodide) – local', desc: 'Çevrimdışı, interaktif input()', v: 'local' }, { label: 'Python 3 (CPython) – Wandbox', desc: 'Online', v: 'remote' }], { placeholder: 'Select Interpreter' });
    if (it) { SET.pyRunner = it.v; saveSettings(); syncRunControls(); }
  }, '', { menuLabel: 'Select Python Interpreter...' });
  A('run.prepareOffline', 'Offline: Download Everything for Offline Use', () => Offline.prepare(false), '', { menuLabel: 'Download for Offline Use' });
  A('term.new', 'Terminal: Create New Terminal', () => { Term.clear(); Term.banner(); Panel.show('terminal'); Term.focus(); }, '⌃ ⇧ `', { menuLabel: 'New Terminal' });
  A('term.clear', 'Terminal: Clear', () => Term.clear(), '⌘ K', { menuLabel: 'Clear Terminal' });
  A('term.python', 'Python: Start REPL', () => { Panel.show('terminal'); Term.exec('python3'); }, '', { menuLabel: 'Python REPL' });
  A('pref.theme', 'Preferences: Color Theme', () => { if (CTX.Themes && CTX.Themes.list.length) CTX.Themes.pick(); else notify('warning', 'Tema listesi yüklenemedi (ext/themes.json).'); }, '⌘ K ⌘ T', { menuLabel: 'Color Theme' });
  A('pref.settings', 'Preferences: Open Settings (UI)', () => CTX.Settings.open(), '⌘ ,', { menuLabel: 'Settings' });
  A('pref.settingsIpad', 'Preferences: iPad Settings', () => CTX.Settings.open('ipad'));
  A('pref.touchSize', 'Preferences: Touch Size (button size on iPad)', async () => {
    const cur = touchSize();
    const it = await quickPick([{ v: 0, label: 'Normal', desc: 'Mac\'teki VS Code boyutu' }, { v: 1, label: 'Büyük', desc: 'iPad için önerilen' }, { v: 2, label: 'Çok büyük', desc: 'parmakla rahat kullanım' }].map((o) => Object.assign(o, { kb: o.v === cur ? '✓' : '' })), { placeholder: 'Buton ve satır boyutu (editör yazı boyutu değişmez)' });
    if (it) { SET.touchSize = it.v; saveSettings(); applyTouchSize(); }
  });
  A('pref.themeEditor', 'Preferences: Customize Color Theme (Theme Editor)', () => CTX.Themes.openEditor(), '', { menuLabel: 'Customize Color Theme...' });
  A('pref.themeImport', 'Preferences: Import Color Theme from JSON...', () => CTX.Themes.importJson(), '', { menuLabel: 'Import Color Theme...' });
  A('view.scm', 'View: Show Source Control', () => showView('scm'), '⌃ ⇧ G', { menuLabel: 'Source Control' });
  A('git.commit', 'Git: Commit & Push', () => { showView('scm'); setTimeout(() => { const m = $('#scmMsg'); if (m) m.focus(); }, 50); });
  A('git.pull', 'Git: Pull', () => CTX.Git.action('pull'));
  A('git.clone', 'Git: Clone', () => CTX.Git.clone());
  A('git.publish', 'Git: Publish to GitHub', () => CTX.Git.publish());
  A('git.link', 'Git: Link Folder to Existing GitHub Repository', () => CTX.Git.linkExisting());
  A('git.signin', 'GitHub: Sign In', () => CTX.Git.signIn());
  A('git.signout', 'GitHub: Sign Out', () => CTX.Git.signOut());
  A('agent.open', 'Claude: Open Chat', () => showView('claude'), '⌃ ⌘ I', { menuLabel: 'Claude' });
  A('agent.new', 'Claude: New Chat', () => { showView('claude'); CTX.Agents.claude.newChat(); });
  A('agent.settings', 'Claude: Settings (API Key, Model)', () => { showView('claude'); CTX.Agents.claude.openSettings(); });
  A('agent.explain', 'Claude: Explain Selection / File', () => { showView('claude'); CTX.Agents.claude.quick('explain'); });
  A('agent.fix', 'Claude: Fix Errors in Active File', () => { showView('claude'); CTX.Agents.claude.quick('fix'); });
  A('claude.askApp', 'Claude: Ask in Claude App (copy file, selection & errors)', () => askClaudeApp(), '⌃ ⌘ K', { menuLabel: 'Claude\'a sor (uygulama)' });
  A('ag.open', 'Gemini · AG: Open Chat', () => showView('ag'), '⌃ ⌘ G', { menuLabel: 'Gemini · AG' });
  A('ag.new', 'Gemini · AG: New Chat', () => { showView('ag'); CTX.Agents.ag.newChat(); });
  A('ag.settings', 'Gemini · AG: Settings (API Key, Model)', () => { showView('ag'); CTX.Agents.ag.openSettings(); });
  A('ag.explain', 'Gemini · AG: Explain Selection / File', () => { showView('ag'); CTX.Agents.ag.quick('explain'); });
  A('ag.fix', 'Gemini · AG: Fix Errors in Active File', () => { showView('ag'); CTX.Agents.ag.quick('fix'); });
  A('vscode.import', 'VS Code: Import Settings, Snippets & Extensions (Profile)...', () => CTX.Sync.importCommand(), '', { menuLabel: 'Import from VS Code...' });
  A('vscode.export', 'VS Code: Export Settings to settings.json', () => CTX.Sync.exportCommand(), '', { menuLabel: 'Export to VS Code...' });
  A('view.customizeActivityBar', 'View: Customize Activity Bar (show / hide / reorder)', () => { const r = $('#activitybar').getBoundingClientRect(); CTX.AB.menu(r.right + 4, r.top + 40); }, '', { menuLabel: 'Customize Activity Bar...' });
  A('esp32.build', 'ESP32: Build & Upload Arduino Sketch', () => { showView('esp32'); CTX.Esp.action('build'); }, '', { menuLabel: 'ESP32: Build & Upload' });
  A('esp32.mpy', 'ESP32: Upload & Run MicroPython File', () => { showView('esp32'); CTX.Esp.action('mpy'); });
  A('esp32.cpy', 'USB: Write to Board & Run (CircuitPython code.py)', () => { showView('esp32'); CTX.Esp.action('cpy'); });
  A('esp32.cpyInstall', 'USB: Install CircuitPython on Board (UF2)...', () => { showView('esp32'); CTX.Esp.cpyInstall(); });
  A('esp32.uf2', 'USB: Flash .uf2 File to Board...', () => CTX.Esp.writeUf2File());
  A('esp32.usbGuide', 'USB: Cable Upload Guide (TinyUF2 / Pico / CircuitPython)', () => CTX.Esp.showGuide('usb'));
  A('esp32.monitor', 'ESP32: Open Serial Monitor', () => CTX.Esp.action('monitor'), '', { menuLabel: 'ESP32: Serial Monitor' });
  A('pdf.newNotebook', 'PDF: New Notebook (Apple Pencil)', () => CTX.Viewer && CTX.Viewer.newNotebook(), '', { menuLabel: 'Yeni Not Defteri (PDF)' });
  A('esp32.settings', 'ESP32: Board & Wi-Fi Settings', () => CTX.Esp.settings());
  A('esp32.bridge', 'ESP32: Prepare Bridge Firmware (first-time setup)', () => { showView('esp32'); CTX.Esp.prepareBridge(); });
  A('term.sqlite', 'SQL: Start sqlite3 Shell', () => { Panel.show('terminal'); Term.exec('sqlite3'); }, '', { menuLabel: 'SQLite Shell' });
  A('pref.fontSize', 'Preferences: Editor Font Size', async () => { const v = await inputBox({ value: String(SET.fontSize), prompt: 'Editor font size (px)' }); if (v && +v > 6) { SET.fontSize = +v; saveSettings(); Ed.options(); } });
  A('pref.tabSize', 'Preferences: Tab Size', async () => {
    const it = await quickPick([2, 4, 8].map((n) => ({ label: String(n), v: n })), { placeholder: t('Select Tab Size') });
    if (it) { SET.tabSize = it.v; saveSettings(); Tabs.list.forEach((t) => { if (!t.model.fallback) t.model.updateOptions({ tabSize: it.v }); }); Tabs.updateChrome(); }
  });
  A('pref.smartQuotes', 'Preferences: Toggle Smart Quote Fix', () => { SET.fixQuotes = !SET.fixQuotes; saveSettings(); notify('info', 'Akıllı tırnak düzeltme: ' + (SET.fixQuotes ? 'açık' : 'kapalı')); });
  A('pref.lineNumbers', 'Preferences: Toggle Line Numbers', () => { SET.lineNumbers = SET.lineNumbers === 'on' ? 'off' : 'on'; saveSettings(); Ed.options(); });
  A('md.preview', 'Markdown: Open Preview', () => MD.toggle(), '⇧ ⌘ V');
  A('md.reading', 'Markdown: Toggle Reading / Editing View (Obsidian)', () => MD.toggle(), '⌘ E', { menuLabel: 'Toggle Reading View' });
  A('md.readingDefault', 'Markdown: Open Notes in Reading View by Default', () => { SET.mdReading = SET.mdReading === false; saveSettings(); notify('info', 'Notlar ' + (SET.mdReading !== false ? 'okuma görünümünde' : 'düzenleme görünümünde') + ' açılacak.', { timeout: 2500 }); }, '', { checked: () => SET.mdReading !== false });
  A('dev.reload', 'Developer: Reload Window', () => location.reload(), '', { menuLabel: 'Reload Window' });
  A('dev.clearCache', 'Developer: Clear Download Cache', async () => { await native('cache.clear'); notify('info', 'Önbellek temizlendi. İnternet varken uygulamayı yeniden aç.'); });
  A('explorer.refresh', 'File: Refresh Explorer', () => Explorer.refresh());
  A('explorer.collapse', 'File: Collapse Folders in Explorer', () => { Explorer.expanded.clear(); Explorer.render(); });
  A('help.welcome', 'Help: Get Started', () => showWelcome(), '', { menuLabel: 'Get Started' });
  A('help.shortcuts', 'Help: Keyboard Shortcuts Reference', () => showShortcuts(), '', { menuLabel: 'Keyboard Shortcuts Reference' });
  A('pref.language', 'Configure Display Language', async () => {
    const it = await quickPick([{ label: 'Türkçe', desc: 'tr', v: 'tr' }, { label: 'English', desc: 'en', v: 'en' }], { placeholder: t('Display Language') });
    if (!it || it.v === SET.lang) return;
    SET.lang = it.v; SET.ext = Object.assign({}, SET.ext, { 'ms-ceintl.vscode-language-pack-tr': it.v === 'tr' }); saveSettings();
    location.reload();
  });
  A('pets.spawn', 'Pets: Spawn additional pet', () => PetsUI.spawn());
  A('pets.ball', 'Pets: Throw ball', () => X().Pets.throwBall());
  A('pets.clear', 'Pets: Remove all pets', () => X().Pets.removeAll());
  A('pets.bg', 'Pets: Change background', () => PetsUI.chooseBg());
  A('ext.show', 'Extensions: Show Installed Extensions', () => showView('extensions'));
  A('help.about', 'Help: About', () => dialog('VS iPad', `Monaco ${MONACO_VER} · Pyodide ${PYODIDE_VER} · SQLite (sql.js)\nC: yerel derleyici (çevrimdışı)\nC++/Java/C#/Rust: Wandbox & Compiler Explorer (online)\nPython, SQL: çevrimdışı\nGitHub: REST API · AI: Claude, Gemini · AG`), '', { menuLabel: 'About' });
}

function showShortcuts() {
  const items = Commands.list.filter((c) => c.kb).map((c) => ({ label: c.label, kb: c.kb, run: c.run }));
  QI.open({ placeholder: 'Keyboard Shortcuts', items, onAccept: (it) => it && it.run() });
}
function showWelcome() {
  Panel.show('terminal');
  Term.writeln('');
  Term.writeln('VS iPad – Hızlı başlangıç', 't-bold t-info');
  Term.writeln('  • Sol üstteki Explorer\'dan dosya oluştur (+ simgesi) ya da Örnekler klasörünü aç.');
  Term.writeln('  • Kodu çalıştır: sağ üstteki ▷ butonu, ⌘↵ veya F5.');
  Term.writeln('  • Python, C ve SQL çevrimdışı çalışır. C++, Java, C#, Rust için internet gerekir.');
  Term.writeln('  • Kaynak Denetimi simgesinden GitHub\'a gönder; ✨ Claude veya ★ Gemini · AG ile kodunu açıklat/düzelt.');
  Term.writeln('  • Girdi (stdin): program okuyorsa terminalde sorulur ya da Run panelinden önceden yazılır.');
  Term.writeln('  • Dosyalar: Dosyalar uygulaması › iPad\'imde › VS iPad. Başka klasör için File › Open Folder.');
  Term.writeln('  • Terminal komutları için: help');
  Term.writeln('');
}

// ---------------------------------------------------------------- problemler
const Problems = {
  list: [],
  set(list) {
    this.list = list;
    const err = list.filter((d) => d.sev === 'error').length, warn = list.filter((d) => d.sev === 'warning').length;
    $('#sbErr').textContent = err; $('#sbWarn').textContent = warn;
    const b = $('#problemsBadge'); b.textContent = list.length; b.classList.toggle('hidden', !list.length);
    Tabs.list.forEach((t) => Ed.setMarkers(t.model, this.byFile(t.path)));
    this.render();
  },
  byFile(p) { return this.list.filter((d) => d.file === p); },
  render() {
    const cont = $('#problemsList'); cont.innerHTML = '';
    if (!this.list.length) { cont.innerHTML = `<div class="empty-view"><p class="dim">${t('No problems have been detected in the workspace.')}</p></div>`; return; }
    const files = [...new Set(this.list.map((d) => d.file))];
    for (const f of files) {
      const ds = this.byFile(f);
      cont.appendChild(h('div', 'prob-file', `<i class="codicon codicon-chevron-down"></i><span class="ficon">${iconHTML(f)}</span><span>${esc(basename(f))}</span><span class="dim" style="margin-left:6px">${esc(dirname(f))}</span><span class="badge" style="margin-left:8px">${ds.length}</span>`));
      for (const d of ds) {
        const el = h('div', 'prob-item', `<i class="codicon codicon-${d.sev === 'error' ? 'error' : d.sev === 'warning' ? 'warning' : 'info'}"></i><span>${esc(d.msg)}${d.source ? ` <span class="dim">${esc(d.source)}</span>` : ''}<span class="loc">[Ln ${d.line}, Col ${d.col || 1}]</span></span>`);
        el.onclick = () => Tabs.open(d.file, { preview: false, line: d.line, col: d.col });
        cont.appendChild(el);
      }
    }
  }
};

// ---------------------------------------------------------------- terminal
const Term = {
  cwd: '', history: [], hIdx: -1, mode: 'shell', collectBuf: null, collectDone: null, lastBuilt: null,

  init() {
    this.out = $('#termOut'); this.input = $('#termInput'); this.promptEl = $('#termPrompt');
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('input', () => {
      if (SET.fixQuotes && /[\u201C\u201D\u2018\u2019\u2014]/.test(this.input.value)) {
        this.input.value = this.input.value.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/\u2014/g, '--');
      }
    });
    $('#terminal').addEventListener('click', (e) => { if (!window.getSelection().toString() && !e.target.closest('button')) this.focus(); });
    $('#termSendEOF').onclick = () => this.eof();
    $('#termCancel').onclick = () => this.ctrlC();
    this.banner();
    this.updatePrompt();
  },
  banner() {
    this.writeln('VS iPad Terminal — ' + (IS_NATIVE ? 'iPadOS' : 'browser preview'), 't-dim');
    this.writeln('Komutlar için "help" yaz. Kodu çalıştırmak için ▷ veya ⌘↵.', 't-dim');
    this.writeln('');
  },
  promptText() { return `user@iPad ${this.cwd ? basename(this.cwd) : '~'} % `; },
  updatePrompt() {
    const m = this.mode;
    if (m === 'shell') this.promptEl.innerHTML = `<span class="t-green t-bold">user@iPad</span> <span class="t-cyan">${esc(this.cwd ? basename(this.cwd) : '~')}</span> % `;
    else if (m === 'repl') this.promptEl.textContent = this.replMore ? '... ' : '>>> ';
    else if (m === 'sqlite') this.promptEl.textContent = SQL.buf ? '   ...> ' : 'sqlite> ';
    else this.promptEl.textContent = '';
    $('#termInputLine').classList.toggle('hidden', m === 'busy');
    const stdinMode = m === 'pystdin' || m === 'collect';
    $('#termStdinBar').classList.toggle('hidden', !stdinMode);
    if (m === 'collect') $('#termStdinHint').textContent = 'Programın girdilerini yaz, her satırdan sonra Enter. Bitince:';
    else if (m === 'pystdin') $('#termStdinHint').textContent = 'Program girdi bekliyor.';
    this.scroll();
  },
  setMode(m) { this.mode = m; this.updatePrompt(); if (m !== 'busy') this.focus(true); },
  focus(soft) {
    if (soft && IS_TOUCH) return; // iPad'de klavyeyi zorla açma
    if (this.mode !== 'busy') this.input.focus({ preventScroll: true });
  },
  scroll() { const pv = $('#pview-terminal'); pv.scrollTop = pv.scrollHeight; },
  clear() { this.out.innerHTML = ''; },
  write(text, cls) {
    if (!text) return;
    text = String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r\n/g, '\n');
    if (this.capture != null && this.capture.length < 200000) this.capture += text;
    const last = this.out.lastChild;
    if (last && last.nodeType === 1 && (last.className || '') === (cls || '') && last.textContent.length < 20000) last.textContent += text;
    else { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; this.out.appendChild(s); }
    while (this.out.childNodes.length > 4000) this.out.removeChild(this.out.firstChild);
    this.scroll();
  },
  writeln(text, cls) { this.write((text || '') + '\n', cls); },
  writeLinked(text) {
    // derleyici çıktısını satır satır renklendir, file:line kısımlarını tıklanabilir yap
    for (const line of String(text).split('\n')) {
      let cls = '';
      if (/\berror\b|error:|Error:|Exception|Traceback/.test(line)) cls = 't-err';
      else if (/\bwarning\b|warning:/.test(line)) cls = 't-warn';
      else if (/\bnote:/.test(line)) cls = 't-info';
      this.write(line + '\n', cls);
    }
  },
  ensureNewline() { const t = this.out.textContent; if (t && !t.endsWith('\n')) this.write('\n'); },

  onKey(e) {
    const v = this.input.value;
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); this.ctrlC(); return; }
    if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); this.eof(); return; }
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); this.clear(); return; }
    if (e.key === 'Enter') { e.preventDefault(); this.input.value = ''; this.submit(v); return; }
    if (e.key === 'ArrowUp' && (this.mode === 'shell' || this.mode === 'repl' || this.mode === 'sqlite')) {
      e.preventDefault(); if (!this.history.length) return;
      this.hIdx = this.hIdx < 0 ? this.history.length - 1 : Math.max(0, this.hIdx - 1); this.input.value = this.history[this.hIdx]; return;
    }
    if (e.key === 'ArrowDown' && (this.mode === 'shell' || this.mode === 'repl' || this.mode === 'sqlite')) {
      e.preventDefault(); if (this.hIdx < 0) return;
      this.hIdx++; if (this.hIdx >= this.history.length) { this.hIdx = -1; this.input.value = ''; } else this.input.value = this.history[this.hIdx]; return;
    }
    if (e.key === 'Tab' && this.mode === 'shell') { e.preventDefault(); this.complete(); return; }
    if (e.key === 'Tab' && this.mode === 'repl') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
  },
  complete() {
    const v = this.input.value; const m = v.match(/(\S*)$/); const tok = m ? m[1] : '';
    const base = tok.includes('/') ? normPath(this.cwd, tok.slice(0, tok.lastIndexOf('/') + 1) || '.') : this.cwd;
    const prefix = tok.includes('/') ? tok.slice(tok.lastIndexOf('/') + 1) : tok;
    const node = Explorer.map[base]; if (!node) return;
    const cands = node.children.filter((c) => c.name.startsWith(prefix));
    if (cands.length === 1) {
      const c = cands[0]; this.input.value = v.slice(0, v.length - prefix.length) + c.name + (c.dir ? '/' : ' ');
    } else if (cands.length > 1) {
      let common = cands[0].name;
      for (const c of cands) { while (!c.name.startsWith(common)) common = common.slice(0, -1); }
      if (common.length > prefix.length) this.input.value = v.slice(0, v.length - prefix.length) + common;
      else { this.write(this.promptText() + v + '\n', 't-dim'); this.writeln(cands.map((c) => c.name + (c.dir ? '/' : '')).join('  ')); }
    }
  },
  ctrlC() {
    if (this.mode === 'shell') { this.write(this.promptText() + this.input.value + '^C\n', 't-dim'); this.input.value = ''; return; }
    if (this.mode === 'repl') { this.writeln('KeyboardInterrupt', 't-err'); this.replMore = false; this.updatePrompt(); return; }
    if (this.mode === 'sqlite') { SQL.buf = ''; this.writeln('^C', 't-dim'); this.updatePrompt(); return; }
    if (this.mode === 'collect') { this.writeln('^C', 't-dim'); const d = this.collectDone; this.collectDone = null; this.setMode('shell'); d && d(null); return; }
    Run.stop();
  },
  eof() {
    if (this.mode === 'collect') {
      const rest = this.input.value; this.input.value = '';
      if (rest) { this.write(rest + '\n', 't-stdin'); this.collectBuf.push(rest); }
      const d = this.collectDone; this.collectDone = null; this.setMode('busy');
      d && d(this.collectBuf.join('\n') + (this.collectBuf.length ? '\n' : ''));
    } else if (this.mode === 'pystdin') {
      this.writeln('^D', 't-dim'); this.setMode('busy'); native('stdin.provide', { eof: true });
    }
  },
  collect() {
    return new Promise((resolve) => {
      this.collectBuf = []; this.collectDone = resolve; this.setMode('collect');
      if (IS_TOUCH) this.input.focus();
    });
  },
  submit(line) {
    switch (this.mode) {
      case 'shell':
        this.write(this.promptText(), 't-dim'); this.writeln(line, 't-cmd');
        if (line.trim()) { this.history.push(line); if (this.history.length > 200) this.history.shift(); this.hIdx = -1; }
        this.exec(line);
        break;
      case 'collect': this.write(line + '\n', 't-stdin'); this.collectBuf.push(line); break;
      case 'pystdin': this.write(line + '\n', 't-stdin'); this.setMode('busy'); native('stdin.provide', { text: line }); break;
      case 'sqlite': {
        this.write(SQL.buf ? '   ...> ' : 'sqlite> ', 't-dim'); this.writeln(line, 't-cmd');
        if (line.trim()) { this.history.push(line); this.hIdx = -1; }
        SQL.replLine(line);
        break;
      }
      case 'repl': {
        this.write(this.replMore ? '... ' : '>>> ', 't-dim'); this.writeln(line, 't-cmd');
        if (line.trim()) { this.history.push(line); this.hIdx = -1; }
        if (!this.replMore && /^\s*(exit|quit)(\(\))?\s*$/.test(line)) { this.setMode('shell'); return; }
        this.setMode('busy');
        Py.replLine(line);
        break;
      }
    }
  },
  async exec(line) {
    line = line.trim();
    if (!line) return;
    // "gcc a.c && ./a.out" gibi zincirleri tek çalıştırmaya indir
    const parts = line.split(/\s*&&\s*/);
    for (const p of parts) {
      const ok = await this.execOne(p, parts.length > 1);
      if (ok === false) break;
      if (ok === 'ran') break;
    }
  },
  async execOne(line, chained) {
    const args = (line.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((a) => a.replace(/^["']|["']$/g, ''));
    const cmd = args.shift();
    const F = (p) => normPath(this.cwd, p);
    const need = (p) => { if (!p) { this.writeln(cmd + ': eksik argüman', 't-err'); return false; } return true; };
    try {
      switch (cmd) {
        case 'help': this.help(); return true;
        case 'clear': case 'cls': this.clear(); return true;
        case 'pwd': this.writeln('~/' + this.cwd); return true;
        case 'whoami': this.writeln('user'); return true;
        case 'date': this.writeln(new Date().toString()); return true;
        case 'uname': this.writeln(args.includes('-a') ? 'iPadOS VS-iPad WebKit arm64' : 'iPadOS'); return true;
        case 'echo': {
          const gt = args.indexOf('>'), app = args.indexOf('>>');
          if (gt >= 0 || app >= 0) {
            const i = app >= 0 ? app : gt; const text = args.slice(0, i).join(' ') + '\n'; const f = F(args[i + 1]);
            let content = text;
            if (app >= 0) { try { content = (await native('fs.read', { path: f })).content + text; } catch (e) {} }
            await native('fs.write', { path: f, content }); await Explorer.refresh(); Tabs.reloadFromDisk(f);
          } else this.writeln(args.join(' '));
          return true;
        }
        case 'ls': case 'll': case 'dir': {
          const target = F(args.filter((a) => !a.startsWith('-'))[0] || '.');
          const node = Explorer.map[target];
          if (!node) { this.writeln(`ls: ${target}: No such file or directory`, 't-err'); return false; }
          if (!node.dir) { this.writeln(node.name); return true; }
          const long = cmd === 'll' || args.some((a) => a.startsWith('-') && a.includes('l'));
          if (long) node.children.forEach((c) => this.writeln(`${c.dir ? 'drwxr-xr-x' : '-rw-r--r--'}  ${String(c.dir ? '-' : fmtBytes(c.size || 0)).padStart(9)}  ${c.name}${c.dir ? '/' : ''}`, c.dir ? 't-blue' : ''));
          else { node.children.forEach((c) => this.write(c.name + (c.dir ? '/' : '') + '   ', c.dir ? 't-blue t-bold' : '')); if (node.children.length) this.write('\n'); }
          return true;
        }
        case 'cd': {
          const t = args[0] ? F(args[0]) : '';
          if (t && !Explorer.isDir(t)) { this.writeln(`cd: no such file or directory: ${args[0]}`, 't-err'); return false; }
          this.cwd = t; this.updatePrompt(); saveSession(); return true;
        }
        case 'cat': case 'head': case 'tail': {
          if (!need(args[0])) return false;
          const f = args.filter((a) => !a.startsWith('-')).map(F);
          for (const p of f) {
            const r = await native('fs.read', { path: p }); let c = r.content;
            if (cmd !== 'cat') { const ls = c.split('\n'); c = (cmd === 'head' ? ls.slice(0, 10) : ls.slice(-10)).join('\n'); }
            this.write(c); this.ensureNewline();
          }
          return true;
        }
        case 'touch': if (!need(args[0])) return false; for (const a of args) { const p = F(a); if (!Explorer.exists(p)) await native('fs.write', { path: p, content: '' }); } await Explorer.refresh(); return true;
        case 'mkdir': if (!need(args[0])) return false; for (const a of args.filter((x) => x !== '-p')) await native('fs.mkdir', { path: F(a) }); await Explorer.refresh(); return true;
        case 'rm': case 'rmdir': {
          const targets = args.filter((a) => !a.startsWith('-')); if (!need(targets[0])) return false;
          for (const a of targets) {
            const p = F(a);
            if (!Explorer.exists(p)) { this.writeln(`rm: ${a}: No such file or directory`, 't-err'); continue; }
            if (Explorer.isDir(p) && cmd === 'rm' && !args.some((x) => /^-.*r/.test(x))) { this.writeln(`rm: ${a}: is a directory (rm -r kullan)`, 't-err'); continue; }
            await native('fs.delete', { path: p });
            Tabs.list.filter((t) => t.path === p || t.path.startsWith(p + '/')).forEach((t) => Tabs.close(t, true, true));
          }
          await Explorer.refresh(); return true;
        }
        case 'mv': case 'cp': {
          if (args.length < 2) { this.writeln(`usage: ${cmd} kaynak hedef`, 't-err'); return false; }
          const src = F(args[0]); let dst = F(args[1]);
          if (Explorer.isDir(dst)) dst = join(dst, basename(src));
          if (cmd === 'mv') { await native('fs.rename', { from: src, to: dst }); Tabs.list.forEach((t) => { if (t.path === src) t.path = dst; }); Tabs.render(); }
          else { const r = await native('fs.read', { path: src }); await native('fs.write', { path: dst, content: r.content }); }
          await Explorer.refresh(); return true;
        }
        case 'open': case 'code': case 'nano': case 'vim': case 'vi':
          if (!need(args[0])) return false;
          { const p = F(args[0]); if (!Explorer.exists(p)) await native('fs.write', { path: p, content: '' }); await Explorer.refresh(); await Tabs.open(p, { preview: false }); }
          return true;
        case 'run': {
          const p = args[0] ? F(args[0]) : Tabs.active && Tabs.active.path;
          if (!p) { this.writeln('run: dosya belirt', 't-err'); return false; }
          await Run.runFile(p, { args: args.slice(1) }); return 'ran';
        }
        case 'python': case 'python3': case 'py': {
          if (!args.length || args[0] === '-i') { await Py.startRepl(); return true; }
          if (args[0] === '--version' || args[0] === '-V') { this.writeln('Python 3.12 (Pyodide ' + PYODIDE_VER + ')'); return true; }
          if (args[0] === '-c') { await Run.runPythonCode(args.slice(1).join(' '), '<string>', this.cwd); return 'ran'; }
          const p = F(args[0]); if (!Explorer.exists(p)) { this.writeln(`python3: can't open file '${args[0]}': [Errno 2] No such file or directory`, 't-err'); return false; }
          await Run.runFile(p, { args: args.slice(1) }); return 'ran';
        }
        case 'sqlite3': case 'sqlite': {
          await SQL.startRepl(args[0] ? F(args[0]) : null); return true;
        }
        case 'rustc': case 'cargo': {
          const f = args.find((a) => /\.rs$/.test(a)) || (cmd === 'cargo' && Explorer.exists(F('src/main.rs')) ? 'src/main.rs' : null);
          if (!f) { this.writeln(`${cmd}: dosya belirt (örn: rustc main.rs)`, 't-err'); return false; }
          if (chained) { this.lastBuilt = { file: F(f), out: stem(f), flags: [] }; return true; }
          await Run.runFile(F(f), {}); return 'ran';
        }
        case 'pip': case 'pip3':
          this.writeln('Pyodide paketleri import edildiğinde otomatik yüklenir (numpy, pandas, matplotlib…). İlk seferde internet gerekir.', 't-info'); return true;
        case 'gcc': case 'cc': case 'clang': case 'g++': case 'c++': case 'clang++': case 'javac': case 'mcs': case 'csc': {
          const files = args.filter((a) => /\.(c|cc|cpp|cxx|java|cs)$/i.test(a)).map(F);
          if (!files.length) { this.writeln(`${cmd}: error: no input files`, 't-err'); return false; }
          const oi = args.indexOf('-o');
          const flags = args.filter((a, i) => a.startsWith('-') && a !== '-o' && args[i - 1] !== '-o');
          this.lastBuilt = { file: files[0], out: oi >= 0 ? args[oi + 1] : (cmd === 'javac' ? stem(files[0]) : 'a.out'), flags };
          if (chained) return true; // ardından gelen ./a.out çalıştıracak
          this.writeln('(not: online derleyicide derleme ve çalıştırma birlikte yapılır)', 't-dim');
          await Run.runFile(files[0], { flags }); return 'ran';
        }
        case 'java': {
          const a0 = args.filter((a) => !a.startsWith('-'))[0];
          if (!a0) { this.writeln('Usage: java <SinifAdi> | java Dosya.java', 't-err'); return false; }
          let p = F(a0.endsWith('.java') ? a0 : a0 + '.java');
          if (!Explorer.exists(p) && this.lastBuilt && this.lastBuilt.file.endsWith('.java')) p = this.lastBuilt.file;
          if (!Explorer.exists(p)) { this.writeln(`Error: Could not find or load main class ${a0}`, 't-err'); return false; }
          await Run.runFile(p, { args: args.slice(args.indexOf(a0) + 1) }); return 'ran';
        }
        case 'dotnet': {
          const cs = args.find((a) => a.endsWith('.cs')) || (Tabs.active && Tabs.active.path.endsWith('.cs') ? '/' + Tabs.active.path : null);
          if (!cs) { this.writeln('dotnet run Dosya.cs  şeklinde kullan', 't-err'); return false; }
          await Run.runFile(cs.startsWith('/') ? cs.slice(1) : F(cs)); return 'ran';
        }
        case 'node': case 'deno': case 'bun':
          if (!need(args[0])) return false;
          if (!Explorer.exists(F(args[0]))) { this.writeln(`Error: Cannot find module '${args[0]}'`, 't-err'); return false; }
          await Run.runFile(F(args[0])); return 'ran';
        case 'history': this.history.forEach((h2, i) => this.writeln(String(i + 1).padStart(5) + '  ' + h2)); return true;
        case 'exit': this.clear(); Panel.setVisible(false); return true;
        case 'make': this.writeln('make desteklenmiyor; ana .c/.cpp dosyasını aç ve ▷ ile çalıştır (aynı klasördeki .c/.h dosyaları otomatik eklenir).', 't-warn'); return false;
        default:
          if (cmd.startsWith('./')) {
            const name = cmd.slice(2);
            const lb = this.lastBuilt;
            if (lb && (lb.out === name || basename(lb.out || '') === name)) { await Run.runFile(lb.file, { flags: lb.flags, args }); return 'ran'; }
            const p = F(name);
            if (Explorer.exists(p) && langOf(p).run) { await Run.runFile(p, { args }); return 'ran'; }
            this.writeln(`zsh: no such file or directory: ${cmd}`, 't-err'); return false;
          }
          this.writeln(`zsh: command not found: ${cmd}`, 't-err');
          return false;
      }
    } catch (e) {
      this.writeln(`${cmd}: ${e.message || e}`, 't-err'); return false;
    }
  },
  help() {
    const rows = [
      ['ls, cd, pwd, cat, head, tail', 'dosya gezinme'], ['touch, mkdir, rm [-r], mv, cp', 'dosya işlemleri'], ['echo metin > dosya', 'dosyaya yaz'],
      ['code / open <dosya>', 'editörde aç'], ['run [dosya] [arg…]', 'dosyayı derle + çalıştır (varsayılan: aktif)'],
      ['python3 [dosya.py]', 'Python çalıştır; argümansız REPL açar'], ['sqlite3 [dosya.db]', 'SQLite kabuğu (.read x.sql, .tables, .schema)'], ['rustc main.rs', 'Rust derle + çalıştır (online)'], ['gcc a.c && ./a.out', 'C derle + çalıştır (g++, clang da olur)'],
      ['javac Main.java && java Main', 'Java'], ['dotnet run Program.cs', 'C#'], ['node app.js', 'JavaScript (yerel)'],
      ['clear, history, exit', ''], ['⌃C / ⌃D / ⌃L / Tab / ↑↓', 'durdur / girdi sonu / temizle / tamamla / geçmiş']
    ];
    rows.forEach(([a, b]) => { this.write('  ' + a.padEnd(32), 't-yellow'); this.writeln(b, 't-dim'); });
  }
};

// ---------------------------------------------------------------- Python (Pyodide worker)
const Py = {
  worker: null, ready: null, version: '', pending: null, replActive: false,
  forceMain: false, mainMode: false,
  start() {
    if (this.ready) return this.ready;
    const indexURL = new URL(PYODIDE_URL, location.href).href;
    const viaWorker = () => new Promise((resolve, reject) => {
      let w;
      try { w = new Worker('py-worker.js'); } catch (e) { reject(e); return; }
      this.worker = w; this.mainMode = false;
      const t = setTimeout(() => reject(new Error('Pyodide yüklenemedi (zaman aşımı). İnternet bağlantısını kontrol et.')), 120000);
      this._resolve = (v) => { clearTimeout(t); resolve(v); };
      this._reject = (e) => { clearTimeout(t); try { w.terminate(); } catch (x) {} reject(e); };
      w.onmessage = (ev) => this.onMsg(ev.data);
      w.onerror = (e) => { e.preventDefault && e.preventDefault(); this._reject(new Error(e.message || 'worker error')); };
      w.postMessage({ type: 'init', indexURL });
    });
    // Worker çalışmazsa: ana iş parçacığında Pyodide (input() native diyalogla sorulur)
    const viaMain = async () => {
      if (!window.__pyHost) await loadScript('py-worker.js');
      this.mainMode = true;
      window.__pyHost.setPost((m) => this.onMsg(m));
      this.worker = { postMessage: (m) => setTimeout(() => window.__pyHost.handle(m), 0), terminate: () => {} };
      return new Promise((resolve, reject) => {
        this._resolve = resolve; this._reject = reject;
        this.worker.postMessage({ type: 'init', indexURL });
      });
    };
    this.ready = (this.forceMain ? viaMain() : viaWorker().catch((e) => {
      console.warn('worker failed, main thread fallback', e);
      Term.writeln('(Python arka planda başlatılamadı, ana iş parçacığında çalışacak: ' + (e.message || e) + ')', 't-dim');
      return viaMain();
    }));
    this.ready.catch(() => { this.kill(); });
    return this.ready;
  },
  kill() {
    if (this.mainMode) { this.replActive = false; return; } // ana thread'de çalışan Pyodide öldürülemez, yeniden kullanılır
    if (this.worker) this.worker.terminate(); this.worker = null; this.ready = null; this.replActive = false;
  },
  onMsg(m) {
    switch (m.type) {
      case 'ready': this.version = m.version; this._resolve(); Offline.update(); break;
      case 'progress': Term.writeln(m.msg, 't-dim'); break;
      case 'stdout': Term.write(m.text); Output.append(m.text); break;
      case 'stderr': Term.write(m.text, 't-err'); Output.append(m.text); break;
      case 'info': Term.write(m.text, 't-dim'); break;
      case 'stdin-request': if (Run.feedStdin()) break; Term.setMode('pystdin'); if (IS_TOUCH) Term.input.focus(); break;
      case 'stdin-done': if (Term.mode === 'pystdin') Term.setMode('busy'); break;
      case 'stdin-broken':
        this.forceMain = true;
        notify('warning', 'Bu cihazda arka plan input() desteklenmedi; Python bir sonraki çalıştırmada ana iş parçacığına geçecek (input pencereyle sorulur). Tekrar çalıştır.', { timeout: 12000 });
        break;
      case 'done': { const p = this.pending; this.pending = null; p && p.resolve(m); break; }
      case 'repl-more': Term.replMore = m.more; this.replActive = true; Term.setMode('repl'); break;
      case 'error':
        if (this.pending) { const p = this.pending; this.pending = null; p.reject(new Error(m.message)); }
        else if (Term.mode === 'busy' && this.replActive) { Term.writeln(m.message, 't-err'); this.replActive = false; Term.setMode('shell'); }
        else this._reject && this._reject(new Error(m.message));
        break;
    }
  },
  async run(path, code, files, cwd, argv) {
    await this.start();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker.postMessage({ type: 'run', id: Date.now(), path, code, files, cwd, argv });
    });
  },
  async startRepl() {
    Term.setMode('busy');
    try { await this.start(); } catch (e) { Term.writeln(String(e.message || e), 't-err'); Term.setMode('shell'); return; }
    this.worker.postMessage({ type: 'repl-start' });
  },
  replLine(line) { if (!this.worker) { Term.setMode('shell'); return; } this.worker.postMessage({ type: 'repl-line', line }); }
};

const Output = {
  append(t) { const o = $('#outputLog'); o.textContent += t; if (o.textContent.length > 200000) o.textContent = o.textContent.slice(-150000); },
  clear() { $('#outputLog').textContent = ''; }
};

// ---------------------------------------------------------------- çalıştırıcılar
const READS_INPUT = {
  c: /\b(scanf|getchar|fgets|gets|getline|getc)\s*\(|\bstdin\b/,
  cpp: /\bcin\b|\b(scanf|getchar|getline|fgets)\s*\(/,
  java: /\bScanner\b|\bBufferedReader\b|System\.in\b|\bConsole\b/,
  cs: /Console\.(ReadLine|Read|ReadKey)\s*\(|Console\.In\b/,
  py: /\binput\s*\(|sys\.stdin/,
  rs: /\bstdin\s*\(|read_line|BufRead|io::read_to_string/
};
const WANDBOX_LANG = { c: 'C', cpp: 'C++', java: 'Java', cs: 'C#', py: 'Python', rs: 'Rust' };
const GODBOLT_LANG = { c: 'c', cpp: 'c++', java: 'java', cs: 'csharp', py: 'python', rs: 'rust' };

function verCmp(a, b) {
  const pa = (a.match(/\d+/g) || []).map(Number), pb = (b.match(/\d+/g) || []).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

async function httpJSON(url, opts = {}) {
  const r = await native('http.request', { url, method: opts.method || 'GET', headers: Object.assign({ Accept: 'application/json' }, opts.headers || {}), body: opts.body, timeout: opts.timeout || 60 });
  if (r.status < 200 || r.status >= 300) { const e = new Error(`HTTP ${r.status}: ${(r.body || '').slice(0, 300)}`); e.http = r.status; throw e; }
  try { return JSON.parse(r.body); } catch (e) { throw new Error('Geçersiz yanıt: ' + (r.body || '').slice(0, 200)); }
}

const Wandbox = {
  list: null,
  async compilers() {
    if (this.list) return this.list;
    try {
      const c = await native('kv.get', { key: 'wandboxList' });
      if (c) { const o = JSON.parse(c); if (Date.now() - o.t < 3 * 864e5) { this.list = o.list; return this.list; } }
    } catch (e) {}
    const raw = await httpJSON('https://wandbox.org/api/list.json', { timeout: 30 });
    this.list = raw.map((x) => ({ name: x.name, language: x.language, version: x.version, display: x['display-name'], raw: !!x['compiler-option-raw'], rraw: !!x['runtime-option-raw'], cmd: x['display-compile-command'] }));
    native('kv.set', { key: 'wandboxList', value: JSON.stringify({ t: Date.now(), list: this.list }) });
    return this.list;
  },
  pick(list, kind) {
    const lang = WANDBOX_LANG[kind];
    const c = list.filter((x) => x.language === lang && !/head|dev|nightly/i.test(x.name));
    const prefs = { c: [/^gcc-\d/, /^clang-\d/], cpp: [/^gcc-\d/, /^clang-\d/], java: [/openjdk/i], cs: [/^dotnetcore/i, /^mono/i, /csharp/i], py: [/^cpython-3/], rs: [/^rust-\d/, /rust/i] }[kind];
    for (const re of prefs) {
      const m = c.filter((x) => re.test(x.name)).sort((a, b) => verCmp(b.version || b.name, a.version || a.name));
      if (m.length) return m[0];
    }
    return c[0] || list.find((x) => x.language === lang) || null;
  },
  async run(job) {
    const list = await this.compilers();
    const comp = this.pick(list, job.kind);
    if (!comp) throw new Error(`Wandbox'ta ${WANDBOX_LANG[job.kind]} derleyicisi bulunamadı`);
    const raw = [];
    if (job.kind === 'c' || job.kind === 'cpp') {
      raw.push(...job.flags);
      job.extras.filter((e) => e.source).forEach((e) => raw.push(e.file));
      if (job.kind === 'c') raw.push('-lm');
    }
    if (job.kind === 'rs' && !/edition/.test(comp.cmd || '')) raw.push('--edition=2021');
    const body = {
      compiler: comp.name, code: job.code, codes: job.extras.map((e) => ({ file: e.file, code: e.code })),
      stdin: job.stdin || '', options: '', save: false,
      'compiler-option-raw': comp.raw ? raw.join('\n') : '', 'runtime-option-raw': comp.rraw ? (job.args || []).join('\n') : ''
    };
    const j = await httpJSON('https://wandbox.org/api/compile.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 120 });
    const mainName = { c: 'prog.c', cpp: 'prog.cc', java: 'prog.java', cs: 'prog.cs', py: 'prog.py', rs: 'prog.rs' }[job.kind];
    return {
      service: 'Wandbox', compiler: `${comp.display || comp.name} ${comp.version || ''}`.trim(), mainName,
      compileOut: [j.compiler_output, j.compiler_error].filter(Boolean).join(''),
      stdout: j.program_output || '', stderr: j.program_error || '',
      exit: j.status != null ? parseInt(j.status, 10) : null, signal: j.signal || '',
      compileFailed: !!j.compiler_error && !j.program_output && !j.program_error && j.status && j.status !== '0' && /error/i.test(j.compiler_error)
    };
  }
};

const Godbolt = {
  cache: {},
  async compiler(kind) {
    if (this.cache[kind]) return this.cache[kind];
    const lang = GODBOLT_LANG[kind];
    const list = await httpJSON(`https://godbolt.org/api/compilers/${encodeURIComponent(lang)}?fields=id,name,lang,semver,supportsExecute`, { timeout: 30 });
    const re = { c: /x86-64 gcc \d/i, cpp: /x86-64 gcc \d/i, java: /jdk/i, cs: /\.net|csharp/i, py: /python 3/i, rs: /^rustc 1\./i }[kind];
    let cands = list.filter((c) => c.supportsExecute !== false && re.test(c.name) && !/trunk|snapshot|nightly|assertions/i.test(c.name));
    if (!cands.length) cands = list.filter((c) => c.supportsExecute);
    cands.sort((a, b) => verCmp(b.semver || b.name, a.semver || a.name));
    if (!cands.length) throw new Error('Compiler Explorer: uygun derleyici yok');
    this.cache[kind] = cands[0];
    return cands[0];
  },
  async run(job) {
    const comp = await this.compiler(job.kind);
    const body = {
      source: job.code, lang: GODBOLT_LANG[job.kind], allowStoreCodeDebug: true,
      options: {
        userArguments: (job.kind === 'c' || job.kind === 'cpp') ? job.flags.join(' ') : job.kind === 'rs' ? '--edition 2021 -C debuginfo=1' : '',
        executeParameters: { args: job.args || [], stdin: job.stdin || '' },
        compilerOptions: { executorRequest: true, skipAsm: true },
        filters: { execute: true }, tools: [], libraries: []
      }
    };
    const j = await httpJSON(`https://godbolt.org/api/compiler/${encodeURIComponent(comp.id)}/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 120 });
    const txt = (a) => (a || []).map((x) => x.text).join('\n') + ((a && a.length) ? '\n' : '');
    const br = j.buildResult || {};
    return {
      service: 'Compiler Explorer', compiler: comp.name, mainName: '<source>',
      compileOut: txt(br.stdout) + txt(br.stderr), stdout: txt(j.stdout), stderr: txt(j.stderr),
      exit: j.didExecute ? j.code : (br.code != null ? br.code : j.code), signal: '',
      compileFailed: j.didExecute === false
    };
  }
};

function parseDiagnostics(text, job, res) {
  const out = [];
  const nameMap = {};
  [res.mainName, 'prog.c', 'prog.cc', 'prog.cpp', 'prog.java', 'prog.cs', 'prog.py', '<source>', 'example.cpp', 'example.c', 'example.java', 'example.cs', 'example.py', basename(job.path)].forEach((n) => { nameMap[n] = job.path; });
  job.extras.forEach((e) => { nameMap[e.file] = e.path; });
  const mapFile = (f) => { f = f.replace(/^\.\//, ''); return nameMap[f] || nameMap[basename(f)] || null; };
  nameMap['prog.rs'] = job.path; nameMap['main.rs'] = job.path;
  let pendingRust = null;
  for (const line of text.split('\n')) {
    let m;
    if ((m = line.match(/^(error|warning)(?:\[(E\d+)\])?:\s+(.*)$/))) { pendingRust = { sev: m[1], code: m[2], msg: m[3] }; continue; }
    if (pendingRust && (m = line.match(/^\s*-->\s+(.+?):(\d+):(\d+)/))) {
      const f = mapFile(m[1]);
      if (f && !/aborting due to|generated \d+ warning/.test(pendingRust.msg)) out.push({ file: f, line: +m[2], col: +m[3], sev: pendingRust.sev, msg: pendingRust.msg + (pendingRust.code ? ` [${pendingRust.code}]` : ''), source: 'rustc' });
      pendingRust = null; continue;
    }
    if ((m = line.match(/^(.+?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.*)$/))) {
      const f = mapFile(m[1]); if (f && m[4] !== 'note') out.push({ file: f, line: +m[2], col: +m[3], sev: m[4].includes('error') ? 'error' : 'warning', msg: m[5], source: job.kind === 'cpp' ? 'g++' : 'gcc' });
    } else if ((m = line.match(/^(.+?\.java):(\d+):\s+(error|warning):\s+(.*)$/))) {
      const f = mapFile(m[1]); if (f) out.push({ file: f, line: +m[2], col: 1, sev: m[3], msg: m[4], source: 'javac' });
    } else if ((m = line.match(/^(.+?\.cs)\((\d+),(\d+)\):\s+(error|warning)\s+(\w+):\s+(.*?)(\s+\[.*\])?$/))) {
      const f = mapFile(m[1]); if (f) out.push({ file: f, line: +m[2], col: +m[3], sev: m[4], msg: m[6], source: m[5] });
    }
  }
  return out;
}
function parsePyTraceback(text, mapPath) {
  const lines = text.trim().split('\n');
  let last = null;
  for (const l of lines) { const m = l.match(/File "([^"]+)", line (\d+)/); if (m) { const f = mapPath(m[1]); if (f) last = { file: f, line: +m[2] }; } }
  if (!last) return [];
  const msg = lines[lines.length - 1];
  return [{ file: last.file, line: last.line, col: 1, sev: 'error', msg, source: 'Python' }];
}

// ---------------------------------------------------------------- SQL (SQLite – sql.js, çevrimdışı)
const SQL = {
  lib: null, db: null, dbPath: null, buf: '',
  async load() {
    if (this.lib) return this.lib;
    if (!window.initSqlJs) await loadScript(SQLJS_BASE + 'sql-wasm.js');
    this.lib = await window.initSqlJs({ locateFile: (f) => SQLJS_BASE + f });
    return this.lib;
  },
  async openDb(path) {
    const L = await this.load();
    if (path && Explorer.exists(path)) {
      const r = await native('fs.readB64', { path });
      const bin = atob(r.b64 || ''); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new L.Database(u);
    }
    return new L.Database();
  },
  async saveDb(db, path) {
    const u = db.export(); let s = '';
    for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
    await native('fs.writeB64', { path, b64: btoa(s) });
  },
  // sonuç tablosu (sqlite3 -box benzeri)
  table(cols, rows) {
    const cell = (v) => { if (v == null) return 'NULL'; if (v instanceof Uint8Array) return `<BLOB ${v.length} B>`; let s = String(v); if (s.length > 60) s = s.slice(0, 57) + '…'; return s.replace(/\n/g, '⏎'); };
    const data = rows.slice(0, 1000).map((r) => r.map(cell));
    const w = cols.map((c, i) => Math.max(c.length, ...data.map((r) => r[i].length)));
    const num = cols.map((_, i) => rows.length && rows.every((r) => r[i] == null || typeof r[i] === 'number'));
    const pad = (s, i) => (num[i] ? s.padStart(w[i]) : s.padEnd(w[i]));
    const line = (l, m, r) => l + w.map((n) => '─'.repeat(n + 2)).join(m) + r;
    const out = [line('┌', '┬', '┐'), '│ ' + cols.map((c, i) => c.padEnd(w[i])).join(' │ ') + ' │', line('├', '┼', '┤')];
    for (const r of data) out.push('│ ' + r.map(pad).join(' │ ') + ' │');
    out.push(line('└', '┴', '┘'));
    if (rows.length > 1000) out.push(`… (${rows.length - 1000} satır daha)`);
    return out.join('\n');
  },
  skipWs(sql) { const m = sql.match(/^(\s|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)*/); return m ? m[0].length : 0; },
  // SQL metnini çalıştır; her sonuç kümesini terminale yaz
  exec(db, sql, opts = {}) {
    let stmtCount = 0, changes = 0, sets = 0;
    const base = opts.lineBase || 0;
    let rem = sql;
    const lineAt = (off) => base + sql.slice(0, off).split('\n').length;
    const it = db.iterateStatements(sql);
    while (true) {
      const remBefore = it.getRemainingSQL ? it.getRemainingSQL() : rem;
      const off = sql.length - remBefore.length + this.skipWs(remBefore);
      let st;
      try { const n = it.next(); if (n.done) break; st = n.value; }
      catch (e) { const err = new Error(e.message); err.line = lineAt(off); throw err; }
      stmtCount++;
      try {
        const cols = st.getColumnNames();
        const rows = [];
        while (st.step()) rows.push(st.get());
        if (cols.length) {
          sets++;
          if (opts.echo) Term.writeln(st.getSQL().trim().split('\n')[0].slice(0, 100), 't-dim');
          Term.writeln(rows.length ? this.table(cols, rows) : `(0 satır) ${cols.join(', ')}`);
          if (rows.length) Term.writeln(`${rows.length} satır`, 't-dim');
        } else changes += db.getRowsModified();
      } catch (e) { const err = new Error(e.message); err.line = lineAt(off); throw err; }
      finally { st.free(); }
    }
    return { stmtCount, changes, sets };
  },
  async runFile(path, code, opts) {
    Run.setRunning(true, 'SQLite'); Term.setMode('busy');
    const m = code.match(/^\s*--\s*@db\s+(\S+)/m);
    const dbPath = m ? normPath(dirname(path), m[1]) : null;
    Term.writeln(`$ sqlite3 ${dbPath ? basename(dbPath) : ':memory:'} < ${basename(path)}`, 't-dim');
    let db = null, rc = 0;
    try {
      if (!this.lib) {
        Term.writeln('SQLite yükleniyor…', 't-dim');
        try { await this.load(); } catch (e) { const er = new Error('SQLite motoru yüklenemedi. İnternet varken bir kez çalıştır veya Run › "Çevrimdışı Kullanım İçin İndir".'); er.load = true; throw er; }
      }
      db = await this.openDb(dbPath);
      const r = this.exec(db, code, { echo: true });
      if (!r.sets) Term.writeln(`${r.stmtCount} ifade çalıştı, ${r.changes} satır değişti.`, 't-dim');
      Problems.set([]);
    } catch (e) {
      rc = 1;
      const msg = String(e.message || e).replace(/^Error:\s*/, '');
      Term.writeln(e.load ? msg : e.line ? `Parse error near line ${e.line}: ${msg}` : `Error: ${msg}`, 't-err');
      if (e.line) { Problems.set([{ file: path, line: e.line, col: 1, sev: 'error', msg, source: 'sqlite' }]); if (Tabs.active && Tabs.active.path === path) Ed.reveal(e.line, 1); }
    } finally {
      if (db && dbPath) { try { await this.saveDb(db, dbPath); await Explorer.refresh(); Term.writeln(`(${basename(dbPath)} kaydedildi)`, 't-dim'); } catch (e) { Term.writeln('Veritabanı kaydedilemedi: ' + e.message, 't-err'); } }
      if (db) db.close();
    }
    Run.finishLine(rc, Math.round(performance.now() - Run.startT), 'SQLite ' + (this.version() || ''));
  },
  version() { try { if (!this.lib) return ''; const d = new this.lib.Database(); const v = d.exec('select sqlite_version()')[0].values[0][0]; d.close(); return v; } catch (e) { return ''; } },
  async startRepl(path) {
    Term.setMode('busy');
    try { if (this.db) this.db.close(); this.db = await this.openDb(path); this.dbPath = path; }
    catch (e) { Term.writeln('SQLite yüklenemedi: ' + (e.message || e), 't-err'); Term.setMode('shell'); return; }
    this.buf = '';
    Term.writeln(`SQLite version ${this.version()} (sql.js)`);
    Term.writeln(`Bağlı: ${path ? basename(path) : 'geçici bellek-içi veritabanı'}.  ".help" yardım, ".quit" çıkış.`, 't-dim');
    Term.setMode('sqlite');
  },
  async persist() { if (this.dbPath && this.db) { try { await this.saveDb(this.db, this.dbPath); } catch (e) { Term.writeln('kaydedilemedi: ' + e.message, 't-err'); } } },
  async replLine(line) {
    const T = line.trim();
    if (!this.buf && T.startsWith('.')) {
      const [cmd, ...a] = T.split(/\s+/);
      switch (cmd) {
        case '.quit': case '.exit': await this.persist(); if (this.db) this.db.close(); this.db = null; Term.setMode('shell'); if (this.dbPath) Explorer.refresh(); return;
        case '.help': Term.writeln('.tables  .schema [TABLO]  .read DOSYA.sql  .open DOSYA.db  .save DOSYA.db  .clear  .quit'); break;
        case '.tables': { const r = this.db.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY 1"); Term.writeln(r.length ? r[0].values.map((v) => v[0]).join('  ') : ''); break; }
        case '.schema': { const r = this.db.exec("SELECT sql FROM sqlite_master WHERE sql NOT NULL" + (a[0] ? ` AND tbl_name = '${a[0].replace(/'/g, "''")}'` : '')); if (r.length) Term.writeln(r[0].values.map((v) => v[0] + ';').join('\n')); break; }
        case '.read': {
          if (!a[0]) { Term.writeln('.read DOSYA', 't-err'); break; }
          const p = normPath(Term.cwd, a[0]);
          try { const c = (await native('fs.read', { path: p })).content; this.exec(this.db, c, { echo: false }); await this.persist(); }
          catch (e) { Term.writeln(`Error: ${a[0]}${e.line ? ' satır ' + e.line : ''}: ${String(e.message).replace(/^Error:\s*/, '')}`, 't-err'); }
          break;
        }
        case '.open': await this.persist(); this.db.close(); this.dbPath = a[0] ? normPath(Term.cwd, a[0]) : null; this.db = await this.openDb(this.dbPath); Term.writeln(this.dbPath ? 'Açıldı: ' + this.dbPath : 'Bellek-içi veritabanı', 't-dim'); break;
        case '.save': { if (!a[0]) { Term.writeln('.save DOSYA.db', 't-err'); break; } const p = normPath(Term.cwd, a[0]); await this.saveDb(this.db, p); this.dbPath = p; await Explorer.refresh(); Term.writeln('Kaydedildi: ' + p, 't-dim'); break; }
        case '.clear': Term.clear(); break;
        default: Term.writeln(`Error: unknown command: "${cmd}". ".help" yaz.`, 't-err');
      }
      Term.updatePrompt(); return;
    }
    this.buf += (this.buf ? '\n' : '') + line;
    if (!this.lib.Database || !/;\s*$/.test(this.buf.replace(/--[^\n]*$/gm, '').trim())) { Term.updatePrompt(); return; }
    const sql = this.buf; this.buf = '';
    try { this.exec(this.db, sql, {}); await this.persist(); }
    catch (e) { Term.writeln('Parse error: ' + String(e.message).replace(/^Error:\s*/, ''), 't-err'); }
    Term.updatePrompt();
  }
};

// ---------------------------------------------------------------- Clang (gerçek LLVM, Web/clang/ varsa)
const Clang = {
  ok: false, w: null,
  async detect() {
    try { const r = await fetch('clang/memfs.wasm', { method: 'HEAD' }); this.ok = r.ok; } catch (e) { this.ok = false; }
    if (!SET.askMigrated) { SET.askMigrated = true; SET.cRunner = 'ask'; SET.cppRunner = 'ask'; saveSettings(); }
    return this.ok;
  },
  worker() { if (!this.w) this.w = new Worker('clang-worker.js'); return this.w; },
  reset() { if (this.w) { try { this.w.terminate(); } catch (e) {} } this.w = null; },
  preload() { if (this.ok) { const w = this.worker(); w.postMessage({ type: 'preload' }); } }
};

const Run = {
  running: false, startT: 0, timer: null, feed: null,
  // Mac'teki VS Code gibi: C/C++ çalıştırırken derleyiciyi sor (varsayılan yapılmadıysa)
  compilerChoices(kind) {
    const tr = SET.lang !== 'en';
    const list = kind === 'c'
      ? [Clang.ok && { v: 'clang', label: 'clang – Clang 8 (gerçek LLVM, çevrimdışı)', desc: tr ? 'tam C17 + standart kütüphane' : 'full C17' },
         { v: 'local', label: tr ? 'vsipad-cc – VS iPad C derleyicisi (çevrimdışı)' : 'vsipad-cc – built-in C compiler (offline)', desc: tr ? 'hızlı, çalışma hatasında satır gösterir' : 'fast, runtime error lines' },
         { v: 'online', label: 'gcc – GCC (online)', desc: 'Wandbox / Compiler Explorer' }]
      : [Clang.ok && { v: 'clang', label: 'clang++ – Clang 8 (çevrimdışı)', desc: 'C++17, libc++' },
         { v: 'online', label: 'g++ – GCC (online)', desc: 'Wandbox / Compiler Explorer' }];
    return list.filter(Boolean);
  },
  async pickCompiler(kind, opts) {
    const key = kind === 'c' ? 'cRunner' : 'cppRunner';
    const choices = this.compilerChoices(kind);
    const valid = (v) => choices.some((c) => c.v === v);
    if (opts && opts.forceRunner && valid(opts.forceRunner)) return opts.forceRunner;
    if (choices.length === 1) return choices[0].v;
    if (SET[key] && SET[key] !== 'ask' && valid(SET[key]) && !(opts && opts.alwaysAsk)) return SET[key];
    const last = SET[key + 'Last'];
    if (opts && opts.agent) return valid(last) ? last : choices[0].v;
    const tr = SET.lang !== 'en';
    const items = choices.slice().sort((a, b) => (b.v === last) - (a.v === last)).map((c) => Object.assign({}, c, { kb: c.v === last ? (tr ? 'son kullanılan' : 'recent') : '' }));
    const it = await quickPick(items, { placeholder: tr ? `${kind === 'c' ? 'C' : 'C++'} için derleyici seç (aktif dosyayı derle ve çalıştır)` : `Select a ${kind === 'c' ? 'C' : 'C++'} compiler` });
    if (!it) return null;
    SET[key + 'Last'] = it.v; saveSettings(); syncRunControls();
    if (!SET[key + 'Hinted']) {
      SET[key + 'Hinted'] = true; saveSettings();
      notify('info', tr ? `Her çalıştırmada sorulacak. ${it.label.split(' – ')[0]} varsayılan olsun mu?` : 'Make this the default?', { timeout: 8000, actions: [{ label: tr ? 'Varsayılan yap' : 'Make default', run: () => { SET[key] = it.v; saveSettings(); syncRunControls(); } }, { label: tr ? 'Sormaya devam et' : 'Keep asking' }] });
    }
    return it.v;
  },
  feedStdin() {
    if (!this.feed) return false;
    const l = this.feed.shift();
    if (l === undefined) { this.feed = null; Term.writeln('^D', 't-dim'); native('stdin.provide', { eof: true }); }
    else { Term.write(l + '\n', 't-stdin'); native('stdin.provide', { text: l }); }
    return true;
  },

  updateInfo() {
    const t = Tabs.active;
    if (!t) { $('#runFileInfo').textContent = '— (açık dosya yok)'; return; }
    const L = langOf(t.path);
    const nm = { clang: 'Clang 8 (yerel, çevrimdışı)', local: 'VS iPad C derleyicisi (çevrimdışı)', online: 'online (GCC)', ask: 'çalıştırırken sorulur' };
    const how = { c: nm[SET.cRunner] || nm.ask, cpp: SET.cppRunner === 'online' ? 'online (g++)' : SET.cppRunner === 'clang' ? 'Clang++ 8 (yerel, çevrimdışı)' : nm.ask, java: 'online (OpenJDK)', cs: 'online (C#)', rs: 'online (rustc)', sql: 'yerel SQLite (çevrimdışı)', py: SET.pyRunner === 'local' ? 'yerel Pyodide (çevrimdışı)' : 'online (CPython)', js: 'yerel', html: 'önizleme' }[L.run];
    $('#runFileInfo').innerHTML = `<b>${esc(basename(t.path))}</b> · ${esc(L.name)}<br>${how ? esc(how) : 'Bu dosya türü çalıştırılamaz'}`;
    const clangOn = Clang.ok && ((L.run === 'c' && SET.cRunner === 'clang') || (L.run === 'cpp' && SET.cppRunner === 'clang'));
    const local = clangOn || (L.run === 'py' && SET.pyRunner === 'local') || (L.run === 'c' && SET.cRunner === 'local') || L.run === 'js' || L.run === 'sql';
    const askC = (L.run === 'c' && (SET.cRunner || 'ask') === 'ask') || (L.run === 'cpp' && (SET.cppRunner || 'ask') === 'ask' && Clang.ok);
    $('#sbRunnerText').textContent = askC ? (SET.lang === 'tr' ? 'Derleyici: sor' : 'Compiler: ask') : clangOn ? 'Clang' : L.run === 'sql' ? 'SQLite' : L.run === 'py' && SET.pyRunner === 'local' ? 'Pyodide' : L.run === 'c' && SET.cRunner === 'local' ? 'C (yerel)' : L.run === 'js' ? 'JS (yerel)' : (SET.runner === 'godbolt' ? 'Compiler Explorer' : 'Wandbox');
    $('#sbRunner').querySelector('.codicon').className = 'codicon codicon-' + (local ? 'vm' : 'cloud');
  },
  setRunning(on, label) {
    this.running = on;
    document.body.classList.toggle('running', on);
    $('#eaRunGroup').classList.toggle('hidden', on || !(Tabs.active && langOf(Tabs.active.path).run));
    $('#eaStop').classList.toggle('hidden', !on);
    $('#paStop').classList.toggle('hidden', !on);
    $('#sbRunning').classList.toggle('hidden', !on);
    if (label) $('#sbRunningText').textContent = label;
    $('#runViewBtn').textContent = t(on ? 'Running… (Stop)' : 'Run and Debug');
  },
  // ▶ yanındaki ⌄ : Mac'teki VS Code'un C/C++ çalıştırma menüsü + derleyici seçimi
  showRunMenu(x, y) {
    const tab = Tabs.active; if (!tab) return;
    const L = langOf(tab.path), tr = SET.lang !== 'en';
    const isC = L.run === 'c' || L.run === 'cpp';
    const items = [];
    if (isC) {
      const key = L.run === 'c' ? 'cRunner' : 'cppRunner', cur = SET[key] || 'ask';
      const hasLocal = this.compilerChoices(L.run).some((c) => c.v === 'local');
      items.push(
        { label: tr ? 'C/C++ Dosyasında Hata Ayıklama' : 'Debug C/C++ File', run: () => this.runActive(hasLocal ? { forceRunner: 'local', askInput: true } : { askInput: true }) },
        { label: 'Run Code', kb: '⌃⌥N', run: () => this.runActive() },
        { label: tr ? 'C/C++ Dosyasını Çalıştırın' : 'Run C/C++ File', run: () => this.runActive({ alwaysAsk: true }) },
        '-');
      for (const c of this.compilerChoices(L.run)) items.push({ label: (tr ? 'Bununla çalıştır: ' : 'Run with: ') + c.label.split(' – ')[0], kb: c.desc ? c.desc.slice(0, 26) : '', checked: cur === c.v, run: () => this.runActive({ forceRunner: c.v }) });
      items.push('-',
        { label: tr ? 'Her çalıştırmada sor' : 'Ask every time', checked: cur === 'ask', run: () => { SET[key] = 'ask'; saveSettings(); syncRunControls(); } },
        { label: tr ? 'Varsayılan derleyiciyi seç…' : 'Select default compiler…', run: () => Commands.run(L.run === 'c' ? 'run.cRunner' : 'run.cppRunner') });
    } else {
      items.push({ label: 'Run Code', kb: '⌘↵', run: () => this.runActive() });
      if (L.run === 'py') items.push({ label: tr ? 'Yorumlayıcı seç…' : 'Select Interpreter…', run: () => Commands.run('run.pyRunner') });
      if (['java', 'cs', 'rs'].includes(L.run)) items.push({ label: tr ? 'Derleme servisi seç…' : 'Select Compiler Service…', run: () => Commands.run('run.selectRunner') });
    }
    items.push('-', { label: tr ? 'Girdiyle çalıştır (stdin)…' : 'Run with Input…', run: () => this.runActive({ askInput: true }) });
    Menu.show(items, Math.max(4, x), y);
  },
  async runActive(opts = {}) {
    if (!Tabs.active) { notify('info', 'Çalıştırmak için önce bir dosya aç.'); return; }
    return this.runFile(Tabs.active.path, opts);
  },
  async runFile(path, opts = {}) {
    if (this.running) { notify('warning', 'Bir program zaten çalışıyor. Önce durdur (⇧F5).'); return; }
    const L = langOf(path);
    if (!L.run) { notify('info', `${L.name} dosyaları çalıştırılamaz. Desteklenenler: C, C++, Java, C#, Python, Rust, SQL, JavaScript, HTML.`); return; }
    await Tabs.saveAll();
    if (SET.dismissKbOnRun !== false && IS_TOUCH) try { native('app.dismissKeyboard'); } catch (e) {}
    Panel.show('terminal');
    Output.clear();
    let code;
    const open = Tabs.list.find((t) => t.path === path);
    try { code = open ? Ed.getValue(open.model) : (await native('fs.read', { path })).content; }
    catch (e) { notify('error', String(e.message || e)); return; }

    let stdin = SET.stdin || '';
    if (opts.askInput) {
      const v = await inputBox({ title: 'Standard input', prompt: 'Girdileri yaz (satırları \\n veya ; ile ayırabilirsin)', value: stdin.replace(/\n/g, '\\n') });
      if (v == null) return;
      stdin = v.replace(/\\n/g, '\n').replace(/;\s*/g, '\n');
      if (!stdin.endsWith('\n')) stdin += '\n';
    }
    if (opts.agent) { stdin = opts.stdin || ''; this.feed = stdin.replace(/\n$/, '').split('\n').filter((l, i, a) => !(a.length === 1 && l === '')); }
    const args = opts.args && opts.args.length ? opts.args : (SET.args || '').split(/\s+/).filter(Boolean);
    Term.ensureNewline();
    this.startT = performance.now();
    let runner = null;
    try {
      if (L.run === 'ino') { if (CTX.Esp) await CTX.Esp.buildAndFlash(path); return; }
      if (L.run === 'py' && CTX.Esp && !opts.agent && (CTX.Esp.MPY_HINT.test(code) || CTX.Esp.CPY_HINT.test(code))) {
        const tr = SET.lang !== 'en', cpy = CTX.Esp.CPY_HINT.test(code);
        const items = [{ v: 'esp', label: tr ? 'ESP32\'de çalıştır (MicroPython)' : 'Run on ESP32 (MicroPython)', desc: tr ? 'Wi-Fi / Bluetooth' : '' },
          { v: 'cpy', label: tr ? 'Karta yaz (CircuitPython · USB kablo)' : 'Write to board (CircuitPython · USB)', desc: tr ? 'code.py olarak, internetsiz' : 'as code.py' },
          { v: 'local', label: tr ? 'iPad\'de çalıştır (Pyodide)' : 'Run on iPad (Pyodide)' }];
        const it = await quickPick(items.sort((a, b) => ((b.v === SET.pyTargetLast) - (a.v === SET.pyTargetLast)) || ((b.v === 'cpy') === cpy) - ((a.v === 'cpy') === cpy)), { placeholder: tr ? 'Bu dosya kart kütüphanesi kullanıyor – nerede çalışsın?' : 'Where to run?' });
        if (!it) return;
        SET.pyTargetLast = it.v; saveSettings();
        if (it.v === 'esp') { await CTX.Esp.mpyRun(path); return; }
        if (it.v === 'cpy') { await CTX.Esp.cpyRun(path); return; }
      }
      if (L.run === 'py' && SET.pyRunner === 'local') await this.runPythonLocal(path, code, args);
      else if ((L.run === 'c' || L.run === 'cpp') && (runner = await this.pickCompiler(L.run, opts)) === null) { Term.writeln('İptal edildi.', 't-dim'); }
      else if (L.run === 'c' && runner === 'clang') await this.runCLocal(path, code, args, Object.assign({}, opts, { engine: 'clang', lang: 'c' }, opts.askInput ? { stdin } : {}));
      else if (L.run === 'c' && runner === 'local') await this.runCLocal(path, code, args, Object.assign({}, opts, opts.askInput ? { stdin } : {}));
      else if (L.run === 'cpp' && runner === 'clang') await this.runCLocal(path, code, args, Object.assign({}, opts, { engine: 'clang', lang: 'cpp' }, opts.askInput ? { stdin } : {}));
      else if (L.run === 'js') await this.runJS(path, code);
      else if (L.run === 'sql') await SQL.runFile(path, code, opts);
      else if (L.run === 'html') this.previewHTML(path, code);
      else await this.runRemote(L.run, path, code, stdin, args, opts);
    } finally {
      this.feed = null;
      if (this.running) this.setRunning(false);
      if (!['repl', 'shell', 'sqlite'].includes(Term.mode)) Term.setMode('shell');
    }
  },

  // ---- Python yerel
  async runPythonLocal(path, code, args) {
    this.setRunning(true, 'Python');
    Term.setMode('busy');
    Term.writeln(`$ python3 ${basename(path)}${args.length ? ' ' + args.join(' ') : ''}`, 't-dim');
    const dir = dirname(path);
    const files = [];
    for (const e of Explorer.entries) {
      if (e.dir || e.size > 1000000 || files.length > 150) continue;
      if (dir && !e.path.startsWith(dir + '/')) continue;
      if (!TEXT_EXT.has(extOf(e.path))) continue;
      try {
        const open = Tabs.list.find((t) => t.path === e.path);
        files.push({ path: e.path, content: open ? Ed.getValue(open.model) : (e.path === path ? code : (await native('fs.read', { path: e.path })).content) });
      } catch (err) {}
    }
    let res;
    try {
      if (!Py.ready) Term.writeln('Python yorumlayıcısı başlatılıyor (ilk seferde birkaç saniye)…', 't-dim');
      res = await Py.run(path, code, files, dir, args);
    } catch (e) {
      if (String(e.message) === 'stopped') return;
      Term.writeln(String(e.message || e), 't-err');
      if (!/stopped/.test(e.message)) {
        Term.writeln('Yerel Python kullanılamadı → online CPython deneniyor…', 't-warn');
        this.setRunning(false);
        return this.runRemote('py', path, code, SET.stdin || '', args, {});
      }
      return;
    }
    Term.ensureNewline();
    const tb = $('#termOut').textContent.slice(-4000);
    const diags = res.rc ? parsePyTraceback(tb, (f) => (f.startsWith('/ws/') ? f.slice(4) : null)) : [];
    Problems.set(diags);
    this.finishLine(res.rc, res.ms);
    // programın yazdığı dosyaları geri kaydet
    if (res.changed && res.changed.length) {
      for (const f of res.changed) {
        try { await native('fs.write', { path: f.path, content: f.content }); Tabs.reloadFromDisk(f.path); } catch (e) {}
      }
      await Explorer.refresh();
      Term.writeln(`(${res.changed.length} dosya kaydedildi: ${res.changed.map((f) => basename(f.path)).join(', ')})`, 't-dim');
    }
  },
  async runPythonCode(code, name, cwd) {
    this.setRunning(true, 'Python'); Term.setMode('busy');
    try { const res = await Py.run((cwd ? cwd + '/' : '') + '__main__.py', code, [], cwd, []); this.finishLine(res.rc, res.ms); }
    catch (e) { Term.writeln(String(e.message || e), 't-err'); }
    finally { this.setRunning(false); Term.setMode('shell'); }
  },

  // ---- online derleyiciler
  async runRemote(kind, path, code, stdin, args, opts) {
    const dir = dirname(path);
    const sibs = Explorer.entries.filter((e) => !e.dir && dirname(e.path) === dir && e.path !== path && e.size < 300000);
    const extras = [];
    const srcExt = { c: ['c'], cpp: ['cpp', 'cc', 'cxx'], java: ['java'], cs: ['cs'], py: ['py'], rs: ['rs'] }[kind];
    const hdrExt = ['h', 'hpp', 'hh', 'hxx', 'inc', 'tpp'];
    const dataExt = ['txt', 'csv', 'dat', 'in', 'json', 'tsv'];
    let mainCode = code;
    const fixJava = (s) => s.replace(/^\s*package\s+[\w.]+\s*;\s*$/m, '');
    for (const e of sibs) {
      const x = extOf(e.path);
      const isSrc = srcExt.includes(x), isHdr = (kind === 'c' || kind === 'cpp') && hdrExt.includes(x), isData = dataExt.includes(x);
      if (!isSrc && !isHdr && !isData) continue;
      let c;
      try { const o = Tabs.list.find((t) => t.path === e.path); c = o ? Ed.getValue(o.model) : (await native('fs.read', { path: e.path })).content; } catch (err) { continue; }
      if (isSrc && (kind === 'c' || kind === 'cpp') && /\bint\s+main\s*\(/.test(c)) continue; // başka main içeren dosyayı ekleme
      if (isSrc && kind === 'cs' && /static\s+(void|int|async\s+Task)\s+Main\s*\(/.test(c)) continue;
      if (isSrc && kind === 'rs' && /\bfn\s+main\s*\(/.test(c)) continue;
      if (kind === 'java' && isSrc) c = fixJava(c);
      extras.push({ file: basename(e.path), path: e.path, code: c, source: isSrc && (kind === 'c' || kind === 'cpp') });
    }
    if (kind === 'java') {
      mainCode = fixJava(mainCode).replace(/^(\s*)public\s+((?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s)/m, '$1$2');
    }
    const defFlags = { c: '-std=gnu17 -Wall', cpp: '-std=gnu++17 -Wall' }[kind] || '';
    const flags = (opts.flags && opts.flags.length ? opts.flags.join(' ') : (SET.cflags || defFlags)).split(/\s+/).filter(Boolean);

    const out = stem(path);
    const display = {
      c: `gcc ${flags.join(' ')} ${basename(path)}${extras.filter((e) => e.source).map((e) => ' ' + e.file).join('')} -o ${out} && ./${out}`,
      cpp: `g++ ${flags.join(' ')} ${basename(path)}${extras.filter((e) => e.source).map((e) => ' ' + e.file).join('')} -o ${out} && ./${out}`,
      java: `javac ${basename(path)} && java ${(code.match(/class\s+(\w+)[^{]*\{[\s\S]*?static\s+void\s+main/) || [])[1] || out}`,
      cs: `dotnet run ${basename(path)}`, py: `python3 ${basename(path)}`,
      rs: `rustc --edition 2021 ${basename(path)} && ./${out}`
    }[kind] + (args.length ? ' ' + args.join(' ') : '');
    Term.writeln('$ ' + display, 't-dim');
    if (!stdin && !(opts && opts.agent) && READS_INPUT[kind] && READS_INPUT[kind].test(code)) {
      Term.writeln(`▶ ${basename(path)} girdi okuyor. Girdileri aşağıya yaz (ya da Run panelindeki stdin kutusuna önceden yaz).`, 't-info');
      const got = await Term.collect();
      if (got == null) { Term.writeln('İptal edildi.', 't-dim'); return; }
      stdin = got;
    }

    const job = { kind, path, code: mainCode, extras, stdin, args, flags };
    this.setRunning(true, 'Compiling…');
    Term.setMode('busy');
    const tick = setInterval(() => { $('#sbRunningText').textContent = `Running… ${((performance.now() - this.startT) / 1000).toFixed(0)}s`; }, 1000);
    this.abort = false;
    let res = null, err = null;
    const order = SET.runner === 'godbolt' ? [Godbolt] : SET.runner === 'wandbox' ? [Wandbox] : [Wandbox, Godbolt];
    for (const svc of order) {
      try { res = await svc.run(job); break; }
      catch (e) { err = e; if (this.abort) break; if (order.length > 1 && svc === Wandbox) Term.writeln(`Wandbox: ${e.message || e} → Compiler Explorer deneniyor…`, 't-warn'); }
    }
    clearInterval(tick);
    if (this.abort) { Term.writeln('^C (durduruldu)', 't-dim'); return; }
    if (!res) {
      Term.writeln('Derleme servisine ulaşılamadı: ' + (err && err.message || err), 't-err');
      Term.writeln('C/C++/Java/C# için internet gerekir. Python çevrimdışı çalışır.', 't-dim');
      return;
    }
    // çıktıyı gerçek dosya adlarıyla göster
    const rename = (s) => s.replace(/\bprog\.(cc|c|java|cs|py|rs)\b/g, basename(path)).replace(/<source>/g, basename(path)).replace(/\/home\/jail\/|\/app\/|\/tmp\/compiler-explorer-compiler[^/]*\//g, '');
    const compileOut = rename(res.compileOut || '');
    if (compileOut.trim()) Term.writeLinked(compileOut.replace(/\n+$/, ''));
    let diags = parseDiagnostics(compileOut, job, Object.assign({}, res, { mainName: basename(path) }));
    if (res.stdout) { Term.write(res.stdout); Output.append(res.stdout); }
    if (res.stderr) { Term.write(rename(res.stderr), 't-err'); Output.append(res.stderr); }
    if (kind === 'py' && res.stderr) diags = diags.concat(parsePyTraceback(rename(res.stderr), (f) => (/prog\.py|<source>|\.py$/.test(f) ? path : null)));
    Problems.set(diags);
    Term.ensureNewline();
    $('#outputLog').textContent = `[${res.service}] ${res.compiler}\n` + compileOut + '\n' + $('#outputLog').textContent;
    if (res.compileFailed) {
      const n = diags.filter((d) => d.sev === 'error').length;
      Term.writeln(`✖ Derleme başarısız${n ? ` (${n} hata)` : ''} · ${res.compiler} · ${res.service}`, 't-err');
      if (diags.length) { const d = diags.find((x) => x.sev === 'error') || diags[0]; if (Tabs.active && Tabs.active.path === d.file) Ed.reveal(d.line, d.col); }
    } else {
      this.finishLine(res.exit, Math.round(performance.now() - this.startT), `${res.compiler} · ${res.service}`, res.signal);
    }
  },
  finishLine(rc, ms, extra, signal) {
    const ok = rc === 0 || rc == null;
    const t = ms != null ? (ms > 1000 ? (ms / 1000).toFixed(2) + ' s' : ms + ' ms') : '';
    Term.writeln(`${ok ? '✔' : '✖'} ${signal ? 'Sinyal: ' + signal + ' · ' : ''}çıkış kodu ${rc == null ? 0 : rc}${t ? ' · ' + t : ''}${extra ? ' · ' + extra : ''}`, ok ? 't-ok' : 't-err');
  },

  // ---- JavaScript (yerel)
  async runJS(path, code) {
    this.setRunning(true, 'JavaScript');
    Term.writeln(`$ node ${basename(path)}`, 't-dim');
    const fmt = (v) => (typeof v === 'string' ? v : (() => { try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); } })());
    const mk = (cls) => (...a) => Term.writeln(a.map(fmt).join(' '), cls);
    const con = { log: mk(), info: mk('t-info'), warn: mk('t-warn'), error: mk('t-err'), debug: mk('t-dim'), table: mk() };
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    let rc = 0;
    try { await new AsyncFn('console', 'require', 'process', code)(con, () => { throw new Error('require() desteklenmiyor'); }, { argv: [], env: {}, exit: () => {} }); }
    catch (e) { Term.writeln(String(e && e.stack || e), 't-err'); rc = 1; }
    this.finishLine(rc, Math.round(performance.now() - this.startT));
  },
  previewHTML(path, code) {
    const p = $('#md-preview');
    p.innerHTML = '';
    const f = h('iframe'); f.style.cssText = 'width:100%;height:100%;border:0;background:#fff;position:absolute;inset:0';
    f.setAttribute('sandbox', 'allow-scripts allow-modals');
    f.srcdoc = code;
    p.style.padding = '0'; p.appendChild(f); p.classList.remove('hidden');
    MD.showing = true;
    Term.writeln(`HTML önizleme açıldı: ${basename(path)} (kapatmak için önizleme butonuna veya sekmeye dokun)`, 't-dim');
  },
  // ---- C (yerel, çevrimdışı derleyici – Web/c-interp.js)
  async runCLocal(path, code, args, opts) {
    const dir = dirname(path);
    const files = {};
    let n = 0;
    for (const e of Explorer.entries) {
      if (e.dir || e.size > 1000000 || n > 300) continue;
      if (dir && !e.path.startsWith(dir + '/')) continue;
      if (!TEXT_EXT.has(extOf(e.path))) continue;
      try {
        const o = Tabs.list.find((t) => t.path === e.path);
        files[e.path] = e.path === path ? code : o ? Ed.getValue(o.model) : (await native('fs.read', { path: e.path })).content;
        n++;
      } catch (err) {}
    }
    files[path] = code;
    const sources = [path];
    const clang = opts && opts.engine === 'clang', isCpp = opts && opts.lang === 'cpp';
    const srcExts = isCpp ? ['cpp', 'cc', 'cxx'] : ['c'];
    for (const p of Object.keys(files)) {
      if (p === path || dirname(p) !== dir || !srcExts.includes(extOf(p))) continue;
      if (/\b(int|void)\s+main\s*\(/.test(files[p])) continue;
      sources.push(p);
    }
    const out = stem(path);
    const flags = (opts && opts.flags && opts.flags.length ? opts.flags.join(' ') : (SET.cflags || (isCpp ? '-std=c++17 -Wall' : '-std=c17 -Wall')));
    Term.writeln(`$ ${clang ? (isCpp ? 'clang++' : 'clang') : 'gcc'} ${flags} ${sources.map(basename).join(' ')} -o ${out} && ./${out}${args.length ? ' ' + args.join(' ') : ''}`, 't-dim');
    this.setRunning(true, clang ? 'Clang derliyor…' : 'C derleniyor…');
    Term.setMode('busy');
    const msg = { type: 'run', files, sources, main: path, dataFiles: files, cwd: dir, argv: args, progName: out, lang: isCpp ? 'cpp' : 'c', flags: flags.split(/\s+/).filter(Boolean) };
    const pre = opts && opts.stdin != null ? opts.stdin : (SET.stdin || '');
    if (opts && opts.agent && opts.stdin != null) msg.stdin = opts.stdin;
    else if (pre) { msg.stdin = pre; Term.writeln('(girdi Run panelindeki stdin kutusundan alınıyor)', 't-dim'); }
    const t0 = performance.now();
    let compileFailed = false, diagList = [];
    const res = await new Promise((resolve) => {
      const job = this.cJob = { resolve, done: false };
      const onMsg = (m) => {
        if (job.done) return;
        switch (m.type) {
          case 'diag':
            job.gotDiag = true;
            diagList = (m.diags || []).filter((d) => d.file && d.file !== '<built-in>');
            if (m.text) Term.writeLinked(m.text.replace(/\n+$/, ''));
            if (m.ok) $('#sbRunningText').textContent = 'C çalışıyor…';
            break;
          case 'stdout': Term.write(m.text); Output.append(m.text); break;
          case 'stderr': Term.write(m.text, 't-err'); Output.append(m.text); break;
          case 'stdin-request': if (Run.feedStdin()) break; Term.setMode('pystdin'); if (IS_TOUCH) Term.input.focus(); break;
          case 'stdin-done': if (Term.mode === 'pystdin') Term.setMode('busy'); break;
          case 'stdin-broken': this.cForceMain = true; notify('warning', 'Bu cihazda arka plan girdi okuma desteklenmedi; bir sonraki çalıştırmada girdi pencereyle sorulacak. Tekrar çalıştır.', { timeout: 12000 }); break;
          case 'status': $('#sbRunningText').textContent = m.text; if (/yükleniyor/.test(m.text)) Term.writeln(m.text, 't-dim'); break;
          case 'done': job.done = true; if (job.worker && !clang) job.worker.terminate(); resolve(m); break;
        }
      };
      job.onMsg = onMsg;
      const viaMain = async () => {
        if (!window.__cHost) await loadScript('c-interp.js');
        job.main = true;
        window.__cHost.setPost(onMsg);
        setTimeout(() => window.__cHost.handle(msg), 0);
      };
      if (clang) {
        const w = Clang.worker();
        job.worker = w; job.clang = true;
        w.onmessage = (ev) => onMsg(ev.data);
        w.onerror = (ev) => { ev.preventDefault && ev.preventDefault(); Clang.reset(); if (!job.done) { job.done = true; resolve({ rc: 1, error: { msg: 'Clang başlatılamadı: ' + (ev.message || 'bilinmeyen hata') } }); } };
        w.postMessage(msg);
        return;
      }
      if (this.cForceMain) { viaMain().catch((e) => resolve({ rc: 1, error: { msg: String(e.message || e) } })); return; }
      let w;
      try { w = new Worker('c-interp.js'); }
      catch (e) { viaMain().catch((er) => resolve({ rc: 1, error: { msg: String(er.message || er) } })); return; }
      job.worker = w;
      w.onmessage = (ev) => onMsg(ev.data);
      w.onerror = (ev) => { ev.preventDefault && ev.preventDefault(); if (!job.gotDiag && !job.done) { w.terminate(); job.worker = null; Term.writeln('(arka plan derleyici başlatılamadı, ana iş parçacığında çalışıyor)', 't-dim'); viaMain(); } };
      setTimeout(() => { if (!job.gotDiag && !job.done && job.worker) { w.terminate(); job.worker = null; viaMain(); } }, 15000);
      w.postMessage(msg);
    });
    this.cJob = null;
    if (res.stopped) return;
    Term.ensureNewline();
    compileFailed = !!res.compileFailed;
    const diags = diagList.map((d) => ({ file: d.file, line: d.line || 1, col: d.col || 1, sev: d.sev === 'warning' ? 'warning' : 'error', msg: d.msg, source: 'gcc' }));
    if (res.error && res.error.line) {
      diags.push({ file: res.error.file || path, line: res.error.line, col: 1, sev: 'error', msg: res.error.msg, source: 'runtime' });
      Term.writeln(`\n${res.error.msg}`, 't-err');
      Term.writeln(`  → ${basename(res.error.file || path)}:${res.error.line}`, 't-err');
    } else if (res.error) Term.writeln(res.error.msg, 't-err');
    Problems.set(diags);
    if (compileFailed) {
      const ne = diags.filter((d) => d.sev === 'error').length;
      Term.writeln(`✖ Derleme başarısız${ne ? ` (${ne} hata)` : ''} · ${clang ? 'Clang 8 (yerel)' : 'yerel C derleyicisi'}`, 't-err');
      const d = diags.find((x) => x.sev === 'error');
      if (d) Tabs.open(d.file, { preview: false, line: d.line, col: d.col });
      return;
    }
    if (res.error && res.error.line && Tabs.active) { if (Tabs.active.path === (res.error.file || path)) Ed.reveal(res.error.line, 1); }
    this.finishLine(res.rc, res.ms != null ? res.ms : Math.round(performance.now() - t0), `${clang ? 'Clang 8 (yerel)' : 'yerel C'}${res.compileMs != null ? ' (derleme ' + res.compileMs + ' ms)' : ''}`);
    if (res.changed && res.changed.length) {
      for (const f of res.changed) {
        try { if (f.content == null) await native('fs.delete', { path: f.path }); else { await native('fs.write', { path: f.path, content: f.content }); Tabs.reloadFromDisk(f.path); } } catch (e) {}
      }
      await Explorer.refresh();
      Term.writeln(`(${res.changed.length} dosya kaydedildi: ${res.changed.map((f) => basename(f.path)).join(', ')})`, 't-dim');
    }
  },
  stop() {
    if (this.cJob) {
      const j = this.cJob; this.cJob = null;
      if (j.worker) j.worker.terminate();
      if (j.clang) Clang.reset();
      j.done = true;
      native('stdin.reset');
      Term.ensureNewline(); Term.writeln('^C (durduruldu)', 't-err');
      j.resolve({ stopped: true });
      if (j.main) notify('info', 'Program ana iş parçacığında çalışıyordu; tamamen durması için uygulamayı yeniden başlatman gerekebilir.');
      this.setRunning(false); Term.setMode('shell');
      return;
    }
    if (!this.running && Term.mode !== 'pystdin' && Term.mode !== 'busy') return;
    this.abort = true;
    if (Py.pending || Term.mode === 'pystdin' || Py.replActive) {
      Py.kill(); native('stdin.reset');
      const p = Py.pending; Py.pending = null; p && p.reject(new Error('stopped'));
      Term.ensureNewline(); Term.writeln('^C KeyboardInterrupt (durduruldu)', 't-err');
    }
    if (Term.collectDone) { const d = Term.collectDone; Term.collectDone = null; d(null); }
    this.setRunning(false);
    Term.setMode('shell');
  }
};

function syncRunControls() {
  $$('.clang-only').forEach((e) => { e.hidden = !Clang.ok; e.style.display = Clang.ok ? '' : 'none'; });
  $('#runnerSelect').value = SET.runner; $('#pyRunnerSelect').value = SET.pyRunner; $('#cRunnerSelect').value = SET.cRunner === 'clang' && !Clang.ok ? 'ask' : SET.cRunner; $('#cppRunnerSelect').value = ['online', 'clang'].includes(SET.cppRunner) ? SET.cppRunner : 'ask';
  $('#stdinBox').value = SET.stdin || ''; $('#argsBox').value = SET.args || ''; $('#cflagsBox').value = SET.cflags || '';
  Run.updateInfo();
}

// ---------------------------------------------------------------- markdown önizleme
const MD = {
  showing: false,
  toggle(force) {
    const on = force === undefined ? !this.showing : force;
    const p = $('#md-preview');
    if (Tabs.active && !Tabs.active.virtual && /\.(md|markdown)$/i.test(Tabs.active.path)) Tabs.active.reading = !!on;
    document.body.classList.toggle('md-reading', !!(on && Tabs.active && !Tabs.active.virtual));
    if (!on || !Tabs.active || Tabs.active.virtual) { p.classList.add('hidden'); p.classList.remove('ob-reading'); p.innerHTML = ''; p.style.padding = ''; this.showing = false; return; }
    if (CTX.MDView && /\.(md|markdown)$/i.test(Tabs.active.path)) { CTX.MDView.show(true); return; }
    p.style.padding = '';
    p.innerHTML = this.render(Ed.getValue(Tabs.active.model));
    p.classList.remove('hidden'); this.showing = true;
    $$('a', p).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const href = a.getAttribute('href'); if (/^https?:/.test(href)) native('app.openURL', { url: href }); }));
  },
  inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (m, a, b, c) => `<a href="#">${c || a}</a>`);
  },
  render(src) {
    const lines = src.replace(/\r/g, '').split('\n');
    let html = '', i = 0, inList = null, para = [];
    const flushP = () => { if (para.length) { html += '<p>' + para.map((l) => this.inline(l)).join('<br>') + '</p>'; para = []; } };
    const closeList = () => { if (inList) { html += `</${inList}>`; inList = null; } };
    while (i < lines.length) {
      const l = lines[i];
      let m;
      if ((m = l.match(/^```(\w*)/))) {
        flushP(); closeList(); const buf = []; i++;
        while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
        html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; i++; continue;
      }
      if ((m = l.match(/^\$\$(.*)/))) { flushP(); closeList(); const buf = [m[1]]; i++; while (i < lines.length && !lines[i].includes('$$')) buf.push(lines[i++]); i++; html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; continue; }
      if ((m = l.match(/^(#{1,6})\s+(.*)/))) { flushP(); closeList(); html += `<h${m[1].length}>${this.inline(m[2])}</h${m[1].length}>`; i++; continue; }
      if (/^(\*\*\*|---|___)\s*$/.test(l)) { flushP(); closeList(); html += '<hr>'; i++; continue; }
      if ((m = l.match(/^>\s?(.*)/))) { flushP(); closeList(); html += `<blockquote><p>${this.inline(m[1])}</p></blockquote>`; i++; continue; }
      if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|?\s*:?-+/.test(lines[i + 1])) {
        flushP(); closeList();
        const row = (r, tag) => '<tr>' + r.replace(/^\||\|\s*$/g, '').split('|').map((c) => `<${tag}>${this.inline(c.trim())}</${tag}>`).join('') + '</tr>';
        html += '<table>' + row(l, 'th'); i += 2;
        while (i < lines.length && /^\|/.test(lines[i])) html += row(lines[i++], 'td');
        html += '</table>'; continue;
      }
      if ((m = l.match(/^\s*([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?(.*)/))) {
        flushP(); const t = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (inList !== t) { closeList(); html += `<${t}>`; inList = t; }
        const cb = m[2] ? `<input type="checkbox" disabled ${/x/i.test(m[2]) ? 'checked' : ''}> ` : '';
        html += `<li>${cb}${this.inline(m[3])}</li>`; i++; continue;
      }
      if (!l.trim()) { flushP(); closeList(); i++; continue; }
      closeList(); para.push(l); i++;
    }
    flushP(); closeList();
    return html;
  }
};

// ---------------------------------------------------------------- arama
const Search = {
  folder: '', opts: { case: false, word: false, regex: false }, results: [],
  regex() {
    const q = $('#searchInput').value; if (!q) return null;
    let src = this.opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (this.opts.word) src = '\\b' + src + '\\b';
    try { return new RegExp(src, 'g' + (this.opts.case ? '' : 'i')); } catch (e) { $('#searchMsg').textContent = 'Geçersiz regex'; return null; }
  },
  async run() {
    const re = this.regex();
    const cont = $('#searchResults'); cont.innerHTML = '';
    if (!re) { $('#searchMsg').textContent = ''; return; }
    const files = Explorer.entries.filter((e) => !e.dir && e.size < 1500000 && TEXT_EXT.has(extOf(e.path)) && (!this.folder || e.path.startsWith(this.folder + '/')));
    let total = 0; const results = [];
    for (const f of files) {
      let content;
      const o = Tabs.list.find((t) => t.path === f.path);
      try { content = o ? Ed.getValue(o.model) : (await native('fs.read', { path: f.path })).content; } catch (e) { continue; }
      const hits = [];
      content.split('\n').forEach((line, i) => {
        re.lastIndex = 0; let m; const ranges = [];
        while ((m = re.exec(line)) && ranges.length < 50) { ranges.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex++; }
        if (ranges.length) hits.push({ line: i + 1, text: line, ranges });
      });
      if (hits.length) { results.push({ path: f.path, hits }); total += hits.reduce((a, b) => a + b.ranges.length, 0); }
      if (total > 5000) break;
    }
    this.results = results;
    $('#searchMsg').textContent = total ? `${total} result${total > 1 ? 's' : ''} in ${results.length} file${results.length > 1 ? 's' : ''}${this.folder ? ' (' + this.folder + ')' : ''}` : 'No results found.';
    for (const r of results) {
      const fr = h('div', 'row sr-file', `<span class="twist"><i class="codicon codicon-chevron-down"></i></span><span class="ficon">${iconHTML(r.path)}</span><span class="label"><b>${esc(basename(r.path))}</b><span class="dim">${esc(dirname(r.path))}</span></span><span class="badge sr-count">${r.hits.length}</span>`);
      cont.appendChild(fr);
      const wrap = h('div');
      for (const hit of r.hits.slice(0, 200)) {
        const start = Math.max(0, hit.ranges[0][0] - 30);
        let txt = '', pos = start;
        for (const [a, b] of hit.ranges) { if (a < pos) continue; txt += esc(hit.text.slice(pos, a)) + '<mark>' + esc(hit.text.slice(a, b)) + '</mark>'; pos = b; }
        txt += esc(hit.text.slice(pos, pos + 200));
        const lr = h('div', 'row sr-line', `<span class="label">${start ? '…' : ''}${txt.replace(/^\s+/, '')}</span>`);
        lr.onclick = () => Tabs.open(r.path, { preview: true, line: hit.line, col: hit.ranges[0][0] + 1 });
        wrap.appendChild(lr);
      }
      fr.onclick = () => { wrap.classList.toggle('hidden'); $('.twist i', fr).className = 'codicon codicon-chevron-' + (wrap.classList.contains('hidden') ? 'right' : 'down'); };
      cont.appendChild(wrap);
    }
  },
  async replaceAll() {
    const re = this.regex(); if (!re || !this.results.length) return;
    const rep = $('#replaceInput').value;
    const n = this.results.length;
    const i = await dialog(`Replace all occurrences across ${n} file${n > 1 ? 's' : ''} with '${rep}'?`, '', ['Replace', 'Cancel']);
    if (i !== 0) return;
    for (const r of this.results) {
      const o = Tabs.list.find((t) => t.path === r.path);
      const content = o ? Ed.getValue(o.model) : (await native('fs.read', { path: r.path })).content;
      const next = content.replace(re, rep);
      if (o) { Ed.setValue(o.model, next); await Tabs.save(o, true); } else await native('fs.write', { path: r.path, content: next });
    }
    notify('info', 'Değiştirildi.'); this.run();
  }
};

// ---------------------------------------------------------------- uzantılar (Mac'teki VS Code'dan taşınanlar)
const Exts = {
  list: [],
  async load() { try { this.list = await (await fetch('ext/extensions.json')).json(); } catch (e) { this.list = []; } },
  status(id) { const st = X() && X().EXT_STATUS[id]; return st ? { mode: st[0], note: st[1] } : { mode: 'unsupported', note: 'iPad\'de çalıştırılamıyor.' }; },
  toggleable: new Set(['pkief.material-icon-theme', 'ms-ceintl.vscode-language-pack-tr', 'tonybaloney.vscode-pets', 'aaron-bond.better-comments']),
  iconHtml(e, size) { return e.icon ? `<img src="ext/icons/${esc(e.icon)}" style="width:${size}px;height:${size}px;object-fit:contain" alt="">` : `<i class="codicon codicon-extensions" style="font-size:${size * 0.7}px"></i>`; },
  setEnabled(id, on) {
    SET.ext = Object.assign({}, SET.ext, { [id]: on }); saveSettings();
    if (id === 'ms-ceintl.vscode-language-pack-tr') { SET.lang = on ? 'tr' : 'en'; saveSettings(); notify('info', on ? 'Arayüz Türkçe olacak. Menü çubuğu uygulama yeniden açılınca güncellenir.' : 'Interface will switch to English.', { actions: [{ label: on ? 'Şimdi yenile' : 'Reload now', run: () => location.reload() }] }); }
    if (id === 'pkief.material-icon-theme') { Explorer.render(); Tabs.render(); Tabs.updateChrome(); }
    if (id === 'tonybaloney.vscode-pets') PetsUI.apply();
    if (id === 'aaron-bond.better-comments' && Tabs.active && !Tabs.active.virtual) applyBC(Tabs.active.model);
    renderExtensions($('#extSearch').value);
    const vt = Tabs.active && Tabs.active.virtual && Tabs.active.path === 'virtual:ext:' + id; if (vt) Tabs.activate(Tabs.active);
  },
  openDetails(e) {
    Tabs.openVirtual('ext:' + e.id, `${t('Extension')}: ${e.name}`, `<i class="codicon codicon-extensions"></i>`, (root) => {
      const st = this.status(e.id);
      const on = extOn(e.id);
      const chip = { active: ['Etkin', 'ok'], partial: ['Kısmen destekleniyor', 'partial'], unsupported: ['iPad\'de desteklenmiyor', 'no'] }[st.mode];
      root.innerHTML = `
        <div class="xd-head">
          <div class="xd-icon">${this.iconHtml(e, 128)}</div>
          <div class="xd-meta">
            <div class="xd-name">${esc(e.name)}</div>
            <div class="xd-pub">${esc(e.publisher || '')} <span class="dim">· v${esc(e.version || '')}</span></div>
            <div class="xd-desc">${esc(e.desc || '')}</div>
            <div class="xd-actions"></div>
            <div class="xd-status ${chip[1]}"><i class="codicon codicon-${st.mode === 'active' ? 'pass' : st.mode === 'partial' ? 'info' : 'circle-slash'}"></i> ${chip[0]}${st.mode !== 'unsupported' && !on ? ' (devre dışı)' : ''} — ${esc(st.note)}</div>
          </div>
        </div>
        <div class="xd-tabs"><span class="active">${t('DETAILS')}</span></div>
        <div class="xd-body"><div class="xd-readme"></div>
          <div class="xd-side"><h4>${t('Installation')}</h4><table><tr><td>${t('Identifier')}</td><td><code>${esc(e.id)}</code></td></tr><tr><td>${t('Version')}</td><td>${esc(e.version || '')}</td></tr><tr><td>${t('Status')}</td><td>${chip[0]}</td></tr></table></div>
        </div>`;
      const acts = root.querySelector('.xd-actions');
      if (this.toggleable.has(e.id)) {
        const b = h('button', on ? 'btn-secondary' : 'btn-primary'); b.textContent = t(on ? 'Disable' : 'Enable');
        b.onclick = () => this.setEnabled(e.id, !on);
        acts.appendChild(b);
      }
      if (e.id === 'tonybaloney.vscode-pets' && on) { const b2 = h('button', 'btn-secondary'); b2.textContent = SET.lang === 'tr' ? 'Evcil hayvan ekle' : 'Spawn pet'; b2.onclick = () => PetsUI.spawn(); acts.appendChild(b2); }
      if (e.id === 'pkief.material-icon-theme') { const b3 = h('button', 'btn-secondary'); b3.textContent = SET.lang === 'tr' ? 'Dosya Simgesi Temasını Ayarla' : 'Set File Icon Theme'; b3.onclick = () => this.setEnabled(e.id, true); acts.appendChild(b3); }
      const rd = root.querySelector('.xd-readme');
      if (e.readme) fetch('ext/readme/' + e.readme).then((r) => r.text()).then((md) => {
        md = md.replace(/<!--[\s\S]*?-->/g, '').replace(/<img[^>]*>/gi, '').replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/!\[[^\]]*\]\((?!https?:)[^)]*\)/g, '');
        rd.innerHTML = MD.render(md);
        rd.querySelectorAll('a').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); const href = a.getAttribute('href'); if (/^https?:/.test(href)) native('app.openURL', { url: href }); }));
        rd.querySelectorAll('img').forEach((im) => { im.onerror = () => im.remove(); });
      }).catch(() => { rd.innerHTML = '<p class="dim">README yok.</p>'; });
      else rd.innerHTML = `<p class="dim">${esc(e.desc || '')}</p>`;
    });
  }
};
function renderExtensions(filter = '') {
  const cont = $('#extList'); cont.innerHTML = '';
  const f = (filter || '').toLowerCase();
  const list = Exts.list.filter((e) => !f || (e.name + ' ' + e.desc + ' ' + e.publisher + ' ' + e.id).toLowerCase().includes(f));
  const groups = [['INSTALLED', list.filter((e) => Exts.status(e.id).mode !== 'unsupported')], ['NOT SUPPORTED ON IPAD', list.filter((e) => Exts.status(e.id).mode === 'unsupported')]];
  $('#extCount').textContent = groups[0][1].length;
  groups.forEach(([title, items], gi) => {
    if (gi > 0) { if (!items.length) return; cont.appendChild(h('div', 'pane-header expanded', `<i class="codicon codicon-chevron-down twist"></i><span>${t(title)}</span><span class="badge">${items.length}</span>`)); }
    for (const e of items) {
      const st = Exts.status(e.id);
      const on = extOn(e.id);
      const el = h('div', 'ext-item' + (st.mode === 'unsupported' || !on ? ' ext-off' : ''),
        `<div class="ext-icon-img">${Exts.iconHtml(e, 42)}</div><div class="ext-meta"><div class="ext-name">${esc(e.name)}</div><div class="ext-desc">${esc(e.desc || '')}</div><div class="ext-pub"><span>${esc(e.publisher || '')}${st.mode === 'partial' ? ' <span class="ext-chip partial">kısmi</span>' : ''}${st.mode !== 'unsupported' && !on ? ' <span class="ext-chip">devre dışı</span>' : ''}</span><i class="codicon codicon-settings-gear"></i></div></div>`);
      el.addEventListener('click', () => Exts.openDetails(e));
      cont.appendChild(el);
    }
  });
  if (f && !list.length) cont.appendChild(h('div', 'empty-view', '<p class="dim">Marketplace çevrimdışı – yalnızca Mac\'ten taşınan uzantılar listelenir.</p>'));
}

// ---------------------------------------------------------------- vscode-pets arayüzü
const PetsUI = {
  apply() {
    const on = extOn('tonybaloney.vscode-pets') && X() && X().Pets.manifest;
    $('#petsHeader').classList.toggle('hidden', !on);
    $('#petsStage').classList.toggle('hidden', !on || !SET.petsOpen);
    if (!on) { X() && X().Pets.unmount(); return; }
    if (!X().Pets.stage) X().Pets.mount($('#petsStage'), SET.pets, (list) => { SET.pets = list; saveSettings(); });
    this.bg();
  },
  bg() {
    const st = $('#petsStage');
    const dark = SET.theme !== 'light-modern' ? 'dark' : 'light';
    if (!SET.petsBg || SET.petsBg === 'none') { st.style.backgroundImage = ''; st.classList.remove('has-bg'); return; }
    st.classList.add('has-bg');
    st.style.backgroundImage = `url(ext/pets/backgrounds/${SET.petsBg}/background-${dark}-small.png)`;
  },
  async spawn() {
    const P = X().Pets;
    const types = Object.keys(P.manifest);
    const it = await quickPick(types.map((k) => ({ label: SET.lang === 'tr' ? (X().PET_NAMES_TR[k] || k) : k, desc: k, v: k, icon: `<img src="${P.gif({ type: k, color: Object.keys(P.manifest[k])[0] }, 'idle')}" style="width:18px;height:18px;image-rendering:pixelated">` })), { placeholder: SET.lang === 'tr' ? 'Evcil hayvan türü seç' : 'Select pet type' });
    if (!it) return;
    const colors = Object.keys(P.manifest[it.v]);
    let color = colors[0];
    if (colors.length > 1) {
      const c = await quickPick(colors.map((k) => ({ label: k, v: k, icon: `<img src="${P.gif({ type: it.v, color: k }, 'idle')}" style="width:18px;height:18px;image-rendering:pixelated">` })), { placeholder: SET.lang === 'tr' ? 'Renk seç' : 'Select color' });
      if (!c) return; color = c.v;
    }
    if (!SET.petsOpen) { SET.petsOpen = true; this.apply(); }
    P.add(it.v, color);
  },
  async chooseBg() {
    const items = ['none', 'forest', 'beach', 'castle', 'winter', 'autumn'].map((k) => ({ label: SET.lang === 'tr' ? ({ none: 'Yok', forest: 'Orman', beach: 'Kumsal', castle: 'Kale', winter: 'Kış', autumn: 'Sonbahar' }[k]) : k, v: k }));
    const it = await quickPick(items, { placeholder: SET.lang === 'tr' ? 'Arka plan' : 'Background' });
    if (it) { SET.petsBg = it.v; saveSettings(); this.bg(); }
  }
};

// ---------------------------------------------------------------- çevrimdışı hazırlık
const Offline = {
  files() {
    const vs = MONACO_BASE + '/vs/';
    const langs = ['cpp', 'java', 'python', 'csharp', 'markdown', 'javascript', 'typescript', 'html', 'css', 'shell', 'swift', 'go', 'rust', 'kotlin', 'sql', 'xml', 'yaml', 'php', 'ruby', 'lua', 'r', 'scss', 'mips', 'systemverilog', 'objective-c'];
    return [
      vs + 'loader.js', vs + 'editor/editor.main.js', vs + 'editor/editor.main.css', vs + 'base/worker/workerMain.js',
      vs + 'base/browser/ui/codicons/codicon/codicon.ttf',
      ...langs.map((l) => vs + `basic-languages/${l}/${l}.js`),
      vs + 'language/typescript/tsMode.js', vs + 'language/typescript/tsWorker.js', vs + 'language/json/jsonMode.js', vs + 'language/json/jsonWorker.js',
      vs + 'language/css/cssMode.js', vs + 'language/css/cssWorker.js', vs + 'language/html/htmlMode.js', vs + 'language/html/htmlWorker.js',
      CODICON_CSS, CODICON_CSS.replace('codicon.css', 'codicon.ttf'),
      SQLJS_BASE + 'sql-wasm.js', SQLJS_BASE + 'sql-wasm.wasm',
      CDN + 'npm/markdown-it@14.1.0/dist/markdown-it.min.js', CDN + 'npm/katex@0.16.11/dist/katex.min.js', CDN + 'npm/katex@0.16.11/dist/katex.min.css',
      ...['Main-Regular', 'Main-Bold', 'Main-Italic', 'Math-Italic', 'Size1-Regular', 'Size2-Regular', 'Size3-Regular', 'Size4-Regular', 'AMS-Regular'].map((f) => CDN + `npm/katex@0.16.11/dist/fonts/KaTeX_${f}.woff2`),
      CDN + 'npm/pdfjs-dist@3.11.174/build/pdf.min.js', CDN + 'npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js', CDN + 'npm/mermaid@10.9.1/dist/mermaid.min.js',
      PYODIDE_URL + 'pyodide.js', PYODIDE_URL + 'pyodide.asm.js', PYODIDE_URL + 'pyodide.asm.wasm', PYODIDE_URL + 'python_stdlib.zip', PYODIDE_URL + 'pyodide-lock.json'
    ];
  },
  async status() {
    if (!IS_NATIVE) return { monaco: !!monaco, python: false };
    const pyOk = await native('cache.has', { path: `pyodide/v${PYODIDE_VER}/full/pyodide.asm.wasm` });
    const edOk = await native('cache.has', { path: `npm/monaco-editor@${MONACO_VER}/min/vs/editor/editor.main.js` });
    return { monaco: edOk, python: pyOk };
  },
  async update() {
    const s = await this.status();
    const info = await native('cache.info');
    const ready = s.monaco && s.python;
    $('#sbOfflineText').textContent = ready ? '' : 'Offline: eksik';
    $('#sbOffline').querySelector('.codicon').className = 'codicon codicon-' + (ready ? 'pass' : 'cloud-download');
    $('#sbOffline').title = ready ? `Çevrimdışı hazır (${fmtBytes(info.bytes || 0)})` : 'Çevrimdışı kullanım için indirilecek dosyalar var';
    $('#offlineInfo').innerHTML = `Editör: ${s.monaco ? '✔ hazır' : '✖ indirilmedi'}<br>Python: ${s.python ? '✔ hazır' : '✖ indirilmedi'}<br>Önbellek: ${fmtBytes(info.bytes || 0)} (${info.files || 0} dosya)<br><span class="dim">C/C++/Java/C# her zaman internet ister.</span>`;
    return ready;
  },
  async prepare(silent) {
    if (this.busy) return; this.busy = true;
    const files = this.files();
    const n = silent ? null : notify('info', 'Çevrimdışı dosyalar indiriliyor…', { timeout: 0 });
    let done = 0, failed = 0;
    const queue = files.slice();
    const worker = async () => {
      while (queue.length) {
        const u = queue.shift();
        try { const r = await fetch(u); if (!r.ok) failed++; else await r.arrayBuffer(); } catch (e) { failed++; }
        done++; if (n) { n.progress(done / files.length); n.text(`Çevrimdışı dosyalar indiriliyor… ${done}/${files.length}`); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this.busy = false;
    const ok = await this.update();
    if (n) { n.close(); notify(ok ? 'success' : 'warning', ok ? 'Hazır! Editör ve Python artık internetsiz çalışır.' : `Bazı dosyalar indirilemedi (${failed}). İnternet varken tekrar dene.`); }
  }
};

// ---------------------------------------------------------------- örnek dosyalar
const SAMPLES = {
  'Örnekler/merhaba.c': `#include <stdio.h>\n\nint main(void) {\n    int n;\n    printf("Kaç sayı toplanacak? ");\n    scanf("%d", &n);\n\n    int toplam = 0;\n    for (int i = 0; i < n; i++) {\n        int x;\n        scanf("%d", &x);\n        toplam += x;\n    }\n    printf("Toplam = %d\\n", toplam);\n    return 0;\n}\n`,
  'Örnekler/merhaba.cpp': `#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    vector<int> v = {5, 3, 8, 1, 9, 2};\n    sort(v.begin(), v.end());\n    cout << "Sıralı: ";\n    for (int x : v) cout << x << ' ';\n    cout << endl;\n    return 0;\n}\n`,
  'Örnekler/Main.java': `import java.util.ArrayList;\nimport java.util.List;\n\npublic class Main {\n    static class Ogrenci {\n        String isim;\n        double ortalama;\n        Ogrenci(String isim, double ortalama) { this.isim = isim; this.ortalama = ortalama; }\n        @Override public String toString() { return isim + " (" + ortalama + ")"; }\n    }\n\n    public static void main(String[] args) {\n        List<Ogrenci> liste = new ArrayList<>();\n        liste.add(new Ogrenci("Ayşe", 3.42));\n        liste.add(new Ogrenci("Mehmet", 2.95));\n        liste.sort((a, b) -> Double.compare(b.ortalama, a.ortalama));\n        for (Ogrenci o : liste) System.out.println(o);\n    }\n}\n`,
  'Örnekler/Program.cs': `using System;\nusing System.Linq;\n\nclass Program\n{\n    static void Main(string[] args)\n    {\n        var kareler = Enumerable.Range(1, 10).Select(x => x * x);\n        Console.WriteLine("Kareler: " + string.Join(", ", kareler));\n    }\n}\n`,
  'Örnekler/merhaba.py': `def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\n\nisim = input("Adın ne? ")\nprint(f"Merhaba {isim}!")\nn = int(input("Kaçıncı Fibonacci? "))\nprint(f"F({n}) = {fib(n)}")\n`,
  'Örnekler/linked_list/list.h': `#ifndef LIST_H\n#define LIST_H\n\ntypedef struct Node {\n    int data;\n    struct Node *next;\n} Node;\n\nNode *push_front(Node *head, int value);\nvoid print_list(const Node *head);\nvoid free_list(Node *head);\n\n#endif\n`,
  'Örnekler/linked_list/list.c': `#include <stdio.h>\n#include <stdlib.h>\n#include "list.h"\n\nNode *push_front(Node *head, int value) {\n    Node *n = malloc(sizeof(Node));\n    n->data = value;\n    n->next = head;\n    return n;\n}\n\nvoid print_list(const Node *head) {\n    for (const Node *p = head; p; p = p->next) printf("%d -> ", p->data);\n    printf("NULL\\n");\n}\n\nvoid free_list(Node *head) {\n    while (head) { Node *t = head->next; free(head); head = t; }\n}\n`,
  'Örnekler/linked_list/main.c': `#include <stdio.h>\n#include "list.h"\n\n/* Aynı klasördeki list.c ve list.h otomatik olarak derlemeye eklenir. */\nint main(void) {\n    Node *head = NULL;\n    for (int i = 1; i <= 5; i++) head = push_front(head, i * 10);\n    print_list(head);\n    free_list(head);\n    return 0;\n}\n`,
  'Örnekler/okul.sql': `-- SQL dosyaları çevrimdışı SQLite ile çalışır (⌘↵).
-- Her çalıştırmada boş bir veritabanıyla başlar.
-- Kalıcı bir veritabanı için ilk satıra şunu yaz:  -- @db okul.db

CREATE TABLE ogrenci (
    id     INTEGER PRIMARY KEY,
    ad     TEXT NOT NULL,
    bolum  TEXT,
    ort    REAL
);

INSERT INTO ogrenci (ad, bolum, ort) VALUES
    ('Ayşe', 'Bilgisayar', 3.42),
    ('Mehmet', 'Elektrik', 2.95),
    ('Zeynep', 'Bilgisayar', 3.78),
    ('Can', 'Makine', 2.40);

SELECT ad, ort FROM ogrenci WHERE ort > 3 ORDER BY ort DESC;

SELECT bolum, COUNT(*) AS kisi, ROUND(AVG(ort), 2) AS ortalama
FROM ogrenci
GROUP BY bolum
ORDER BY ortalama DESC;
`,
  'Örnekler/merhaba.rs': `use std::io;

fn faktoriyel(n: u64) -> u64 {
    (1..=n).product()
}

fn main() {
    println!("Bir sayı gir:");
    let mut satir = String::new();
    io::stdin().read_line(&mut satir).expect("okunamadı");
    let n: u64 = satir.trim().parse().unwrap_or(5);
    println!("{}! = {}", n, faktoriyel(n));

    let v = vec![5, 3, 8, 1];
    let toplam: i32 = v.iter().sum();
    println!("Toplam = {toplam}");
}
`,
  'Örnekler/OKU.md': `# VS iPad\n\n- **Çalıştır:** sağ üstteki ▷ butonu, \`⌘↵\` veya \`F5\`\n- **C** ve **Python** çevrimdışı çalışır. \`scanf\` / \`input()\` girdileri terminalde sorulur.\n- **C++ / Java / C#** online derleyicide (gerçek GCC / OpenJDK / .NET) çalışır, internet gerekir.\n- C derleme hataları Problems paneline düşer, satır kırmızıyla işaretlenir.\n- Aynı klasördeki \`.h\` / \`.c\` / \`.java\` dosyaları otomatik eklenir → \`linked_list\` klasörüne bak.\n- Program \`scanf\` / \`cin\` / \`Scanner\` kullanıyorsa girdiler terminalde istenir.\n- Dosyalar: **Dosyalar › iPad'imde › VS iPad**\n\n| Kısayol | İş |\n|---|---|\n| ⇧⌘P | Komut paleti |\n| ⌘P | Dosyaya git |\n| ⌘B | Kenar çubuğu |\n| ⌘J | Panel |\n| ⌘S | Kaydet |\n`
};
async function seedIfNeeded() {
  const seeded = await native('kv.get', { key: 'seeded' });
  if (seeded && !(await native('kv.get', { key: 'seeded2' }))) {
    native('kv.set', { key: 'seeded2', value: '1' });
    if (Explorer.exists('Örnekler')) {
      for (const p of ['Örnekler/okul.sql', 'Örnekler/merhaba.rs']) if (!Explorer.exists(p)) { try { await native('fs.write', { path: p, content: SAMPLES[p] }); } catch (e) {} }
      await Explorer.refresh();
    }
  }
  if (seeded || Explorer.entries.length) return false;
  native('kv.set', { key: 'seeded2', value: '1' });
  for (const [p, c] of Object.entries(SAMPLES)) { try { await native('fs.write', { path: p, content: c }); } catch (e) {} }
  await native('kv.set', { key: 'seeded', value: '1' });
  Explorer.expanded.add('Örnekler');
  await Explorer.refresh();
  return true;
}

// ---------------------------------------------------------------- olay bağlama
function bindUI() {
  // activity bar
  $$('.ab-item[data-view]').forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.suppressClick) return;
    const v = el.dataset.view;
    if (SET.sidebar && SET.view === v) setSidebar(false); else showView(v);
  }));
  $('#abManage').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    Menu.show([
      { label: 'Command Palette...', kb: '⇧⌘P', run: () => openQuickOpen('>') }, '-',
      { label: SET.lang === 'tr' ? 'Ayarlar' : 'Settings', kb: '⌘,', run: () => Commands.run('pref.settings') },
      { label: 'Color Theme', kb: '⌘K ⌘T', run: () => Commands.run('pref.theme') },
      { label: SET.lang === 'tr' ? 'Renk Teması Düzenleyici' : 'Customize Color Theme', run: () => Commands.run('pref.themeEditor') },
      { label: 'Claude…', run: () => Commands.run('agent.settings') },
      { label: 'Gemini · AG…', run: () => Commands.run('ag.settings') },
      { label: SET.lang === 'tr' ? 'Etkinlik Çubuğunu Özelleştir…' : 'Customize Activity Bar…', run: () => Commands.run('view.customizeActivityBar') },
      { label: SET.lang === 'tr' ? 'VS Code\'dan İçe Aktar (profil)…' : 'Import from VS Code…', run: () => Commands.run('vscode.import') },
      { label: SET.lang === 'tr' ? 'Dokunmatik Boyut (butonlar)…' : 'Touch Size…', run: () => Commands.run('pref.touchSize') },
      { label: 'Editor Font Size...', run: () => Commands.run('pref.fontSize') },
      { label: 'Tab Size...', run: () => Commands.run('pref.tabSize') },
      { label: 'Auto Save', checked: SET.autoSave, run: () => Commands.run('file.autoSave') },
      { label: 'Fix Smart Quotes (iPad)', checked: SET.fixQuotes, run: () => Commands.run('pref.smartQuotes') },
      { label: 'Display Language', run: () => Commands.run('pref.language') }, '-',
      { label: 'Keyboard Shortcuts', run: () => showShortcuts() },
      { label: 'Download for Offline Use', run: () => Offline.prepare(false) },
      { label: 'Clear Download Cache', run: () => Commands.run('dev.clearCache') }
    ], r.right + 4, r.top - 260);
  });
  $('#abAccount').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect(); const G = CTX.Git;
    const gh = G && G.user ? [{ label: G.user.login + ' (GitHub)', disabled: true }, { label: SET.lang === 'tr' ? 'GitHub oturumunu kapat' : 'Sign out of GitHub', run: () => G.signOut() }] : [{ label: SET.lang === 'tr' ? 'GitHub ile oturum aç…' : 'Sign in with GitHub…', run: () => G && G.signIn() }];
    Menu.show(gh.concat(['-', { label: 'Claude: ' + (SET.lang === 'tr' ? 'API anahtarı…' : 'API key…'), run: () => Commands.run('agent.settings') }, { label: 'Gemini · AG: ' + (SET.lang === 'tr' ? 'API anahtarı…' : 'API key…'), run: () => Commands.run('ag.settings') }]), r.right + 4, r.top - 110);
  });
  // title bar
  $('#command-center').addEventListener('click', () => openQuickOpen(''));
  const tbTap = (el, fn) => { let t = 0; const run = (e) => { e.preventDefault(); e.stopPropagation(); if (Date.now() - t < 400) return; t = Date.now(); fn(e); syncTitleButtons(); }; el.addEventListener('click', run); el.addEventListener('touchend', run, { passive: false }); };
  tbTap($('#tbToggleSidebar'), () => setSidebar(!SET.sidebar));
  tbTap($('#tbTogglePanel'), () => Panel.toggle());
  tbTap($('#tbToggleAux'), () => { const ai = SET.view === 'claude' || SET.view === 'ag'; if (SET.sidebar && ai) showView(SET.lastNonAI || 'explorer'); else { if (!ai) SET.lastNonAI = SET.view; showView(SET.auxView || 'claude'); } });
  tbTap($('#tbLayout'), (e) => {
    const r = e.currentTarget.getBoundingClientRect(); const tr = SET.lang === 'tr';
    Menu.show([
      { label: tr ? 'Birincil Kenar Çubuğu' : 'Primary Side Bar', kb: '⌘B', checked: SET.sidebar, run: () => { setSidebar(!SET.sidebar); syncTitleButtons(); } },
      { label: tr ? 'Panel' : 'Panel', kb: '⌘J', checked: SET.panel, run: () => { Panel.toggle(); syncTitleButtons(); } },
      { label: tr ? 'Yapay Zekâ Sohbeti (Claude)' : 'AI Chat (Claude)', run: () => showView('claude') },
      { label: tr ? 'Yapay Zekâ Sohbeti (Gemini · AG)' : 'AI Chat (Gemini · AG)', run: () => showView('ag') }, '-',
      { label: tr ? 'Paneli Büyüt' : 'Maximize Panel', checked: document.body.classList.contains('panel-max'), run: () => Panel.toggleMax() },
      { label: 'Minimap', checked: SET.minimap, run: () => Commands.run('view.minimap') },
      { label: tr ? 'Sözcük Kaydırma' : 'Word Wrap', checked: SET.wordWrap === 'on', run: () => Commands.run('view.wordWrap') },
      { label: tr ? 'Yapışkan Kaydırma' : 'Sticky Scroll', checked: SET.stickyScroll, run: () => Commands.run('view.stickyScroll') }, '-',
      { label: tr ? 'Kenar çubuğu genişliğini sıfırla' : 'Reset Side Bar Width', run: () => { SET.sideW = DEFAULTS.sideW; SET.panelH = DEFAULTS.panelH; applyLayout(); saveSettings(); Ed.layout(); } }
    ], r.right - 260, r.bottom + 4);
  });
  $('#navBack').addEventListener('click', () => Tabs.navigate(-1));
  $('#navFwd').addEventListener('click', () => Tabs.navigate(1));
  bindMenubar();
  // explorer
  $('#actNewFile').addEventListener('click', (e) => { e.stopPropagation(); Explorer.inlineCreate(null, false); });
  $('#actNewFolder').addEventListener('click', (e) => { e.stopPropagation(); Explorer.inlineCreate(null, true); });
  $('#actRefresh').addEventListener('click', (e) => { e.stopPropagation(); Explorer.refresh(); });
  $('#actCollapse').addEventListener('click', (e) => { e.stopPropagation(); Explorer.expanded.clear(); Explorer.render(); saveSession(); });
  $('#wsHeader').addEventListener('click', () => { const t = $('#fileTree'); t.classList.toggle('hidden'); $('#wsHeader').classList.toggle('expanded'); $('#wsHeader .twist').className = 'codicon twist codicon-chevron-' + (t.classList.contains('hidden') ? 'right' : 'down'); });
  $('#explorerMore').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); Menu.show([
    { label: 'Open Folder... (iCloud Drive / Dosyalar)', run: () => Workspace.openFolder() },
    { label: 'Open App Folder (On My iPad)', run: () => Workspace.useDefault() }, '-',
    { label: 'Refresh Explorer', run: () => Explorer.refresh() }, { label: 'Collapse Folders', run: () => { Explorer.expanded.clear(); Explorer.render(); } }
  ], r.left, r.bottom + 2); });
  const tree = $('#fileTree');
  tree.addEventListener('click', (e) => {
    if (tree.dataset.suppressClick) return;
    const row = e.target.closest('.row'); if (!row || row.querySelector('input')) return;
    const p = row.dataset.path; if (p == null) return;
    Explorer.selected = p;
    if (Explorer.isDir(p)) Explorer.toggle(p);
    else { Explorer.render(); Tabs.open(p, { preview: true, focus: false }); }
  });
  tree.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.row'); if (!row) return;
    const p = row.dataset.path; if (p && !Explorer.isDir(p)) { const t = Tabs.list.find((x) => x.path === p); if (t) { t.preview = false; Tabs.render(); } }
  });
  bindContext(tree, (x, y, e) => {
    const row = e.target && e.target.closest ? e.target.closest('.row') : null;
    const p = row ? row.dataset.path : '';
    if (p) { Explorer.selected = p; Explorer.render(); }
    Explorer.contextMenu(p || '', x, y);
  });
  tree.addEventListener('keydown', (e) => {
    const s = Explorer.selected; if (s == null) return;
    if (e.key === 'Enter') { e.preventDefault(); Explorer.startRename(s); }
    else if ((e.key === 'Backspace' && e.metaKey) || e.key === 'Delete') { e.preventDefault(); Explorer.remove(s); }
  });
  // editör aksiyonları
  $('#eaRun').addEventListener('click', () => Run.runActive());
  $('#eaRunMore').addEventListener('click', (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); Run.showRunMenu(r.right - 300, r.bottom + 4); });
  $('#eaStop').addEventListener('click', () => Run.stop());
  $('#eaPreview').addEventListener('click', () => MD.toggle());
  $('#eaAskClaude').addEventListener('click', () => askClaudeApp());
  $('#eaMore').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); Menu.show([
    { label: 'Run Code', kb: '⌘↵', run: () => Run.runActive() }, { label: 'Run with Input...', run: () => Run.runActive({ askInput: true }) }, '-',
    { label: 'Close All', run: () => Tabs.closeAll() }, { label: 'Close Saved', run: () => Tabs.list.filter((t) => !t.dirty).forEach((t) => Tabs.close(t)) }, '-',
    { label: 'Word Wrap', checked: SET.wordWrap === 'on', run: () => Commands.run('view.wordWrap') }, { label: 'Minimap', checked: SET.minimap, run: () => Commands.run('view.minimap') },
    { label: 'Format Document', run: () => Commands.run('edit.format') }, { label: 'Share File…', run: () => Commands.run('file.share') }
  ], r.right - 230, r.bottom + 2); });
  // panel
  $$('.ptab').forEach((el) => el.addEventListener('click', () => Panel.show(el.dataset.ptab)));
  $('#paClose').addEventListener('click', () => Panel.setVisible(false));
  $('#paMax').addEventListener('click', () => Panel.toggleMax());
  $('#paClear').addEventListener('click', () => { if (Panel.current === 'terminal') Term.clear(); else if (Panel.current === 'output') Output.clear(); else if (Panel.current === 'problems') Problems.set([]); });
  $('#paNewTerm').addEventListener('click', () => Commands.run('term.new'));
  $('#paStop').addEventListener('click', () => Run.stop());
  // status bar
  $('#sbProblems').addEventListener('click', () => Panel.show('problems'));
  $('#sbLang').addEventListener('click', () => {
    const t = Tabs.active; if (!t || !monaco) return;
    const items = monaco.languages.getLanguages().map((l) => ({ label: (l.aliases && l.aliases[0]) || l.id, desc: '(' + l.id + ')', id: l.id }));
    quickPick(items, { placeholder: tr('Select Language Mode') }).then((it) => { if (it) { monaco.editor.setModelLanguage(t.model, it.id); $('#sbLangText').textContent = it.label; } });
  });
  $('#sbIndent').addEventListener('click', () => Commands.run('pref.tabSize'));
  $('#sbCursor').addEventListener('click', () => openQuickOpen(':'));
  $('#sbRunner').addEventListener('click', () => { const t = Tabs.active; const r = t && langOf(t.path).run; if (r === 'py') Commands.run('run.pyRunner'); else if (r === 'c') Commands.run('run.cRunner'); else Commands.run('run.selectRunner'); });
  $('#sbOffline').addEventListener('click', () => { showView('run'); Offline.update(); });
  $('#sbBell').addEventListener('click', () => notify('info', 'No new notifications', { timeout: 2000 }));
  $('.sb-remote').addEventListener('click', () => quickPick([{ label: 'Open Folder...', run: () => Workspace.openFolder() }, { label: 'Open App Folder (On My iPad)', run: () => Workspace.useDefault() }], { placeholder: 'Select an option to open a Remote Window' }).then((it) => it && it.run()));
  // run view
  $('#runViewBtn').addEventListener('click', () => (Run.running ? Run.stop() : Run.runActive()));
  $('#stdinBox').addEventListener('input', (e) => { SET.stdin = e.target.value; saveSettings(); });
  $('#argsBox').addEventListener('input', (e) => { SET.args = e.target.value; saveSettings(); });
  $('#cflagsBox').addEventListener('input', (e) => { SET.cflags = e.target.value; saveSettings(); });
  $('#runnerSelect').addEventListener('change', (e) => { SET.runner = e.target.value; saveSettings(); Run.updateInfo(); });
  $('#pyRunnerSelect').addEventListener('change', (e) => { SET.pyRunner = e.target.value; saveSettings(); Run.updateInfo(); });
  $('#cRunnerSelect').addEventListener('change', (e) => { SET.cRunner = e.target.value; saveSettings(); Run.updateInfo(); });
  $('#cppRunnerSelect').addEventListener('change', (e) => { SET.cppRunner = e.target.value; saveSettings(); Run.updateInfo(); });
  $('#prepareOfflineBtn').addEventListener('click', () => Offline.prepare(false));
  $('#scmGithub').addEventListener('click', () => { if (CTX.Git && CTX.Git.link) CTX.Git.action('open'); else if (CTX.Git) CTX.Git.signIn(); });
  $$('[data-agent]').forEach((el) => el.addEventListener('click', () => {
    const A = CTX.Agents && CTX.Agents[el.dataset.agent]; if (!A) return;
    ({ new: () => A.newChat(), history: () => A.showHistory(), settings: () => A.openSettings() })[el.dataset.aa]();
  }));
  // search
  const doSearch = debounce(() => Search.run(), 350);
  $('#searchInput').addEventListener('input', doSearch);
  $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') Search.run(); });
  [['optCase', 'case'], ['optWord', 'word'], ['optRegex', 'regex']].forEach(([id, k]) => $('#' + id).addEventListener('click', (e) => { Search.opts[k] = !Search.opts[k]; e.currentTarget.classList.toggle('on', Search.opts[k]); Search.run(); }));
  $('#replaceAllBtn').addEventListener('click', () => Search.replaceAll());
  $('#searchRefresh').addEventListener('click', () => Search.run());
  $('#searchClear').addEventListener('click', () => { $('#searchInput').value = ''; Search.folder = ''; Search.run(); });
  $('#extSearch').addEventListener('input', (e) => renderExtensions(e.target.value));
  $('#petAdd').addEventListener('click', (e) => { e.stopPropagation(); PetsUI.spawn(); });
  $('#petBall').addEventListener('click', (e) => { e.stopPropagation(); X().Pets.throwBall(); });
  $('#petClear').addEventListener('click', (e) => { e.stopPropagation(); X().Pets.removeAll(); });
  $('#petBg').addEventListener('click', (e) => { e.stopPropagation(); PetsUI.chooseBg(); });
  $('#petsHeader').addEventListener('click', () => { SET.petsOpen = !SET.petsOpen; saveSettings(); $('#petsHeader .twist').className = 'codicon twist codicon-chevron-' + (SET.petsOpen ? 'down' : 'right'); PetsUI.apply(); });
  ['outlineHeader', 'timelineHeader'].forEach((id) => $('#' + id).addEventListener('click', () => notify('info', SET.lang === 'tr' ? 'Bu bölüm iPad sürümünde henüz yok.' : 'Not available yet.', { timeout: 2000 })));
  // viewport / klavye
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitViewport); window.visualViewport.addEventListener('scroll', () => { if (window.scrollY) window.scrollTo(0, 0); }); }
  window.addEventListener('resize', fitViewport);
  document.addEventListener('visibilitychange', () => { if (document.hidden) Tabs.saveAll(); });
  window.addEventListener('pagehide', () => Tabs.saveAll());
  bindSashes();
  bindQuickInput();
  bindKeys();
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    const k = e.key, cmd = e.metaKey, sh = e.shiftKey, alt = e.altKey, ctrl = e.ctrlKey;
    const lk = k.length === 1 ? k.toLowerCase() : k;
    let handled = true;
    if (!$('#quickinput').classList.contains('hidden') || !$('#dialog').classList.contains('hidden')) {
      if (k === 'Escape') { QI.close(); $('#dialog').classList.add('hidden'); } return;
    }
    if (ctrl && alt && !cmd && e.code === 'KeyN') { e.preventDefault(); Run.runActive(); return;
    }
    if (!$('#menuLayer').classList.contains('hidden') && k === 'Escape') { Menu.hide(); return; }
    if (cmd && sh && lk === 'p' || k === 'F1') openQuickOpen('>');
    else if (cmd && !sh && lk === 'p') openQuickOpen('');
    else if (cmd && !sh && alt && lk === 's') Tabs.saveAll();
    else if (cmd && !sh && lk === 's') Tabs.save();
    else if (cmd && !sh && lk === 'b') setSidebar(!SET.sidebar);
    else if (cmd && !sh && lk === 'j') Panel.toggle();
    else if (ctrl && (k === '`' || e.code === 'Backquote')) Commands.run(sh ? 'term.new' : 'view.terminal');
    else if ((cmd && k === 'Enter') || (k === 'F5' && !sh)) Run.runActive();
    else if (k === 'F5' && sh) Run.stop();
    else if (cmd && !sh && lk === 'w') Tabs.close(Tabs.active);
    else if (cmd && !sh && lk === 'n') Explorer.inlineCreate(null, false);
    else if (cmd && sh && lk === 'e') showView('explorer');
    else if (cmd && sh && lk === 'f') showView('search');
    else if (cmd && sh && lk === 'd') showView('run');
    else if (cmd && sh && lk === 'x') showView('extensions');
    else if (cmd && sh && lk === 'm') Panel.show('problems');
    else if (cmd && sh && lk === 'u') Panel.show('output');
    else if (cmd && sh && lk === 'v') MD.toggle();
    else if (cmd && !sh && lk === 'e' && Tabs.active && /\.(md|markdown)$/i.test(Tabs.active.path)) { e.preventDefault(); MD.toggle(); }
    else if (cmd && (k === '=' || k === '+')) Commands.run('view.zoomIn');
    else if (cmd && k === '-') Commands.run('view.zoomOut');
    else if (cmd && k === '0') Commands.run('view.zoomReset');
    else if (ctrl && k === 'Tab') Tabs.next(sh ? -1 : 1);
    else if (cmd && alt && (k === 'ArrowRight' || k === 'ArrowLeft')) Tabs.next(k === 'ArrowRight' ? 1 : -1);
    else if (ctrl && lk === 'g' && !monaco) openQuickOpen(':');
    else if (cmd && !sh && lk === 'k' && document.activeElement === Term.input) Term.clear();
    else if (alt && lk === 'z' && !cmd) Commands.run('view.wordWrap');
    else if (cmd && lk === ',') Commands.run('pref.settings');
    else if (k === 'Escape' && MD.showing) MD.toggle(false);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

// ---------------------------------------------------------------- açılış
function touchSize() { return SET.touchSize == null ? (IS_TOUCH ? 1 : 0) : +SET.touchSize; }
function applyTouchSize() {
  document.body.classList.remove('tz-1', 'tz-2');
  const z = touchSize(); if (z) document.body.classList.add('tz-' + z);
  window.dispatchEvent(new Event('resize'));
}
async function boot() {
  if (IS_TOUCH) document.body.classList.add('touch');
  if (IS_NATIVE) document.body.classList.add('native-menu');
  window.VSC = { cmd: (id) => { if (!$('#quickinput').classList.contains('hidden') && id !== 'palette' && id !== 'quickOpen') QI.close(); Menu.hide(); Commands.run(id); } };
  if (!IS_NATIVE) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CODICON_CSS; document.head.appendChild(l); }
  fitViewport();
  await loadSettings();
  applyTouchSize();
  if (SET.ext && SET.ext['ms-ceintl.vscode-language-pack-tr'] === false) SET.lang = 'en';
  window.VSC_LANG = SET.lang;
  document.documentElement.lang = SET.lang;
  if (X()) X().translateDOM(document.body);
  Object.assign(CTX, {
    SET, saveSettings, Commands, Exts, IS_TOUCH, showShortcuts, syncRun: () => syncRunControls(), applyTouch: () => applyTouchSize(), monaco: () => monaco, editor: () => editor, QI, t, Explorer, Tabs, notify, quickPick, inputBox, dialog, native, esc, Menu,
    CDN, loadScript, iconHTML, openDiff, langOf, extOf, basename, dirname, Run, Term, Panel, Ed, Problems, showView, IS_NATIVE, MD,
    onThemeChanged: () => { if (typeof PetsUI !== 'undefined' && document.getElementById('petsStage')) PetsUI.bg(); },
    applyAll: () => { applyTheme(); Ed.options(); applyLayout(); },
    onGitStatus: (m) => { Explorer.gitDeco = m && Object.keys(m).length ? m : null; Explorer.render(); }
  });
  (window.VSCModules || []).forEach((f) => { try { f(CTX); } catch (e) { console.error('module', e); } });
  if (CTX.Themes) await CTX.Themes.load();
  applyTheme();
  registerCommands();
  if (X()) await Promise.all([X().Material.load(), X().Pets.load(), Exts.load()]);
  bindUI();
  if (CTX.AB) { CTX.AB.apply(); CTX.AB.bind(); }
  // iPadOS / scrollIntoView sabit düzenli kapları kaydırmasın (sekme çubuğu kaybolmasın)
  // overflow:hidden diyorsun, Safari yine kaydırıyor. Ne diyeyim la, her scroll'da sıfırla geç
  ['#workbench', '#main', '#editor-and-panel', '#editor-part'].forEach((sel) => { const el = $(sel); if (el) el.addEventListener('scroll', () => { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } }); });
  applyLayout();
  syncRunControls();
  renderExtensions();
  PetsUI.apply();
  // uygulama ikonu: iPadOS'taki gerçek durumu ayara yansıt (yeniden kurulumda iOS varsayılana döner)
  native('app.icon.get').then((v) => { if (v && SET.appIcon !== v) { SET.appIcon = v; saveSettings(); } }).catch(() => {});
  Term.init();
  const wantPanel = SET.panel, wantSide = SET.sidebar;
  Panel.show(Panel.current);
  if (!wantPanel) Panel.setVisible(false);
  if (wantSide) showView(SET.view || 'explorer'); else setSidebar(false);

  try { Workspace.set(await native('ws.info')); } catch (e) {}
  let session = null;
  try { const s = await native('kv.get', { key: 'session' }); if (s) session = JSON.parse(s); } catch (e) {}
  if (session) { (session.expanded || []).forEach((p) => Explorer.expanded.add(p)); Term.cwd = session.cwd || ''; Term.updatePrompt(); }
  await Explorer.refresh();
  const seeded = await seedIfNeeded();

  $('#loadingText').textContent = 'Editör yükleniyor… (ilk açılışta ~5 MB indirilir)';
  try {
    monaco = await loadMonaco();
    setupMonaco();
  } catch (e) {
    monaco = null;
    console.error(e);
    setupFallback();
    notify('warning', 'VS Code editörü indirilemedi (internet yok?). Basit editör kullanılıyor. İnternete bağlanınca Developer: Reload Window ile tekrar dene.', { timeout: 15000, actions: [{ label: 'Tekrar dene', run: () => location.reload() }] });
  }
  applyTheme();
  $('#loadingOverlay').classList.add('gone');
  setTimeout(() => $('#loadingOverlay').remove(), 400);

  if (session && session.tabs) {
    for (const t of session.tabs) if (Explorer.exists(t.path)) await Tabs.open(t.path, { preview: false, focus: false });
    const a = Tabs.list.find((t) => t.path === session.active);
    if (a) Tabs.activate(a, false);
  }
  if (seeded) { await Tabs.open('Örnekler/OKU.md', { preview: false, focus: false }); MD.toggle(true); showWelcome(); }
  Tabs.render(); Tabs.updateChrome();
  Problems.render();
  fitViewport();
  if (await Clang.detect()) { syncRunControls(); setTimeout(() => Clang.preload(), 4000); }
  if (CTX.Git) CTX.Git.init();
  if (CTX.Agents) { CTX.Agents.claude.init(); CTX.Agents.ag.init(); }
  if (CTX.Esp) { CTX.Esp.init(); $('#espGuide').addEventListener('click', () => CTX.Esp.showGuide('arduino')); }

  // ilk açılıştan sonra arka planda çevrimdışı paketleri indir
  setTimeout(async () => {
    const ready = await Offline.update();
    if (!ready && IS_NATIVE && monaco) {
      const asked = await native('kv.get', { key: 'offlineAsked' });
      if (!asked) {
        native('kv.set', { key: 'offlineAsked', value: '1' });
        notify('info', 'Sınav haftası gibi internetsiz anlar için editör + Python (~15 MB) şimdi indirilsin mi?', { timeout: 0, actions: [{ label: 'İndir', run: () => Offline.prepare(false) }, { label: 'Sonra' }] });
      } else Offline.prepare(true);
    }
  }, 2500);
}

window.addEventListener('error', (e) => { console.error(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });
document.addEventListener('DOMContentLoaded', boot);
})();
