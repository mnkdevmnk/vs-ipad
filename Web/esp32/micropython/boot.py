# VS iPad – MicroPython köprüsü (ESP32 / ESP32-S3 / C3)
# Bu dosyayı bir kez Mac'ten karta "boot.py" olarak kopyala (Thonny veya viper-ide.org).
# Sonra VS iPad, Wi-Fi (WebREPL) ya da Bluetooth (BLE UART) ile dosya yükler ve çıktıyı gösterir.
#
# Wi-Fi ayarı: VS iPad › ESP32 › Wi-Fi ayarla  (wifi.json dosyasını yazar)
# Ayar yoksa kart kendi ağını açar:  VSiPad-<isim>  şifre: vsipad123  adres: 192.168.4.1
import gc, json, network, time

CFG = {'name': 'esp32', 'ssid': '', 'pass': '', 'repl_pass': 'vsipad', 'ble': True}
try:
    with open('wifi.json') as f:
        CFG.update(json.load(f))
except Exception:
    pass

def _wifi():
    if CFG['ssid']:
        sta = network.WLAN(network.STA_IF)
        sta.active(True)
        try:
            sta.config(dhcp_hostname='vsipad-' + CFG['name'])
        except Exception:
            pass
        sta.connect(CFG['ssid'], CFG['pass'])
        for _ in range(60):
            if sta.isconnected():
                return 'Wi-Fi: %s  IP %s' % (CFG['ssid'], sta.ifconfig()[0])
            time.sleep_ms(200)
        sta.active(False)
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    ap.config(essid='VSiPad-' + CFG['name'], password='vsipad123', authmode=3)
    return 'Wi-Fi ağı: VSiPad-%s (şifre vsipad123)  IP %s' % (CFG['name'], ap.ifconfig()[0])

_msg = _wifi()
try:
    import webrepl
    webrepl.start(password=CFG['repl_pass'])
except Exception as e:
    print('WebREPL başlatılamadı:', e)

if CFG.get('ble'):
    try:
        import vsipad_ble
        vsipad_ble.start('VSiPad-' + CFG['name'])
        _msg += '  ·  BLE: VSiPad-' + CFG['name']
    except Exception as e:
        print('BLE REPL başlatılamadı:', e)

print('[VS iPad] MicroPython köprüsü hazır ·', _msg)
gc.collect()
