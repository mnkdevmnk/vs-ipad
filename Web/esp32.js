/* ==========================================================================
   VS iPad – ESP32 eklentisi
   iPadOS'ta USB-seri erişimi yok; bunun yerine:
     Arduino C++ : GitHub Actions'ta ücretsiz derlenir (arduino-cli, esp32 3.0.7 / rp2040)
                   → Wi-Fi (HTTP /update), Bluetooth LE ya da USB KABLO (UF2) ile karta yüklenir
     MicroPython : derleme yok; dosya WebREPL (Wi-Fi) veya BLE UART REPL ile yüklenir
     USB kablo   : UF2 önyükleyicili kartlar (ESP32-S3 + TinyUF2, Raspberry Pi Pico) USB bellek
                   olarak görünür → .uf2 yazmak = programlamak. CircuitPython kartında code.py
                   yazmak yeter (tamamen internetsiz). Swift tarafı: UsbDrive.swift
   Seri monitör: alt paneldeki "SERİ MONİTÖR" sekmesi (TCP 23 / WebREPL / BLE UART)
   Karttaki köprü: Web/esp32/VSiPad.h (Arduino) · Web/esp32/micropython/boot.py
   ========================================================================== */
(function () {
'use strict';
window.VSCModules = window.VSCModules || [];

// uf2.family: .bin → .uf2 dönüşümü (TinyUF2, adres 0x0) · uf2.native: derleyici .uf2'yi kendisi üretir
// bridge: VSiPad.h köprüsü (Wi-Fi / BLE yükleme + seri monitör) var mı
const BOARDS = [
  { id: 'esp32:esp32:esp32s3:CDCOnBoot=cdc,PartitionScheme=min_spiffs', label: 'ESP32-S3 (DevKitC, N8R2 / N16R8…)', bridge: true, uf2: { family: 0xc47e5767, base: 0 } },
  { id: 'esp32:esp32:esp32:PartitionScheme=min_spiffs', label: 'ESP32 (klasik DevKit / WROOM-32)', bridge: true },
  { id: 'esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=min_spiffs', label: 'ESP32-C3 (SuperMini…)', bridge: true },
  { id: 'rp2040:rp2040:rpipico', label: 'Raspberry Pi Pico (RP2040) · USB', uf2: { native: true } },
  { id: 'rp2040:rp2040:rpipicow', label: 'Raspberry Pi Pico W · USB', uf2: { native: true } },
  { id: 'rp2040:rp2040:rpipico2', label: 'Raspberry Pi Pico 2 (RP2350) · USB', uf2: { native: true } }
];
const boardOf = (fqbn) => BOARDS.find((b) => b.id === fqbn) || { id: fqbn, label: fqbn, bridge: /^esp32:/.test(fqbn), uf2: /^rp2040:/.test(fqbn) ? { native: true } : /:esp32s3/.test(fqbn) ? { family: 0xc47e5767, base: 0 } : null };
// CircuitPython kartları (downloads.circuitpython.org kimlikleri)
const CPY_BOARDS = [
  { id: 'espressif_esp32s3_devkitc_1_n8r8', label: 'ESP32-S3 DevKitC-1 N8R8 (8 MB flash, 8 MB PSRAM)' },
  { id: 'espressif_esp32s3_devkitc_1_n8r2', label: 'ESP32-S3 DevKitC-1 N8R2' },
  { id: 'espressif_esp32s3_devkitc_1_n8', label: 'ESP32-S3 DevKitC-1 N8 (PSRAM yok)' },
  { id: 'espressif_esp32s3_devkitc_1_n16', label: 'ESP32-S3 DevKitC-1 N16' },
  { id: 'espressif_esp32s3_devkitc_1_n32r8', label: 'ESP32-S3 DevKitC-1 N32R8' },
  { id: 'raspberry_pi_pico', label: 'Raspberry Pi Pico' },
  { id: 'raspberry_pi_pico_w', label: 'Raspberry Pi Pico W' },
  { id: 'raspberry_pi_pico2', label: 'Raspberry Pi Pico 2' }
];
const MPY_HINT = /^\s*(import|from)\s+(machine|network|esp32|esp|neopixel|bluetooth|onewire|dht)\b/m;
const CPY_HINT = /^\s*(import|from)\s+(board|digitalio|analogio|busio|pwmio|microcontroller|supervisor|usb_hid|usb_cdc|displayio|terminalio|rotaryio|touchio|adafruit_[a-z0-9_]+)\b/m;
// UF2 biçimi: 512 baytlık bloklar, her blokta 256 bayt veri (github.com/microsoft/uf2)
function toUF2(bin, base, family) {
  const n = Math.ceil(bin.length / 256), out = new Uint8Array(n * 512), dv = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    const o = i * 512;
    dv.setUint32(o, 0x0A324655, true); dv.setUint32(o + 4, 0x9E5D5157, true);
    dv.setUint32(o + 8, 0x00002000, true);           // familyID var
    dv.setUint32(o + 12, base + i * 256, true);
    dv.setUint32(o + 16, 256, true);
    dv.setUint32(o + 20, i, true); dv.setUint32(o + 24, n, true);
    dv.setUint32(o + 28, family >>> 0, true);
    out.set(bin.subarray(i * 256, Math.min(bin.length, i * 256 + 256)), o + 32);
    dv.setUint32(o + 508, 0x0AB16F30, true);
  }
  return out;
}
const b64ToBytes = (b64) => { const s = atob(b64 || ''); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const bytesToB64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Esp = {
  ctx: null, conn: null, decoder: null, waiters: [], otaWaiters: [], rxText: '', busy: false,
  get S() { const S = this.ctx.SET; if (!S.esp32) S.esp32 = { fqbn: BOARDS[0].id, host: 'vsipad-esp32.local', transport: 'wifi', mpyPass: 'vsipad', ts: false, eol: 'lf' }; return S.esp32; },
  tr() { return this.ctx.SET.lang !== 'en'; },
  L(a, b) { return this.tr() ? a : b; },

  init() {
    window.__devEvent = (ev) => this.onEvent(ev);
    this.renderView(); this.bindMonitor();
  },

  // ---------------------------------------------------------------- olaylar (Swift → JS)
  onEvent(ev) {
    if (!this.conn) return;
    const mine = (this.conn.kind === 'ble' && ev.id === 'ble') || ev.id === this.conn.id;
    if (!mine) return;
    if (ev.type === 'data' || ev.type === 'binary') {
      const txt = this.decoder.decode(b64ToBytes(ev.b64), { stream: true });
      if (txt) this.onText(txt);
    } else if (ev.type === 'ota') {
      const msg = new TextDecoder().decode(b64ToBytes(ev.b64));
      const w = this.otaWaiters.slice(); this.otaWaiters = [];
      w.forEach((f) => f(msg));
      if (/^OK \d+/.test(msg) && this.onOtaProgress) this.onOtaProgress(+msg.slice(3));
    } else if (ev.type === 'close') {
      this.monWrite(`\n[${this.L('bağlantı kapandı', 'disconnected')}${ev.message ? ': ' + ev.message : ''}]\n`, 'sm-sys');
      this.conn = null; this.renderView(); this.renderMonBar();
    }
  },
  onText(txt) {
    if (!this.quiet) this.monWrite(txt);
    this.rxText = (this.rxText + txt).slice(-20000);
    const w = this.waiters; this.waiters = [];
    for (const x of w) { if (x.re.test(this.rxText)) x.res(this.rxText); else this.waiters.push(x); }
  },
  waitFor(re, ms = 8000) {
    if (re.test(this.rxText)) return Promise.resolve(this.rxText);
    return new Promise((res, rej) => {
      const x = { re, res };
      this.waiters.push(x);
      setTimeout(() => { const i = this.waiters.indexOf(x); if (i >= 0) { this.waiters.splice(i, 1); rej(new Error(this.L('Karttan yanıt gelmedi', 'No response from board'))); } }, ms);
    });
  },
  waitOta(re, ms = 10000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(this.L('Kart yükleme komutuna yanıt vermedi', 'OTA timeout'))), ms);
      const h = (msg) => { if (re.test(msg)) { clearTimeout(t); res(msg); } else if (/^ERR/.test(msg)) { clearTimeout(t); rej(new Error(msg)); } else this.otaWaiters.push(h); };
      this.otaWaiters.push(h);
    });
  },

  // ---------------------------------------------------------------- bağlantı
  board() { return boardOf(this.S.fqbn); },
  async pickTransport(what, opts = {}) {
    const C = this.ctx, last = this.S.transport, tr = this.tr();
    let items = [
      { v: 'usb', label: '🔌 ' + (tr ? 'USB kablo (UF2)' : 'USB cable (UF2)'), desc: tr ? 'internet / Wi-Fi gerekmez' : 'no network needed' },
      { v: 'wifi', label: '📶 Wi-Fi', desc: this.S.host + (tr ? ' – hızlı' : ' – fast') },
      { v: 'ble', label: '🔵 Bluetooth LE', desc: tr ? 'ağ gerekmez, yükleme yavaş' : 'no network, slower' }
    ].filter((x) => (x.v === 'usb' ? opts.usb : opts.wireless !== false));
    if (!items.length) throw new Error(this.L('Bu kart için yükleme yolu yok', 'No upload method for this board'));
    if (items.length === 1) return items[0].v;
    items = items.sort((a, b) => (b.v === last) - (a.v === last));
    const it = await C.quickPick(items, { placeholder: what || this.L('ESP32 bağlantısı', 'ESP32 connection') });
    if (!it) return null;
    this.S.transport = it.v; C.saveSettings();
    return it.v;
  },
  async pickBle() {
    const C = this.ctx;
    const n = C.notify('info', this.L('Bluetooth cihazları taranıyor…', 'Scanning…'), { timeout: 0 });
    let list;
    try { list = await C.native('dev.ble.scan', { seconds: 4 }); } finally { n.close(); }
    list = (list || []).sort((a, b) => (/vsipad/i.test(b.name) - /vsipad/i.test(a.name)) || (b.rssi - a.rssi));
    if (!list.length) throw new Error(this.L('Bluetooth cihazı bulunamadı. Kart açık mı, köprü yazılımı yüklü mü?', 'No BLE devices found'));
    const it = await C.quickPick(list.map((d) => ({ label: d.name || this.L('(adsız)', '(unnamed)'), desc: `${d.rssi} dBm`, d })), { placeholder: this.L('ESP32 kartını seç (VSiPad-…)', 'Select ESP32') });
    return it ? it.d : null;
  },
  async connect(mode, transport) {
    // mode: 'bridge' (Arduino köprüsü) | 'mpy' (MicroPython REPL)
    const C = this.ctx;
    if (this.conn && this.conn.mode === mode && this.conn.kind === transport) return this.conn;
    await this.disconnect(true);
    this.decoder = new TextDecoder(); this.rxText = '';
    C.Panel.show('serial');
    if (transport === 'ble') {
      const d = await this.pickBle(); if (!d) return null;
      this.monWrite(`[${this.L('bağlanılıyor', 'connecting')}: ${d.name} (BLE)…]\n`, 'sm-sys');
      const info = await C.native('dev.ble.connect', { id: d.id });
      this.conn = { kind: 'ble', mode, name: d.name, id: 'ble', info };
    } else {
      const host = await this.resolveHost();
      if (mode === 'mpy') {
        this.monWrite(`[WebREPL ws://${host}:8266 …]\n`, 'sm-sys');
        this.conn = { kind: 'wifi', mode, id: 'mpy', host, name: host };
        await C.native('dev.ws.open', { id: 'mpy', url: `ws://${host}:8266` });
        try { await this.waitFor(/Password:\s*$/, 5000); } catch (e) {}
        await this.sendRaw(this.S.mpyPass + '\r');
        await this.waitFor(/WebREPL connected|>>> $/, 6000).catch(() => {});
      } else {
        this.monWrite(`[${this.L('seri monitör', 'serial monitor')}: ${host}:23 …]\n`, 'sm-sys');
        this.conn = { kind: 'wifi', mode, id: 'mon', host, name: host };
        await C.native('dev.tcp.open', { id: 'mon', host, port: 23 });
      }
    }
    this.renderView(); this.renderMonBar();
    return this.conn;
  },
  async disconnect(silent) {
    const C = this.ctx, c = this.conn;
    if (!c) return;
    this.conn = null;
    try {
      if (c.kind === 'ble') await C.native('dev.ble.disconnect');
      else if (c.id === 'mpy') await C.native('dev.ws.close', { id: 'mpy' });
      else await C.native('dev.tcp.close', { id: c.id });
    } catch (e) {}
    if (!silent) this.monWrite(`[${this.L('bağlantı kesildi', 'disconnected')}]\n`, 'sm-sys');
    this.renderView(); this.renderMonBar();
  },
  async resolveHost() {
    // önce kayıtlı adres, olmazsa kartın kendi ağı (192.168.4.1)
    const C = this.ctx;
    for (const h of [this.S.host, '192.168.4.1'].filter((x, i, a) => x && a.indexOf(x) === i)) {
      try { const r = await C.native('http.request', { url: `http://${h}/info`, method: 'GET', timeout: 4 }); if (r.status === 200) { if (h !== this.S.host) { this.S.lastIp = h; } return h; } } catch (e) {}
      // MicroPython köprüsünde /info yok; WebREPL portunu dener
      if (h === '192.168.4.1' || h === this.S.host) { /* yine de dene */ }
    }
    return this.S.host;
  },
  async sendRaw(s) {
    const C = this.ctx, c = this.conn; if (!c) throw new Error(this.L('Bağlı değil', 'Not connected'));
    const bytes = typeof s === 'string' ? enc.encode(s) : s;
    if (c.kind === 'ble') {
      const mtu = Math.max(20, ((c.info && c.info.mtu) || 20));
      for (let i = 0; i < bytes.length; i += mtu) await C.native('dev.ble.write', { char: 'nus', b64: bytesToB64(bytes.subarray(i, i + mtu)), withResponse: true });
    } else if (c.id === 'mpy') {
      for (let i = 0; i < bytes.length; i += 256) await C.native('dev.ws.send', { id: 'mpy', text: new TextDecoder().decode(bytes.subarray(i, i + 256)) });
    } else await C.native('dev.tcp.send', { id: c.id, b64: bytesToB64(bytes) });
  },

  // ---------------------------------------------------------------- ARDUINO: derle (GitHub Actions) + yükle
  async buildAndFlash(path, opts = {}) {
    const C = this.ctx, G = C.Git, tr = this.tr();
    if (this.busy) { C.notify('warning', this.L('Bir ESP32 işlemi zaten sürüyor.', 'Busy')); return; }
    if (!G.token) { if (!(await G.signIn())) return; }
    if (!G.link || (G.link.root && !path.startsWith(G.link.root + '/'))) {
      const i = await C.dialog(this.L('ESP32 derlemesi için GitHub deposu gerekiyor', 'A GitHub repository is needed'),
        this.L('Arduino kodu GitHub Actions\'ta ücretsiz derlenir. Bu çizimin bulunduğu klasörü (veya bir üst klasörü) gizli bir GitHub deposuna bağla, sonra tekrar ▷ bas.', 'Link this folder to a GitHub repository first.'),
        [this.L('Yeni depo oluştur', 'Publish'), this.L('Mevcut depoya bağla', 'Link existing'), 'Cancel'], 0);
      if (i === 0) await G.publish(); else if (i === 1) await G.linkExisting();
      return;
    }
    this.busy = true; this.renderView();
    const root = G.link.root, rel = root ? path.slice(root.length + 1) : path, abs = (r) => (root ? root + '/' + r : r);
    const name = rel.split('/').pop().replace(/\.ino$/, '');
    const T = C.Term;
    C.Panel.show('terminal');
    T.ensureNewline();
    T.writeln(`$ arduino-cli compile --fqbn ${this.S.fqbn} ${rel}   (GitHub Actions)`, 't-dim');
    C.Run.setRunning(true, this.L('ESP32 derleniyor…', 'Building…'));
    const t0 = Date.now();
    try {
      // 1) iş akışı dosyaları
      for (const [src, dst] of [['esp32/vsipad-esp32.yml', '.github/workflows/vsipad-esp32.yml'], ['esp32/build.py', '.github/vsipad/build.py'], ['esp32/VSiPad.h', '.github/vsipad/VSiPad.h']]) {
        const want = await (await fetch(src)).text();
        let have = null; try { have = (await C.native('fs.read', { path: abs(dst) })).content; } catch (e) {}
        if (have !== want) await C.native('fs.write', { path: abs(dst), content: want });
      }
      await C.native('fs.write', { path: abs('.vsipad/target.json'), content: JSON.stringify({ sketch: rel, fqbn: this.S.fqbn, nonce: Date.now() }, null, 2) + '\n' });
      await C.Explorer.refresh();
      // 2) push
      T.writeln(this.L('→ GitHub\'a gönderiliyor…', '→ pushing…'), 't-dim');
      let pushed;
      try { pushed = await G.commitPush(`ESP32: ${name} derle`); }
      catch (e) {
        if (/workflow/i.test(e.message)) throw new Error(this.L('GitHub token\'ının iş akışı dosyası yazma izni yok. github.com › Settings › Developer settings › token\'ın › Permissions › "Workflows: Read and write" ekle.', 'Token needs Workflows: Read and write') + ' (' + e.message + ')');
        throw e;
      }
      if (!pushed) throw new Error(this.L('Push yapılamadı', 'Push failed'));
      const sha = G.link.head;
      const idx = G.link.index || {};
      if (!idx['.vsipad/target.json'] || !idx['.github/workflows/vsipad-esp32.yml']) throw new Error(this.L('Derleme dosyaları (.github, .vsipad) GitHub\'a gönderilemedi. Uygulamayı güncelle ve tekrar dene.', 'Build files were not pushed.'));
      // 3) sonucu bekle
      T.writeln(this.L(`→ Derleniyor (commit ${sha.slice(0, 7)}). İlk derleme ~4 dk, sonrakiler ~1-2 dk sürer…`, `→ building ${sha.slice(0, 7)}…`), 't-dim');
      const res = await this.waitBuild(sha, (s) => { $('#sbRunningText') && ($('#sbRunningText').textContent = `ESP32 ${s}s`); });
      const log = String(res.log || '');
      const lines = log.split('\n').filter((l) => !/^\$ arduino-cli lib install/.test(l));
      const important = lines.filter((l) => /error|warning|Sketch uses|Global variables|note:|^\s+\^|^\s*\d+ \|/.test(l));
      T.writeLinked((important.length ? important : lines.slice(-30)).join('\n'));
      const diags = this.parseDiags(log, root);
      C.Problems.set(diags);
      if (!res.ok) {
        T.writeln(`✖ ${this.L('Derleme başarısız', 'Build failed')} · ${Math.round((Date.now() - t0) / 1000)} s`, 't-err');
        const d = diags.find((x) => x.sev === 'error'); if (d) C.Tabs.open(d.file, { preview: false, line: d.line, col: d.col });
        return;
      }
      T.writeln(`✔ ${this.L('Derlendi', 'Built')}: ${(res.size / 1024).toFixed(0)} KB${res.percent != null ? ' (%' + res.percent + ')' : ''} · ${Math.round((Date.now() - t0) / 1000)} s`, 't-ok');
      const bin = await this.download(`builds/${sha}/app.bin`);
      const uf2 = (res.files || []).includes('app.uf2') ? await this.download(`builds/${sha}/app.uf2`) : null;
      if (opts.saveMerged && (res.files || []).includes('merged.bin')) {
        const m = await this.download(`builds/${sha}/merged.bin`);
        const out = abs(rel.replace(/[^/]+$/, '') + `${name}-ilk-kurulum-0x0.bin`);
        await C.native('fs.writeB64', { path: out, b64: bytesToB64(m) });
        await C.Explorer.refresh();
        T.writeln(this.L(`→ İlk kurulum dosyası: ${out}  (Mac'te Chrome ile espressif.github.io/esptool-js › 0x0 adresine yaz)`, `→ saved ${out}`), 't-info');
        return;
      }
      C.Run.setRunning(false);
      await this.flash(bin, name, { uf2 });
    } catch (e) {
      T.writeln('✖ ' + (e.message || e), 't-err');
    } finally {
      this.busy = false; C.Run.setRunning(false); this.renderView();
      if (!['repl', 'shell', 'sqlite'].includes(T.mode)) T.setMode('shell');
    }
  },
  async waitBuild(sha, tick) {
    const C = this.ctx, G = C.Git, L = G.link;
    const t0 = Date.now();
    for (;;) {
      const s = Math.round((Date.now() - t0) / 1000);
      tick && tick(s);
      if (s > 900) throw new Error(this.L('Derleme 15 dakikada bitmedi. github.com\'da deponun Actions sekmesine bak.', 'Build timed out'));
      const r = await C.native('http.request', { url: `https://api.github.com/repos/${L.owner}/${L.repo}/contents/builds/${sha}.json?ref=vsipad-builds`, method: 'GET',
        headers: { Authorization: 'Bearer ' + G.token, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'VS-iPad' }, timeout: 30 }).catch(() => null);
      if (r && r.status === 200) { try { return JSON.parse(r.body); } catch (e) {} }
      if (r && r.status === 401) throw new Error('GitHub: token geçersiz');
      await sleep(s < 60 ? 8000 : 5000);
    }
  },
  async download(p) {
    const C = this.ctx, G = C.Git, L = G.link;
    const r = await C.native('http.request', { url: `https://api.github.com/repos/${L.owner}/${L.repo}/contents/${p}?ref=vsipad-builds`, method: 'GET', responseB64: true,
      headers: { Authorization: 'Bearer ' + G.token, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'VS-iPad' }, timeout: 120 });
    if (r.status !== 200) throw new Error(`${p}: HTTP ${r.status}`);
    return b64ToBytes(r.b64);
  },
  parseDiags(log, root) {
    const out = [];
    for (const line of log.split('\n')) {
      const m = line.match(/^(.+?\.(?:ino|cpp|c|h|hpp)):(\d+):(\d+):\s+(fatal error|error|warning):\s+(.*)$/);
      if (!m || /VSiPad\.h$/.test(m[1]) || m[1].startsWith('/')) continue;
      out.push({ file: (root ? root + '/' : '') + m[1], line: +m[2], col: +m[3], sev: m[4] === 'warning' ? 'warning' : 'error', msg: m[5], source: 'arduino-cli' });
    }
    return out;
  },
  async flash(bin, name, extra = {}) {
    const C = this.ctx, T = C.Term, B = this.board();
    const how = await this.pickTransport(this.L(`${name} (${(bin.length / 1024).toFixed(0)} KB) karta nasıl yüklensin?`, 'Upload via'), { usb: !!B.uf2, wireless: !!B.bridge });
    if (!how) return;
    if (how === 'usb') {
      const uf2 = extra.uf2 || (B.uf2 && B.uf2.family != null ? toUF2(bin, B.uf2.base, B.uf2.family) : null);
      if (!uf2) { T.writeln('✖ ' + this.L('Derleme .uf2 üretmedi', 'No .uf2 produced'), 't-err'); return; }
      await this.writeUf2(uf2, name + '.uf2', { tryBridge: !!B.bridge });
      return;
    }
    C.Panel.show('serial');
    const n = C.notify('info', this.L('Yükleniyor…', 'Uploading…'), { timeout: 0 });
    try {
      if (how === 'wifi') {
        await this.disconnect(true);
        const host = await this.resolveHost();
        this.monWrite(`[Wi-Fi ile yükleniyor → http://${host}/update · ${(bin.length / 1024).toFixed(0)} KB]\n`, 'sm-sys');
        const B = '----vsipad' + Date.now();
        const head = enc.encode(`--${B}\r\nContent-Disposition: form-data; name="firmware"; filename="${name}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
        const tail = enc.encode(`\r\n--${B}--\r\n`);
        const body = new Uint8Array(head.length + bin.length + tail.length); body.set(head); body.set(bin, head.length); body.set(tail, head.length + bin.length);
        n.progress(0.3);
        const r = await C.native('http.request', { url: `http://${host}/update`, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + B }, bodyB64: bytesToB64(body), timeout: 180 });
        if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.body}`);
      } else {
        if (!this.conn || this.conn.kind !== 'ble') await this.connect('bridge', 'ble');
        if (!this.conn) return;
        const info = await C.native('dev.ble.info');
        if (!info.ota) throw new Error(this.L('Bu kartta VS iPad köprüsü yok (BLE yükleme servisi bulunamadı). İlk kurulumu yap.', 'No VS iPad bridge on this board'));
        const chunk = Math.max(20, Math.min(info.mtu || 20, 509));
        this.monWrite(`[Bluetooth ile yükleniyor · ${(bin.length / 1024).toFixed(0)} KB · ${chunk} B/paket]\n`, 'sm-sys');
        await C.native('dev.ble.write', { char: 'ota.ctrl', b64: btoa('BEGIN ' + bin.length), withResponse: true });
        await this.waitOta(/^READY/);
        const t0 = Date.now();
        for (let i = 0; i < bin.length; i += chunk) {
          await C.native('dev.ble.write', { char: 'ota.data', b64: bytesToB64(bin.subarray(i, i + chunk)), withResponse: true });
          if ((i / chunk) % 32 === 0) { const p = i / bin.length; n.progress(p); n.text(this.L(`Bluetooth ile yükleniyor… %${Math.round(p * 100)} · ${Math.round(i / 1024 / Math.max(1, (Date.now() - t0) / 1000))} KB/s`, `Uploading ${Math.round(p * 100)}%`)); }
        }
        await C.native('dev.ble.write', { char: 'ota.ctrl', b64: btoa('END'), withResponse: true });
        await this.waitOta(/^DONE/, 30000);
      }
      n.close();
      this.monWrite(`[✔ ${this.L('yüklendi, kart yeniden başlıyor', 'uploaded, rebooting')}]\n`, 'sm-ok');
      T.writeln(`✔ ${this.L('Karta yüklendi', 'Uploaded')} (${how === 'wifi' ? 'Wi-Fi' : 'Bluetooth'})`, 't-ok');
      // seri monitörü yeniden bağla
      await this.disconnect(true);
      await sleep(how === 'wifi' ? 5000 : 6000);
      if (how === 'wifi') await this.connect('bridge', 'wifi').catch((e) => this.monWrite(`[${e.message}]\n`, 'sm-err'));
      else this.monWrite(`[${this.L('Seri monitörü yeniden açmak için ⏻ Bağlan', 'Press Connect to reopen the monitor')}]\n`, 'sm-sys');
    } catch (e) {
      n.close();
      try { if (this.conn && this.conn.kind === 'ble') await C.native('dev.ble.write', { char: 'ota.ctrl', b64: btoa('ABORT'), withResponse: false }); } catch (er) {}
      this.monWrite(`[✖ ${e.message || e}]\n`, 'sm-err');
      T.writeln('✖ ' + this.L('Yükleme başarısız: ', 'Upload failed: ') + (e.message || e), 't-err');
      if (how === 'wifi') T.writeln(this.L('İpucu: iPad kartla aynı Wi-Fi ağında mı? Kart kendi ağını açtıysa (VSiPad-…) iPad\'i ona bağla. Adres: ESP32 › Ayarlar.', 'Tip: same Wi-Fi?'), 't-dim');
    }
  },

  // ---------------------------------------------------------------- USB KABLO: UF2 / CircuitPython
  // kind: 'uf2' (S3DKC1BOOT, RPI-RP2… – içinde INFO_UF2.TXT) | 'circuitpy' (CIRCUITPY)
  async usbDrive(kind, opts = {}) {
    const C = this.ctx, tr = this.tr();
    const find = async () => { try { return ((await C.native('usb.list')) || []).find((d) => d.kind === kind) || null; } catch (e) { return null; } };
    let d = await find();
    if (d) return d;
    // kartta VS iPad köprüsü çalışıyorsa ve Wi-Fi'dan erişilebiliyorsa: UF2 moduna kendisi geçsin
    if (kind === 'uf2' && opts.tryBridge) {
      try {
        const r = await C.native('http.request', { url: `http://${this.S.host}/uf2`, method: 'POST', timeout: 2 });
        if (r.status === 200) { C.notify('info', this.L('Kart UF2 moduna geçiyor…', 'Rebooting to UF2…'), { timeout: 3000 }); await sleep(3500); d = await find(); if (d) return d; }
      } catch (e) {}
    }
    const how = kind === 'uf2'
      ? this.L('1) Kartı iPad\'e kabloyla tak. ESP32-S3 DevKitC-1\'de "USB" yazan portu kullan ("UART" değil).\n2) UF2 moduna al:\n   • Kartta VS iPad çizimi çalışıyorsa: BOOT tuşunu 2 sn basılı tut\n   • ya da RESET\'e bas, LED mor yanınca hemen BOOT\'a bas\n   • Raspberry Pi Pico: BOOTSEL basılıyken kabloyu tak\n3) Dosyalar\'da S3DKC1BOOT / RPI-RP2 belleği belirince "Sürücüyü seç" (sadece ilk sefer).\n\nESP32-S3 karta TinyUF2 hiç kurulmadıysa önce USB rehberindeki tek seferlik Mac kurulumunu yap.',
               '1) Plug the board into the iPad (ESP32-S3: the "USB" port, not "UART").\n2) Enter UF2 mode (hold BOOT 2 s, or RESET then BOOT; Pico: hold BOOTSEL while plugging in).\n3) Choose the drive once in Files.')
      : this.L('1) CircuitPython kurulu kartı iPad\'e kabloyla tak (ESP32-S3: "USB" portu).\n2) Dosyalar\'da CIRCUITPY belleği belirince "Sürücüyü seç" (sadece ilk sefer).\n\nKartta CircuitPython yoksa: ESP32 › CircuitPython\'u karta kur…', 'Plug in the CircuitPython board and choose the CIRCUITPY drive once.');
    for (;;) {
      const i = await C.dialog(kind === 'uf2' ? this.L('USB kart bekleniyor (UF2)', 'Waiting for UF2 drive') : this.L('CIRCUITPY sürücüsü bekleniyor', 'Waiting for CIRCUITPY'), how,
        [this.L('Sürücüyü seç…', 'Choose drive…'), this.L('Taktım, tekrar dene', 'Retry'), this.L('İptal', 'Cancel')], 0);
      if (i === 1) { d = await find(); if (d) return d; C.notify('warning', this.L('Kayıtlı sürücü bulunamadı. Dosyalar\'da görünüyor mu? "Sürücüyü seç" ile seç.', 'Drive not found'), { timeout: 5000 }); continue; }
      if (i !== 0) return null;
      let p = null;
      try { p = await C.native('usb.pick'); } catch (e) { C.notify('error', String(e.message || e)); continue; }
      if (!p) continue;
      if (p.kind === kind) return p;
      const j = await C.dialog(this.L('Bu sürücü beklenen türde görünmüyor', 'Unexpected drive'),
        this.L(`"${p.name}" içinde ${kind === 'uf2' ? 'INFO_UF2.TXT' : 'boot_out.txt / code.py'} yok. Yine de bu sürücü kullanılsın mı?`, `Use "${p.name}" anyway?`),
        [this.L('Kullan', 'Use'), this.L('Başka seç', 'Choose another')], 1);
      if (j === 0) return p;
    }
  },
  async writeUf2(bytes, fileName, opts = {}) {
    const C = this.ctx, T = C.Term;
    const d = await this.usbDrive('uf2', opts);
    if (!d) return false;
    const n = C.notify('info', this.L(`USB ile yazılıyor → ${d.name} · ${(bytes.length / 1024).toFixed(0)} KB`, `Writing to ${d.name}…`), { timeout: 0 });
    try {
      const chip = /Board-ID:\s*(\S+)/.exec(d.info || '');
      T.writeln(`$ cp ${fileName} /Volumes/${d.name}/   ${chip ? '(' + chip[1] + ')' : ''}`, 't-dim');
      const t0 = Date.now();
      await C.native('usb.write', { drive: d.id, path: fileName, b64: bytesToB64(bytes) });
      T.writeln(`✔ ${this.L('Karta yüklendi (USB kablo)', 'Uploaded (USB)')} · ${((Date.now() - t0) / 1000).toFixed(1)} s · ${this.L('kart yeniden başlıyor', 'board is rebooting')}`, 't-ok');
      if (this.board().bridge) T.writeln(this.L('Seri çıktı: iPad USB-seriyi okuyamaz; köprü sayesinde SERİ MONİTÖR › Wi-Fi / Bluetooth ile bakabilirsin.', 'Serial output: use the Wi-Fi / BLE monitor.'), 't-dim');
      return true;
    } catch (e) {
      T.writeln('✖ ' + this.L('USB yazma başarısız: ', 'USB write failed: ') + (e.message || e), 't-err');
      return false;
    } finally { n.close(); }
  },
  async writeUf2File() {
    const C = this.ctx;
    const files = C.Explorer.files().filter((p) => /\.uf2$/i.test(p));
    if (!files.length) { C.notify('info', this.L('Çalışma alanında .uf2 dosyası yok. CircuitPython için "CircuitPython\'u karta kur…" kullan.', 'No .uf2 files in workspace')); return; }
    const it = await C.quickPick(files.map((p) => ({ label: p.split('/').pop(), desc: p.replace(/[^/]+$/, ''), v: p })), { placeholder: this.L('Karta yazılacak .uf2 dosyası', 'UF2 file to flash') });
    if (!it) return;
    const b = b64ToBytes((await C.native('fs.readB64', { path: it.v })).b64);
    C.Panel.show('terminal');
    await this.writeUf2(b, it.v.split('/').pop());
  },
  async cpyInstall() {
    const C = this.ctx, T = C.Term, tr = this.tr();
    const it = await C.quickPick(CPY_BOARDS.map((b) => ({ label: b.label, desc: b.id, v: b.id })).concat([{ label: this.L('Başka kart (circuitpython.org kimliği)…', 'Other board id…'), v: null }]), { placeholder: this.L('CircuitPython hangi karta kurulsun?', 'Board') });
    if (!it) return;
    const id = it.v || ((await C.inputBox({ prompt: this.L('circuitpython.org/board/<kimlik> adresindeki kimlik', 'Board id from circuitpython.org/board/<id>'), value: '' })) || '').trim();
    if (!id) return;
    C.Panel.show('terminal'); T.ensureNewline();
    const dir = 'ESP32/firmware';
    let path = null, bytes = null;
    try {
      const r = await C.native('http.request', { url: 'https://api.github.com/repos/adafruit/circuitpython/releases/latest', method: 'GET', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VS-iPad' }, timeout: 15 });
      const ver = r.status === 200 ? JSON.parse(r.body).tag_name : null;
      if (ver) {
        const fn = `adafruit-circuitpython-${id}-en_US-${ver}.uf2`;
        path = `${dir}/${fn}`;
        if (await C.native('fs.exists', { path })) bytes = b64ToBytes((await C.native('fs.readB64', { path })).b64);
        else {
          T.writeln(`$ curl -O https://downloads.circuitpython.org/bin/${id}/en_US/${fn}`, 't-dim');
          const n = C.notify('info', this.L(`CircuitPython ${ver} indiriliyor…`, `Downloading CircuitPython ${ver}…`), { timeout: 0 });
          try {
            const d = await C.native('http.request', { url: `https://downloads.circuitpython.org/bin/${id}/en_US/${fn}`, method: 'GET', responseB64: true, timeout: 180 });
            if (d.status !== 200) throw new Error(`HTTP ${d.status} (${this.L('kart kimliği doğru mu?', 'wrong board id?')})`);
            bytes = b64ToBytes(d.b64);
            await C.native('fs.writeB64', { path, b64: d.b64 });
            await C.Explorer.refresh();
            T.writeln(this.L(`→ kaydedildi: ${path} (sonraki kurulumlar internetsiz)`, `→ saved ${path}`), 't-dim');
          } finally { n.close(); }
        }
      }
    } catch (e) { T.writeln('⚠ ' + (e.message || e), 't-dim'); }
    if (!bytes) {   // internet yoksa: daha önce indirilmiş herhangi bir sürüm
      const old = C.Explorer.files().filter((p) => p.startsWith(dir + '/') && p.includes(`-${id}-`) && p.endsWith('.uf2')).sort().pop();
      if (!old) { T.writeln('✖ ' + this.L('CircuitPython indirilemedi ve önceden indirilmiş sürüm yok. İnternete bağlanıp tekrar dene.', 'Download failed and no cached copy.'), 't-err'); return; }
      path = old; bytes = b64ToBytes((await C.native('fs.readB64', { path })).b64);
      T.writeln(this.L(`→ çevrimdışı: ${path} kullanılıyor`, `→ offline: using ${path}`), 't-dim');
    }
    if (await this.writeUf2(bytes, 'circuitpython.uf2')) {
      T.writeln(this.L('→ Kart birkaç saniye içinde CIRCUITPY belleği olarak açılır. Bir .py dosyası açıp ESP32 › "USB\'ye yaz ve çalıştır (CircuitPython)".', '→ The board will reappear as CIRCUITPY.'), 't-info');
      if (id.startsWith('espressif_')) T.writeln(this.L('   Arduino\'ya dönmek için: RESET, LED mor yanınca BOOT → S3DKC1BOOT açılır.', '   Back to Arduino: RESET then BOOT.'), 't-dim');
    }
  },
  async cpyRun(path) {
    const C = this.ctx, T = C.Term;
    if (this.busy) return;
    this.busy = true; this.renderView();
    try {
      await C.Tabs.saveAll();
      const d = await this.usbDrive('circuitpy');
      if (!d) return;
      C.Panel.show('terminal'); T.ensureNewline();
      const dir = path.replace(/[^/]+$/, '');
      const rest = (p) => p.slice(dir.length);
      // aynı klasördeki yardımcı dosyalar + lib/ klasörü (.mpy kütüphaneleri) de kopyalanır
      const extra = C.Explorer.files().filter((p) => p !== path && p.startsWith(dir) &&
        ((!rest(p).includes('/') && /\.(py|mpy|json|txt|csv|toml|bmp|wav|mp3)$/i.test(p) && !/^(code|main|boot_out)\.(py|txt)$/i.test(rest(p))) || /^lib\//.test(rest(p))));
      for (const f of extra) {
        T.writeln(`$ cp ${rest(f)} /Volumes/${d.name}/${rest(f)}`, 't-dim');
        await C.native('usb.write', { drive: d.id, path: rest(f), b64: (await C.native('fs.readB64', { path: f })).b64 });
      }
      T.writeln(`$ cp ${rest(path)} /Volumes/${d.name}/code.py`, 't-dim');
      await C.native('usb.write', { drive: d.id, path: 'code.py', b64: (await C.native('fs.readB64', { path })).b64 });
      const ver = /CircuitPython\s+([\d.]+\S*)/.exec(d.info || '');
      T.writeln(`✔ ${this.L('code.py olarak yazıldı – CircuitPython otomatik yeniden yükleyip çalıştırıyor', 'Written as code.py – CircuitPython auto-reloads')}${ver ? ' (CircuitPython ' + ver[1] + ')' : ''}`, 't-ok');
      T.writeln(this.L('Not: iPad USB-seri okuyamadığı için print() çıktısı burada görünmez; LED / ekran ile ya da MicroPython + Wi-Fi yoluyla izle.', 'Note: print() output is not visible over USB on iPad.'), 't-dim');
    } catch (e) { T.writeln('✖ ' + (e.message || e), 't-err'); }
    finally { this.busy = false; this.renderView(); }
  },

  // ---------------------------------------------------------------- MICROPYTHON: yükle + çalıştır
  async mpyRun(path, opts = {}) {
    const C = this.ctx;
    if (this.busy) return;
    const how = (this.conn && this.conn.mode === 'mpy') ? this.conn.kind : await this.pickTransport(this.L('MicroPython kartına nasıl bağlanılsın?', 'Connect via'));
    if (!how) return;
    this.busy = true; this.renderView();
    try {
      await C.Tabs.saveAll();
      if (!(await this.connect('mpy', how))) return;
      const files = opts.all ? C.Explorer.files().filter((p) => p.startsWith(path.replace(/[^/]+$/, '')) && /\.(py|json|txt|csv)$/.test(p) && !p.slice(path.replace(/[^/]+$/, '').length).includes('/')) : [path];
      this.quiet = true;
      await this.rawEnter();
      for (const f of files) {
        const content = (await C.native('fs.readB64', { path: f })).b64;
        const nm = f.split('/').pop();
        this.monWrite(`[${this.L('yükleniyor', 'uploading')}: ${nm} → /${nm}]\n`, 'sm-sys');
        await this.rawPut(nm, b64ToBytes(content));
      }
      await this.sendRaw('\x02'); // normal REPL
      await this.waitFor(/>>> $/, 3000).catch(() => {});
      this.quiet = false;
      const main = path.split('/').pop();
      if (!opts.uploadOnly) {
        this.monWrite(`[${this.L('çalıştırılıyor', 'running')}: ${main} · ${this.L('durdurmak için ⏹ veya Ctrl-C', 'Ctrl-C to stop')}]\n`, 'sm-sys');
        await this.sendRaw(`exec(open('${main}').read(), {'__name__': '__main__'})\r`);
      }
    } catch (e) { this.monWrite(`[✖ ${e.message || e}]\n`, 'sm-err'); }
    finally { this.quiet = false; this.busy = false; this.renderView(); }
  },
  async rawEnter() {
    this.rxText = '';
    await this.sendRaw('\r\x03\x03');
    await sleep(150);
    this.rxText = '';
    await this.sendRaw('\x01');
    await this.waitFor(/raw REPL; CTRL-B to exit\r?\n>/, 5000);
  },
  async rawExec(code, ms = 15000) {
    this.rxText = '';
    await this.sendRaw(code);
    await this.sendRaw('\x04');
    const t = await this.waitFor(/\x04[\s\S]*\x04>$/, ms);
    const m = t.match(/OK([\s\S]*?)\x04([\s\S]*?)\x04>$/);
    if (m && m[2].trim()) throw new Error(m[2].trim().split('\n').pop());
    return m ? m[1] : '';
  },
  async rawPut(name, bytes) {
    await this.rawExec(`import ubinascii\nf=open('${name}','wb')\nw=f.write\n`);
    const step = 768;
    for (let i = 0; i < bytes.length; i += step * 4) {
      let code = '';
      for (let j = i; j < Math.min(bytes.length, i + step * 4); j += step) code += `w(ubinascii.a2b_base64('${bytesToB64(bytes.subarray(j, j + step))}'))\n`;
      await this.rawExec(code);
    }
    await this.rawExec('f.close()\n');
  },

  // ---------------------------------------------------------------- yapılandırma
  async configureWifi() {
    const C = this.ctx;
    const mode = await C.quickPick([{ v: 'bridge', label: this.L('Arduino köprüsü (VSiPad.h)', 'Arduino bridge') }, { v: 'mpy', label: 'MicroPython (boot.py)' }], { placeholder: this.L('Karttaki yazılım', 'Firmware on the board') });
    if (!mode) return;
    const ssid = await C.inputBox({ prompt: this.L('Kartın bağlanacağı Wi-Fi ağının adı (SSID). Boş bırakırsan kart kendi ağını açar.', 'Wi-Fi SSID (empty = access point)'), value: '' });
    if (ssid == null) return;
    const pass = ssid ? await C.inputBox({ prompt: this.L('Wi-Fi şifresi (sadece karta gönderilir, hiçbir yere kaydedilmez)', 'Wi-Fi password'), value: '' }) : '';
    if (pass == null) return;
    const name = await C.inputBox({ prompt: this.L('Kart adı (ağda vsipad-<ad>.local olur)', 'Board name'), value: 'esp32' });
    if (!name) return;
    try {
      if (mode.v === 'bridge') {
        const host = await this.resolveHost();
        const body = `ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}&name=${encodeURIComponent(name)}`;
        const r = await C.native('http.request', { url: `http://${host}/wifi`, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, timeout: 10 });
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
      } else {
        const how = await this.pickTransport(); if (!how) return;
        await this.connect('mpy', how); await this.rawEnter();
        await this.rawPut('wifi.json', enc.encode(JSON.stringify({ name, ssid, pass, repl_pass: this.S.mpyPass, ble: true })));
        await this.sendRaw('\x02');
      }
      this.S.host = ssid ? `vsipad-${name}.local` : '192.168.4.1'; C.saveSettings();
      C.notify('success', this.L(`Kaydedildi. Kart yeniden başlayınca ${ssid ? '"' + ssid + '" ağına bağlanacak; iPad de aynı ağda olmalı.' : 'kendi ağını (VSiPad-' + name + ') açacak.'}`, 'Saved.'), { timeout: 10000 });
    } catch (e) { C.notify('error', this.L('Kart ayarlanamadı: ', 'Failed: ') + (e.message || e)); }
  },
  async settings() {
    const C = this.ctx, S = this.S;
    const items = [
      { label: this.L('Kart türü…', 'Board…'), desc: (BOARDS.find((b) => b.id === S.fqbn) || { label: S.fqbn }).label, run: async () => {
        const it = await C.quickPick(BOARDS.map((b) => ({ label: b.label, desc: b.id.split(':')[2] + (b.uf2 ? ' · USB' : '') + (b.bridge ? ' · Wi-Fi/BLE' : ''), v: b.id })).concat([{ label: this.L('Özel FQBN yaz…', 'Custom FQBN…'), v: null }]), { placeholder: 'Arduino FQBN' });
        if (!it) return; S.fqbn = it.v || (await C.inputBox({ prompt: 'FQBN', value: S.fqbn })) || S.fqbn; C.saveSettings(); this.renderView();
      } },
      { label: this.L('Kart adresi (Wi-Fi)…', 'Board address…'), desc: S.host, run: async () => { const v = await C.inputBox({ prompt: this.L('Örn: vsipad-esp32.local veya 192.168.1.42 (kart kendi ağını açtıysa 192.168.4.1)', 'Host'), value: S.host }); if (v) { S.host = v.trim(); C.saveSettings(); this.renderView(); } } },
      { label: this.L('Kartın Wi-Fi ağını ayarla…', 'Configure board Wi-Fi…'), run: () => this.configureWifi() },
      { label: this.L('MicroPython WebREPL şifresi…', 'WebREPL password…'), desc: '••••', run: async () => { const v = await C.inputBox({ prompt: 'WebREPL', value: S.mpyPass }); if (v) { S.mpyPass = v; C.saveSettings(); } } },
      { label: this.L('Kart bilgisi', 'Board info'), run: () => this.info() },
      { label: this.L('Kayıtlı USB sürücülerini unut', 'Forget saved USB drives'), run: async () => { const l = await C.native('usb.list').catch(() => []); for (const d of l || []) await C.native('usb.forget', { drive: d.id }); C.notify('info', this.L('Unutuldu. Sonraki yüklemede sürücü yeniden sorulur.', 'Forgotten.')); } }
    ];
    const it = await C.quickPick(items, { placeholder: 'ESP32' });
    if (it) await it.run();
  },
  async info() {
    const C = this.ctx;
    try {
      const host = await this.resolveHost();
      const r = await C.native('http.request', { url: `http://${host}/info`, method: 'GET', timeout: 5 });
      const j = JSON.parse(r.body);
      C.dialog(`${j.name} · ${j.chip}`, `IP ${j.ip}${j.ap ? ' (kendi ağı)' : ' · RSSI ' + j.rssi + ' dBm'}\nÇizim: ${(j.sketch / 1024).toFixed(0)} KB · boş: ${(j.free / 1024).toFixed(0)} KB\nRAM boş: ${(j.heap / 1024).toFixed(0)} KB · açık kalma: ${j.uptime} s\nDerleme: ${j.build}${j.safe ? '\n⚠ GÜVENLİ MOD: çizim üst üste çöktü, setup() atlandı. Düzeltip tekrar yükle.' : ''}`, ['OK']);
    } catch (e) { C.notify('error', this.L('Karta Wi-Fi ile ulaşılamadı: ', 'Unreachable: ') + (e.message || e)); }
  },
  async prepareBridge() {
    const C = this.ctx;
    const which = await C.quickPick([
      { v: 'arduino', label: this.L('Arduino C++ köprüsü', 'Arduino bridge'), desc: this.L('GitHub\'da derlenir, Mac\'ten bir kez yüklenir', 'built on GitHub') },
      { v: 'mpy', label: this.L('MicroPython köprüsü', 'MicroPython bridge'), desc: 'boot.py + vsipad_ble.py' }
    ], { placeholder: this.L('Hangi köprü kurulacak?', 'Which bridge?') });
    if (!which) return;
    if (which.v === 'mpy') {
      for (const f of ['boot.py', 'vsipad_ble.py']) await C.native('fs.write', { path: 'ESP32/MicroPython-kopru/' + f, content: await (await fetch('esp32/micropython/' + f)).text() });
      await C.native('fs.write', { path: 'ESP32/MicroPython-kopru/main.py', content: "# VS iPad – MicroPython örneği\nfrom machine import Pin\nimport time\n\nled = Pin(48, Pin.OUT)  # ESP32-S3 DevKitC: GPIO48 (RGB), klasik ESP32: 2\nfor i in range(10):\n    led.value(i % 2)\n    print('sayaç =', i)\n    time.sleep(0.5)\nprint('bitti')\n" });
      await C.Explorer.refresh();
      this.showGuide('mpy');
      return;
    }
    const dir = 'ESP32/VSiPadKopru';
    await C.native('fs.write', { path: dir + '/VSiPadKopru.ino', content: "// VS iPad köprüsü – ilk kurulum çizimi.\n// Bunu bir kez Mac'ten (kabloyla) yükle; sonra her şey iPad'den kablosuz.\n#ifndef LED_BUILTIN\n#define LED_BUILTIN 2\n#endif\n\nvoid setup() {\n  Serial.begin(115200);\n  pinMode(LED_BUILTIN, OUTPUT);\n  Serial.println(\"VS iPad köprüsü çalışıyor!\");\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));\n  Serial.printf(\"çalışma süresi: %lu s\\n\", millis() / 1000);\n  delay(2000);\n}\n" });
    await C.native('fs.write', { path: dir + '/VSiPad.h', content: await (await fetch('esp32/VSiPad.h')).text() });
    await C.Explorer.refresh();
    await C.Tabs.open(dir + '/VSiPadKopru.ino', { preview: false });
    this.showGuide('arduino');
    const go = await C.dialog(this.L('Köprü GitHub\'da derlensin mi?', 'Build the bridge now?'), this.L('Derlenince "VSiPadKopru-ilk-kurulum-0x0.bin" dosyası klasöre kaydedilir. Onu Mac\'e AirDrop ile atıp Chrome\'da espressif.github.io/esptool-js ile kartın 0x0 adresine yazacaksın (rehber açıldı).', ''), [this.L('Derle', 'Build'), this.L('Sonra', 'Later')], 0);
    if (go === 0) this.buildAndFlash(dir + '/VSiPadKopru.ino', { saveMerged: true });
  },
  showGuide(kind) {
    const C = this.ctx;
    const title = { mpy: 'ESP32 · MicroPython kurulumu', usb: 'ESP32 · USB kablo ile yükleme', arduino: 'ESP32 · Arduino kurulumu' }[kind] || 'ESP32';
    C.Tabs.openVirtual('esp32-guide-' + kind, title, '<i class="codicon codicon-circuit-board"></i>', (root) => {
      root.innerHTML = `<div class="md-body esp-guide">${C.MD.render({ mpy: GUIDE_MPY, usb: GUIDE_USB }[kind] || GUIDE_ARDUINO)}</div>`;
      root.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const h = a.getAttribute('href'); if (/^https?:/.test(h)) C.native('app.openURL', { url: h }); }));
    });
  },

  // ---------------------------------------------------------------- kenar çubuğu görünümü
  renderView() {
    const C = this.ctx; if (!C) return;
    const root = document.getElementById('espRoot'); if (!root) return;
    const S = this.S, esc = C.esc, tr = this.tr();
    const c = this.conn;
    const B = boardOf(S.fqbn), board = B.label;
    const active = C.Tabs.active && !C.Tabs.active.virtual ? C.Tabs.active.path : null;
    const isIno = active && /\.ino$/i.test(active), isPy = active && /\.py$/i.test(active);
    root.innerHTML = `
      <div class="esp-card">
        <div class="esp-status ${c ? 'on' : ''}"><i class="codicon codicon-${c ? (c.kind === 'ble' ? 'bluetooth' : 'radio-tower') : 'debug-disconnect'}"></i>
          <span>${c ? esc(c.name) + ' · ' + (c.kind === 'ble' ? 'Bluetooth' : 'Wi-Fi') + (c.mode === 'mpy' ? ' · MicroPython' : '') : (tr ? 'Bağlı değil' : 'Not connected')}</span></div>
        <div class="esp-row dim small"><i class="codicon codicon-chip"></i> ${esc(board)}</div>
        <div class="esp-row dim small"><i class="codicon codicon-globe"></i> ${esc(S.host)}</div>
      </div>
      <div class="esp-actions">
        <button class="btn-primary wide" data-ea="build" ${this.busy || !isIno ? 'disabled' : ''}><i class="codicon codicon-play"></i> ${tr ? 'Derle ve Yükle (Arduino)' : 'Build & Upload (Arduino)'}</button>
        <button class="btn-primary wide" data-ea="mpy" ${this.busy || !isPy ? 'disabled' : ''}><i class="codicon codicon-run-all"></i> ${tr ? 'Yükle ve Çalıştır (MicroPython)' : 'Upload & Run (MicroPython)'}</button>
        <button class="btn-secondary wide" data-ea="mpyall" ${this.busy || !isPy ? 'disabled' : ''}><i class="codicon codicon-cloud-upload"></i> ${tr ? 'Klasördeki .py dosyalarını yükle' : 'Upload folder .py files'}</button>
        <button class="btn-primary wide" data-ea="cpy" ${this.busy || !isPy ? 'disabled' : ''}><i class="codicon codicon-plug"></i> ${tr ? 'USB\'ye Yaz ve Çalıştır (CircuitPython)' : 'Write to USB & Run (CircuitPython)'}</button>
        <button class="btn-secondary wide" data-ea="monitor"><i class="codicon codicon-output"></i> ${c ? (tr ? 'Bağlantıyı kes' : 'Disconnect') : (tr ? 'Seri Monitörü Aç' : 'Open Serial Monitor')}</button>
        <button class="btn-secondary wide" data-ea="settings"><i class="codicon codicon-settings-gear"></i> ${tr ? 'Kart / Wi-Fi Ayarları' : 'Board / Wi-Fi Settings'}</button>
      </div>
      ${!isIno && !isPy ? `<p class="dim small esp-p">${tr ? 'Bir <b>.ino</b> (Arduino) ya da <b>.py</b> (MicroPython) dosyası aç.' : 'Open an .ino or .py file.'}</p>` : ''}
      <div class="pane-header expanded"><i class="codicon codicon-chevron-down twist"></i><span>${tr ? 'USB KABLO' : 'USB CABLE'}</span></div>
      <div class="esp-p small">
        <p class="dim">${tr ? `Kablo + iPad yeter: ESP32-S3 (TinyUF2) ve Raspberry Pi Pico USB bellek olarak programlanır.${B.uf2 ? '' : ' <b>Seçili kart (' + esc(board) + ') USB ile yüklenemez</b>, kablosuz kullan.'}` : 'ESP32-S3 (TinyUF2) and Pico are flashed as USB drives.'}</p>
        <button class="btn-secondary wide" data-ea="cpyinstall"><i class="codicon codicon-desktop-download"></i> ${tr ? 'CircuitPython\'u karta kur…' : 'Install CircuitPython…'}</button>
        <button class="btn-secondary wide" data-ea="uf2file"><i class="codicon codicon-file-binary"></i> ${tr ? '.uf2 dosyasını karta yaz…' : 'Flash a .uf2 file…'}</button><p></p>
        <a href="#" data-ea="guideU">${tr ? 'USB kablo rehberi' : 'USB guide'}</a>
      </div>
      <div class="pane-header expanded"><i class="codicon codicon-chevron-down twist"></i><span>${tr ? 'KABLOSUZ İLK KURULUM' : 'WIRELESS SETUP'}</span></div>
      <div class="esp-p small">
        <p class="dim">${tr ? 'Klasik ESP32 / C3\'te USB bellek yok: kart bir kez Mac\'ten hazırlanır, sonra her şey Wi-Fi / Bluetooth ile.' : 'Classic ESP32 / C3: prepare once from a Mac, then wireless.'}</p>
        <button class="btn-secondary wide" data-ea="bridge"><i class="codicon codicon-tools"></i> ${tr ? 'Köprü yazılımını hazırla…' : 'Prepare bridge firmware…'}</button><p></p>
        <a href="#" data-ea="guideA">${tr ? 'Arduino kurulum rehberi' : 'Arduino guide'}</a> · <a href="#" data-ea="guideM">${tr ? 'MicroPython rehberi' : 'MicroPython guide'}</a>
      </div>`;
    root.querySelectorAll('[data-ea]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); this.action(b.dataset.ea); }));
  },
  async action(a) {
    const C = this.ctx, p = C.Tabs.active && !C.Tabs.active.virtual ? C.Tabs.active.path : null;
    try {
      switch (a) {
        case 'build': if (p) await this.buildAndFlash(p); break;
        case 'mpy': if (p) await this.mpyRun(p); break;
        case 'mpyall': if (p) await this.mpyRun(p, { all: true, uploadOnly: true }); break;
        case 'cpy': if (p) await this.cpyRun(p); break;
        case 'cpyinstall': await this.cpyInstall(); break;
        case 'uf2file': await this.writeUf2File(); break;
        case 'guideU': this.showGuide('usb'); break;
        case 'monitor': if (this.conn) await this.disconnect(); else await this.openMonitor(); break;
        case 'settings': await this.settings(); break;
        case 'bridge': await this.prepareBridge(); break;
        case 'guideA': this.showGuide('arduino'); break;
        case 'guideM': this.showGuide('mpy'); break;
      }
    } catch (e) { C.notify('error', String(e.message || e)); }
  },
  async openMonitor() {
    const C = this.ctx;
    const mode = await C.quickPick([{ v: 'bridge', label: this.L('Arduino (VS iPad köprüsü)', 'Arduino (bridge)') }, { v: 'mpy', label: 'MicroPython REPL' }].sort((a, b) => (b.v === this.S.lastMode) - (a.v === this.S.lastMode)), { placeholder: this.L('Karttaki yazılım', 'Firmware') });
    if (!mode) return;
    this.S.lastMode = mode.v;
    const how = await this.pickTransport(); if (!how) return;
    try { await this.connect(mode.v, how); }
    catch (e) { this.monWrite(`[✖ ${e.message || e}]\n`, 'sm-err'); this.conn = null; this.renderView(); this.renderMonBar(); }
  },

  // ---------------------------------------------------------------- seri monitör paneli
  bindMonitor() {
    const inp = document.getElementById('serIn'); if (!inp) return;
    inp.addEventListener('keydown', async (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = inp.value; inp.value = '';
        const eol = { lf: '\n', crlf: '\r\n', cr: '\r', none: '' }[this.S.eol] || '\n';
        try { await this.sendRaw((this.conn && this.conn.mode === 'mpy' ? v + '\r' : v + eol)); } catch (er) { this.monWrite(`[${er.message}]\n`, 'sm-err'); }
      } else if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); this.sendRaw('\x03').catch(() => {}); }
    });
    document.getElementById('serConnect').addEventListener('click', () => (this.conn ? this.disconnect() : this.openMonitor()));
    document.getElementById('serClear').addEventListener('click', () => { document.getElementById('serOut').textContent = ''; });
    document.getElementById('serStop').addEventListener('click', () => this.sendRaw('\x03').catch(() => {}));
    const ts = document.getElementById('serTs'); ts.checked = !!this.S.ts; ts.addEventListener('change', () => { this.S.ts = ts.checked; this.ctx.saveSettings(); });
    const eol = document.getElementById('serEol'); eol.value = this.S.eol || 'lf'; eol.addEventListener('change', () => { this.S.eol = eol.value; this.ctx.saveSettings(); });
    this.renderMonBar();
  },
  renderMonBar() {
    const b = document.getElementById('serConnect'); if (!b) return;
    b.innerHTML = this.conn ? `<i class="codicon codicon-debug-disconnect"></i> ${this.L('Kes', 'Disconnect')}` : `<i class="codicon codicon-plug"></i> ${this.L('Bağlan', 'Connect')}`;
    const st = document.getElementById('serState'); if (st) st.textContent = this.conn ? `${this.conn.name} · ${this.conn.kind === 'ble' ? 'BLE' : 'Wi-Fi'}` : this.L('bağlı değil', 'not connected');
    document.getElementById('serStop').classList.toggle('hidden', !(this.conn && this.conn.mode === 'mpy'));
  },
  monWrite(text, cls) {
    const out = document.getElementById('serOut'); if (!out) return;
    text = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r\n/g, '\n').replace(/\r(?!\n)/g, '').replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, '');
    if (!text) return;
    if (this.S.ts && !cls) {
      const now = new Date(), stamp = now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0') + ' → ';
      text = text.replace(/(^|\n)(?=.)/g, (m) => m + (this._atLineStart || m ? stamp : ''));
    }
    this._atLineStart = text.endsWith('\n');
    const last = out.lastChild;
    if (last && (last.className || '') === (cls || '') && last.textContent.length < 20000) last.textContent += text;
    else { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; out.appendChild(s); }
    while (out.childNodes.length > 3000) out.removeChild(out.firstChild);
    if (document.getElementById('serAuto').checked) { const box = document.getElementById('serBox'); box.scrollTop = box.scrollHeight; }
  }
};

