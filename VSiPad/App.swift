import SwiftUI
import WebKit

@main
struct VSiPadApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .commands { VSCodeCommands() }
    }
}

/// Üstteki iPadOS durum çubuğunun (saat · "VS iPad" · pil) arka planı ve yazı rengi
/// aktif renk temasına göre web tarafından güncellenir (Bridge: app.chrome).
final class ChromeState: ObservableObject {
    static let shared = ChromeState()
    @Published var background = Color(red: 0.094, green: 0.094, blue: 0.094) // #181818
    @Published var dark = true

    func update(hex: String, dark: Bool) {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        if h.count == 8 { h = String(h.prefix(6)) }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { self.dark = dark; return }
        background = Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
        self.dark = dark
    }
}

struct ContentView: View {
    @ObservedObject private var chrome = ChromeState.shared
    var body: some View {
        ZStack {
            chrome.background
                .ignoresSafeArea()
            // Üst kenar güvenli alanda kalır → sistem durum çubuğu (saat, uygulama adı, pil) hep görünür
            EditorWebView()
                .ignoresSafeArea(edges: [.bottom, .horizontal])
        }
        .statusBarHidden(false)
        .persistentSystemOverlays(.hidden)   // alttaki ana ekran çizgisi kullanılmadığında söner; durum çubuğu en altta durur
        .preferredColorScheme(chrome.dark ? .dark : .light)
    }
}

/// Menü komutlarını web arayüzüne iletir:  window.VSC.cmd("file.save")
final class WebViewHolder {
    static let shared = WebViewHolder()
    weak var webView: WKWebView?
}

/// Menü dili: arayüzdeki ayar (Görüntüleme Dili) – varsayılan Türkçe. Değişiklik uygulama yeniden açılınca geçerli olur.
enum Loc {
    static let tr: Bool = {
        guard let s = UserDefaults.standard.string(forKey: "kv.settings"),
              let d = s.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return true }
        return (o["lang"] as? String ?? "tr") == "tr"
    }()
}
func L(_ en: String, _ tr: String) -> String { Loc.tr ? tr : en }

enum VSC {
    static func run(_ id: String) {
        let js = "window.VSC && window.VSC.cmd('\(id)')"
        WebViewHolder.shared.webView?.evaluateJavaScript(js, completionHandler: nil)
    }
}

