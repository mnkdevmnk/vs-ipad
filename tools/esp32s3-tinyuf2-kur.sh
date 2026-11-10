#!/usr/bin/env bash
# VS iPad – ESP32-S3'e TinyUF2 kurulumu (Mac'te, kart başına BİR KEZ)
#
# Sonrasında kart iPad'e sadece kabloyla takılarak programlanır:
#   RESET → LED mor yanınca BOOT  ⇒  kart "S3DKC1BOOT" USB belleği olarak açılır,
#   VS iPad .uf2 dosyasını oraya yazar.
#
# Kullanım:
#   ./tools/esp32s3-tinyuf2-kur.sh                 # DevKitC-1 (8 MB flash ve üstü)
#   ./tools/esp32s3-tinyuf2-kur.sh /dev/cu.usbserial-10
#   KART=espressif_esp32s3_devkitc_1_n32r16 ./tools/esp32s3-tinyuf2-kur.sh
#   SILME=0 …                                                               # flash'ı silmeden yaz
#
# Kartı Mac'e "UART" yazan porttan bağla. Bağlanmazsa: BOOT basılı tut, RESET'e bas, BOOT'u bırak.
set -euo pipefail

KART="${KART:-espressif_esp32s3_devkitc_1}"
SILME="${SILME:-1}"
DIR="$HOME/Desktop/tinyuf2"

# 1) esptool
if command -v esptool >/dev/null 2>&1; then ESPTOOL=esptool
elif command -v esptool.py >/dev/null 2>&1; then ESPTOOL=esptool.py
else
  echo "→ esptool kuruluyor (Homebrew)…"
  brew install esptool
  ESPTOOL=$(command -v esptool || command -v esptool.py)
fi

# 2) seri port
PORT="${1:-}"
if [ -z "$PORT" ]; then
  PORT=$(ls /dev/cu.usbserial* /dev/cu.wchusbserial* /dev/cu.SLAB_USBtoUART* /dev/cu.usbmodem* 2>/dev/null | head -1 || true)
fi
if [ -z "$PORT" ]; then
  echo "✖ Kart bulunamadı. Kabloyu kartın UART portuna tak (veri kablosu olmalı) ve tekrar dene."
  echo "  Görünen portlar:"; ls /dev/cu.* 2>/dev/null | sed 's/^/    /'
  exit 1
fi
echo "→ Port: $PORT"

# 3) en son TinyUF2 sürümü
VER=$(curl -fsSL https://api.github.com/repos/adafruit/tinyuf2/releases/latest | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')
ZIP="tinyuf2-$KART-$VER.zip"
mkdir -p "$DIR"
if [ ! -f "$DIR/$ZIP" ]; then
  echo "→ İndiriliyor: $ZIP"
  curl -fL -o "$DIR/$ZIP" "https://github.com/adafruit/tinyuf2/releases/download/$VER/$ZIP"
fi
rm -rf "$DIR/$KART"; mkdir -p "$DIR/$KART"
unzip -q -o "$DIR/$ZIP" -d "$DIR/$KART"
BIN="$DIR/$KART/combined.bin"
[ -f "$BIN" ] || { echo "✖ combined.bin bulunamadı ($DIR/$KART)"; exit 1; }

# 4) yaz
if [ "$SILME" = "1" ]; then
  echo "→ Flash siliniyor (eski çizim ve Wi-Fi ayarları gider)…"
  "$ESPTOOL" --chip esp32s3 --port "$PORT" erase_flash
fi
echo "→ TinyUF2 $VER yazılıyor…"
"$ESPTOOL" --chip esp32s3 --port "$PORT" -b 460800 write_flash 0x0 "$BIN"

cat <<EOF

✔ Bitti: TinyUF2 $VER kuruldu ($KART).
  Şimdi:
  1. Kabloyu kartın "USB" portuna tak (iPad'e ya da Mac'e).
  2. RESET'e bas, LED mor yanınca BOOT'a bas → S3DKC1BOOT belleği açılır.
  3. iPad'de VS iPad › ESP32 › .ino için ▷ › "USB kablo (UF2)"
     ya da "CircuitPython'u karta kur…".
EOF
