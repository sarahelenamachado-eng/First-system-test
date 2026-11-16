/* Leitor de .xlsx com TODAS as abas (sem bibliotecas externas).
 * Retorna { sheets: [{ name, grid, merges }] } onde grid[linha][coluna] = valor (string | number).
 * Datas do Excel viram "AAAA-MM-DD". Baseado em src/xlsx.js da plataforma de governança. */
const Book = {
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

  async read(file) {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "csv" || ext === "txt") return { sheets: [{ name: file.name, grid: this.parseCsv((await file.text()).replace(/^﻿/, "")), merges: [] }] };
    const get = await this.unzip(await file.arrayBuffer());
    const xml = (s) => (s ? new DOMParser().parseFromString(s, "application/xml") : null);
    const byTag = (doc, tag) => (doc ? [...doc.getElementsByTagNameNS("*", tag)] : []);
    const wb = xml(await get("xl/workbook.xml")), rels = xml(await get("xl/_rels/workbook.xml.rels"));
    const shared = byTag(xml(await get("xl/sharedStrings.xml")), "si").map((si) => byTag(si, "t").map((t) => t.textContent).join(""));
    const styles = xml(await get("xl/styles.xml"));
    const customDate = new Set(byTag(styles, "numFmt").filter((n) => /[dmy]/i.test((n.getAttribute("formatCode") || "").replace(/"[^"]*"|\[[^\]]*\]/g, ""))).map((n) => +n.getAttribute("numFmtId")));
    const xfs = (() => { const cx = byTag(styles, "cellXfs")[0]; return cx ? byTag(cx, "xf").map((x) => +x.getAttribute("numFmtId")) : []; })();
    const isDateFmt = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDate.has(id);
    const serialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 864e5)).toISOString().slice(0, 10);
    const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const rowIdx = (ref) => +ref.replace(/[A-Z]+/g, "") - 1;

    const out = [];
    for (const s of byTag(wb, "sheet")) {
      const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const rel = byTag(rels, "Relationship").find((r) => r.getAttribute("Id") === rid);
      if (!rel) continue;
      const t = rel.getAttribute("Target");
      const path = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
      const sheet = xml(await get(path));
      if (!sheet) continue;
      const grid = [];
      for (const row of byTag(sheet, "row")) {
        for (const c of byTag(row, "c")) {
          const ref = c.getAttribute("r") || "A1";
          const ty = c.getAttribute("t"), v = byTag(c, "v")[0]?.textContent ?? "";
          let val = v;
          if (ty === "s") val = shared[+v] ?? "";
          else if (ty === "inlineStr") val = byTag(c, "t").map((x) => x.textContent).join("");
          else if (ty === "str" || ty === "e") val = v;
          else if (ty === "b") val = v === "1" ? "TRUE" : "FALSE";
          else if (v !== "" && isDateFmt(xfs[+(c.getAttribute("s") || 0)] ?? 0)) val = serialToDate(+v);
          else if (v !== "" && !isNaN(+v)) val = +v;
          if (val !== "") (grid[rowIdx(ref)] ??= [])[colIdx(ref)] = val;
        }
      }
      const merges = byTag(sheet, "mergeCell").map((m) => {
        const [a, b] = (m.getAttribute("ref") || "").split(":");
        return b ? { r0: rowIdx(a), c0: colIdx(a), r1: rowIdx(b), c1: colIdx(b) } : null;
      }).filter(Boolean);
      out.push({ name: s.getAttribute("name") || path, grid, merges });
    }
    return { sheets: out };
  },

  /** Cópia da grade com o valor de cada célula mesclada repetido no intervalo todo. */
  filled(sheet) {
    const g = sheet.grid.map((r) => (r ? [...r] : []));
    for (const m of sheet.merges) {
      const val = g[m.r0]?.[m.c0];
      if (val === undefined) continue;
      for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) (g[r] ??= [])[c] = val;
    }
    return g;
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
        row.push(cell); cell = ""; rows.push(row); row = [];
      } else cell += ch;
    }
    row.push(cell); rows.push(row);
    return rows;
  },
};
