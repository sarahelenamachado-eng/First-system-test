/* Base de dados: salva automaticamente no navegador (IndexedDB) e, se você escolher uma pasta de trabalho
 * (Edge/Chrome), também em <pasta>/custos-aduaneiros.json + cópia das planilhas importadas em <pasta>/SANTOS_BRASIL e <pasta>/RED_CHANNEL.
 * A pasta pode ser do OneDrive/SharePoint para ter backup e compartilhar com a equipe. */
const KV = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("custos-aduaneiros", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res((this._db = r.result));
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
};

const DB_FILE = "custos-aduaneiros.json";

const Data = {
  db: null,
  folder: null,

  empty() {
    return { version: 1, processes: {}, red: {}, notes: {}, rules: DEFAULT_RULES.map((r) => ({ ...r })), settings: { freeDays: 15, usdRate: 5.4 }, log: [] };
  },

  async load() {
    let db = null;
    try { db = await KV.get("db"); } catch { /* navegador sem IndexedDB */ }
    if (!db) { try { db = JSON.parse(localStorage.getItem("custos-aduaneiros-db") || "null"); } catch { db = null; } }
    this.db = Object.assign(this.empty(), db || {});
    try {
      const h = await KV.get("folder");
      if (h && (await h.queryPermission({ mode: "readwrite" })) === "granted") await this.useFolder(h, true);
      else if (h) this.pendingFolder = h;
    } catch { /* sem pasta */ }
  },

  async save() {
    this.db.savedAt = new Date().toISOString();
    try { await KV.set("db", this.db); } catch { try { localStorage.setItem("custos-aduaneiros-db", JSON.stringify(this.db)); } catch { /* cheio */ } }
    if (this.folder) { try { await this.write(DB_FILE, JSON.stringify(this.db, null, 1)); } catch (e) { console.warn("Falha ao gravar na pasta", e); } }
  },

  log(msg) { this.db.log.unshift({ at: new Date().toISOString(), msg }); this.db.log.length = Math.min(this.db.log.length, 300); },

  /* ---------- pasta de trabalho (opcional) */
  folderSupported: () => typeof window.showDirectoryPicker === "function",
  async pickFolder() {
    const h = await window.showDirectoryPicker({ id: "custos-aduaneiros", mode: "readwrite" });
    await this.useFolder(h);
  },
  async reconnect() {
    const h = this.pendingFolder;
    if (h && (await h.requestPermission({ mode: "readwrite" })) === "granted") { await this.useFolder(h); this.pendingFolder = null; return true; }
    return false;
  },
  async useFolder(h, silent) {
    this.folder = h;
    await KV.set("folder", h).catch(() => {});
    // se a pasta já tem uma base mais recente, ela prevalece
    try {
      const f = await (await h.getFileHandle(DB_FILE)).getFile();
      const other = JSON.parse(await f.text());
      if (!this.db.savedAt || (other.savedAt && other.savedAt > this.db.savedAt) || !Object.keys(this.db.processes).length) {
        this.db = Object.assign(this.empty(), other);
        await KV.set("db", this.db).catch(() => {});
        return;
      }
    } catch { /* ainda não existe */ }
    if (!silent) await this.save();
  },
  async write(path, data) {
    const parts = path.split("/").filter(Boolean), name = parts.pop();
    let d = this.folder;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(data); await w.close();
  },

  /* ---------- consultas */
  rules() { return this.db.rules?.length ? this.db.rules : DEFAULT_RULES; },
  freeDays() { return +this.db.settings.freeDays || 15; },
  analysis(id) { const P = this.db.processes[id]; return P ? analyze(P, this.rules(), this.freeDays()) : null; },

  /** Lista unificada: processos com demonstrativo + processos só no controle de canal. */
  rows() {
    const ids = new Set([...Object.keys(this.db.processes), ...Object.keys(this.db.red)]);
    return [...ids].map((id) => {
      const P = this.db.processes[id] || null, R = this.db.red[id] || null;
      return { id, P, R, A: P ? analyze(P, this.rules(), this.freeDays()) : null };
    }).sort((a, b) => (b.A?.total || 0) - (a.A?.total || 0) || a.id.localeCompare(b.id));
  },

  upsertProcess(P) {
    const prev = this.db.processes[P.id];
    this.db.processes[P.id] = P;
    this.log(`${prev ? "Atualizado" : "Importado"} demonstrativo ${P.id} (${P.containers.length} contêineres, arquivo ${P.file})`);
  },
  upsertRed(rec, merge = true) {
    const prev = this.db.red[rec.id] || {};
    const clean = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== "" && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)));
    this.db.red[rec.id] = merge ? { ...prev, ...clean, updatedAt: new Date().toISOString() } : { ...rec, updatedAt: new Date().toISOString() };
  },
};
