import Foundation
import CoreBluetooth
import Network
import WebKit

/// ESP32 bağlantıları (Bluetooth LE, TCP, WebSocket).
/// iPadOS'ta USB-seri erişimi ücretli hesap + özel izin gerektirdiği için kablosuz çalışır.
/// (Elinde kablo var, kart masada, ama Apple "olmaz" diyor. Eyvallah, Bluetooth'la yaparız.)
/// Olaylar JS'e  window.__devEvent({id, type, data|b64|message})  ile iletilir.
final class DeviceHub: NSObject {
    static let shared = DeviceHub()
    weak var webView: WKWebView?

    // NUS (Nordic UART) – seri monitör / MicroPython REPL
    static let nusService = CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    static let nusRX = CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E") // iPad → ESP32
    static let nusTX = CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E") // ESP32 → iPad
    // VS iPad köprüsü: kablosuz (BLE) yazılım yükleme
    static let otaService = CBUUID(string: "7B0E0001-5A1E-4C3A-9F00-56495061644F")
    static let otaCtrl = CBUUID(string: "7B0E0002-5A1E-4C3A-9F00-56495061644F")
    static let otaData = CBUUID(string: "7B0E0003-5A1E-4C3A-9F00-56495061644F")

    private var central: CBCentralManager!
    private var found: [String: CBPeripheral] = [:]
    private var rssi: [String: Int] = [:]
    private var peripheral: CBPeripheral?
    private var chars: [CBUUID: CBCharacteristic] = [:]
    private var pendingConnect: ((String?) -> Void)?
    private var pendingWrite: ((String?) -> Void)?
    private var scanning = false
    private var bleReadyWaiters: [() -> Void] = []

    private var tcp: [String: NWConnection] = [:]
    private var sockets: [String: URLSessionWebSocketTask] = [:]

    override init() {
        super.init()
    }
    private func ensureCentral() {
        if central == nil { central = CBCentralManager(delegate: self, queue: .main) }
    }

    func emit(_ ev: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: ev), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.webView?.evaluateJavaScript("window.__devEvent && window.__devEvent(\(json))", completionHandler: nil) }
    }

    // MARK: - BLE
    func bleScan(seconds: Double, done: @escaping (Any?, String?) -> Void) {
        ensureCentral()
        let start = { [weak self] in
            guard let self else { return }
            guard self.central.state == .poweredOn else {
                done(nil, self.central.state == .unauthorized ? "Bluetooth izni yok (Ayarlar › Gizlilik › Bluetooth › VS iPad)" : "Bluetooth kapalı veya kullanılamıyor"); return
            }
            self.found.removeAll(); self.rssi.removeAll()
            self.scanning = true
            self.central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
                self.central.stopScan(); self.scanning = false
                let list = self.found.map { (id, p) -> [String: Any] in
                    ["id": id, "name": p.name ?? "", "rssi": self.rssi[id] ?? 0]
                }.sorted { ($0["rssi"] as? Int ?? -999) > ($1["rssi"] as? Int ?? -999) }
                done(list, nil)
            }
        }
        if central.state == .unknown || central.state == .resetting { bleReadyWaiters.append(start) } else { start() }
    }

    func bleConnect(id: String, done: @escaping (String?) -> Void) {
        ensureCentral()
        guard let p = found[id] ?? (UUID(uuidString: id).flatMap { central.retrievePeripherals(withIdentifiers: [$0]).first }) else { done("Cihaz bulunamadı, tekrar tara"); return }
        if let old = peripheral, old != p { central.cancelPeripheralConnection(old) }
        peripheral = p; chars.removeAll()
        p.delegate = self
        pendingConnect = done
        central.connect(p, options: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            if let cb = self?.pendingConnect { self?.pendingConnect = nil; cb("Bağlantı zaman aşımı") }
        }
    }
    func bleDisconnect() { if let p = peripheral { central.cancelPeripheralConnection(p) }; peripheral = nil; chars.removeAll() }

    /// NUS RX veya OTA karakteristiğine yaz. withResponse: akış kontrolü (yükleme için)
    func bleWrite(char: String, data: Data, withResponse: Bool, done: @escaping (String?) -> Void) {
        let uuid: CBUUID = char == "ota.ctrl" ? Self.otaCtrl : char == "ota.data" ? Self.otaData : Self.nusRX
        guard let p = peripheral, let c = chars[uuid] else { done("Bağlı değil ya da cihazda bu servis yok (\(char))"); return }
        let mtu = p.maximumWriteValueLength(for: withResponse ? .withResponse : .withoutResponse)
        if withResponse {
            // tek parça bekleniyor (JS parçalara böler)
            pendingWrite = done
            p.writeValue(data.prefix(mtu), for: c, type: .withResponse)
        } else {
            var off = 0
            while off < data.count {
                let n = min(mtu, data.count - off)
                p.writeValue(data.subdata(in: off..<off + n), for: c, type: .withoutResponse)
                off += n
            }
            done(nil)
        }
    }
    func bleInfo() -> [String: Any] {
        guard let p = peripheral else { return ["connected": false] }
        return ["connected": p.state == .connected, "name": p.name ?? "", "id": p.identifier.uuidString,
                "mtu": p.maximumWriteValueLength(for: .withResponse), "nus": chars[Self.nusRX] != nil, "ota": chars[Self.otaData] != nil]
    }

    // MARK: - TCP (köprü seri monitörü: port 23)
    func tcpOpen(id: String, host: String, port: UInt16, done: @escaping (String?) -> Void) {
        tcp[id]?.cancel()
        let c = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
        tcp[id] = c
        var finished = false
        c.stateUpdateHandler = { [weak self] st in
            switch st {
            case .ready: if !finished { finished = true; done(nil) }; self?.tcpReceive(id: id, c)
            case .failed(let e): if !finished { finished = true; done("TCP: \(e.localizedDescription)") } else { self?.emit(["id": id, "type": "close", "message": e.localizedDescription]) }
            case .waiting(let e): if !finished { finished = true; c.cancel(); done("Bağlanılamadı: \(e.localizedDescription)") }
            case .cancelled: self?.emit(["id": id, "type": "close"])
            default: break
            }
        }
        c.start(queue: .main)
    }
    private func tcpReceive(id: String, _ c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, err in
            if let data, !data.isEmpty { self?.emit(["id": id, "type": "data", "b64": data.base64EncodedString()]) }
            if complete || err != nil { self?.emit(["id": id, "type": "close", "message": err?.localizedDescription ?? ""]); c.cancel(); return }
            self?.tcpReceive(id: id, c)
        }
    }
    func tcpSend(id: String, data: Data, done: @escaping (String?) -> Void) {
        guard let c = tcp[id] else { done("TCP bağlı değil"); return }
        c.send(content: data, completion: .contentProcessed { e in done(e?.localizedDescription) })
    }
    func tcpClose(id: String) { tcp[id]?.cancel(); tcp[id] = nil }

    // MARK: - WebSocket (MicroPython WebREPL: ws://ip:8266)
    func wsOpen(id: String, url: String, done: @escaping (String?) -> Void) {
        sockets[id]?.cancel(with: .goingAway, reason: nil)
        guard let u = URL(string: url) else { done("bad url"); return }
        let t = URLSession.shared.webSocketTask(with: u)
        sockets[id] = t
        t.resume()
        wsReceive(id: id, t)
        // bağlantıyı doğrulamak için ping
        t.sendPing { e in DispatchQueue.main.async { done(e.map { "WebSocket: \($0.localizedDescription)" }) } }
    }
    private func wsReceive(id: String, _ t: URLSessionWebSocketTask) {
        t.receive { [weak self] r in
            switch r {
            case .success(let m):
                switch m {
                case .string(let s): self?.emit(["id": id, "type": "data", "b64": Data(s.utf8).base64EncodedString()])
                case .data(let d): self?.emit(["id": id, "type": "binary", "b64": d.base64EncodedString()])
                @unknown default: break
                }
                self?.wsReceive(id: id, t)
            case .failure(let e): self?.emit(["id": id, "type": "close", "message": e.localizedDescription])
            }
        }
    }
    func wsSend(id: String, text: String?, data: Data?, done: @escaping (String?) -> Void) {
        guard let t = sockets[id] else { done("WebSocket bağlı değil"); return }
        let m: URLSessionWebSocketTask.Message = data != nil ? .data(data!) : .string(text ?? "")
        t.send(m) { e in DispatchQueue.main.async { done(e?.localizedDescription) } }
    }
    func wsClose(id: String) { sockets[id]?.cancel(with: .goingAway, reason: nil); sockets[id] = nil }
}

