/* ==========================================================================
   VS iPad – AG Claude (yapay zekâ ajanı)
   Antigravity tarzı ajan paneli: Claude (Anthropic) + Gemini (Google).
   Ajan çalışma alanındaki dosyaları okuyabilir, düzenleyebilir, kodu çalıştırıp
   çıktıya bakabilir. Dosya değiştiren ve kod çalıştıran her adım onay ister
   (Ayarlar › Otomatik onay ile kapatılabilir) ve geri alınabilir.
   API anahtarları iPad'in Anahtar Zinciri'nde saklanır.
   ========================================================================== */
(function () {
'use strict';
window.VSCModules = window.VSCModules || [];

const ANTHROPIC = 'https://api.anthropic.com/v1';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODELS = {
  claude: [
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }
  ],
  gemini: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }
  ]
};
const MAX_STEPS = 30;
const MAX_TOOL_OUT = 14000;
const IGNORE_DIR = /(^|\/)(\.git|node_modules|__pycache__|\.build|DerivedData)(\/|$)/;

const TOOLS = [
  { name: 'list_files', write: false, description: 'Çalışma alanındaki dosyaları listeler (yol + boyut). İsteğe bağlı bir klasörle sınırlandırılabilir.',
    params: { path: { type: 'string', description: 'Klasör yolu (boş = tüm çalışma alanı)' } }, required: [] },
  { name: 'read_file', write: false, description: 'Bir metin dosyasının içeriğini okur. Büyük dosyalarda start_line/end_line kullan.',
    params: { path: { type: 'string', description: 'Çalışma alanına göre dosya yolu' }, start_line: { type: 'integer', description: '1 tabanlı başlangıç satırı' }, end_line: { type: 'integer', description: 'Bitiş satırı (dahil)' } }, required: ['path'] },
  { name: 'write_file', write: true, description: 'Dosya oluşturur veya içeriğini tamamen değiştirir. Küçük değişiklikler için edit_file tercih et.',
    params: { path: { type: 'string', description: 'Dosya yolu' }, content: { type: 'string', description: 'Dosyanın yeni tam içeriği' } }, required: ['path', 'content'] },
  { name: 'edit_file', write: true, description: 'Dosyada old_string metnini new_string ile değiştirir. old_string dosyada birebir (boşluklar dahil) ve tek bir kez geçmeli; gerekirse çevresindeki satırları da ekleyerek benzersiz yap.',
    params: { path: { type: 'string', description: 'Dosya yolu' }, old_string: { type: 'string', description: 'Değiştirilecek mevcut metin' }, new_string: { type: 'string', description: 'Yeni metin' }, replace_all: { type: 'boolean', description: 'Tüm geçişleri değiştir' } }, required: ['path', 'old_string', 'new_string'] },
  { name: 'run_file', write: true, description: 'Bir kaynak dosyayı derleyip çalıştırır (C, C++, Java, C#, Python, Rust, SQL, JavaScript) ve terminal çıktısını, çıkış kodunu, derleme hatalarını döndürür. Program girdi okuyorsa stdin ver (satırlar \\n ile).',
    params: { path: { type: 'string', description: 'Çalıştırılacak dosya' }, stdin: { type: 'string', description: 'Programın standart girdisi' }, args: { type: 'array', items: { type: 'string' }, description: 'Komut satırı argümanları' } }, required: ['path'] },
  { name: 'search', write: false, description: 'Çalışma alanındaki metin dosyalarında arama yapar; eşleşen satırları dosya:satır biçiminde döndürür.',
    params: { query: { type: 'string', description: 'Aranacak metin veya düzenli ifade' }, regex: { type: 'boolean', description: 'query düzenli ifade mi' }, path: { type: 'string', description: 'Sadece bu klasörde ara' } }, required: ['query'] },
  { name: 'get_problems', write: false, description: 'Problems panelindeki derleme/çalışma hatalarını ve editörde açık dosyayı, imleç konumunu, seçili metni döndürür.',
    params: {}, required: [] }
];

function schemaFor(t) { return { type: 'object', properties: t.params, required: t.required }; }
function geminiSchema(t) {
  const conv = (p) => { const o = { type: p.type.toUpperCase(), description: p.description }; if (p.items) o.items = conv(p.items); return o; };
  const props = {}; for (const [k, v] of Object.entries(t.params)) props[k] = conv(v);
  return Object.keys(props).length ? { type: 'OBJECT', properties: props, required: t.required } : undefined;
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function trunc(s, n = MAX_TOOL_OUT) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + `\n… (${s.length - n} karakter kesildi)` : s; }
function lineDiffStat(a, b) {
  const A = (a || '').split('\n'), B = (b || '').split('\n');
  const cnt = new Map(); A.forEach((l) => cnt.set(l, (cnt.get(l) || 0) + 1));
  let add = 0; B.forEach((l) => { const c = cnt.get(l) || 0; if (c) cnt.set(l, c - 1); else add++; });
  let del = 0; cnt.forEach((c) => { del += c; });
  return { add, del };
}

