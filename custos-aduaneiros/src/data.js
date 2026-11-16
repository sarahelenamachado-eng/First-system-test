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
    return {
      version: 2, processes: {}, red: {}, notes: {}, pay: {}, uploads: [], history: null, payments: [],
      rules: DEFAULT_RULES.map((r) => ({ ...r })), tariff: DEFAULT_TARIFF.map((t) => ({ ...t })),
      settings: { freeDays: 15, demurrageDays: 40 }, log: [],
    };
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
  tariff() { return this.db.tariff?.length ? this.db.tariff : DEFAULT_TARIFF; },
  freeDays() { return +this.db.settings.freeDays || 15; },
  analysis(id) { const P = this.db.processes[id]; return P ? analyze(P, this.rules(), this.freeDays(), this.tariff()) : null; },
  hist(id) { return this.db.history?.processes?.[id] || null; },

  /** Canal e situação unificados: planilha Red Channel > histórico COMEX > demonstrativo. */
  merged(id, P, R, A, H) {
    const channel = R?.channel || H?.channel || "";
    // na COMEX, "clearance completed" anterior à presença de carga é a data de registro da DUIMP: não vale como desembaraço
    const hCleared = H?.cleared && (!H.presence || H.cleared >= H.presence) ? H.cleared : "";
    let stage = "";
    if (R ? R.status === "Desembaraçado" || R.clearedAt : hCleared) stage = "cleared";
    else if (R) stage = (R.rounds || []).some((r) => r.req && !r.sub) ? "pending" : "inspection";
    if (A?.lastExit && A.lastExit <= new Date().toISOString().slice(0, 10) && (stage === "cleared" || H?.pickup)) stage = "out";
    if (!stage && P) stage = "unknown";
    const green = channel === "Verde";
    const mapaFlag = !!(A && green && A.extra_customs > 0.004);
    return { channel, stage, clearedAt: R ? R.clearedAt || "" : hCleared, mapaFlag, channelSource: R?.channel ? "red" : H?.channel ? "comex" : "" };
  },

  /** Processos acompanhados = os que têm demonstrativo da Santos Brasil. A planilha Red Channel só complementa. */
  rows(includeRedOnly = false) {
    const ids = new Set(Object.keys(this.db.processes));
    if (includeRedOnly) Object.keys(this.db.red).forEach((k) => ids.add(k));
    return [...ids].map((id) => {
      const P = this.db.processes[id] || null, R = this.db.red[id] || null, H = this.hist(id);
      const A = P ? analyze(P, this.rules(), this.freeDays(), this.tariff()) : null;
      return { id, P, R, A, H, M: this.merged(id, P, R, A, H) };
    }).sort((a, b) => (b.A?.total || 0) - (a.A?.total || 0) || a.id.localeCompare(b.id));
  },
  redOnly() { return Object.keys(this.db.red).filter((id) => !this.db.processes[id]); },

  /* ---------- importações (cada arquivo vira um registro que pode ser excluído) */
  newUpload(name, kind) {
    const u = { id: "U" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, kind, at: new Date().toISOString(), ids: [], prev: {} };
    this.db.uploads.unshift(u);
    return u;
  },
  upsertProcess(P, u) {
    const prev = this.db.processes[P.id];
    u.prev[P.id] = prev ? JSON.parse(JSON.stringify(prev)) : null;
    u.ids.push(P.id);
    this.db.processes[P.id] = { ...P, uploadId: u.id };
    this.log(`${prev ? "Atualizado" : "Importado"} demonstrativo ${P.id} (${P.containers.length} contêineres, arquivo ${P.file})`);
  },
  upsertRed(rec, u) {
    const prev = this.db.red[rec.id] || null;
    u.prev[rec.id] = prev ? JSON.parse(JSON.stringify(prev)) : null;
    u.ids.push(rec.id);
    const clean = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== "" && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)));
    this.db.red[rec.id] = { ...(prev || {}), ...clean, uploadId: u.id, updatedAt: new Date().toISOString() };
  },
  setHistory(h, u) {
    u.prev.history = this.db.history ? { uploadId: this.db.history.uploadId } : null;
    this.db.history = { ...h, payments: undefined, uploadId: u.id, file: u.name, at: u.at };
    this.db.payments = (h.payments || []).map((p) => ({ ...p, uploadId: u.id }));
    u.ids = Object.keys(h.processes);
    this.db.uploads = this.db.uploads.filter((x) => x.kind !== "cx" || x.id === u.id); // só um histórico por vez
  },
  /** Exclui um arquivo importado: desfaz o que ele trouxe (volta à versão anterior, se houver). */
  async deleteUpload(uid) {
    const u = this.db.uploads.find((x) => x.id === uid);
    if (!u) return;
    if (u.kind === "sb" || u.kind === "rc") {
      const store = u.kind === "sb" ? this.db.processes : this.db.red;
      for (const id of new Set(u.ids)) {
        if (store[id]?.uploadId !== uid) continue; // já substituído por outro arquivo
        const prev = u.prev[id];
        if (prev) store[id] = prev; else delete store[id];
      }
    } else if (u.kind === "cx") {
      if (this.db.history?.uploadId === uid) this.db.history = null;
      this.db.payments = (this.db.payments || []).filter((p) => p.uploadId !== uid);
    }
    this.db.uploads = this.db.uploads.filter((x) => x.id !== uid);
    if (this.folder && u.path) { try { const parts = u.path.split("/"); const d = await this.folder.getDirectoryHandle(parts[0]); await d.removeEntry(parts[1]); } catch { /* arquivo já removido */ } }
    this.log(`Excluído o arquivo importado ${u.name}`);
  },
};
