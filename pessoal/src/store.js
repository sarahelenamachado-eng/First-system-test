/* Armazenamento local. Dois modos:
 *
 *   pasta      -> uma pasta do computador escolhida pelo usuário (File System Access API, Edge/Chrome):
 *                   <pasta>/db.json          base de dados pessoal
 *                   <pasta>/SUMARIOS/...     sumários diários salvos em HTML
 *   navegador  -> tudo guardado no próprio navegador (IndexedDB). Funciona em qualquer navegador,
 *                 mas os dados ficam só neste computador/navegador (use Config. → Backup).
 *
 * A referência à pasta e a chave da IA ficam no IndexedDB do navegador (nunca dentro da pasta).
 */
const KV = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("atividades-pessoais-ia", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res((this._db = r.result));
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res, rej) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  },
};

const Store = {
  mode: "",   // "pasta" | "navegador"
  root: null,
  name: "",

  supported: () => typeof window.showDirectoryPicker === "function",

  async pick() {
    const h = await window.showDirectoryPicker({ id: "atividades-pessoais", mode: "readwrite" });
    await this.use(h);
  },
  async use(h) {
    this.mode = "pasta";
    this.root = h;
    this.name = h.name;
    await KV.set("root", h).catch(() => {});
    await KV.set("mode", "pasta").catch(() => {});
  },
  async useBrowser() {
    this.mode = "navegador";
    this.root = null;
    this.name = "este navegador";
    await KV.set("mode", "navegador").catch(() => {});
  },
  async rememberedMode() { try { return (await KV.get("mode")) || ""; } catch { return ""; } },
  /** Pasta usada da última vez; precisa de permissão (clique do usuário) para reabrir. */
  async remembered() {
    try { return (await KV.get("root")) || null; } catch { return null; }
  },
  async hasPermission(h) { return (await h.queryPermission({ mode: "readwrite" })) === "granted"; },
  async requestPermission(h) { return (await h.requestPermission({ mode: "readwrite" })) === "granted"; },

  _split(path) { return path.split("/").filter(Boolean); },
  async dir(path, create = true) {
    let h = this.root;
    for (const p of this._split(path)) h = await h.getDirectoryHandle(p, { create });
    return h;
  },
  async write(path, data) {
    const parts = this._split(path), name = parts.pop();
    const fh = await (await this.dir(parts.join("/"), true)).getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  },
  async read(path) {
    try {
      const parts = this._split(path), name = parts.pop();
      return await (await (await this.dir(parts.join("/"), false)).getFileHandle(name)).getFile();
    } catch { return null; }
  },

  async loadDB() {
    if (this.mode === "pasta") {
      const f = await this.read("db.json");
      return f ? JSON.parse(await f.text()) : null;
    }
    const raw = await KV.get("db").catch(() => null);
    return raw ? JSON.parse(raw) : null;
  },
  async saveDB(db) {
    const json = JSON.stringify(db, null, 2);
    if (this.mode === "pasta") await this.write("db.json", json);
    else await KV.set("db", json);
  },
};
