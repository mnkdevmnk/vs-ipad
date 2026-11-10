# Katkı rehberi / Contributing

Selam! Katkı vermeyi düşündüğün için sağ ol. Kurallar basit:

## Başlamadan
- Büyük bir şey yapacaksan önce bir **issue** aç, konuşalım. Boşa emek gitmesin.
- Küçük düzeltmeler (yazım hatası, ufak bug) için direkt PR at.
- Türkçe ya da İngilizce yazabilirsin. / Feel free to write in English.

## Geliştirme ortamı
1. Mac + Xcode lazım. `VSiPad.xcodeproj`'yi aç, kendi Team ve Bundle ID'ni gir (bkz. README › Kurulum).
2. Arayüzün tamamı `Web/` altında düz JS/CSS. Build adımı yok, framework yok.
3. iPad olmadan hızlıca denemek için:
   ```bash
   cd Web && python3 -m http.server 8000
   ```
   Tarayıcıda `http://localhost:8000` aç. Bu modda sahte bir dosya sistemi kullanılır.
4. iPad'de hata ayıklama: Mac'te **Safari › Geliştir › [iPad] › VS iPad**.

## PR atarken
- Bir PR = bir konu. Alakasız değişiklikleri karıştırma.
- iPad'de (ya da en azından Safari'de) denedim diye bir satır yaz, ekran görüntüsü varsa süper.
- **Asla** token, API anahtarı, Wi-Fi şifresi commit'leme. Anahtarlar uygulamada Anahtar Zinciri'nde durur.
- `Web/ext/` ve `Web/clang/` üçüncü parti dosyalar, elle düzenleme. Güncelleme gerekiyorsa issue aç.

## Kod stili
- 2 boşluk girinti (JS), 4 boşluk (Swift).
- Yorumlar Türkçe ya da İngilizce olabilir; kısa tut, *neden*'i anlat.
- Kullanıcıya görünen metinler `this.L('türkçe', 'english')` ile iki dilli yazılır.

## Hata bildirirken
iPad modeli, iPadOS sürümü, ne yaptın, ne bekledin, ne oldu. Safari konsolundaki hata varsa ekle.
