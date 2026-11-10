# VS iPad

🇬🇧 **English** · 🇹🇷 [Türkçe](README.tr.md)

VS Code for iPad. It runs the real VS Code editor engine (Monaco) inside, and the UI copies the Dark Modern layout one to one.

Why I built it: during exam week all I'd have was my iPad, and I needed to **compile and run
C/C++ without internet**. So I sat down and wrote it.
Then it grew: Python, SQL, GitHub, flashing ESP32 / Pico boards with **just a cable and an iPad**...

> The app UI defaults to Turkish; English can be selected in settings (not everything is translated yet).

## 🙋 Help wanted

This is a one-person student project, so any help means a lot. Especially:

- **Debugger:** breakpoints and stepping on the clang/WASM side
- **English UI:** there are `this.L('tr', 'en')` calls, but not everything is translated
- **Making online-only languages work offline** (Java, Rust…)
- **USB-serial boards** (CP2102 / CH340): is there any way on iPadOS?
- **Testing:** different iPad models / iPadOS versions, bug reports

How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md)

## Installation (needs a Mac + Xcode)

1. Open `VSiPad.xcodeproj` in Xcode.
2. In **Signing & Capabilities**, pick your own Team and change the Bundle ID
   (the repo uses `com.example.vsipad` as a placeholder; `VSiPad.entitlements` and `sharedSuffix` in `Bridge.swift` must match).
3. Connect the iPad with a cable. **Settings › Privacy & Security › Developer Mode** must be on.
4. Select the iPad as the run destination and press ▶ Run.
5. **The iPad needs internet on first launch.** The editor (~5 MB) is downloaded. Then tap **Download**
   on the "download for offline use" notification (editor + Python, ~15 MB).
   To check, look at the "Offline" section in the Run panel: both lines should show ✔.

> ⚠️ **Signing expires:** an app installed with a free Apple ID stops opening after **7 days**.
> Reinstalling also needs a Mac. With a paid Developer account it's 1 year.
>
> Build and install from the terminal (without opening Xcode):
> ```bash
> cd vs-ipad && xcodebuild -project VSiPad.xcodeproj -scheme "VS iPad" -destination 'id=<IPAD_UDID>' -derivedDataPath build -allowProvisioningUpdates build && xcrun devicectl device install app --device <IPAD_UDID> "build/Build/Products/Debug-iphoneos/VS iPad.app"
> ```
> Xcode reuses the old profile until a few days before it expires; if you want the full 7 days,
> move the `com.example.vsipad` profile out of
> `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` and build again.

## What works

| Language | How | Internet |
|---|---|---|
| **C** | **clang** (LLVM, WebAssembly, `Web/clang/`) or the built-in interpreter `vsipad-cc` (`Web/c-interp.js`, errors with line numbers) | ❌ not needed |
| **C++** | **clang++** (with STL, WebAssembly) | ❌ not needed |
| Python 3.12 | Pyodide (WebAssembly), on the iPad | ❌ not needed |
| C / C++ (online) | Real GCC (Wandbox, falls back to Compiler Explorer) – from the ⌄ menu next to ▷ | ✅ |
| Java | OpenJDK (online) | ✅ |
| C# | .NET / Mono (online) | ✅ |
| Rust | rustc, edition 2021 (Wandbox / Compiler Explorer) | ✅ |
| SQL | SQLite 3 (sql.js, WebAssembly), on the iPad | ❌ |
| JavaScript | Inside the app | ❌ |
| HTML | Preview | ❌ |

- **Run:** ▷ button, `⌘↵` or `F5`. Stop: `⇧F5`.
- **Input:** Python's `input()` asks interactively in the terminal. If a C/C++/Java/C# program uses
  `scanf`/`cin`/`Scanner`, input is requested in the terminal; finish with ⌃D or **Send**.
  You can also type it into the stdin box in the Run panel beforehand.
- **Multi-file projects:** `.h`/`.c`/`.cpp`/`.java` files and `.txt`/`.csv` data files in the same
  folder are added automatically (example: `Örnekler/linked_list`).
- **Errors:** compiler errors go to the Problems panel and get a red underline in the editor.
- **Terminal:** `ls cd cat mkdir rm mv`, `gcc a.c && ./a.out`, `javac Main.java && java Main`,
  `python3` (REPL), `help`.
- **Files:** Files app › On My iPad › VS iPad. To work in a folder on iCloud Drive,
  use File › Open Folder.
