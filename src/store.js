/* Armazenamento local: uma pasta do computador escolhida pelo usuário (File System Access API, Edge/Chrome).
 *
 *   <pasta escolhida>/
 *     db.json                                         -> base de dados de governança
 *     PROJECTS/PROJ001 INFOS AND GENERAL OVERVIEW/master_schedule/...
 *     RISKS/RISK001 INFOS AND GENERAL OVERVIEW/...
 *     MEETINGS/MEET001/...
 *     SUMMARIES/...
 *
 * A referência à pasta e a chave da IA ficam no IndexedDB do navegador (nunca dentro da pasta,
 * que pode ser compartilhada).
 */
const KV = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("governanca-ia", 1);
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
  root: null,
  name: "",

  supported: () => typeof window.showDirectoryPicker === "function",

  async pick() {
    const h = await window.showDirectoryPicker({ id: "governanca-ia", mode: "readwrite" });
    await this.use(h);
  },
  async use(h) {
    this.root = h;
    this.name = h.name;
    await KV.set("root", h).catch(() => {});
  },
  /** Pasta usada da última vez; precisa de permissão (clique do usuário) para reabrir. */
  async remembered() {
    try { return (await KV.get("root")) || null; } catch { return null; }
  },
  async hasPermission(h) {
    return (await h.queryPermission({ mode: "readwrite" })) === "granted";
  },
  async requestPermission(h) {
    return (await h.requestPermission({ mode: "readwrite" })) === "granted";
  },

  _split(path) { return path.split("/").filter(Boolean); },
  async dir(path, create = true) {
    let h = this.root;
    for (const p of this._split(path)) h = await h.getDirectoryHandle(p, { create });
    return h;
  },
  async fileHandle(path, create = false) {
    const parts = this._split(path), name = parts.pop();
    const d = await this.dir(parts.join("/"), create);
    return d.getFileHandle(name, { create });
  },
  async write(path, data) {
    const fh = await this.fileHandle(path, true);
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  },
  async read(path) {
    try { return await (await this.fileHandle(path)).getFile(); } catch { return null; }
  },
  async exists(path) { return (await this.read(path)) !== null; },
  async remove(path) {
    const parts = this._split(path), name = parts.pop();
    try { await (await this.dir(parts.join("/"), false)).removeEntry(name); } catch { /* já removido */ }
  },
  /** Lista arquivos recursivamente: [{name, rel, folder, size, modified}] */
  async list(path) {
    const out = [];
    let base;
    try { base = await this.dir(path, false); } catch { return out; }
    const walk = async (h, rel) => {
      for await (const [n, e] of h.entries()) {
        const r = rel ? rel + "/" + n : n;
        if (e.kind === "directory") await walk(e, r);
        else {
          const f = await e.getFile();
          out.push({ name: n, rel: path + "/" + r, folder: rel || ".", size: f.size, modified: new Date(f.lastModified).toISOString().slice(0, 19) });
        }
      }
    };
    await walk(base, "");
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  },
  safeName(name) {
    return (String(name || "arquivo").split(/[\\/]/).pop().replace(/[^\p{L}\p{N}\-. ()_]+/gu, "_").trim()) || "arquivo";
  },
  /** Grava sem sobrescrever: "arquivo (1).xlsx" se já existir. */
  async writeUnique(folder, name, data) {
    name = this.safeName(name);
    const dot = name.lastIndexOf("."), root = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    let rel = folder + "/" + name, n = 1;
    while (await this.exists(rel)) rel = `${folder}/${root} (${n++})${ext}`;
    await this.write(rel, data);
    return rel;
  },
};
