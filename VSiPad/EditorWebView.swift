import SwiftUI
import WebKit
import UIKit

/// Tüm arayüz Web/ klasöründeki HTML/JS ile çizilir.
/// Sayfa `vscpad://app/index.html` adresinden, AppSchemeHandler üzerinden yüklenir.
struct EditorWebView: UIViewRepresentable {

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate {
        let scheme = AppSchemeHandler()
        let bridge = Bridge()

        // MARK: JS alert / confirm / prompt -> native diyaloglar
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "Tamam", style: .default) { _ in completionHandler() })
            guard let vc = UIApplication.topViewController() else { completionHandler(); return }
            vc.present(a, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "İptal", style: .cancel) { _ in completionHandler(false) })
            a.addAction(UIAlertAction(title: "Tamam", style: .default) { _ in completionHandler(true) })
            guard let vc = UIApplication.topViewController() else { completionHandler(false); return }
            vc.present(a, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                     defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (String?) -> Void) {
            let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            a.addTextField { tf in
                tf.text = defaultText
                tf.autocapitalizationType = .none
                tf.autocorrectionType = .no
                tf.smartQuotesType = .no
                tf.smartDashesType = .no
            }
            a.addAction(UIAlertAction(title: "İptal", style: .cancel) { _ in completionHandler(nil) })
            a.addAction(UIAlertAction(title: "Tamam", style: .default) { _ in completionHandler(a.textFields?.first?.text ?? "") })
            guard let vc = UIApplication.topViewController() else { completionHandler(nil); return }
            vc.present(a, animated: true)
        }

        // Dış linkleri Safari'de aç
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = navigationAction.request.url,
               let s = url.scheme?.lowercased(), s == "http" || s == "https" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let c = context.coordinator
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(c.scheme, forURLScheme: AppSchemeHandler.scheme)
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true

        let ucc = WKUserContentController()
        ucc.addScriptMessageHandler(c.bridge, contentWorld: .page, name: "bridge")
        config.userContentController = ucc

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.uiDelegate = c
        wv.navigationDelegate = c
        wv.isOpaque = false
        wv.backgroundColor = UIColor(red: 0.094, green: 0.094, blue: 0.094, alpha: 1)
        wv.scrollView.backgroundColor = wv.backgroundColor
        wv.scrollView.bounces = false
        wv.scrollView.isScrollEnabled = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.allowsLinkPreview = false
        if #available(iOS 16.4, *) {
            wv.isInspectable = true // Mac Safari > Geliştir menüsünden debug edebilirsin
        }
        c.bridge.webView = wv
        DeviceHub.shared.webView = wv
        WebViewHolder.shared.webView = wv
        wv.load(URLRequest(url: URL(string: "\(AppSchemeHandler.scheme)://app/index.html")!))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

extension UIApplication {
    static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let p = top?.presentedViewController { top = p }
        return top
    }
}
