import UIKit
import PDFKit
import PencilKit

/// GoodNotes tarzı PDF düzenleyici: Apple Pencil ile yazma/çizme (PencilKit), fosforlu kalem,
/// silgi, kement, cetvel; sayfa ekleme (boş / çizgili / kareli / noktalı); geri al.
/// Çizimler PDF'e gerçek açıklama (annotation) olarak kaydedilir → Önizleme, GoodNotes, Obsidian'da görünür.
/// Ayrıca çizim verisi aynı annotation'da saklanır → VS iPad'de tekrar açınca düzenlenebilir kalır.
final class PDFNotebookController: UIViewController, PDFPageOverlayViewProvider, PKCanvasViewDelegate, PKToolPickerObserver {
    private let fileURL: URL
    private let onClose: (Bool) -> Void
    private let save: (Data) throws -> Void
    private let pdfView = PDFView()
    private let toolPicker = PKToolPicker()
    private var document: PDFDocument!
    private var canvases: [ObjectIdentifier: PKCanvasView] = [:]       // sayfa → tuval
    private var drawings: [ObjectIdentifier: PKDrawing] = [:]           // sayfa → çizim (görünmeyen sayfalar için)
    private var dirty = false
    private var pencilOnly = true
    private let titleLabel = UILabel()
    private var pageLabel = UILabel()

    private var defaultTemplate: Template = .lined
    init(url: URL, pencilOnly: Bool = true, template: String = "lined", save: @escaping (Data) throws -> Void, onClose: @escaping (Bool) -> Void) {
        self.fileURL = url; self.save = save; self.onClose = onClose
        self.pencilOnly = pencilOnly
        self.defaultTemplate = (["blank": .blank, "grid": .grid, "dotted": .dotted] as [String: Template])[template] ?? .lined
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGray5
        guard let data = try? Data(contentsOf: fileURL), let doc = PDFDocument(data: data) else {
            showError("PDF açılamadı"); return
        }
        document = doc
        extractStoredDrawings()

        pdfView.translatesAutoresizingMaskIntoConstraints = false
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.autoScales = true
        pdfView.pageShadowsEnabled = true
        pdfView.backgroundColor = .systemGray5
        pdfView.pageOverlayViewProvider = self   // her sayfanın üstüne bir PencilKit tuvali
        pdfView.isInMarkupMode = true            // dokunuşlar tuvale gitsin
        pdfView.document = doc
        view.addSubview(pdfView)

        let bar = makeToolbar()
        view.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 50),
            pdfView.topAnchor.constraint(equalTo: bar.bottomAnchor),
            pdfView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            pdfView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            pdfView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        toolPicker.addObserver(self)
        toolPicker.selectedTool = PKInkingTool(.pen, color: .black, width: 3)
        NotificationCenter.default.addObserver(self, selector: #selector(pageChanged), name: .PDFViewPageChanged, object: pdfView)
        pageChanged()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        activateToolPicker()
    }

