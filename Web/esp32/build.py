#!/usr/bin/env python3
"""VS iPad – ESP32 / RP2040 çizimini arduino-cli ile derler (GitHub Actions içinde)."""
import json, os, re, shutil, subprocess, sys, time

SHA = os.environ.get('SHA', 'local')
ROOT = os.getcwd()
OUT = os.path.join(ROOT, 'vsipad-out')
os.makedirs(os.path.join(OUT, SHA), exist_ok=True)
DEFAULT_FQBN = 'esp32:esp32:esp32s3:CDCOnBoot=cdc,PartitionScheme=min_spiffs'
result = {'sha': SHA, 'ok': False, 'log': '', 'time': int(time.time())}

def finish(code):
    with open(os.path.join(OUT, SHA + '.json'), 'w') as f:
        json.dump(result, f, ensure_ascii=False)
    print(result['log'][-4000:])
    sys.exit(0)  # derleme hatası iş akışını kırmasın; sonuç JSON'da

try:
    target = json.load(open('.vsipad/target.json', encoding='utf-8'))
except Exception as e:
    result['log'] = f'.vsipad/target.json okunamadı: {e}'; finish(1)

sketch = target['sketch']                      # ör. ESP32/Blink/Blink.ino
fqbn = target.get('fqbn') or DEFAULT_FQBN
src_dir = os.path.dirname(os.path.join(ROOT, sketch)) or ROOT
name = os.path.splitext(os.path.basename(sketch))[0]
result.update({'sketch': sketch, 'fqbn': fqbn, 'nonce': target.get('nonce')})

# geçici çizim klasörü: arduino-cli klasör adı = .ino adı ister
work = os.path.join('/tmp/vsipad', name)
shutil.rmtree('/tmp/vsipad', ignore_errors=True)
os.makedirs(work)
main_src = open(os.path.join(ROOT, sketch), encoding='utf-8', errors='replace').read()
for fn in os.listdir(src_dir):
    p = os.path.join(src_dir, fn)
    if os.path.isfile(p) and re.search(r'\.(ino|h|hpp|c|cpp|S)$', fn) and fn != os.path.basename(sketch) and fn != 'VSiPad.h':
        if fn.endswith('.ino'): continue  # başka çizimler (aynı klasörde birden fazla .ino) karışmasın
        shutil.copy(p, work)
is_esp = fqbn.startswith('esp32:')   # köprü (Wi-Fi/BLE) sadece ESP32 çekirdeğinde
if is_esp:
    shutil.copy(os.path.join(ROOT, '.github/vsipad/VSiPad.h'), work)
inject = is_esp and not re.search(r'^\s*#\s*include\s*["<]VSiPad\.h[">]', main_src, re.M)
src = ('#include "VSiPad.h"\n#line 1\n' if inject else '') + main_src
open(os.path.join(work, name + '.ino'), 'w', encoding='utf-8').write(src)

log = []
def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    log.append('$ ' + ' '.join(cmd) + '\n' + p.stdout + p.stderr)
    return p.returncode

# kütüphaneler:  // @lib DHT sensor library   veya  target.json "libraries"
libs = list(target.get('libraries') or []) + re.findall(r'^\s*//\s*@lib\s+(.+?)\s*$', main_src, re.M)
for lib in libs:
    run(['arduino-cli', 'lib', 'install', lib])

open(os.path.join(work, 'vsipad_build.h'), 'w').write(f'#define VSIPAD_BUILD_ID "{SHA[:7]}"\n')
build_dir = os.path.join('/tmp/vsipad-build')
rc = run(['arduino-cli', 'compile', '--fqbn', fqbn, '--warnings', 'default', '--export-binaries',
          '--output-dir', build_dir, work])
text = '\n'.join(log)
# yolları kaynak dosyalara geri çevir
text = text.replace(work + '/', os.path.dirname(sketch) + '/' if os.path.dirname(sketch) else '')
result['log'] = text[-60000:]
if rc != 0:
    finish(1)

bins = {f: os.path.join(build_dir, f) for f in os.listdir(build_dir)}
app = next((v for k, v in bins.items() if k.endswith('.ino.bin')), None)
merged = next((v for k, v in bins.items() if k.endswith('.merged.bin')), None)
uf2 = next((v for k, v in bins.items() if k.endswith('.ino.uf2')), None)   # RP2040 çekirdeği doğrudan üretir
if not app:
    result['log'] += '\nÇıktı .bin bulunamadı: ' + ', '.join(bins); finish(1)
shutil.copy(app, os.path.join(OUT, SHA, 'app.bin'))
if merged: shutil.copy(merged, os.path.join(OUT, SHA, 'merged.bin'))
if uf2: shutil.copy(uf2, os.path.join(OUT, SHA, 'app.uf2'))
m = re.search(r'Sketch uses (\d+) bytes \((\d+)%\)', text)
result.update({'ok': True, 'size': os.path.getsize(app), 'percent': int(m.group(2)) if m else None,
               'files': ['app.bin'] + (['merged.bin'] if merged else []) + (['app.uf2'] if uf2 else [])})
finish(0)