- Command palette `⇧⌘P`, go to file `⌘P`, search `⇧⌘F`, sidebar `⌘B`, panel `⌘J`,
  terminal ``⌃` ``.
- **SQL:** a `.sql` file runs with ⌘↵ on a fresh empty database each time, results are printed as
  tables, and the failing line goes to Problems. Put `-- @db school.db` on the first line to save
  to that file. In the terminal: `sqlite3 [file.db]` → `.tables`, `.schema`, `.read x.sql`.

## Color themes
VS Code's 23 built-in themes (Dark 2026, Dark Modern, Dark+, Light+, Monokai, Solarized,
Abyss, Kimbie, Red, Tomorrow Night Blue, Quiet Light, High Contrast, Visual Studio…)
live in `Web/ext/themes.json`. **⌘K ⌘T** (or View › Color Theme) previews them live with the arrow keys.
The **Color Theme Editor** (View › Customize Color Theme) lets you change syntax and UI colors
one by one, save as a new theme, or export to JSON.
Drop another VS Code theme's `.json` into the folder and use **Import Color Theme**.

## GitHub (Source Control)
There's no `git` on iPad; the GitHub REST API is used instead. Source Control icon → **Sign in to GitHub**:
github.com → Settings → Developer settings → Personal access tokens → **Fine-grained** →
Repository access: *All repositories* → Permissions: **Contents** and **Administration**
(*Read and write*). The token is stored in the Keychain.
- **Publish to GitHub:** turns a folder into a new (private/public) repo.
- **Clone a repo / Link a folder to an existing repo.**
- Changed files (M/U/D) are listed and colored in the Explorer; tap a file to open the diff view.
- Write a message → **Commit and Push** (⌘↵). **Pull** downloads changes from GitHub; if both
  sides changed, the iPad version is kept and you get a warning. `.gitignore` is respected.

## AI: Claude and Gemini · AG
There are two separate panels in the activity bar, each with its own chat history, model and settings:
- **✨ Claude** (⌃⌘I) – Anthropic. Key: console.anthropic.com › API Keys (paid, separate from a Pro subscription).
- **★ Gemini · AG** (⌃⌘G) – Google Gemini (the models in Antigravity). Key: aistudio.google.com › Get API key (free quota).

Both have the same agent features:
- In **Agent** mode it reads and edits files, and compiles and runs them with `run_file`. Every edit and
  run asks for approval (you can see the diff) and can be reverted with **Undo**. **Ask** mode is read-only.
- The active file, selected text and the Problems list are sent as context. The model list is fetched live from the API.
- Keys are stored in the Keychain. Needs internet.

## Notes (Obsidian-style) and PDF
- `.md` files open in **reading view** (⌘E toggles edit ↔ read): `[[wikilink]]`,
  `[[note|alias]]`, `[[note#heading]]`, `![[embed]]` (note, image, PDF), callouts (`> [!note]`),
  KaTeX (`$…$`, `$$…$$`), `==highlight==`, `#tag`, clickable task checkboxes, properties (frontmatter),
  Mermaid diagrams, highlighted code blocks and **backlinks**. Clicking a missing note creates it.
- Open your Obsidian vault with **File › Open Folder** (iCloud Drive / Google Drive).
- **PDF viewer:** pages, zoom (pinch / buttons), go to page, text selection,
  search inside the PDF; remembers the last page. Images open in a tab too.
- Libraries (markdown-it, KaTeX, pdf.js, Mermaid) are downloaded on first use, then work offline.

### "Ask Claude" (no API key needed)
The ✨ button at the top right of the editor, or **AI › Ask Claude** (⌃⌘K): type your question. The active file,
the selection, the Problems list and the last terminal output are **copied to the clipboard** as one message,
then the **Claude app** opens (or claude.ai if it isn't installed). Paste with ⌘V. This way your Pro
subscription is used and no API key is needed.

## ESP32 and Raspberry Pi Pico (Arduino C++, MicroPython, CircuitPython)
The **ESP32** icon in the activity bar. There are three ways to upload; you're asked each time:

| Method | Boards | Note |
|---|---|---|
| 🔌 **USB cable (UF2)** | ESP32-S3 (with TinyUF2), Raspberry Pi Pico / Pico W / Pico 2 | No other device needed, offline |
| 📶 Wi-Fi | ESP32, S3, C3 (with the VS iPad bridge) | Fast, has a serial monitor |
| 🔵 Bluetooth LE | ESP32, S3, C3 (with the bridge) | No network needed, slow |

**How the USB cable works:** iPadOS doesn't give apps USB-serial access, but it does open USB **drives** in Files.
Boards with a UF2 bootloader (`S3DKC1BOOT`, `RPI-RP2`) and CircuitPython boards (`CIRCUITPY`) show up as a
drive; VS iPad writes the `.uf2` file or `code.py` there (`VSiPad/UsbDrive.swift`).
You pick the drive once from the Files picker the first time; after that it's remembered.
- **ESP32-S3:** install TinyUF2 **once** from a Mac:
  `./tools/esp32s3-tinyuf2-kur.sh` (board connected via the UART port).
  Then plug the board into the iPad through its **USB** port. To enter UF2 mode: **hold BOOT for 2 s** while running
  (bridge feature), or **RESET → LED turns purple → BOOT**.
- **Pico:** no setup, plug it in while holding **BOOTSEL**.
- **CircuitPython (fully offline):** *Install CircuitPython on the board…* (downloads the latest release and keeps it
  in `ESP32/firmware/`) → open a `.py` → *Write to USB and Run* → written as `code.py`.
- **Classic ESP32, C3, Arduino Uno/Nano** use a USB-serial chip and have no USB drive. They can't be
  programmed from the iPad over a cable; use the wireless methods.
- **Serial output isn't visible** over the cable (iPadOS limitation). On ESP32 the bridge gives you a Wi-Fi / BLE serial monitor.

Details:
- **Arduino:** ▷ on an `.ino` file → the code is compiled with **GitHub Actions** in the GitHub repo linked to
  the ESP32 folder (arduino-cli + esp32 3.0.7 or the rp2040 core, free) → `app.bin` / `app.uf2`
  is downloaded → uploaded to the board via USB (UF2), Wi-Fi (`POST /update`) or BLE.
  Errors go to the Problems panel. Libraries: add `// @lib Library Name` to the sketch.
- **MicroPython:** a `.py` file is written to the board and run over WebREPL (Wi-Fi) or the BLE UART REPL;
  no compiling or internet needed.
- **Serial monitor:** the **SERİ MONİTÖR** (serial monitor) tab in the bottom panel (timestamps, line ending choice, Ctrl-C).
- **First-time setup (once, from a Mac over a cable):** ESP32 › *Prepare bridge firmware…* and the in-app
  guides. The on-board bridge: `Web/esp32/VSiPad.h` (Arduino; added to every sketch automatically, safe mode
  after a crash) and `Web/esp32/micropython/` (boot.py + vsipad_ble.py).
- The GitHub token also needs the **Workflows: Read and write** permission.

## Project structure

```
VSiPad/
├── VSiPad.xcodeproj
├── Info.plist                  Files app sharing
├── VSiPad/                     Swift (Xcode syncs this folder automatically)
│   ├── App.swift               SwiftUI entry point
│   ├── EditorWebView.swift     WKWebView + alert/prompt dialogs
│   ├── AppSchemeHandler.swift  vscpad:// → Web/ folder + CDN cache + stdin bridge
│   ├── Bridge.swift            JS ↔ Swift: file system, settings, HTTP, folder picker, clipboard
│   ├── UsbDrive.swift          picking and writing USB drives (UF2 / CIRCUITPY)
│   ├── Device.swift            Bluetooth LE / TCP / WebSocket (ESP32)
│   ├── PDFNotebook.swift       PDF note-taking with Apple Pencil
│   └── Assets.xcassets
├── tools/
│   └── esp32s3-tinyuf2-kur.sh  TinyUF2 for ESP32-S3 (once, on a Mac)
└── Web/                        UI (added to Xcode as a blue folder reference)
    ├── index.html              VS Code skeleton
    ├── workbench.css           Dark Modern colors
    ├── workbench.js            Explorer, tabs, terminal, compilers, commands
    ├── c-interp.js             Built-in C compiler (C → JS, runs in a worker)
    ├── extensions.js           Turkish translation, Material icons, pets, Better Comments
    ├── themes.js               VS Code themes, live preview, theme editor
    ├── git.js                  GitHub: clone / commit+push / pull (REST Git Data API)
    ├── agent.js                Claude and Gemini · AG agent panels (tools, approval, undo)
    ├── clang/, clang-worker.js clang / clang++ (WebAssembly) + WASI runner
    ├── esp32.js, esp32/        ESP32 / Pico extension, VSiPad.h bridge, GitHub Actions workflow
    ├── obsidian.js             Markdown reading view, PDF / image viewer
    ├── ext/                    Assets copied from VS Code extensions (MIT)
    └── py-worker.js            Pyodide Python runner
```

- To change the UI, edit the files in `Web/` and Run again.
- To debug, open **Safari › Develop › [iPad] › VS iPad** on a Mac.
  Web Inspector shows the JS console.
- For a quick preview on a Mac, run `python3 -m http.server` in the `Web/` folder and
  open it in a browser. This mode uses a fake file system.

## Limitations

- Java/C#/Rust (and the optional online gcc) are compiled online: the program and its input are sent to wandbox.org / godbolt.org.
- The USB cable only works with UF2 / CircuitPython boards; USB-serial boards (CP2102, CH340, 16U2) aren't supported.
- The GitHub integration works with a single branch (the default branch); no branch/merge/rebase.
- The AI panels (Claude / Gemini) send code and file contents to the provider you choose (Anthropic / Google).
- Menus (File, Edit, Run…) are in the iPadOS menu bar at the top; there's no in-window menu.
- Online programs aren't interactive: input is collected up front and output arrives when the program finishes.
- No debugger (breakpoints) and no VS Code Marketplace extensions.
- In ESP32 setup mode, the Wi-Fi the board opens has the default password `vsipad123` (a public value).
  This mode turns off once the board joins your own network; change `VSIPAD_AP_PASSWORD` in `VSiPad.h` if you like.

## License

The project's own code is [MIT](LICENSE). Bundled third-party files (LLVM/clang, Material
Icon Theme, vscode-pets, VS Code themes…) come with their own licenses:
[THIRD_PARTY.md](THIRD_PARTY.md).
