/*
 * VSiPad.h – VS iPad ESP32 köprüsü (Arduino-ESP32 3.x, ESP32 / S2 / S3 / C3)
 *
 * Bu dosyayı eklemek yeterli; çizimin (sketch) geri kalanı değişmez:
 *     #include "VSiPad.h"
 * VS iPad derlerken bunu otomatik ekler.
 *
 *  • Kablosuz yazılım yükleme:  Wi-Fi (HTTP POST /update)  veya  Bluetooth LE
 *  • Seri monitör:              Serial.print… çıktıları USB'ye ek olarak
 *                               Wi-Fi (TCP 23) ve BLE (Nordic UART) üzerinden de gider;
 *                               iPad'den yazılanlar Serial.read() ile okunur.
 *  • Wi-Fi: kayıtlı ağa bağlanır; yoksa kendi ağını açar:
 *        ad: VSiPad-<isim>   şifre: vsipad123   adres: 192.168.4.1
 *  • Güvenli mod: çizim üst üste 3 kez çökerse setup() atlanır, yükleme açık kalır.
 *  • USB kablo (ESP32-S2/S3 + TinyUF2): BOOT tuşunu çalışırken 2 sn basılı tut
 *    (ya da Wi-Fi POST /uf2, BLE "UF2") → kart S3DKC1BOOT USB belleği olarak açılır.
 *    İstemezsen çizimden önce  #define VSIPAD_NO_BOOT_BUTTON
 *
 * Köprü kendi FreeRTOS görevinde çalışır; loop() içinde uzun delay() olsa bile
 * yükleme çalışmaya devam eder.
 */
#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Update.h>
#include <Preferences.h>
#include <esp_system.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#ifndef VSIPAD_AP_PASSWORD
#define VSIPAD_AP_PASSWORD "vsipad123"
#endif
#if __has_include("vsipad_build.h")
#include "vsipad_build.h"
#endif
#ifndef VSIPAD_BUILD_ID
#define VSIPAD_BUILD_ID "manual"
#endif
#if defined(CONFIG_IDF_TARGET_ESP32S3) || defined(CONFIG_IDF_TARGET_ESP32S2)
#define VSIPAD_HAS_UF2 1
// TinyUF2 2. aşama önyükleyicisi bu "reset sebebi" ipucunu görünce UF2 sürücüsünü açar.
extern "C" void esp_reset_reason_set_hint(esp_reset_reason_t hint);
#endif

namespace vsipad {

static const char *NUS_SVC = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
static const char *NUS_RX  = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
static const char *NUS_TX  = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";
static const char *OTA_SVC = "7B0E0001-5A1E-4C3A-9F00-56495061644F";
static const char *OTA_CTL = "7B0E0002-5A1E-4C3A-9F00-56495061644F";
static const char *OTA_DAT = "7B0E0003-5A1E-4C3A-9F00-56495061644F";

// çökme sayacı (yeniden başlatmalarda korunur)
RTC_NOINIT_ATTR static uint32_t crashMagic;
RTC_NOINIT_ATTR static uint32_t crashCount;

struct Ring {
  static const size_t N = 8192;
  uint8_t buf[N]; volatile size_t head = 0, tail = 0;
  portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
  void put(const uint8_t *d, size_t n) {
    portENTER_CRITICAL(&mux);
    for (size_t i = 0; i < n; i++) { buf[head] = d[i]; head = (head + 1) % N; if (head == tail) tail = (tail + 1) % N; }
    portEXIT_CRITICAL(&mux);
  }
  size_t get(uint8_t *d, size_t max) {
    portENTER_CRITICAL(&mux);
    size_t n = 0; while (tail != head && n < max) { d[n++] = buf[tail]; tail = (tail + 1) % N; }
    portEXIT_CRITICAL(&mux);
    return n;
  }
  int peek() { portENTER_CRITICAL(&mux); int c = tail != head ? buf[tail] : -1; portEXIT_CRITICAL(&mux); return c; }
  size_t size() { portENTER_CRITICAL(&mux); size_t s = (head + N - tail) % N; portEXIT_CRITICAL(&mux); return s; }
};

class Bridge {
 public:
  Ring out, in;
  String name = "esp32";
  bool started = false, safeMode = false, apMode = false;
  WebServer *http = nullptr;
  WiFiServer *telnet = nullptr;
  WiFiClient clients[2];
  BLECharacteristic *txChar = nullptr, *otaCtl = nullptr;
  volatile bool bleConnected = false;
  uint16_t bleMtu = 23;
  // BLE yükleme durumu
  volatile bool bleOta = false; size_t bleOtaSize = 0, bleOtaDone = 0;
  volatile uint32_t restartAt = 0;
  volatile bool uf2Pending = false;
  uint32_t bootDownSince = 0;

