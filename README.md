# VS iPad

iPad için VS Code. İçinde gerçek VS Code editör motoru (Monaco) var, arayüz Dark Modern düzenini birebir taklit ediyor.

Neden yaptım: sınav haftasında elimde sadece iPad olacaktı ve **C/C++'ı internetsiz derleyip
çalıştırabilmem** lazımdı. Oturdum yazdım.
Sonra iş büyüdü: Python, SQL, GitHub, ESP32 / Pico'yu **sadece kablo + iPad** ile programlama...

> 🇬🇧 **English:** VS Code–like editor for iPad that compiles and runs **C/C++ offline**
> (clang → WebAssembly), plus Python (Pyodide), SQL (sql.js), GitHub via REST, and
> ESP32 / Pico flashing over USB (UF2) or BLE. UI and docs are in Turkish for now —
> translations and PRs are very welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## 🙋 Yardım lazım / Help wanted

Tek kişilik bir öğrenci projesi, el atarsanız çok sevinirim. Özellikle:

- **Debugger:** clang/WASM tarafında breakpoint, adım adım çalıştırma
- **İngilizce arayüz:** `this.L('tr', 'en')` çağrıları var ama her yer çevrilmedi
- **Online derlenen dillerin offline olması** (Java, Rust…)
- **USB-seri kartlar** (CP2102 / CH340): iPadOS'ta bir yolu var mı?
- **Test:** farklı iPad modelleri / iPadOS sürümleri, hata raporları

Nasıl katkı verilir: [CONTRIBUTING.md](CONTRIBUTING.md)

## Kurulum (Mac + Xcode gerekir)

1. `VSiPad.xcodeproj` dosyasını Xcode ile aç.
2. **Signing & Capabilities** sekmesinde kendi Team'ini seç ve Bundle ID'yi kendine göre değiştir
   (repoda yer tutucu olarak `com.example.vsipad` duruyor; `VSiPad.entitlements` ve `Bridge.swift` içindeki `sharedSuffix` de aynı olmalı).
3. iPad'i kabloyla bağla. iPad'de **Ayarlar › Gizlilik ve Güvenlik › Geliştirici Modu** açık olmalı.
4. Hedef olarak iPad'i seç ve ▶ Run'a bas.
5. **İlk açılışta iPad internete bağlı olsun.** Editör (~5 MB) indirilir. Ardından çıkan
   "çevrimdışı için indir" bildirimine **İndir** de (editör + Python, ~15 MB).
   Kontrol etmek için Run panelindeki "Offline" bölümüne bak: iki satır da ✔ olmalı.

> ⚠️ **İmza süresi:** Ücretsiz Apple ID ile yüklenen uygulama **7 gün** sonra açılmaz.
> Yeniden yüklemek için de Mac gerekir. Kurulumu sınav haftası başlamadan hemen önce yap.
> Ücretli Developer hesabında bu süre 1 yıl.
>
> Terminalden derleyip kurmak (Xcode açmadan):
> ```bash
> cd VS_iPad && xcodebuild -project VSiPad.xcodeproj -scheme "VS iPad" -destination 'id=<IPAD_UDID>' -derivedDataPath build -allowProvisioningUpdates build && xcrun devicectl device install app --device <IPAD_UDID> "build/Build/Products/Debug-iphoneos/VS iPad.app"
> ```
> Xcode eski profili bitişine birkaç gün kalana kadar yeniden kullanır; tam 7 gün istiyorsan
> `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` içindeki `com.example.vsipad`
> profilini kenara al ve tekrar derle.

## Neler çalışıyor

| Dil | Nasıl | İnternet |
|---|---|---|
| **C** | **clang** (LLVM, WebAssembly, `Web/clang/`) ya da yerel yorumlayıcı `vsipad-cc` (`Web/c-interp.js`, satır numaralı hata) | ❌ gerekmez |
| **C++** | **clang++** (STL dahil, WebAssembly) | ❌ gerekmez |
| Python 3.12 | Pyodide (WebAssembly), iPad'in içinde | ❌ gerekmez |
| C / C++ (online) | Gerçek GCC (Wandbox, olmazsa Compiler Explorer) – ▷ yanındaki ⌄ menüsünden | ✅ |
| Java | OpenJDK (online) | ✅ |
| C# | .NET / Mono (online) | ✅ |
| Rust | rustc, edition 2021 (Wandbox / Compiler Explorer) | ✅ |
| SQL | SQLite 3 (sql.js, WebAssembly), iPad'in içinde | ❌ |
| JavaScript | Uygulamanın içinde | ❌ |
| HTML | Önizleme | ❌ |

