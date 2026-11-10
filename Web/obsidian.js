/* ==========================================================================
   VS iPad – Obsidian tarzı Markdown okuma görünümü + PDF / görsel görüntüleyici
   Markdown: [[wikilink]] / [[not|takma ad]] / [[not#başlık]], ![[gömme]] (not, görsel, PDF),
             callout (> [!note]), KaTeX ($…$, $$…$$), ==vurgu==, #etiket, görev kutuları
             (dokununca dosyaya yazılır), özellikler (frontmatter), Mermaid, kod renklendirme,
             geri bağlantılar (backlinks).
   PDF: pdf.js (sayfa sayfa, yakınlaştırma, metin seçme, ara).   Görsel: yakınlaştırılabilir.
   Kütüphaneler CDN önbelleğinden gelir (ilk açılışta internet, sonra çevrimdışı).
   ========================================================================== */
(function () {
'use strict';
window.VSCModules = window.VSCModules || [];

const LIBS = {
  md: 'npm/markdown-it@14.1.0/dist/markdown-it.min.js',
  katex: 'npm/katex@0.16.11/dist/katex.min.js',
  katexCss: 'npm/katex@0.16.11/dist/katex.min.css',
  mermaid: 'npm/mermaid@10.9.1/dist/mermaid.min.js',
  pdf: 'npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfWorker: 'npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
};
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic|avif)$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', heic: 'image/heic', avif: 'image/avif', pdf: 'application/pdf' };
const CALLOUT_ICON = { note: 'pencil', info: 'info', tip: 'flame', hint: 'flame', important: 'flame', success: 'check', check: 'check', done: 'check', question: 'question', help: 'question', faq: 'question',
  warning: 'warning', caution: 'warning', attention: 'warning', failure: 'close', fail: 'close', missing: 'close', danger: 'zap', error: 'zap', bug: 'bug', example: 'list-ordered', quote: 'quote', cite: 'quote', abstract: 'book', summary: 'book', tldr: 'book', todo: 'pass' };
const CALLOUT_COLOR = { note: '#448aff', info: '#00b8d4', tip: '#00bfa5', hint: '#00bfa5', important: '#00bfa5', success: '#00c853', check: '#00c853', done: '#00c853', question: '#ff9100', help: '#ff9100', faq: '#ff9100',
  warning: '#ff9100', caution: '#ff9100', attention: '#ff9100', failure: '#ff5252', fail: '#ff5252', missing: '#ff5252', danger: '#ff1744', error: '#ff1744', bug: '#f50057', example: '#7c4dff', quote: '#9e9e9e', cite: '#9e9e9e', abstract: '#00b0ff', summary: '#00b0ff', tldr: '#00b0ff', todo: '#448aff' };

// Obsidian/GitHub başlık kimliği: küçük harf, noktalama yok, boşluk → -
const slug = (t) => String(t).trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
// scrollIntoView üst kapları da kaydırıp sekme çubuğunu gizliyordu → sadece okuma alanını kaydır
function scrollToEl(el) {
  if (!el) return;
  const box = el.closest('#md-preview, .pv-pages, #virtual-doc'); if (!box) return;
  box.scrollTo({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 48, behavior: 'smooth' });
}
const b64ToBytes = (b64) => { const s = atob(b64 || ''); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

const V = {
  ctx: null, loaded: {}, md: null, blobUrls: [], backlinkCache: null,
  tr() { return this.ctx.SET.lang !== 'en'; },
  L(a, b) { return this.tr() ? a : b; },

  // ---------------------------------------------------------------- kütüphane yükleme
  // Monaco'nun AMD yükleyicisi (define.amd) açıkken UMD kütüphaneleri global olarak kaydolmaz
  async lib(name) {
    if (this.loaded[name]) return this.loaded[name];
    const C = this.ctx;
    this.loaded[name] = (async () => {
      const d = window.define; window.define = undefined;
      try { await C.loadScript(C.CDN + LIBS[name], 90000); } finally { window.define = d; }
    })();
    try { await this.loaded[name]; } catch (e) { this.loaded[name] = null; throw e; }
    return true;
  },
  css(name) {
    if (document.querySelector(`link[data-lib="${name}"]`)) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = this.ctx.CDN + LIBS[name]; l.dataset.lib = name; document.head.appendChild(l);
  },
  async markdownIt() {
    if (this.md) return this.md;
    await this.lib('md');
    this.md = window.markdownit({ html: true, linkify: true, breaks: true, typographer: false });
    return this.md;
  },

  // ---------------------------------------------------------------- dosya çözümleme (Obsidian kuralları)
  index() {
    const files = this.ctx.Explorer.files();
    const byName = new Map(), byFull = new Map();
    for (const p of files) {
      const base = p.split('/').pop();
      const k1 = base.toLowerCase(), k2 = base.replace(/\.md$/i, '').toLowerCase();
      if (!byFull.has(k1)) byFull.set(k1, []); byFull.get(k1).push(p);
      if (/\.md$/i.test(base)) { if (!byName.has(k2)) byName.set(k2, []); byName.get(k2).push(p); }
    }
    return { files, byName, byFull };
  },
  resolve(target, fromPath, idx) {
    idx = idx || this.index();
    let t = target.trim().replace(/\\/g, '/');
    if (!t) return null;
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
    const cand = [];
    // tam yol (kökten veya göreli)
    for (const p of [t, t + '.md', dir ? dir + '/' + t : null, dir ? dir + '/' + t + '.md' : null].filter(Boolean)) if (idx.files.includes(p)) return p;
    const base = t.split('/').pop().toLowerCase();
    const list = (idx.byFull.get(base) || []).concat(idx.byName.get(base.replace(/\.md$/i, '')) || []);
    for (const p of list) if (!t.includes('/') || p.toLowerCase().endsWith(t.toLowerCase()) || p.toLowerCase().endsWith((t + '.md').toLowerCase())) cand.push(p);
    if (!cand.length) return null;
    cand.sort((a, b) => ((b.startsWith(dir + '/') ? 1 : 0) - (a.startsWith(dir + '/') ? 1 : 0)) || a.split('/').length - b.split('/').length);
    return cand[0];
  },
  async dataUrl(path) {
    const r = await this.ctx.native('fs.readB64', { path });
    const ext = path.split('.').pop().toLowerCase();
    return `data:${MIME[ext] || 'application/octet-stream'};base64,${r.b64}`;
  },

  // ---------------------------------------------------------------- Markdown → HTML
  frontmatter(src) {
    const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { props: null, body: src };
    const props = []; let cur = null;
    for (const line of m[1].split(/\r?\n/)) {
      let mm;
      if ((mm = line.match(/^([\w\- ]+):\s*(.*)$/))) { cur = { k: mm[1].trim(), v: mm[2].trim() ? [mm[2].trim().replace(/^["']|["']$/g, '')] : [] }; props.push(cur); }
      else if ((mm = line.match(/^\s*-\s*(.*)$/)) && cur) cur.v.push(mm[1].replace(/^["']|["']$/g, ''));
    }
    for (const p of props) if (p.v.length === 1 && /^\[.*\]$/.test(p.v[0])) p.v = p.v[0].slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    return { props, body: src.slice(m[0].length) };
  },
  // Kod blokları / satır içi kod dışında kalan metne dönüşüm uygula
  outsideCode(src, fn) {
    const parts = src.split(/(^```[\s\S]*?^```[^\n]*$|^~~~[\s\S]*?^~~~[^\n]*$)/m);
    return parts.map((p, i) => (i % 2 ? p : p.split(/(`+[^`\n]*?`+)/).map((q, j) => (j % 2 ? q : fn(q))).join(''))).join('');
  },
  async render(src, path, root, depth = 0) {
    const C = this.ctx, esc = C.esc, md = await this.markdownIt();
    const idx = this.index();
    const { props, body } = depth ? { props: null, body: this.frontmatter(src).body } : this.frontmatter(src);
    const store = [];
    const ph = (html) => { store.push(html); return `\u0002${store.length - 1}\u0003`; };
    let text = this.outsideCode(body, (s) => {
      // matematik
      s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => ph(`<div class="ob-math" data-tex="${esc(tex)}" data-display="1"></div>`));
      s = s.replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (m, pre, tex) => pre + ph(`<span class="ob-math" data-tex="${esc(tex)}"></span>`));
      // gömmeler ve wikilink'ler
      s = s.replace(/!\[\[([^\]|#^]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, target, frag, opt) => ph(`<span class="ob-embed" data-target="${esc(target)}" data-frag="${esc(frag || '')}" data-opt="${esc(opt || '')}"></span>`));
      s = s.replace(/\[\[([^\]|#^]*)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, target, frag, alias) => {
        const res = target ? this.resolve(target, path, idx) : path;
        const label = alias || (target ? target.split('/').pop() : '') + (frag ? (target ? ' › ' : '') + frag.slice(1).replace(/^\^/, '') : '');
        return ph(`<a class="ob-link${res ? '' : ' ob-unresolved'}" data-target="${esc(target)}" data-path="${esc(res || '')}" data-frag="${esc((frag || '').slice(1))}" href="#">${esc(label || target)}</a>`);
      });
      // ==vurgu== ve #etiket
      s = s.replace(/==([^=\n]+)==/g, (m, t) => ph(`<mark>${md.renderInline(t)}</mark>`));
      // [metin](#başlık) ve [metin](url) hedeflerini koru, sonra etiketleri işle
      const keep = [];
      s = s.replace(/\]\(([^)\s]*)\)/g, (m) => { keep.push(m); return `\u0004${keep.length - 1}\u0005`; });
      s = s.replace(/(^|\s)#([\p{L}\p{N}_\-/]*\p{L}[\p{L}\p{N}_\-/]*)/gu, (m, pre, tag) => pre + ph(`<a class="ob-tag" href="#" data-tag="${esc(tag)}">#${esc(tag)}</a>`));
      s = s.replace(/\u0004(\d+)\u0005/g, (m, i) => keep[+i]);
      // %%yorum%%
      s = s.replace(/%%[\s\S]*?%%/g, '');
      return s;
    });
    let html = md.render(text);
    html = html.replace(/\u0002(\d+)\u0003/g, (m, i) => store[+i]);
    const props_ = props && props.length ? `<div class="ob-props"><div class="ob-props-title">${this.L('Özellikler', 'Properties')}</div>${props.map((p) => `<div class="ob-prop"><span class="ob-prop-k">${esc(p.k)}</span><span class="ob-prop-v">${p.v.map((v) => (/^(tags?|aliases)$/i.test(p.k) ? `<span class="ob-pill">${esc(v)}</span>` : esc(v))).join(' ') || '<span class="dim">—</span>'}</span></div>`).join('')}</div>` : '';
    root.innerHTML = props_ + html;
    await this.enhance(root, path, depth, idx);
  },
  async enhance(root, path, depth, idx) {
    const C = this.ctx, esc = C.esc;
    // callout'lar
    root.querySelectorAll('blockquote').forEach((bq) => {
      const p = bq.querySelector(':scope > p'); if (!p) return;
      const m = p.innerHTML.match(/^\[!(\w+)\]([+-]?)\s*([^\n<]*)(<br>\n?)?/i); if (!m) return;
      const type = m[1].toLowerCase(), fold = m[2], title = m[3].trim() || (type[0].toUpperCase() + type.slice(1));
      p.innerHTML = p.innerHTML.slice(m[0].length);
      if (!p.innerHTML.trim()) p.remove();
      const div = document.createElement('div');
      div.className = 'ob-callout' + (fold === '-' ? ' folded' : '');
      div.style.setProperty('--cc', CALLOUT_COLOR[type] || CALLOUT_COLOR.note);
      div.innerHTML = `<div class="ob-callout-title"><i class="codicon codicon-${CALLOUT_ICON[type] || 'pencil'}"></i><span>${title}</span>${fold ? '<i class="codicon codicon-chevron-down ob-fold"></i>' : ''}</div><div class="ob-callout-body"></div>`;
      const bodyEl = div.querySelector('.ob-callout-body');
      while (bq.firstChild) bodyEl.appendChild(bq.firstChild);
      if (fold) div.querySelector('.ob-callout-title').addEventListener('click', () => div.classList.toggle('folded'));
      bq.replaceWith(div);
    });
    // görev kutuları (dokununca kaynak dosyada [ ] ↔ [x])
    let taskNo = 0;
    root.querySelectorAll('li').forEach((li) => {
      const first = li.firstChild && li.firstChild.nodeType === 3 ? li.firstChild : (li.firstElementChild && li.firstElementChild.tagName === 'P' ? li.firstElementChild.firstChild : null);
      if (!first || first.nodeType !== 3) return;
      const m = first.textContent.match(/^\[( |x|X|\/|-)\]\s?/); if (!m) return;
      first.textContent = first.textContent.slice(m[0].length);
      const n = taskNo++;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'ob-task'; cb.checked = m[1] !== ' ';
      if (m[1] === '-') li.classList.add('ob-cancel');
      if (!depth) cb.addEventListener('change', () => this.toggleTask(path, n, cb.checked));
      else cb.disabled = true;
      li.classList.add('ob-task-item'); if (cb.checked) li.classList.add('ob-done');
      (first.parentNode).insertBefore(cb, first);
      li.parentElement.classList.add('ob-tasklist');
    });
    // başlık bağlantıları
    root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((hEl) => { hEl.id = 'h-' + slug(hEl.textContent); });
    // linkler
    root.querySelectorAll('a').forEach((a) => {
      if (a.classList.contains('ob-link')) { a.addEventListener('click', (e) => { e.preventDefault(); this.follow(a.dataset.target, a.dataset.path, a.dataset.frag, path); }); return; }
      if (a.classList.contains('ob-tag')) { a.addEventListener('click', (e) => { e.preventDefault(); this.searchTag(a.dataset.tag); }); return; }
      const href = a.getAttribute('href') || '';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (/^(https?|mailto):/i.test(href)) C.native('app.openURL', { url: href });
        else if (href.startsWith('#')) { scrollToEl(document.querySelector('#md-preview #h-' + CSS.escape(slug(decodeURIComponent(href.slice(1)))))); }
        else { const p = this.resolve(decodeURIComponent(href), path, idx); if (p) this.openPath(p); else C.notify('info', this.L('Bulunamadı: ', 'Not found: ') + href); }
      });
    });
    // görseller (göreli yollar)
    for (const img of root.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (/^(https?:|data:)/.test(src)) continue;
      const p = this.resolve(decodeURIComponent(src), path, idx);
      if (p) this.dataUrl(p).then((u) => { img.src = u; }).catch(() => {});
      img.addEventListener('click', () => p && this.openPath(p));
    }
    // gömmeler
    for (const el of root.querySelectorAll('.ob-embed')) await this.embed(el, path, depth, idx);
    // KaTeX
    const maths = root.querySelectorAll('.ob-math');
    if (maths.length && this.ctx.SET.mdMath === false) maths.forEach((m) => { m.textContent = (m.dataset.display ? '$$' : '$') + m.dataset.tex + (m.dataset.display ? '$$' : '$'); m.classList.add('ob-math-raw'); });
    else if (maths.length) {
      try {
        this.css('katexCss'); await this.lib('katex');
        maths.forEach((m) => { try { window.katex.render(m.dataset.tex, m, { displayMode: !!m.dataset.display, throwOnError: false, strict: false }); } catch (e) { m.textContent = m.dataset.tex; } });
      } catch (e) { maths.forEach((m) => { m.textContent = (m.dataset.display ? '$$' : '$') + m.dataset.tex + (m.dataset.display ? '$$' : '$'); m.classList.add('ob-math-raw'); }); }
    }
    // kod blokları: Mermaid ve renklendirme
    const monaco = C.monaco();
    for (const code of root.querySelectorAll('pre > code')) {
      const lang = ((code.className.match(/language-([\w+#-]+)/) || [])[1] || '').toLowerCase();
      const pre = code.parentElement;
      if (lang === 'mermaid') {
        try {
          await this.lib('mermaid');
          if (!this.mermaidInit) { window.mermaid.initialize({ startOnLoad: false, theme: document.body.dataset.themeKind === 'light' ? 'default' : 'dark', securityLevel: 'strict' }); this.mermaidInit = true; }
          const { svg } = await window.mermaid.render('mm' + Math.random().toString(36).slice(2), code.textContent);
          const div = document.createElement('div'); div.className = 'ob-mermaid'; div.innerHTML = svg; pre.replaceWith(div);
        } catch (e) { pre.classList.add('ob-mermaid-err'); }
        continue;
      }
      const map = { 'c++': 'cpp', cs: 'csharp', 'c#': 'csharp', py: 'python', js: 'javascript', ts: 'typescript', sh: 'shell', bash: 'shell', zsh: 'shell', rs: 'rust', yml: 'yaml', md: 'markdown', ino: 'cpp' };
      if (monaco && lang) {
        try { code.innerHTML = await monaco.editor.colorize(code.textContent, map[lang] || lang, { tabSize: 4 }); code.classList.add('ob-colorized'); } catch (e) {}
      }
      const cp = document.createElement('i'); cp.className = 'codicon codicon-copy ob-copy'; cp.title = this.L('Kopyala', 'Copy');
      cp.addEventListener('click', () => navigator.clipboard.writeText(code.textContent).then(() => C.notify('info', this.L('Kopyalandı', 'Copied'), { timeout: 1200 })).catch(() => {}));
      pre.style.position = 'relative'; pre.appendChild(cp);
    }
  },
  async embed(el, path, depth, idx) {
    const C = this.ctx, esc = C.esc;
    const target = el.dataset.target, opt = el.dataset.opt, frag = el.dataset.frag;
    const p = this.resolve(target, path, idx);
    if (!p) { el.innerHTML = `<span class="ob-unresolved">${esc(target)}</span>`; return; }
    el.dataset.path = p;
    if (IMG_EXT.test(p)) {
      const img = document.createElement('img');
      const m = opt.match(/^(\d+)(?:x(\d+))?$/); if (m) { img.style.width = m[1] + 'px'; if (m[2]) img.style.height = m[2] + 'px'; }
      img.alt = opt && !m ? opt : target; img.className = 'ob-img';
      img.addEventListener('click', () => this.openPath(p));
      el.appendChild(img);
      this.dataUrl(p).then((u) => { img.src = u; }).catch(() => { el.textContent = target; });
      return;
    }
    if (/\.pdf$/i.test(p)) {
      el.classList.add('ob-embed-pdf');
      el.innerHTML = `<div class="ob-pdf-card"><i class="codicon codicon-file-pdf"></i><span>${esc(p.split('/').pop())}</span><button class="btn-mini">${this.L('Aç', 'Open')}</button></div><div class="ob-pdf-pages"></div>`;
      el.querySelector('button').addEventListener('click', () => this.openPath(p));
      const pageM = (frag || '').match(/page=(\d+)/);
      this.pdfThumbs(p, el.querySelector('.ob-pdf-pages'), pageM ? +pageM[1] : 1).catch(() => {});
      return;
    }
    if (/\.md$/i.test(p) && depth < 2) {
      el.classList.add('ob-embed-note');
      el.innerHTML = `<div class="ob-embed-title"><a href="#">${esc(p.split('/').pop().replace(/\.md$/, ''))}</a></div><div class="ob-embed-body"></div>`;
      el.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); this.openPath(p); });
      let src = '';
      try { src = await this.readText(p); } catch (e) {}
      if (frag) src = this.section(src, frag.slice(1));
      await this.render(src, p, el.querySelector('.ob-embed-body'), depth + 1);
      return;
    }
    el.innerHTML = `<a href="#" class="ob-link">${esc(target)}</a>`;
    el.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); this.openPath(p); });
  },
  section(src, heading) {
    const lines = src.split('\n'); let start = -1, lvl = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#+)\s+(.*)$/);
      if (m && start < 0 && m[2].trim().toLowerCase() === heading.trim().toLowerCase()) { start = i; lvl = m[1].length; continue; }
      if (m && start >= 0 && m[1].length <= lvl) return lines.slice(start, i).join('\n');
    }
    return start >= 0 ? lines.slice(start).join('\n') : src;
  },
  async readText(p) {
    const C = this.ctx;
    const tab = C.Tabs.list.find((t) => t.path === p && !t.virtual);
    if (tab) return C.Ed.getValue(tab.model);
    return (await C.native('fs.read', { path: p })).content;
  },
  async toggleTask(path, n, checked) {
    const C = this.ctx;
    let src = await this.readText(path);
    let i = -1;
    const out = this.outsideCode(src, (s) => s.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X|\/|-)\]/gm, (m, pre, st) => { i++; return i === n ? `${pre}[${checked ? 'x' : ' '}]` : m; }));
    if (out === src) return;
    const tab = C.Tabs.list.find((t) => t.path === path && !t.virtual);
    if (tab) { C.Ed.setValue(tab.model, out); await C.Tabs.save(tab, true); }
    else await C.native('fs.write', { path, content: out });
    this.backlinkCache = null;
  },
  async follow(target, resolved, frag, from) {
    const C = this.ctx;
    if (!target && frag) { scrollToEl(document.querySelector('#md-preview #h-' + CSS.escape(slug(frag)))); return; }
    let p = resolved || this.resolve(target, from);
    if (!p) {
      // Obsidian gibi: olmayan nota tıklayınca oluştur
      const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
      const np = (target.includes('/') ? target : (dir ? dir + '/' : '') + target).replace(/\.md$/i, '') + '.md';
      const ok = await C.dialog(this.L(`"${target}" notu yok. Oluşturulsun mu?`, `Create "${target}"?`), np, [this.L('Oluştur', 'Create'), 'Cancel'], 0);
      if (ok !== 0) return;
      await C.native('fs.write', { path: np, content: `# ${target.split('/').pop()}\n\n` });
      await C.Explorer.refresh(); p = np;
    }
    await this.openPath(p);
    if (frag) setTimeout(() => scrollToEl(document.querySelector('#md-preview #h-' + CSS.escape(slug(frag)))), 400);
  },
  async openPath(p) {
    const C = this.ctx;
    if (this.canView(p)) return this.openViewer(p);
    const tab = await C.Tabs.open(p, { preview: false });
    if (tab && /\.md$/i.test(p) && C.SET.mdReading !== false) C.MDView.show(true);
  },
  searchTag(tag) {
    const C = this.ctx;
    C.showView('search');
    const inp = document.getElementById('searchInput'); if (inp) { inp.value = '#' + tag; inp.dispatchEvent(new Event('input')); }
  },
  async backlinks(path) {
    const C = this.ctx;
    const name = path.split('/').pop().replace(/\.md$/i, '').toLowerCase();
    const out = [];
    const idx = this.index();
    for (const p of idx.files) {
      if (!/\.md$/i.test(p) || p === path) continue;
      let txt; try { txt = await this.readText(p); } catch (e) { continue; }
      const re = /!?\[\[([^\]|#^]+)[^\]]*\]\]/g; let m, hit = null;
      while ((m = re.exec(txt))) { if (m[1].split('/').pop().replace(/\.md$/i, '').toLowerCase() === name && this.resolve(m[1], p, idx) === path) { hit = txt.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\n/g, ' '); break; } }
      if (hit) out.push({ p, hit });
      if (out.length > 100) break;
    }
    return out;
  },

  // ---------------------------------------------------------------- okuma görünümü (#md-preview)
  async show(on) {
    const C = this.ctx, pane = document.getElementById('md-preview'), tab = C.Tabs.active;
    if (on === false || !tab || tab.virtual || !/\.(md|markdown)$/i.test(tab.path)) { C.MD.toggle(false); return; }
    C.MD.showing = true;
    pane.style.padding = ''; pane.classList.remove('hidden'); pane.classList.add('ob-reading');
    const st = pane.scrollTop;
    const path = tab.path;
    pane.innerHTML = `<div class="ob-bar"><span class="dim small"><i class="codicon codicon-book"></i> ${this.L('Okuma görünümü', 'Reading view')}</span><span class="flex1"></span><button class="btn-mini" data-ob="edit"><i class="codicon codicon-edit"></i> ${this.L('Düzenle', 'Edit')} (⌘E)</button></div><div class="ob-page md-body"><div class="ob-title">${C.esc(path.split('/').pop().replace(/\.md$/i, ''))}</div><div class="ob-content"><p class="dim">…</p></div><div class="ob-backlinks"></div></div>`;
    pane.querySelector('[data-ob=edit]').addEventListener('click', () => this.show(false));
    try {
      await this.render(C.Ed.getValue(tab.model), path, pane.querySelector('.ob-content'));
    } catch (e) {
      // markdown-it indirilemediyse (çevrimdışı, ilk açılış) basit görünüm
      pane.querySelector('.ob-content').innerHTML = C.MD.render(C.Ed.getValue(tab.model)) + `<p class="dim small">${this.L('Tam Obsidian görünümü için bir kez internet gerekir.', 'Needs internet once.')}</p>`;
    }
    if (C.Tabs.active !== tab) return;
    pane.scrollTop = st;
    this.backlinks(path).then((bl) => {
      const box = pane.querySelector('.ob-backlinks'); if (!box || C.Tabs.active !== tab) return;
      if (!bl.length) { box.innerHTML = `<div class="ob-bl-title">${this.L('Bağlantılar', 'Backlinks')} <span class="dim">0</span></div>`; return; }
      box.innerHTML = `<div class="ob-bl-title">${this.L('Bu nota bağlantı verenler', 'Linked mentions')} <span class="dim">${bl.length}</span></div>` + bl.map((b) => `<div class="ob-bl-item" data-p="${C.esc(b.p)}"><div class="ob-bl-name"><i class="codicon codicon-file"></i> ${C.esc(b.p.split('/').pop().replace(/\.md$/i, ''))}</div><div class="dim small">…${C.esc(b.hit)}…</div></div>`).join('');
      box.querySelectorAll('.ob-bl-item').forEach((it) => it.addEventListener('click', () => this.openPath(it.dataset.p)));
    });
  },

  // ---------------------------------------------------------------- PDF & görsel görüntüleyici
  canView(p) { return /\.pdf$/i.test(p) || IMG_EXT.test(p); },
  async openViewer(p) {
    const C = this.ctx;
    const isPdf = /\.pdf$/i.test(p);
    C.Tabs.openVirtual('view:' + p, p.split('/').pop(), C.iconHTML(p), (root) => (isPdf ? this.pdfView(p, root) : this.imgView(p, root)));
    C.Explorer.selected = p; C.Explorer.render();
  },
  async annotate(p, root) {
    const C = this.ctx;
    try {
      const r = await C.native('pdf.annotate', { path: p, pencilOnly: C.SET.pencilOnly !== false, template: C.SET.notebookTemplate || 'lined' });
      if (r && r.saved) {
        if (this.pdfCache && this.pdfCache.has(p)) { try { this.pdfCache.get(p).destroy(); } catch (e) {} this.pdfCache.delete(p); }
        if (root && root.isConnected) this.pdfView(p, root);
        if ((this.ctx.Git)) (this.ctx.Git).scheduleRefresh();
      }
    } catch (e) { C.notify('error', 'PDF düzenleyici: ' + (e.message || e)); }
  },
  async newNotebook() {
    const C = this.ctx, tr = this.tr();
    const name = await C.inputBox({ prompt: tr ? 'Yeni not defterinin adı' : 'Notebook name', value: 'Notlar.pdf' });
    if (!name) return;
    const def = C.SET.notebookTemplate || 'lined';
    const tpl = await C.quickPick([{ label: 'Çizgili', id: 'lined' }, { label: 'Kareli', id: 'grid' }, { label: 'Noktalı', id: 'dotted' }, { label: 'Boş', id: 'blank' }].sort((a, b) => (b.id === def) - (a.id === def)), { placeholder: tr ? 'Sayfa şablonu' : 'Page template' });
    if (!tpl) return;
    const path = /\.pdf$/i.test(name) ? name : name + '.pdf';
    await C.native('pdf.create', { path, template: (tpl && tpl.id) || def, pages: Math.max(1, +C.SET.notebookPages || 3) });
    await C.Explorer.refresh();
    this.openViewer(path);
    setTimeout(() => this.annotate(path, null), 400);
  },
  async pdfjs() {
    await this.lib('pdf');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = this.ctx.CDN + LIBS.pdfWorker;
    return window.pdfjsLib;
  },
  async loadPdf(p) {
    this.pdfCache = this.pdfCache || new Map();
    if (this.pdfCache.has(p)) return this.pdfCache.get(p);
    const lib = await this.pdfjs();
    const data = b64ToBytes((await this.ctx.native('fs.readB64', { path: p })).b64);
    const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
    if (this.pdfCache.size > 4) { const [k, d] = this.pdfCache.entries().next().value; this.pdfCache.delete(k); try { d.destroy(); } catch (e) {} }
    this.pdfCache.set(p, doc);
    return doc;
  },
  async pdfThumbs(p, box, page) {
    const doc = await this.loadPdf(p);
    const pg = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
    const vp0 = pg.getViewport({ scale: 1 });
    const w = Math.min(box.clientWidth || 600, 700), scale = w / vp0.width, dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = pg.getViewport({ scale: scale * dpr });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; cv.style.width = w + 'px'; cv.className = 'ob-pdf-thumb';
    box.appendChild(cv);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    cv.addEventListener('click', () => this.openViewer(p));
  },
  async pdfView(p, root) {
    const C = this.ctx, tr = this.tr();
    root.classList.add('vd-diff');
    root.innerHTML = `<div class="pv-wrap"><div class="pv-bar">
        <i class="codicon codicon-zoom-out pv-btn" data-a="out" title="Uzaklaştır"></i><span class="pv-zoom">100%</span><i class="codicon codicon-zoom-in pv-btn" data-a="in" title="Yakınlaştır"></i>
        <i class="codicon codicon-screen-full pv-btn" data-a="fit" title="${tr ? 'Genişliğe sığdır' : 'Fit width'}"></i>
        <span class="pv-sep"></span><i class="codicon codicon-arrow-up pv-btn" data-a="prev"></i><input class="pv-page" value="1" inputmode="numeric"><span class="dim">/ <span class="pv-total">…</span></span><i class="codicon codicon-arrow-down pv-btn" data-a="next"></i>
        <span class="pv-sep"></span><input class="pv-find" placeholder="${tr ? 'PDF\'te ara…' : 'Find…'}" autocapitalize="off" autocorrect="off"><span class="dim small pv-findres"></span>
        <span class="flex1"></span><span class="pv-btn pv-edit" data-a="edit" title="Apple Pencil ile düzenle">✏️ ${tr ? 'Düzenle' : 'Annotate'}</span><i class="codicon codicon-link-external pv-btn" data-a="share" title="${tr ? 'Paylaş / başka uygulamada aç' : 'Share'}"></i></div>
      <div class="pv-pages"><div class="pv-loading dim">${tr ? 'PDF yükleniyor…' : 'Loading…'}</div></div></div>`;
    const pagesEl = root.querySelector('.pv-pages');
    let doc;
    try { doc = await this.loadPdf(p); }
    catch (e) { pagesEl.innerHTML = `<div class="pv-loading"><p>${tr ? 'PDF açılamadı' : 'Cannot open PDF'}: ${C.esc(e.message || e)}</p><p class="dim small">${tr ? 'PDF görüntüleyici ilk açılışta internetten indirilir; sonra çevrimdışı çalışır.' : ''}</p></div>`; return; }
    const st = (C.SET.pdfState = C.SET.pdfState || {})[p] || {};
    let zoom = st.zoom || 0; // 0 = genişliğe sığdır
    const n = doc.numPages;
    root.querySelector('.pv-total').textContent = n;
    const first = await doc.getPage(1);
    const base = first.getViewport({ scale: 1 });
    const fitScale = () => Math.max(0.3, (pagesEl.clientWidth - 32) / base.width);
    const scale = () => (zoom || fitScale());
    pagesEl.innerHTML = '';
    const slots = [];
    for (let i = 1; i <= n; i++) {
      const d = document.createElement('div'); d.className = 'pv-page-slot'; d.dataset.n = i;
      pagesEl.appendChild(d); slots.push(d);
    }
    const rendered = new Map();
    const layout = () => {
      const s = scale();
      root.querySelector('.pv-zoom').textContent = Math.round(s * 100) + '%';
      slots.forEach((d) => { d.style.width = base.width * s + 'px'; d.style.height = base.height * s + 'px'; });
      rendered.forEach((v, k) => { if (v.scale !== s) { v.el.remove(); rendered.delete(k); } });
      observeAll();
    };
    const renderPage = async (i) => {
      const s = scale();
      if (rendered.has(i) && rendered.get(i).scale === s) return;
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: s });
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const holder = document.createElement('div'); holder.className = 'pv-page-inner';
      const cv = document.createElement('canvas'); cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr); cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
      holder.appendChild(cv);
      const slot = slots[i - 1];
      const old = rendered.get(i); if (old) old.el.remove();
      rendered.set(i, { el: holder, scale: s });
      slot.appendChild(holder);
      slot.style.width = vp.width + 'px'; slot.style.height = vp.height + 'px';
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: pg.getViewport({ scale: s * dpr }) }).promise;
      // metin katmanı: seçme / kopyalama / arama vurgusu
      try {
        const tl = document.createElement('div'); tl.className = 'textLayer'; tl.style.setProperty('--scale-factor', s);
        holder.appendChild(tl);
        const tc = await pg.getTextContent();
        await window.pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp }).promise;
        if (findQ) markFind(tl);
      } catch (e) {}
    };
    let io;
    const observeAll = () => {
      if (io) io.disconnect();
      io = new IntersectionObserver((ents) => ents.forEach((en) => {
        const i = +en.target.dataset.n;
        if (en.isIntersecting) { renderPage(i); setPage(i, true); }
      }), { root: pagesEl, rootMargin: '600px 0px' });
      slots.forEach((s) => io.observe(s));
    };
    const pageInp = root.querySelector('.pv-page');
    let curPage = 1;
    const setPage = (i, fromScroll) => {
      if (fromScroll) {
        // görünür alanın ortasındaki sayfa
        const mid = pagesEl.scrollTop + pagesEl.clientHeight / 2;
        const s = slots.find((d) => d.offsetTop <= mid && d.offsetTop + d.offsetHeight >= mid);
        if (s) i = +s.dataset.n;
      }
      curPage = i; pageInp.value = i;
      st.page = i; C.SET.pdfState[p] = st; C.saveSettings();
    };
    const goto = (i) => { i = Math.min(n, Math.max(1, i)); pagesEl.scrollTop = slots[i - 1].offsetTop - 8; setPage(i); };
    let findQ = '';
    const markFind = (tl) => { tl.querySelectorAll('span').forEach((sp) => { sp.classList.toggle('pv-hit', !!findQ && sp.textContent.toLowerCase().includes(findQ)); }); };
    const find = async (q) => {
      findQ = q.trim().toLowerCase();
      root.querySelectorAll('.textLayer').forEach(markFind);
      const res = root.querySelector('.pv-findres');
      if (!findQ) { res.textContent = ''; return; }
      const hits = [];
      for (let i = 1; i <= n; i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        if (tc.items.map((it) => it.str).join(' ').toLowerCase().includes(findQ)) hits.push(i);
      }
      res.textContent = hits.length ? (tr ? `${hits.length} sayfada` : `${hits.length} pages`) : (tr ? 'yok' : 'none');
      const next = hits.find((h) => h > curPage) || hits[0];
      if (next) goto(next);
    };
    root.querySelector('.pv-find').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') find(e.target.value); });
    pageInp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') goto(+pageInp.value || 1); });
    const setZoom = (z) => { const keep = curPage; zoom = z; st.zoom = z; C.SET.pdfState[p] = st; C.saveSettings(); layout(); goto(keep); };
    root.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a, s = scale();
      if (a === 'in') setZoom(Math.min(5, s * 1.2));
      else if (a === 'out') setZoom(Math.max(0.3, s / 1.2));
      else if (a === 'fit') setZoom(0);
      else if (a === 'prev') goto(curPage - 1);
      else if (a === 'next') goto(curPage + 1);
      else if (a === 'share') C.native('app.share', { path: p });
      else if (a === 'edit') this.annotate(p, root);
    }));
    // iPad: iki parmakla yakınlaştırma (Safari gesture olayları)
    let g0 = null;
    pagesEl.addEventListener('gesturestart', (e) => { e.preventDefault(); g0 = scale(); });
    pagesEl.addEventListener('gesturechange', (e) => { e.preventDefault(); if (g0) { pagesEl.style.transformOrigin = 'top center'; pagesEl.querySelectorAll('.pv-page-slot').forEach((d) => { d.style.transform = `scale(${e.scale})`; d.style.transformOrigin = 'top center'; }); } });
    pagesEl.addEventListener('gestureend', (e) => { e.preventDefault(); pagesEl.querySelectorAll('.pv-page-slot').forEach((d) => { d.style.transform = ''; }); if (g0) { const z = Math.min(5, Math.max(0.3, g0 * e.scale)); g0 = null; setZoom(z); } });
    window.addEventListener('resize', () => { if (!zoom && root.isConnected) layout(); });
    layout();
    if (st.page > 1) setTimeout(() => goto(st.page), 50);
  },
  async imgView(p, root) {
    const C = this.ctx;
    root.classList.add('vd-diff');
    root.innerHTML = `<div class="iv-wrap"><img class="iv-img" alt=""><div class="iv-info dim small"></div></div>`;
    const img = root.querySelector('img'); let z = 1;
    img.addEventListener('load', () => { root.querySelector('.iv-info').textContent = `${img.naturalWidth} × ${img.naturalHeight}`; });
    try { img.src = await this.dataUrl(p); } catch (e) { root.innerHTML = `<p class="pv-loading">${C.esc(e.message || e)}</p>`; return; }
    img.addEventListener('click', () => { z = z === 1 ? 2 : 1; img.style.maxWidth = z === 1 ? '100%' : 'none'; img.style.width = z === 1 ? '' : img.naturalWidth + 'px'; });
  }
};

window.VSCModules.push((ctx) => { V.ctx = ctx; ctx.Viewer = V; ctx.MDView = V; });
window.VSCViewer = V;
})();