  void log(const String &s) { out.put((const uint8_t *)s.c_str(), s.length()); }

  void begin() {
    if (started) return;
    started = true;
    Preferences p; p.begin("vsipad", true);
    name = p.getString("name", "esp32");
    String ssid = p.getString("ssid", ""), pass = p.getString("pass", "");
    p.end();
    String host = "vsipad-" + name;
    WiFi.persistent(false);
    WiFi.setHostname(host.c_str());
    if (ssid.length()) {
      WiFi.mode(WIFI_STA);
      WiFi.begin(ssid.c_str(), pass.c_str());
      uint32_t t0 = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) delay(100);
    }
    if (WiFi.status() != WL_CONNECTED) {
      apMode = true;
      WiFi.mode(WIFI_AP);
      WiFi.softAP(("VSiPad-" + name).c_str(), VSIPAD_AP_PASSWORD);
    }
    MDNS.begin(host.c_str());
    MDNS.addService("http", "tcp", 80);
    startHttp();
    telnet = new WiFiServer(23); telnet->begin(); telnet->setNoDelay(true);
    startBle();
#if defined(VSIPAD_HAS_UF2) && !defined(VSIPAD_NO_BOOT_BUTTON)
    pinMode(0, INPUT_PULLUP);
#endif
    xTaskCreatePinnedToCore([](void *a) { ((Bridge *)a)->task(); }, "vsipad", 8192, this, 1, nullptr, ARDUINO_RUNNING_CORE);
    String ip = apMode ? WiFi.softAPIP().toString() : WiFi.localIP().toString();
    log("\r\n[VS iPad] köprü hazır · " + String(apMode ? "Wi-Fi ağı: VSiPad-" + name + " (şifre " VSIPAD_AP_PASSWORD ")" : "Wi-Fi: " + ssid) +
        " · IP " + ip + " · " + host + ".local · BLE: VSiPad-" + name + (safeMode ? " · GÜVENLİ MOD (setup atlandı)" : "") + "\r\n");
  }

  // ---------------------------------------------------------------- HTTP: /info /update /wifi /reboot
  void startHttp() {
    http = new WebServer(80);
    http->on("/info", HTTP_GET, [this]() {
      String j = "{\"name\":\"" + name + "\",\"chip\":\"" + String(ESP.getChipModel()) + "\",\"ip\":\"" +
                 (apMode ? WiFi.softAPIP().toString() : WiFi.localIP().toString()) + "\",\"ap\":" + (apMode ? "true" : "false") +
                 ",\"rssi\":" + String(apMode ? 0 : WiFi.RSSI()) + ",\"sketch\":" + String(ESP.getSketchSize()) +
                 ",\"free\":" + String(ESP.getFreeSketchSpace()) + ",\"heap\":" + String(ESP.getFreeHeap()) +
                 ",\"uptime\":" + String(millis() / 1000) + ",\"build\":\"" VSIPAD_BUILD_ID "\",\"safe\":" + (safeMode ? "true" : "false") + "}";
      http->sendHeader("Access-Control-Allow-Origin", "*");
      http->send(200, "application/json", j);
    });
    http->on("/wifi", HTTP_POST, [this]() {
      Preferences p; p.begin("vsipad", false);
      if (http->hasArg("ssid")) p.putString("ssid", http->arg("ssid"));
      if (http->hasArg("pass")) p.putString("pass", http->arg("pass"));
      if (http->hasArg("name") && http->arg("name").length()) p.putString("name", http->arg("name"));
      p.end();
      http->send(200, "text/plain", "OK – yeniden başlatılıyor");
      restartAt = millis() + 800;
    });
    http->on("/reboot", HTTP_POST, [this]() { http->send(200, "text/plain", "OK"); restartAt = millis() + 300; });
    http->on("/uf2", HTTP_POST, [this]() {
#ifdef VSIPAD_HAS_UF2
      http->send(200, "text/plain", "OK – UF2 moduna geçiliyor");
      uf2Pending = true; restartAt = millis() + 300;
#else
      http->send(501, "text/plain", "Bu çipte USB UF2 yok (sadece ESP32-S2/S3)");
#endif
    });
    http->on("/update", HTTP_POST,
      [this]() {
        bool ok = !Update.hasError();
        http->sendHeader("Connection", "close");
        http->send(ok ? 200 : 500, "text/plain", ok ? "OK" : String("ERR ") + Update.errorString());
        if (ok) { crashCount = 0; restartAt = millis() + 500; }
      },
      [this]() {
        HTTPUpload &u = http->upload();
        if (u.status == UPLOAD_FILE_START) {
          log("\r\n[VS iPad] Wi-Fi ile yükleniyor: " + u.filename + "\r\n");
          if (!Update.begin(UPDATE_SIZE_UNKNOWN)) log("[VS iPad] HATA: " + String(Update.errorString()) + "\r\n");
        } else if (u.status == UPLOAD_FILE_WRITE) {
          if (Update.write(u.buf, u.currentSize) != u.currentSize) log("[VS iPad] yazma hatası\r\n");
        } else if (u.status == UPLOAD_FILE_END) {
          if (Update.end(true)) log("[VS iPad] yüklendi (" + String(u.totalSize) + " bayt), yeniden başlatılıyor…\r\n");
          else log("[VS iPad] HATA: " + String(Update.errorString()) + "\r\n");
        } else if (u.status == UPLOAD_FILE_ABORTED) { Update.abort(); }
      });
    http->onNotFound([this]() { http->send(404, "text/plain", "VS iPad köprüsü: /info /update /wifi /reboot /uf2"); });
    http->begin();
  }

