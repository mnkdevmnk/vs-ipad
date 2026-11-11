/* VS iPad – Ayarlar düzenleyicisi (Mac'teki VS Code'un "Ayarlar" sekmesinin aynısı)
   • Arama (kimlik, başlık, açıklama), Kullanıcı / Çalışma Alanı kapsamı, soldaki içindekiler ağacı
   • Değiştirilen ayarın solunda mavi çizgi + ⚙ menüsü (sıfırla, kimliği kopyala, JSON olarak kopyala)
   • Çalışma Alanı = .vscode/settings.json (Mac'teki VS Code ile ortak dosya; editör ayarlarını geçersiz kılar)
   • VS Code'da olmayan iPad'e özel seçenekler: "iPad" kategorisi                                        */
(function () {
'use strict';
const TR = () => (window.VSC_LANG || 'tr') !== 'en';

// ---------------------------------------------------------------- şema
// key: SET alanı  |  m: Monaco seçeneği (SET.monaco içinde VS Code kimliğiyle saklanır)  |  ws: çalışma alanında geçersiz kılınabilir
const S = [];
const add = (cat, sub, id, o) => S.push(Object.assign({ cat, sub, id }, o));
const themeOpts = (C) => (C.Themes && C.Themes.all ? C.Themes.all().map((t) => [t.id, t.label || t.id]) : [[C.SET.theme, C.SET.theme]]);

function buildSchema() {
  if (S.length) return S;
  // ---- Metin Düzenleyici
  const E = 'editor', ED = 'Metin Düzenleyici';
  add(ED, 'Yazı Tipi', 'editor.fontSize', { key: 'fontSize', type: 'number', min: 6, max: 72, def: 14, ws: true, common: true, d: 'Piksel cinsinden yazı tipi boyutunu denetler.' });
  add(ED, 'Yazı Tipi', 'editor.fontFamily', { m: 'fontFamily', type: 'string', def: 'Menlo, ui-monospace, "SF Mono", monospace', ws: true, common: true, d: 'Yazı tipi ailesini denetler. iPad\'de yüklü yazı tipleri: Menlo, Courier, SF Mono (ui-monospace).' });
  add(ED, 'Yazı Tipi', 'editor.fontWeight', { m: 'fontWeight', type: 'enum', opts: ['normal', 'bold', '300', '500', '600'], def: 'normal', d: 'Yazı tipi kalınlığını denetler.' });
  add(ED, 'Yazı Tipi', 'editor.fontLigatures', { m: 'fontLigatures', type: 'bool', def: false, d: 'Yazı tipi bitişik harflerini (ligatures) etkinleştirir. Destekleyen bir yazı tipi gerekir.' });
  add(ED, 'Yazı Tipi', 'editor.lineHeight', { m: 'lineHeight', type: 'number', min: 0, max: 100, def: 0, ws: true, d: 'Satır yüksekliği. 0 = yazı tipi boyutundan otomatik hesaplanır; 8\'den küçük değerler çarpan olarak kullanılır.' });
  add(ED, 'Yazı Tipi', 'editor.letterSpacing', { m: 'letterSpacing', type: 'number', min: -5, max: 20, def: 0, d: 'Piksel cinsinden harf aralığı.' });
  add(ED, 'Biçimlendirme', 'editor.formatOnSave', { key: 'formatOnSave', type: 'bool', def: false, ws: true, common: true, d: 'Kaydederken dosyayı biçimlendirin. Yerleşik biçimlendiriciler: JSON, JavaScript, TypeScript, HTML, CSS. Files: Auto Save açıkken otomatik kayıtlarda da çalışır.' });
  add(ED, 'Biçimlendirme', 'editor.formatOnPaste', { m: 'formatOnPaste', type: 'bool', def: false, ws: true, d: 'Yapıştırılan içeriği otomatik biçimlendirir.' });
  add(ED, 'Biçimlendirme', 'editor.formatOnType', { m: 'formatOnType', type: 'bool', def: false, ws: true, d: 'Yazdıktan sonra satırı otomatik biçimlendirir.' });
  add(ED, 'Girinti', 'editor.tabSize', { key: 'tabSize', type: 'enum', opts: [[2, '2'], [4, '4'], [8, '8']], def: 4, ws: true, common: true, d: 'Bir sekmenin eşit olduğu boşluk sayısı.' });
  add(ED, 'Girinti', 'editor.insertSpaces', { key: 'insertSpaces', type: 'bool', def: true, ws: true, d: 'Tab tuşuna basıldığında boşluk ekler.' });
  add(ED, 'Görünüm', 'editor.wordWrap', { key: 'wordWrap', type: 'enum', opts: ['off', 'on', 'bounded'], def: 'off', ws: true, common: true, d: 'Satırların nasıl kaydırılacağını denetler. (iPad dikey kullanımda "on" önerilir.)' });
  add(ED, 'Görünüm', 'editor.lineNumbers', { key: 'lineNumbers', type: 'enum', opts: ['on', 'off', 'relative', 'interval'], def: 'on', ws: true, d: 'Satır numaralarının görüntülenmesini denetler.' });
  add(ED, 'Görünüm', 'editor.renderWhitespace', { m: 'renderWhitespace', type: 'enum', opts: ['none', 'boundary', 'selection', 'trailing', 'all'], def: 'selection', ws: true, common: true, d: 'Boşluk karakterlerinin nasıl çizileceğini denetler.' });
  add(ED, 'Görünüm', 'editor.renderLineHighlight', { m: 'renderLineHighlight', type: 'enum', opts: ['none', 'gutter', 'line', 'all'], def: 'line', d: 'Geçerli satırın vurgulanma şekli.' });
  add(ED, 'Görünüm', 'editor.rulers', { m: 'rulers', type: 'string', def: '', fmt: 'list', ws: true, d: 'Dikey cetveller, virgülle ayrılmış sütun numaraları (ör. 80, 120).' });
  add(ED, 'Görünüm', 'editor.bracketPairColorization.enabled', { m: 'bracketPairColorization.enabled', type: 'bool', def: true, d: 'Ayraç çiftlerini renklendirir.' });
  add(ED, 'Görünüm', 'editor.guides.bracketPairs', { m: 'guides.bracketPairs', type: 'enum', opts: [[false, 'false'], ['active', 'active'], [true, 'true']], def: false, d: 'Ayraç çifti kılavuz çizgileri.' });
  add(ED, 'Görünüm', 'editor.guides.indentation', { m: 'guides.indentation', type: 'bool', def: true, d: 'Girinti kılavuzlarını gösterir.' });
  add(ED, 'Görünüm', 'editor.stickyScroll.enabled', { key: 'stickyScroll', type: 'bool', def: true, ws: true, d: 'Kaydırırken iç içe kapsamları (fonksiyon, sınıf) editörün üstünde sabit gösterir.' });
  add(ED, 'Görünüm', 'editor.folding', { m: 'folding', type: 'bool', def: true, d: 'Kod katlamayı etkinleştirir.' });
  add(ED, 'Mini Harita', 'editor.minimap.enabled', { key: 'minimap', type: 'bool', def: true, ws: true, d: 'Mini haritanın gösterilip gösterilmeyeceğini denetler.' });
  add(ED, 'Mini Harita', 'editor.minimap.renderCharacters', { m: 'minimap.renderCharacters', type: 'bool', def: true, d: 'Satırda renk blokları yerine gerçek karakterleri gösterir.' });
  add(ED, 'Mini Harita', 'editor.minimap.side', { m: 'minimap.side', type: 'enum', opts: ['right', 'left'], def: 'right', d: 'Mini haritanın konumu.' });
  add(ED, 'İmleç', 'editor.cursorStyle', { m: 'cursorStyle', type: 'enum', opts: ['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'], def: 'line', common: true, d: 'İmleç stilini denetler.' });
  add(ED, 'İmleç', 'editor.cursorBlinking', { m: 'cursorBlinking', type: 'enum', opts: ['blink', 'smooth', 'phase', 'expand', 'solid'], def: 'blink', d: 'İmleç animasyon stili.' });
  add(ED, 'İmleç', 'editor.cursorSmoothCaretAnimation', { m: 'cursorSmoothCaretAnimation', type: 'enum', opts: ['off', 'explicit', 'on'], def: 'off', d: 'İmlecin yumuşak hareket animasyonu.' });
  add(ED, 'Kaydırma', 'editor.smoothScrolling', { m: 'smoothScrolling', type: 'bool', def: false, d: 'Editörün animasyonlu kaydırılması.' });
  add(ED, 'Kaydırma', 'editor.scrollBeyondLastLine', { m: 'scrollBeyondLastLine', type: 'bool', def: true, d: 'Son satırın ötesine kaydırmaya izin verir.' });
  add(ED, 'Öneriler', 'editor.quickSuggestions', { m: 'quickSuggestions', type: 'bool', def: true, ws: true, d: 'Yazarken önerileri otomatik gösterir.' });
  add(ED, 'Öneriler', 'editor.suggestOnTriggerCharacters', { m: 'suggestOnTriggerCharacters', type: 'bool', def: true, d: '"." gibi tetikleyici karakterlerde önerileri gösterir.' });
  add(ED, 'Öneriler', 'editor.acceptSuggestionOnEnter', { m: 'acceptSuggestionOnEnter', type: 'enum', opts: ['on', 'smart', 'off'], def: 'on', d: 'Enter tuşunun öneriyi kabul edip etmeyeceği. (iPad klavyesinde "off" yeni satırla karışmayı önler.)' });
  add(ED, 'Öneriler', 'editor.autoClosingBrackets', { m: 'autoClosingBrackets', type: 'enum', opts: ['always', 'languageDefined', 'beforeWhitespace', 'never'], def: 'languageDefined', d: 'Açılan ayracı otomatik kapatır.' });
  add(ED, 'Öneriler', 'editor.autoClosingQuotes', { m: 'autoClosingQuotes', type: 'enum', opts: ['always', 'languageDefined', 'beforeWhitespace', 'never'], def: 'languageDefined', d: 'Açılan tırnağı otomatik kapatır.' });
  add(ED, 'Öneriler', 'editor.linkedEditing', { m: 'linkedEditing', type: 'bool', def: false, d: 'HTML etiketlerini birlikte yeniden adlandırır.' });
  add(ED, 'Dosyalar', 'files.autoSave', { key: 'autoSave', type: 'enum', opts: [[false, 'off'], [true, 'afterDelay']], def: true, common: true, d: 'Kaydedilmemiş değişikliklere sahip düzenleyicilerin otomatik kaydedilmesini denetler.' });

  // ---- Çalışma Yeri
  const W = 'Çalışma Yeri';
  add(W, 'Görünüm', 'workbench.colorTheme', { key: 'theme', type: 'enum', opts: themeOpts, def: 'Dark 2026', common: true, d: 'Çalışma ekranında kullanılan renk teması.', apply: (C) => C.applyAll() });
  add(W, 'Görünüm', 'workbench.colorCustomizations', { type: 'action', label: 'Renk Teması Düzenleyiciyi Aç', run: (C) => C.cmd('pref.themeEditor'), d: 'Tema renklerini ve sözdizimi renklerini görsel olarak düzenle.' });
  add(W, 'Görünüm', 'workbench.activityBar', { type: 'action', label: 'Etkinlik Çubuğunu Özelleştir', run: (C) => C.cmd('view.customizeActivityBar'), d: 'Soldaki dikey çubuğun simgelerini sırala, gizle veya göster (simgeye uzun bas da olur).' });
  add(W, 'Görünüm', 'workbench.sideBar.visible', { key: 'sidebar', type: 'bool', def: true, d: 'Birincil kenar çubuğunu gösterir (⌘B).', apply: (C) => C.applyAll() });
  add(W, 'Görünüm', 'workbench.panel.visible', { key: 'panel', type: 'bool', def: true, d: 'Terminal / çıktı panelini gösterir (⌘J).', apply: (C) => C.applyAll() });
  add(W, 'Görünüm', 'workbench.sideBar.width', { key: 'sideW', type: 'number', min: 160, max: 700, def: 260, d: 'Kenar çubuğu genişliği (piksel). Kenarındaki tutamacı sürükleyerek de değiştirilebilir.', apply: (C) => C.applyAll() });
  add(W, 'Görünüm', 'workbench.panel.height', { key: 'panelH', type: 'number', min: 100, max: 900, def: 240, d: 'Panel yüksekliği (piksel).', apply: (C) => C.applyAll() });
  add(W, 'Dil', 'locale', { key: 'lang', type: 'enum', opts: [['tr', 'Türkçe'], ['en', 'English']], def: 'tr', d: 'Görüntüleme dili. Değişiklik yeniden yüklemeden sonra tamamen uygulanır.', apply: () => location.reload() });

  // ---- Pencere
  const P = 'Pencere';
  add(P, 'Pencere', 'window.reload', { type: 'action', label: 'Pencereyi Yeniden Yükle', run: (C) => C.cmd('dev.reload'), d: 'Arayüzü yeniden başlatır (Developer: Reload Window). Dosyalar ve ayarlar korunur.' });
  add(P, 'Pencere', 'window.shortcuts', { type: 'action', label: 'Klavye Kısayolları', run: (C) => C.showShortcuts(), d: 'Magic Keyboard / harici klavye kısayol listesi.' });
  add(P, 'Pencere', 'window.offline', { type: 'action', label: 'Çevrimdışı Kullanım İçin İndir', run: (C) => C.cmd('dev.offline'), d: 'Monaco, Pyodide, Clang ve kütüphaneleri önbelleğe alır; uçakta da çalışır.' });

  // ---- Çalıştır
  const R = 'Çalıştır';
  add(R, 'C / C++', 'run.cRunner', { key: 'cRunner', type: 'enum', opts: [['ask', 'Her çalıştırmada sor'], ['clang', 'clang (çevrimdışı)'], ['local', 'vsipad-cc (çevrimdışı)'], ['online', 'gcc (online)']], def: 'ask', common: true, d: 'C dosyaları için varsayılan derleyici. ▷ yanındaki ⌄ menüsünden tek seferlik başka derleyici seçilebilir.', apply: (C) => C.syncRun() });
  add(R, 'C / C++', 'run.cppRunner', { key: 'cppRunner', type: 'enum', opts: [['ask', 'Her çalıştırmada sor'], ['clang', 'clang++ (çevrimdışı)'], ['online', 'g++ (online)']], def: 'ask', d: 'C++ dosyaları için varsayılan derleyici.', apply: (C) => C.syncRun() });
  add(R, 'C / C++', 'run.cflags', { key: 'cflags', type: 'string', def: '', ws: true, d: 'Derleyiciye eklenecek bayraklar (ör. -O2 -Wall -lm).' });
  add(R, 'Python', 'run.pyRunner', { key: 'pyRunner', type: 'enum', opts: [['local', 'Pyodide (çevrimdışı)'], ['remote', 'CPython (online)']], def: 'local', d: 'Python yorumlayıcısı.', apply: (C) => C.syncRun() });
  add(R, 'Genel', 'run.service', { key: 'runner', type: 'enum', opts: [['auto', 'Otomatik'], ['wandbox', 'Wandbox'], ['godbolt', 'Compiler Explorer']], def: 'auto', d: 'Java / C# / Rust ve online C/C++ için derleme servisi.', apply: (C) => C.syncRun() });
  add(R, 'Genel', 'run.args', { key: 'args', type: 'string', def: '', ws: true, d: 'Programa verilecek komut satırı argümanları (argv).' });
  add(R, 'Genel', 'run.stdin', { key: 'stdin', type: 'string', def: '', ws: true, d: 'Program girdisi (stdin) – boşsa terminalde sorulur. Satırları ; ile ayır.', fmt: 'stdin' });

  // ---- Özellikler
  const F = 'Özellikler';
  add(F, 'Markdown', 'markdown.preview.openReading', { key: 'mdReading', type: 'bool', def: true, d: '.md dosyaları Obsidian gibi okuma görünümünde açılsın (⌘E ile geçiş).' });
  add(F, 'Markdown', 'markdown.math.enabled', { key: 'mdMath', type: 'bool', def: true, d: 'KaTeX matematik ($...$, $$...$$) işlensin.', apply: (C) => C.MD && C.MD.refresh && C.MD.refresh() });
  add(F, 'Git', 'git.settings', { type: 'action', label: 'GitHub Hesabı / Depo Bağlantısı', run: (C) => C.showView('git'), d: 'GitHub token\'ı ve bağlı depo. Token Anahtar Zinciri\'nde saklanır, dosyalara yazılmaz.' });
  add(F, 'Sohbet', 'chat.claude', { type: 'action', label: 'Claude Ayarları', run: (C) => C.cmd('agent.settings'), d: 'API anahtarı ve model.' });
  add(F, 'Sohbet', 'chat.gemini', { type: 'action', label: 'Gemini · AG Ayarları', run: (C) => C.cmd('ag.settings'), d: 'API anahtarı ve model.' });
  add(F, 'ESP32', 'esp32.settings', { type: 'action', label: 'Kart ve Wi-Fi Ayarları', run: (C) => C.cmd('esp32.settings'), d: 'ESP32-S3 kartı, Wi-Fi / Bluetooth bağlantısı.' });
  add(F, 'VS Code Pets', 'vscode-pets.theme', { key: 'petsBg', type: 'enum', opts: ['none', 'forest', 'castle', 'beach', 'winter'], def: 'none', d: 'Evcil hayvan panelinin arka planı.', apply: (C) => C.onThemeChanged && C.onThemeChanged() });
  add(F, 'Profil', 'settings.sync', { type: 'action', label: 'VS Code\'dan İçe Aktar', run: (C) => C.cmd('vscode.import'), d: 'Mac\'teki VS Code profilinden (.code-profile) ayarları, kısayolları, snippet\'leri al.' });
  add(F, 'Profil', 'settings.export', { type: 'action', label: 'VS Code İçin Dışa Aktar', run: (C) => C.cmd('vscode.export'), d: 'Buradaki ayarları Mac\'teki VS Code\'a aktarılabilir profil olarak kaydet.' });

  // ---- iPad (VS Code'da yok)
  const I = 'iPad';
  add(I, 'Dokunmatik', 'ipad.touchSize', { key: 'touchSize', type: 'enum', opts: [[0, 'Normal (Mac boyutu)'], [1, 'Büyük (önerilen)'], [2, 'Çok büyük']], def: 1, common: true, d: 'Buton, sekme, satır ve menü boyutu. Editör yazı boyutunu değiştirmez.', apply: (C) => C.applyTouch() });
  add(I, 'Dokunmatik', 'ipad.pinchZoom', { key: 'pinchZoom', type: 'bool', def: true, d: 'Editörde iki parmakla kıstırarak yazı boyutunu büyüt / küçült.' });
  add(I, 'Klavye', 'ipad.fixSmartQuotes', { key: 'fixQuotes', type: 'bool', def: true, d: 'iPad klavyesinin “akıllı tırnak” ve uzun tire (— –) dönüşümlerini koddaki düz karakterlere çevirir. C\'de "string" hatalarını önler.' });
  add(I, 'Klavye', 'ipad.dismissKeyboardOnRun', { key: 'dismissKbOnRun', type: 'bool', def: true, d: 'Çalıştırınca ekran klavyesini kapatır, terminal çıktısı görünür.' });
  add(I, 'Apple Pencil', 'ipad.pencil.pencilOnly', { key: 'pencilOnly', type: 'bool', def: true, d: 'PDF düzenleyicide yalnızca Apple Pencil çizsin, parmak sayfayı kaydırsın (avuç içi koruması).' });
  add(I, 'Apple Pencil', 'ipad.pencil.template', { key: 'notebookTemplate', type: 'enum', opts: [['lined', 'Çizgili'], ['grid', 'Kareli'], ['dotted', 'Noktalı'], ['blank', 'Boş']], def: 'lined', d: '"Yeni Not Defteri" ve "Sayfa ekle" için varsayılan şablon.' });
  add(I, 'Apple Pencil', 'ipad.pencil.pages', { key: 'notebookPages', type: 'number', min: 1, max: 50, def: 3, d: 'Yeni not defterinin sayfa sayısı.' });
  add(I, 'Ekran', 'ipad.statusBarColor', { key: 'chromeSync', type: 'bool', def: true, d: 'iPad durum çubuğunun (saat, pil) rengini temaya uydurur.', apply: (C) => C.applyAll() });
  add(I, 'Ekran', 'ipad.appIcon', { key: 'appIcon', type: 'enum', opts: [['auto', 'Otomatik (iPad temasına göre)'], ['dark', 'Koyu'], ['light', 'Açık'], ['line', 'Çizgi']], def: 'auto', common: true, d: 'Ana ekrandaki uygulama ikonu. Otomatik: iPad açık temadayken açık, koyu temadayken koyu ikon (iPadOS 18+). Değiştirince iPadOS bir onay mesajı gösterir.', apply: (C) => C.native('app.icon.set', { name: C.SET.appIcon }).catch((e) => C.notify('error', 'İkon değiştirilemedi: ' + (e && e.message || e))) });
  add(I, 'Ekran', 'ipad.reduceMotion', { key: 'reduceMotion', type: 'bool', def: false, d: 'Animasyonları azaltır (pil tasarrufu).', apply: () => document.body.classList.toggle('reduce-motion', !!window.__vsSET.reduceMotion) });

  // ---- Uzantılar (dinamik)
  return S;
}
const CATS = ['Sık Kullanılan', 'Metin Düzenleyici', 'Çalışma Yeri', 'Pencere', 'Çalıştır', 'Özellikler', 'iPad', 'Uzantılar'];
const CAT_ICON = { iPad: 'device-mobile' };

// ---------------------------------------------------------------- modül
const Settings = {
  ctx: null, scope: 'user', query: '', cat: 'Sık Kullanılan', wsVals: {}, root: null,

  init(C) {
    this.ctx = C; window.__vsSET = C.SET; buildSchema();
    C.SET.monaco = C.SET.monaco || {};
    C.cmd = (id) => C.Commands ? C.Commands.run(id) : window.VSC.cmd(id);
    document.body.classList.toggle('reduce-motion', !!C.SET.reduceMotion);
    this.bindPinch();
  },
  // ---- değerler
  defOf(s) { return s.def; },
  userVal(s) {
    const SET = this.ctx.SET;
    if (s.key) return SET[s.key] === undefined ? s.def : SET[s.key];
    if (s.m) return SET.monaco[s.id] === undefined ? s.def : SET.monaco[s.id];
    return undefined;
  },
  val(s) { return this.scope === 'workspace' ? (s.id in this.wsVals ? this.wsVals[s.id] : this.userVal(s)) : this.userVal(s); },
  isModified(s) {
    if (s.type === 'action') return false;
    if (this.scope === 'workspace') return s.id in this.wsVals;
    const v = this.userVal(s); return JSON.stringify(v) !== JSON.stringify(s.def);
  },
  async set(s, v) {
    const C = this.ctx, SET = C.SET;
    if (this.scope === 'workspace') {
      if (v === undefined) delete this.wsVals[s.id]; else this.wsVals[s.id] = v;
      await this.saveWorkspace();
    } else {
      if (s.key) { if (v === undefined) SET[s.key] = s.def; else SET[s.key] = v; }
      else if (s.m) { if (v === undefined || JSON.stringify(v) === JSON.stringify(s.def)) delete SET.monaco[s.id]; else SET.monaco[s.id] = v; }
      C.saveSettings();
    }
    this.applyEditor();
    if (s.apply) try { s.apply(C); } catch (e) {}
    C.Tabs && C.Tabs.updateChrome && C.Tabs.updateChrome();
  },
  // Ed.options() bunu çağırır: kullanıcı Monaco ayarları + çalışma alanı geçersiz kılmaları
  editorOptions() {
    const out = {}, SET = this.ctx ? this.ctx.SET : {};
    const put = (path, v) => { const ks = path.split('.'); let o = out; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = Object.assign({}, o[ks[i]]); o[ks[ks.length - 1]] = v; };
    const conv = (s, v) => (s.fmt === 'list' ? String(v || '').split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => !isNaN(n)) : v);
    for (const s of S) {
      if (s.m && SET.monaco && s.id in SET.monaco) put(s.m, conv(s, SET.monaco[s.id]));
      if (s.id in this.wsVals) {
        const v = this.wsVals[s.id];
        if (s.m) put(s.m, conv(s, v));
        else if (s.key === 'fontSize') out.fontSize = v;
        else if (s.key === 'wordWrap') out.wordWrap = v;
        else if (s.key === 'minimap') put('minimap.enabled', v);
        else if (s.key === 'lineNumbers') out.lineNumbers = v;
        else if (s.key === 'stickyScroll') put('stickyScroll.enabled', v);
      }
    }
    return out;
  },
  eff(key) { // çalışma alanı geçersiz kılmasıyla geçerli değer (tabSize, insertSpaces, formatOnSave, cflags…)
    const s = S.find((x) => x.key === key);
    if (s && s.id in this.wsVals) return this.wsVals[s.id];
    const v = this.ctx.SET[key]; return v === undefined && s ? s.def : v;
  },
  applyEditor() {
    const C = this.ctx; if (!C) return;
    try { C.Ed && C.Ed.options(); } catch (e) {}
    const ts = +this.eff('tabSize') || 4, sp = this.eff('insertSpaces') !== false;
    (C.Tabs ? C.Tabs.list : []).forEach((t) => { if (t.model && !t.model.fallback && t.model.updateOptions) t.model.updateOptions({ tabSize: ts, insertSpaces: sp }); });
  },
  // Tabs.save() kaydetmeden önce çağırır
  async beforeSave(tab) {
    if (!this.eff('formatOnSave')) return;
    const C = this.ctx, ed = C.editor && C.editor();
    if (!ed || !ed.getModel || ed.getModel() !== tab.model) return;
    const a = ed.getAction('editor.action.formatDocument');
    if (a && a.isSupported()) { try { await a.run(); } catch (e) {} }
  },
  // ---- çalışma alanı: .vscode/settings.json
  async loadWorkspace() {
    this.wsVals = {};
    try {
      const txt = (await this.ctx.native('fs.read', { path: '.vscode/settings.json' })).content;
      const j = (window.VSCThemes && window.VSCThemes.parseJsonc) ? window.VSCThemes.parseJsonc(txt) : JSON.parse(txt);
      for (const s of S) if (s.ws && j && s.id in j) this.wsVals[s.id] = j[s.id];
      this.wsRaw = j || {};
    } catch (e) { this.wsRaw = {}; }
    this.applyEditor();
    if (this.root && this.root.isConnected) this.render();
  },
  async saveWorkspace() {
    const j = Object.assign({}, this.wsRaw || {});
    for (const s of S) if (s.ws) { if (s.id in this.wsVals) j[s.id] = this.wsVals[s.id]; else delete j[s.id]; }
    this.wsRaw = j;
    try { await this.ctx.native('fs.mkdir', { path: '.vscode' }); } catch (e) {}
    await this.ctx.native('fs.write', { path: '.vscode/settings.json', content: JSON.stringify(j, null, 4) + '\n' });
    try { this.ctx.Explorer.refresh(); } catch (e) {}
  },
  onFileSaved(path) { if (path === '.vscode/settings.json') this.loadWorkspace(); },
  // vscsync içe aktarırken Monaco ayarlarını da alır
  importVSCode(vs) {
    let n = 0; const SET = this.ctx.SET; SET.monaco = SET.monaco || {};
    for (const s of buildSchema()) {
      if (!(s.id in vs)) continue;
      let v = vs[s.id];
      if (s.fmt === 'list' && Array.isArray(v)) v = v.join(', ');
      if (s.m) { SET.monaco[s.id] = v; n++; }
      else if (s.key && ['formatOnSave', 'insertSpaces', 'cflags'].includes(s.key)) { SET[s.key] = v; n++; }
    }
    return n;
  },
  exportVSCode() { // kullanıcı ayarlarını VS Code kimlikleriyle
    const o = {};
    for (const s of S) { if (s.type === 'action' || s.cat === 'iPad' || s.id.startsWith('run.')) continue; const v = this.userVal(s); if (JSON.stringify(v) !== JSON.stringify(s.def)) o[s.id] = s.fmt === 'list' ? String(v).split(/[,\s]+/).filter(Boolean).map(Number) : v; }
    return o;
  },
  // ---- iPad: kıstırarak yazı boyutu
  bindPinch() {
    let base = 0;
    const host = () => document.getElementById('editor-host') || document.getElementById('editor-part');
    document.addEventListener('gesturestart', (e) => { const h = host(); if (!this.ctx.SET.pinchZoom || !h || !h.contains(e.target) || document.body.classList.contains('md-reading')) return; e.preventDefault(); base = this.ctx.SET.fontSize; }, { passive: false });
    document.addEventListener('gesturechange', (e) => { if (!base) return; e.preventDefault(); const f = Math.round(Math.min(40, Math.max(8, base * e.scale))); if (f !== this.ctx.SET.fontSize) { this.ctx.SET.fontSize = f; this.ctx.Ed.options(); } }, { passive: false });
    document.addEventListener('gestureend', () => { if (!base) return; base = 0; this.ctx.saveSettings(); this.ctx.notify('info', 'Yazı boyutu: ' + this.ctx.SET.fontSize, { timeout: 1200 }); if (this.root && this.root.isConnected) this.render(); });
  },

  // ---------------------------------------------------------------- arayüz
  open(query) {
    const C = this.ctx;
    if (query != null) this.query = query;
    C.Tabs.openVirtual('settings', TR() ? 'Ayarlar' : 'Settings', '<i class="codicon codicon-settings"></i>', (root) => { this.root = root; this.mount(root); });
  },
  extItems() {
    const C = this.ctx, X = C.Exts; if (!X) return [];
    return X.list.filter((e) => X.toggleable.has(e.id)).map((e) => ({ cat: 'Uzantılar', sub: e.publisher || 'Uzantı', id: e.id, title: e.name || e.id, type: 'bool', def: true, dyn: true,
      d: (e.desc || '') + ' – ' + (TR() ? 'etkin' : 'enabled'), get: () => !(C.SET.ext && C.SET.ext[e.id] === false),
      setV: (v) => { try { X.setEnabled(e.id, v); } catch (err) { C.SET.ext = Object.assign({}, C.SET.ext, { [e.id]: v }); C.saveSettings(); } } }));
  },
  mount(root) {
    root.classList.add('vd-diff');
    const tr = TR();
    root.innerHTML = `<div class="st-wrap">
      <div class="st-top">
        <div class="st-search"><i class="codicon codicon-search"></i><input class="st-q" placeholder="${tr ? 'Arama ayarları (ör. font, tab, ipad, @modified)' : 'Search settings'}" autocapitalize="off" autocorrect="off" spellcheck="false"><span class="st-count dim"></span><i class="codicon codicon-filter st-ic" data-a="filter" title="@modified – yalnızca değiştirilenler"></i><i class="codicon codicon-clear-all st-ic" data-a="clear" title="Temizle"></i></div>
        <div class="st-scopes"><span class="st-scope" data-s="user">${tr ? 'Kullanıcı' : 'User'}</span><span class="st-scope" data-s="workspace">${tr ? 'Çalışma Alanı' : 'Workspace'}</span>
          <span class="flex1"></span><i class="codicon codicon-json st-ic" data-a="json" title="${tr ? 'Ayarları JSON olarak aç' : 'Open Settings (JSON)'}"></i></div>
      </div>
      <div class="st-body"><div class="st-toc"></div><div class="st-list"></div></div></div>`;
    const q = root.querySelector('.st-q');
    q.value = this.query;
    q.addEventListener('input', () => { this.query = q.value; this.renderList(true); });
    q.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { q.value = ''; this.query = ''; this.renderList(true); } });
    root.querySelectorAll('.st-scope').forEach((el) => el.addEventListener('click', () => { this.scope = el.dataset.s; this.render(); }));
    root.querySelector('[data-a=clear]').addEventListener('click', () => { q.value = this.query = ''; this.renderList(true); q.focus(); });
    root.querySelector('[data-a=filter]').addEventListener('click', () => { q.value = this.query = this.query.includes('@modified') ? this.query.replace('@modified', '').trim() : ('@modified ' + this.query).trim(); this.renderList(true); });
    root.querySelector('[data-a=json]').addEventListener('click', () => this.openJson());
    const list = root.querySelector('.st-list');
    list.addEventListener('scroll', () => { if (this.query) return; const hs = [...list.querySelectorAll('.st-cat-h')]; let cur = hs[0]; for (const h of hs) if (h.offsetTop - list.scrollTop < 60) cur = h; if (cur) this.markToc(cur.dataset.cat); }, { passive: true });
    this.render();
    if (!this.ctx.IS_TOUCH) setTimeout(() => q.focus(), 50);
  },
  render() {
    if (!this.root) return;
    this.root.querySelectorAll('.st-scope').forEach((el) => el.classList.toggle('on', el.dataset.s === this.scope));
    this.renderList(false);
  },
  items() {
    let all = S.concat(this.extItems());
    if (this.scope === 'workspace') all = all.filter((s) => s.ws);
    return all;
  },
  match(s, terms, modOnly) {
    if (modOnly && !this.isModified(s)) return false;
    if (!terms.length) return true;
    const hay = (s.id + ' ' + s.cat + ' ' + s.sub + ' ' + (s.title || '') + ' ' + (s.d || '') + ' ' + (s.label || '')).toLowerCase();
    return terms.every((t) => hay.includes(t));
  },
  renderList(fromSearch) {
    const root = this.root, tr = TR(); if (!root) return;
    const list = root.querySelector('.st-list'), toc = root.querySelector('.st-toc');
    const modOnly = this.query.includes('@modified');
    const terms = this.query.replace('@modified', '').toLowerCase().split(/\s+/).filter(Boolean);
    const searching = terms.length || modOnly;
    const items = this.items().filter((s) => this.match(s, terms, modOnly));
    root.querySelector('.st-count').textContent = searching ? `${items.length} ${tr ? 'ayar bulundu' : 'settings found'}` : '';
    // içindekiler
    const cats = CATS.filter((c) => this.scope === 'user' || c !== 'Uzantılar');
    toc.innerHTML = cats.map((c) => {
      const n = c === 'Sık Kullanılan' ? items.filter((s) => s.common).length : items.filter((s) => s.cat === c).length;
      return `<div class="st-toc-i${n ? '' : ' dim'}" data-cat="${c}">${CAT_ICON[c] ? `<i class="codicon codicon-${CAT_ICON[c]}"></i> ` : ''}${c}${searching && n ? ` <span class="st-toc-n">(${n})</span>` : ''}</div>`;
    }).join('');
    toc.querySelectorAll('.st-toc-i').forEach((el) => el.addEventListener('click', () => {
      const h = list.querySelector(`.st-cat-h[data-cat="${el.dataset.cat}"]`);
      if (h) list.scrollTo({ top: h.offsetTop - 8, behavior: 'smooth' });
      this.markToc(el.dataset.cat);
    }));
    // liste
    list.innerHTML = '';
    const groups = cats.map((c) => [c, c === 'Sık Kullanılan' ? (searching ? [] : items.filter((s) => s.common)) : items.filter((s) => s.cat === c)]).filter((g) => g[1].length);
    if (!groups.length) list.innerHTML = `<div class="st-empty dim">${tr ? 'Ayar bulunamadı.' : 'No settings found.'}${this.scope === 'workspace' ? `<br><br>${tr ? 'Çalışma alanı kapsamında yalnızca editör, çalıştırma ve dosya ayarları geçersiz kılınabilir. Değerler .vscode/settings.json dosyasına yazılır (Mac\'teki VS Code ile ortak).' : ''}` : ''}</div>`;
    for (const [c, arr] of groups) {
      const h = document.createElement('div'); h.className = 'st-cat-h'; h.dataset.cat = c;
      h.innerHTML = `<h2>${c === 'iPad' ? '<i class="codicon codicon-device-mobile"></i> ' : ''}${c}</h2>${c === 'iPad' ? `<div class="dim st-cat-note">${tr ? 'Mac\'teki VS Code\'da olmayan, VS iPad\'e özel seçenekler.' : 'Options only in VS iPad.'}</div>` : ''}`;
      list.appendChild(h);
      let lastSub = null;
      for (const s of arr) {
        if (c !== 'Sık Kullanılan' && s.sub !== lastSub && !searching) { const sh = document.createElement('div'); sh.className = 'st-sub-h'; sh.textContent = s.sub; list.appendChild(sh); lastSub = s.sub; }
        list.appendChild(this.renderItem(s));
      }
    }
    if (!fromSearch) this.markToc(this.cat);
    else list.scrollTop = 0;
  },
  markToc(cat) { this.cat = cat; this.root && this.root.querySelectorAll('.st-toc-i').forEach((el) => el.classList.toggle('on', el.dataset.cat === cat)); },
  title(s) {
    if (s.title) return `<b>${this.ctx.esc(s.title)}</b>`;
    const parts = s.id.split('.');
    const nice = (w) => w.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (x) => x.toUpperCase());
    const head = parts.length > 1 ? parts.slice(0, -1).map(nice).join(' › ') + ': ' : '';
    return `${head}<b>${nice(parts[parts.length - 1])}</b>`;
  },
  renderItem(s) {
    const C = this.ctx, tr = TR();
    const el = document.createElement('div');
    const mod = s.dyn ? false : this.isModified(s);
    el.className = 'st-item' + (mod ? ' mod' : '');
    const v = s.dyn ? s.get() : this.val(s);
    const wsNote = this.scope === 'user' && s.id in this.wsVals ? `<span class="st-wsnote">${tr ? '(Çalışma alanında da değiştirildi)' : '(Also modified in Workspace)'}</span>` : '';
    let ctl = '';
    const esc = C.esc;
    if (s.type === 'bool') ctl = `<label class="st-check"><input type="checkbox" ${v ? 'checked' : ''}><span>${esc(s.d || '')}</span></label>`;
    else if (s.type === 'number') ctl = `<input class="st-in st-num" type="number" inputmode="numeric" value="${esc(String(v))}" ${s.min != null ? `min="${s.min}"` : ''} ${s.max != null ? `max="${s.max}"` : ''}>`;
    else if (s.type === 'string') ctl = `<input class="st-in st-str" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(s.fmt === 'stdin' ? String(v || '').replace(/\n/g, ';') : String(v == null ? '' : v))}">`;
    else if (s.type === 'enum') {
      const opts = (typeof s.opts === 'function' ? s.opts(C) : s.opts).map((o) => (Array.isArray(o) ? o : [o, String(o)]));
      ctl = `<select class="st-in st-sel">${opts.map(([ov, ol], i) => `<option value="${i}" ${JSON.stringify(ov) === JSON.stringify(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
      el._opts = opts;
    } else if (s.type === 'action') ctl = `<button class="st-btn">${esc(s.label)}</button>`;
    el.innerHTML = `<div class="st-gear codicon codicon-gear" title="${tr ? 'Diğer eylemler' : 'More actions'}"></div>
      <div class="st-t">${this.title(s)} ${wsNote}</div>
      ${s.type !== 'bool' ? `<div class="st-d">${esc(s.d || '')}</div>` : ''}
      <div class="st-c">${ctl}</div>`;
    const commit = (nv) => { if (s.dyn) { s.setV(nv); this.renderList(false); return; } this.set(s, nv).then(() => { el.classList.toggle('mod', this.isModified(s)); }); };
    const inp = el.querySelector('input, select, button');
    if (s.type === 'bool') inp.addEventListener('change', () => commit(inp.checked));
    else if (s.type === 'number') inp.addEventListener('change', () => { let n = +inp.value; if (isNaN(n)) return; if (s.min != null) n = Math.max(s.min, n); if (s.max != null) n = Math.min(s.max, n); inp.value = n; commit(n); });
    else if (s.type === 'string') { inp.addEventListener('change', () => commit(s.fmt === 'stdin' ? inp.value.replace(/;\s*/g, '\n') : inp.value)); inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); }); }
    else if (s.type === 'enum') inp.addEventListener('change', () => commit(el._opts[+inp.value][0]));
    else if (s.type === 'action') inp.addEventListener('click', () => s.run(C));
    if (s.type === 'number') inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
    el.querySelector('.st-gear').addEventListener('click', (e) => {
      e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect();
      const items = [];
      if (!s.dyn && s.type !== 'action') items.push({ label: tr ? 'Ayarı Sıfırla' : 'Reset Setting', disabled: !this.isModified(s), run: () => this.set(s, undefined).then(() => this.renderList(false)) });
      items.push({ label: tr ? 'Ayar Kimliğini Kopyala' : 'Copy Setting ID', run: () => this.copy(s.id) });
      if (s.type !== 'action') items.push({ label: tr ? 'Ayarı JSON Olarak Kopyala' : 'Copy Setting as JSON', run: () => this.copy(`"${s.id}": ${JSON.stringify(s.dyn ? s.get() : this.val(s))}`) });
      if (this.scope === 'user' && s.ws && !s.dyn) items.push('-', { label: tr ? 'Çalışma alanında geçersiz kıl' : 'Override in Workspace', run: () => { this.scope = 'workspace'; this.wsVals[s.id] = this.userVal(s); this.saveWorkspace(); this.render(); } });
      C.Menu.show(items, r.left, r.bottom + 2);
    });
    return el;
  },
  copy(t) { try { navigator.clipboard.writeText(t); this.ctx.notify('info', (TR() ? 'Kopyalandı: ' : 'Copied: ') + t, { timeout: 1500 }); } catch (e) {} },
  async openJson() {
    const C = this.ctx;
    if (this.scope === 'workspace') { if (!this.wsRaw || !C.Explorer.exists('.vscode/settings.json')) await this.saveWorkspace(); C.Tabs.open('.vscode/settings.json'); return; }
    const json = JSON.stringify(this.exportVSCode(), null, 4);
    C.openDiff('settings.json (Kullanıcı – VS Code kimlikleriyle)', '', json, 'settings.json', { id: 'user-settings-json', suffix: '' });
    C.notify('info', TR() ? 'Bu, ayarlarının VS Code biçimidir (salt okunur). Mac\'e aktarmak için: Özellikler › Profil › VS Code İçin Dışa Aktar.' : 'Read-only view.', { timeout: 5000 });
  }
};

window.VSCModules = window.VSCModules || [];
window.VSCModules.push((ctx) => { Settings.init(ctx); ctx.Settings = Settings; });
window.VSCSettings = Settings;
})();
