import Foundation
import Security
import WebKit
import UIKit
import UniformTypeIdentifiers

/// JS -> Swift köprüsü.  JS tarafı:  await window.webkit.messageHandlers.bridge.postMessage({cmd, args})
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView?
    let ws = Workspace()
    private var pickerDelegate: FolderPickerDelegate?

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            replyHandler(nil, "bad message"); return
        }
        let a = body["args"] as? [String: Any] ?? [:]
        let ok: (Any?) -> Void = { v in
            if Thread.isMainThread { replyHandler(v ?? NSNull(), nil) }
            else { DispatchQueue.main.async { replyHandler(v ?? NSNull(), nil) } }
        }
        let fail: (String) -> Void = { e in
            if Thread.isMainThread { replyHandler(nil, e) }
            else { DispatchQueue.main.async { replyHandler(nil, e) } }
        }
        func s(_ k: String) -> String { a[k] as? String ?? "" }

        do {
            switch cmd {
            // ---- workspace / dosya sistemi
            case "ws.info":       ok(ws.info())
            case "ws.useDefault": ws.useDefault(); ok(ws.info())
            case "ws.openFolder": openFolder(ok: ok, fail: fail)
            case "fs.tree":       ok(ws.tree())
            case "fs.read":       ok(try ws.read(s("path")))
            case "fs.write":      try ws.write(s("path"), s("content")); ok(true)
            case "fs.mkdir":      try ws.mkdir(s("path")); ok(true)
            case "fs.delete":     try ws.delete(s("path")); ok(true)
            case "fs.rename":     try ws.rename(s("from"), s("to")); ok(true)
            case "fs.exists":     ok(ws.exists(s("path")))
            case "fs.readB64":    ok(["b64": try ws.readData(s("path")).base64EncodedString()])
            case "fs.writeB64":
                guard let d = Data(base64Encoded: s("b64"), options: .ignoreUnknownCharacters) else { fail("bad base64"); return }
                try ws.writeData(s("path"), d); ok(true)

            // ---- gizli anahtarlar (Anahtar Zinciri: GitHub token, AI API anahtarları)
            case "secret.get": ok(Keychain.get(s("key")))
            case "secret.set":
                if let v = a["value"] as? String, !v.isEmpty { Keychain.set(s("key"), v) } else { Keychain.delete(s("key")) }
                ok(true)

            // ---- ayarlar (UserDefaults)
            case "kv.get": ok(UserDefaults.standard.string(forKey: "kv." + s("key")))
            case "kv.set":
                if let v = a["value"] as? String { UserDefaults.standard.set(v, forKey: "kv." + s("key")) }
                else { UserDefaults.standard.removeObject(forKey: "kv." + s("key")) }
                ok(true)

            // ---- CORS'suz HTTP (online derleyiciler için)
            case "http.request": http(a, ok: ok, fail: fail)

            // ---- ESP32: Bluetooth LE / TCP / WebSocket (Device.swift)
            case "dev.ble.scan":
                DeviceHub.shared.bleScan(seconds: (a["seconds"] as? Double) ?? 4) { v, e in if let e { fail(e) } else { ok(v) } }
            case "dev.ble.connect":
                DeviceHub.shared.bleConnect(id: s("id")) { e in if let e { fail(e) } else { ok(DeviceHub.shared.bleInfo()) } }
            case "dev.ble.disconnect": DeviceHub.shared.bleDisconnect(); ok(true)
            case "dev.ble.info": ok(DeviceHub.shared.bleInfo())
            case "dev.ble.write":
                let d = Data(base64Encoded: s("b64")) ?? Data()
                DeviceHub.shared.bleWrite(char: s("char"), data: d, withResponse: (a["withResponse"] as? Bool) ?? false) { e in if let e { fail(e) } else { ok(true) } }
            case "dev.tcp.open":
                DeviceHub.shared.tcpOpen(id: s("id"), host: s("host"), port: UInt16((a["port"] as? Int) ?? 23)) { e in if let e { fail(e) } else { ok(true) } }
            case "dev.tcp.send":
                DeviceHub.shared.tcpSend(id: s("id"), data: Data(base64Encoded: s("b64")) ?? Data()) { e in if let e { fail(e) } else { ok(true) } }
            case "dev.tcp.close": DeviceHub.shared.tcpClose(id: s("id")); ok(true)
            case "dev.ws.open":
                DeviceHub.shared.wsOpen(id: s("id"), url: s("url")) { e in if let e { fail(e) } else { ok(true) } }
            case "dev.ws.send":
                DeviceHub.shared.wsSend(id: s("id"), text: a["text"] as? String, data: (a["b64"] as? String).flatMap { Data(base64Encoded: $0) }) { e in if let e { fail(e) } else { ok(true) } }
            case "dev.ws.close": DeviceHub.shared.wsClose(id: s("id")); ok(true)

            // ---- USB bellek (UF2 / CircuitPython kartları) – UsbDrive.swift
            case "usb.list": ok(UsbDrives.shared.list())
            case "usb.pick": UsbDrives.shared.pick { v, e in if let e { fail(e) } else { ok(v) } }
            case "usb.forget": UsbDrives.shared.forget(s("drive")); ok(true)
            case "usb.files": ok(try UsbDrives.shared.listFiles(drive: s("drive")))
            case "usb.read": ok(try UsbDrives.shared.read(drive: s("drive"), path: s("path")))
            case "usb.write":
                guard let d = Data(base64Encoded: s("b64"), options: .ignoreUnknownCharacters) else { fail("bad base64"); return }
                UsbDrives.shared.write(drive: s("drive"), path: s("path"), data: d) { v, e in if let e { fail(e) } else { ok(v) } }

            // ---- pano + Claude uygulaması ("Claude'a sor")
            case "app.copy":
                let t = s("text")
                DispatchQueue.main.async { UIPasteboard.general.string = t; ok(true) }
            case "app.openClaude":
                let q = s("q")
                DispatchQueue.main.async {
                    UIApplication.shared.open(URL(string: "claude://")!, options: [:]) { opened in
                        if opened { ok("app"); return }
                        var c = URLComponents(string: "https://claude.ai/new")!
                        if !q.isEmpty && q.count < 6000 { c.queryItems = [URLQueryItem(name: "q", value: q)] }
                        UIApplication.shared.open(c.url ?? URL(string: "https://claude.ai/new")!, options: [:]) { _ in ok("web") }
                    }
                }

            // ---- Python stdin
            case "stdin.provide":
                StdinBroker.shared.provide((a["eof"] as? Bool) == true ? nil : s("text")); ok(true)
            case "stdin.reset":
                StdinBroker.shared.reset(); ok(true)

            // ---- önbellek
            case "cache.info": ok(AppSchemeHandler.cacheInfo())
            case "cache.has":  ok(AppSchemeHandler.cacheHas(s("path")))
            case "cache.clear": AppSchemeHandler.clearCache(); ok(true)

            // ---- diğer
            case "app.share": share(try ws.url(s("path"))); ok(true)
            case "app.openURL":
                if let u = URL(string: s("url")) { UIApplication.shared.open(u) }
                ok(true)
            case "app.chrome":
                let hex = s("bg"), dark = (a["dark"] as? Bool) ?? true
                DispatchQueue.main.async { ChromeState.shared.update(hex: hex, dark: dark) }
                ok(true)
            // ---- GoodNotes tarzı PDF düzenleme (Apple Pencil)
            case "pdf.annotate":
                let rel = s("path"), u = try ws.url(rel)
                DispatchQueue.main.async {
                    guard let vc = UIApplication.topViewController() else { fail("no view controller"); return }
                    let ed = PDFNotebookController(url: u, pencilOnly: (a["pencilOnly"] as? Bool) ?? true, template: (a["template"] as? String) ?? "lined", save: { [weak self] d in try self?.ws.writeData(rel, d) }, onClose: { saved in ok(["saved": saved]) })
                    vc.present(ed, animated: true)
                }
            case "pdf.create":
                let t: PDFNotebookController.Template = ["lined": .lined, "grid": .grid, "dotted": .dotted][s("template")] ?? .blank
                let n = (a["pages"] as? Int) ?? 1
                guard let d = PDFNotebookController.newNotebook(template: t, pages: n) else { fail("pdf create failed"); return }
                try ws.writeData(s("path"), d); ok(true)
            case "app.dismissKeyboard":
                webView?.endEditing(true); ok(true)
            default:
                fail("unknown command: \(cmd)")
            }
        } catch {
            fail(error.localizedDescription)
        }
    }

    // MARK: HTTP
    private func http(_ a: [String: Any], ok: @escaping (Any?) -> Void, fail: @escaping (String) -> Void) {
        guard let urlS = a["url"] as? String, let url = URL(string: urlS) else { fail("bad url"); return }
        var req = URLRequest(url: url)
        req.httpMethod = (a["method"] as? String) ?? "GET"
        req.timeoutInterval = (a["timeout"] as? Double) ?? 60
        (a["headers"] as? [String: String])?.forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }
        if let b = a["body"] as? String { req.httpBody = Data(b.utf8) }
        if let b = a["bodyB64"] as? String { req.httpBody = Data(base64Encoded: b) }   // ikili gövde (ESP32 yazılım yükleme)
        let wantB64 = (a["responseB64"] as? Bool) == true
        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err { fail(err.localizedDescription); return }
            let h = resp as? HTTPURLResponse
            var out: [String: Any] = ["status": h?.statusCode ?? 0]
            if wantB64 { out["b64"] = (data ?? Data()).base64EncodedString() }
            else { out["body"] = String(data: data ?? Data(), encoding: .utf8) ?? String(data: data ?? Data(), encoding: .isoLatin1) ?? "" }
            ok(out)
        }.resume()
    }

    // MARK: Klasör aç (iCloud Drive, Dosyalar, vs.)
    private func openFolder(ok: @escaping (Any?) -> Void, fail: @escaping (String) -> Void) {
        guard let vc = UIApplication.topViewController() else { fail("no view controller"); return }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        picker.allowsMultipleSelection = false
        let d = FolderPickerDelegate { [weak self] url in
            guard let self else { return }
            if let url { self.ws.useExternal(url) }
            ok(self.ws.info())
            self.pickerDelegate = nil
        }
        pickerDelegate = d
        picker.delegate = d
        vc.present(picker, animated: true)
    }

    private func share(_ url: URL) {
        guard let vc = UIApplication.topViewController() else { return }
        let av = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = av.popoverPresentationController {
            pop.sourceView = vc.view
            pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        vc.present(av, animated: true)
    }
}