  // ---------------------------------------------------------------- BLE: Nordic UART + yükleme servisi
  struct SrvCb : BLEServerCallbacks {
    Bridge *b; SrvCb(Bridge *b) : b(b) {}
    void onConnect(BLEServer *s, esp_ble_gatts_cb_param_t *param) override { b->bleConnected = true; b->bleMtu = 23; }
    void onDisconnect(BLEServer *s) override {
      b->bleConnected = false;
      if (b->bleOta) { Update.abort(); b->bleOta = false; }
      s->getAdvertising()->start();
    }
    void onMtuChanged(BLEServer *s, esp_ble_gatts_cb_param_t *param) override { b->bleMtu = param->mtu.mtu; }
  };
  struct RxCb : BLECharacteristicCallbacks {
    Bridge *b; RxCb(Bridge *b) : b(b) {}
    void onWrite(BLECharacteristic *c) override { String v = c->getValue(); b->in.put((const uint8_t *)v.c_str(), v.length()); }
  };
  struct CtlCb : BLECharacteristicCallbacks {
    Bridge *b; CtlCb(Bridge *b) : b(b) {}
    void onWrite(BLECharacteristic *c) override {
      String v = c->getValue();
      if (v.startsWith("BEGIN ")) {
        b->bleOtaSize = v.substring(6).toInt(); b->bleOtaDone = 0;
        if (b->bleOta) Update.abort();
        b->bleOta = Update.begin(b->bleOtaSize ? b->bleOtaSize : UPDATE_SIZE_UNKNOWN);
        b->notifyCtl(b->bleOta ? "READY" : String("ERR ") + Update.errorString());
        if (b->bleOta) b->log("\r\n[VS iPad] Bluetooth ile yükleniyor (" + String(b->bleOtaSize) + " bayt)…\r\n");
      } else if (v == "END") {
        if (b->bleOta && Update.end(true)) { b->notifyCtl("DONE"); b->log("[VS iPad] yüklendi, yeniden başlatılıyor…\r\n"); crashCount = 0; b->restartAt = millis() + 700; }
        else b->notifyCtl(String("ERR ") + Update.errorString());
        b->bleOta = false;
      } else if (v == "ABORT") { if (b->bleOta) Update.abort(); b->bleOta = false; b->notifyCtl("ABORTED"); }
      else if (v == "UF2") { b->notifyCtl("UF2"); b->uf2Pending = true; b->restartAt = millis() + 300; }
      else if (v == "INFO") { b->notifyCtl("INFO " + b->name + " " + String(ESP.getChipModel()) + " free=" + String(ESP.getFreeSketchSpace())); }
    }
  };
  struct DatCb : BLECharacteristicCallbacks {
    Bridge *b; DatCb(Bridge *b) : b(b) {}
    void onWrite(BLECharacteristic *c) override {
      if (!b->bleOta) return;
      String v = c->getValue();
      if (Update.write((uint8_t *)v.c_str(), v.length()) != v.length()) { b->notifyCtl(String("ERR ") + Update.errorString()); Update.abort(); b->bleOta = false; return; }
      b->bleOtaDone += v.length();
      if ((b->bleOtaDone & 0x3FFF) < v.length()) b->notifyCtl("OK " + String(b->bleOtaDone));
    }
  };
  void notifyCtl(const String &s) { if (otaCtl) { otaCtl->setValue((uint8_t *)s.c_str(), s.length()); otaCtl->notify(); } }