const GUIDE_ARDUINO = `# ESP32 · Arduino (C++) – ilk kurulum

> **ESP32-S3 ya da Raspberry Pi Pico kullanıyorsan kablo yeter:** USB kablo rehberine bak (TinyUF2 / UF2).

Klasik ESP32 ve C3'te USB bellek modu yok; iPad bu kartlara kabloyla yazamaz (Apple USB-seriyi kapatıyor).
Bu yüzden karta bir kez Mac'ten küçük bir **köprü** yüklenir; sonra her şey iPad'den **kablosuz**:

| | |
|---|---|
| Derleme | GitHub Actions (ücretsiz, gerçek arduino-cli + ESP32 çekirdeği 3.0.7) |
| Yükleme | Wi-Fi (hızlı) veya Bluetooth LE (ağ gerekmez) |
| Seri monitör | Alt paneldeki **SERİ MONİTÖR** sekmesi |

## 1. GitHub hazırlığı (bir kez)
1. ESP32 kodlarını koyacağın klasörü **Kaynak Denetimi › GitHub'da Yayımla** ile gizli bir depo yap (örn. \`esp32-projeler\`).
2. GitHub token'ına **Workflows: Read and write** izni ekle: github.com › Settings › Developer settings › Fine-grained tokens › token › *Edit* › Permissions.

## 2. Köprüyü karta yükle (Mac, bir kez)
1. ESP32 görünümünde **Köprü yazılımını hazırla… › Arduino** → *Derle*. Bitince klasöre \`VSiPadKopru-ilk-kurulum-0x0.bin\` kaydedilir.
2. Dosyayı **AirDrop** ile Mac'e at.
3. Mac'te **Chrome** ile [espressif.github.io/esptool-js](https://espressif.github.io/esptool-js/) aç, kartı USB ile bağla › **Connect** › Flash Address **0x0** › dosyayı seç › **Program**.
   *(ESP32-S3'te bağlanmazsa: BOOT tuşunu basılı tut, RESET'e bas, BOOT'u bırak.)*
4. Kart yeniden başlayınca kendi Wi-Fi ağını açar: **VSiPad-esp32**, şifre **vsipad123**.

> Alternatif: Mac'te Arduino IDE kullanıyorsan \`VSiPad.h\` dosyasını çizimin yanına koyup en üste \`#include "VSiPad.h"\` yaz ve normal şekilde yükle.

## 3. iPad'den kullanım
- iPad'i **VSiPad-esp32** ağına bağla (ya da **Kart / Wi-Fi Ayarları › Kartın Wi-Fi ağını ayarla** ile kartı ev ağına al).
- Bir \`.ino\` dosyası açıp **▷** (veya ESP32 › Derle ve Yükle) → derlenir → *Wi-Fi / Bluetooth* sorulur → karta yüklenir → seri monitör açılır.
- \`Serial.print\` çıktıları seri monitörde görünür; alttaki kutuya yazdıkların \`Serial.read()\` ile okunur.
- Kütüphane gerekiyorsa çizime \`// @lib Kütüphane Adı\` satırı ekle (örn. \`// @lib DHT sensor library\`).

## Bilinmesi gerekenler
- Her çizime köprü otomatik eklenir, böylece kablosuz yükleme hiç kaybolmaz. Çizim üst üste 3 kez çökerse kart **güvenli moda** geçer (setup atlanır, yükleme açık kalır).
- Bölüm şeması *Minimal SPIFFS* (1.9 MB uygulama + OTA). Kart türü: **Kart / Wi-Fi Ayarları › Kart türü**.
- GitHub Actions gizli depolarda ayda 2000 dakika ücretsiz; bir derleme ~1-2 dakika.
`;
const GUIDE_USB = `# USB kablo ile yükleme (sadece iPad + kablo)

iPadOS uygulamalara **USB-seri** vermez, ama USB **belleği** Dosyalar'da açar. UF2 önyükleyicisi olan kartlar
kendini bir USB bellek gibi gösterir: içine \`.uf2\` dosyası yazmak = kartı programlamak.

| Kart | Kablo ile | Hazırlık |
|---|---|---|
| **ESP32-S3** DevKitC-1 | ✅ Arduino C++ (.uf2) ve CircuitPython | Mac'ten **bir kez** TinyUF2 kurulumu |
| **Raspberry Pi Pico / Pico W / Pico 2** | ✅ Arduino C++ ve CircuitPython | Yok, çıktığı gibi çalışır |
| Klasik ESP32, ESP32-C3, Arduino Uno/Nano | ❌ (USB-seri çipi var, bellek yok) | Kablosuz yol: Wi-Fi / Bluetooth |

> Kablo: iPad'in USB-C portu → kartın **"USB"** yazan portu (DevKitC-1'de iki port var, **UART** olan çalışmaz). Kart iPad'den beslenir.

## 1. ESP32-S3'e TinyUF2 kur (Mac, bir kez)
Çipin içindeki ROM önyükleyici sadece seri port konuşur, bu yüzden ilk kurulum için bir bilgisayar şart. Sonra bir daha gerekmez.
1. Kartı Mac'e **UART** portundan bağla.
2. Terminal: \`./tools/esp32s3-tinyuf2-kur.sh\` (esptool'u kurar, TinyUF2'yi indirir, yazar).
3. Bitti. RESET'e basıp LED mor yanınca BOOT'a basarsan kart **S3DKC1BOOT** belleği olarak açılır.

> Script yerine tarayıcıdan da olur: Chrome ile [adafruit.github.io/Adafruit_WebSerial_ESPTool](https://adafruit.github.io/Adafruit_WebSerial_ESPTool/) › TinyUF2 zip'indeki \`combined.bin\` › adres **0x0**.

## 2. Arduino C++ (derleme GitHub'da, yükleme kabloyla)
1. ESP32 › Kart / Wi-Fi Ayarları › **Kart türü**: ESP32-S3 ya da Raspberry Pi Pico.
2. \`.ino\` aç › **▷** → GitHub Actions derler → *🔌 USB kablo (UF2)* seç.
3. Kartı UF2 moduna al:
   - ESP32-S3'te VS iPad çizimi çalışıyorsa: **BOOT'u 2 sn basılı tut** (Wi-Fi'dan erişilebiliyorsa VS iPad bunu kendisi yapar)
   - ya da **RESET**, LED mor yanınca **BOOT**
   - Pico: **BOOTSEL** basılıyken kabloyu tak
4. İlk seferde Dosyalar penceresi açılır: sol menüden **S3DKC1BOOT** / **RPI-RP2** belleğini seç › **Aç**. Sonraki yüklemelerde sorulmaz.
5. Dosya yazılır, kart kendiliğinden yeniden başlar ve çizim çalışır.

> Derleme için internet gerekir (GitHub Actions). Yükleme internetsizdir.

## 3. CircuitPython (tamamen internetsiz)
CircuitPython'da derleme yok: kart **CIRCUITPY** belleği olarak görünür, \`code.py\` dosyasını kaydedince çalışır.
1. **CircuitPython'u karta kur…** → kartını seç → en son sürüm indirilir, \`ESP32/firmware/\` içine kaydedilir (sonraki kurulumlar internetsiz) → UF2 belleğine yazılır.
2. Kart **CIRCUITPY** olarak açılır. İlk seferde Dosyalar'dan seç.
3. Bir \`.py\` aç › **USB'ye Yaz ve Çalıştır (CircuitPython)** ya da **▷** (\`import board\` görünce sorar). Dosya \`code.py\` olarak yazılır; aynı klasördeki diğer \`.py\` dosyaları ve \`lib/\` klasörü de kopyalanır.

\`\`\`python
import board, digitalio, time
led = digitalio.DigitalInOut(board.LED)   # Pico; ESP32-S3'te RGB LED için neopixel kullan
led.direction = digitalio.Direction.OUTPUT
while True:
    led.value = not led.value
    time.sleep(0.5)
\`\`\`

## Bilinmesi gerekenler
- **Seri çıktı:** iPad USB-seriyi okuyamaz; \`print()\` / \`Serial.print\` kabloyla görünmez. ESP32'de VS iPad köprüsü çizime eklendiği için **SERİ MONİTÖR › Wi-Fi / Bluetooth** ile bakabilirsin.
- CircuitPython'dan Arduino'ya dönüş: RESET → LED mor → BOOT, ya da kodda \`microcontroller.on_next_reset(microcontroller.RunMode.UF2); microcontroller.reset()\`.
- BOOT tuşunu (GPIO0) çiziminde kullanıyorsan, en üste \`#define VSIPAD_NO_BOOT_BUTTON\` yaz.
- Sürücü değiştiyse: Kart / Wi-Fi Ayarları › **Kayıtlı USB sürücülerini unut**.
`;
const GUIDE_MPY = `# ESP32 · MicroPython – ilk kurulum

MicroPython'da **derleme yoktur**: \`.py\` dosyası doğrudan karta yüklenir ve çalışır. İnternet gerekmez.

## 1. MicroPython'u karta yükle (Mac, bir kez)
1. [micropython.org/download/ESP32_GENERIC_S3](https://micropython.org/download/ESP32_GENERIC_S3/) adresinden en son **.bin** dosyasını indir (klasik ESP32 için *ESP32_GENERIC*, C3 için *ESP32_GENERIC_C3*).
2. Chrome ile [espressif.github.io/esptool-js](https://espressif.github.io/esptool-js/) › **Connect** › önce **Erase Flash**, sonra adres **0x0** › **Program**. *(Klasik ESP32'de adres 0x1000.)*

## 2. Köprü dosyalarını kopyala (Mac, bir kez)
1. ESP32 görünümünde **Köprü yazılımını hazırla… › MicroPython** → \`ESP32/MicroPython-kopru\` klasörü oluşur (boot.py, vsipad_ble.py, main.py). Klasörü AirDrop ile Mac'e at.
2. Mac'te Chrome ile [viper-ide.org](https://viper-ide.org) (ya da Thonny) aç, karta bağlan ve **boot.py** ile **vsipad_ble.py** dosyalarını kartın köküne kaydet. Kartı resetle.
3. Kart kendi ağını açar: **VSiPad-esp32**, şifre **vsipad123** · WebREPL şifresi: **vsipad**.

## 3. iPad'den kullanım
- Bir \`.py\` dosyası açıp ESP32 › **Yükle ve Çalıştır** → *Wi-Fi / Bluetooth* sorulur → dosya karta yazılır ve çalışır; çıktılar **SERİ MONİTÖR** sekmesinde.
- \`machine\`, \`network\` vb. içe aktaran dosyalarda ▷ da ESP32'de çalıştırmayı önerir.
- Durdurmak için seri monitördeki ⏹ (Ctrl-C). Monitörün kutusuna yazdığın satırlar REPL'e gider (\`>>>\`).
- Kalıcı program için dosyanı \`main.py\` adıyla yükle; kart her açılışta çalıştırır.
`;

window.VSCModules.push((ctx) => { Esp.ctx = ctx; ctx.Esp = Esp; });
window.VSCEsp = Esp;
const $ = (s) => document.querySelector(s);
Esp.MPY_HINT = MPY_HINT;
Esp.CPY_HINT = CPY_HINT;
Esp.toUF2 = toUF2;
})();
