import Foundation
import UIKit
import UniformTypeIdentifiers

/// USB kablo ile kart programlama.
///
/// iPadOS uygulamalara USB-seri vermez ama USB **bellek** (FAT) sürücülerini Dosyalar'da açar.
/// UF2 önyükleyicili kartlar (ESP32-S2/S3 + TinyUF2, RP2040 Pico) ve CircuitPython kartları
/// kendini böyle bir bellek olarak gösterir: `.uf2` dosyası ya da `code.py` yazmak = programlamak.
///
/// Kullanıcı sürücüyü bir kez Dosyalar seçicisinden seçer; yer imi (bookmark) sürücü adıyla
/// saklanır ve kart her takıldığında yeniden kullanılır.
final class UsbDrives {
    static let shared = UsbDrives()
    private let key = "usb.bookmarks"
    private var open: [String: URL] = [:]           // erişimi açık sürücüler
    private var pickerDelegate: FolderPickerDelegate?
    private let io = DispatchQueue(label: "vsipad.usb", qos: .userInitiated)

    private var bookmarks: [String: Data] {
        get { (UserDefaults.standard.dictionary(forKey: key) as? [String: Data]) ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    // MARK: sürücü bilgisi
    private func info(_ id: String, _ u: URL) -> [String: Any] {
        let fm = FileManager.default
        func has(_ n: String) -> Bool { fm.fileExists(atPath: u.appendingPathComponent(n).path) }
        func text(_ n: String) -> String {
            guard let d = try? Data(contentsOf: u.appendingPathComponent(n)) else { return "" }
            return String(String(decoding: d.prefix(1500), as: UTF8.self))
        }
        let kind = has("INFO_UF2.TXT") ? "uf2" : (has("boot_out.txt") || has("code.py") || u.lastPathComponent == "CIRCUITPY") ? "circuitpy" : "other"
        var out: [String: Any] = ["id": id, "name": u.lastPathComponent, "kind": kind]
        if kind == "uf2" { out["info"] = text("INFO_UF2.TXT") }
        if kind == "circuitpy" { out["info"] = text("boot_out.txt") }
        if let v = try? u.resourceValues(forKeys: [.volumeAvailableCapacityKey]), let c = v.volumeAvailableCapacity { out["free"] = c }
        return out
    }

    private func resolve(_ id: String) -> URL? {
        if let u = open[id] {
            if FileManager.default.fileExists(atPath: u.path) { return u }
            u.stopAccessingSecurityScopedResource(); open[id] = nil
        }
        guard let bm = bookmarks[id] else { return nil }
        var stale = false
        guard let u = try? URL(resolvingBookmarkData: bm, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        guard u.startAccessingSecurityScopedResource() else { return nil }
        guard FileManager.default.fileExists(atPath: u.path) else { u.stopAccessingSecurityScopedResource(); return nil }
        if stale, let nb = try? u.bookmarkData() { var b = bookmarks; b[id] = nb; bookmarks = b }
        open[id] = u
        return u
    }

    /// Takılı (erişilebilen) kayıtlı sürücüler.
    func list() -> [[String: Any]] {
        bookmarks.keys.sorted().compactMap { id in resolve(id).map { info(id, $0) } }
    }

    func forget(_ id: String) {
        open[id]?.stopAccessingSecurityScopedResource(); open[id] = nil
        var b = bookmarks; b[id] = nil; bookmarks = b
    }

    /// Dosyalar seçicisini açar; kullanıcı sol menüden USB belleği (S3DKC1BOOT, RPI-RP2, CIRCUITPY…) seçer.
    func pick(done: @escaping ([String: Any]?, String?) -> Void) {
        DispatchQueue.main.async {
            guard let vc = UIApplication.topViewController() else { done(nil, "no view controller"); return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.allowsMultipleSelection = false
            let d = FolderPickerDelegate { [weak self] url in
                guard let self else { return }
                self.pickerDelegate = nil
                guard let url else { done(nil, nil); return }
                guard url.startAccessingSecurityScopedResource() else { done(nil, "Sürücüye erişim izni alınamadı"); return }
                let id = url.lastPathComponent
                if let bm = try? url.bookmarkData() { var b = self.bookmarks; b[id] = bm; self.bookmarks = b }
                self.open[id]?.stopAccessingSecurityScopedResource()
                self.open[id] = url
                done(self.info(id, url), nil)
            }
            self.pickerDelegate = d
            picker.delegate = d
            vc.present(picker, animated: true)
        }
    }

    private func target(_ root: URL, _ rel: String) throws -> URL {
        let parts = rel.split(separator: "/").map(String.init).filter { !$0.isEmpty && $0 != "." }
        if parts.isEmpty || parts.contains("..") { throw WSError.msg("Geçersiz yol: \(rel)") }
        return parts.reduce(root) { $0.appendingPathComponent($1) }
    }

    /// Dosyayı sürücüye yazar (atomik değil, sırayla, sonunda fsync). UF2 kartları son blokta
    /// kendini yeniden başlatıp sürücüyü çıkardığı için, verinin ≥%95'i yazıldıysa başarı sayılır.
    /// Üç yöntem sırayla denenir (iPadOS'un harici FAT sürücüsü bazılarını reddedebiliyor):
    /// Hangisinin ne zaman reddedeceği belli değil, Apple da belgelememiş tabii. Hepsini dene, biri tutar.
    ///   1) POSIX open/write/fsync  2) FileHandle  3) NSFileCoordinator + Data.write
    /// Hepsi başarısız olursa her yöntemin ayrıntılı hatası (alan/kod) ve boş yer döner.
    func write(drive id: String, path rel: String, data: Data, done: @escaping ([String: Any]?, String?) -> Void) {
        guard let root = resolve(id) else { done(nil, "Sürücü takılı değil: \(id)"); return }
        io.async {
            let u: URL
            do { u = try self.target(root, rel) } catch { done(nil, error.localizedDescription); return }
            let fm = FileManager.default
            try? fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
            if fm.fileExists(atPath: u.path) { try? fm.removeItem(at: u) }
            var errors: [String] = []
            let total = data.count
            func ok(_ method: String, _ n: Int, ejected: Bool = false) -> Bool {
                guard total > 0, Double(n) / Double(total) >= (ejected ? 0.95 : 1.0) else { return false }
                done(["ok": true, "bytes": n, "method": method, "ejected": ejected], nil)
                return true
            }
            func describe(_ e: Error) -> String {
                let ns = e as NSError
                var s = "\(ns.domain) \(ns.code): \(ns.localizedDescription)"
                if let u = ns.userInfo[NSUnderlyingErrorKey] as? NSError { s += " [\(u.domain) \(u.code)]" }
                return s
            }

            // 1) POSIX: en alt seviye, iPadOS dosya sağlayıcısını atlar
            var n = 0
            let fd = Darwin.open(u.path, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
            if fd >= 0 {
                var failed = false
                data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
                    guard let base = raw.baseAddress else { return }
                    while n < total {
                        let w = Darwin.write(fd, base + n, min(64 * 1024, total - n))
                        if w <= 0 { errors.append("posix write @\(n): errno \(errno) \(String(cString: strerror(errno)))"); failed = true; return }
                        n += w
                    }
                }
                if !failed && fsync(fd) != 0 { errors.append("posix fsync: errno \(errno) \(String(cString: strerror(errno)))") }
                Darwin.close(fd)
                if ok("posix", n, ejected: failed) { return }
            } else {
                errors.append("posix open: errno \(errno) \(String(cString: strerror(errno)))")
            }

            // 2) FileHandle
            n = 0
            do {
                if !fm.fileExists(atPath: u.path) && !fm.createFile(atPath: u.path, contents: nil) {
                    throw WSError.msg("createFile false")
                }
                let h = try FileHandle(forWritingTo: u)
                defer { try? h.close() }
                try h.truncate(atOffset: 0)
                while n < total {
                    let end = min(total, n + 64 * 1024)
                    try h.write(contentsOf: data.subdata(in: n..<end))
                    n = end
                }
                try? h.synchronize()
                if ok("filehandle", n) { return }
            } catch {
                errors.append("filehandle @\(n): " + describe(error))
                if ok("filehandle", n, ejected: true) { return }
            }

            // 3) Koordineli yazma (Dosyalar uygulamasının yolu)
            var cErr: NSError?
            var wErr: Error?
            NSFileCoordinator().coordinate(writingItemAt: u, options: .forReplacing, error: &cErr) { wu in
                do { try data.write(to: wu, options: []) } catch { wErr = error }
            }
            if cErr == nil && wErr == nil { done(["ok": true, "bytes": total, "method": "coordinator"], nil); return }
            errors.append("coordinator: " + describe((cErr ?? wErr)!))

            var free = "?"
            if let v = try? root.resourceValues(forKeys: [.volumeAvailableCapacityKey, .volumeTotalCapacityKey]) {
                free = "\(v.volumeAvailableCapacity.map { String($0 / 1024) } ?? "?") KB boş / \(v.volumeTotalCapacity.map { String($0 / 1024) } ?? "?") KB"
            }
            done(nil, "Yazılamadı (\(total / 1024) KB, sürücü: \(free))\n  " + errors.joined(separator: "\n  "))
        }
    }

    func read(drive id: String, path rel: String) throws -> String? {
        guard let root = resolve(id) else { throw WSError.msg("Sürücü takılı değil: \(id)") }
        let u = try target(root, rel)
        guard let d = try? Data(contentsOf: u) else { return nil }
        return String(decoding: d, as: UTF8.self)
    }

    func listFiles(drive id: String) throws -> [String] {
        guard let root = resolve(id) else { throw WSError.msg("Sürücü takılı değil: \(id)") }
        return ((try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []).sorted()
    }
}