  void startBle() {
    BLEDevice::init(("VSiPad-" + name).c_str());
    BLEDevice::setMTU(517);
    BLEServer *srv = BLEDevice::createServer();
    srv->setCallbacks(new SrvCb(this));
    BLEService *nus = srv->createService(NUS_SVC);
    txChar = nus->createCharacteristic(NUS_TX, BLECharacteristic::PROPERTY_NOTIFY);
    txChar->addDescriptor(new BLE2902());
    BLECharacteristic *rx = nus->createCharacteristic(NUS_RX, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    rx->setCallbacks(new RxCb(this));
    nus->start();
    BLEService *ota = srv->createService(OTA_SVC);
    otaCtl = ota->createCharacteristic(OTA_CTL, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
    otaCtl->addDescriptor(new BLE2902());
    otaCtl->setCallbacks(new CtlCb(this));
    BLECharacteristic *dat = ota->createCharacteristic(OTA_DAT, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    dat->setCallbacks(new DatCb(this));
    ota->start();
    BLEAdvertising *adv = BLEDevice::getAdvertising();
    adv->addServiceUUID(NUS_SVC);
    adv->setScanResponse(true);
    BLEDevice::startAdvertising();
  }

  void restart() {
#ifdef VSIPAD_HAS_UF2
    if (uf2Pending) { (void)esp_reset_reason(); esp_reset_reason_set_hint((esp_reset_reason_t)0x11F2); esp_restart(); }
#endif
    ESP.restart();
  }

  // ---------------------------------------------------------------- arka plan görevi
  void task() {
    uint8_t buf[512];
    for (;;) {
      http->handleClient();
      if (telnet->hasClient()) {
        WiFiClient c = telnet->accept();
        int slot = !clients[0].connected() ? 0 : !clients[1].connected() ? 1 : 0;
        clients[slot].stop(); clients[slot] = c;
        c.print("[VS iPad] seri monitör bağlandı – " + name + "\r\n");
      }
      for (auto &c : clients) while (c.connected() && c.available()) { uint8_t ch = c.read(); in.put(&ch, 1); }
      size_t n;
      while ((n = out.get(buf, bleConnected ? min<size_t>(sizeof(buf), (size_t)max(20, bleMtu - 3)) : sizeof(buf))) > 0) {
        for (auto &c : clients) if (c.connected()) c.write(buf, n);
        if (bleConnected && txChar && !bleOta) { txChar->setValue(buf, n); txChar->notify(); delay(2); }
      }
#if defined(VSIPAD_HAS_UF2) && !defined(VSIPAD_NO_BOOT_BUTTON)
      // BOOT (GPIO0) 2 sn basılı → UF2 modu
      if (digitalRead(0) == LOW) {
        if (!bootDownSince) bootDownSince = millis() | 1;
        else if (!uf2Pending && millis() - bootDownSince > 2000) { log("\r\n[VS iPad] BOOT basılı: UF2 (USB bellek) moduna geçiliyor…\r\n"); uf2Pending = true; restartAt = millis() + 200; }
      } else bootDownSince = 0;
#endif
      if (restartAt && (int32_t)(millis() - restartAt) > 0) { delay(100); restart(); }
      delay(5);
    }
  }
};

static Bridge bridge;

// Serial yerine geçen sınıf: gerçek seri porta + iPad'e yazar, iPad'den gelenleri de okur
template <typename T> class SerialProxy : public Stream {
 public:
  T &real;
  explicit SerialProxy(T &r) : real(r) {}
  template <typename... A> void begin(A... a) { real.begin(a...); }
  void end() { real.end(); }
  size_t write(uint8_t c) override { bridge.out.put(&c, 1); return real.write(c); }
  size_t write(const uint8_t *b, size_t n) override { bridge.out.put(b, n); return real.write(b, n); }
  int available() override { return real.available() + (int)bridge.in.size(); }
  int read() override { int c = real.read(); if (c >= 0) return c; uint8_t b; return bridge.in.get(&b, 1) ? b : -1; }
  int peek() override { int c = real.peek(); return c >= 0 ? c : bridge.in.peek(); }
  void flush() override { real.flush(); }
  operator bool() { return true; }
  using Print::write;
};

}  // namespace vsipad

static vsipad::SerialProxy<decltype(Serial)> VSiPadSerial(Serial);

// setup()/loop() sarmalayıcıları: köprü, kullanıcının setup()'ından önce başlar
void __vsUserSetup();
void __vsUserLoop();
void setup() {
  using namespace vsipad;
  if (crashMagic != 0x56534950) { crashMagic = 0x56534950; crashCount = 0; }
  esp_reset_reason_t r = esp_reset_reason();
  if (r == ESP_RST_PANIC || r == ESP_RST_INT_WDT || r == ESP_RST_TASK_WDT || r == ESP_RST_WDT) crashCount++; else crashCount = 0;
  bridge.safeMode = crashCount >= 3;
  bridge.begin();
  if (!bridge.safeMode) __vsUserSetup();
}
void loop() {
  if (vsipad::bridge.safeMode) { delay(100); return; }
  __vsUserLoop();
}
#define setup __vsUserSetup
#define loop __vsUserLoop
#ifdef Serial
#undef Serial
#endif
#define Serial VSiPadSerial
