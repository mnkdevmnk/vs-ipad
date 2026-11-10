/* ==========================================================================
   VS iPad – eklenti katmanı
   Mac'teki VS Code eklentilerinden taşınanlar (Web/ext/ klasörü):
     • Material Icon Theme (pkief)          – dosya/klasör ikonları (orijinal SVG'ler)
     • Turkish Language Pack (ms-ceintl)    – arayüz Türkçe
     • vscode-pets (tonybaloney)            – Gezgin'de evcil hayvanlar (orijinal GIF'ler)
     • Better Comments (aaron-bond)         – ! ? TODO * // yorum renkleri
   ========================================================================== */
(function () {
'use strict';

// ------------------------------------------------------------------ Türkçe çeviri (VS Code Türkçe dil paketi terimleri)
const TR = {
  // kenar çubuğu / paneller
  'EXPLORER': 'GEZGİN', 'OPEN EDITORS': 'AÇIK DÜZENLEYİCİLER', 'OUTLINE': 'ANAHAT', 'TIMELINE': 'ZAMAN ÇİZELGESİ',
  'SEARCH': 'ARA', 'SOURCE CONTROL': 'KAYNAK DENETİMİ', 'RUN AND DEBUG': 'ÇALIŞTIR VE HATA AYIKLA', 'EXTENSIONS': 'UZANTILAR',
  'INSTALLED': 'YÜKLÜ', 'RECOMMENDED': 'ÖNERİLEN', 'NOT SUPPORTED ON IPAD': 'IPAD\'DE DESTEKLENMİYOR', 'VS CODE PETS': 'VS CODE PETS',
  'PROBLEMS': 'SORUNLAR', 'OUTPUT': 'ÇIKTI', 'DEBUG CONSOLE': 'HATA AYIKLAMA KONSOLU', 'TERMINAL': 'TERMİNAL', 'PORTS': 'BAĞLANTI NOKTALARI',
  'Search': 'Ara', 'Replace': 'Değiştir', 'Search Extensions in Marketplace': 'Markette Uzantı Ara',
  'Match Case': 'Büyük/Küçük Harf Eşleştir', 'Match Whole Word': 'Sözcüğün Tamamını Eşleştir', 'Use Regular Expression': 'Normal İfade Kullan', 'Replace All': 'Tümünü Değiştir',
  'New File...': 'Yeni Dosya...', 'New Folder...': 'Yeni Klasör...', 'Refresh Explorer': 'Gezgini Yenile', 'Collapse Folders in Explorer': 'Gezgindeki Klasörleri Daralt',
  'Open Folder': 'Klasör Aç', 'You have not yet opened a folder.': 'Henüz bir klasör açmadınız.',
  'Run and Debug': 'Çalıştır ve Hata Ayıkla', 'Running… (Stop)': 'Çalışıyor… (Durdur)',
  'Active file': 'Etkin dosya', 'Standard input (stdin)': 'Standart girdi (stdin)', 'Program arguments': 'Program bağımsız değişkenleri',
  'C++ / Java / C# servisi': 'C++ / Java / C# servisi', 'Offline': 'Çevrimdışı',
  "The folder currently open doesn't have a git repository.": 'Şu anda açık olan klasörde git deposu yok.',
  'Show All Commands': 'Tüm Komutları Göster', 'Go to File': 'Dosyaya Git', 'Find in Files': 'Dosyalarda Bul', 'Run Code': 'Kodu Çalıştır', 'Toggle Terminal': 'Terminali Aç/Kapat',
  'No problems have been detected in the workspace.': 'Çalışma alanında sorun algılanmadı.', 'No forwarded ports.': 'İletilen bağlantı noktası yok.',
  'New Terminal': 'Yeni Terminal', 'Clear': 'Temizle', 'Stop': 'Durdur', 'Maximize Panel Size': 'Panel Boyutunu En Üst Düzeye Çıkar', 'Hide Panel': 'Paneli Gizle',
  'Toggle Primary Side Bar (⌘B)': 'Birincil Yan Çubuğu Aç/Kapat (⌘B)', 'Toggle Panel (⌘J)': 'Paneli Aç/Kapat (⌘J)', 'Toggle Secondary Side Bar': 'İkincil Yan Çubuğu Aç/Kapat', 'Customize Layout...': 'Düzeni Özelleştir...',
  'Explorer (⇧⌘E)': 'Gezgin (⇧⌘E)', 'Search (⇧⌘F)': 'Ara (⇧⌘F)', 'Source Control (⌃⇧G)': 'Kaynak Denetimi (⌃⇧G)', 'Run and Debug (⇧⌘D)': 'Çalıştır ve Hata Ayıkla (⇧⌘D)', 'Extensions (⇧⌘X)': 'Uzantılar (⇧⌘X)',
  'Accounts': 'Hesaplar', 'Manage': 'Yönet', 'Run Code (⌘↵)': 'Kodu Çalıştır (⌘↵)', 'Stop (⇧F5)': 'Durdur (⇧F5)', 'Open Preview': 'Önizlemeyi Aç', 'Split Editor Right': 'Düzenleyiciyi Sağa Böl', 'More Actions...': 'Diğer Eylemler...',
  'Notifications': 'Bildirimler', 'No new notifications': 'Yeni bildirim yok', 'No Problems': 'Sorun Yok',
  // bağlam menüleri
  'Open to the Side': 'Yanda Aç', 'Open in Integrated Terminal': 'Tümleşik Terminalde Aç', 'Find in Folder...': 'Klasörde Bul...',
  'Copy Path': 'Yolu Kopyala', 'Copy Name': 'Adı Kopyala', 'Share…': 'Paylaş…', 'Duplicate': 'Çoğalt', 'Rename...': 'Yeniden Adlandır...', 'Delete': 'Sil',
  'Close': 'Kapat', 'Close Others': 'Diğerlerini Kapat', 'Close to the Right': 'Sağdakileri Kapat', 'Close Saved': 'Kaydedilenleri Kapat', 'Close All': 'Tümünü Kapat',
  'Reveal in Explorer View': 'Gezgin Görünümünde Göster', 'Keep Open': 'Açık Tut', 'Pin': 'Sabitle',
  'Run with Input...': 'Girdiyle Çalıştır...', 'Word Wrap': 'Sözcük Kaydırma', 'Minimap': 'Mini Harita', 'Format Document': 'Belgeyi Biçimlendir', 'Share File…': 'Dosyayı Paylaş…',
  'Command Palette...': 'Komut Paleti...', 'Color Theme': 'Renk Teması', 'Editor Font Size...': 'Düzenleyici Yazı Tipi Boyutu...', 'Tab Size...': 'Sekme Boyutu...', 'Auto Save': 'Otomatik Kaydet',
  'Fix Smart Quotes (iPad)': 'Akıllı Tırnakları Düzelt (iPad)', 'Keyboard Shortcuts': 'Klavye Kısayolları', 'Download for Offline Use': 'Çevrimdışı Kullanım İçin İndir', 'Clear Download Cache': 'İndirme Önbelleğini Temizle',
  'Display Language': 'Görüntüleme Dili', 'Refresh': 'Yenile', 'Collapse Folders': 'Klasörleri Daralt',
  'Open Folder... (iCloud Drive / Dosyalar)': 'Klasör Aç... (iCloud Drive / Dosyalar)', 'Open App Folder (On My iPad)': 'Uygulama Klasörünü Aç (iPad\'imde)',
  // diyaloglar
  'Delete_btn': 'Sil', 'Cancel': 'İptal', 'Save': 'Kaydet', "Don't Save": 'Kaydetme', 'OK': 'Tamam', 'Replace_btn': 'Değiştir',
  'This action is irreversible!': 'Bu eylem geri alınamaz!', "Your changes will be lost if you don't save them.": 'Kaydetmezseniz değişiklikleriniz kaybolur.',
  // quick open
  'recently opened': 'son açılanlar', 'files': 'dosyalar', 'No matching results': 'Eşleşen sonuç yok',
  'Search files by name (append : to go to line or @ to go to symbol)': 'Dosyaları ada göre ara (satıra gitmek için : veya simgeye gitmek için @ ekleyin)',
  'Type a line number to navigate to.': 'Gitmek için bir satır numarası yazın.', 'Select Color Theme': 'Renk Temasını Seçin', 'Select Language Mode': 'Dil Modunu Seçin', 'Select Tab Size': 'Sekme Boyutunu Seçin',
  // komutlar
  'Show All Commands_cmd': 'Tüm Komutları Göster', 'Go to File...': 'Dosyaya Git...', 'File: New File...': 'Dosya: Yeni Dosya...', 'File: New Folder...': 'Dosya: Yeni Klasör...',
  'File: Open Folder...': 'Dosya: Klasör Aç...', 'File: Open App Documents Folder': 'Dosya: Uygulama Belgeler Klasörünü Aç', 'File: Save': 'Dosya: Kaydet', 'File: Save All': 'Dosya: Tümünü Kaydet',
  'File: Toggle Auto Save': 'Dosya: Otomatik Kaydetmeyi Aç/Kapat', 'File: Revert File': 'Dosya: Dosyayı Geri Al', 'File: Share Active File…': 'Dosya: Etkin Dosyayı Paylaş…',
  'View: Close Editor': 'Görünüm: Düzenleyiciyi Kapat', 'View: Close All Editors': 'Görünüm: Tüm Düzenleyicileri Kapat', 'Toggle Line Comment': 'Satır Açıklamasını Aç/Kapat', 'Toggle Block Comment': 'Blok Açıklamasını Aç/Kapat',
  'Expand Selection': 'Seçimi Genişlet', 'Shrink Selection': 'Seçimi Daralt', 'Copy Line Up': 'Satırı Yukarı Kopyala', 'Copy Line Down': 'Satırı Aşağı Kopyala', 'Move Line Up': 'Satırı Yukarı Taşı', 'Move Line Down': 'Satırı Aşağı Taşı',
  'Add Cursor Above': 'Yukarıya İmleç Ekle', 'Add Cursor Below': 'Aşağıya İmleç Ekle', 'Add Next Occurrence': 'Sonraki Oluşumu Ekle', 'Select All Occurrences': 'Tüm Oluşumları Seç',
  'View: Show Explorer': 'Görünüm: Gezgini Göster', 'View: Show Search': 'Görünüm: Aramayı Göster', 'View: Show Run and Debug': 'Görünüm: Çalıştır ve Hata Ayıkla\'yı Göster', 'View: Show Extensions': 'Görünüm: Uzantıları Göster',
  'View: Toggle Problems': 'Görünüm: Sorunları Aç/Kapat', 'View: Toggle Output': 'Görünüm: Çıktıyı Aç/Kapat', 'View: Toggle Terminal': 'Görünüm: Terminali Aç/Kapat',
  'View: Toggle Primary Side Bar Visibility': 'Görünüm: Birincil Yan Çubuk Görünürlüğünü Aç/Kapat', 'View: Toggle Panel Visibility': 'Görünüm: Panel Görünürlüğünü Aç/Kapat',
  'View: Toggle Word Wrap': 'Görünüm: Sözcük Kaydırmayı Aç/Kapat', 'View: Toggle Minimap': 'Görünüm: Mini Haritayı Aç/Kapat', 'View: Toggle Sticky Scroll': 'Görünüm: Yapışkan Kaydırmayı Aç/Kapat',
  'View: Zoom In (Editor Font)': 'Görünüm: Yakınlaştır', 'View: Zoom Out (Editor Font)': 'Görünüm: Uzaklaştır', 'View: Reset Zoom': 'Görünüm: Yakınlaştırmayı Sıfırla',
  'Go Back': 'Geri Git', 'Go Forward': 'İleri Git', 'Go to Line/Column...': 'Satıra/Sütuna Git...', 'Go to Symbol in Editor...': 'Düzenleyicide Sembole Git...', 'Go to Next Problem': 'Sonraki Soruna Git', 'Go to Previous Problem': 'Önceki Soruna Git',
  'View: Open Next Editor': 'Görünüm: Sonraki Düzenleyiciyi Aç', 'View: Open Previous Editor': 'Görünüm: Önceki Düzenleyiciyi Aç',
  'Run: Run Code': 'Çalıştır: Kodu Çalıştır', 'Run: Run Code with Input...': 'Çalıştır: Kodu Girdiyle Çalıştır...', 'Run: Stop': 'Çalıştır: Durdur', 'Run: Select Compiler Service': 'Çalıştır: Derleyici Hizmetini Seç',
  'C: Select Compiler (local / online)': 'C: Derleyici Seç (yerel / online)', 'Python: Select Interpreter': 'Python: Yorumlayıcı Seç', 'Offline: Download Everything for Offline Use': 'Çevrimdışı: Her Şeyi Çevrimdışı Kullanım İçin İndir',
  'Terminal: Create New Terminal': 'Terminal: Yeni Terminal Oluştur', 'Terminal: Clear': 'Terminal: Temizle', 'Python: Start REPL': 'Python: REPL Başlat',
  'Preferences: Color Theme': 'Tercihler: Renk Teması', 'Preferences: Editor Font Size': 'Tercihler: Düzenleyici Yazı Tipi Boyutu', 'Preferences: Tab Size': 'Tercihler: Sekme Boyutu',
  'Preferences: Toggle Smart Quote Fix': 'Tercihler: Akıllı Tırnak Düzeltmeyi Aç/Kapat', 'Preferences: Toggle Line Numbers': 'Tercihler: Satır Numaralarını Aç/Kapat',
  'Markdown: Open Preview': 'Markdown: Önizlemeyi Aç', 'Developer: Reload Window': 'Geliştirici: Pencereyi Yeniden Yükle', 'Developer: Clear Download Cache': 'Geliştirici: İndirme Önbelleğini Temizle',
  'File: Refresh Explorer': 'Dosya: Gezgini Yenile', 'File: Collapse Folders in Explorer': 'Dosya: Gezgindeki Klasörleri Daralt',
  'Help: Get Started': 'Yardım: Başlarken', 'Help: Keyboard Shortcuts Reference': 'Yardım: Klavye Kısayolları Başvurusu', 'Help: About': 'Yardım: Hakkında',
  'Format Document_cmd': 'Belgeyi Biçimlendir', 'Configure Display Language': 'Görüntüleme Dilini Yapılandır',
  'Pets: Spawn additional pet': 'Pets: Ek evcil hayvan oluştur', 'Pets: Throw ball': 'Pets: Top at', 'Pets: Remove all pets': 'Pets: Tüm evcil hayvanları kaldır', 'Pets: Change background': 'Pets: Arka planı değiştir',
  'Extensions: Show Installed Extensions': 'Uzantılar: Yüklü Uzantıları Göster',
  // uzantı ayrıntıları
  'Disable': 'Devre Dışı Bırak', 'Enable': 'Etkinleştir', 'Uninstall': 'Kaldır', 'DETAILS': 'AYRINTILAR', 'FEATURES': 'ÖZELLİKLER', 'Installation': 'Yükleme',
  'Identifier': 'Tanımlayıcı', 'Version': 'Sürüm', 'Status': 'Durum', 'Extension': 'Uzantı',
  'Spaces': 'Boşluklar', 'Ln': 'Satır', 'Col': 'Sütun', 'selected': 'seçili'
};
const isTR = () => { try { return (window.VSC_LANG || 'tr') === 'tr'; } catch (e) { return true; } };
function t(s, key) {
  if (!isTR() || s == null) return s;
  if (key && TR[key]) return TR[key];
  return TR[s] != null ? TR[s] : s;
}
function translateDOM(root) {
  if (!isTR()) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue, tr = raw.trim();
    if (tr && TR[tr] != null) n.nodeValue = raw.replace(tr, TR[tr]);
  }
  root.querySelectorAll('[title],[placeholder]').forEach((el) => {
    for (const a of ['title', 'placeholder']) { const v = el.getAttribute(a); if (v && TR[v] != null) el.setAttribute(a, TR[v]); }
  });
}

// ------------------------------------------------------------------ Material Icon Theme
const MONACO_TO_VSCODE_LANG = { shell: 'shellscript', plaintext: 'plaintext', 'objective-c': 'objective-c' };
const Material = {
  data: null,
  async load() { try { this.data = await (await fetch('ext/material/material-icons.json')).json(); } catch (e) { this.data = null; } return !!this.data; },
  src(key) { const f = this.data && this.data.icons[key]; return f ? 'ext/material/icons/' + f : null; },
  fileKey(path, langId) {
    const d = this.data;
    const name = path.split('/').pop().toLowerCase();
    if (d.fileNames[name]) return d.fileNames[name];
    const parts = name.split('.');
    for (let i = 1; i < parts.length; i++) { const ext = parts.slice(i).join('.'); if (d.fileExtensions[ext]) return d.fileExtensions[ext]; }
    const lid = MONACO_TO_VSCODE_LANG[langId] || langId;
    if (lid && d.languageIds[lid]) return d.languageIds[lid];
    return d.file;
  },
  folderKey(path, expanded, isRoot) {
    const d = this.data;
    const name = path.split('/').pop().toLowerCase();
    if (isRoot) return expanded ? d.rootFolderExpanded : d.rootFolder;
    return (expanded ? d.folderNamesExpanded[name] : d.folderNames[name]) || (expanded ? d.folderExpanded : d.folder);
  },
  fileIcon(path, langId) { if (!this.data) return null; const s = this.src(this.fileKey(path, langId)); return s ? `<img class="micon" src="${s}" alt="">` : null; },
  folderIcon(path, expanded, isRoot) { if (!this.data) return null; const s = this.src(this.folderKey(path, expanded, isRoot)); return s ? `<img class="micon" src="${s}" alt="">` : null; }
};

// ------------------------------------------------------------------ vscode-pets
const PET_NAMES_TR = { cat: 'Kedi', dog: 'Köpek', fox: 'Tilki', bunny: 'Tavşan', chicken: 'Tavuk', clippy: 'Clippy', cockatiel: 'Sultan papağanı', crab: 'Yengeç',
  deno: 'Deno', frog: 'Kurbağa', horse: 'At', mod: 'Mod', monkey: 'Maymun', morph: 'Morph', panda: 'Panda', raccoon: 'Rakun', rat: 'Fare', rocky: 'Rocky',
  'rubber-duck': 'Lastik ördek', skeleton: 'İskelet', snail: 'Salyangoz', snake: 'Yılan', squirrel: 'Sincap', totoro: 'Totoro', turtle: 'Kaplumbağa', zappy: 'Zappy' };
const PET_NAMES = ['Bella', 'Duman', 'Pamuk', 'Boncuk', 'Fındık', 'Zeytin', 'Tarçın', 'Minnoş', 'Karamel', 'Paşa', 'Lokum', 'Mars', 'Cesur', 'Bulut', 'Şans'];
const Pets = {
  manifest: null, pets: [], ball: null, timer: null, el: null, stage: null, size: 30,
  async load() { try { this.manifest = await (await fetch('ext/pets/pets.json')).json(); } catch (e) { this.manifest = null; } return !!this.manifest; },
  gif(p, state) {
    const states = (this.manifest[p.type] || {})[p.color] || [];
    let s = state;
    if (!states.includes(s)) s = { walk_fast: 'run', run: 'walk_fast', lie: 'idle', swipe: 'idle', with_ball: 'run', stand: 'idle' }[s] || 'idle';
    if (!states.includes(s)) s = states.includes('walk') ? 'walk' : states[0];
    return `ext/pets/${p.type}/${p.color}_${s}_8fps.gif`;
  },
  mount(stage, saved, onChange) {
    this.stage = stage; this.onChange = onChange;
    stage.innerHTML = '';
    this.pets = [];
    (saved || []).forEach((s) => this.add(s.type, s.color, s.name, true));
    stage.addEventListener('click', (e) => { if (e.target === stage || e.target.classList.contains('pets-bg')) this.throwBall(e.offsetX); });
    if (!this.timer) this.timer = setInterval(() => this.tick(), 100);
  },
  unmount() { clearInterval(this.timer); this.timer = null; if (this.stage) this.stage.innerHTML = ''; this.pets = []; },
  save() { this.onChange && this.onChange(this.pets.map((p) => ({ type: p.type, color: p.color, name: p.name }))); },
  add(type, color, name, silent) {
    if (!this.manifest || !this.manifest[type]) return;
    if (!color || !this.manifest[type][color]) color = Object.keys(this.manifest[type])[0];
    const W = this.stage.clientWidth || 200;
    const p = { type, color, name: name || PET_NAMES[Math.floor(Math.random() * PET_NAMES.length)], x: Math.random() * Math.max(10, W - this.size), dir: Math.random() < 0.5 ? -1 : 1, state: 'idle', until: 0 };
    const el = document.createElement('div');
    el.className = 'pet';
    el.innerHTML = `<img alt=""><span class="pet-name"></span>`;
    el.querySelector('.pet-name').textContent = p.name;
    el.addEventListener('click', (e) => { e.stopPropagation(); this.pet(p); });
    p.el = el; p.img = el.querySelector('img');
    this.stage.appendChild(el);
    this.pets.push(p);
    this.setState(p, 'idle', 1500);
    if (!silent) this.save();
  },
  removeAll() { this.pets.forEach((p) => p.el.remove()); this.pets = []; this.save(); },
  setState(p, s, ms) {
    p.state = s; p.until = Date.now() + ms;
    const src = this.gif(p, s);
    if (p.img.getAttribute('src') !== src) p.img.setAttribute('src', src);
  },
  pet(p) {
    this.setState(p, 'swipe', 1200);
    const h = document.createElement('div'); h.className = 'pet-heart'; h.textContent = '❤'; h.style.left = (p.x + this.size / 2 - 5) + 'px';
    this.stage.appendChild(h); setTimeout(() => h.remove(), 1200);
  },
  throwBall(x) {
    if (this.ball) this.ball.el.remove();
    const el = document.createElement('div'); el.className = 'pet-ball';
    this.stage.appendChild(el);
    this.ball = { el, x: x == null ? Math.random() * ((this.stage.clientWidth || 200) - 10) : x, y: 0, vy: 0 };
    el.style.left = this.ball.x + 'px';
    this.pets.forEach((p) => { p.chase = true; });
  },
  tick() {
    if (!this.stage || !this.stage.isConnected || this.stage.offsetParent === null) return;
    const W = this.stage.clientWidth, now = Date.now();
    if (this.ball) {
      const b = this.ball; b.vy += 1.5; b.y += b.vy; const floor = this.stage.clientHeight - 14;
      if (b.y >= floor) { b.y = floor; b.vy = -b.vy * 0.45; if (Math.abs(b.vy) < 2) b.vy = 0; }
      b.el.style.top = b.y + 'px';
    }
    for (const p of this.pets) {
      if (p.chase && this.ball) {
        const target = this.ball.x - this.size / 2;
        const d = target - p.x;
        if (Math.abs(d) < 6) {
          p.chase = false; this.setState(p, 'with_ball', 2500);
          this.ball.el.remove(); this.ball = null; this.pets.forEach((q) => { q.chase = false; });
        } else {
          p.dir = d > 0 ? 1 : -1; if (p.state !== 'run') this.setState(p, 'run', 10000);
          p.x += p.dir * 4;
        }
      } else if (now > p.until) {
        const r = Math.random();
        if (r < 0.45) { p.dir = Math.random() < 0.5 ? -1 : 1; this.setState(p, 'walk', 2500 + Math.random() * 4000); }
        else if (r < 0.6) { p.dir = Math.random() < 0.5 ? -1 : 1; this.setState(p, 'walk_fast', 1500 + Math.random() * 2000); }
        else if (r < 0.8) this.setState(p, 'idle', 2000 + Math.random() * 3000);
        else this.setState(p, 'lie', 3000 + Math.random() * 4000);
      } else if (p.state === 'walk' || p.state === 'walk_fast' || p.state === 'run') {
        p.x += p.dir * (p.state === 'walk' ? 1.2 : 2.6);
      }
      if (p.x < 0) { p.x = 0; p.dir = 1; }
      if (p.x > W - this.size) { p.x = W - this.size; p.dir = -1; }
      p.el.style.transform = `translateX(${p.x}px)`;
      p.img.style.transform = p.dir < 0 ? 'scaleX(-1)' : '';
    }
  }
};

// ------------------------------------------------------------------ Better Comments
const BC_TAGS = [
  { tag: '!', cls: 'bc-alert' }, { tag: '?', cls: 'bc-query' }, { tag: '//', cls: 'bc-strike' }, { tag: 'todo', cls: 'bc-todo' }, { tag: '*', cls: 'bc-hl' }
];
const BetterComments = {
  decos: new WeakMap(),
  apply(monaco, model) {
    if (!monaco || !model || model.isDisposed()) return;
    const lang = model.getLanguageId();
    const hash = ['python', 'r', 'shell', 'yaml', 'ruby', 'perl'].includes(lang);
    const slash = ['c', 'cpp', 'csharp', 'java', 'javascript', 'typescript', 'swift', 'go', 'rust', 'kotlin', 'php', 'scss', 'less'].includes(lang);
    const list = [];
    if (hash || slash) {
      const lines = model.getLinesContent();
      let inBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        let start = -1, prefixLen = 0;
        if (slash && inBlock) { if (L.includes('*/')) inBlock = false; const m = /^\s*\*?\s?/.exec(L); start = 0; prefixLen = m ? m[0].length : 0; }
        else {
          // satır içi yorum başlangıcını bul (string içindekileri atla)
          let q = null;
          for (let k = 0; k < L.length; k++) {
            const ch = L[k];
            if (q) { if (ch === '\\') { k++; continue; } if (ch === q) q = null; continue; }
            if (ch === '"' || ch === "'" || (ch === '`' && !hash)) { q = ch; continue; }
            if (slash && ch === '/' && L[k + 1] === '/') { start = k; prefixLen = 2; break; }
            if (slash && ch === '/' && L[k + 1] === '*') { if (!L.slice(k + 2).includes('*/')) inBlock = true; start = k; prefixLen = 2; break; }
            if (hash && ch === '#') { start = k; prefixLen = 1; break; }
          }
        }
        if (start < 0) continue;
        const body = L.slice(start + prefixLen);
        const lead = /^\s*/.exec(body)[0].length;
        const rest = body.slice(lead).toLowerCase();
        const tag = BC_TAGS.find((x) => rest.startsWith(x.tag) && !(x.tag === '*' && rest.startsWith('*/')));
        if (!tag) continue;
        list.push({ range: new monaco.Range(i + 1, start + 1, i + 1, L.length + 1), options: { inlineClassName: tag.cls } });
      }
    }
    const old = this.decos.get(model) || [];
    this.decos.set(model, model.deltaDecorations(old, list));
  },
  clear(model) { if (model && !model.isDisposed()) { const old = this.decos.get(model) || []; this.decos.set(model, model.deltaDecorations(old, [])); } }
};