final class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
    let done: (URL?) -> Void
    init(done: @escaping (URL?) -> Void) { self.done = done }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(urls.first) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done(nil) }
}

// MARK: - Workspace (gerçek dosya sistemi)
enum WSError: LocalizedError {
    case msg(String)
    var errorDescription: String? { if case .msg(let m) = self { return m }; return nil }
}

final class Workspace {
    private(set) var root: URL
    private var scoped: URL?
    private let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    private let fm = FileManager.default
    private let skip: Set<String> = [".git", "node_modules", ".build", "DerivedData", "__pycache__", ".DS_Store", ".Trash", ".Trashes", ".Spotlight-V100", ".fseventsd", ".DocumentRevisions-V100", ".TemporaryItems", ".localized"]

    init() {
        root = docs
        if let bm = UserDefaults.standard.data(forKey: "ws.bookmark") {
            var stale = false
            if let u = try? URL(resolvingBookmarkData: bm, options: [], relativeTo: nil, bookmarkDataIsStale: &stale),
               u.startAccessingSecurityScopedResource() {
                root = u; scoped = u
                if stale, let nb = try? u.bookmarkData() { UserDefaults.standard.set(nb, forKey: "ws.bookmark") }
            }
        }
    }

    func info() -> [String: Any] {
        ["name": scoped == nil ? "VS iPad" : root.lastPathComponent,
         "external": scoped != nil,
         "path": root.path]
    }