const AgentProto = {
  ctx: null,
  get S() {
    const k = this.cfg.settingsKey, SET = this.ctx.SET;
    if (!SET[k]) SET[k] = { model: '', autoApprove: false, mode: 'agent' };
    SET[k].provider = this.cfg.provider;
    return SET[k];
  },
  get title() { return this.cfg.title; },
  tr() { return this.ctx.SET.lang !== 'en'; },
  L(a, b) { return this.tr() ? a : b; },

  async init() {
    const C = this.ctx;
    try { this.keys.claude = await C.native('secret.get', { key: 'ai.anthropic' }); } catch (e) {}
    try { this.keys.gemini = await C.native('secret.get', { key: 'ai.gemini' }); } catch (e) {}
    try { const s = await C.native('kv.get', { key: this.cfg.chatsKey }); this.chats = s ? JSON.parse(s) : []; } catch (e) { this.chats = []; }
    this.chat = this.chats[0] && !this.chats[0].done ? this.chats[0] : null;
    this.render();
    const p = this.cfg.provider; if (this.keys[p]) this.loadModels(p).then(() => this.render()).catch(() => {});
  },
  focus() { this.render(); setTimeout(() => { const t = document.getElementById(this.id + 'Text'); if (t && !this.ctx.IS_NATIVE) t.focus(); }, 60); },
  hasKey() { return !!this.keys[this.cfg.provider]; },
  modelId() {
    const p = this.S.provider;
    if (this.S.model && (this.S.modelProvider || p) === p) return this.S.model;
    const list = this.models[p] || FALLBACK_MODELS[p];
    const pref = p === 'claude' ? /sonnet/i : /flash/i;
    const stable = list.filter((m) => pref.test(m.id) && !/preview|exp|lite|thinking|-\d{3,}$/i.test(m.id))
      .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
    return (stable[0] || list[0] || FALLBACK_MODELS[p][0]).id;
  },
  modelName() {
    const id = this.modelId();
    const list = this.models[this.S.provider] || FALLBACK_MODELS[this.S.provider];
    const m = list.find((x) => x.id === id);
    return m ? m.name : id;
  },
  saveChats: (() => { let t; return function () { clearTimeout(t); t = setTimeout(() => {
    let list = this.chats.slice(0, 15);
    let json = JSON.stringify(list);
    while (json.length > 1500000 && list.length > 1) { list = list.slice(0, -1); json = JSON.stringify(list); }
    this.ctx.native('kv.set', { key: this.cfg.chatsKey, value: json });
  }, 500); }; })(),

  // ------------------------------------------------------------ ayarlar
  async setKey(provider) {
    const C = this.ctx;
    const info = provider === 'claude'
      ? this.L('Anthropic API anahtarını yapıştır (sk-ant-…). Almak için: console.anthropic.com → API Keys → Create Key. (Kullanım ücretlidir, Claude Pro aboneliğinden ayrıdır.)', 'Paste your Anthropic API key (sk-ant-…) from console.anthropic.com → API Keys.')
      : this.L('Gemini API anahtarını yapıştır. Almak için: aistudio.google.com → Get API key → Create API key. (Ücretsiz kotası vardır.)', 'Paste your Gemini API key from aistudio.google.com → Get API key.');
    const v = await C.inputBox({ title: provider === 'claude' ? 'Claude (Anthropic)' : 'Gemini (Google)', prompt: info, value: '' });
    if (v == null) return false;
    const key = v.trim();
    await C.native('secret.set', { key: provider === 'claude' ? 'ai.anthropic' : 'ai.gemini', value: key || null });
    this.keys[provider] = key || null;
    this.models[provider] = null;
    if (key) {
      this.S.model = ''; C.saveSettings();
      const n = C.notify('info', this.L('Anahtar kontrol ediliyor…', 'Checking key…'), { timeout: 0 });
      try { await this.loadModels(provider, true); n.close(); C.notify('success', this.L('Hazır ✓  Model: ', 'Ready ✓  Model: ') + this.modelName()); }
      catch (e) { n.close(); C.notify('error', this.L('Anahtar doğrulanamadı: ', 'Key check failed: ') + e.message); }
    }
    this.render();
    return !!key;
  },
  async openSettings() {
    const C = this.ctx, S = this.S;
    const items = [
      ...[this.cfg.provider].map((p) => ({ label: (this.keys[p] ? '✓ ' : '') + (p === 'claude' ? 'Claude' : 'Gemini') + this.L(' API anahtarı…', ' API key…'), desc: this.keys[p] ? '••••' + this.keys[p].slice(-4) : this.L('ayarlanmadı', 'not set'), run: () => this.setKey(p) })),
      { label: this.L('Model seç…', 'Select model…'), desc: this.modelName(), run: () => this.pickModel() },
      { label: this.L('Otomatik onay', 'Auto-approve'), desc: S.autoApprove ? this.L('açık – dosya düzenleme ve çalıştırma sormadan yapılır', 'on') : this.L('kapalı – her değişiklik onay ister', 'off'), run: () => { S.autoApprove = !S.autoApprove; C.saveSettings(); this.render(); C.notify('info', this.L('Otomatik onay: ', 'Auto-approve: ') + (S.autoApprove ? this.L('açık', 'on') : this.L('kapalı', 'off')), { timeout: 2000 }); } },
      { label: this.L('Ek talimatlar (her sohbete eklenir)…', 'Custom instructions…'), desc: (S.instructions || '').slice(0, 40), run: async () => { const v = await C.inputBox({ prompt: this.L('Örn: "Açıklamaları Türkçe ve kısa yap, C kodunda sadece stdio.h kullan."', 'Custom instructions'), value: S.instructions || '' }); if (v != null) { S.instructions = v; C.saveSettings(); } } },
      { label: this.L('Sohbet geçmişini temizle', 'Clear chat history'), run: async () => { this.chats = []; this.chat = null; this.saveChats(); this.render(); } }
    ];
    const it = await C.quickPick(items, { placeholder: this.title });
    if (it) await it.run();
  },
  async loadModels(provider, strict) {
    const C = this.ctx;
    if (this.models[provider]) return this.models[provider];
    const key = this.keys[provider];
    if (!key) return FALLBACK_MODELS[provider];
    try {
      if (provider === 'claude') {
        const r = await C.native('http.request', { url: ANTHROPIC + '/models?limit=100', method: 'GET', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout: 30 });
        if (r.status !== 200) throw new Error(this.httpErr(r));
        const j = JSON.parse(r.body);
        this.models.claude = j.data.map((m) => ({ id: m.id, name: m.display_name || m.id }));
      } else {
        const r = await C.native('http.request', { url: GEMINI + '/models?pageSize=200', method: 'GET', headers: { 'x-goog-api-key': key }, timeout: 30 });
        if (r.status !== 200) throw new Error(this.httpErr(r));
        const j = JSON.parse(r.body);
        this.models.gemini = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/embedding|aqa|tts|image|live|audio|learnlm/i.test(m.name))
          .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
          .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
      }
      if (!this.models[provider].length) this.models[provider] = FALLBACK_MODELS[provider];
      return this.models[provider];
    } catch (e) { if (strict) throw e; return FALLBACK_MODELS[provider]; }
  },
  async pickModel() {
    const C = this.ctx;
    const items = [];
    for (const p of [this.cfg.provider]) {
      if (!this.keys[p]) { items.push({ label: (p === 'claude' ? 'Claude' : 'Gemini') + this.L(' – anahtar ekle…', ' – add key…'), sep: p === 'claude' ? 'Anthropic' : 'Google', act: 'key', p }); continue; }
      const list = await this.loadModels(p);
      list.forEach((m, i) => items.push({ label: m.name, desc: m.id, p, id: m.id, sep: i === 0 ? (p === 'claude' ? 'Anthropic Claude' : 'Google Gemini') : null, kb: p === this.S.provider && m.id === this.modelId() ? '✓' : '' }));
    }
    const it = await C.quickPick(items, { placeholder: this.L('Model seç', 'Select model') });
    if (!it) return;
    if (it.act === 'key') { await this.setKey(it.p); return; }
    this.S.model = it.id; this.S.modelProvider = it.p; C.saveSettings();
    this.render();
  },

  // ------------------------------------------------------------ sohbetler
  newChat() { this.chat = null; this.render(); this.focus(); },
  async showHistory() {
    const C = this.ctx;
    if (!this.chats.length) { C.notify('info', this.L('Henüz sohbet yok.', 'No chats yet.'), { timeout: 2000 }); return; }
    const it = await C.quickPick(this.chats.map((c) => ({ label: c.title || '…', desc: new Date(c.t).toLocaleString(this.tr() ? 'tr-TR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }), c })), { placeholder: this.L('Sohbet geçmişi', 'Chat history') });
    if (it) { this.chat = it.c; this.render(); this.scrollEnd(); }
  },
  ensureChat(firstText) {
    if (this.chat) return this.chat;
    this.chat = { id: uid(), t: Date.now(), title: firstText.slice(0, 60), provider: this.S.provider, view: [], api: [] };
    this.chats.unshift(this.chat);
    return this.chat;
  },

  // ------------------------------------------------------------ bağlam
  editorContext() {
    const C = this.ctx;
    const tab = C.Tabs.active;
    const out = { file: null, line: null, selection: '' };
    if (tab && !tab.virtual) {
      out.file = tab.path;
      const ed = C.editor();
      if (ed && C.monaco()) {
        const p = ed.getPosition(); out.line = p ? p.lineNumber : null;
        const sel = ed.getSelection();
        if (sel && !sel.isEmpty()) { out.selection = ed.getModel().getValueInRange(sel); out.selStart = sel.startLineNumber; out.selEnd = sel.endLineNumber; }
      }
    }
    return out;
  },
  contextBlock() {
    const C = this.ctx, e = this.editorContext();
    const lines = [];
    if (e.file) lines.push(`Aktif dosya: ${e.file}${e.line ? ' (imleç satır ' + e.line + ')' : ''}`);
    if (e.selection) lines.push(`Seçili metin (satır ${e.selStart}-${e.selEnd}):\n\`\`\`\n${trunc(e.selection, 6000)}\n\`\`\``);
    const probs = C.Problems.list || [];
    if (probs.length) lines.push('Problems:\n' + probs.slice(0, 20).map((d) => `${d.file}:${d.line}:${d.col} ${d.sev}: ${d.msg}`).join('\n'));
    return lines.length ? `<editor_context>\n${lines.join('\n')}\n</editor_context>\n\n` : '';
  },
  systemPrompt() {
    const C = this.ctx;
    const ws = C.Explorer.ws || {};
    const files = C.Explorer.entries.filter((e) => !e.dir && !IGNORE_DIR.test(e.path)).map((e) => e.path);
    const mode = this.S.mode === 'ask' ? 'ask' : 'agent';
    return [
      `Sen ${this.title} adlı asistansın (${this.cfg.provider === 'claude' ? 'Anthropic Claude' : 'Google Gemini'} modeli): iPad için yapılmış VS Code benzeri "VS iPad" editörünün içindeki yapay zekâ kodlama ajanısın.`,
      'Kullanıcı bir üniversite öğrencisi; sınavlara hazırlanıyor ve kodunu iPad\'de yazıyor. Kullanıcının dilinde (genelde Türkçe) cevap ver; açık, doğru ve gereksiz uzatmadan anlat. Kod açıklarken neden öyle olduğunu da söyle.',
      `Çalışma alanı: "${ws.name || 'VS iPad'}" (${files.length} dosya). Dosya yolları çalışma alanına göredir (örn. "Örnekler/merhaba.c").`,
      'Çalıştırma ortamı: C çevrimdışı yerel derleyiciyle (C17, gcc uyumlu) çalışır; C++, Java, C#, Rust online derleyicide (gerçek g++/OpenJDK/.NET/rustc) çalışır; Python yerelde Pyodide (Python 3.12) ile; SQL yerelde SQLite ile; JavaScript tarayıcıda. Aynı klasördeki .h/.c dosyaları derlemeye otomatik eklenir. Terminal ve dosya sistemi sanaldır, kabuk komutu çalıştıramazsın.',
      mode === 'agent'
        ? 'Araçları kullanarak dosyaları okuyabilir, düzenleyebilir ve kodu çalıştırabilirsin. Düzenlemeden önce ilgili dosyayı oku. Küçük değişikliklerde edit_file, yeni dosyalarda write_file kullan. Kodu değiştirdikten sonra mümkünse run_file ile çalıştırıp doğrula (girdi okuyorsa stdin ver). Kullanıcı her dosya değişikliğini ve çalıştırmayı onaylar; reddederse başka yol öner. İş bitince ne yaptığını kısaca özetle.'
        : 'Şu an "Sor" modundasın: dosyaları okuyabilir ve arayabilirsin ama değiştiremez ve çalıştıramazsın. Değişiklik önerilerini kod bloğu olarak ver.',
      'Kod bloklarında dil etiketini yaz (```c gibi). <editor_context> bloğu editörün o anki durumudur, kullanıcının yazdığı bir şey değildir.',
      this.S.instructions ? 'Kullanıcının ek talimatları: ' + this.S.instructions : '',
      'Dosyalar (ilk 150):\n' + files.slice(0, 150).join('\n')
    ].filter(Boolean).join('\n\n');
  },
  activeTools() { return this.S.mode === 'ask' ? TOOLS.filter((t) => !t.write) : TOOLS; },

  // ------------------------------------------------------------ sağlayıcılar
  httpErr(r) {
    let msg = '';
    try { const j = JSON.parse(r.body); msg = (j.error && (j.error.message || j.error.type)) || j.message || ''; } catch (e) { msg = (r.body || '').slice(0, 200); }
    const hint = r.status === 401 || r.status === 403 ? this.L(' – API anahtarını kontrol et (Ayarlar).', ' – check API key.')
      : r.status === 429 ? this.L(' – istek/kota sınırı; biraz bekle.', ' – rate limited.')
      : r.status === 529 || r.status === 503 ? this.L(' – servis yoğun, tekrar dene.', ' – overloaded.') : '';
    return `HTTP ${r.status}${msg ? ': ' + msg : ''}${hint}`;
  },
  async post(url, headers, body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let r;
      try { r = await this.ctx.native('http.request', { url, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), timeout: 300 }); }
      catch (e) { if (attempt < 2 && !this.stopFlag) { await new Promise((res) => setTimeout(res, 1500)); continue; } throw new Error(this.L('Bağlantı hatası (internet var mı?): ', 'Network error: ') + (e.message || e)); }
      if (r.status === 200) return JSON.parse(r.body);
      if ([429, 500, 502, 503, 529].includes(r.status) && attempt < 2 && !this.stopFlag) { await new Promise((res) => setTimeout(res, 2500 * (attempt + 1))); continue; }
      throw new Error(this.httpErr(r));
    }
  },
  // Claude (Anthropic Messages API) – api geçmişi Anthropic biçiminde
  async stepClaude(chat) {
    const body = {
      model: this.modelId(), max_tokens: 16000, system: this.systemPrompt(), messages: chat.api,
      tools: this.activeTools().map((t) => ({ name: t.name, description: t.description, input_schema: schemaFor(t) }))
    };
    const j = await this.post(ANTHROPIC + '/messages', { 'x-api-key': this.keys.claude, 'anthropic-version': '2023-06-01' }, body);
    chat.api.push({ role: 'assistant', content: j.content });
    const texts = [], calls = [];
    for (const b of j.content || []) {
      if (b.type === 'text' && b.text) texts.push(b.text);
      else if (b.type === 'tool_use') calls.push({ id: b.id, name: b.name, input: b.input || {} });
    }
    if (j.stop_reason === 'max_tokens' && !calls.length) texts.push(this.L('\n\n*(yanıt uzunluk sınırında kesildi – "devam et" yazabilirsin)*', '\n\n*(truncated)*'));
    return { texts, calls, usage: j.usage && (j.usage.input_tokens + j.usage.output_tokens) };
  },
  pushResultsClaude(chat, results) {
    chat.api.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output, is_error: !!r.error })) });
  },
  pushUserClaude(chat, text) { chat.api.push({ role: 'user', content: [{ type: 'text', text }] }); },
  // Gemini (generateContent) – api geçmişi Gemini biçiminde, parçalar (thoughtSignature dahil) aynen saklanır
  async stepGemini(chat) {
    const decls = this.activeTools().map((t) => { const d = { name: t.name, description: t.description }; const p = geminiSchema(t); if (p) d.parameters = p; return d; });
    const body = { systemInstruction: { parts: [{ text: this.systemPrompt() }] }, contents: chat.api, tools: [{ functionDeclarations: decls }], generationConfig: { maxOutputTokens: 16000 } };
    const j = await this.post(`${GEMINI}/models/${encodeURIComponent(this.modelId())}:generateContent`, { 'x-goog-api-key': this.keys.gemini }, body);
    const cand = (j.candidates || [])[0];
    if (!cand || !cand.content) {
      const why = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || 'boş yanıt';
      throw new Error('Gemini: ' + why);
    }
    const parts = cand.content.parts || [];
    chat.api.push({ role: 'model', parts });
    const texts = [], calls = [];
    parts.forEach((p, i) => {
      if (p.text && !p.thought) texts.push(p.text);
      if (p.functionCall) calls.push({ id: 'g' + i + uid(), name: p.functionCall.name, input: p.functionCall.args || {} });
    });
    return { texts, calls, usage: j.usageMetadata && j.usageMetadata.totalTokenCount };
  },
  pushResultsGemini(chat, results) {
    chat.api.push({ role: 'user', parts: results.map((r) => ({ functionResponse: { name: r.name, response: r.error ? { error: r.output } : { result: r.output } } })) });
  },
  pushUserGemini(chat, text) { chat.api.push({ role: 'user', parts: [{ text }] }); },
  // sağlayıcı değişirse geçmişi düz metne çevir
  convertHistory(chat, to) {
    const flat = [];
    for (const v of chat.view) {
      if (v.k === 'user') flat.push({ role: 'user', text: v.text });
      else if (v.k === 'text') flat.push({ role: 'assistant', text: v.text });
      else if (v.k === 'tool') flat.push({ role: 'assistant', text: `[${v.name} ${v.title || ''} → ${v.status}]` });
    }
    const merged = [];
    for (const m of flat) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.text += '\n\n' + m.text; else merged.push(Object.assign({}, m)); }
    if (merged.length && merged[0].role !== 'user') merged.unshift({ role: 'user', text: '(önceki sohbet)' });
    chat.api = merged.map((m) => (to === 'claude' ? { role: m.role, content: [{ type: 'text', text: m.text }] } : { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
    if (chat.api.length && (to === 'claude' ? chat.api[chat.api.length - 1].role === 'user' : chat.api[chat.api.length - 1].role === 'user')) chat.api.pop();
    chat.provider = to;
  },

  // ------------------------------------------------------------ ana döngü
  async send(text, opts = {}) {
    const C = this.ctx;
    text = (text || '').trim();
    if (!text || this.busy) return;
    const p = this.S.provider;
    if (!this.keys[p]) { if (!(await this.setKey(p))) return; }
    const chat = this.ensureChat(text);
    if (chat.provider !== p) this.convertHistory(chat, p);
    chat.t = Date.now();
    this.chats = [chat].concat(this.chats.filter((c) => c !== chat));
    chat.view.push({ k: 'user', text, file: this.editorContext().file });
    const full = this.contextBlock() + text;
    const mark = chat.api.length;
    if (p === 'claude') this.pushUserClaude(chat, full); else this.pushUserGemini(chat, full);
    this.busy = true; this.stopFlag = false;
    this.render(); this.scrollEnd();
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        this.setStatus(step ? this.L('Düşünüyor… (adım ' + (step + 1) + ')', 'Thinking… (step ' + (step + 1) + ')') : this.L('Düşünüyor…', 'Thinking…'));
        const res = p === 'claude' ? await this.stepClaude(chat) : await this.stepGemini(chat);
        if (this.stopFlag) break;
        const txt = res.texts.join('\n\n').trim();
        if (txt) chat.view.push({ k: 'text', text: txt, model: this.modelName() });
        this.render(); this.scrollEnd();
        if (!res.calls.length) break;
        const results = [];
        for (const call of res.calls) {
          if (this.stopFlag) { results.push({ id: call.id, name: call.name, output: 'Kullanıcı durdurdu.', error: true }); continue; }
          results.push(await this.execTool(chat, call));
        }
        if (p === 'claude') this.pushResultsClaude(chat, results); else this.pushResultsGemini(chat, results);
        this.saveChats();
        if (this.stopFlag) break;
        if (step === MAX_STEPS - 1) chat.view.push({ k: 'error', text: this.L('Adım sınırına ulaşıldı. Devam etmesi için "devam et" yaz.', 'Step limit reached.') });
      }
    } catch (e) {
      chat.view.push({ k: 'error', text: String(e.message || e) });
      // başarısız turu API geçmişinden çıkar (görünümde kalır) → sonraki mesaj tutarlı olsun
      chat.api.length = mark;
    } finally {
      if (this.stopFlag) { chat.view.push({ k: 'error', text: this.L('Durduruldu.', 'Stopped.') }); chat.api.length = mark; }
      this.busy = false; this.stopFlag = false;
      for (const id of Object.keys(this.pending)) { this.pending[id](false); delete this.pending[id]; }
      this.saveChats(); this.render(); this.scrollEnd();
    }
  },
  stop() { this.stopFlag = true; for (const id of Object.keys(this.pending)) { this.pending[id](false); delete this.pending[id]; } if (this.ctx.Run.running) this.ctx.Run.stop(); this.setStatus(this.L('Durduruluyor…', 'Stopping…')); },
  quick(kind) {
    const e = this.editorContext();
    if (kind === 'explain') this.send(e.selection ? this.L('Seçili kodu adım adım açıkla.', 'Explain the selected code.') : this.L(`${e.file || 'Aktif dosya'} dosyasını açıkla: ne yapıyor, nasıl çalışıyor?`, 'Explain the active file.'));
    else if (kind === 'fix') this.send(this.L(`${e.file || 'Aktif dosya'} dosyasındaki hataları bul ve düzelt, sonra çalıştırıp doğrula.`, 'Find and fix the errors in the active file, then run it.'));
  },

  // ------------------------------------------------------------ araçlar
  normPath(p) { return String(p || '').replace(/^\.?\/+/, '').replace(/\/+$/, '').replace(/^~\//, ''); },
  async readText(path) {
    const C = this.ctx;
    const tab = C.Tabs.list.find((t) => t.path === path && !t.virtual);
    if (tab) return C.Ed.getValue(tab.model);
    const r = await C.native('fs.read', { path });
    if (r.binary) throw new Error('ikili (binary) dosya okunamaz');
    return r.content;
  },
  async writeText(path, content) {
    const C = this.ctx;
    const tab = C.Tabs.list.find((t) => t.path === path && !t.virtual);
    if (tab) { C.Ed.setValue(tab.model, content); await C.Tabs.save(tab, true); }
    else await C.native('fs.write', { path, content });
    if (!C.Explorer.exists(path)) await C.Explorer.refresh();
  },
  async approve(item) {
    if (this.S.autoApprove) return true;
    item.status = 'ask';
    this.render(); this.scrollEnd();
    this.setStatus(this.L('Onay bekleniyor…', 'Waiting for approval…'));
    const ok = await new Promise((res) => { this.pending[item.id] = res; });
    delete this.pending[item.id];
    return ok;
  },
  async execTool(chat, call) {
    const C = this.ctx;
    const a = call.input || {};
    const item = { k: 'tool', id: call.id, name: call.name, input: a, status: 'run', title: '' };
    chat.view.push(item);
    const done = (output, error, extra) => { item.status = error ? 'error' : 'done'; Object.assign(item, extra || {}); if (error) item.err = String(output).slice(0, 300); this.render(); return { id: call.id, name: call.name, output: trunc(output), error: !!error }; };
    try {
      switch (call.name) {
        case 'list_files': {
          const dir = this.normPath(a.path);
          item.title = dir || this.L('çalışma alanı', 'workspace'); this.render();
          const list = C.Explorer.entries.filter((e) => !IGNORE_DIR.test(e.path) && (!dir || e.path === dir || e.path.startsWith(dir + '/')));
          const lines = list.slice(0, 600).map((e) => e.dir ? e.path + '/' : `${e.path}  (${e.size} B)`);
          return done(lines.length ? lines.join('\n') + (list.length > 600 ? `\n… +${list.length - 600}` : '') : this.L('(boş)', '(empty)'), false, { summary: `${list.length} öğe` });
        }
        case 'read_file': {
          const path = this.normPath(a.path);
          item.title = path; this.render();
          const txt = await this.readText(path);
          const lines = txt.split('\n');
          const s = Math.max(1, a.start_line || 1), e = Math.min(lines.length, a.end_line || lines.length);
          let out = lines.slice(s - 1, e).join('\n');
          if (out.length > 60000) out = out.slice(0, 60000) + `\n… (dosya uzun: ${lines.length} satır; start_line/end_line ile devamını oku)`;
          const head = (s > 1 || e < lines.length) ? `[satır ${s}-${e} / ${lines.length}]\n` : '';
          return done(head + out, false, { summary: `${e - s + 1} satır` });
        }
        case 'search': {
          item.title = a.query; this.render();
          let re;
          try { re = a.regex ? new RegExp(a.query, 'i') : new RegExp(a.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } catch (e) { return done('Geçersiz düzenli ifade: ' + e.message, true); }
          const dir = this.normPath(a.path);
          const hits = [];
          for (const e of C.Explorer.entries) {
            if (e.dir || e.size > 400000 || IGNORE_DIR.test(e.path) || (dir && !e.path.startsWith(dir + '/'))) continue;
            if (!/\.(c|h|cpp|cc|hpp|java|cs|py|rs|sql|js|ts|json|md|txt|html|css|csv|in|out|swift|go|kt)$/i.test(e.path)) continue;
            let txt; try { txt = await this.readText(e.path); } catch (err) { continue; }
            txt.split('\n').forEach((l, i) => { if (hits.length < 120 && re.test(l)) hits.push(`${e.path}:${i + 1}: ${l.trim().slice(0, 200)}`); });
            if (hits.length >= 120) break;
          }
          return done(hits.length ? hits.join('\n') : this.L('Eşleşme yok.', 'No matches.'), false, { summary: `${hits.length} eşleşme` });
        }
        case 'get_problems': {
          const e = this.editorContext();
          const probs = C.Problems.list || [];
          const out = [`Aktif dosya: ${e.file || '(yok)'}${e.line ? ' satır ' + e.line : ''}`, e.selection ? 'Seçim:\n' + trunc(e.selection, 4000) : 'Seçim yok',
            probs.length ? 'Problems:\n' + probs.map((d) => `${d.file}:${d.line}:${d.col} ${d.sev}: ${d.msg}`).join('\n') : 'Problems paneli boş'];
          return done(out.join('\n'), false, { summary: `${probs.length} problem` });
        }
        case 'write_file': case 'edit_file': {
          const path = this.normPath(a.path);
          if (!path) return done('path gerekli', true);
          item.title = path;
          let before = null;
          if (C.Explorer.exists(path)) { try { before = await this.readText(path); } catch (e) { return done('Okunamadı: ' + e.message, true); } }
          let after;
          if (call.name === 'write_file') after = String(a.content == null ? '' : a.content);
          else {
            if (before == null) return done(`Dosya yok: ${path}. Yeni dosya için write_file kullan.`, true);
            const oldS = String(a.old_string || ''), newS = String(a.new_string == null ? '' : a.new_string);
            if (!oldS) return done('old_string boş olamaz', true);
            const n = before.split(oldS).length - 1;
            if (n === 0) return done('old_string dosyada bulunamadı. Dosyayı read_file ile tekrar okuyup birebir eşleşen bir metin kullan.', true);
            if (n > 1 && !a.replace_all) return done(`old_string dosyada ${n} kez geçiyor; benzersiz olacak şekilde daha fazla çevre satırı ekle veya replace_all kullan.`, true);
            after = a.replace_all ? before.split(oldS).join(newS) : before.replace(oldS, () => newS);
          }
          const st = lineDiffStat(before || '', after);
          Object.assign(item, { add: st.add, del: st.del, isNew: before == null, before, after });
          if (!(await this.approve(item))) { item.status = 'rejected'; delete item.before; delete item.after; this.render(); return { id: call.id, name: call.name, output: 'Kullanıcı bu değişikliği reddetti.', error: true }; }
          await this.writeText(path, after);
          this.undo[item.id] = { path, before };
          delete item.after; delete item.before;
          const lines = after.split('\n').length;
          return done(`${before == null ? 'Oluşturuldu' : 'Güncellendi'}: ${path} (+${st.add} −${st.del}, ${lines} satır)`, false, { canUndo: true });
        }
        case 'run_file': {
          const path = this.normPath(a.path);
          item.title = path + (a.stdin ? this.L(' (girdi ile)', ' (with stdin)') : '');
          if (!C.Explorer.exists(path)) return done(`Dosya yok: ${path}`, true);
          if (!(await this.approve(item))) { item.status = 'rejected'; this.render(); return { id: call.id, name: call.name, output: 'Kullanıcı çalıştırmayı reddetti.', error: true }; }
          item.status = 'run'; this.render();
          if (C.Run.running) return done('Başka bir program zaten çalışıyor.', true);
          this.setStatus(this.L('Çalıştırılıyor: ', 'Running: ') + path);
          C.Term.capture = '';
          let timedOut = false;
          const tm = setTimeout(() => { timedOut = true; C.Run.stop(); }, 60000);
          try { await C.Run.runFile(path, { agent: true, stdin: a.stdin != null ? String(a.stdin) : '', args: Array.isArray(a.args) ? a.args.map(String) : [] }); }
          finally { clearTimeout(tm); }
          const out = C.Term.capture || ''; C.Term.capture = null;
          const probs = (C.Problems.list || []).map((d) => `${d.file}:${d.line}:${d.col} ${d.sev}: ${d.msg}`);
          const res = trunc(out, 10000) + (probs.length ? '\n\nProblems:\n' + probs.join('\n') : '') + (timedOut ? '\n\n(60 sn zaman aşımı – program durduruldu; sonsuz döngü veya eksik girdi olabilir)' : '');
          const failed = /✖/.test(out) || timedOut;
          return done(res, false, { summary: failed ? this.L('hata/uyarı', 'failed') : this.L('başarılı', 'ok'), runFailed: failed, out: trunc(out, 3000) });
        }
        default: return done('Bilinmeyen araç: ' + call.name, true);
      }
    } catch (e) { C.Term.capture = null; return done(String(e.message || e), true); }
  },
  async undoChange(id) {
    const C = this.ctx, u = this.undo[id];
    if (!u) return;
    if (u.before == null) { await C.native('fs.delete', { path: u.path }); const t = C.Tabs.list.find((x) => x.path === u.path); if (t) await C.Tabs.close(t, false, true); await C.Explorer.refresh(); }
    else await this.writeText(u.path, u.before);
    delete this.undo[id];
    for (const c of this.chats) for (const v of c.view) if (v.id === id) { v.canUndo = false; v.undone = true; }
    this.saveChats(); this.render();
    C.notify('info', this.L('Geri alındı: ', 'Reverted: ') + u.path, { timeout: 2500 });
  },

  // ------------------------------------------------------------ arayüz
  setStatus(s) { const el = document.getElementById(this.id + 'Status'); if (el) el.textContent = s || ''; },
  scrollEnd() { const m = document.getElementById(this.id + 'Msgs'); if (m) requestAnimationFrame(() => { m.scrollTop = m.scrollHeight; }); },
  md(text) {
    const C = this.ctx, esc = C.esc;
    const parts = String(text).split(/^```/m);
    let html = '';
    parts.forEach((p, i) => {
      if (i % 2 === 0) { html += C.MD.render(p); return; }
      const nl = p.indexOf('\n');
      const lang = nl >= 0 ? p.slice(0, nl).trim() : '';
      const code = (nl >= 0 ? p.slice(nl + 1) : p).replace(/\n$/, '');
      html += `<div class="ag-code"><div class="ag-code-head"><span>${esc(lang || 'code')}</span><span class="ag-code-acts"><i class="codicon codicon-insert" data-ca="insert" title="${this.L('Editöre ekle', 'Insert at cursor')}"></i><i class="codicon codicon-new-file" data-ca="newfile" title="${this.L('Yeni dosya olarak kaydet', 'Save as new file')}"></i><i class="codicon codicon-copy" data-ca="copy" title="${this.L('Kopyala', 'Copy')}"></i></span></div><pre><code>${esc(code)}</code></pre></div>`;
    });
    return html;
  },
  toolLabel(v) {
    const L = (a, b) => this.L(a, b);
    return { list_files: ['list-tree', L('Dosyaları listele', 'List files')], read_file: ['file', L('Okundu', 'Read')], search: ['search', L('Arandı', 'Searched')],
      get_problems: ['warning', L('Problemlere bakıldı', 'Checked problems')], write_file: ['new-file', v.isNew ? L('Dosya oluştur', 'Create file') : L('Dosyayı yeniden yaz', 'Rewrite file')],
      edit_file: ['edit', L('Düzenle', 'Edit')], run_file: ['play', L('Çalıştır', 'Run')] }[v.name] || ['tools', v.name];
  },
  renderItem(v, idx) {
    const C = this.ctx, esc = C.esc;
    if (v.k === 'user') return `<div class="ag-msg ag-user"><div class="ag-bubble">${esc(v.text).replace(/\n/g, '<br>')}</div>${v.file ? `<div class="ag-file dim"><i class="codicon codicon-file"></i> ${esc(v.file.split('/').pop())}</div>` : ''}</div>`;
    if (v.k === 'text') return `<div class="ag-msg ag-ai"><div class="ag-ai-head"><i class="codicon codicon-${this.cfg.icon}" style="color:${this.cfg.color}"></i> ${esc(v.model || this.title)}</div><div class="ag-md md-body">${this.md(v.text)}</div></div>`;
    if (v.k === 'error') return `<div class="ag-msg ag-err"><i class="codicon codicon-error"></i> ${esc(v.text)}</div>`;
    if (v.k === 'tool') {
      const [icon, label] = this.toolLabel(v);
      const stIcon = { run: '<i class="codicon codicon-loading codicon-modifier-spin"></i>', done: '<i class="codicon codicon-check ag-ok"></i>', error: '<i class="codicon codicon-error ag-bad"></i>', rejected: '<i class="codicon codicon-circle-slash ag-bad"></i>', ask: '<i class="codicon codicon-question ag-warn"></i>' }[v.status] || '';
      const stat = v.add != null ? ` <span class="git-u">+${v.add}</span> <span class="git-d">−${v.del}</span>` : '';
      let body = '';
      if (v.status === 'ask') {
        const isRun = v.name === 'run_file';
        body = `<div class="ag-approve">${isRun && v.input.stdin ? `<pre class="ag-stdin">stdin:\n${esc(String(v.input.stdin).slice(0, 400))}</pre>` : ''}
          ${!isRun ? `<button class="btn-secondary" data-ta="diff" data-id="${esc(v.id)}"><i class="codicon codicon-diff"></i> ${this.L('Farkı göster', 'Show diff')}</button>` : ''}
          <button class="btn-primary" data-ta="ok" data-id="${esc(v.id)}"><i class="codicon codicon-check"></i> ${isRun ? this.L('Çalıştır', 'Run') : this.L('Kabul et', 'Accept')}</button>
          <button class="btn-secondary" data-ta="no" data-id="${esc(v.id)}">${this.L('Reddet', 'Reject')}</button>
          <button class="btn-secondary ag-always" data-ta="always" data-id="${esc(v.id)}" title="${this.L('Bundan sonra sormadan uygula', 'Always allow')}">${this.L('Hep izin ver', 'Always')}</button></div>`;
      } else if (v.name === 'run_file' && v.out) body = `<pre class="ag-out ${v.runFailed ? 'bad' : ''}">${esc(v.out.slice(-1500))}</pre>`;
      const undo = v.canUndo ? `<a href="#" class="ag-undo" data-ta="undo" data-id="${esc(v.id)}"><i class="codicon codicon-discard"></i> ${this.L('Geri al', 'Undo')}</a>` : v.undone ? `<span class="dim small">${this.L('geri alındı', 'reverted')}</span>` : '';
      const openable = ['read_file', 'write_file', 'edit_file', 'run_file'].includes(v.name) && v.input.path;
      return `<div class="ag-tool st-${v.status}">${stIcon}<i class="codicon codicon-${icon}"></i><span class="ag-tool-label">${esc(label)}</span>${v.title ? `<span class="ag-tool-title${openable ? ' link' : ''}" data-ta="open" data-path="${esc(this.normPath(v.input.path || ''))}">${esc(v.title)}</span>` : ''}${stat}${v.summary ? `<span class="dim small">· ${esc(v.summary)}</span>` : ''}${v.err ? `<span class="ag-bad small"> ${esc(v.err.slice(0, 120))}</span>` : ''}<span class="flex1"></span>${undo}${body}</div>`;
    }
    return '';
  },
  welcome() {
    const tr = this.tr();
    return `<div class="ag-welcome">
      <div class="ag-logo"><i class="codicon codicon-${this.cfg.icon}" style="color:${this.cfg.color}"></i></div>
      <h3>${this.title}</h3>
      <p class="dim">${tr ? `Kodunu açıklayan, hatalarını bulan, dosyalarını düzenleyip çalıştırarak test eden yapay zekâ ajanı. ${this.cfg.provider === 'claude' ? 'Anthropic Claude' : 'Google Gemini'} modelleriyle çalışır.` : 'An AI agent that explains, fixes, edits and runs your code.'}</p>
      ${this.hasKey() ? `<div class="ag-sugs">
        <button class="ag-sug" data-sug="${tr ? 'Aktif dosyayı açıkla' : 'Explain the active file'}"><i class="codicon codicon-book"></i> ${tr ? 'Aktif dosyayı açıkla' : 'Explain the active file'}</button>
        <button class="ag-sug" data-sug="${tr ? 'Aktif dosyadaki hataları bul ve düzelt, sonra çalıştırıp doğrula.' : 'Find and fix errors in the active file, then run it.'}"><i class="codicon codicon-debug"></i> ${tr ? 'Hataları bul ve düzelt' : 'Find & fix errors'}</button>
        <button class="ag-sug" data-sug="${tr ? 'Aktif dosya için sınavda çıkabilecek 3 benzer alıştırma sorusu hazırla ve her birini ayrı dosyaya çözümlü yaz.' : 'Create 3 similar practice exercises with solutions.'}"><i class="codicon codicon-mortar-board"></i> ${tr ? 'Benzer sınav soruları üret' : 'Practice exercises'}</button>
        <button class="ag-sug" data-sug="${tr ? 'Bu kodun zaman ve bellek karmaşıklığını (Big-O) analiz et.' : 'Analyze time and space complexity.'}"><i class="codicon codicon-graph"></i> ${tr ? 'Karmaşıklık analizi' : 'Complexity analysis'}</button>
      </div>` : this.cfg.provider === 'claude'
        ? `<button class="btn-primary wide" data-ka="claude"><i class="codicon codicon-key"></i> ${tr ? 'Claude API anahtarı ekle' : 'Add Claude API key'}</button>
           <p class="dim small" style="margin-top:14px">${tr ? 'console.anthropic.com → API Keys → Create Key. Kullanım ücretlidir (Claude Pro aboneliğinden ayrı). Anahtar sadece bu iPad\'in Anahtar Zinciri\'nde saklanır ve yalnızca Anthropic\'e gönderilir.' : 'console.anthropic.com → API Keys.'}</p>`
        : `<button class="btn-primary wide" data-ka="gemini"><i class="codicon codicon-key"></i> ${tr ? 'Gemini API anahtarı ekle (ücretsiz kota)' : 'Add Gemini API key (free tier)'}</button>
           <p class="dim small" style="margin-top:14px">${tr ? 'aistudio.google.com → Get API key → Create API key. Ücretsiz kotası vardır. Anahtar sadece bu iPad\'in Anahtar Zinciri\'nde saklanır ve yalnızca Google\'a gönderilir.' : 'aistudio.google.com → Get API key.'}</p>`}
    </div>`;
  },
  render() {
    const C = this.ctx; if (!C) return;
    const root = document.getElementById(this.cfg.rootId); if (!root) return;
    const esc = C.esc, tr = this.tr();
    const draft = (document.getElementById(this.id + 'Text') || {}).value;
    const keepScroll = document.getElementById(this.id + 'Msgs');
    const atEnd = !keepScroll || keepScroll.scrollTop + keepScroll.clientHeight > keepScroll.scrollHeight - 40;
    const st = keepScroll ? keepScroll.scrollTop : 0;
    const chat = this.chat;
    const e = this.editorContext();
    root.innerHTML = `<div class="ag-wrap">
      <div class="ag-msgs" id="${this.id}Msgs">${chat && chat.view.length ? chat.view.map((v, i) => this.renderItem(v, i)).join('') : this.welcome()}
        ${this.busy ? `<div class="ag-thinking"><i class="codicon codicon-loading codicon-modifier-spin"></i> <span id="${this.id}Status">${tr ? 'Düşünüyor…' : 'Thinking…'}</span></div>` : ''}</div>
      <div class="ag-input">
        ${e.file ? `<div class="ag-ctx"><span class="ag-chip" title="${tr ? 'Bağlam olarak eklenir' : 'Included as context'}"><i class="codicon codicon-file"></i> ${esc(e.file.split('/').pop())}${e.selection ? ` <span class="dim">:${e.selStart}-${e.selEnd}</span>` : ''}</span>${(C.Problems.list || []).length ? `<span class="ag-chip warn"><i class="codicon codicon-warning"></i> ${(C.Problems.list || []).length}</span>` : ''}</div>` : ''}
        <textarea id="${this.id}Text" rows="3" placeholder="${tr ? this.title + ' – sor veya görev ver… (⌘↵ gönder)' : 'Ask ' + this.title + '… (⌘↵ to send)'}" autocapitalize="sentences"></textarea>
        <div class="ag-bar">
          <select id="${this.id}Mode" title="${tr ? 'Mod' : 'Mode'}"><option value="agent">${tr ? 'Ajan' : 'Agent'}</option><option value="ask">${tr ? 'Sor' : 'Ask'}</option></select>
          <button class="ag-model" id="${this.id}Model"><i class="codicon codicon-${this.cfg.icon}" style="color:${this.cfg.color}"></i> ${esc(this.modelName())} <i class="codicon codicon-chevron-down"></i></button>
          ${this.S.autoApprove ? `<span class="ag-chip warn" title="${tr ? 'Otomatik onay açık' : 'Auto-approve on'}"><i class="codicon codicon-zap"></i></span>` : ''}
          <span class="flex1"></span>
          ${this.busy ? `<button class="ag-send stop" id="${this.id}Stop" title="Stop"><i class="codicon codicon-debug-stop"></i></button>` : `<button class="ag-send" id="${this.id}Send" title="${tr ? 'Gönder' : 'Send'}"><i class="codicon codicon-send"></i></button>`}
        </div>
      </div></div>`;
    const ta = root.querySelector('#' + this.id + 'Text');
    if (draft) ta.value = draft;
    const sendNow = () => { const v = ta.value; if (!v.trim()) return; ta.value = ''; this.send(v); };
    ta.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); sendNow(); } });
    const sb = root.querySelector('#' + this.id + 'Send'); if (sb) sb.onclick = sendNow;
    const sp = root.querySelector('#' + this.id + 'Stop'); if (sp) sp.onclick = () => this.stop();
    const mode = root.querySelector('#' + this.id + 'Mode'); mode.value = this.S.mode === 'ask' ? 'ask' : 'agent';
    mode.onchange = () => { this.S.mode = mode.value; C.saveSettings(); };
    root.querySelector('#' + this.id + 'Model').onclick = () => this.pickModel();
    root.querySelectorAll('[data-ka]').forEach((b) => { b.onclick = () => this.setKey(b.dataset.ka); });
    root.querySelectorAll('[data-sug]').forEach((b) => { b.onclick = () => this.send(b.dataset.sug); });
    root.querySelectorAll('[data-ta]').forEach((b) => { b.onclick = (ev) => { ev.preventDefault(); this.toolAction(b.dataset.ta, b.dataset.id, b.dataset.path); }; });
    root.querySelectorAll('.ag-code').forEach((blk) => {
      blk.querySelectorAll('[data-ca]').forEach((b) => { b.onclick = () => this.codeAction(b.dataset.ca, blk.querySelector('code').textContent, blk.querySelector('.ag-code-head span').textContent); });
    });
    root.querySelectorAll('.ag-md a').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); const href = a.getAttribute('href'); if (/^https?:/.test(href)) C.native('app.openURL', { url: href }); }));
    const m = root.querySelector('#' + this.id + 'Msgs');
    if (atEnd) m.scrollTop = m.scrollHeight; else m.scrollTop = st;
  },
  findItem(id) { if (!this.chat) return null; return this.chat.view.find((v) => v.id === id); },
  toolAction(act, id, path) {
    const C = this.ctx;
    if (act === 'open') { if (path && C.Explorer.exists(path)) C.Tabs.open(path, { preview: false }); return; }
    if (act === 'undo') { this.undoChange(id); return; }
    const v = this.findItem(id);
    if (act === 'diff' && v) { C.openDiff(v.input.path.split('/').pop(), v.before || '', v.after || '', v.input.path, { id: this.id + ':' + v.id, suffix: this.L(` (${this.title} önerisi)`, ` (${this.title} proposal)`) }); return; }
    const res = this.pending[id];
    if (!res) return;
    if (act === 'always') { this.S.autoApprove = true; C.saveSettings(); C.notify('info', this.L(`Otomatik onay açıldı (${this.title} › Ayarlar'dan kapatabilirsin).`, 'Auto-approve enabled.'), { timeout: 4000 }); }
    if (v) v.status = act === 'no' ? 'rejected' : 'run';
    res(act !== 'no');
  },
  async codeAction(act, code, lang) {
    const C = this.ctx;
    if (act === 'copy') { try { await navigator.clipboard.writeText(code); C.notify('info', this.L('Kopyalandı', 'Copied'), { timeout: 1500 }); } catch (e) { C.notify('warning', this.L('Kopyalanamadı', 'Copy failed')); } return; }
    if (act === 'insert') {
      const ed = C.editor(), M = C.monaco();
      if (!ed || !M || !C.Tabs.active || C.Tabs.active.virtual) { C.notify('info', this.L('Önce bir dosya aç.', 'Open a file first.')); return; }
      const sel = ed.getSelection();
      ed.executeEdits('ag-claude', [{ range: sel, text: code, forceMoveMarkers: true }]);
      ed.focus(); return;
    }
    if (act === 'newfile') {
      const ext = { c: 'c', cpp: 'cpp', 'c++': 'cpp', java: 'java', python: 'py', py: 'py', csharp: 'cs', cs: 'cs', rust: 'rs', rs: 'rs', sql: 'sql', javascript: 'js', js: 'js', html: 'html', css: 'css', json: 'json', markdown: 'md', md: 'md' }[(lang || '').toLowerCase()] || 'txt';
      const dir = C.Tabs.active && !C.Tabs.active.virtual ? C.dirname(C.Tabs.active.path) : '';
      const name = await C.inputBox({ prompt: this.L('Dosya adı', 'File name'), value: (dir ? dir + '/' : '') + 'yeni.' + ext });
      if (!name) return;
      await C.native('fs.write', { path: name.trim(), content: code + '\n' });
      await C.Explorer.refresh(); await C.Tabs.open(name.trim(), { preview: false });
    }
  },
  onFileSaved() {}
};

// keys/models paylaşılmaz: her ajan kendi sağlayıcısını kullanır
function makeAgent(cfg) {
  const a = Object.create(AgentProto, Object.getOwnPropertyDescriptors({
    cfg, id: cfg.id, keys: { claude: null, gemini: null }, models: { claude: null, gemini: null },
    chats: [], chat: null, busy: false, stopFlag: false, pending: {}, undo: {}
  }));
  a.saveChats = (() => { let t; return function () { clearTimeout(t); t = setTimeout(() => {
    let list = this.chats.slice(0, 15); let json = JSON.stringify(list);
    while (json.length > 1500000 && list.length > 1) { list = list.slice(0, -1); json = JSON.stringify(list); }
    this.ctx.native('kv.set', { key: this.cfg.chatsKey, value: json });
  }, 500); }; })();
  return a;
}
const Agents = {
  claude: makeAgent({ id: 'cl', provider: 'claude', title: 'Claude', rootId: 'claudeRoot', settingsKey: 'agentClaude', chatsKey: 'agent.chats.claude', icon: 'sparkle', color: '#d97757' }),
  ag: makeAgent({ id: 'gm', provider: 'gemini', title: 'Gemini · AG', rootId: 'agRoot', settingsKey: 'agentGemini', chatsKey: 'agent.chats.gemini', icon: 'star-full', color: '#4c8df6' })
};
window.VSCModules.push((ctx) => { Agents.claude.ctx = ctx; Agents.ag.ctx = ctx; ctx.Agents = Agents; ctx.Agent = Agents.claude; });
window.VSCAgents = Agents;
window.VSCAgent = Agents.claude;
})();