extension DeviceHub: CBCentralManagerDelegate, CBPeripheralDelegate {
    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        if c.state != .unknown && c.state != .resetting { let w = bleReadyWaiters; bleReadyWaiters = []; w.forEach { $0() } }
    }
    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData ad: [String: Any], rssi r: NSNumber) {
        let name = p.name ?? (ad[CBAdvertisementDataLocalNameKey] as? String) ?? ""
        let services = (ad[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []
        // sadece adı olan veya NUS/OTA servisi duyuran cihazlar
        guard !name.isEmpty || services.contains(Self.nusService) || services.contains(Self.otaService) else { return }
        found[p.identifier.uuidString] = p; rssi[p.identifier.uuidString] = r.intValue
    }
    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        p.discoverServices([Self.nusService, Self.otaService])
    }
    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        if let cb = pendingConnect { pendingConnect = nil; cb(error?.localizedDescription ?? "Bağlanılamadı") }
    }
    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        if p == peripheral { chars.removeAll(); emit(["id": "ble", "type": "close", "message": error?.localizedDescription ?? ""]) }
        if let cb = pendingWrite { pendingWrite = nil; cb("Bağlantı koptu") }
    }
    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        let svcs = p.services ?? []
        if svcs.isEmpty { if let cb = pendingConnect { pendingConnect = nil; cb("Cihazda VS iPad / UART servisi yok") }; return }
        for s in svcs { p.discoverCharacteristics(nil, for: s) }
    }
    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        for c in s.characteristics ?? [] {
            chars[c.uuid] = c
            if c.uuid == Self.nusTX || c.uuid == Self.otaCtrl { p.setNotifyValue(true, for: c) }
        }
        let allDone = (p.services ?? []).allSatisfy { $0.characteristics != nil }
        if allDone, let cb = pendingConnect { pendingConnect = nil; cb(nil) }
    }
    func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        guard let v = c.value else { return }
        emit(["id": "ble", "type": c.uuid == Self.otaCtrl ? "ota" : "data", "b64": v.base64EncodedString()])
    }
    func peripheral(_ p: CBPeripheral, didWriteValueFor c: CBCharacteristic, error: Error?) {
        if let cb = pendingWrite { pendingWrite = nil; cb(error?.localizedDescription) }
    }
}