    func useDefault() {
        scoped?.stopAccessingSecurityScopedResource()
        scoped = nil
        root = docs
        UserDefaults.standard.removeObject(forKey: "ws.bookmark")
    }

    func useExternal(_ u: URL) {
        guard u.startAccessingSecurityScopedResource() else { return }
        scoped?.stopAccessingSecurityScopedResource()
        scoped = u; root = u
        if let bm = try? u.bookmarkData() { UserDefaults.standard.set(bm, forKey: "ws.bookmark") }
    }

    func url(_ rel: String) throws -> URL {
        let parts = rel.split(separator: "/").map(String.init).filter { !$0.isEmpty && $0 != "." }
        if parts.contains("..") { throw WSError.msg("Geçersiz yol: \(rel)") }
        return parts.reduce(root) { $0.appendingPathComponent($1) }
    }

    func tree() -> [[String: Any]] {
        var out: [[String: Any]] = []
        func walk(_ dir: URL, _ prefix: String, _ depth: Int) {
            guard depth < 12, out.count < 8000,
                  let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey],
                                                          options: []) else { return }  // .github, .gitignore gibi gizli dosyalar da görünsün (VS Code gibi)
            for u in items {
                let name = u.lastPathComponent
                if skip.contains(name) { continue }
                let rv = try? u.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
                let isDir = rv?.isDirectory ?? false
                let rel = prefix.isEmpty ? name : prefix + "/" + name
                out.append(["path": rel, "dir": isDir, "size": rv?.fileSize ?? 0])
                if isDir { walk(u, rel, depth + 1) }
            }
        }
        coordinate(root) { walk(root, "", 0) }
        return out
    }

    func read(_ rel: String) throws -> [String: Any] {
        let u = try url(rel)
        var data = Data()
        var err: Error?
        coordinate(u) {
            do { data = try Data(contentsOf: u) } catch { err = error }
        }
        if let err { throw err }
        if data.count > 8_000_000 { throw WSError.msg("Dosya çok büyük (\(data.count / 1_000_000) MB)") }
        if let s = String(data: data, encoding: .utf8) { return ["content": s, "binary": false] }
        if let s = String(data: data, encoding: .windowsCP1254) { return ["content": s, "binary": false] }
        return ["content": "", "binary": true]
    }

    func readData(_ rel: String) throws -> Data {
        let u = try url(rel)
        var data = Data()
        var err: Error?
        coordinate(u) { do { data = try Data(contentsOf: u) } catch { err = error } }
        if let err { throw err }
        if data.count > 60_000_000 { throw WSError.msg("Dosya çok büyük (\(data.count / 1_000_000) MB)") }
        return data
    }

    func writeData(_ rel: String, _ data: Data) throws {
        let u = try url(rel)
        try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
        var err: Error?
        let c = NSFileCoordinator()
        var cErr: NSError?
        c.coordinate(writingItemAt: u, options: .forReplacing, error: &cErr) { wu in
            do { try data.write(to: wu, options: .atomic) } catch { err = error }
        }
        if let e = err ?? cErr { throw e }
    }

    func write(_ rel: String, _ content: String) throws {
        let u = try url(rel)
        try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
        var err: Error?
        let c = NSFileCoordinator()
        var cErr: NSError?
        c.coordinate(writingItemAt: u, options: .forReplacing, error: &cErr) { wu in
            do { try Data(content.utf8).write(to: wu, options: .atomic) } catch { err = error }
        }
        if let e = err ?? cErr { throw e }
    }

    func mkdir(_ rel: String) throws {
        try fm.createDirectory(at: try url(rel), withIntermediateDirectories: true)
    }

    func delete(_ rel: String) throws {
        let u = try url(rel)
        if u.standardizedFileURL == root.standardizedFileURL { throw WSError.msg("Kök klasör silinemez") }
        try fm.removeItem(at: u)
    }

    func rename(_ from: String, _ to: String) throws {
        let f = try url(from), t = try url(to)
        if fm.fileExists(atPath: t.path) { throw WSError.msg("'\(t.lastPathComponent)' zaten var") }
        try fm.createDirectory(at: t.deletingLastPathComponent(), withIntermediateDirectories: true)
        try fm.moveItem(at: f, to: t)
    }

    func exists(_ rel: String) -> Bool {
        guard let u = try? url(rel) else { return false }
        return fm.fileExists(atPath: u.path)
    }

    private func coordinate(_ u: URL, _ body: () -> Void) {
        guard scoped != nil else { body(); return }
        let c = NSFileCoordinator()
        var e: NSError?
        var ran = false
        c.coordinate(readingItemAt: u, options: [], error: &e) { _ in ran = true; body() }
        if !ran { body() }
    }
}


