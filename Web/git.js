/* ==========================================================================
   VS iPad – GitHub kaynak denetimi
   iPad'de git programı olmadığı için GitHub REST "Git Data" API'si kullanılır:
     commit + push  → blob/tree/commit/ref
     pull / clone   → tree + blob indirme
   Değişiklik tespiti: git blob SHA-1'i ("blob <boyut>\0" + içerik) yerel olarak hesaplanır,
   son eşitlemedeki SHA'larla (index) karşılaştırılır.
   Kimlik: GitHub Personal Access Token (iPad Anahtar Zinciri'nde saklanır).
   ========================================================================== */
(function () {
'use strict';
window.VSCModules = window.VSCModules || [];

const API = 'https://api.github.com';
const DEFAULT_IGNORE = ['.git/', 'node_modules/', '.DS_Store', '__pycache__/', '*.pyc', '.build/', 'DerivedData/', '*.o', 'a.out', '.vscode-ipad/'];

function globToRe(g) {
  g = g.trim();
  if (!g || g.startsWith('#')) return null;
  const neg = g.startsWith('!'); if (neg) g = g.slice(1);
  const dirOnly = g.endsWith('/'); if (dirOnly) g = g.slice(0, -1);
  const anchored = g.startsWith('/'); if (anchored) g = g.slice(1);
  let re = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  re = (anchored || g.includes('/') ? '^' : '(^|/)') + re + (dirOnly ? '(/|$)' : '($|/)');
  return { re: new RegExp(re), neg };
}
async function sha1Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function b64ToBytes(b64) { const s = atob(b64.replace(/\s/g, '')); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function bytesToB64(u) { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); }
const utf8 = new TextDecoder('utf-8', { fatal: true });

const Git = {
  ctx: null, token: null, user: null, link: null, changes: [], conflicts: [], busy: false, lastStatus: 0,
  tr() { return this.ctx.SET.lang === 'tr'; },
  L(trS, enS) { return this.tr() ? trS : enS; },
  // iPad'de uygulama klasörünün yolu her güncellemede değişir → kalıcı anahtar kullan
  linkKey() { const ws = this.ctx.Explorer.ws || {}; return 'git.link.' + (ws.external ? 'ext:' + (ws.name || ws.path) : 'default'); },

  async init() {
    try { this.token = await this.ctx.native('secret.get', { key: 'github.token' }); } catch (e) { this.token = null; }
    try { const s = await this.ctx.native('kv.get', { key: this.linkKey() }); this.link = s ? JSON.parse(s) : null; } catch (e) { this.link = null; }
    if (!this.link && !(this.ctx.Explorer.ws || {}).external) { // eski sürümün (yol tabanlı) kaydını taşı
      try { const s = await this.ctx.native('kv.get', { key: 'git.link.last' }); const l = s ? JSON.parse(s) : null; if (l && (!l.root || this.ctx.Explorer.exists(l.root))) { this.link = l; await this.saveLink(); } } catch (e) {}
    }
    if (this.token) { try { const u = await this.ctx.native('kv.get', { key: 'github.user' }); this.user = u ? JSON.parse(u) : null; } catch (e) {} }
    // diğer uygulamada (VS iPad / VS_iPadClang) girilmiş token: kullanıcı bilgisini sessizce al
    if (this.token && !this.user) {
      try { const { data } = await this.api('GET', '/user'); this.user = { login: data.login, name: data.name, avatar: data.avatar_url }; await this.ctx.native('kv.set', { key: 'github.user', value: JSON.stringify(this.user) }); }
      catch (e) { if (e.status === 401) this.token = null; }
    }
    this.render();
    if (this.link) this.refresh(true);
  },
  saveLink() { const v = this.link ? JSON.stringify(this.link) : null; this.ctx.native('kv.set', { key: 'git.link.last', value: v }); return this.ctx.native('kv.set', { key: this.linkKey(), value: v }); },

  async api(method, path, body, okStatuses) {
    const r = await this.ctx.native('http.request', {
      url: path.startsWith('http') ? path : API + path, method,
      headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'VS-iPad' },
      body: body ? JSON.stringify(body) : undefined, timeout: 120
    });
    let j = null;
    try { j = r.body ? JSON.parse(r.body) : null; } catch (e) {}
    if (r.status >= 400 && !(okStatuses || []).includes(r.status)) {
      const e = new Error((j && j.message) ? j.message + (r.status === 401 ? this.L(' (token geçersiz veya süresi dolmuş)', ' (bad token)') : r.status === 403 || r.status === 404 ? this.L(' (token\'ın bu depoya yazma izni olmayabilir)', '') : '') : 'HTTP ' + r.status);
      e.status = r.status; throw e;
    }
    return { status: r.status, data: j };
  },

  // ---- giriş
  async signIn() {
    const C = this.ctx;
    const tok = await C.inputBox({
      title: 'GitHub', prompt: this.L('Personal Access Token yapıştır. github.com → Settings → Developer settings → Fine-grained tokens → "Contents: Read and write" + "Administration: Read and write" (yeni depo oluşturmak için).', 'Paste a GitHub Personal Access Token (Contents read/write, Administration read/write).'),
      value: ''
    });
    if (!tok) return false;
    this.token = tok.trim();
    try {
      const { data } = await this.api('GET', '/user');
      this.user = { login: data.login, name: data.name, avatar: data.avatar_url };
      await C.native('secret.set', { key: 'github.token', value: this.token });
      await C.native('kv.set', { key: 'github.user', value: JSON.stringify(this.user) });
      C.notify('success', this.L('GitHub\'a giriş yapıldı: ', 'Signed in as ') + data.login);
      this.render();
      return true;
    } catch (e) {
      this.token = null;
      C.notify('error', this.L('Giriş başarısız: ', 'Sign-in failed: ') + e.message);
      return false;
    }
  },
  async signOut() {
    await this.ctx.native('secret.set', { key: 'github.token', value: null });
    await this.ctx.native('kv.set', { key: 'github.user', value: null });
    this.token = null; this.user = null; this.render();
  },

  // ---- yerel dosyalar
  async ignoreRules() {
    const rules = DEFAULT_IGNORE.map(globToRe).filter(Boolean);
    const gi = (this.link.root ? this.link.root + '/' : '') + '.gitignore';
    if (this.ctx.Explorer.exists(gi)) {
      try { const txt = (await this.ctx.native('fs.read', { path: gi })).content; for (const l of txt.split('\n')) { const r = globToRe(l); if (r) rules.push(r); } } catch (e) {}
    }
    return rules;
  },
  isIgnored(rel, rules) { let ign = false; for (const r of rules) if (r.re.test(rel)) ign = !r.neg; return ign; },
  rel(p) { const root = this.link.root; return root ? p.slice(root.length + 1) : p; },
  abs(r) { return this.link.root ? this.link.root + '/' + r : r; },
  async localFiles() {
    const rules = await this.ignoreRules();
    const root = this.link.root;
    const out = [];
    for (const e of this.ctx.Explorer.entries) {
      if (e.dir) continue;
      if (root && !e.path.startsWith(root + '/')) continue;
      const r = this.rel(e.path);
      if (this.isIgnored(r, rules)) continue;
      if (e.size > 50 * 1024 * 1024) continue;
      out.push({ path: e.path, rel: r, size: e.size });
    }
    return out;
  },
  async readBytes(path) {
    // açık ve kaydedilmemiş sekme varsa önce kaydet
    const t = this.ctx.Tabs.list.find((x) => x.path === path && x.dirty);
    if (t) await this.ctx.Tabs.save(t, true);
    const r = await this.ctx.native('fs.readB64', { path });
    return b64ToBytes(r.b64 || '');
  },
  async blobSha(bytes) {
    const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(head.length + bytes.length); all.set(head); all.set(bytes, head.length);
    return sha1Hex(all);
  },

  // ---- durum
  async status() {
    if (!this.link) return [];
    const files = await this.localFiles();
    const idx = this.link.index || {};
    const changes = [];
    const seen = new Set();
    for (const f of files) {
      seen.add(f.rel);
      const known = idx[f.rel];
      let sha;
      try { sha = await this.blobSha(await this.readBytes(f.path)); } catch (e) { continue; }
      f.sha = sha;
      if (!known) changes.push({ rel: f.rel, path: f.path, kind: 'U', sha });
      else if (known !== sha) changes.push({ rel: f.rel, path: f.path, kind: 'M', sha });
    }
    for (const r of Object.keys(idx)) if (!seen.has(r)) changes.push({ rel: r, path: this.abs(r), kind: 'D' });
    changes.sort((a, b) => a.rel.localeCompare(b.rel));
    this.changes = changes;
    this.lastStatus = Date.now();
    return changes;
  },
  async refresh(quiet) {
    if (!this.link || this.busy) { this.render(); return; }
    try { await this.status(); } catch (e) { if (!quiet) this.ctx.notify('error', e.message); }
    this.render(); this.ctx.onGitStatus && this.ctx.onGitStatus(this.decorations());
  },
  decorations() { const m = {}; for (const c of this.changes) m[c.path] = c.kind; for (const c of this.conflicts) m[c] = 'C'; return m; },
  scheduleRefresh() { clearTimeout(this._rt); if (this.link) this._rt = setTimeout(() => this.refresh(true), 1500); },

  // ---- uzak
  async remoteHead() {
    const L = this.link;
    const r = await this.api('GET', `/repos/${L.owner}/${L.repo}/git/ref/heads/${encodeURIComponent(L.branch)}`, null, [404, 409]);
    if (r.status === 404 || r.status === 409) return null; // boş depo
    return r.data.object.sha;
  },
  async remoteTree(commitSha) {
    const L = this.link;
    const c = (await this.api('GET', `/repos/${L.owner}/${L.repo}/git/commits/${commitSha}`)).data;
    const t = (await this.api('GET', `/repos/${L.owner}/${L.repo}/git/trees/${c.tree.sha}?recursive=1`)).data;
    const map = {};
    for (const e of t.tree) if (e.type === 'blob') map[e.path] = e.sha;
    return { treeSha: c.tree.sha, map, truncated: t.truncated };
  },
  async downloadBlob(sha) {
    const L = this.link;
    const b = (await this.api('GET', `/repos/${L.owner}/${L.repo}/git/blobs/${sha}`)).data;
    return b.encoding === 'base64' ? b.content.replace(/\s/g, '') : bytesToB64(new TextEncoder().encode(b.content));
  },

  // ---- pull
  async pull(silent) {
    const C = this.ctx, L = this.link;
    if (!L) return;
    const head = await this.remoteHead();
    if (!head) { if (!silent) C.notify('info', this.L('Uzak depo boş.', 'Remote is empty.')); return; }
    if (head === L.head) { if (!silent) C.notify('info', this.L('Zaten güncel.', 'Already up to date.'), { timeout: 2000 }); return; }
    const { map } = await this.remoteTree(head);
    const idx = Object.assign({}, L.index || {});
    const conflicts = [];
    let down = 0, del = 0;
    const localSha = async (rel) => { const p = this.abs(rel); if (!C.Explorer.exists(p)) return null; return this.blobSha(await this.readBytes(p)); };
    for (const [rel, rsha] of Object.entries(map)) {
      if (idx[rel] === rsha) continue;
      const ls = await localSha(rel);
      if (ls === rsha) { idx[rel] = rsha; continue; }
      if (ls == null ? !idx[rel] : ls === idx[rel]) {
        const b64 = await this.downloadBlob(rsha);
        await C.native('fs.writeB64', { path: this.abs(rel), b64 });
        idx[rel] = rsha; down++;
        C.Tabs.reloadFromDisk(this.abs(rel));
      } else conflicts.push(this.abs(rel));
    }
    for (const rel of Object.keys(idx)) {
      if (map[rel]) continue;
      const ls = await localSha(rel);
      if (ls == null) { delete idx[rel]; continue; }
      if (ls === idx[rel]) { await C.native('fs.delete', { path: this.abs(rel) }); delete idx[rel]; del++; }
      else conflicts.push(this.abs(rel));
    }
    L.index = idx; L.head = head;
    this.conflicts = conflicts;
    await this.saveLink();
    await C.Explorer.refresh();
    if (conflicts.length) C.notify('warning', this.L(`Çakışma: ${conflicts.length} dosya hem iPad'de hem GitHub'da değişmiş. iPad'deki sürüm korundu; push yaparsan GitHub'dakinin üzerine yazar.`, `${conflicts.length} conflicting files kept local.`), { timeout: 12000 });
    else if (!silent) C.notify('success', this.L(`Pull tamam: ${down} dosya indirildi${del ? ', ' + del + ' silindi' : ''}.`, `Pulled ${down} files.`));
  },

  // ---- commit + push
  async commitPush(message) {
    const C = this.ctx, L = this.link;
    if (!L) return;
    if (!message || !message.trim()) { C.notify('warning', this.L('Commit mesajı yaz.', 'Enter a commit message.')); return false; }
    await this.status();
    if (!this.changes.length) { C.notify('info', this.L('Commit edilecek değişiklik yok.', 'Nothing to commit.')); return false; }
    let head = await this.remoteHead();
    if (head && L.head && head !== L.head) {
      await this.pull(true);
      await this.status();
      head = L.head;
      if (this.conflicts.length) {
        const ok = await C.dialog(this.L('GitHub\'da da değişen dosyalar var.', 'Remote changed too.'), this.L(`${this.conflicts.length} dosyada iPad'deki sürüm GitHub'dakinin üzerine yazılacak. Devam edilsin mi?`, 'Overwrite remote versions?'), [this.L('Üzerine yaz ve push et', 'Overwrite & push'), 'Cancel'], 0);
        if (ok !== 0) return false;
      }
    }
    if (!head) {
      // boş depo: Git Data API ilk commit'i kabul etmez → contents API ile ilk dosya
      const first = this.changes.find((c) => c.kind !== 'D');
      const bytes = await this.readBytes(first.path);
      const r = await this.api('PUT', `/repos/${L.owner}/${L.repo}/contents/${first.rel.split('/').map(encodeURIComponent).join('/')}`, { message, content: bytesToB64(bytes), branch: L.branch });
      head = r.data.commit.sha;
      L.index = Object.assign({}, L.index, { [first.rel]: first.sha });
      L.head = head;
      this.changes = this.changes.filter((c) => c !== first);
      if (!this.changes.length) { await this.saveLink(); await this.refresh(true); C.notify('success', this.L('Push tamam ✓', 'Pushed ✓')); return true; }
    }
    const base = (await this.api('GET', `/repos/${L.owner}/${L.repo}/git/commits/${head}`)).data;
    const tree = [];
    for (const ch of this.changes) {
      if (ch.kind === 'D') { tree.push({ path: ch.rel, mode: '100644', type: 'blob', sha: null }); continue; }
      const bytes = await this.readBytes(ch.path);
      let text = null;
      if (bytes.length < 900000) { try { text = utf8.decode(bytes); } catch (e) { text = null; } }
      if (text != null) tree.push({ path: ch.rel, mode: '100644', type: 'blob', content: text });
      else {
        const b = (await this.api('POST', `/repos/${L.owner}/${L.repo}/git/blobs`, { content: bytesToB64(bytes), encoding: 'base64' })).data;
        tree.push({ path: ch.rel, mode: '100644', type: 'blob', sha: b.sha });
      }
    }
    const nt = (await this.api('POST', `/repos/${L.owner}/${L.repo}/git/trees`, { base_tree: base.tree.sha, tree })).data;
    const author = this.user ? { name: this.user.name || this.user.login, email: `${this.user.login}@users.noreply.github.com` } : undefined;
    const nc = (await this.api('POST', `/repos/${L.owner}/${L.repo}/git/commits`, { message, tree: nt.sha, parents: [head], author })).data;
    await this.api('PATCH', `/repos/${L.owner}/${L.repo}/git/refs/heads/${encodeURIComponent(L.branch)}`, { sha: nc.sha, force: false });
    const idx = Object.assign({}, L.index);
    for (const ch of this.changes) { if (ch.kind === 'D') delete idx[ch.rel]; else idx[ch.rel] = ch.sha; }
    L.index = idx; L.head = nc.sha; this.conflicts = [];
    await this.saveLink();
    await this.refresh(true);
    C.notify('success', this.L(`Push tamam ✓  ${L.owner}/${L.repo} (${nc.sha.slice(0, 7)})`, `Pushed ${nc.sha.slice(0, 7)}`));
    return true;
  },

  // ---- bağlama / klonlama / yayımlama
  async pickRepo(placeholder) {
    const C = this.ctx;
    const n = C.notify('info', this.L('Depolar yükleniyor…', 'Loading repositories…'), { timeout: 0 });
    let repos = [];
    try { repos = (await this.api('GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member')).data; }
    finally { n.close(); }
    const it = await C.quickPick(repos.map((r) => ({ label: r.full_name, desc: (r.private ? '🔒 ' : '') + (r.description || ''), r })), { placeholder });
    return it ? it.r : null;
  },
  async chooseFolder(title) {
    const C = this.ctx;
    const dirs = C.Explorer.entries.filter((e) => e.dir).map((e) => e.path).filter((p) => !p.includes('/') || p.split('/').length <= 3);
    const it = await C.quickPick([{ label: this.L('(çalışma alanının tamamı)', '(whole workspace)'), v: '' }].concat(dirs.map((d) => ({ label: d, v: d }))), { placeholder: title });
    return it ? it.v : null;
  },
  async clone() {
    const C = this.ctx;
    if (!this.token && !(await this.signIn())) return;
    const r = await this.pickRepo(this.L('Klonlanacak depoyu seç', 'Select repository to clone'));
    if (!r) return;
    let folder = r.name;
    let k = 2; while (C.Explorer.exists(folder)) folder = r.name + '-' + (k++);
    await C.native('fs.mkdir', { path: folder });
    this.link = { owner: r.owner.login, repo: r.name, branch: r.default_branch || 'main', root: folder, index: {}, head: null };
    this.busy = true; this.render();
    try { await this.pull(true); C.notify('success', this.L(`Klonlandı: ${r.full_name} → ${folder}/`, `Cloned into ${folder}/`)); }
    catch (e) { C.notify('error', e.message); }
    finally { this.busy = false; await this.refresh(true); }
  },
  async linkExisting() {
    const C = this.ctx;
    if (!this.token && !(await this.signIn())) return;
    const r = await this.pickRepo(this.L('Bağlanacak depoyu seç', 'Select repository'));
    if (!r) return;
    const root = await this.chooseFolder(this.L('Hangi klasör bu depoya bağlansın?', 'Which folder?'));
    if (root == null) return;
    this.link = { owner: r.owner.login, repo: r.name, branch: r.default_branch || 'main', root, index: {}, head: null };
    this.busy = true; this.render();
    try { await this.pull(true); } catch (e) { C.notify('error', e.message); }
    finally { this.busy = false; await this.saveLink(); await this.refresh(true); }
    C.notify('info', this.L('Bağlandı. GitHub\'daki dosyalar indirildi; iPad\'deki farklı dosyalar "Değişiklikler" listesinde.', 'Linked.'));
  },
  async publish() {
    const C = this.ctx;
    if (!this.token && !(await this.signIn())) return;
    const root = await this.chooseFolder(this.L('GitHub\'a yayımlanacak klasör', 'Folder to publish'));
    if (root == null) return;
    const name = await C.inputBox({ prompt: this.L('Yeni depo adı', 'Repository name'), value: (root.split('/').pop() || C.Explorer.ws.name || 'vs-ipad').replace(/[^\w.-]+/g, '-') });
    if (!name) return;
    const vis = await C.quickPick([{ label: this.L('🔒 Gizli (private)', '🔒 Private'), v: true }, { label: this.L('🌐 Herkese açık (public)', '🌐 Public'), v: false }], { placeholder: this.L('Görünürlük', 'Visibility') });
    if (!vis) return;
    this.busy = true; this.render();
    try {
      const r = (await this.api('POST', '/user/repos', { name, private: vis.v, auto_init: true, description: 'VS iPad ile oluşturuldu' })).data;
      this.link = { owner: r.owner.login, repo: r.name, branch: r.default_branch || 'main', root, index: {}, head: null };
      await new Promise((res) => setTimeout(res, 1500));
      await this.pull(true);
      await this.status();
      this.busy = false;
      await this.commitPush(this.L('İlk commit (VS iPad)', 'Initial commit (VS iPad)'));
      C.notify('success', this.L('Yayımlandı: ', 'Published: ') + r.html_url, { actions: [{ label: this.L('GitHub\'da aç', 'Open'), run: () => C.native('app.openURL', { url: r.html_url }) }] });
    } catch (e) { C.notify('error', e.message); }
    finally { this.busy = false; await this.refresh(true); }
  },
  async unlink() {
    const C = this.ctx;
    const ok = await C.dialog(this.L('Depo bağlantısı kaldırılsın mı?', 'Unlink repository?'), this.L('Dosyalar silinmez, sadece GitHub eşitlemesi durur.', 'Files are kept.'), [this.L('Bağlantıyı kaldır', 'Unlink'), 'Cancel'], 0);
    if (ok !== 0) return;
    this.link = null; this.changes = []; await this.saveLink(); this.render(); C.onGitStatus && C.onGitStatus({});
  },
  async discard(ch) {
    const C = this.ctx;
    const ok = await C.dialog(this.L(`'${ch.rel}' değişiklikleri geri alınsın mı?`, `Discard changes in '${ch.rel}'?`), this.L('Dosya son eşitlenen (GitHub) sürümüne döner. Bu geri alınamaz.', 'This cannot be undone.'), [this.L('Değişiklikleri at', 'Discard'), 'Cancel'], 0);
    if (ok !== 0) return;
    const idxSha = this.link.index[ch.rel];
    if (!idxSha) { await C.native('fs.delete', { path: ch.path }); }
    else { const b64 = await this.downloadBlob(idxSha); await C.native('fs.writeB64', { path: ch.path, b64 }); C.Tabs.reloadFromDisk(ch.path); }
    await C.Explorer.refresh(); await this.refresh(true);
  },
  async diff(ch) {
    const C = this.ctx;
    let base = '';
    if (this.link.index[ch.rel]) { try { base = new TextDecoder().decode(b64ToBytes(await this.downloadBlob(this.link.index[ch.rel]))); } catch (e) { base = ''; } }
    let cur = '';
    if (ch.kind !== 'D') { try { cur = (await C.native('fs.read', { path: ch.path })).content; } catch (e) {} }
    C.openDiff(ch.rel, base, cur, ch.path);
  },

  // ---- Kaynak Denetimi görünümü
  render() {
    const C = this.ctx; if (!C) return;
    const root = document.getElementById('scmRoot'); if (!root) return;
    const esc = C.esc, tr = this.tr();
    const badge = document.querySelector('.ab-item[data-view=scm] .ab-badge');
    const n = this.link ? this.changes.length : 0;
    const ab = document.querySelector('.ab-item[data-view=scm]');
    if (ab) { if (n && !badge) ab.insertAdjacentHTML('beforeend', `<span class="ab-badge">${n}</span>`); else if (badge) { if (n) badge.textContent = n; else badge.remove(); } }
    if (!this.token) {
      root.innerHTML = `<div class="empty-view">
        <p>${tr ? 'Dosyalarını doğrudan GitHub\'a gönderebilir (commit + push), depolarını klonlayabilir ve güncelleyebilirsin (pull).' : 'Commit, push, pull and clone GitHub repositories.'}</p>
        <button class="btn-primary wide" data-act="signin"><i class="codicon codicon-github"></i> ${tr ? 'GitHub\'a Giriş Yap' : 'Sign in to GitHub'}</button>
        <p class="dim small" style="margin-top:12px">${tr ? 'Giriş için bir <b>Personal Access Token</b> gerekir: github.com → Settings → Developer settings → Personal access tokens → Fine-grained → Repository access: All repositories → Permissions: <b>Contents</b> ve <b>Administration</b> (Read and write). Token iPad\'in Anahtar Zinciri\'nde saklanır.' : 'Requires a fine-grained PAT with Contents + Administration read/write.'}</p>
      </div>`;
    } else if (!this.link) {
      root.innerHTML = `<div class="empty-view">
        <p class="dim">${tr ? 'Giriş yapıldı:' : 'Signed in:'} <b>${esc(this.user ? this.user.login : '')}</b></p>
        <p>${tr ? 'Bu çalışma alanı henüz bir GitHub deposuna bağlı değil.' : 'No repository linked.'}</p>
        <button class="btn-primary wide" data-act="publish"><i class="codicon codicon-cloud-upload"></i> ${tr ? 'GitHub\'da Yayımla (yeni depo)' : 'Publish to GitHub'}</button><p></p>
        <button class="btn-secondary wide" data-act="clone"><i class="codicon codicon-repo-clone"></i> ${tr ? 'Depoyu Klonla' : 'Clone Repository'}</button><p></p>
        <button class="btn-secondary wide" data-act="link"><i class="codicon codicon-link"></i> ${tr ? 'Klasörü mevcut depoya bağla' : 'Link folder to existing repo'}</button>
        <p class="dim small" style="margin-top:14px"><a href="#" data-act="signout">${tr ? 'Çıkış yap' : 'Sign out'}</a></p>
      </div>`;
    } else {
      const L = this.link;
      const color = { M: 'git-m', U: 'git-u', D: 'git-d' };
      root.innerHTML = `
        <div class="scm-repo"><i class="codicon codicon-repo"></i> <a href="#" data-act="open">${esc(L.owner)}/${esc(L.repo)}</a> <span class="dim"><i class="codicon codicon-git-branch"></i>${esc(L.branch)}${L.root ? ' · ' + esc(L.root) + '/' : ''}</span>
          <span class="scm-actions"><i class="codicon codicon-refresh" data-act="refresh" title="${tr ? 'Yenile' : 'Refresh'}"></i><i class="codicon codicon-repo-pull" data-act="pull" title="Pull"></i><i class="codicon codicon-ellipsis" data-act="more"></i></span></div>
        <div class="scm-box"><textarea id="scmMsg" rows="2" placeholder="${tr ? 'Mesaj (commit için ⌘↵)' : 'Message (⌘↵ to commit)'}" autocapitalize="sentences"></textarea>
          <button class="btn-primary wide" data-act="commit" ${this.busy ? 'disabled' : ''}><i class="codicon codicon-check"></i> ${this.busy ? (tr ? 'Çalışıyor…' : 'Working…') : (tr ? 'Commit ve Push' : 'Commit & Push')}</button></div>
        <div class="pane-header expanded"><i class="codicon codicon-chevron-down twist"></i><span>${tr ? 'DEĞİŞİKLİKLER' : 'CHANGES'}</span><span class="badge">${this.changes.length}</span></div>
        <div class="scm-list">${this.changes.length ? this.changes.map((c, i) => `<div class="row scm-row" data-i="${i}" style="padding-left:16px"><span class="ficon">${C.iconHTML(c.path)}</span><span class="label ${c.kind === 'D' ? 'scm-del' : ''}">${esc(c.rel.split('/').pop())} <span class="dim">${esc(c.rel.includes('/') ? c.rel.slice(0, c.rel.lastIndexOf('/')) : '')}</span></span><span class="scm-row-acts"><i class="codicon codicon-discard" data-act="discard" title="${tr ? 'Değişiklikleri at' : 'Discard'}"></i></span><span class="scm-kind ${color[c.kind]}">${c.kind}</span></div>`).join('') : `<div class="empty-view"><p class="dim">${tr ? 'Değişiklik yok. Her şey GitHub ile eşit.' : 'No changes.'}</p></div>`}</div>
        ${L.head ? `<p class="dim small" style="padding:6px 20px">${tr ? 'Son eşitleme:' : 'Last sync:'} ${esc(L.head.slice(0, 7))}</p>` : ''}`;
      const msg = root.querySelector('#scmMsg');
      if (this._draft) msg.value = this._draft;
      msg.addEventListener('input', () => { this._draft = msg.value; });
      msg.addEventListener('keydown', (e) => { if (e.metaKey && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.doCommit(); } });
      root.querySelectorAll('.scm-row').forEach((r) => r.addEventListener('click', (e) => {
        const ch = this.changes[+r.dataset.i];
        if (e.target.closest('[data-act=discard]')) { e.stopPropagation(); this.discard(ch); return; }
        this.diff(ch);
      }));
    }
    root.querySelectorAll('[data-act]').forEach((el) => {
      if (el.closest('.scm-row')) return;
      el.addEventListener('click', (e) => { e.preventDefault(); this.action(el.dataset.act, el); });
    });
  },
  async doCommit() {
    const msg = document.getElementById('scmMsg');
    this.busy = true; this.render();
    try { const ok = await this.commitPush(this._draft || ''); if (ok) this._draft = ''; }
    catch (e) { this.ctx.notify('error', 'Push: ' + e.message); }
    finally { this.busy = false; this.render(); }
  },
  async action(act, el) {
    const C = this.ctx;
    try {
      switch (act) {
        case 'signin': await this.signIn(); break;
        case 'signout': await this.signOut(); break;
        case 'publish': await this.publish(); break;
        case 'clone': await this.clone(); break;
        case 'link': await this.linkExisting(); break;
        case 'refresh': await this.refresh(); break;
        case 'commit': await this.doCommit(); break;
        case 'pull': this.busy = true; this.render(); try { await this.pull(); } finally { this.busy = false; await this.refresh(true); } break;
        case 'open': C.native('app.openURL', { url: `https://github.com/${this.link.owner}/${this.link.repo}` }); break;
        case 'more': {
          const r = el.getBoundingClientRect();
          C.Menu.show([
            { label: 'Pull', run: () => this.action('pull') },
            { label: this.L('GitHub\'da aç', 'Open on GitHub'), run: () => this.action('open') },
            '-',
            { label: this.L('Depo bağlantısını kaldır', 'Unlink repository'), run: () => this.unlink() },
            { label: this.L('Çıkış yap', 'Sign out'), run: () => this.signOut() }
          ], r.left - 150, r.bottom + 2);
          break;
        }
      }
    } catch (e) { C.notify('error', e.message); this.busy = false; this.render(); }
  }
};

window.VSCModules.push((ctx) => { Git.ctx = ctx; ctx.Git = Git; });
window.VSCGit = Git;
})();
