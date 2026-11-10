/* ==========================================================================
   VS iPad – renk temaları
   Web/ext/themes.json : Mac'teki VS Code'un yerleşik temaları (+ C/C++ temaları)
   VS Code tema JSON'u → workbench CSS değişkenleri + Monaco teması
   Özelleştirme: SET.themeCustom[temaId] = { colors: {...}, tokens: {...} }
   İçe aktarma: çalışma alanındaki herhangi bir VS Code tema .json dosyası
   ========================================================================== */
(function () {
'use strict';
window.VSCModules = window.VSCModules || [];

// workbench CSS değişkeni ← VS Code renk anahtarları (ilk bulunan)
const CSS_MAP = {
  '--accent': ['button.background', 'focusBorder', 'activityBarBadge.background'],
  '--accent-hover': ['button.hoverBackground', 'button.background'],
  '--fg': ['foreground', 'sideBar.foreground', 'editor.foreground'],
  '--fg-dim': ['descriptionForeground', 'tab.inactiveForeground', 'disabledForeground'],
  '--fg-bright': ['tab.activeForeground', 'editor.foreground', 'foreground'],
  '--border': ['sideBar.border', 'panel.border', 'editorGroup.border', 'contrastBorder'],
  '--title-bg': ['titleBar.activeBackground', 'sideBar.background', 'editor.background'],
  '--activity-bg': ['activityBar.background', 'sideBar.background'],
  '--activity-fg': ['activityBar.foreground', 'foreground'],
  '--activity-inactive': ['activityBar.inactiveForeground'],
  '--side-bg': ['sideBar.background', 'editor.background'],
  '--editor-bg': ['editor.background'],
  '--tabs-bg': ['editorGroupHeader.tabsBackground', 'sideBar.background', 'editor.background'],
  '--tab-active-bg': ['tab.activeBackground', 'editor.background'],
  '--tab-inactive-bg': ['tab.inactiveBackground', 'editorGroupHeader.tabsBackground'],
  '--tab-active-top': ['tab.activeBorderTop'],
  '--tab-inactive-fg': ['tab.inactiveForeground'],
  '--panel-bg': ['panel.background', 'editor.background'],
  '--status-bg': ['statusBar.background'],
  '--status-fg': ['statusBar.foreground'],
  '--status-border': ['statusBar.border'],
  '--status-running': ['statusBar.debuggingBackground'],
  '--remote-bg': ['statusBarItem.remoteBackground', 'button.background'],
  '--list-hover': ['list.hoverBackground'],
  '--list-active': ['list.inactiveSelectionBackground', 'list.activeSelectionBackground'],
  '--list-focus-active': ['list.activeSelectionBackground', 'list.focusBackground'],
  '--input-bg': ['input.background'],
  '--input-border': ['input.border'],
  '--placeholder': ['input.placeholderForeground'],
  '--widget-bg': ['quickInput.background', 'editorWidget.background'],
  '--widget-border': ['widget.border', 'editorWidget.border', 'contrastBorder'],
  '--menu-bg': ['menu.background', 'editorWidget.background'],
  '--menu-border': ['menu.border', 'editorWidget.border'],
  '--menu-sel': ['menu.selectionBackground', 'list.activeSelectionBackground'],
  '--cc-bg': ['commandCenter.background', 'input.background'],
  '--cc-border': ['commandCenter.border', 'input.border'],
  '--badge-bg': ['badge.background'],
  '--badge-fg': ['badge.foreground'],
  '--term-fg': ['terminal.foreground', 'editor.foreground'],
  '--error': ['editorError.foreground', 'errorForeground'],
  '--warning': ['editorWarning.foreground'],
  '--info': ['editorInfo.foreground'],
  '--scroll': ['scrollbarSlider.background']
};
// tema bir değeri vermezse kullanılacak taban değerler (VS Code varsayılanları)
const BASE = {
  dark: { '--accent': '#0e639c', '--accent-hover': '#1177bb', '--fg': '#cccccc', '--fg-dim': '#9d9d9d', '--fg-bright': '#ffffff', '--border': 'transparent', '--title-bg': '#3c3c3c', '--activity-bg': '#333333', '--activity-fg': '#ffffff', '--activity-inactive': 'rgba(255,255,255,0.4)', '--side-bg': '#252526', '--editor-bg': '#1e1e1e', '--tabs-bg': '#252526', '--tab-active-bg': '#1e1e1e', '--tab-inactive-bg': '#2d2d2d', '--tab-active-top': 'transparent', '--tab-inactive-fg': 'rgba(255,255,255,0.5)', '--panel-bg': '#1e1e1e', '--status-bg': '#007acc', '--status-fg': '#ffffff', '--status-border': 'transparent', '--status-running': '#cc6633', '--remote-bg': '#16825d', '--list-hover': '#2a2d2e', '--list-active': '#37373d', '--list-focus-active': '#04395e', '--input-bg': '#3c3c3c', '--input-border': 'transparent', '--placeholder': '#a6a6a6', '--widget-bg': '#252526', '--widget-border': '#454545', '--menu-bg': '#252526', '--menu-border': '#454545', '--menu-sel': '#04395e', '--cc-bg': 'rgba(255,255,255,0.05)', '--cc-border': 'rgba(128,128,128,0.35)', '--badge-bg': '#4d4d4d', '--badge-fg': '#ffffff', '--term-fg': '#cccccc', '--error': '#f14c4c', '--warning': '#cca700', '--info': '#3794ff', '--scroll': 'rgba(121,121,121,0.4)', '--shadow': 'rgba(0,0,0,0.36)' },
  light: { '--accent': '#007acc', '--accent-hover': '#0062a3', '--fg': '#616161', '--fg-dim': '#717171', '--fg-bright': '#333333', '--border': 'transparent', '--title-bg': '#dddddd', '--activity-bg': '#2c2c2c', '--activity-fg': '#ffffff', '--activity-inactive': 'rgba(255,255,255,0.4)', '--side-bg': '#f3f3f3', '--editor-bg': '#ffffff', '--tabs-bg': '#f3f3f3', '--tab-active-bg': '#ffffff', '--tab-inactive-bg': '#ececec', '--tab-active-top': 'transparent', '--tab-inactive-fg': 'rgba(51,51,51,0.7)', '--panel-bg': '#ffffff', '--status-bg': '#007acc', '--status-fg': '#ffffff', '--status-border': 'transparent', '--status-running': '#cc6633', '--remote-bg': '#16825d', '--list-hover': '#e8e8e8', '--list-active': '#e4e6f1', '--list-focus-active': '#0060c0', '--input-bg': '#ffffff', '--input-border': '#cecece', '--placeholder': '#767676', '--widget-bg': '#f3f3f3', '--widget-border': '#c8c8c8', '--menu-bg': '#ffffff', '--menu-border': '#cecece', '--menu-sel': '#0060c0', '--cc-bg': 'rgba(0,0,0,0.05)', '--cc-border': 'rgba(128,128,128,0.35)', '--badge-bg': '#c4c4c4', '--badge-fg': '#333333', '--term-fg': '#333333', '--error': '#e51400', '--warning': '#bf8803', '--info': '#1a85ff', '--scroll': 'rgba(100,100,100,0.4)', '--shadow': 'rgba(0,0,0,0.16)' }
};
// Monaco (Monarch) token türü → TextMate kapsamları (öncelik sırasıyla)
const TOKEN_SCOPES = {
  comment: ['comment'], 'comment.doc': ['comment.block.documentation', 'comment'],
  string: ['string'], 'string.escape': ['constant.character.escape', 'string'], 'string.sql': ['string'], 'string.invalid': ['invalid', 'string'],
  number: ['constant.numeric'], 'number.float': ['constant.numeric'], 'number.hex': ['constant.numeric'], 'number.octal': ['constant.numeric'], 'number.binary': ['constant.numeric'],
  keyword: ['keyword', 'storage.type'], 'keyword.control': ['keyword.control'], 'keyword.directive': ['keyword.control.directive', 'meta.preprocessor', 'keyword.control'],
  'keyword.directive.include': ['keyword.control.directive', 'meta.preprocessor', 'keyword.control'], 'keyword.flow': ['keyword.control'],
  type: ['entity.name.type', 'support.type', 'storage.type'], 'type.identifier': ['entity.name.type', 'entity.name.class', 'support.class'],
  identifier: ['variable', 'variable.other'], variable: ['variable'], 'variable.predefined': ['variable.language', 'support.variable', 'variable'],
  constant: ['constant.language', 'constant'], predefined: ['support.function', 'entity.name.function'],
  delimiter: ['punctuation', 'meta.brace'], operator: ['keyword.operator'], 'delimiter.bracket': ['punctuation', 'meta.brace'],
  annotation: ['meta.decorator', 'storage.type.annotation', 'entity.name.function.decorator'], regexp: ['string.regexp'],
  tag: ['entity.name.tag'], 'attribute.name': ['entity.other.attribute-name'], 'attribute.value': ['string'], 'metatag': ['entity.name.tag'],
  'keyword.md': ['markup.heading', 'entity.name.section'], strong: ['markup.bold'], emphasis: ['markup.italic'], 'variable.md': ['markup.inline.raw', 'markup.raw'], 'string.link.md': ['markup.underline.link'],
  'key.json': ['support.type.property-name.json', 'support.type.property-name'], 'string.key.json': ['support.type.property-name.json', 'support.type.property-name'], 'string.value.json': ['string'],
  invalid: ['invalid'], 'emphasis.sql': ['support.function'], 'operator.sql': ['keyword.operator'], 'predefined.sql': ['support.function']
};
// özelleştirme ekranındaki düzenlenebilir renkler
const EDITABLE_UI = [
  ['editor.background', 'Editör arka planı'], ['editor.foreground', 'Editör yazı rengi'], ['editor.lineHighlightBackground', 'Geçerli satır vurgusu'],
  ['editor.selectionBackground', 'Seçim'], ['editorCursor.foreground', 'İmleç'], ['editorLineNumber.foreground', 'Satır numaraları'],
  ['sideBar.background', 'Kenar çubuğu'], ['activityBar.background', 'Etkinlik çubuğu'], ['titleBar.activeBackground', 'Başlık çubuğu'],
  ['editorGroupHeader.tabsBackground', 'Sekme çubuğu'], ['tab.activeBackground', 'Etkin sekme'], ['panel.background', 'Panel (terminal)'],
  ['terminal.foreground', 'Terminal yazısı'], ['statusBar.background', 'Durum çubuğu'], ['statusBar.foreground', 'Durum çubuğu yazısı'],
  ['button.background', 'Vurgu / düğme rengi'], ['focusBorder', 'Odak çerçevesi'], ['list.activeSelectionBackground', 'Liste seçimi'], ['foreground', 'Genel yazı rengi']
];
const EDITABLE_TOKENS = [
  ['keyword', 'Anahtar kelimeler (int, if, return)'], ['keyword.control', 'Akış kontrolü (if, for, while)'], ['keyword.directive', 'Önişlemci (#include)'],
  ['string', 'Metin (string)'], ['comment', 'Yorumlar'], ['number', 'Sayılar'], ['type', 'Tipler'], ['identifier', 'Değişkenler'],
  ['predefined', 'Fonksiyonlar / hazır isimler'], ['operator', 'Operatörler'], ['delimiter', 'Noktalama'], ['constant', 'Sabitler (true, NULL)']
];

function stripJsonc(s) {
  let out = '', i = 0, ins = false;
  while (i < s.length) {
    const c = s[i];
    if (ins) { out += c; if (c === '\\') { out += s[i + 1]; i += 2; continue; } if (c === '"') ins = false; i++; continue; }
    if (c === '"') { ins = true; out += c; i++; continue; }
    if (s.startsWith('//', i)) { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (s.startsWith('/*', i)) { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
const isHex = (v) => typeof v === 'string' && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
const norm6 = (v) => { if (!isHex(v)) return null; let h = v.slice(1); if (h.length <= 4) h = h.split('').map((c) => c + c).join(''); return '#' + h.slice(0, 6).toLowerCase(); };
function toCss(v) {
  if (!isHex(v)) return v;
  let h = v.slice(1); if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) { const a = parseInt(h.slice(6), 16) / 255; return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a.toFixed(3)})`; }
  return '#' + h;
}
function luminance(hex) { const h = norm6(hex); if (!h) return 0; const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

// TextMate seçici eşleştirme: en özel (en uzun) seçici kazanır, eşitlikte sonraki kural
function buildScopeIndex(tokenColors) {
  const rules = [];
  (tokenColors || []).forEach((tc, order) => {
    if (!tc || !tc.settings) return;
    let scopes = tc.scope;
    if (!scopes) { rules.push({ sel: '', order, s: tc.settings }); return; }
    if (typeof scopes === 'string') scopes = scopes.split(',');
    for (let sc of scopes) {
      sc = String(sc).trim();
      if (!sc) continue;
      const last = sc.split(/\s+/).pop(); // "source.c keyword" → "keyword" (yaklaşık)
      rules.push({ sel: last, order, s: tc.settings, desc: sc.includes(' ') });
    }
  });
  return (scope) => {
    let best = null;
    for (const r of rules) {
      if (!r.sel) continue;
      if (scope === r.sel || scope.startsWith(r.sel + '.')) {
        const score = r.sel.length * 10 - (r.desc ? 5 : 0);
        if (!best || score > best.score || (score === best.score && r.order >= best.order)) best = { score, order: r.order, s: r.s };
      }
    }
    return best ? best.s : null;
  };
}

const Themes = {
  list: [], ctx: null,
  async load() {
    try { this.list = await (await fetch('ext/themes.json')).json(); } catch (e) { this.list = []; }
    return this.list.length;
  },
  all() { return this.list.concat((this.ctx.SET.userThemes || [])); },
  find(id) { return this.all().find((t) => t.id === id) || this.all().find((t) => t.id === 'Dark Modern') || this.all()[0]; },
  kind(t) { return t.type === 'vs' || t.type === 'hc-light' ? 'light' : 'dark'; },
  label(t) { return this.ctx.SET.lang === 'tr' ? (t.labelTr || t.label) : t.label; },
  effective(t) {
    const cu = (this.ctx.SET.themeCustom || {})[t.id] || {};
    return { colors: Object.assign({}, t.colors, cu.colors || {}), tokens: cu.tokens || {}, tokenColors: t.tokenColors || [] };
  },
  // ---- uygula
  apply(id) {
    const t = this.find(id);
    if (!t) return null;
    const eff = this.effective(t);
    const kind = this.kind(t);
    const vars = Object.assign({}, BASE[kind]);
    for (const [v, keys] of Object.entries(CSS_MAP)) {
      for (const k of keys) { if (eff.colors[k]) { vars[v] = toCss(eff.colors[k]); break; } }
    }
    if (t.type && t.type.startsWith('hc')) { vars['--border'] = toCss(eff.colors.contrastBorder || (kind === 'dark' ? '#6fc3df' : '#0f4a85')); }
    const body = document.body;
    body.classList.remove('theme-dark-modern', 'theme-dark-plus', 'theme-light-modern');
    body.classList.add(kind === 'light' ? 'theme-light-modern' : 'theme-dark-modern');
    body.dataset.themeKind = kind;
    for (const [k, v] of Object.entries(vars)) body.style.setProperty(k, v);
    document.documentElement.style.background = vars['--title-bg'];
    if (this.ctx.SET.chromeSync !== false) try { this.ctx.native('app.chrome', { bg: String(vars['--title-bg'] || ''), dark: kind !== 'light' }); } catch (e) {}
    const monaco = this.ctx.monaco();
    if (monaco) {
      monaco.editor.defineTheme('vsc-theme', this.monacoTheme(t, eff));
      monaco.editor.setTheme('vsc-theme');
    }
    return t;
  },
  monacoTheme(t, eff) {
    const base = t.type === 'hc-black' ? 'hc-black' : t.type === 'hc-light' ? 'hc-light' : t.type === 'vs' ? 'vs' : 'vs-dark';
    const colors = {};
    for (const [k, v] of Object.entries(eff.colors)) if (isHex(v)) colors[k] = v.length === 4 || v.length === 5 ? norm6(v) : v;
    const lookup = buildScopeIndex(eff.tokenColors);
    const rules = [];
    const fg = norm6(eff.colors['editor.foreground']);
    if (fg) rules.push({ token: '', foreground: fg.slice(1) });
    for (const [tok, scopes] of Object.entries(TOKEN_SCOPES)) {
      let s = null;
      for (const sc of scopes) { s = lookup(sc); if (s && (s.foreground || s.fontStyle)) break; }
      const custom = eff.tokens[tok] || (tok.includes('.') ? null : null);
      const rule = { token: tok };
      const col = custom || (s && s.foreground);
      if (col && norm6(col)) rule.foreground = norm6(col).slice(1);
      if (s && s.fontStyle != null) rule.fontStyle = s.fontStyle;
      if (rule.foreground || rule.fontStyle != null) rules.push(rule);
    }
    // özel token renkleri, alt türlere de yayılsın
    for (const [tok, col] of Object.entries(eff.tokens)) {
      if (!norm6(col)) continue;
      for (const k of Object.keys(TOKEN_SCOPES)) if (k === tok || k.startsWith(tok + '.')) {
        const r = rules.find((x) => x.token === k);
        if (r) r.foreground = norm6(col).slice(1); else rules.push({ token: k, foreground: norm6(col).slice(1) });
      }
    }
    return { base, inherit: true, rules, colors };
  },
  // ---- seçici (canlı önizleme)
  pick() {
    const C = this.ctx, prev = C.SET.theme;
    const groups = { light: [], dark: [], hc: [] };
    for (const t of this.all()) (t.type && t.type.startsWith('hc') ? groups.hc : groups[this.kind(t)]).push(t);
    const items = [];
    const sep = C.SET.lang === 'tr' ? { light: 'açık temalar', dark: 'koyu temalar', hc: 'yüksek karşıtlıklı temalar' } : { light: 'light themes', dark: 'dark themes', hc: 'high contrast themes' };
    for (const g of ['light', 'dark', 'hc']) groups[g].forEach((t, i) => items.push({ label: this.label(t), desc: t.label !== this.label(t) ? t.label : (t.user ? (C.SET.lang === 'tr' ? 'içe aktarılan' : 'imported') : ''), id: t.id, sep: i === 0 ? sep[g] : null, kb: t.id === prev ? '✓' : '' }));
    const extra = [{ label: C.SET.lang === 'tr' ? '🎨 Geçerli temayı özelleştir…' : '🎨 Customize current theme…', act: 'custom' }, { label: C.SET.lang === 'tr' ? '⬆︎ JSON dosyasından tema içe aktar…' : '⬆︎ Import theme from JSON file…', act: 'import' }];
    extra[0].sep = C.SET.lang === 'tr' ? 'diğer' : 'more';
    C.QI.open({
      placeholder: C.t('Select Color Theme') + (C.SET.lang === 'tr' ? ' (yukarı/aşağı ile önizleme)' : ' (up/down to preview)'),
      items: items.concat(extra),
      onActive: (it) => { if (it && it.id) { this.apply(it.id); } },
      onAccept: (it) => {
        if (!it) { this.apply(prev); return; }
        if (it.act === 'custom') { this.apply(prev); this.openEditor(); return; }
        if (it.act === 'import') { this.apply(prev); this.importJson(); return; }
        C.SET.theme = it.id; C.saveSettings(); this.apply(it.id); C.onThemeChanged && C.onThemeChanged();
      },
      onCancel: () => this.apply(prev)
    });
  },
  // ---- JSON içe aktarma
  async importJson() {
    const C = this.ctx;
    const files = C.Explorer.files().filter((p) => /\.json$/i.test(p));
    if (!files.length) { C.notify('info', C.SET.lang === 'tr' ? 'Çalışma alanında .json tema dosyası yok. Bir VS Code temasının JSON dosyasını Dosyalar uygulamasıyla klasöre kopyala.' : 'No .json files in workspace.'); return; }
    const it = await C.quickPick(files.map((p) => ({ label: p.split('/').pop(), desc: p, path: p })), { placeholder: C.SET.lang === 'tr' ? 'VS Code tema JSON dosyasını seç' : 'Select a VS Code theme JSON' });
    if (!it) return;
    try {
      const raw = (await C.native('fs.read', { path: it.path })).content;
      const j = stripJsonc(raw);
      if (!j.colors && !j.tokenColors) throw new Error(C.SET.lang === 'tr' ? 'Bu dosyada "colors" veya "tokenColors" yok' : 'not a theme file');
      const name = j.name || it.label.replace(/\.json$/i, '');
      const type = j.type === 'light' ? 'vs' : j.type === 'hc' || j.type === 'hcDark' ? 'hc-black' : j.type === 'hcLight' ? 'hc-light' : (luminance((j.colors || {})['editor.background'] || '#1e1e1e') > 0.5 ? 'vs' : 'vs-dark');
      const tc = Array.isArray(j.tokenColors) ? j.tokenColors : [];
      const th = { id: 'user:' + name, label: name, labelTr: name, type, colors: j.colors || {}, tokenColors: tc, user: true };
      C.SET.userThemes = (C.SET.userThemes || []).filter((x) => x.id !== th.id).concat([th]);
      C.SET.theme = th.id; C.saveSettings(); this.apply(th.id);
      C.notify('success', (C.SET.lang === 'tr' ? 'Tema içe aktarıldı: ' : 'Theme imported: ') + name);
    } catch (e) { C.notify('error', (C.SET.lang === 'tr' ? 'Tema okunamadı: ' : 'Cannot read theme: ') + (e.message || e)); }
  },
  // ---- özelleştirme düzenleyicisi (sanal sekme)
  openEditor() {
    const C = this.ctx;
    const tr = C.SET.lang === 'tr';
    C.Tabs.openVirtual('theme-editor', tr ? 'Renk Teması Düzenleyici' : 'Color Theme Editor', '<i class="codicon codicon-symbol-color"></i>', (root) => this.renderEditor(root));
  },
  renderEditor(root) {
    const C = this.ctx, tr = C.SET.lang === 'tr', esc = C.esc;
    const t = this.find(C.SET.theme);
    const eff = this.effective(t);
    const lookup = buildScopeIndex(t.tokenColors || []);
    const cu = ((C.SET.themeCustom || {})[t.id]) || { colors: {}, tokens: {} };
    const tokenColor = (tok) => {
      if (cu.tokens && cu.tokens[tok]) return cu.tokens[tok];
      for (const sc of TOKEN_SCOPES[tok] || []) { const s = lookup(sc); if (s && s.foreground) return s.foreground; }
      return eff.colors['editor.foreground'] || (this.kind(t) === 'light' ? '#000000' : '#d4d4d4');
    };
    const uiColor = (k) => eff.colors[k] || '';
    const row = (kind, key, label, val, changed) => `<div class="te-row" data-kind="${kind}" data-key="${esc(key)}"><label>${esc(label)}<span class="dim"> · ${esc(key)}</span></label><div class="te-ctl"><input type="color" value="${norm6(val) || '#000000'}"><input type="text" class="te-hex" value="${esc(val || '')}" spellcheck="false" autocapitalize="off" placeholder="${tr ? 'tema varsayılanı' : 'theme default'}"><button class="te-reset btn-mini secondary" ${changed ? '' : 'disabled'} title="${tr ? 'Sıfırla' : 'Reset'}">↺</button></div></div>`;
    root.innerHTML = `
      <div class="te-head">
        <h2>${tr ? 'Renk Teması Düzenleyici' : 'Color Theme Editor'}</h2>
        <div class="te-theme"><span class="dim">${tr ? 'Tema:' : 'Theme:'}</span> <b>${esc(this.label(t))}</b>
          <button class="btn-secondary te-pick">${tr ? 'Tema değiştir…' : 'Change theme…'}</button>
          <button class="btn-secondary te-saveas">${tr ? 'Yeni tema olarak kaydet…' : 'Save as new theme…'}</button>
          <button class="btn-secondary te-export">${tr ? 'JSON olarak dışa aktar' : 'Export JSON'}</button>
          <button class="btn-secondary te-resetall">${tr ? 'Tüm değişiklikleri sıfırla' : 'Reset all'}</button></div>
        <p class="dim">${tr ? 'Değişiklikler anında uygulanır ve bu temaya kaydedilir (VS Code\'daki workbench.colorCustomizations / editor.tokenColorCustomizations gibi).' : 'Changes apply instantly and are saved for this theme.'}</p>
      </div>
      <div class="te-preview"><pre><span class="tp-directive">#include</span> <span class="tp-string">&lt;stdio.h&gt;</span>
<span class="tp-comment">// Örnek kod önizlemesi</span>
<span class="tp-keyword">int</span> <span class="tp-predefined">main</span>(<span class="tp-keyword">void</span>) {
    <span class="tp-keyword">int</span> <span class="tp-identifier">toplam</span> <span class="tp-operator">=</span> <span class="tp-number">0</span>;
    <span class="tp-control">for</span> (<span class="tp-keyword">int</span> <span class="tp-identifier">i</span> <span class="tp-operator">=</span> <span class="tp-number">1</span>; <span class="tp-identifier">i</span> <span class="tp-operator">&lt;=</span> <span class="tp-number">10</span>; <span class="tp-identifier">i</span><span class="tp-operator">++</span>) <span class="tp-identifier">toplam</span> <span class="tp-operator">+=</span> <span class="tp-identifier">i</span>;
    <span class="tp-predefined">printf</span>(<span class="tp-string">"Toplam = %d\\n"</span>, <span class="tp-identifier">toplam</span>);
    <span class="tp-control">return</span> <span class="tp-number">0</span>;
}</pre></div>
      <h3>${tr ? 'Söz dizimi renkleri' : 'Syntax colors'}</h3>
      <div class="te-grid">${EDITABLE_TOKENS.map(([k, l]) => row('token', k, tr ? l : k, tokenColor(k), !!(cu.tokens && cu.tokens[k]))).join('')}</div>
      <h3>${tr ? 'Arayüz renkleri' : 'Workbench colors'}</h3>
      <div class="te-grid">${EDITABLE_UI.map(([k, l]) => row('color', k, tr ? l : k, uiColor(k), !!(cu.colors && cu.colors[k]))).join('')}</div>
      <h3>${tr ? 'Gelişmiş: herhangi bir renk anahtarı' : 'Advanced: any color key'}</h3>
      <div class="te-adv"><input type="text" class="te-advkey" placeholder="editorBracketHighlight.foreground1" spellcheck="false" autocapitalize="off"><input type="color" class="te-advcol" value="#ffd700"><button class="btn-primary te-advset">${tr ? 'Uygula' : 'Apply'}</button></div>`;
    const paint = () => {
      const pv = root.querySelector('.te-preview');
      const e2 = this.effective(t);
      pv.style.background = toCss(e2.colors['editor.background'] || (this.kind(t) === 'light' ? '#fff' : '#1e1e1e'));
      pv.style.color = toCss(e2.colors['editor.foreground'] || '');
      const map = { 'tp-directive': 'keyword.directive', 'tp-string': 'string', 'tp-comment': 'comment', 'tp-keyword': 'keyword', 'tp-predefined': 'predefined', 'tp-identifier': 'identifier', 'tp-operator': 'operator', 'tp-number': 'number', 'tp-control': 'keyword.control' };
      for (const [cls, tok] of Object.entries(map)) pv.querySelectorAll('.' + cls).forEach((el) => { el.style.color = toCss(tokenColor(tok)); });
    };
    const save = (kind, key, val) => {
      const all = Object.assign({}, C.SET.themeCustom || {});
      const c = all[t.id] = Object.assign({ colors: {}, tokens: {} }, all[t.id] || {});
      c.colors = Object.assign({}, c.colors); c.tokens = Object.assign({}, c.tokens);
      const bucket = kind === 'token' ? c.tokens : c.colors;
      if (val) bucket[key] = val; else delete bucket[key];
      C.SET.themeCustom = all; cu.colors = c.colors; cu.tokens = c.tokens;
      C.saveSettings(); this.apply(t.id); paint();
    };
    root.querySelectorAll('.te-row').forEach((r) => {
      const kind = r.dataset.kind, key = r.dataset.key;
      const col = r.querySelector('input[type=color]'), hex = r.querySelector('.te-hex'), rs = r.querySelector('.te-reset');
      col.addEventListener('input', () => { hex.value = col.value; rs.disabled = false; save(kind, key, col.value); });
      hex.addEventListener('change', () => { const v = hex.value.trim(); if (v && !isHex(v)) { hex.style.borderColor = 'var(--error)'; return; } hex.style.borderColor = ''; if (v) col.value = norm6(v); rs.disabled = !v; save(kind, key, v); });
      rs.addEventListener('click', () => { save(kind, key, null); this.renderEditor(root); });
    });
    root.querySelector('.te-pick').onclick = () => this.pick();
    root.querySelector('.te-resetall').onclick = () => { const all = Object.assign({}, C.SET.themeCustom || {}); delete all[t.id]; C.SET.themeCustom = all; C.saveSettings(); this.apply(t.id); this.renderEditor(root); };
    root.querySelector('.te-advset').onclick = () => { const k = root.querySelector('.te-advkey').value.trim(); if (!k) return; save('color', k, root.querySelector('.te-advcol').value); C.notify('info', k + ' = ' + root.querySelector('.te-advcol').value, { timeout: 2000 }); };
    root.querySelector('.te-saveas').onclick = async () => {
      const name = await C.inputBox({ prompt: tr ? 'Yeni temanın adı' : 'New theme name', value: this.label(t) + (tr ? ' (özel)' : ' (custom)') });
      if (!name) return;
      const e2 = this.effective(t);
      const tc = (t.tokenColors || []).slice();
      for (const [tok, colr] of Object.entries(e2.tokens)) for (const sc of (TOKEN_SCOPES[tok] || []).slice(0, 1)) tc.push({ scope: sc, settings: { foreground: colr } });
      const th = { id: 'user:' + name, label: name, labelTr: name, type: t.type, colors: e2.colors, tokenColors: tc, user: true };
      C.SET.userThemes = (C.SET.userThemes || []).filter((x) => x.id !== th.id).concat([th]);
      C.SET.theme = th.id; C.saveSettings(); this.apply(th.id); this.renderEditor(root);
    };
    root.querySelector('.te-export').onclick = async () => {
      const e2 = this.effective(t);
      const tc = (t.tokenColors || []).slice();
      for (const [tok, colr] of Object.entries(e2.tokens)) for (const sc of (TOKEN_SCOPES[tok] || []).slice(0, 1)) tc.push({ scope: sc, settings: { foreground: colr } });
      const json = JSON.stringify({ name: this.label(t), type: this.kind(t), colors: e2.colors, tokenColors: tc }, null, 2);
      const path = 'Temalar/' + this.label(t).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '-color-theme.json';
      await C.native('fs.write', { path, content: json });
      await C.Explorer.refresh();
      C.notify('success', (tr ? 'Kaydedildi: ' : 'Saved: ') + path);
    };
    paint();
  }
};

window.VSCModules.push((ctx) => { Themes.ctx = ctx; ctx.Themes = Themes; });
window.VSCThemes = Themes;
Themes.parseJsonc = stripJsonc;
})();