/// iPadOS menü çubuğu (üstte). Komut kimlikleri Web/workbench.js içindeki registerCommands() ile aynıdır.
struct VSCodeCommands: Commands {
    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button(L("Settings…", "Ayarlar…")) { VSC.run("pref.settings") }.keyboardShortcut(",", modifiers: .command)
        }
        // ---------- File
        CommandGroup(replacing: .newItem) {
            Button(L("New File…", "Yeni Dosya…")) { VSC.run("file.newFile") }.keyboardShortcut("n", modifiers: .command)
            Button(L("New Folder…", "Yeni Klasör…")) { VSC.run("file.newFolder") }
            Divider()
            Button(L("Open Folder… (iCloud Drive / Dosyalar)", "Klasör Aç… (iCloud Drive / Dosyalar)")) { VSC.run("ws.openFolder") }.keyboardShortcut("o", modifiers: .command)
            Button(L("Open App Folder (On My iPad)", "Uygulama Klasörünü Aç (iPad'imde)")) { VSC.run("ws.useDefault") }
            Divider()
            Button(L("Import from VS Code (Profile)…", "VS Code'dan İçe Aktar (Profil)…")) { VSC.run("vscode.import") }
            Button(L("Export Settings for VS Code…", "Ayarları VS Code İçin Dışa Aktar…")) { VSC.run("vscode.export") }
        }
        CommandGroup(replacing: .saveItem) {
            Button(L("Save", "Kaydet")) { VSC.run("file.save") }.keyboardShortcut("s", modifiers: .command)
            Button(L("Save All", "Tümünü Kaydet")) { VSC.run("file.saveAll") }.keyboardShortcut("s", modifiers: [.command, .option])
            Button(L("Toggle Auto Save", "Otomatik Kaydet")) { VSC.run("file.autoSave") }
            Divider()
            Button(L("Revert File", "Dosyayı Geri Al")) { VSC.run("file.revert") }
            Button(L("Share…", "Paylaş…")) { VSC.run("file.share") }
            Divider()
            Button(L("Close Editor", "Düzenleyiciyi Kapat")) { VSC.run("editor.close") }.keyboardShortcut("w", modifiers: .command)
            Button(L("Close All Editors", "Tüm Düzenleyicileri Kapat")) { VSC.run("editor.closeAll") }
        }
        CommandGroup(replacing: .printItem) { }

        // ---------- Edit
        CommandGroup(replacing: .undoRedo) {
            Button(L("Undo", "Geri Al")) { VSC.run("edit.undo") }.keyboardShortcut("z", modifiers: .command)
            Button(L("Redo", "Yinele")) { VSC.run("edit.redo") }.keyboardShortcut("z", modifiers: [.command, .shift])
        }
        CommandGroup(after: .pasteboard) {
            Divider()
            Button(L("Find", "Bul")) { VSC.run("edit.find") }.keyboardShortcut("f", modifiers: .command)
            Button(L("Replace", "Değiştir")) { VSC.run("edit.replace") }.keyboardShortcut("f", modifiers: [.command, .option])
            Divider()
            Button(L("Toggle Line Comment", "Satır Açıklamasını Aç/Kapat")) { VSC.run("edit.comment") }.keyboardShortcut("/", modifiers: .command)
            Button(L("Toggle Block Comment", "Blok Açıklamasını Aç/Kapat")) { VSC.run("edit.blockComment") }
            Button(L("Format Document", "Belgeyi Biçimlendir")) { VSC.run("edit.format") }.keyboardShortcut("f", modifiers: [.shift, .option])
        }

        // ---------- Selection
        CommandMenu(L("Selection", "Seçim")) {
            Button(L("Expand Selection", "Seçimi Genişlet")) { VSC.run("sel.expand") }
            Button(L("Shrink Selection", "Seçimi Daralt")) { VSC.run("sel.shrink") }
            Divider()
            Button(L("Copy Line Up", "Satırı Yukarı Kopyala")) { VSC.run("sel.copyLineUp") }
            Button(L("Copy Line Down", "Satırı Aşağı Kopyala")) { VSC.run("sel.copyLineDown") }
            Button(L("Move Line Up", "Satırı Yukarı Taşı")) { VSC.run("sel.moveLineUp") }
            Button(L("Move Line Down", "Satırı Aşağı Taşı")) { VSC.run("sel.moveLineDown") }
            Divider()
            Button(L("Add Cursor Above", "Yukarıya İmleç Ekle")) { VSC.run("sel.cursorAbove") }
            Button(L("Add Cursor Below", "Aşağıya İmleç Ekle")) { VSC.run("sel.cursorBelow") }
            Button(L("Add Next Occurrence", "Sonraki Oluşumu Ekle")) { VSC.run("sel.nextOccurrence") }.keyboardShortcut("d", modifiers: .command)
            Button(L("Select All Occurrences", "Tüm Oluşumları Seç")) { VSC.run("sel.allOccurrences") }.keyboardShortcut("l", modifiers: [.command, .shift])
        }

        // ---------- View
        CommandGroup(after: .sidebar) {
            Button(L("Command Palette…", "Komut Paleti…")) { VSC.run("palette") }.keyboardShortcut("p", modifiers: [.command, .shift])
            Button(L("Go to File…", "Dosyaya Git…")) { VSC.run("quickOpen") }.keyboardShortcut("p", modifiers: .command)
            Divider()
            Button(L("Explorer", "Gezgin")) { VSC.run("view.explorer") }.keyboardShortcut("e", modifiers: [.command, .shift])
            Button(L("Search", "Ara")) { VSC.run("view.search") }.keyboardShortcut("f", modifiers: [.command, .shift])
            Button(L("Run and Debug", "Çalıştır ve Hata Ayıkla")) { VSC.run("view.run") }.keyboardShortcut("d", modifiers: [.command, .shift])
            Button(L("Extensions", "Uzantılar")) { VSC.run("view.extensions") }.keyboardShortcut("x", modifiers: [.command, .shift])
            Button(L("Source Control (GitHub)", "Kaynak Denetimi (GitHub)")) { VSC.run("view.scm") }.keyboardShortcut("g", modifiers: [.control, .shift])
            Button("Claude") { VSC.run("agent.open") }.keyboardShortcut("i", modifiers: [.control, .command])
            Button("Gemini · AG") { VSC.run("ag.open") }.keyboardShortcut("g", modifiers: [.control, .command])
            Divider()
            Button(L("Problems", "Sorunlar")) { VSC.run("view.problems") }.keyboardShortcut("m", modifiers: [.command, .shift])
            Button(L("Output", "Çıktı")) { VSC.run("view.output") }.keyboardShortcut("u", modifiers: [.command, .shift])
            Button(L("Terminal", "Terminal")) { VSC.run("view.terminal") }.keyboardShortcut("`", modifiers: .control)
            Divider()
            Button(L("Toggle Primary Side Bar", "Birincil Yan Çubuğu Aç/Kapat")) { VSC.run("view.sidebar") }.keyboardShortcut("b", modifiers: .command)
            Button(L("Toggle Panel", "Paneli Aç/Kapat")) { VSC.run("view.panel") }.keyboardShortcut("j", modifiers: .command)
            Button(L("Word Wrap", "Sözcük Kaydırma")) { VSC.run("view.wordWrap") }.keyboardShortcut("z", modifiers: .option)
            Button(L("Minimap", "Mini Harita")) { VSC.run("view.minimap") }
            Button(L("Sticky Scroll", "Yapışkan Kaydırma")) { VSC.run("view.stickyScroll") }
            Divider()
            Button(L("Zoom In", "Yakınlaştır")) { VSC.run("view.zoomIn") }.keyboardShortcut("=", modifiers: .command)
            Button(L("Zoom Out", "Uzaklaştır")) { VSC.run("view.zoomOut") }.keyboardShortcut("-", modifiers: .command)
            Button(L("Reset Zoom", "Yakınlaştırmayı Sıfırla")) { VSC.run("view.zoomReset") }.keyboardShortcut("0", modifiers: .command)
            Divider()
            Button(L("Color Theme…", "Renk Teması…")) { VSC.run("pref.theme") }.keyboardShortcut("t", modifiers: [.command, .option])
            Button(L("Customize Color Theme…", "Renk Temasını Özelleştir…")) { VSC.run("pref.themeEditor") }
            Button(L("Import Color Theme (JSON)…", "Renk Teması İçe Aktar (JSON)…")) { VSC.run("pref.themeImport") }
            Button(L("Customize Activity Bar…", "Etkinlik Çubuğunu Özelleştir…")) { VSC.run("view.customizeActivityBar") }
            Button(L("Markdown Preview", "Markdown Önizleme")) { VSC.run("md.preview") }.keyboardShortcut("v", modifiers: [.command, .shift])
            Button(L("Toggle Reading View (Obsidian)", "Okuma Görünümü (Obsidian)")) { VSC.run("md.reading") }.keyboardShortcut("e", modifiers: .command)
            Divider()
            Button(L("Pets: Spawn Pet", "Pets: Evcil Hayvan Ekle")) { VSC.run("pets.spawn") }
            Button(L("Pets: Throw Ball", "Pets: Top At")) { VSC.run("pets.ball") }
            Button(L("Configure Display Language…", "Görüntüleme Dilini Yapılandır…")) { VSC.run("pref.language") }
        }

        // ---------- Go
        CommandMenu(L("Go", "Git")) {
            Button(L("Back", "Geri")) { VSC.run("go.back") }.keyboardShortcut("-", modifiers: .control)
            Button(L("Forward", "İleri")) { VSC.run("go.forward") }.keyboardShortcut("-", modifiers: [.control, .shift])
            Divider()
            Button(L("Go to File…", "Dosyaya Git…")) { VSC.run("quickOpen") }
            Button(L("Go to Line/Column…", "Satıra/Sütuna Git…")) { VSC.run("go.line") }.keyboardShortcut("g", modifiers: .control)
            Button(L("Go to Symbol in Editor…", "Düzenleyicide Sembole Git…")) { VSC.run("go.symbol") }.keyboardShortcut("o", modifiers: [.command, .shift])
            Divider()
            Button(L("Next Problem", "Sonraki Sorun")) { VSC.run("go.nextProblem") }
            Button(L("Previous Problem", "Önceki Sorun")) { VSC.run("go.prevProblem") }
            Divider()
            Button(L("Next Editor", "Sonraki Düzenleyici")) { VSC.run("tabs.next") }.keyboardShortcut("]", modifiers: [.command, .shift])
            Button(L("Previous Editor", "Önceki Düzenleyici")) { VSC.run("tabs.prev") }.keyboardShortcut("[", modifiers: [.command, .shift])
        }

        // ---------- Run
        CommandMenu(L("Run", "Çalıştır")) {
            Button(L("Run Code", "Kodu Çalıştır")) { VSC.run("run.run") }.keyboardShortcut(.return, modifiers: .command)
            Button(L("Run with Input…", "Girdiyle Çalıştır…")) { VSC.run("run.withInput") }.keyboardShortcut(.return, modifiers: [.command, .shift])
            Button(L("Stop", "Durdur")) { VSC.run("run.stop") }.keyboardShortcut(".", modifiers: .command)
            Divider()
            Button(L("Select C Compiler (local / online)…", "C Derleyicisi Seç (yerel / online)…")) { VSC.run("run.cRunner") }
            Button(L("Select Online Compiler Service…", "Online Derleyici Hizmeti Seç…")) { VSC.run("run.selectRunner") }
            Button(L("Select Python Interpreter…", "Python Yorumlayıcısı Seç…")) { VSC.run("run.pyRunner") }
            Divider()
            Divider()
            Button(L("ESP32: Build & Upload (Arduino)", "ESP32: Derle ve Yükle (Arduino)")) { VSC.run("esp32.build") }.keyboardShortcut("u", modifiers: [.command, .option])
            Button(L("ESP32: Upload & Run (MicroPython)", "ESP32: Yükle ve Çalıştır (MicroPython)")) { VSC.run("esp32.mpy") }
            Button(L("USB: Write & Run (CircuitPython)", "USB: Karta Yaz ve Çalıştır (CircuitPython)")) { VSC.run("esp32.cpy") }
            Button(L("USB: Install CircuitPython…", "USB: CircuitPython'u Karta Kur…")) { VSC.run("esp32.cpyInstall") }
            Button(L("USB: Flash .uf2 File…", "USB: .uf2 Dosyasını Karta Yaz…")) { VSC.run("esp32.uf2") }
            Button(L("ESP32: Serial Monitor", "ESP32: Seri Monitör")) { VSC.run("esp32.monitor") }.keyboardShortcut("m", modifiers: [.command, .option])
            Button(L("ESP32: Board & Wi-Fi Settings…", "ESP32: Kart ve Wi-Fi Ayarları…")) { VSC.run("esp32.settings") }
            Button(L("ESP32: First-Time Setup…", "ESP32: İlk Kurulum…")) { VSC.run("esp32.bridge") }
            Divider()
            Button(L("Download for Offline Use", "Çevrimdışı Kullanım İçin İndir")) { VSC.run("run.prepareOffline") }
        }

        // ---------- Terminal
        CommandMenu(L("Terminal", "Terminal")) {
            Button(L("New Terminal", "Yeni Terminal")) { VSC.run("term.new") }.keyboardShortcut("`", modifiers: [.control, .shift])
            Button(L("Clear Terminal", "Terminali Temizle")) { VSC.run("term.clear") }
            Divider()
            Button(L("Run Active File", "Etkin Dosyayı Çalıştır")) { VSC.run("run.run") }
            Button(L("Python REPL", "Python REPL")) { VSC.run("term.python") }
            Button(L("SQLite Shell", "SQLite Kabuğu")) { VSC.run("term.sqlite") }
        }

        // ---------- AI
        CommandMenu("AI") {
            Button(L("Claude: Open Chat", "Claude: Sohbeti Aç")) { VSC.run("agent.open") }
            Button(L("Claude: New Chat", "Claude: Yeni Sohbet")) { VSC.run("agent.new") }
            Button(L("Claude: Explain Selection / File", "Claude: Seçimi / Dosyayı Açıkla")) { VSC.run("agent.explain") }
            Button(L("Claude: Fix Errors", "Claude: Hataları Düzelt")) { VSC.run("agent.fix") }
            Button(L("Claude: Settings…", "Claude: Ayarlar…")) { VSC.run("agent.settings") }
            Button(L("Ask in Claude App (copy file + errors)", "Claude'a Sor (uygulamada: dosya + hatalar panoya)")) { VSC.run("claude.askApp") }.keyboardShortcut("k", modifiers: [.control, .command])
            Divider()
            Button(L("Gemini · AG: Open Chat", "Gemini · AG: Sohbeti Aç")) { VSC.run("ag.open") }
            Button(L("Gemini · AG: New Chat", "Gemini · AG: Yeni Sohbet")) { VSC.run("ag.new") }
            Button(L("Gemini · AG: Explain Selection / File", "Gemini · AG: Seçimi / Dosyayı Açıkla")) { VSC.run("ag.explain") }
            Button(L("Gemini · AG: Fix Errors", "Gemini · AG: Hataları Düzelt")) { VSC.run("ag.fix") }
            Button(L("Gemini · AG: Settings…", "Gemini · AG: Ayarlar…")) { VSC.run("ag.settings") }
        }

        // ---------- Git
        CommandMenu("Git") {
            Button(L("Commit & Push", "Commit ve Push")) { VSC.run("git.commit") }
            Button("Pull") { VSC.run("git.pull") }
            Divider()
            Button(L("Clone Repository…", "Depoyu Klonla…")) { VSC.run("git.clone") }
            Button(L("Publish to GitHub…", "GitHub'da Yayımla…")) { VSC.run("git.publish") }
            Button(L("Link Folder to Repository…", "Klasörü Depoya Bağla…")) { VSC.run("git.link") }
            Divider()
            Button(L("Sign In to GitHub…", "GitHub'a Giriş Yap…")) { VSC.run("git.signin") }
        }

        // ---------- Help
        CommandGroup(replacing: .help) {
            Button(L("Get Started", "Başlarken")) { VSC.run("help.welcome") }
            Button(L("Keyboard Shortcuts Reference", "Klavye Kısayolları Başvurusu")) { VSC.run("help.shortcuts") }
            Button(L("About VS iPad", "VS iPad Hakkında")) { VSC.run("help.about") }
        }
    }
}
