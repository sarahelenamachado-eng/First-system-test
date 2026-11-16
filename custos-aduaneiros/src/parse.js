/* Leitura das planilhas de origem:
 *  1) Demonstrativo de cálculo da Santos Brasil (por processo IRAxxxx-xx): contêineres, serviços, valores, períodos.
 *  2) Planilha "Red Channel Status" (controle manual do desembaraço): canal, exigências, status e próximos passos.
 * As funções trabalham com grades (arrays de linhas), produzidas por Book.read(). */

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u00a0/g, " ").toUpperCase().replace(/\s+/g, " ").trim();

/** "1.770,00" / "2064,14" / 2064.14 -> número */
function num(v) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[R$\s\u00a0]/g, "");
  if (!s) return NaN;
  if (/,\d{1,2}$/.test(s)) return +s.replace(/\./g, "").replace(",", ".");
  return +s.replace(/,/g, "");
}

/** "12/11/2026", "2026-11-12", "12/11" (+ano de referência) -> "2026-11-12" */
function toISO(v, refYear) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") return v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10) : "";
  const s = String(v).replace(/\u00a0/g, " ").trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/(\d{1,2})\/(\d{1,2})(?!\d)/);
  if (m && refYear) return `${refYear}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

/** Número do processo aduaneiro: "IRA2419-26", "IRA 1818/26", "ira2419_26" -> "IRA2419/26" */
function procId(s) {
  const m = String(s ?? "").toUpperCase().match(/IRA\s*[-_]?\s*(\d{3,5})\s*[-\/_ ]\s*(\d{2})(?!\d)/);
  return m ? `IRA${m[1]}/${m[2]}` : "";
}
const procKey = (id) => String(id).replace(/\//g, "-");

/* ------------------------------------------------------------------ classificação dos serviços */

/** Grupos de custo. Regular = custo esperado de todo processo; extras = o que deve ser explicado. */
const GROUPS = {
  regular: { label: "Regular", kpi: "", color: "var(--s-regular)" },
  extra_storage: { label: "Extra · armazenagem além do período livre", short: "Extra armazenagem", kpi: "KPI 1 · Storage", color: "var(--s-storage)" },
  extra_customs: { label: "Extra · inspeção e desembaraço", short: "Extra desembaraço", kpi: "KPI 3 · Customs costs", color: "var(--s-customs)" },
};

/** Regras padrão (a primeira que casar vale). Editáveis em Configurações.
 *  Seguem a planilha de breakdown manual: regular = armazenagem 1º período + escaneamento + carregamento + processamento. */
const DEFAULT_RULES = [
  { match: "ARMAZENAGEM", label: "Armazenagem", group: "storage" },
  { match: "INSPECAO NAO INVASIVA", label: "Escaneamento (inspeção não invasiva)", group: "regular" },
  { match: "CARREGAMENTO", label: "Carregamento (retirada)", group: "regular" },
  { match: "PROCESSAMENTO ELETRONICO", label: "Processamento eletrônico", group: "regular" },
  { match: "POSICIONAMENTO", label: "Posicionamento de contêiner", group: "extra_customs" },
  { match: "COLOCACAO DE LACRE", label: "Colocação de lacre", group: "extra_customs" },
  { match: "RETIRADA DE LACRE", label: "Retirada de lacre", group: "extra_customs" },
  { match: "DESCONSOLIDACAO|DESUNITIZACAO|DESOVA", label: "Desova (desconsolidação)", group: "extra_customs" },
  { match: "CONSOLIDACAO|UNITIZACAO|OVA ", label: "Ova (consolidação)", group: "extra_customs" },
  { match: "EXAME|LAUDO|AMOSTRA", label: "Exames e laudos", group: "extra_customs" },
  { match: "MOVIMENTACAO", label: "Movimentações adicionais", group: "extra_customs" },
];

function classify(name, rules) {
  const n = norm(name);
  for (const r of rules) {
    let re;
    try { re = new RegExp(norm(r.match).split("|").map((x) => x.replace(/[.*+?^${}()[\]\\]/g, "\\$&")).join("|")); } catch { continue; }
    if (re.test(n)) return r;
  }
  return { match: "", label: String(name).replace(/\s*-\s*IMPORTA[CÇ][AÃ]O\s*$/i, "").trim() || "Outro serviço", group: "extra_customs", unknown: true };
}

/** Divide a armazenagem pelos períodos descritos na OBS ("HOUSE 1º Período (15 dias) ... R$=2064,14 de :08/08/2026 a 22/08/2026"). */
function storagePeriods(obs) {
  const out = [];
  const re = /(\d+)\s*[º°o]?\s*Per[ií]odo\s*\((\d+)\s*dias?\)[^\n]*?R\$\s*=\s*([\d.,]+)(?:[^\n]*?de\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4}))?/gi;
  let m;
  while ((m = re.exec(obs))) out.push({ n: +m[1], days: +m[2], value: num(m[3]), from: toISO(m[4]), to: toISO(m[5]) });
  return out;
}

/* ------------------------------------------------------------------ Santos Brasil */

const SB = {
  /** Aba com o demonstrativo: a que tiver mais rótulos "Contêiner:" + "Serviço:"; prefere "Santos Brasil Details". */
  pickSheet(book) {
    const score = (sh) => {
      let s = 0;
      for (const r of sh.grid) for (const c of r || []) { const n = norm(c); if (n === "CONTEINER:" || n === "SERVICO:") s++; }
      return s + (/santos/i.test(sh.name) ? 1000 : 0) * (s > 0 ? 1 : 0);
    };
    return [...book.sheets].map((sh) => ({ sh, s: score(sh) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.sh || null;
  },

  parse(book, fileName) {
    const sheet = this.pickSheet(book);
    if (!sheet) throw new Error("Não encontrei o demonstrativo da Santos Brasil (rótulos \"Contêiner:\" e \"Serviço:\") em nenhuma aba.");
    const P = {
      id: procId(fileName), file: fileName, sheet: sheet.name, importedAt: new Date().toISOString(),
      bl: "", duimp: "", vessel: "", voyage: "", rps: "", nfe: "", client: "", broker: "", table: "", origin: "",
      cifUsd: null, cifBrl: null, periodFrom: "", periodTo: "", calcDate: "", issuedAt: "",
      containers: [], blTotal: null, grandTotal: null, warnings: [],
    };
    let C = null, S = null;
    const rows = sheet.grid;

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri] || [];
      const cells = [];
      row.forEach((v, ci) => { if (v !== undefined && v !== "") cells.push({ ci, v }); });
      if (!cells.length) continue;
      const after = (k) => { for (let j = k + 1; j < cells.length; j++) if (!/:\s*_*$/.test(String(cells[j].v)) || typeof cells[j].v === "number") return cells[j].v; return ""; };
      let labelled = false;

      for (let k = 0; k < cells.length; k++) {
        const raw = String(cells[k].v), n = norm(raw);
        if (typeof cells[k].v === "number") continue;
        const lab = (re) => re.test(n);
        if (lab(/^EMISSAO:/)) { P.issuedAt = raw.replace(/^.*?:\s*/, "").trim(); labelled = true; }
        else if (lab(/^NAVIO:$/)) { P.vessel = String(after(k)); labelled = true; }
        else if (lab(/^VIAGEM:$/)) { P.voyage = String(after(k)); labelled = true; }
        else if (lab(/^RPS:$/)) { P.rps = String(after(k)); labelled = true; }
        else if (lab(/^NFE:$/)) { P.nfe = String(after(k)); labelled = true; }
        else if (lab(/^CLIENTE:$/)) { P.client = String(after(k)); labelled = true; }
        else if (lab(/^DESPACHANTE:$/)) { P.broker = String(after(k)); labelled = true; }
        else if (lab(/^TABELA:$/)) { P.table = String(after(k)); labelled = true; }
        else if (lab(/^BL:$/)) { P.bl = String(after(k)).trim(); labelled = true; }
        else if (lab(/^VALOR CIF \(US\$\):$/)) { P.cifUsd = num(after(k)); labelled = true; }
        else if (lab(/^VALOR CIF \(R\$\):$/)) { P.cifBrl = num(after(k)); labelled = true; }
        else if (lab(/^PORTO:$/)) { P.origin = String(after(k)); labelled = true; }
        else if (lab(/^DOC\. SAIDA:$/)) { P.duimp = String(after(k)).trim(); labelled = true; }
        else if (lab(/^PERIODO:$/)) { P.periodFrom = toISO(after(k)); labelled = true; }
        else if (lab(/^A:$/) && P.periodFrom && !P.periodTo) { P.periodTo = toISO(after(k)); labelled = true; }
        else if (lab(/^CALCULO PREV\.:$/)) { P.calcDate = toISO(after(k)); labelled = true; }
        else if (lab(/^CONTEINER:$/)) {
          C = { id: String(after(k)).trim(), entry: "", exit: "", limit: "", periods: null, stay: null, regimeChange: "", services: [], reported: null };
          P.containers.push(C); S = null; labelled = true;
        }
        else if (lab(/^DATA ENTRADA:$/) && C) { C.entry = toISO(after(k)); labelled = true; }
        else if (lab(/^DATA SAIDA:$/) && C) { C.exit = toISO(after(k)); labelled = true; }
        else if (lab(/^LIMITE SAIDA:$/) && C) { C.limit = toISO(after(k)); labelled = true; }
        else if (lab(/^PERIODOS:/) && C) { C.periods = num(after(k)); labelled = true; }
        else if (lab(/^ESTADIA:$/) && C) { C.stay = parseInt(String(after(k)), 10) || null; labelled = true; }
        else if (lab(/^MUDANCA DE REGIME:$/) && C) { C.regimeChange = String(after(k)); labelled = true; }
        else if (lab(/^SERVICO:$/) && C) {
          S = { name: String(after(k)).trim(), code: "", value: 0, obs: "" };
          C.services.push(S); labelled = true;
        }
        else if (lab(/^CODIGO:$/) && S) { S.code = String(after(k)); labelled = true; }
        else if (lab(/^VALOR SERVICO:$/) && S) { S.value = num(after(k)) || 0; labelled = true; }
        else if (lab(/^OBS:$/) && S) { S.obs = String(after(k)); labelled = true; }
        else if (lab(/^VALOR TOTAL DO CONTEINER/)) {
          const id = (raw.match(/\(([^)]+)\)/) || [])[1]?.trim();
          const c = P.containers.find((x) => x.id === id) || C;
          if (c) c.reported = num(after(k));
          S = null; labelled = true;
        }
        else if (lab(/^VALOR TOTAL DO BL/)) { P.blTotal = num(after(k)); S = null; labelled = true; }
        else if (lab(/^TOTAL GERAL:$/)) { P.grandTotal = num(after(k)); S = null; labelled = true; }
      }
      // linhas de continuação da OBS (períodos de armazenagem, um por linha)
      if (!labelled && S && cells.length === 1 && typeof cells[0].v === "string") S.obs += "\n" + cells[0].v;
      if (P.grandTotal !== null && ri > 0 && !labelled && !S) { /* rodapé: instruções bancárias, ignorado */ }
    }

    if (!P.containers.length) throw new Error("Nenhum contêiner encontrado no demonstrativo.");
    if (!P.id) P.id = procId(P.bl) || "";
    for (const c of P.containers) {
      const sum = c.services.reduce((a, s) => a + s.value, 0);
      if (c.reported !== null && Math.abs(sum - c.reported) > 0.05) P.warnings.push(`Contêiner ${c.id}: soma dos serviços R$ ${sum.toFixed(2)} ≠ total informado R$ ${c.reported.toFixed(2)}`);
    }
    const total = P.containers.reduce((a, c) => a + c.services.reduce((b, s) => b + s.value, 0), 0);
    if (P.grandTotal !== null && Math.abs(total - P.grandTotal) > 0.05) P.warnings.push(`Soma dos contêineres R$ ${total.toFixed(2)} ≠ Total Geral R$ ${P.grandTotal.toFixed(2)}`);
    return P;
  },
};

/** Custos derivados de um processo, segundo as regras atuais. */
function analyze(P, rules, freeDays = 15) {
  const out = { regular: 0, extra_storage: 0, extra_customs: 0, total: 0, lines: [], containers: [], unknown: 0 };
  for (const c of P.containers) {
    const cc = { id: c.id, regular: 0, extra_storage: 0, extra_customs: 0, total: 0, extraDays: 0, dayRate: 0, physical: false, lines: [] };
    for (const s of c.services) {
      const r = classify(s.name, rules);
      if (r.unknown) out.unknown++;
      if (r.group === "storage") {
        const per = storagePeriods(s.obs);
        if (per.length) {
          const first = per.filter((p) => p.n === 1).reduce((a, p) => a + p.value, 0);
          const rest = per.filter((p) => p.n > 1);
          const restVal = Math.max(0, s.value - first);
          cc.lines.push({ label: `${r.label} · 1º período (${per.find((p) => p.n === 1)?.days ?? freeDays} dias)`, key: r.label + " · período livre", group: "regular", value: Math.min(first, s.value), service: s });
          if (restVal > 0.004) {
            const days = rest.reduce((a, p) => a + p.days, 0);
            cc.extraDays += days; cc.dayRate = rest[0]?.value || 0;
            cc.lines.push({ label: `${r.label} · períodos adicionais (${days} dia${days === 1 ? "" : "s"})`, key: "Armazenagem adicional", group: "extra_storage", value: restVal, qty: days, unit: rest[0]?.value, service: s });
          }
        } else cc.lines.push({ label: r.label, key: r.label + " · período livre", group: "regular", value: s.value, service: s });
      } else {
        if (/POSICIONAMENTO/.test(norm(s.name))) cc.physical = true;
        cc.lines.push({ label: r.label, key: r.label, group: r.group, value: s.value, service: s, unknown: !!r.unknown });
      }
    }
    for (const l of cc.lines) { cc[l.group] += l.value; cc.total += l.value; }
    cc.stay = c.stay; cc.entry = c.entry; cc.exit = c.exit; cc.periods = c.periods; cc.reported = c.reported;
    cc.overFree = (c.stay || 0) > freeDays || cc.extraDays > 0;
    out.containers.push(cc);
    for (const l of cc.lines) out.lines.push({ ...l, container: c.id });
    out.regular += cc.regular; out.extra_storage += cc.extra_storage; out.extra_customs += cc.extra_customs; out.total += cc.total;
  }
  out.extra = out.extra_storage + out.extra_customs;
  out.storageFirst = out.lines.filter((l) => l.group === "regular" && /período livre$/.test(l.key)).reduce((a, l) => a + l.value, 0);
  out.n = P.containers.length;
  out.maxStay = Math.max(0, ...P.containers.map((c) => c.stay || 0));
  out.over = out.containers.filter((c) => c.overFree).length;
  out.physical = out.containers.filter((c) => c.physical).length;
  out.firstEntry = P.containers.map((c) => c.entry).filter(Boolean).sort()[0] || P.periodFrom || "";
  out.lastExit = P.containers.map((c) => c.exit).filter(Boolean).sort().pop() || "";
  return out;
}

/* ------------------------------------------------------------------ Red Channel Status */

/** Interpreta a planilha manual de canal vermelho. Cada processo pode ocupar várias linhas
 *  (rótulos + datas); um bloco começa na linha onde aparece um número IRA. */
const RC = {
  COLS: [
    { key: "qty", re: /CONTAINERS? QUANTITY|集装箱/ },
    { key: "batch", re: /BATCH|批次/ },
    { key: "daysHeld", re: /TOTAL DAYS|滞留/ },
    { key: "storageFirst", re: /PORT STORAGE|1ST PERIOD|堆存/ },
    { key: "storageAdd", re: /ADDITIONAL PERIOD/ },
    { key: "demurrage", re: /DEMURRAGE/ },
    { key: "exTariff", re: /EX-?TARIFF|EX TARIFF/ },
    { key: "infoRequested", re: /INFORMATION REQUESTED|资料/ },
    { key: "official", re: /^OFFICIAL/ },
    { key: "nextStepDate", re: /DATE OF NEXT STEP|完成时间/ },
    { key: "nextStep", re: /^NEXT STEP|下一步$/ },
  ],

  parse(book) {
    const results = [];
    for (const sh of book.sheets) {
      const g = sh.grid;
      // 1) cabeçalho: linha com mais títulos reconhecidos
      const colOf = {};
      let headerRow = -1, best = 0;
      for (let r = 0; r < Math.min(g.length, 40); r++) {
        let hits = 0; const map = {};
        (g[r] || []).forEach((v, c) => {
          const n = norm(v);
          if (!n) return;
          for (const col of this.COLS) if (!(col.key in map) && col.re.test(n)) { map[col.key] = c; hits++; break; }
        });
        if (hits > best) { best = hits; headerRow = r; Object.assign(colOf, map); }
      }
      // 2) blocos por processo
      const starts = [];
      for (let r = headerRow + 1; r < g.length; r++) {
        const id = (g[r] || []).map(procId).find(Boolean);
        if (id && !starts.some((s) => s.id === id)) starts.push({ r, id });
      }
      starts.forEach((s, i) => {
        const end = i + 1 < starts.length ? starts[i + 1].r : g.length;
        let top = s.r;
        // o bloco pode começar acima da linha do IRA (rótulos de datas na linha de cima)
        while (top > headerRow + 1 && top > (i ? starts[i - 1].r + 1 : 0) && !(g[top - 1] || []).some((v) => procId(v)) && (g[top - 1] || []).some((v) => /customs|officer|request|submitted/i.test(String(v)))) top--;
        results.push(this.block(g, top, end, s.id, colOf));
      });
    }
    return results;
  },

  block(g, r0, r1, id, colOf) {
    const rec = { id, channel: "Vermelho", rounds: [], source: "planilha Red Channel" };
    const year = (new Date()).getFullYear();
    const texts = (c) => { const out = []; for (let r = r0; r < r1; r++) { const v = g[r]?.[c]; if (v !== undefined && v !== "") out.push(v); } return out; };
    const firstText = (c) => (c === undefined ? "" : texts(c).map(String).find((x) => x.trim()) || "");
    const nums = (c) => (c === undefined ? [] : texts(c).map(num).filter((x) => !isNaN(x)));

    rec.batch = texts(colOf.batch ?? 2).map(String).join(" · ").replace(/\s+/g, " ").trim();
    rec.containers = nums(colOf.qty)[0] ?? null;
    rec.storageFirst = nums(colOf.storageFirst)[0] ?? null;
    rec.storageAdd = nums(colOf.storageAdd)[0] ?? null;
    rec.demurrage = nums(colOf.demurrage)[0] ?? null;
    rec.exTariff = firstText(colOf.exTariff);
    rec.infoRequested = firstText(colOf.infoRequested);
    rec.official = texts(colOf.official ?? -1).join(" · ");
    rec.nextStep = firstText(colOf.nextStep);
    rec.nextStepDate = toISO(firstText(colOf.nextStepDate), year);

    // datas: em cada coluna, o rótulo (texto) diz o que é a data abaixo dele
    const width = Math.max(...g.slice(r0, r1).map((r) => (r || []).length), 0);
    const dated = [];
    for (let c = 0; c < width; c++) {
      let label = "", date = "", extra = "";
      for (let r = r0; r < r1; r++) {
        const v = g[r]?.[c];
        if (v === undefined || v === "") continue;
        const iso = toISO(v, year);
        const looksDate = iso && (typeof v === "number" || /^\s*\d{1,4}[\/\-]\d{1,2}/.test(String(v)));
        if (looksDate) { if (!date) { date = iso; extra = String(v).replace(/^\s*[\d\/\-]+\s*/, "").trim(); } }
        else if (typeof v === "string") label += " " + v;
      }
      const L = norm(label);
      if (/CUSTOMS CLEARED|DESEMBARAC/.test(L)) { rec.status = "Desembaraçado"; if (date) rec.clearedAt = date; continue; }
      if (!date) continue;
      dated.push({ c, L, date, extra });
    }
    for (const d of dated) {
      if (/CHANNEL ASSIGNMENT|分配|CANAL/.test(d.L)) rec.assignedAt = d.date;
      else if (/SUBMITTED|提交/.test(d.L)) { const last = rec.rounds[rec.rounds.length - 1]; if (last && !last.sub) last.sub = d.date; else rec.rounds.push({ req: "", sub: d.date }); }
      else if (/REQUEST|要求/.test(d.L)) rec.rounds.push({ req: d.date, sub: "", note: d.extra });
      else if (!rec.clearedAt && rec.status === "Desembaraçado") rec.clearedAt = d.date;
    }
    rec.rounds = rec.rounds.filter((x) => x.req || x.sub);
    const held = nums(colOf.daysHeld);
    rec.daysHeld = held.length ? held[0] : null;
    if (!rec.status) rec.status = "Em andamento";
    return rec;
  },
};
