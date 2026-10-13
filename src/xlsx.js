/* Leitor mínimo de .xlsx (primeira planilha) e .csv, sem bibliotecas externas.
 * .xlsx é um zip de XMLs: lemos o diretório central do zip e descompactamos com DecompressionStream. */
const Sheet = {
  async unzip(buf) {
    const dv = new DataView(buf), dec = new TextDecoder();
    let e = buf.byteLength - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("Arquivo .xlsx inválido");
    const count = dv.getUint16(e + 10, true);
    let off = dv.getUint32(e + 16, true);
    const files = {};
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      const nl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
      const local = dv.getUint32(off + 42, true);
      files[dec.decode(new Uint8Array(buf, off + 46, nl))] = { method, csize, local };
      off += 46 + nl + xl + cl;
    }
    return async (name) => {
      const f = files[name];
      if (!f) return null;
      const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
      const data = new Uint8Array(buf, start, f.csize);
      if (f.method === 0) return dec.decode(data);
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    };
  },

  async readXlsx(file) {
    const get = await this.unzip(await file.arrayBuffer());
    const xml = (s) => (s ? new DOMParser().parseFromString(s, "application/xml") : null);
    const byTag = (doc, tag) => (doc ? [...doc.getElementsByTagNameNS("*", tag)] : []);

    // primeira aba
    let sheetPath = "xl/worksheets/sheet1.xml";
    const wb = xml(await get("xl/workbook.xml")), rels = xml(await get("xl/_rels/workbook.xml.rels"));
    const first = byTag(wb, "sheet")[0];
    if (first && rels) {
      const rid = first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const rel = byTag(rels, "Relationship").find((r) => r.getAttribute("Id") === rid);
      if (rel) { const t = rel.getAttribute("Target"); sheetPath = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""); }
    }
    const shared = byTag(xml(await get("xl/sharedStrings.xml")), "si").map((si) => byTag(si, "t").map((t) => t.textContent).join(""));

    // estilos de data (para converter o número serial do Excel em AAAA-MM-DD)
    const styles = xml(await get("xl/styles.xml"));
    const customDate = new Set(byTag(styles, "numFmt").filter((n) => /[dmy]/i.test((n.getAttribute("formatCode") || "").replace(/"[^"]*"|\[[^\]]*\]/g, ""))).map((n) => +n.getAttribute("numFmtId")));
    const xfs = (() => { const cx = byTag(styles, "cellXfs")[0]; return cx ? byTag(cx, "xf").map((x) => +x.getAttribute("numFmtId")) : []; })();
    const isDateFmt = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDate.has(id);
    const serialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 864e5)).toISOString().slice(0, 10);

    const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const rowIdx = (ref) => +ref.replace(/[A-Z]+/g, "") - 1;
    const sheet = xml(await get(sheetPath));
    const grid = [];
    for (const row of byTag(sheet, "row")) {
      for (const c of byTag(row, "c")) {
        const ref = c.getAttribute("r") || "A1";
        const t = c.getAttribute("t"), v = byTag(c, "v")[0]?.textContent ?? "";
        let val = v;
        if (t === "s") val = shared[+v] ?? "";
        else if (t === "inlineStr") val = byTag(c, "t").map((x) => x.textContent).join("");
        else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
        else if (v !== "" && !t && isDateFmt(xfs[+(c.getAttribute("s") || 0)] ?? 0)) val = serialToDate(+v);
        (grid[rowIdx(ref)] ??= [])[colIdx(ref)] = val;
      }
    }
    // células mescladas: o valor do canto superior esquerdo vale para todo o intervalo
    for (const m of byTag(sheet, "mergeCell")) {
      const [a, b] = (m.getAttribute("ref") || "").split(":");
      if (!b) continue;
      const r0 = rowIdx(a), c0 = colIdx(a), r1 = rowIdx(b), c1 = colIdx(b);
      const val = grid[r0]?.[c0] ?? "";
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r !== r0 || c !== c0) (grid[r] ??= [])[c] = val;
    }
    const rows = [];
    for (const r of grid) {
      const filled = Array.from(r || [], (x) => (x ?? "").toString());
      if (filled.some((x) => x.trim() !== "")) rows.push(filled);
    }
    return rows;
  },

  parseCsv(text) {
    const first = text.split(/\r?\n/, 1)[0];
    const delim = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((x) => x !== "")) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((x) => x !== "")) rows.push(row);
    return rows;
  },

  /** Retorna linhas da tabela ou null se o formato não for legível. */
  async table(file) {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "csv" || ext === "txt") return this.parseCsv((await file.text()).replace(/^﻿/, ""));
    if (ext === "xlsx" || ext === "xlsm") return this.readXlsx(file);
    return null;
  },
};
