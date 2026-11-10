/* ==========================================================================
   VS iPad – Mac'teki VS Code ile eşitleme + Etkinlik çubuğu özelleştirme
   VS Code'un kendi "Settings Sync" servisi Microsoft sunucularını kullanır ve
   dışarıya açık değildir. Bunun yerine VS Code'un standart dosyaları içe aktarılır:
     • Profil dışa aktarımı (.code-profile)  ← önerilen: hepsi tek dosyada
     • settings.json, keybindings.json, snippets/*.json (*.code-snippets)
     • extensions.json / uzantı listesi
   ========================================================================== */
(function () {
'use strict';
window.VSCModules = window.VSCModules || [];

const LANG_FROM_FILE = { c: 'c', cpp: 'cpp', 'c++': 'cpp', java: 'java', python: 'python', csharp: 'csharp', javascript: 'javascript', typescript: 'typescript', rust: 'rust', sql: 'sql', html: 'html', css: 'css', markdown: 'markdown', json: 'json', shellscript: 'shell', go: 'go', swift: 'swift' };
const SNIPPET_LANGS = ['c', 'cpp', 'java', 'python', 'csharp', 'javascript', 'typescript', 'rust', 'sql', 'html', 'css', 'markdown', 'shell', 'go', 'swift', 'json'];
const TOKEN_MAP = { comments: 'comment', strings: 'string', keywords: 'keyword', numbers: 'number', types: 'type', functions: 'predefined', variables: 'identifier' };

const Sync = {
  ctx: null,
  tr() { return this.ctx.SET.lang !== 'en'; },
  parse(txt) {
    if (typeof txt !== 'string') return txt;
    try { return JSON.parse(txt); } catch (e) {}
    return window.VSCThemes.parseJsonc(txt);
  },
  // ---------------------------------------------------------------- içe aktarma
  async importCommand() {
    const C = this.ctx, tr = this.tr();
    const files = C.Explorer.files();
    const cand = files.filter((p) => /\.code-profile$|(^|\/)(settings|keybindings|extensions)\.json$|\.code-snippets$|(^|\/)snippets\/[^/]+\.json$/i.test(p));
    if (!cand.length) {
      await C.dialog(tr ? 'İçe aktarılacak VS Code dosyası bulunamadı' : 'No VS Code files found',
        tr ? 'Mac\'teki VS Code\'da: ⚙ (sol alt) › Profiles › aktif profilin yanındaki ⋯ › Export… › "Local file" ile bir .code-profile dosyası kaydet. Dosyayı AirDrop / iCloud Drive ile bu çalışma alanına koy, sonra bu komutu tekrar çalıştır.\n\nAlternatif: ~/Library/Application Support/Code/User klasöründeki settings.json, keybindings.json ve snippets klasörünü kopyala.'
          : 'Export a profile from VS Code (Profiles › Export › Local file) and copy the .code-profile into this workspace.', ['OK']);
      return;
    }
    const profiles = cand.filter((p) => /\.code-profile$/i.test(p));
    let picked;
    if (profiles.length) {
      const it = await C.quickPick(profiles.map((p) => ({ label: p.split('/').pop(), desc: p, p })).concat(cand.length > profiles.length ? [{ label: tr ? 'Ayrı JSON dosyalarını kullan' : 'Use individual JSON files', desc: `${cand.length - profiles.length}`, p: null }] : []),
        { placeholder: tr ? 'İçe aktarılacak VS Code profili' : 'VS Code profile to import' });
      if (!it) return;
      picked = it.p ? [it.p] : cand.filter((p) => !/\.code-profile$/i.test(p));
    } else picked = cand;
    const bundle = { settings: null, keybindings: null, snippets: {}, extensions: null };
    for (const p of picked) {
      let txt; try { txt = (await C.native('fs.read', { path: p })).content; } catch (e) { continue; }
      try {
        if (/\.code-profile$/i.test(p)) this.fromProfile(this.parse(txt), bundle);
        else if (/settings\.json$/i.test(p)) bundle.settings = this.parse(txt);
        else if (/keybindings\.json$/i.test(p)) bundle.keybindings = this.parse(txt);
        else if (/extensions\.json$/i.test(p)) { const j = this.parse(txt); bundle.extensions = Array.isArray(j) ? j.map((x) => (x.identifier ? x.identifier.id : x.id || x)) : (j.recommendations || []); }
        else bundle.snippets[p.split('/').pop()] = this.parse(txt);
      } catch (e) { C.notify('warning', `${p.split('/').pop()}: ${e.message}`); }
    }
    this.apply(bundle);
  },
  // Uygulamanın içine gömülü profil (Web/profil/*.code-profile, Mac'te Xcode ile paketlenir, GitHub'a gitmez).
  // Dosya değiştiyse açılışta bir kez otomatik içe aktarılır.
  async autoImportBundled() {
    const C = this.ctx, SET = C.SET;
    let txt = null, name = '';
    for (const n of ['profil/vscode.code-profile', 'profil/Default.code-profile']) {
      try { const r = await fetch(n, { cache: 'no-store' }); if (r.ok) { txt = await r.text(); name = n; break; } } catch (e) {}
    }
    if (!txt || txt.length < 20) return;
    let h = 0; for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) | 0;
    if (SET.bundledProfileHash === h) return;
    try {
      const bundle = { settings: null, keybindings: null, snippets: {}, extensions: null };
      this.fromProfile(this.parse(txt), bundle);
      this.apply(bundle);
      SET.bundledProfileHash = h; C.saveSettings();
    } catch (e) { C.notify('warning', 'Gömülü VS Code profili okunamadı: ' + (e.message || e)); }
  },
  fromProfile(prof, bundle) {
    const P = (v) => (typeof v === 'string' ? this.parse(v) : v);
    if (prof.settings) { const s = P(prof.settings); bundle.settings = P(s.settings != null ? s.settings : s); }
    if (prof.keybindings) { const k = P(prof.keybindings); bundle.keybindings = P(k.keybindings != null ? k.keybindings : k); }
    if (prof.snippets) { const s = P(prof.snippets); const m = P(s.snippets != null ? s.snippets : s) || {}; for (const [f, c] of Object.entries(m)) { try { bundle.snippets[f] = P(c); } catch (e) {} } }
    if (prof.extensions) { const e = P(prof.extensions); bundle.extensions = (Array.isArray(e) ? e : []).filter((x) => !x.disabled).map((x) => (x.identifier ? x.identifier.id : x.id)).filter(Boolean); }
  },
  apply(b) {
    const C = this.ctx, SET = C.SET, tr = this.tr();
    const report = [];
    // ---- ayarlar
    if (b.settings && typeof b.settings === 'object') {
      const s = b.settings; let n = 0;
      const set = (k, v) => { if (v !== undefined && v !== null) { SET[k] = v; n++; } };
      if (s['workbench.colorTheme']) {
        const t = C.Themes && C.Themes.all().find((x) => x.id === s['workbench.colorTheme'] || x.label === s['workbench.colorTheme']);
        if (t) set('theme', t.id); else report.push((tr ? 'Tema bulunamadı: ' : 'Theme not found: ') + s['workbench.colorTheme']);
      }
      if (typeof s['editor.fontSize'] === 'number') set('fontSize', Math.round(s['editor.fontSize']));
      if (typeof s['editor.tabSize'] === 'number') set('tabSize', s['editor.tabSize']);
      if (s['editor.wordWrap']) set('wordWrap', s['editor.wordWrap'] === 'off' ? 'off' : 'on');
      if (typeof s['editor.minimap.enabled'] === 'boolean') set('minimap', s['editor.minimap.enabled']);
      if (s['editor.lineNumbers']) set('lineNumbers', s['editor.lineNumbers'] === 'off' ? 'off' : 'on');
      if (typeof s['editor.stickyScroll.enabled'] === 'boolean') set('stickyScroll', s['editor.stickyScroll.enabled']);
      if (s['files.autoSave']) set('autoSave', s['files.autoSave'] !== 'off');
      if (s['locale']) set('lang', /^tr/.test(s['locale']) ? 'tr' : 'en');
      // renk özelleştirmeleri (genel ve "[Tema Adı]" kapsamlı)
      const themeId = SET.theme;
      const cc = s['workbench.colorCustomizations'];
      if (cc && typeof cc === 'object') {
        const colors = {};
        for (const [k, v] of Object.entries(cc)) { if (k.startsWith('[')) { if (k.slice(1, -1) === themeId) Object.assign(colors, v); } else colors[k] = v; }
        SET.themeCustom = SET.themeCustom || {}; SET.themeCustom[themeId] = SET.themeCustom[themeId] || { colors: {}, tokens: {} };
        Object.assign(SET.themeCustom[themeId].colors, colors); n++;
      }
      const tc = s['editor.tokenColorCustomizations'];
      if (tc && typeof tc === 'object') {
        const tokens = {};
        const take = (o) => { for (const [k, v] of Object.entries(o || {})) { if (TOKEN_MAP[k]) tokens[TOKEN_MAP[k]] = typeof v === 'string' ? v : v.foreground; } };
        take(tc); for (const [k, v] of Object.entries(tc)) if (k.startsWith('[') && k.slice(1, -1) === themeId) take(v);
        if (Object.keys(tokens).length) { SET.themeCustom = SET.themeCustom || {}; SET.themeCustom[themeId] = SET.themeCustom[themeId] || { colors: {}, tokens: {} }; Object.assign(SET.themeCustom[themeId].tokens, tokens); n++; }
      }
      if (s['vscode-pets.petType']) { set('pets', [{ type: s['vscode-pets.petType'], color: s['vscode-pets.petColor'] || 'brown' }]); }
      if (s['vscode-pets.theme']) set('petsBg', s['vscode-pets.theme']);
      if (s['workbench.iconTheme']) { SET.ext = Object.assign({}, SET.ext, { 'pkief.material-icon-theme': s['workbench.iconTheme'] === 'material-icon-theme' }); n++; }
      if (C.Settings) n += C.Settings.importVSCode(s);
      SET.vscodeSettings = s; // ham hâli (ileride başka ayarlar için)
      report.unshift((tr ? 'Ayarlar: ' : 'Settings: ') + n + (tr ? ' ayar uygulandı' : ' applied'));
    }
    // ---- snippet'ler
    const files = Object.entries(b.snippets || {});
    if (files.length) {
      const us = {}; let cnt = 0;
      for (const [file, content] of files) {
        if (!content || typeof content !== 'object') continue;
        const base = file.replace(/\.(json|code-snippets)$/i, '').toLowerCase();
        for (const [name, sn] of Object.entries(content)) {
          if (!sn || !sn.body) continue;
          let langs = LANG_FROM_FILE[base] ? [LANG_FROM_FILE[base]] : (sn.scope ? String(sn.scope).split(',').map((x) => LANG_FROM_FILE[x.trim()] || x.trim()) : ['*']);
          const prefixes = Array.isArray(sn.prefix) ? sn.prefix : [sn.prefix || name];
          for (const L of langs) for (const pf of prefixes) { (us[L] = us[L] || []).push({ prefix: pf, body: Array.isArray(sn.body) ? sn.body.join('\n') : String(sn.body), desc: sn.description || name }); cnt++; }
        }
      }
      SET.userSnippets = us;
      report.push((tr ? 'Snippet: ' : 'Snippets: ') + cnt);
    }
    // ---- uzantılar
    if (b.extensions && b.extensions.length) {
      const X = window.VSCExt, ok = [], no = [];
      for (const id of b.extensions) { const st = X && X.EXT_STATUS[String(id).toLowerCase()]; if (st && st[0] !== 'unsupported') { ok.push(id); SET.ext = Object.assign({}, SET.ext, { [String(id).toLowerCase()]: true }); } else no.push(id); }
      report.push((tr ? `Uzantılar: ${ok.length} etkin, ${no.length} iPad'de yok` : `Extensions: ${ok.length} enabled, ${no.length} unsupported`));
    }
    if (b.keybindings && b.keybindings.length) report.push((tr ? 'Kısayollar: ' : 'Keybindings: ') + b.keybindings.length + (tr ? ' (iPad menü kısayolları kullanılıyor, bunlar uygulanmadı)' : ' (not applied)'));
    SET.vscodeSyncAt = Date.now();
    C.saveSettings();
    C.notify('success', (tr ? 'VS Code\'dan içe aktarıldı. ' : 'Imported from VS Code. ') + report.join(' · '), { timeout: 12000, actions: [{ label: tr ? 'Yeniden yükle' : 'Reload', run: () => location.reload() }] });
    C.applyAll && C.applyAll();
  },
  registerSnippets(monaco) {
    const C = this.ctx;
    const provider = (lang) => ({
      provideCompletionItems(model, pos) {
        const us = C.SET.userSnippets || {};
        const list = (us[lang] || []).concat(us['*'] || []);
        if (!list.length) return { suggestions: [] };
        const w = model.getWordUntilPosition(pos);
        const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
        return { suggestions: list.map((s) => ({ label: s.prefix, kind: monaco.languages.CompletionItemKind.Snippet, insertText: s.body, detail: s.desc + ' (VS Code)', documentation: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range })) };
      }
    });
    SNIPPET_LANGS.forEach((L) => monaco.languages.registerCompletionItemProvider(L, provider(L)));
  },
  // ---------------------------------------------------------------- dışa aktarma (iPad → Mac)
  async exportCommand() {
    const C = this.ctx, S = C.SET, tr = this.tr();
    const settings = Object.assign({}, S.vscodeSettings || {}, {
      'workbench.colorTheme': S.theme, 'editor.fontSize': S.fontSize, 'editor.tabSize': S.tabSize, 'editor.wordWrap': S.wordWrap,
      'editor.minimap.enabled': S.minimap, 'editor.lineNumbers': S.lineNumbers, 'editor.stickyScroll.enabled': S.stickyScroll,
      'files.autoSave': S.autoSave ? 'afterDelay' : 'off'
    });
    const cu = (S.themeCustom || {})[S.theme];
    if (cu && Object.keys(cu.colors || {}).length) settings['workbench.colorCustomizations'] = Object.assign({}, settings['workbench.colorCustomizations'] || {}, { [`[${S.theme}]`]: cu.colors });
    const path = 'VS Code/settings.json';
    await C.native('fs.write', { path, content: JSON.stringify(settings, null, 4) + '\n' });
    await C.Explorer.refresh();
    C.notify('success', (tr ? 'Kaydedildi: ' : 'Saved: ') + path + (tr ? ' – Mac\'te VS Code › Ctrl+Shift+P › "Preferences: Open User Settings (JSON)" içine yapıştırabilirsin.' : ''), { timeout: 10000 });
  }
};

// ---------------------------------------------------------------- Etkinlik çubuğu: sırala / gizle
const AB = {
  ctx: null,
  labels() {
    const tr = this.ctx.SET.lang !== 'en';
    return { explorer: tr ? 'Gezgin' : 'Explorer', search: tr ? 'Ara' : 'Search', scm: tr ? 'Kaynak Denetimi' : 'Source Control', run: tr ? 'Çalıştır ve Hata Ayıkla' : 'Run and Debug',
      extensions: tr ? 'Uzantılar' : 'Extensions', esp32: 'ESP32', claude: 'Claude', ag: 'Gemini · AG' };
  },
  top() { return document.querySelector('#activitybar .ab-top'); },
  items() { return Array.from(this.top().querySelectorAll('.ab-item[data-view]')); },
  apply() {
    const S = this.ctx.SET, top = this.top(); if (!top) return;
    const order = S.abOrder || [];
    const els = this.items();
    els.sort((a, b) => { const ia = order.indexOf(a.dataset.view), ib = order.indexOf(b.dataset.view); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); });
    els.forEach((e) => { top.appendChild(e); e.style.display = (S.abHidden || []).includes(e.dataset.view) ? 'none' : ''; });
  },
  save() { this.ctx.SET.abOrder = this.items().map((e) => e.dataset.view); this.ctx.saveSettings(); },
  menu(x, y) {
    const C = this.ctx, S = C.SET, L = this.labels(), tr = S.lang !== 'en';
    const hidden = S.abHidden || [];
    const items = this.items().map((e) => ({ label: L[e.dataset.view] || e.dataset.view, checked: !hidden.includes(e.dataset.view), run: () => {
      const v = e.dataset.view; let h = (S.abHidden || []).slice();
      if (h.includes(v)) h = h.filter((x) => x !== v);
      else { if (this.items().length - h.length <= 1) { C.notify('info', tr ? 'En az bir simge görünür kalmalı.' : 'Keep at least one.'); return; } h.push(v); if (S.view === v) C.showView(this.items().find((i) => !h.includes(i.dataset.view)).dataset.view); }
      S.abHidden = h; C.saveSettings(); this.apply();
    } }));
    C.Menu.show(items.concat(['-',
      { label: tr ? 'Sıralamak için: simgeye basılı tut ve sürükle' : 'To reorder: press and hold an icon, then drag', disabled: true },
      { label: tr ? 'Varsayılan sıraya dön' : 'Reset Order', run: () => { S.abOrder = null; S.abHidden = []; C.saveSettings(); const def = ['explorer', 'search', 'scm', 'run', 'extensions', 'esp32', 'claude', 'ag']; S.abOrder = def; this.apply(); S.abOrder = null; } }
    ]), x, y);
  },
  bind() {
    const bar = document.getElementById('activitybar'); if (!bar) return;
    bar.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(e.clientX + 4, e.clientY); });
    // basılı tut → sürükle (sırala); bırakınca hareket yoksa menü
    let timer = null, drag = null;
    const clear = () => { clearTimeout(timer); timer = null; };
    this.top().addEventListener('pointerdown', (e) => {
      const item = e.target.closest('.ab-item[data-view]'); if (!item) return;
      const sx = e.clientX, sy = e.clientY;
      clear();
      timer = setTimeout(() => {
        drag = { item, sy, moved: false, pid: e.pointerId };
        item.classList.add('ab-dragging'); document.body.classList.add('ab-reorder');
        try { item.setPointerCapture(e.pointerId); } catch (er) {}
        if (navigator.vibrate) navigator.vibrate(10);
      }, 450);
      const cancelIfMoved = (ev) => { if (!drag && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) clear(); };
      window.addEventListener('pointermove', cancelIfMoved, { once: false });
      const off = () => { window.removeEventListener('pointermove', cancelIfMoved); window.removeEventListener('pointerup', off); clear(); };
      window.addEventListener('pointerup', off);
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      e.preventDefault();
      const els = this.items().filter((x) => x.style.display !== 'none');
      for (const other of els) {
        if (other === drag.item) continue;
        const r = other.getBoundingClientRect();
        if (e.clientY > r.top && e.clientY < r.bottom) {
          const before = e.clientY < r.top + r.height / 2;
          this.top().insertBefore(drag.item, before ? other : other.nextSibling);
          drag.moved = true; break;
        }
      }
    }, { passive: false });
    const end = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      d.item.classList.remove('ab-dragging'); document.body.classList.remove('ab-reorder');
      d.item.dataset.suppressClick = '1'; setTimeout(() => { delete d.item.dataset.suppressClick; }, 400);
      if (d.moved) this.save();
      else { const r = d.item.getBoundingClientRect(); this.menu(r.right + 4, r.top); }
    };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    // WKWebView: uzun basmada sistem menüsü / seçim çıkmasın
    bar.addEventListener('touchstart', () => {}, { passive: true });
  }
};

window.VSCModules.push((ctx) => { Sync.ctx = ctx; AB.ctx = ctx; ctx.Sync = Sync; ctx.AB = AB; setTimeout(() => Sync.autoImportBundled(), 1500); });
window.VSCSync = Sync; window.VSCActivityBar = AB;
})();