- **Çalıştır:** ▷ butonu, `⌘↵` veya `F5`. Durdur: `⇧F5`.
- **Girdi:** Python'da `input()` terminalde interaktif sorulur. C/C++/Java/C# programı
  `scanf`/`cin`/`Scanner` kullanıyorsa girdiler terminalde istenir; bitince ⌃D ya da **Gönder**.
  İstersen Run panelindeki stdin kutusuna önceden de yazabilirsin.
- **Çok dosyalı projeler:** Aynı klasördeki `.h`/`.c`/`.cpp`/`.java` dosyaları ve
  `.txt`/`.csv` veri dosyaları otomatik eklenir (örnek: `Örnekler/linked_list`).
- **Hatalar:** Derleyici hataları Problems paneline düşer ve editörde kırmızıyla altı çizilir.
- **Terminal:** `ls cd cat mkdir rm mv`, `gcc a.c && ./a.out`, `javac Main.java && java Main`,
  `python3` (REPL), `help`.
- **Dosyalar:** Dosyalar uygulaması › iPad'imde › VS iPad. iCloud Drive'daki bir klasörde
  çalışmak için File › Open Folder.
- Komut paleti `⇧⌘P`, dosyaya git `⌘P`, arama `⇧⌘F`, kenar çubuğu `⌘B`, panel `⌘J`,
  terminal ``⌃` ``.
- **SQL:** `.sql` dosyası ⌘↵ ile her seferinde boş bir veritabanında çalışır, sonuçlar tablo
  olarak basılır, hatalı satır Problems'a düşer. İlk satıra `-- @db okul.db` yazarsan o dosyaya
  kaydeder. Terminalde `sqlite3 [dosya.db]` → `.tables`, `.schema`, `.read x.sql`.

## Renk temaları
VS Code'un yerleşik 23 teması (Dark 2026, Dark Modern, Dark+, Light+, Monokai, Solarized,
Abyss, Kimbie, Red, Tomorrow Night Blue, Quiet Light, Yüksek Karşıtlık, Visual Studio…)
`Web/ext/themes.json` içinde. **⌘K ⌘T** (veya View › Renk Teması) ok tuşlarıyla canlı önizler.
**Renk Teması Düzenleyici** (View › Renk Temasını Özelleştir) ile söz dizimi ve arayüz
renklerini tek tek değiştirebilir, yeni tema olarak kaydedebilir, JSON'a aktarabilirsin.
Başka bir VS Code temasının `.json` dosyasını klasöre koyup **Renk Teması İçe Aktar** de.

## GitHub (Kaynak Denetimi)
iPad'de `git` yok; GitHub REST API kullanılır. Kaynak Denetimi simgesi → **GitHub'a Giriş Yap**:
github.com → Settings → Developer settings → Personal access tokens → **Fine-grained** →
Repository access: *All repositories* → Permissions: **Contents** ve **Administration**
(*Read and write*). Token Anahtar Zinciri'nde saklanır.
- **GitHub'da Yayımla:** bir klasörü yeni (gizli/açık) depo yapar.
- **Depoyu Klonla / Klasörü mevcut depoya bağla.**
- Değişen dosyalar (M/U/D) listelenir, Explorer'da renklenir; dosyaya dokununca fark görünümü açılır.
- Mesaj yaz → **Commit ve Push** (⌘↵). **Pull** GitHub'daki değişiklikleri indirir; ikisi
  birden değiştiyse iPad'deki sürüm korunur ve uyarılır. `.gitignore` dikkate alınır.

## Yapay zekâ: Claude ve Gemini · AG
Etkinlik çubuğunda iki ayrı panel var, her birinin kendi sohbet geçmişi, modeli ve ayarı olur:
- **✨ Claude** (⌃⌘I) – Anthropic. Anahtar: console.anthropic.com › API Keys (ücretli, Pro aboneliğinden ayrı).
- **★ Gemini · AG** (⌃⌘G) – Google Gemini (Antigravity'deki modeller). Anahtar: aistudio.google.com › Get API key (ücretsiz kota).

İkisi de aynı ajan özelliklerine sahip:
- **Ajan** modunda dosyaları okur, düzenler, `run_file` ile derleyip çalıştırır. Her değişiklik ve
  çalıştırma onay ister (farkı görebilirsin), **Geri al** ile geri alınır. **Sor** modunda sadece okur.
- Aktif dosya, seçili metin ve Problems listesi bağlam olarak gönderilir. Model listesi API'den canlı çekilir.
- Anahtarlar Anahtar Zinciri'nde saklanır. İnternet gerekir.

## Notlar (Obsidian tarzı) ve PDF
- `.md` dosyaları **okuma görünümünde** açılır (⌘E ile düzenleme ↔ okuma): `[[wikilink]]`,
  `[[not|takma ad]]`, `[[not#başlık]]`, `![[gömme]]` (not, görsel, PDF), callout'lar (`> [!note]`),
  KaTeX (`$…$`, `$$…$$`), `==vurgu==`, `#etiket`, tıklanabilir görev kutuları, özellikler (frontmatter),
  Mermaid diyagramları, renklendirilmiş kod blokları ve **geri bağlantılar**. Olmayan nota tıklayınca oluşturur.
- Obsidian kasanı **File › Open Folder** ile (iCloud Drive / Google Drive) açabilirsin.
- **PDF görüntüleyici:** sayfalar, yakınlaştırma (iki parmak / butonlar), sayfaya git, metin seçme,
  PDF içinde arama; kalınan sayfa hatırlanır. Görseller de sekmede açılır.
- Kütüphaneler (markdown-it, KaTeX, pdf.js, Mermaid) ilk kullanımda indirilir, sonra çevrimdışı çalışır.

### "Claude'a sor" (API anahtarı gerekmez)
Editörün sağ üstündeki ✨ düğmesi ya da **AI › Claude'a Sor** (⌃⌘K): sorunu yazarsın. Aktif dosya,
seçili kısım, Problems listesi ve son terminal çıktısı tek bir mesaj olarak **panoya kopyalanır**, sonra
**Claude uygulaması** açılır (yoksa claude.ai). Mesaj kutusuna ⌘V ile yapıştırırsın. Böylece Pro
aboneliğin kullanılır, API anahtarı gerekmez.

## ESP32 ve Raspberry Pi Pico (Arduino C++, MicroPython, CircuitPython)
Etkinlik çubuğundaki **ESP32** simgesi. Üç yükleme yolu var, her yüklemede sorulur:

| Yol | Kartlar | Not |
|---|---|---|
| 🔌 **USB kablo (UF2)** | ESP32-S3 (TinyUF2 ile), Raspberry Pi Pico / Pico W / Pico 2 | Başka cihaz gerekmez, internetsiz |
| 📶 Wi-Fi | ESP32, S3, C3 (VS iPad köprüsü ile) | Hızlı, seri monitör var |
| 🔵 Bluetooth LE | ESP32, S3, C3 (köprü ile) | Ağ gerekmez, yavaş |

**USB kablo nasıl oluyor:** iPadOS uygulamalara USB-seri vermez, ama USB **belleği** Dosyalar'da açar.
UF2 önyükleyicili kartlar (`S3DKC1BOOT`, `RPI-RP2`) ve CircuitPython kartları (`CIRCUITPY`) kendini
bellek olarak gösterir; VS iPad `.uf2` dosyasını ya da `code.py`'yi oraya yazar (`VSiPad/UsbDrive.swift`).
Sürücü ilk seferde Dosyalar seçicisinden bir kez seçilir, sonra hatırlanır.
- **ESP32-S3:** Mac'ten **bir kez** TinyUF2 kurulur:
  `./tools/esp32s3-tinyuf2-kur.sh` (kart UART portundan bağlı).
  Sonra kartı iPad'e **USB** portundan tak. UF2 moduna almak için: çalışırken **BOOT'u 2 sn basılı tut**
  (köprü özelliği), ya da **RESET → LED mor → BOOT**.
- **Pico:** hazırlık yok, **BOOTSEL** basılıyken tak.
- **CircuitPython (tamamen internetsiz):** *CircuitPython'u karta kur…* (en son sürümü indirip
  `ESP32/firmware/` klasörüne saklar) → `.py` aç → *USB'ye Yaz ve Çalıştır* → `code.py` olarak yazılır.
- **Klasik ESP32, C3, Arduino Uno/Nano** USB-seri çipi kullanır, USB belleği yoktur. Bunlar iPad'den
  kabloyla programlanamaz, kablosuz yol kullanılır.
- Kablo üzerinden **seri çıktı görünmez** (iPadOS kısıtı). ESP32'de köprü sayesinde Wi-Fi / BLE seri monitör çalışır.

Ayrıntılar:
- **Arduino:** `.ino` dosyasında ▷ → kod, ESP32 klasörünün bağlı olduğu GitHub deposunda
  **GitHub Actions** ile derlenir (arduino-cli + esp32 3.0.7 ya da rp2040 çekirdeği, ücretsiz) → `app.bin` / `app.uf2`
  indirilir → karta USB (UF2), Wi-Fi (`POST /update`) veya BLE ile yüklenir.
  Hatalar Problems paneline düşer. Kütüphane: çizime `// @lib Kütüphane Adı`.
- **MicroPython:** `.py` dosyası WebREPL (Wi-Fi) veya BLE UART REPL ile karta yazılır ve
  çalıştırılır; derleme ve internet gerekmez.
- **Seri monitör:** alt panelde **SERİ MONİTÖR** sekmesi (zaman damgası, satır sonu seçimi, Ctrl-C).
- **İlk kurulum (bir kez, Mac'ten kabloyla):** ESP32 › *Köprü yazılımını hazırla…* ve uygulamadaki
  rehberler. Karttaki köprü: `Web/esp32/VSiPad.h` (Arduino; her çizime otomatik eklenir, çökme
  durumunda güvenli mod) ve `Web/esp32/micropython/` (boot.py + vsipad_ble.py).
- GitHub token'ına ayrıca **Workflows: Read and write** izni gerekir.

## Proje yapısı

```
VSiPad/
├── VSiPad.xcodeproj
├── Info.plist                  Dosyalar uygulaması paylaşımı
├── VSiPad/                     Swift (Xcode bu klasörü otomatik senkronlar)
│   ├── App.swift               SwiftUI giriş noktası
│   ├── EditorWebView.swift     WKWebView + alert/prompt diyalogları
│   ├── AppSchemeHandler.swift  vscpad:// → Web/ klasörü + CDN önbelleği + stdin köprüsü
│   ├── Bridge.swift            JS ↔ Swift: dosya sistemi, ayarlar, HTTP, klasör seçici, pano
│   ├── UsbDrive.swift          USB bellek (UF2 / CIRCUITPY) seçme ve yazma
│   ├── Device.swift            Bluetooth LE / TCP / WebSocket (ESP32)
│   ├── PDFNotebook.swift       Apple Pencil ile PDF not alma
│   └── Assets.xcassets
├── tools/
│   └── esp32s3-tinyuf2-kur.sh  ESP32-S3'e TinyUF2 (Mac'te bir kez)
└── Web/                        Arayüz (Xcode'da mavi klasör referansı olarak eklenir)
    ├── index.html              VS Code iskeleti
    ├── workbench.css           Dark Modern renkleri
    ├── workbench.js            Explorer, sekmeler, terminal, derleyiciler, komutlar
    ├── c-interp.js             Yerel C derleyicisi (C → JS, worker'da çalışır)
    ├── extensions.js           Türkçe çeviri, Material ikonları, pets, Better Comments
    ├── themes.js               VS Code temaları, canlı önizleme, tema düzenleyici
    ├── git.js                  GitHub: clone / commit+push / pull (REST Git Data API)
    ├── agent.js                Claude ve Gemini · AG ajan panelleri (araçlar, onay, geri alma)
    ├── clang/, clang-worker.js clang / clang++ (WebAssembly) + WASI çalıştırıcısı
    ├── esp32.js, esp32/        ESP32 / Pico eklentisi, VSiPad.h köprüsü, GitHub Actions iş akışı
    ├── obsidian.js             Markdown okuma görünümü, PDF / görsel görüntüleyici
    ├── ext/                    Mac'teki VS Code eklentilerinden kopyalanan varlıklar (MIT)
    └── py-worker.js            Pyodide Python çalıştırıcısı
```

- Arayüzü değiştirmek için `Web/` klasöründeki dosyaları düzenleyip yeniden Run yap.
- Hata ayıklamak için Mac'te **Safari › Geliştir › [iPad] › VS iPad** menüsünü aç.
  Web Inspector JS konsolunu gösterir.
- Mac'te hızlı önizleme için `Web/` klasöründe `python3 -m http.server` çalıştır ve
  tarayıcıda aç. Bu modda sahte bir dosya sistemi kullanılır.

## Sınırlar

- Java/C#/Rust (ve isteğe bağlı online gcc) online derlenir: program ve girdisi wandbox.org / godbolt.org'a gönderilir.
- USB kablo yalnızca UF2 / CircuitPython kartlarında çalışır; USB-seri (CP2102, CH340, 16U2) kartlar desteklenmez.
- GitHub entegrasyonu tek dal (varsayılan dal) ile çalışır; branch/merge/rebase yok.
- AG Claude kodunu ve dosya içeriklerini seçtiğin sağlayıcıya (Anthropic/Google) gönderir.
- Menüler (File, Edit, Run…) iPadOS'un üst menü çubuğundadır; pencere içinde menü yoktur.
- Online programlar interaktif değil: girdi baştan toplanır, çıktı program bitince gelir.
- Debugger (breakpoint) ve VS Code Marketplace eklentileri yok.
- ESP32 kurulum modunda kartın açtığı Wi-Fi'nin varsayılan şifresi `vsipad123` (herkese açık bir değer).
  Kartı kendi ağına bağladıktan sonra bu mod kapanır; istersen `VSiPad.h` içindeki `VSIPAD_AP_PASSWORD`'ü değiştir.

## Lisans

Projenin kendi kodu [MIT](LICENSE). İçinde gelen üçüncü parti dosyalar (LLVM/clang, Material
Icon Theme, vscode-pets, VS Code temaları…) kendi lisanslarıyla gelir:
[THIRD_PARTY.md](THIRD_PARTY.md).