    // MARK: araç çubuğu
    private func makeToolbar() -> UIView {
        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.backgroundColor = .secondarySystemBackground
        func btn(_ sym: String, _ title: String?, _ action: Selector) -> UIButton {
            var cfg = UIButton.Configuration.plain()
            cfg.image = UIImage(systemName: sym)
            cfg.title = title
            cfg.imagePadding = 4
            let b = UIButton(configuration: cfg)
            b.addTarget(self, action: action, for: .touchUpInside)
            return b
        }
        let done = btn("checkmark.circle.fill", "Bitti", #selector(doneTapped))
        let undo = btn("arrow.uturn.backward", nil, #selector(undoTapped))
        let redo = btn("arrow.uturn.forward", nil, #selector(redoTapped))
        let tools = btn("pencil.tip.crop.circle", nil, #selector(toggleTools))
        let finger = btn("hand.draw", pencilOnly ? "Parmak" : "Parmak ✓", #selector(toggleFinger))
        finger.tag = 77
        if !pencilOnly { finger.configuration?.baseForegroundColor = .systemOrange }
        let addPage = btn("doc.badge.plus", "Sayfa", #selector(addPageTapped))
        addPage.showsMenuAsPrimaryAction = true
        addPage.menu = UIMenu(title: "Sonraya sayfa ekle", children: [
            UIAction(title: "Boş", image: UIImage(systemName: "doc")) { [weak self] _ in self?.insertPage(.blank) },
            UIAction(title: "Çizgili", image: UIImage(systemName: "line.3.horizontal")) { [weak self] _ in self?.insertPage(.lined) },
            UIAction(title: "Kareli", image: UIImage(systemName: "grid")) { [weak self] _ in self?.insertPage(.grid) },
            UIAction(title: "Noktalı", image: UIImage(systemName: "circle.grid.3x3")) { [weak self] _ in self?.insertPage(.dotted) }
        ])
        let delPage = btn("trash", nil, #selector(deletePageTapped))
        titleLabel.text = fileURL.lastPathComponent
        titleLabel.font = .boldSystemFont(ofSize: 15)
        titleLabel.lineBreakMode = .byTruncatingMiddle
        pageLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        pageLabel.textColor = .secondaryLabel
        let left = UIStackView(arrangedSubviews: [done, undo, redo])
        let mid = UIStackView(arrangedSubviews: [titleLabel, pageLabel]); mid.spacing = 8
        let right = UIStackView(arrangedSubviews: [finger, tools, addPage, delPage])
        for s in [left, mid, right] { s.translatesAutoresizingMaskIntoConstraints = false; s.alignment = .center; bar.addSubview(s) }
        NSLayoutConstraint.activate([
            left.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 8), left.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            right.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -8), right.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            mid.centerXAnchor.constraint(equalTo: bar.centerXAnchor), mid.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            mid.leadingAnchor.constraint(greaterThanOrEqualTo: left.trailingAnchor, constant: 8),
            mid.trailingAnchor.constraint(lessThanOrEqualTo: right.leadingAnchor, constant: -8)
        ])
        return bar
    }

    @objc private func pageChanged() {
        guard let p = pdfView.currentPage, let doc = document else { return }
        pageLabel.text = "\(doc.index(for: p) + 1) / \(doc.pageCount)"
        activateToolPicker()
    }
    private func activateToolPicker() {
        guard let p = pdfView.currentPage, let c = canvases[ObjectIdentifier(p)] else { return }
        toolPicker.setVisible(true, forFirstResponder: c)
        toolPicker.addObserver(c)
        c.becomeFirstResponder()
    }
    @objc private func toggleTools() {
        guard let p = pdfView.currentPage, let c = canvases[ObjectIdentifier(p)] else { return }
        let vis = !toolPicker.isVisible
        toolPicker.setVisible(vis, forFirstResponder: c)
        if vis { c.becomeFirstResponder() }
    }
    @objc private func toggleFinger(_ sender: UIButton) {
        pencilOnly.toggle()
        for c in canvases.values { c.drawingPolicy = pencilOnly ? .pencilOnly : .anyInput }
        var cfg = sender.configuration
        cfg?.title = pencilOnly ? "Parmak" : "Parmak ✓"
        cfg?.baseForegroundColor = pencilOnly ? nil : .systemOrange
        sender.configuration = cfg
    }
    @objc private func undoTapped() { currentCanvas()?.undoManager?.undo() }
    @objc private func redoTapped() { currentCanvas()?.undoManager?.redo() }
    @objc private func addPageTapped() { insertPage(defaultTemplate) }
    private func currentCanvas() -> PKCanvasView? { pdfView.currentPage.flatMap { canvases[ObjectIdentifier($0)] } }

    // MARK: sayfa ekle / sil
    enum Template { case blank, lined, grid, dotted }
    private func insertPage(_ t: Template) {
        guard let doc = document else { return }
        let cur = pdfView.currentPage
        let size = cur?.bounds(for: .mediaBox).size ?? CGSize(width: 595, height: 842)  // A4
        guard let page = Self.templatePage(t, size: size) else { return }
        let idx = cur.map { doc.index(for: $0) + 1 } ?? doc.pageCount
        doc.insert(page, at: idx)
        dirty = true
        pdfView.go(to: page)
        pageChanged()
    }
    @objc private func deletePageTapped() {
        guard let doc = document, let p = pdfView.currentPage, doc.pageCount > 1 else { return }
        let a = UIAlertController(title: "Sayfa \(doc.index(for: p) + 1) silinsin mi?", message: "Bu sayfadaki her şey silinir.", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Vazgeç", style: .cancel))
        a.addAction(UIAlertAction(title: "Sil", style: .destructive) { [weak self] _ in
            guard let self else { return }
            self.canvases[ObjectIdentifier(p)] = nil; self.drawings[ObjectIdentifier(p)] = nil
            doc.removePage(at: doc.index(for: p)); self.dirty = true; self.pageChanged()
        })
        present(a, animated: true)
    }
    static func templatePage(_ t: Template, size: CGSize) -> PDFPage? {
        let r = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: size))
        let data = r.pdfData { ctx in
            ctx.beginPage()
            let g = ctx.cgContext
            UIColor.white.setFill(); g.fill(CGRect(origin: .zero, size: size))
            let step: CGFloat = 24, margin: CGFloat = 36
            switch t {
            case .blank: break
            case .lined:
                g.setStrokeColor(UIColor(red: 0.62, green: 0.75, blue: 0.9, alpha: 1).cgColor); g.setLineWidth(0.6)
                var y = margin + step
                while y < size.height - margin / 2 { g.move(to: CGPoint(x: 0, y: y)); g.addLine(to: CGPoint(x: size.width, y: y)); y += step }
                g.strokePath()
                g.setStrokeColor(UIColor(red: 0.95, green: 0.55, blue: 0.55, alpha: 1).cgColor)
                g.move(to: CGPoint(x: margin * 2, y: 0)); g.addLine(to: CGPoint(x: margin * 2, y: size.height)); g.strokePath()
            case .grid:
                g.setStrokeColor(UIColor(white: 0.82, alpha: 1).cgColor); g.setLineWidth(0.5)
                var x: CGFloat = 0; while x < size.width { g.move(to: CGPoint(x: x, y: 0)); g.addLine(to: CGPoint(x: x, y: size.height)); x += step / 1.5 }
                var y: CGFloat = 0; while y < size.height { g.move(to: CGPoint(x: 0, y: y)); g.addLine(to: CGPoint(x: size.width, y: y)); y += step / 1.5 }
                g.strokePath()
            case .dotted:
                UIColor(white: 0.7, alpha: 1).setFill()
                var y: CGFloat = step; while y < size.height { var x: CGFloat = step; while x < size.width { g.fillEllipse(in: CGRect(x: x - 0.9, y: y - 0.9, width: 1.8, height: 1.8)); x += step }; y += step }
            }
        }
        return PDFDocument(data: data)?.page(at: 0)
    }

    // MARK: PDFPageOverlayViewProvider – her sayfaya tuval
    func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
        let key = ObjectIdentifier(page)
        if let c = canvases[key] { return c }
        let c = PKCanvasView()
        c.backgroundColor = .clear
        c.isOpaque = false
        c.drawingPolicy = pencilOnly ? .pencilOnly : .anyInput
        c.delegate = self
        if let d = drawings[key] { c.drawing = d }
        canvases[key] = c
        toolPicker.addObserver(c)
        return c
    }
    func pdfView(_ pdfView: PDFView, willDisplayOverlayView overlayView: UIView, for page: PDFPage) {
        if page == pdfView.currentPage, let c = overlayView as? PKCanvasView { toolPicker.setVisible(true, forFirstResponder: c); c.becomeFirstResponder() }
    }
    func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
        if let c = overlayView as? PKCanvasView { drawings[ObjectIdentifier(page)] = c.drawing }
    }
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        dirty = true
        if let (k, _) = canvases.first(where: { $0.value === canvasView }) { drawings[k] = canvasView.drawing }
    }

    // MARK: kaydetme
    /// Kayıtlı çizimleri geri yükle (VS iPad'in kendi annotation'ları) ve sayfadan kaldır (tuvalde gösterilecek)
    private func extractStoredDrawings() {
        guard let doc = document else { return }
        for i in 0..<doc.pageCount {
            guard let page = doc.page(at: i) else { continue }
            for a in page.annotations where a.value(forAnnotationKey: InkDrawingAnnotation.dataKey) != nil {
                if let s = a.value(forAnnotationKey: InkDrawingAnnotation.dataKey) as? String,
                   let d = Data(base64Encoded: s), let drawing = try? PKDrawing(data: d) {
                    var merged = drawings[ObjectIdentifier(page)] ?? PKDrawing()
                    merged.append(Self.flipFromPDF(drawing, page: page))
                    drawings[ObjectIdentifier(page)] = merged
                }
                page.removeAnnotation(a)
            }
        }
    }
    /// Tuval koordinatları (sol üst köşe, aşağı doğru) ↔ PDF sayfa koordinatları (sol alt, yukarı doğru)
    static func flipToPDF(_ d: PKDrawing, page: PDFPage) -> PKDrawing {
        let b = page.bounds(for: .mediaBox)
        return d.transformed(using: CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: b.minX, ty: b.maxY))
    }
    static func flipFromPDF(_ d: PKDrawing, page: PDFPage) -> PKDrawing {
        let b = page.bounds(for: .mediaBox)
        return d.transformed(using: CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: -b.minX, ty: b.maxY))
    }
    private func buildPDF() -> Data? {
        guard let doc = document else { return nil }
        for (k, c) in canvases { drawings[k] = c.drawing }
        for i in 0..<doc.pageCount {
            guard let page = doc.page(at: i) else { continue }
            var d = drawings[ObjectIdentifier(page)] ?? PKDrawing()
            if let c = canvases[ObjectIdentifier(page)], c.bounds.width > 0 {
                // tuval sayfadan farklı boyutta çizildiyse sayfa ölçeğine getir
                let pb = page.bounds(for: .mediaBox)
                let s = pb.width / c.bounds.width
                if abs(s - 1) > 0.01 { d = d.transformed(using: CGAffineTransform(scaleX: s, y: s)) }
            }
            guard !d.strokes.isEmpty else { continue }
            let pdfDrawing = Self.flipToPDF(d, page: page)
            let ann = InkDrawingAnnotation(page: page, drawing: d)
            ann.setValue(pdfDrawing.dataRepresentation().base64EncodedString(), forAnnotationKey: InkDrawingAnnotation.dataKey)
            page.addAnnotation(ann)
        }
        let data = doc.dataRepresentation()
        // belgede kalan çizim annotation'larını temizle (düzenleme sürerse tekrar eklenir)
        for i in 0..<doc.pageCount {
            guard let page = doc.page(at: i) else { continue }
            for a in page.annotations where a is InkDrawingAnnotation { page.removeAnnotation(a) }
        }
        return data
    }
    @objc private func doneTapped() {
        if !dirty { close(false); return }
        guard let data = buildPDF() else { showError("Kaydedilemedi"); return }
        do { try save(data); close(true) }
        catch { showError("Kaydedilemedi: \(error.localizedDescription)") }
    }
    private func close(_ saved: Bool) {
        if let c = currentCanvas() { toolPicker.setVisible(false, forFirstResponder: c); c.resignFirstResponder() }
        dismiss(animated: true) { self.onClose(saved) }
    }
    private func showError(_ m: String) {
        let a = UIAlertController(title: m, message: nil, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Tamam", style: .default) { [weak self] _ in if self?.document == nil { self?.close(false) } })
        present(a, animated: true)
    }

    /// Yeni not defteri (boş PDF)
    static func newNotebook(template: Template, pages: Int, size: CGSize = CGSize(width: 595, height: 842)) -> Data? {
        let doc = PDFDocument()
        for i in 0..<max(1, pages) { if let p = templatePage(template, size: size) { doc.insert(p, at: i) } }
        return doc.dataRepresentation()
    }
}

/// Çizimi PDF'e yazan annotation: görünümü PencilKit çiziminin kendisi (basınç, doku korunur).
final class InkDrawingAnnotation: PDFAnnotation {
    static let dataKey = PDFAnnotationKey(rawValue: "/VSiPadDrawing")
    let drawing: PKDrawing
    init(page: PDFPage, drawing: PKDrawing) {
        self.drawing = drawing
        super.init(bounds: page.bounds(for: .mediaBox), forType: .stamp, withProperties: nil)
        contents = "VS iPad el yazısı"
    }
    required init?(coder: NSCoder) { self.drawing = PKDrawing(); super.init(coder: coder) }
    override func draw(with box: PDFDisplayBox, in context: CGContext) {
        let b = bounds
        let img = drawing.image(from: CGRect(origin: .zero, size: b.size), scale: 3)
        context.saveGState()
        context.translateBy(x: b.minX, y: b.maxY)
        context.scaleBy(x: 1, y: -1)
        UIGraphicsPushContext(context)
        img.draw(in: CGRect(origin: .zero, size: b.size))
        UIGraphicsPopContext()
        context.restoreGState()
    }
}