// ------------------------------------------------------------------ uzantı durumları
const EXT_STATUS = {
  'pkief.material-icon-theme': ['active', 'Dosya ve klasör ikonları uygulamaya taşındı (orijinal 1256 SVG ikon).'],
  'ms-ceintl.vscode-language-pack-tr': ['active', 'Arayüz ve menüler Türkçe.'],
  'tonybaloney.vscode-pets': ['active', 'Gezgin\'in altındaki VS CODE PETS bölümünde. + ile hayvan ekle, ○ ile top at, hayvana dokunarak sev.'],
  'aaron-bond.better-comments': ['active', 'Yorumlar renklenir: // ! uyarı, // ? soru, // TODO, // * vurgu, //// üstü çizili.'],
  'formulahendry.code-runner': ['active', 'Yerleşik: ▷ düğmesi, ⌘↵ veya F5 ile C, C++, Java, C#, Python, JS çalışır.'],
  'ms-vscode.cpptools': ['partial', 'Söz dizimi, snippet\'ler ve yerel C derleyicisi çalışır. IntelliSense ve hata ayıklayıcı iPad\'de yok.'],
  'ms-vscode.cpptools-extension-pack': ['partial', 'C/C++ desteği (söz dizimi + derleme) etkin.'],
  'ms-vscode.cpp-devtools': ['partial', 'C/C++ desteği (söz dizimi + derleme) etkin.'],
  'ms-vscode.cpptools-themes': ['unsupported', 'Bunun yerine Dark Modern, Dark+ ve Light Modern temaları var.'],
  'ms-python.python': ['partial', 'Python, Pyodide ile çevrimdışı çalışır. IntelliSense yok.'],
  'ms-python.vscode-pylance': ['unsupported', 'Dil sunucusu (Node.js) iPad\'de çalışamaz.'],
  'ms-python.vscode-python-envs': ['partial', 'Tek ortam: Pyodide (Python 3.12). numpy gibi paketler import edildiğinde yüklenir.'],
  'ms-python.debugpy': ['unsupported', 'iPadOS\'ta hata ayıklayıcı çalıştırılamaz.'],
  'oracle.oracle-java': ['partial', 'Java söz dizimi + online derleme (OpenJDK).'],
  'redhat.java': ['partial', 'Java söz dizimi + online derleme. Dil sunucusu (JVM) iPad\'de yok.'],
  'vscjava.vscode-java-pack': ['partial', 'Java söz dizimi + online derleme.'],
  'vscjava.vscode-java-debug': ['unsupported', 'iPadOS\'ta JVM hata ayıklayıcısı çalıştırılamaz.'],
  'vscjava.vscode-java-test': ['unsupported', 'JUnit/TestNG için JVM gerekir.'],
  'vscjava.vscode-java-dependency': ['unsupported', 'Java proje yöneticisi JVM gerektirir.'],
  'vscjava.vscode-gradle': ['unsupported', 'Gradle iPad\'de çalışamaz.'],
  'vscjava.vscode-maven': ['unsupported', 'Maven iPad\'de çalışamaz.'],
  'reditorsupport.r': ['partial', 'R söz dizimi renklendirme. R yorumlayıcısı yok.'],
  'reditorsupport.r-syntax': ['active', 'R söz dizimi renklendirme etkin.'],
  'swiftlang.swift-vscode': ['partial', 'Swift söz dizimi renklendirme. Derleme için Swift Playgrounds kullan.'],
  'ms-vscode.cmake-tools': ['unsupported', 'CMake iPad\'de çalışamaz.'],
  'llvm-vs-code-extensions.lldb-dap': ['unsupported', 'iPadOS\'ta LLDB çalıştırılamaz.'],
  'ms-vscode.vscode-serial-monitor': ['unsupported', 'iPad uygulamaları seri porta (USB) erişemez.'],
  'ms-azuretools.vscode-containers': ['unsupported', 'Docker iPad\'de yok.'],
  'donjayamanne.githistory': ['unsupported', 'Git ileride eklenebilir.'],
  'anthropic.claude-code': ['unsupported', 'Masaüstü eklenti altyapısı ve CLI gerekir. Yerleşik AI paneli ileride eklenebilir.'],
  'google.geminicodeassist': ['unsupported', 'Masaüstü eklenti altyapısı ve Google hesabı gerekir.'],
  'google.google-antigravity': ['unsupported', 'Masaüstü eklenti altyapısı ve Google hesabı gerekir.']
};

window.VSCExt = { t, translateDOM, TR, Material, Pets, PET_NAMES_TR, BetterComments, EXT_STATUS };
})();