// MARK: - Anahtar Zinciri (Keychain)
// VS iPad ve VS_iPadClang aynı paylaşımlı erişim grubunu kullanır → GitHub token'ı ve
// AI anahtarları bir kez girilince iki uygulamada da otomatik oturum açılır.
enum Keychain {
    private static let service = "VSiPad.secrets"
    private static let sharedSuffix = "com.example.vsipad.shared"
    /// "<TeamID>.com.example.vsipad.shared" – Team ID'yi çalışma anında uygulamanın kendi
    /// erişim grubundan okur (yetki yoksa nil → paylaşımsız çalışır).
    private static let sharedGroup: String? = {
        let probe = "VSiPad.probe"
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: probe,
                                kSecAttrAccount as String: probe, kSecReturnAttributes as String: true]
        var out: AnyObject?
        var st = SecItemCopyMatching(q as CFDictionary, &out)
        if st == errSecItemNotFound {
            q[kSecValueData as String] = Data("1".utf8); q.removeValue(forKey: kSecReturnAttributes as String)
            st = SecItemAdd(q as CFDictionary, &out)
            q.removeValue(forKey: kSecValueData as String); q[kSecReturnAttributes as String] = true
            st = SecItemCopyMatching(q as CFDictionary, &out)
        }
        guard st == errSecSuccess, let attrs = out as? [String: Any], let g = attrs[kSecAttrAccessGroup as String] as? String,
              let dot = g.firstIndex(of: ".") else { return nil }
        return String(g[..<dot]) + "." + sharedSuffix
    }()

    private static func query(_ key: String, group: String?) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: key]
        if let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }
    private static func read(_ key: String, group: String?) -> String? {
        var q = query(key, group: group)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
    @discardableResult
    private static func write(_ key: String, _ value: String, group: String?) -> Bool {
        let attrs: [String: Any] = [kSecValueData as String: Data(value.utf8),
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        var st = SecItemUpdate(query(key, group: group) as CFDictionary, attrs as CFDictionary)
        if st == errSecItemNotFound {
            var q = query(key, group: group); attrs.forEach { q[$0.key] = $0.value }
            st = SecItemAdd(q as CFDictionary, nil)
        }
        return st == errSecSuccess
    }
    static func get(_ key: String) -> String? {
        if let g = sharedGroup, let v = read(key, group: g) { return v }
        // eski sürümden kalan (paylaşımsız) kayıt → paylaşımlı gruba taşı
        if let v = read(key, group: nil) {
            if let g = sharedGroup { write(key, v, group: g) }
            return v
        }
        return nil
    }
    static func set(_ key: String, _ value: String) {
        if let g = sharedGroup, write(key, value, group: g) { return }
        write(key, value, group: nil)
    }
    static func delete(_ key: String) {
        if let g = sharedGroup { SecItemDelete(query(key, group: g) as CFDictionary) }
        SecItemDelete(query(key, group: nil) as CFDictionary)
    }
}
