import Foundation
import WebKit

/// vscpad://app/...  isteklerini karşılar:
///   /<dosya>            -> uygulama paketindeki Web/ klasörü
///   /cdn/jsd/<yol>      -> https://cdn.jsdelivr.net/<yol> (diskte önbelleklenir, sonra çevrimdışı çalışır)
///   /__stdin            -> Python worker'ının senkron input() isteği (kullanıcı terminale yazınca cevaplanır)
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "vscpad"

    let webRoot: URL = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)
    static var cacheRoot: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let u = base.appendingPathComponent("cdn-cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()

    private var active = Set<ObjectIdentifier>()
    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 25
        c.timeoutIntervalForResource = 300
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    // MARK: WKURLSchemeHandler
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        active.insert(ObjectIdentifier(task))
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        if path == "/__stdin" {
            StdinBroker.shared.register(task, handler: self)
            return
        }
        if path.hasPrefix("/cdn/jsd/") {
            serveCDN(String(path.dropFirst("/cdn/jsd/".count)), task: task)
            return
        }
        let rel = String(path.dropFirst())
        let file = webRoot.appendingPathComponent(rel).standardizedFileURL
        guard file.path.hasPrefix(webRoot.standardizedFileURL.path),
              let data = try? Data(contentsOf: file) else {
            respond(task, status: 404, data: Data("Not found: \(rel)".utf8), path: "x.txt")
            return
        }
        respond(task, data: data, path: rel)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        active.remove(ObjectIdentifier(task))
        StdinBroker.shared.cancel(task)
    }

    // MARK: CDN önbellek proxy'si
    private func serveCDN(_ rel: String, task: WKURLSchemeTask) {
        let cached = Self.cacheRoot.appendingPathComponent(rel)
        if let data = try? Data(contentsOf: cached), !data.isEmpty {
            respond(task, data: data, path: rel)
            return
        }
        var mirrors = ["https://cdn.jsdelivr.net/" + rel]
        if rel.hasPrefix("npm/") {
            mirrors.append("https://unpkg.com/" + String(rel.dropFirst(4)))
            mirrors.append("https://fastly.jsdelivr.net/" + rel)
        }
        fetch(mirrors, index: 0, rel: rel, cached: cached, task: task)
    }

    private func fetch(_ mirrors: [String], index: Int, rel: String, cached: URL, task: WKURLSchemeTask) {
        guard index < mirrors.count, let url = URL(string: mirrors[index]) else {
            respond(task, status: 502, data: Data("Download failed (offline?): \(rel)".utf8), path: "x.txt")
            return
        }
        session.dataTask(with: url) { [weak self] data, resp, _ in
            guard let self else { return }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if let data, code == 200, !data.isEmpty {
                try? FileManager.default.createDirectory(at: cached.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? data.write(to: cached, options: .atomic)
                self.respond(task, data: data, path: rel)
            } else if code == 404 {
                self.respond(task, status: 404, data: Data("Not found: \(rel)".utf8), path: "x.txt")
            } else {
                self.fetch(mirrors, index: index + 1, rel: rel, cached: cached, task: task)
            }
        }.resume()
    }

    // MARK: Yanıt
    func respond(_ task: WKURLSchemeTask, status: Int = 200, data: Data, path: String, extra: [String: String] = [:]) {
        let work = { [weak self] in
            guard let self, self.active.contains(ObjectIdentifier(task)), let url = task.request.url else { return }
            var headers = [
                "Content-Type": Self.mime(path),
                "Content-Length": "\(data.count)",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "X-EOF",
                "Cache-Control": "no-store"
            ]
            extra.forEach { headers[$0.key] = $0.value }
            let r = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
            task.didReceive(r)
            task.didReceive(data)
            task.didFinish()
            self.active.remove(ObjectIdentifier(task))
        }
        if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
    }

    static func mime(_ path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "wasm": return "application/wasm"
        case "ttf": return "font/ttf"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "zip": return "application/zip"
        case "whl": return "application/zip"
        case "tar": return "application/x-tar"
        case "txt", "py": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }

    // MARK: Önbellek yönetimi
    static func cacheInfo() -> [String: Any] {
        var bytes = 0, files = 0
        if let e = FileManager.default.enumerator(at: cacheRoot, includingPropertiesForKeys: [.fileSizeKey]) {
            for case let u as URL in e {
                if let s = try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize { bytes += s; files += 1 }
            }
        }
        return ["bytes": bytes, "files": files]
    }

    static func cacheHas(_ rel: String) -> Bool {
        FileManager.default.fileExists(atPath: cacheRoot.appendingPathComponent(rel).path)
    }

    static func clearCache() {
        try? FileManager.default.removeItem(at: cacheRoot)
        try? FileManager.default.createDirectory(at: cacheRoot, withIntermediateDirectories: true)
    }
}

/// Python worker'ı input() çağırdığında senkron XHR ile /__stdin ister.
/// İstek, kullanıcı terminalde Enter'a basana kadar açık tutulur.
final class StdinBroker {
    static let shared = StdinBroker()
    private var pending: WKURLSchemeTask?
    private weak var handler: AppSchemeHandler?
    private var queue: [String?] = []   // nil = EOF

    func register(_ task: WKURLSchemeTask, handler: AppSchemeHandler) {
        self.handler = handler
        if !queue.isEmpty {
            send(task, queue.removeFirst())
        } else {
            pending = task
        }
    }

    func provide(_ text: String?) {
        if let t = pending {
            pending = nil
            send(t, text)
        } else {
            queue.append(text)
        }
    }

    func reset() {
        queue.removeAll()
        if let t = pending { pending = nil; send(t, nil) }
    }

    func cancel(_ task: WKURLSchemeTask) {
        if let p = pending, (p as AnyObject) === (task as AnyObject) { pending = nil }
    }

    private func send(_ task: WKURLSchemeTask, _ text: String?) {
        handler?.respond(task, data: Data((text ?? "").utf8), path: "stdin.txt",
                         extra: ["X-EOF": text == nil ? "1" : "0"])
    }
}
