/* Interface do sistema de custos aduaneiros (pt / en / zh). */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 0) => (+v || 0).toLocaleString(LOCALE[LANG], { maximumFractionDigits: d });
const brl = (v) => (v === null || v === undefined || isNaN(v) ? "—" : new Intl.NumberFormat(LOCALE[LANG], { style: "currency", currency: "BRL" }).format(v));
const brlK = (v) => {
  if (LANG === "zh" && Math.abs(v) >= 1e4) return "R$ " + nf(v / 1e4, 1) + " 万";
  if (Math.abs(v) >= 1e6) return "R$ " + nf(v / 1e6, 2) + (LANG === "pt" ? " mi" : " M");
  if (Math.abs(v) >= 1e4) return "R$ " + nf(v / 1e3, 1) + (LANG === "pt" ? " mil" : " k");
  return brl(v);
};
const pct = (a, b) => nf(b ? (a / b) * 100 : 0, 1) + "%";
const fmtD = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? (LANG === "pt" ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : iso.slice(0, 10)) : iso || "—");
const fmtDs = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? (LANG === "pt" ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : iso.slice(5, 10)) : "—");
const plural = (n, s, p) => `${nf(n)} ${n === 1 ? t(s) : t(p || s + "s")}`;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : null);
const median = (a) => { const s = a.filter((x) => x !== null && !isNaN(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const key = (id) => encodeURIComponent(procKey(id));
const unkey = (k) => decodeURIComponent(k).replace(/^(IRA\d+)-(\d{2})$/, "$1/$2");
const CHANNELS = ["Verde", "Amarelo", "Vermelho", "Cinza"];
const view = () => $("#view");
let F = { q: "", ch: "", month: "" };

function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.remove("hidden"); clearTimeout(el._h); el._h = setTimeout(() => el.classList.add("hidden"), 2600); }
function openModal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); }

function chBadge(ch, src) { return ch ? `<span class="badge ch-${esc(ch)}" ${src === "comex" ? `title="${esc(t("Canal da planilha COMEX"))}"` : ""}>${esc(t(ch))}${src === "comex" ? " ·C" : ""}</span>` : `<span class="badge b-none">${t("sem canal")}</span>`; }
function stageBadge(M, R) {
  const s = M?.stage;
  if (s === "out") return `<span class="badge b-ok">✓ ${t("Retirado do terminal")}</span>`;
  if (s === "cleared") return `<span class="badge b-ok">✓ ${t("Desembaraçado")}${M.clearedAt ? " " + fmtD(M.clearedAt) : ""}</span>`;
  if (s === "pending") return `<span class="badge b-warn">◷ ${t("Exigência em aberto")}</span>`;
  if (s === "inspection") return `<span class="badge b-warn">◷ ${t(R?.status || "Em andamento")}</span>`;
  return `<span class="badge b-none">${t("sem status")}</span>`;
}
const gKey = (g) => `<span class="key" style="background:${GROUPS[g].color}"></span>`;
const gName = (g) => t(g === "regular" ? "Regular" : g === "extra_storage" ? "Extra armazenagem" : "Extra desembaraço");
const kpiName = (g) => (g === "extra_storage" ? "KPI 1 · Storage" : g === "extra_customs" ? "KPI 3 · Customs costs" : "");
const itemName = (k) => (/ · período livre$/.test(k) ? t(k.replace(/ · período livre$/, "")) + " · " + t("período livre") : t(k));

/* ------------------------------------------------------------------ tooltip */
document.addEventListener("mousemove", (e) => {
  const el = e.target.closest?.("[data-tip]"), tip = $("#tip");
  if (!el) { tip.classList.add("hidden"); return; }
  tip.innerHTML = el.dataset.tip; tip.classList.remove("hidden");
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + "px";
  tip.style.top = (e.clientY + 16 + h > window.innerHeight ? e.clientY - h - 10 : e.clientY + 16) + "px";
});

/* ------------------------------------------------------------------ filtros */
function filtered(includeRedOnly = false) {
  const q = F.q.trim().toUpperCase();
  return Data.rows(includeRedOnly).filter(({ id, P, R, A, M }) => {
    if (F.ch && (M.channel || "") !== F.ch) return false;
    if (F.month && !(A?.firstEntry || R?.assignedAt || "").startsWith(F.month)) return false;
    if (q) {
      const hay = [id, P?.bl, P?.duimp, P?.vessel, R?.batch, ...(P?.containers || []).map((c) => c.id)].join(" ").toUpperCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function filterBar() {
  const months = [...new Set(Data.rows(true).map(({ A, R }) => (A?.firstEntry || R?.assignedAt || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const active = F.q || F.ch || F.month;
  return `<div class="filters">
    <input id="f-q" placeholder="${esc(t("Buscar processo, BL, DUIMP, contêiner…"))}" value="${esc(F.q)}" style="min-width:240px">
    <select id="f-ch"><option value="">${t("Todos os canais")}</option>${CHANNELS.map((c) => `<option value="${c}" ${F.ch === c ? "selected" : ""}>${t(c)}</option>`).join("")}</select>
    <select id="f-month"><option value="">${t("Todas as entradas")}</option>${months.map((m) => `<option value="${m}" ${F.month === m ? "selected" : ""}>${t("Entrada em")} ${m.slice(5)}/${m.slice(0, 4)}</option>`).join("")}</select>
    ${active ? `<button class="btn sm" id="f-clear">${t("Limpar filtros")}</button>` : ""}
  </div>`;
}
function bindFilters() {
  const re = () => { const pos = $("#f-q")?.selectionStart; route(); const i = $("#f-q"); if (i && pos !== undefined) { i.focus(); i.setSelectionRange(pos, pos); } };
  $("#f-q")?.addEventListener("input", (e) => { F.q = e.target.value; clearTimeout(bindFilters._t); bindFilters._t = setTimeout(re, 250); });
  $("#f-ch")?.addEventListener("change", (e) => { F.ch = e.target.value; route(); });
  $("#f-month")?.addEventListener("change", (e) => { F.month = e.target.value; route(); });
  $("#f-clear")?.addEventListener("click", () => { F = { q: "", ch: "", month: "" }; route(); });
}

function totals(rows) {
  const free = Data.freeDays();
  const T = { procs: 0, cont: 0, regular: 0, extra_storage: 0, extra_customs: 0, total: 0, over: 0, within: 0, physical: 0, withExtra: 0, unknown: 0, tariff: 0, mapa: 0, redOpen: 0, redAll: 0, meta: 0, byKey: {} };
  for (const { A, M } of rows) {
    if (M?.channel === "Vermelho") { T.redAll++; if (M.stage !== "cleared" && M.stage !== "out") T.redOpen++; }
    if (!A) continue;
    T.procs++; T.cont += A.n; T.regular += A.regular; T.extra_storage += A.extra_storage; T.extra_customs += A.extra_customs; T.total += A.total;
    T.over += A.over; T.within += A.containers.filter((c) => (c.stay || 0) <= free && !c.extraDays).length;
    T.physical += A.physical; T.unknown += A.unknown; T.tariff += A.tariffIssues; if (M.mapaFlag) T.mapa++;
    if (A.extra > 0.004) T.withExtra++;
    T.meta += A.n * (M.channel && M.channel !== "Verde" ? REF_CPU.other : REF_CPU.green);
    for (const l of A.lines) if (l.group !== "regular") {
      const k = (T.byKey[l.key] ??= { key: l.key, group: l.group, value: 0, conts: new Set() });
      k.value += l.value; k.conts.add(l.container);
    }
  }
  T.extra = T.extra_storage + T.extra_customs;
  return T;
}

/* ------------------------------------------------------------------ gráficos */
function stackedBars(rows) {
  const data = rows.filter((r) => r.A).slice(0, 25);
  if (!data.length) return `<p class="muted">${t("Sem demonstrativos importados.")}</p>`;
  const max = Math.max(...data.map((r) => r.A.total));
  const G = ["regular", "extra_storage", "extra_customs"];
  return `<div class="legend">${G.map((g) => `<span>${gKey(g)}${gName(g)}</span>`).join("")}</div>
  <div class="hbar">${data.map(({ id, A, M }) => {
    const segs = G.filter((g) => A[g] > 0.004).map((g) =>
      `<div class="seg" style="width:${(A[g] / max) * 100}%;background:${GROUPS[g].color}" onclick="location.hash='#p/${key(id)}'"
        data-tip="<b>${esc(id)}</b><br>${esc(gName(g))}: ${brl(A[g])}<br>${pct(A[g], A.total)} ${esc(t("do total do processo"))}"></div>`).join("");
    return `<div class="lab"><a href="#p/${key(id)}">${esc(id)}</a></div>
      <div class="track">${segs}</div><div class="val">${brlK(A.total)} · ${pct(A.extra, A.total)} ${t("extra")}</div>`;
  }).join("")}</div>`;
}
function extraByType(T) {
  const items = Object.values(T.byKey).sort((a, b) => b.value - a.value);
  if (!items.length) return `<p class="muted">${t("Nenhum custo extra nos processos filtrados.")}</p>`;
  const max = items[0].value;
  const groups = [...new Set(items.map((i) => i.group))];
  return `${groups.length > 1 ? `<div class="legend">${groups.map((g) => `<span>${gKey(g)}${kpiName(g)}</span>`).join("")}</div>` : ""}
  <div class="hbar">${items.map((i) => `<div class="lab" title="${esc(itemName(i.key))}"><a href="#extras/${encodeURIComponent(i.key)}">${esc(itemName(i.key))}</a></div>
    <div class="track"><div class="seg" style="width:${(i.value / max) * 100}%;background:${GROUPS[i.group].color}" onclick="location.hash='#extras/${encodeURIComponent(i.key)}'"
      data-tip="<b>${esc(itemName(i.key))}</b><br>${brl(i.value)} · ${plural(i.conts.size, "contêiner", "contêineres")}<br>${kpiName(i.group)}"></div></div>
    <div class="val">${brlK(i.value)}</div>`).join("")}</div>`;
}
function stayBars(rows) {
  const data = rows.filter((r) => r.A).map((r) => ({ ...r, stay: r.A.maxStay })).sort((a, b) => b.stay - a.stay).slice(0, 25);
  if (!data.length) return `<p class="muted">${t("Sem dados de estadia.")}</p>`;
  const free = Data.freeDays();
  const max = Math.max(free * 1.2, ...data.map((d) => d.stay));
  return `<div class="hbar">${data.map(({ id, stay, A }) => `<div class="lab"><a href="#p/${key(id)}">${esc(id)}</a></div>
    <div class="track ref" style="--ref:${(free / max) * 100}%"><div class="seg" style="width:${(stay / max) * 100}%;background:${stay > free ? "var(--s-storage)" : "var(--s-regular)"}"
      data-tip="<b>${esc(id)}</b><br>${esc(t("Maior estadia: {n} dias", { n: stay }))}<br>${esc(t("{a} de {b} contêineres além de {d} dias", { a: A.over, b: A.n, d: free }))}"></div></div>
    <div class="val">${t("{n} dias", { n: stay })}</div>`).join("")}</div>
  <p class="axis-note">${t("Linha tracejada = estadia sem custo extra ({d} dias). Laranja = passou do período livre.", { d: free })}</p>`;
}
function compBar(A) {
  const G = ["regular", "extra_storage", "extra_customs"];
  return `<div class="compbar">${G.filter((g) => A[g] > 0.004).map((g) => `<div class="seg" style="flex:${A[g]};background:${GROUPS[g].color}" data-tip="${esc(gName(g))}<br>${brl(A[g])} (${pct(A[g], A.total)})"></div>`).join("")}</div>
  <div class="legend">${G.map((g) => `<span>${gKey(g)}${gName(g)}: <b>${brl(A[g])}</b> (${pct(A[g], A.total)})</span>`).join("")}</div>`;
}

/* ------------------------------------------------------------------ PAINEL */
function summaryText(T) {
  const free = Data.freeDays();
  const s = [t("Há <b>{p}</b> com demonstrativo da Santos Brasil, somando <b>{c}</b> e <b>{v}</b> em custos de terminal.", { p: plural(T.procs, "processo"), c: plural(T.cont, "contêiner", "contêineres"), v: brl(T.total) })];
  if (T.total) s.push(t("Desse total, <b>{e} ({pe})</b> são custos extras: {s} de armazenagem além do período livre (KPI 1) e {c} de inspeção/desembaraço (KPI 3).", { e: brl(T.extra), pe: pct(T.extra, T.total), s: brl(T.extra_storage), c: brl(T.extra_customs) }));
  if (T.cont) s.push(t("<b>{w}</b> dos contêineres ficaram dentro da estadia sem custo extra ({d} dias).", { w: pct(T.within, T.cont), d: free }));
  if (T.redAll) s.push(t("<b>{n}</b> no canal vermelho ({o} em aberto).", { n: plural(T.redAll, "processo"), o: T.redOpen }));
  return s.join(" ");
}
function viewPainel() {
  if (!Data.rows(true).length) return emptyState();
  const rows = filtered(), T = totals(rows), free = Data.freeDays();
  const redOnly = Data.redOnly();
  const cpu = T.cont ? T.regular / T.cont : 0, meta = T.cont ? T.meta / T.cont : 0;
  view().innerHTML = `
  <div class="title-row"><h1>${t("Painel de custos aduaneiros")}</h1><div class="row"><a class="btn" href="#importar">⬆ ${t("Importar planilhas")}</a><button class="btn" onclick="exportCsv()">⬇ ${t("Exportar CSV")}</button></div></div>
  ${filterBar()}
  <p class="lead">${summaryText(T)}</p>
  <div class="tiles">
    <a class="tile hero" href="#processos"><div class="k">${t("Processos")}</div><div class="v">${T.procs}</div><div class="s">${plural(T.cont, "contêiner", "contêineres")}</div></a>
    <a class="tile hero" href="#processos"><div class="k">${t("Custo total")}</div><div class="v">${brlK(T.total)}</div><div class="s">${T.cont ? brl(T.total / T.cont) + " " + t("por contêiner") : ""}</div></a>
    <div class="tile kpi"><div class="k">${t("Estadia sem custo extra (≤ {d} dias)", { d: free })}</div><div class="v">${pct(T.within, T.cont)}</div><div class="s">${t("{a} de {b} contêineres", { a: T.within, b: T.cont })}</div></div>
    <div class="tile"><div class="k">${gKey("regular")}${t("Custos regulares")}</div><div class="v">${brlK(T.regular)}</div><div class="s">${t("{v} por contêiner · meta {m}", { v: brl(cpu), m: brl(meta) })}</div></div>
    <a class="tile" href="#extras"><div class="k"><span class="key" style="background:var(--brand)"></span>${t("Custos extras")}</div><div class="v">${brlK(T.extra)}</div><div class="s">${pct(T.extra, T.total)} ${t("do total")} · ${plural(T.withExtra, "processo")}</div></a>
    <a class="tile" href="#extras"><div class="k">${gKey("extra_storage")}${t("Extra armazenagem")}</div><div class="v">${brlK(T.extra_storage)}</div><div class="s">KPI 1 · Storage</div></a>
    <a class="tile" href="#extras"><div class="k">${gKey("extra_customs")}${t("Extra desembaraço")}</div><div class="v">${brlK(T.extra_customs)}</div><div class="s">KPI 3 · Customs costs</div></a>
    <div class="tile"><div class="k">${t("Inspeção física")}</div><div class="v">${T.physical}</div><div class="s">${t("contêineres com posicionamento")}</div></div>
    <a class="tile" href="#canal"><div class="k"><span class="badge ch-Vermelho">${t("Vermelho")}</span></div><div class="v">${T.redOpen}</div><div class="s">${t("em aberto · {n} no total", { n: T.redAll })}</div></a>
  </div>
  ${redOnly.length ? `<div class="warnbox">ⓘ ${t("{n} processo(s) da planilha Red Channel ainda sem demonstrativo da Santos Brasil: {ids}. Eles aparecem em Canal vermelho e entram nos custos quando o demonstrativo chegar.", { n: redOnly.length, ids: redOnly.join(", ") })}</div>` : ""}
  ${T.unknown ? `<div class="warnbox">⚠ ${t("{n} serviço(s) sem regra de classificação. Revise em Configurações.", { n: T.unknown })}</div>` : ""}
  <div class="grid3">
    <div class="panel"><h2>${t("Custo por processo")}</h2><p class="muted small">${t("Clique numa barra para abrir o processo.")}</p>${stackedBars(rows)}</div>
    <div class="panel"><h2>${t("Custos extras por tipo")}</h2><p class="muted small">${t("Clique para ver quais processos e contêineres.")}</p>${extraByType(T)}</div>
  </div>
  <div class="grid2">
    <div class="panel"><h2>${t("Estadia no terminal")}</h2>${stayBars(rows)}</div>
    <div class="panel"><h2>${t("Processos que exigem atenção")}</h2>${attention(rows)}</div>
  </div>
  <div class="panel"><div class="title-row"><h2>${t("Processos")}</h2><a href="#processos" class="small">${t("ver tabela completa →")}</a></div>${procTable(rows.slice(0, 10))}</div>`;
  bindFilters();
}
function attention(rows) {
  const items = [];
  for (const { id, A, R, M } of rows) {
    const pay = Data.db.pay[id] || {};
    if (R && M.stage !== "cleared" && M.stage !== "out" && R.nextStepDate && R.nextStepDate < today()) items.push({ id, w: 3, t: t("Próximo passo vencido em {d}: {s}", { d: fmtD(R.nextStepDate), s: R.nextStep || "—" }) });
    if (A && A.tariffIssues) items.push({ id, w: 3, t: t("{n} cobrança(s) diferentes do tarifário", { n: A.tariffIssues }) });
    if (M.mapaFlag && !R?.reason) items.push({ id, w: 2, t: t("Canal verde com custos de inspeção ({v}): confirmar se houve MAPA", { v: brl(A.extra_customs) }) });
    if (A && A.extra > 0.004 && !(R?.reason || R?.infoRequested) && !M.mapaFlag) items.push({ id, w: 2, t: t("{v} de custo extra sem motivo registrado", { v: brl(A.extra) }) });
    if (A && pay.approval !== "aprovado") items.push({ id, w: 2, t: t("Pagamento sem aprovação de diretor registrada") });
    if (A && A.over) items.push({ id, w: 1, t: t("{a} de {b} contêineres além do período livre (máx. {m} dias)", { a: A.over, b: A.n, m: A.maxStay }) });
    if (A && Data.db.processes[id]?.warnings?.length) items.push({ id, w: 2, t: t("Valores não conferem com o total do terminal") });
  }
  items.sort((a, b) => b.w - a.w);
  if (!items.length) return `<p class="okbox">${t("Nada pendente nos processos filtrados.")}</p>`;
  return `<table><tbody>${items.slice(0, 12).map((i) => `<tr class="click" onclick="location.hash='#p/${key(i.id)}'"><td style="width:110px"><b>${esc(i.id)}</b></td><td>${i.w === 3 ? "🔴" : i.w === 2 ? "🟠" : "🟡"} ${esc(i.t)}</td></tr>`).join("")}</tbody></table>
  ${items.length > 12 ? `<p class="axis-note">${t("+{n} outros pontos.", { n: items.length - 12 })}</p>` : ""}`;
}
function procTable(rows) {
  if (!rows.length) return `<p class="muted">${t("Nenhum processo com esses filtros.")}</p>`;
  const T = totals(rows);
  return `<div class="tbl-wrap"><table><thead><tr><th>${t("Processo")}</th><th>${t("Canal")}</th><th>${t("Situação")}</th><th>${t("Aprovação")}</th><th>BL / DUIMP</th><th class="n">${t("Cont.")}</th><th class="n">${t("Estadia máx.")}</th>
    <th class="n">${t("Regular")}</th><th class="n">${t("Extra armaz.")}</th><th class="n">${t("Extra desemb.")}</th><th class="n">${t("Total")}</th><th class="n">${t("% extra")}</th></tr></thead><tbody>
  ${rows.map(({ id, P, A, R, M }) => `<tr class="click" onclick="location.hash='#p/${key(id)}'">
    <td><b>${esc(id)}</b>${M.mapaFlag ? ` <span class="badge b-warn" title="${esc(t("Canal verde com custos de inspeção: confirmar se houve MAPA"))}">MAPA?</span>` : ""}</td><td>${chBadge(M.channel, M.channelSource)}</td><td>${stageBadge(M, R)}</td><td>${approvalBadge(id)}</td>
    <td class="small">${esc(P?.bl || "—")}<br><span class="muted">${esc(P?.duimp || "")}</span></td>
    <td class="n">${A?.n ?? "—"}</td><td class="n">${A ? A.maxStay + " d" : "—"}</td>
    <td class="n">${A ? brl(A.regular) : "—"}</td><td class="n">${A ? brl(A.extra_storage) : "—"}</td><td class="n">${A ? brl(A.extra_customs) : "—"}</td>
    <td class="n"><b>${A ? brl(A.total) : "—"}</b></td><td class="n">${A ? pct(A.extra, A.total) : "—"}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="5">${t("Total")} (${plural(T.procs, "processo")})</td><td class="n">${T.cont}</td><td></td><td class="n">${brl(T.regular)}</td><td class="n">${brl(T.extra_storage)}</td><td class="n">${brl(T.extra_customs)}</td><td class="n">${brl(T.total)}</td><td class="n">${pct(T.extra, T.total)}</td></tr></tfoot></table></div>`;
}
function viewProcessos() {
  view().innerHTML = `<div class="title-row"><h1>${t("Processos")}</h1><div class="row"><a class="btn" href="#importar">⬆ ${t("Importar planilhas")}</a><button class="btn" onclick="exportCsv()">⬇ ${t("Exportar CSV")}</button></div></div>
  ${filterBar()}<p class="muted small">${t("Processos com demonstrativo da Santos Brasil. Canal e situação vêm da planilha Red Channel (ou da planilha COMEX, marcado ·C) para o mesmo número de processo — sem duplicar.")}</p>
  <div class="panel">${procTable(filtered())}</div>`;
  bindFilters();
}

/* ------------------------------------------------------------------ PROCESSO */
function viewProcesso(id) {
  const P = Data.db.processes[id], R = Data.db.red[id] || null, H = Data.hist(id);
  if (!P && !R && !H) { view().innerHTML = `<h1>${t("Processo não encontrado")}</h1><p><a href="#processos">← ${t("voltar")}</a></p>`; return; }
  const A = P ? Data.analysis(id) : null;
  const M = Data.merged(id, P, R, A, H);
  const free = Data.freeDays();
  const agg = (extra) => {
    const m = {};
    for (const l of A.lines.filter((x) => (extra ? x.group !== "regular" : x.group === "regular"))) {
      const k = (m[l.key] ??= { key: l.key, group: l.group, value: 0, conts: new Set(), qty: 0, unit: new Set() });
      k.value += l.value; k.conts.add(l.container); k.qty += l.qty || 1; k.unit.add((l.unit ?? l.value).toFixed(2));
    }
    return Object.values(m).sort((a, b) => b.value - a.value);
  };
  const brkTable = (items, sum, isExtra) => items.length ? `<div class="tbl-wrap"><table><thead><tr><th>${t("Item")}</th>${isExtra ? "<th>KPI</th>" : ""}<th class="n">${t("Contêineres")}</th><th class="n">${t("Qtd.")}</th><th class="n">${t("Valor unit.")}</th><th class="n">${t("Total")}</th><th class="n">%</th></tr></thead><tbody>
    ${items.map((i) => `<tr><td>${gKey(i.group)} ${esc(itemName(i.key))}</td>${isExtra ? `<td><span class="kpi-tag">${kpiName(i.group)}</span></td>` : ""}<td class="n">${i.conts.size}</td><td class="n">${i.qty}${i.group === "extra_storage" ? " " + t("dias") : ""}</td>
      <td class="n">${i.unit.size === 1 ? brl(+[...i.unit][0]) : t("variável")}</td><td class="n">${brl(i.value)}</td><td class="n">${pct(i.value, sum)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="${isExtra ? 5 : 4}">${t("Total")}</td><td class="n">${brl(sum)}</td><td></td></tr></tfoot></table></div>` : `<p class="okbox">${t("Nenhum custo extra neste processo.")}</p>`;
  const tariffCell = (l) => {
    const c = l.tariff;
    if (!c) return `<span class="muted">—</span>`;
    if (c.variable) return `<span class="muted small">${t("varia")}</span>`;
    if (!c.ok) return `<span class="badge b-warn">⚠ ${t("esperado")} ${brl(c.expected)}</span>`;
    if (c.aboveMin) return `<span class="badge b-none" title="${esc(t("Acima do mínimo: pode ser % do CIF"))}">≥ ${t("mín.")}</span>`;
    return `<span class="badge b-ok">✓</span>`;
  };

  view().innerHTML = `
  <p class="small"><a href="#processos">← ${t("Processos")}</a></p>
  <div class="title-row"><h1>${esc(id)} ${chBadge(M.channel, M.channelSource)} ${stageBadge(M, R)}</h1>
    <div class="row"><button class="btn" onclick="editRed('${esc(id)}')">✎ ${t("Desembaraço / motivo")}</button>${A ? `<button class="btn" onclick="approvalEmail('${esc(id)}')">✉ ${t("E-mail de aprovação")}</button>` : ""}</div></div>
  ${P ? `<p class="muted small">BL <b>${esc(P.bl)}</b> · ${esc(P.duimp)} · ${t("Navio")} ${esc(P.vessel)} ${esc(P.voyage)} · ${t("Origem")} ${esc(P.origin)} · CIF US$ ${nf(P.cifUsd ?? 0, 2)} · NF-e ${esc(P.nfe)} · RPS ${esc(P.rps)} · ${t("Despachante")} ${esc(P.broker)}<br>
    ${t("Demonstrativo Santos Brasil emitido em {d}", { d: esc(P.issuedAt || "—") })} · ${t("arquivo")} <i>${esc(P.file)}</i></p>` : `<div class="warnbox">${t("Este processo ainda não tem demonstrativo da Santos Brasil: importe o arquivo {id} para ver os custos.", { id: esc(id) })}</div>`}
  ${P?.warnings?.length ? P.warnings.map((w) => `<div class="warnbox">⚠ ${esc(w)}</div>`).join("") : P ? `<div class="okbox small">✓ ${t("Valores conferidos: a soma dos serviços bate com os totais informados pelo terminal ({v}).", { v: brl(P.grandTotal) })}</div>` : ""}
  ${M.mapaFlag ? `<div class="warnbox">⚠ ${t("Canal verde (planilha COMEX) com custos de inspeção de {v}. O tarifário prevê posicionamento e lacres só para MAPA ou canal diferente de verde: confirmar se houve inspeção do MAPA e registrar o motivo.", { v: brl(A.extra_customs) })}</div>` : ""}
  ${A ? `<div class="tiles">
    <div class="tile hero"><div class="k">${t("Custo total")}</div><div class="v">${brl(A.total)}</div><div class="s">${brl(A.total / A.n)} ${t("por contêiner")}</div></div>
    <div class="tile"><div class="k">${gKey("regular")}${t("Regular")}</div><div class="v">${brl(A.regular)}</div><div class="s">${t("{v} por contêiner · meta {m}", { v: brl(A.regular / A.n), m: brl(M.channel && M.channel !== "Verde" ? REF_CPU.other : REF_CPU.green) })}</div></div>
    <div class="tile"><div class="k">${gKey("extra_storage")}${t("Extra armazenagem")}</div><div class="v">${brl(A.extra_storage)}</div><div class="s">KPI 1 · ${t("{n} contêiner-dias", { n: A.containers.reduce((a, c) => a + c.extraDays, 0) })}</div></div>
    <div class="tile"><div class="k">${gKey("extra_customs")}${t("Extra desembaraço")}</div><div class="v">${brl(A.extra_customs)}</div><div class="s">KPI 3 · ${t("{n} com inspeção física", { n: A.physical })}</div></div>
    <div class="tile kpi"><div class="k">${t("Estadia sem custo extra (≤ {d} dias)", { d: free })}</div><div class="v">${A.n - A.over} / ${A.n}</div><div class="s">${t("contêineres dentro do prazo")}</div></div>
    <div class="tile"><div class="k">${t("Estadia")}</div><div class="v">${t("{n} dias", { n: A.maxStay })}</div><div class="s">${fmtD(A.firstEntry)} → ${fmtD(A.lastExit)}</div></div>
  </div>
  <div class="panel"><h2>${t("Composição do custo")}</h2>${compBar(A)}</div>` : ""}
  <div class="grid2">
    <div class="panel"><div class="title-row"><h2>${t("Desembaraço e motivo da estadia / custos extras")}</h2><button class="btn sm" onclick="editRed('${esc(id)}')">✎ ${t("Editar")}</button></div>${redPanel(id, R, A, H, M)}</div>
    <div class="panel"><div class="title-row"><h2>${t("Pagamento e controle")}</h2>${A ? `<button class="btn sm" onclick="editPay('${esc(id)}')">✎ ${t("Editar")}</button>` : ""}</div>${A ? payPanel(id, P, A, R, M) : `<p class="muted">${t("Disponível quando o demonstrativo for importado.")}</p>`}</div>
  </div>
  ${H ? histPanel(H) : ""}
  ${A ? `<div class="grid2">
    <div class="panel"><h2>${t("Breakdown dos custos extras")}</h2>${brkTable(agg(true), A.extra, true)}</div>
    <div class="panel"><h2>${t("Custos regulares")}</h2>${brkTable(agg(false), A.regular, false)}</div>
  </div>
  <div class="panel"><h2>${t("Contêineres")}</h2><p class="muted small">${t("Clique num contêiner para ver os serviços cobrados pelo terminal, a conferência com o tarifário e as observações.")}</p>
  <div class="tbl-wrap"><table><thead><tr><th>${t("Contêiner")}</th><th>${t("Entrada")}</th><th>${t("Saída")}</th><th class="n">${t("Estadia")}</th><th class="n">${t("Períodos")}</th><th>${t("Inspeção física")}</th><th class="n">${t("Regular")}</th><th class="n">${t("Extra armaz.")}</th><th class="n">${t("Extra desemb.")}</th><th class="n">${t("Total")}</th><th>${t("Conferência")}</th></tr></thead><tbody>
  ${A.containers.map((c, i) => `<tr class="click" onclick="toggleRow(${i})"><td><b>${esc(c.id)}</b> <span class="muted">▸</span></td><td>${fmtD(c.entry)}</td><td>${fmtD(c.exit)}</td>
    <td class="n">${c.stay ?? "—"} d ${c.overFree ? `<span class="badge b-warn">&gt; ${free}</span>` : ""}</td><td class="n">${c.periods ?? "—"}</td><td>${c.physical ? t("Sim") : "—"}</td>
    <td class="n">${brl(c.regular)}</td><td class="n">${brl(c.extra_storage)}${c.extraDays ? `<br><span class="muted small">${c.extraDays} d × ${brl(c.dayRate)}</span>` : ""}</td><td class="n">${brl(c.extra_customs)}</td><td class="n"><b>${brl(c.total)}</b></td>
    <td>${c.reported === null ? "—" : Math.abs(c.reported - c.total) < 0.05 ? `<span class="badge b-ok">✓ ${brl(c.reported)}</span>` : `<span class="badge b-warn">${t("terminal")}: ${brl(c.reported)}</span>`}</td></tr>
    <tr class="sub hidden" id="sub-${i}"><td colspan="11"><table><thead><tr><th>${t("Serviço (como no terminal)")}</th><th>${t("Código")}</th><th>${t("Classificação")}</th><th class="n">${t("Valor")}</th><th>${t("Tarifário")}</th><th>${t("Observação do terminal")}</th></tr></thead><tbody>
      ${c.lines.map((l) => { const obs = l.service.obs.split("\n"); return `<tr><td>${esc(l.service.name)}</td><td>${esc(l.service.code)}</td><td>${gKey(l.group)} ${esc(itemName(l.key))} ${l.unknown ? `<span class="badge b-warn">${t("sem regra")}</span>` : ""}</td><td class="n">${brl(l.value)}</td><td>${tariffCell(l)}</td><td><div class="obs">${esc(obs.slice(0, 3).join("\n"))}${obs.length > 3 ? "\n" + t("… +{n} períodos de 1 dia", { n: obs.length - 3 }) : ""}</div></td></tr>`; }).join("")}
    </tbody></table></td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="6">${t("Total")}</td><td class="n">${brl(A.regular)}</td><td class="n">${brl(A.extra_storage)}</td><td class="n">${brl(A.extra_customs)}</td><td class="n">${brl(A.total)}</td><td></td></tr></tfoot></table></div></div>` : ""}
  <div class="panel"><h2>${t("Anotações")}</h2><textarea id="note" placeholder="${esc(t("Anotações livres sobre o processo (negociação, contestação de cobrança, contato com o terminal…)"))}">${esc(Data.db.notes[id] || "")}</textarea>
    <div class="row" style="margin-top:6px"><button class="btn sm" onclick="saveNote('${esc(id)}')">${t("Salvar anotação")}</button></div></div>`;
}
function toggleRow(i) { $("#sub-" + i).classList.toggle("hidden"); }
async function saveNote(id) { Data.db.notes[id] = $("#note").value; await Data.save(); toast(t("Anotação salva")); }

function histPanel(H) {
  const f = (k, v) => `<div><div class="muted small">${k}</div><div>${v}</div></div>`;
  return `<div class="panel"><h2>${t("Dados da planilha COMEX")}</h2><div class="form">
    ${f(t("Canal"), chBadge(H.channel))}${f(t("Presença de carga"), fmtD(H.presence))}${f(t("Desembaraço"), fmtD(H.cleared))}${f(t("Retirada"), fmtD(H.pickup))}${f(t("Devolução do vazio"), fmtD(H.returned))}
    ${f(t("Dias de armazenagem"), H.storageDays ?? "—")}${f(t("Dias além do período livre"), H.overDays ?? "—")}${f(t("Dias de demurrage"), H.demTime ?? "—")}
    ${f(t("Taxa de armazenagem"), brl(H.storage))}${f("Demurrage", brl(H.demurrage))}${f(t("Taxa Siscomex"), brl(H.siscomex))}${f(t("Despachante"), brl(H.broker))}${f("AFRMM", brl(H.afrmm))}${f(t("Inspeção aduaneira"), brl(H.inspection))}
  </div></div>`;
}

function redPanel(id, R, A, H, M) {
  if (!R) return `<p class="muted">${t("Sem informações de desembaraço. Use Editar para registrar o canal, as exigências e o motivo da estadia longa ou dos custos extras — ou importe a planilha Red Channel.")}</p>`;
  const ev = [];
  if (A?.firstEntry) ev.push({ d: A.firstEntry, t: t("Entrada no terminal") });
  if (R.assignedAt) ev.push({ d: R.assignedAt, t: t("Canal {c}", { c: t(R.channel || "") }) });
  (R.rounds || []).forEach((r, i) => { if (r.req) ev.push({ d: r.req, t: t("{n}ª exigência", { n: i + 1 }) + (r.note ? " · " + r.note : "") }); if (r.sub) ev.push({ d: r.sub, t: t("Resposta à {n}ª exigência", { n: i + 1 }) }); });
  if (M.clearedAt) ev.push({ d: M.clearedAt, t: t("Desembaraçado") });
  if (A?.lastExit) ev.push({ d: A.lastExit, t: t("Saída do terminal") });
  if (R.nextStepDate && M.stage !== "cleared" && M.stage !== "out") ev.push({ d: R.nextStepDate, t: t("Próximo passo"), off: true });
  ev.sort((a, b) => a.d.localeCompare(b.d));
  const dur = R.assignedAt && M.clearedAt ? daysBetween(R.assignedAt, M.clearedAt) : null;
  const f = (k, v) => (v ? `<div><div class="muted small">${k}</div><div>${v}</div></div>` : "");
  return `${ev.length ? `<div class="timeline">${ev.map((e, i) => `<div class="tl">${i < ev.length - 1 ? '<div class="line"></div>' : ""}<div class="dot ${e.off ? "off" : ""}"></div><div class="d">${fmtD(e.d)}</div><div class="t">${esc(e.t)}</div></div>`).join("")}</div>` : ""}
  ${dur !== null ? `<p class="small">${t("Do canal ao desembaraço: <b>{n} dias</b>", { n: dur })}${R.rounds?.length ? " · " + plural(R.rounds.length, "exigência") : ""}.</p>` : ""}
  <div class="form" style="margin-top:10px">
    ${f(t("Motivo da estadia longa / custos extras"), R.reason ? `<b>${esc(R.reason)}</b>` : "")}
    ${f(t("Informação solicitada pela fiscalização"), esc(R.infoRequested))}
    ${f(t("Lote (batch)"), esc(R.batch))}${f(t("Ex-tarifário"), esc(R.exTariff))}${f(t("Documentos / laudos"), esc(R.official))}
    ${f(t("Próximo passo"), R.nextStep ? esc(R.nextStep) + (R.nextStepDate ? ` (${fmtD(R.nextStepDate)})` : "") : "")}
    ${f(t("Demurrage estimado"), R.demurrage ? "US$ " + nf(R.demurrage, 2) : "")}
    ${R.notes ? `<div class="wide">${f(t("Observações"), esc(R.notes))}</div>` : ""}
  </div>
  <p class="axis-note">${t("Fonte")}: ${esc(t(R.source || "registro manual"))} · ${t("atualizado em {d}", { d: fmtD((R.updatedAt || "").slice(0, 10)) })}</p>`;
}

/* ---------- pagamento, aprovação e conferências */
const APPROVAL = { pendente: "Pendente", enviado: "E-mail enviado aos diretores", aprovado: "Aprovado pelos diretores", reprovado: "Reprovado / em contestação" };
function approvalBadge(id) {
  const a = (Data.db.pay[id] || {}).approval || "pendente";
  const cls = a === "aprovado" ? "b-ok" : a === "reprovado" ? "ch-Vermelho" : "b-warn";
  return `<span class="badge ${cls}">${t(APPROVAL[a])}</span>`;
}
function checks(id, P, A, R, M) {
  const pay = Data.db.pay[id] || {};
  const c = [];
  c.push({ ok: !P.warnings?.length, t: t("Soma dos serviços = total informado pelo terminal"), auto: true });
  c.push({ ok: !A.tariffIssues, t: A.tariffIssues ? t("{n} cobrança(s) diferentes do tarifário", { n: A.tariffIssues }) : t("Valores de acordo com o tarifário"), auto: true });
  c.push({ ok: !(A.extra > 0.004) || !!(R?.reason || R?.infoRequested), t: t("Custos extras com motivo registrado"), auto: true });
  if (M.channel === "Verde" && A.extra_customs > 0.004) c.push({ ok: !!R?.reason, t: t("Canal verde com inspeção: MAPA confirmado"), auto: true });
  c.push({ ok: ["enviado", "aprovado"].includes(pay.approval), t: t("E-mail de aprovação enviado aos diretores") });
  c.push({ ok: pay.approval === "aprovado", t: t("Aprovação dos diretores recebida") });
  c.push({ ok: !!pay.icg, t: t("Lançado no ICG depois da aprovação") });
  c.push({ ok: !!pay.nfeOk, t: t("NF-e conferida com o demonstrativo (até 24h úteis)") });
  return c;
}
function payPanel(id, P, A, R, M) {
  const pay = Data.db.pay[id] || {};
  const c = checks(id, P, A, R, M);
  return `<p>${approvalBadge(id)} ${pay.approvedAt ? `<span class="small muted">${fmtD(pay.approvedAt)}${pay.approver ? " · " + esc(pay.approver) : ""}</span>` : ""}</p>
  <ul class="checklist">${c.map((x) => `<li class="${x.ok ? "ok" : "no"}">${x.ok ? "✓" : "○"} ${esc(x.t)} ${x.auto ? `<span class="muted small">(${t("automático")})</span>` : ""}</li>`).join("")}</ul>
  ${pay.icg ? `<p class="small">ICG: <b>${esc(pay.icg)}</b>${pay.paidAt ? " · " + t("pago em {d}", { d: fmtD(pay.paidAt) }) : ""}</p>` : ""}
  <div class="row"><button class="btn sm primary" onclick="approvalEmail('${esc(id)}')">✉ ${t("Gerar e-mail de aprovação")}</button><a class="small" href="#pagamentos">${t("Ver procedimento de pagamento →")}</a></div>`;
}
function editPay(id) {
  const p = Data.db.pay[id] || { approval: "pendente" };
  openModal(`<h2>${t("Pagamento e controle")} · ${esc(id)}</h2><form id="pay-form" class="form">
    <label class="f">${t("Aprovação")}<select name="approval">${Object.entries(APPROVAL).map(([k, v]) => `<option value="${k}" ${p.approval === k ? "selected" : ""}>${t(v)}</option>`).join("")}</select></label>
    <label class="f">${t("Data do e-mail")}<input type="date" name="emailAt" value="${esc(p.emailAt || "")}"></label>
    <label class="f">${t("Data da aprovação")}<input type="date" name="approvedAt" value="${esc(p.approvedAt || "")}"></label>
    <label class="f">${t("Aprovado por")}<input name="approver" value="${esc(p.approver || "")}"></label>
    <label class="f">${t("Nº do lançamento no ICG")}<input name="icg" value="${esc(p.icg || "")}"></label>
    <label class="f">${t("Data do pagamento")}<input type="date" name="paidAt" value="${esc(p.paidAt || "")}"></label>
    <label class="f">${t("Valor pago (R$)")}<input type="number" step="0.01" name="paid" value="${esc(p.paid ?? "")}"></label>
    <label class="f">${t("NF-e conferida")}<select name="nfeOk"><option value="">${t("Não")}</option><option value="1" ${p.nfeOk ? "selected" : ""}>${t("Sim")}</option></select></label>
    <label class="f wide">${t("Observações")}<textarea name="notes">${esc(p.notes || "")}</textarea></label>
    <div class="wide row"><button class="btn primary">${t("Salvar")}</button><button type="button" class="btn" onclick="closeModal()">${t("Cancelar")}</button></div></form>`);
  $("#pay-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (fd.icg && fd.approval !== "aprovado" && !confirm(t("Atenção: lançamento no ICG sem aprovação dos diretores registrada. Salvar mesmo assim?"))) return;
    Data.db.pay[id] = { ...fd, paid: fd.paid === "" ? null : +fd.paid, nfeOk: !!fd.nfeOk, updatedAt: new Date().toISOString() };
    Data.log(`Pagamento ${id}: ${fd.approval}`); await Data.save(); closeModal(); toast(t("Salvo")); route();
  });
}

/** Texto do e-mail de aprovação aos diretores (contramedida do risco do ICG). */
function emailText(id, lang) {
  const keep = LANG; LANG = lang;
  try {
    const P = Data.db.processes[id], A = Data.analysis(id), R = Data.db.red[id], M = Data.merged(id, P, R, A, Data.hist(id));
    const items = {};
    for (const l of A.lines) if (l.group !== "regular") { const k = (items[l.key] ??= { v: 0, n: new Set() }); k.v += l.value; k.n.add(l.container); }
    const subject = t("[Aprovação] Pagamento Santos Brasil · {id} · {v}", { id, v: brl(A.total) });
    const lines = [
      t("Prezados diretores,"), "",
      t("Solicito a aprovação do pagamento abaixo antes do lançamento no ICG."), "",
      `${t("Processo")}: ${id} · BL ${P.bl} · ${P.duimp}`,
      `${t("Navio")}: ${P.vessel} ${P.voyage} · ${plural(A.n, "contêiner", "contêineres")} · ${t("Canal")}: ${M.channel ? t(M.channel) : "—"}`,
      `${t("Fornecedor")}: Santos Brasil · NF-e ${P.nfe} · RPS ${P.rps}`, "",
      `${t("Total a pagar")}: ${brl(A.total)}`,
      `  • ${t("Custos regulares")}: ${brl(A.regular)}`,
      `  • ${t("Extra armazenagem")} (KPI 1): ${brl(A.extra_storage)}`,
      `  • ${t("Extra desembaraço")} (KPI 3): ${brl(A.extra_customs)}`,
      ...Object.entries(items).sort((a, b) => b[1].v - a[1].v).map(([k, v]) => `      – ${itemName(k)}: ${brl(v.v)} (${plural(v.n.size, "contêiner", "contêineres")})`), "",
      `${t("Motivo")}: ${R?.reason || R?.infoRequested || (M.mapaFlag ? t("Canal verde com inspeção: confirmar MAPA") : "—")}`,
      `${t("Conferências")}: ${checks(id, P, A, R, M).filter((c) => c.auto).map((c) => (c.ok ? "✓ " : "⚠ ") + c.t).join("; ")}`, "",
      t("Favor responder a este e-mail com a aprovação."), "", t("Obrigado(a)."),
    ];
    return { subject, body: lines.join("\n") };
  } finally { LANG = keep; }
}
function approvalEmail(id) {
  const render = (lang) => {
    const parts = lang === "en+zh" ? [emailText(id, "en"), emailText(id, "zh")] : [emailText(id, lang)];
    const subject = parts.map((p) => p.subject).join(" / "), body = parts.map((p) => p.body).join("\n\n————————\n\n");
    $("#mail-subject").value = subject; $("#mail-body").value = body;
    $("#mail-link").href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  openModal(`<h2>${t("E-mail de aprovação aos diretores")} · ${esc(id)}</h2>
    <p class="small muted">${t("Contramedida do risco do ICG: o pagamento só deve ser lançado depois da confirmação por escrito dos diretores.")}</p>
    <div class="row" style="margin-bottom:8px">${t("Idioma")}: <select id="mail-lang"><option value="pt">Português</option><option value="en">English</option><option value="zh">中文</option><option value="en+zh">English + 中文</option></select></div>
    <label class="f">${t("Assunto")}<input id="mail-subject" style="width:100%"></label>
    <label class="f" style="margin-top:8px">${t("Texto")}<textarea id="mail-body" style="min-height:300px;font-family:inherit"></textarea></label>
    <div class="row" style="margin-top:8px"><button class="btn primary" id="mail-copy">${t("Copiar texto")}</button><a class="btn" id="mail-link">${t("Abrir no e-mail")}</a>
      <button class="btn" id="mail-sent">${t("Marcar como enviado")}</button></div>`);
  $("#mail-lang").value = LANG; render(LANG);
  $("#mail-lang").addEventListener("change", (e) => render(e.target.value));
  $("#mail-copy").addEventListener("click", () => navigator.clipboard?.writeText($("#mail-subject").value + "\n\n" + $("#mail-body").value).then(() => toast(t("Copiado")), () => toast(t("Não foi possível copiar"))));
  $("#mail-sent").addEventListener("click", async () => {
    const p = Data.db.pay[id] || {};
    Data.db.pay[id] = { ...p, approval: p.approval === "aprovado" ? "aprovado" : "enviado", emailAt: today(), updatedAt: new Date().toISOString() };
    Data.log(`E-mail de aprovação enviado: ${id}`); await Data.save(); closeModal(); toast(t("Salvo")); route();
  });
}

function editRed(id) {
  const R = Data.db.red[id] || { channel: "", status: "Em andamento", rounds: [] };
  const rounds = [...(R.rounds || [])];
  while (rounds.length < 3) rounds.push({ req: "", sub: "", note: "" });
  const isNew = !id;
  const STAT = ["Em andamento", "Aguardando fiscalização", "Exigência em aberto", "Desembaraçado"];
  openModal(`<h2>${isNew ? t("Novo registro de desembaraço") : t("Desembaraço") + " · " + esc(id)}</h2>
  <form id="red-form" class="form">
    ${isNew ? `<label class="f">${t("Processo (IRA)")}<input name="id" placeholder="IRA1818/26" required></label>` : ""}
    <label class="f">${t("Canal")}<select name="channel">${["", ...CHANNELS].map((c) => `<option ${R.channel === c ? "selected" : ""} value="${c}">${c ? t(c) : "—"}</option>`).join("")}</select></label>
    <label class="f">${t("Data do canal")}<input type="date" name="assignedAt" value="${esc(R.assignedAt || "")}"></label>
    <label class="f">${t("Situação")}<select name="status">${STAT.map((c) => `<option value="${c}" ${R.status === c ? "selected" : ""}>${t(c)}</option>`).join("")}</select></label>
    <label class="f">${t("Data do desembaraço")}<input type="date" name="clearedAt" value="${esc(R.clearedAt || "")}"></label>
    <label class="f">${t("Lote (batch)")}<input name="batch" value="${esc(R.batch || "")}"></label>
    <label class="f">${t("Contêineres")}<input type="number" name="containers" value="${esc(R.containers ?? "")}"></label>
    <label class="f">${t("Total de dias no porto")}<input type="number" name="daysHeld" value="${esc(R.daysHeld ?? "")}"></label>
    <label class="f">${t("Demurrage estimado (US$)")}<input type="number" step="0.01" name="demurrage" value="${esc(R.demurrage ?? "")}"></label>
    <label class="f">${t("Ex-tarifário")}<input name="exTariff" value="${esc(R.exTariff || "")}"></label>
    <div class="wide"><h3>${t("Exigências da fiscalização")}</h3>
      <table><thead><tr><th>#</th><th>${t("Data da exigência")}</th><th>${t("Data da resposta")}</th><th>${t("Observação")}</th></tr></thead><tbody>
      ${rounds.map((r, i) => `<tr><td>${i + 1}</td><td><input type="date" name="req-${i}" value="${esc(r.req || "")}"></td><td><input type="date" name="sub-${i}" value="${esc(r.sub || "")}"></td><td><input name="note-${i}" value="${esc(r.note || "")}" style="width:100%"></td></tr>`).join("")}
      </tbody></table></div>
    <label class="f wide">${t("Motivo da estadia longa / custos extras")}<textarea name="reason" placeholder="${esc(t("Ex.: canal vermelho com conferência física; inspeção MAPA; exigência de laudo técnico…"))}">${esc(R.reason || "")}</textarea></label>
    <label class="f wide">${t("Informação solicitada pela fiscalização")}<textarea name="infoRequested">${esc(R.infoRequested || "")}</textarea></label>
    <label class="f wide">${t("Documentos / laudos")}<input name="official" value="${esc(R.official || "")}"></label>
    <label class="f wide">${t("Próximo passo")}<input name="nextStep" value="${esc(R.nextStep || "")}"></label>
    <label class="f">${t("Data do próximo passo")}<input type="date" name="nextStepDate" value="${esc(R.nextStepDate || "")}"></label>
    <label class="f wide">${t("Observações")}<textarea name="notes">${esc(R.notes || "")}</textarea></label>
    <div class="wide row"><button class="btn primary" type="submit">${t("Salvar")}</button><button class="btn" type="button" onclick="closeModal()">${t("Cancelar")}</button>
      ${!isNew && Data.db.red[id] ? `<button class="btn danger" type="button" onclick="delRed('${esc(id)}')">${t("Excluir registro")}</button>` : ""}</div>
  </form>`);
  $("#red-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const pid = isNew ? procId(fd.id) || fd.id.trim().toUpperCase() : id;
    if (!pid) return toast(t("Informe o número do processo"));
    const rec = { id: pid, source: R.source || "registro manual", rounds: [] };
    for (const k of ["channel", "assignedAt", "status", "clearedAt", "batch", "exTariff", "reason", "infoRequested", "official", "nextStep", "nextStepDate", "notes"]) rec[k] = fd[k] || "";
    for (const k of ["containers", "daysHeld", "demurrage"]) rec[k] = fd[k] === "" ? null : +fd[k];
    for (let i = 0; i < rounds.length; i++) if (fd["req-" + i] || fd["sub-" + i]) rec.rounds.push({ req: fd["req-" + i], sub: fd["sub-" + i], note: fd["note-" + i] });
    Data.db.red[pid] = { ...(Data.db.red[pid] || {}), ...rec, updatedAt: new Date().toISOString() };
    Data.log(`Desembaraço ${pid} atualizado`);
    await Data.save(); closeModal(); toast(t("Salvo")); route();
  });
}
async function delRed(id) { if (!confirm(t("Excluir o registro de desembaraço de {id}?", { id }))) return; delete Data.db.red[id]; await Data.save(); closeModal(); route(); }

/* ------------------------------------------------------------------ CUSTOS EXTRAS */
function viewExtras(sel) {
  const rows = filtered(), T = totals(rows);
  const items = Object.values(T.byKey).sort((a, b) => b.value - a.value);
  const lines = [];
  for (const { id, A, R, M } of rows) if (A) for (const l of A.lines) if (l.group !== "regular" && (!sel || l.key === sel)) lines.push({ id, R, M, l });
  const perProc = rows.filter((r) => r.A && r.A.extra > 0.004).sort((a, b) => b.A.extra - a.A.extra);
  view().innerHTML = `<div class="title-row"><h1>${t("Custos extras")} ${sel ? "· " + esc(itemName(sel)) : ""}</h1>${sel ? `<a class="btn" href="#extras">← ${t("todos os tipos")}</a>` : ""}</div>
  ${filterBar()}
  <div class="tiles">
    <div class="tile hero"><div class="k">${t("Custos extras")}</div><div class="v">${brl(T.extra)}</div><div class="s">${pct(T.extra, T.total)} ${t("do custo total")}</div></div>
    <div class="tile"><div class="k">${gKey("extra_storage")}${t("Armazenagem além do período livre")}</div><div class="v">${brl(T.extra_storage)}</div><div class="s">KPI 1 · Storage</div></div>
    <div class="tile"><div class="k">${gKey("extra_customs")}${t("Inspeção e desembaraço")}</div><div class="v">${brl(T.extra_customs)}</div><div class="s">KPI 3 · Customs costs</div></div>
  </div>
  <div class="grid2">
  <div class="panel"><h2>${t("Por tipo de custo")}</h2><p class="muted small">${t("Clique num tipo para ver os contêineres.")}</p>
    <table><thead><tr><th>${t("Tipo")}</th><th>KPI</th><th class="n">${t("Processos")}</th><th class="n">${t("Contêineres")}</th><th class="n">${t("Total")}</th><th class="n">${t("% extra")}</th></tr></thead><tbody>
    ${items.map((i) => { const procs = new Set(rows.filter((r) => r.A?.lines.some((l) => l.key === i.key)).map((r) => r.id)); return `<tr class="click" onclick="location.hash='#extras/${encodeURIComponent(i.key)}'" ${sel === i.key ? 'style="outline:2px solid var(--brand)"' : ""}><td>${gKey(i.group)} ${esc(itemName(i.key))}</td><td><span class="kpi-tag">${kpiName(i.group)}</span></td><td class="n">${procs.size}</td><td class="n">${i.conts.size}</td><td class="n">${brl(i.value)}</td><td class="n">${pct(i.value, T.extra)}</td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">${t("Nenhum custo extra.")}</td></tr>`}
    </tbody></table></div>
  <div class="panel"><h2>${t("Por processo e motivo")}</h2>
    <table><thead><tr><th>${t("Processo")}</th><th class="n">${t("Armazenagem")}</th><th class="n">${t("Desembaraço")}</th><th class="n">${t("Total extra")}</th><th>${t("Motivo registrado")}</th></tr></thead><tbody>
    ${perProc.map(({ id, A, R, M }) => `<tr class="click" onclick="location.hash='#p/${key(id)}'"><td><b>${esc(id)}</b><br>${chBadge(M.channel, M.channelSource)}</td><td class="n">${brl(A.extra_storage)}</td><td class="n">${brl(A.extra_customs)}</td><td class="n"><b>${brl(A.extra)}</b></td>
      <td class="small">${R?.reason ? esc(R.reason) : R?.infoRequested ? esc(R.infoRequested) : M.mapaFlag ? `<span class="badge b-warn">${t("MAPA? confirmar")}</span>` : `<span class="badge b-warn">${t("sem motivo")}</span>`}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">${t("Nenhum.")}</td></tr>`}
    </tbody></table></div>
  </div>
  <div class="panel"><h2>${t("Detalhe por contêiner")} ${sel ? "· " + esc(itemName(sel)) : ""}</h2><div class="tbl-wrap"><table><thead><tr><th>${t("Processo")}</th><th>${t("Contêiner")}</th><th>${t("Item")}</th><th class="n">${t("Qtd.")}</th><th class="n">${t("Valor")}</th><th>${t("Canal")}</th><th>${t("Situação")}</th></tr></thead><tbody>
  ${lines.sort((a, b) => b.l.value - a.l.value).map(({ id, R, M, l }) => `<tr class="click" onclick="location.hash='#p/${key(id)}'"><td><b>${esc(id)}</b></td><td>${esc(l.container)}</td><td>${gKey(l.group)} ${esc(itemName(l.key))}</td><td class="n">${l.qty ? l.qty + " d" : 1}</td><td class="n">${brl(l.value)}</td><td>${chBadge(M.channel, M.channelSource)}</td><td>${stageBadge(M, R)}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">${t("Nenhum.")}</td></tr>`}
  </tbody></table></div></div>`;
  bindFilters();
}

/* ------------------------------------------------------------------ CANAL VERMELHO */
function redSummary(rows) {
  const red = rows.filter((r) => r.M.channel === "Vermelho" && r.R);
  const free = Data.freeDays();
  const cont = red.reduce((a, r) => a + (r.A?.n || r.R.containers || 0), 0);
  const over = red.reduce((a, r) => a + (r.A ? r.A.over : (r.R.daysHeld || 0) > free ? r.R.containers || 0 : 0), 0);
  const ex = red.filter((r) => /^(S|Y|SIM|YES)/i.test(r.R.exTariff || "")).length;
  return {
    pt: `Há ${red.length} processo(s) no canal vermelho, totalizando ${cont} contêineres. ${over} contêiner(es) já excederam o período livre de armazenagem. Desses processos, ${ex} incluem peças com benefício de Ex-tarifário.`,
    en: `Summary: There are currently ${red.length} shipments in the red customs channel, totaling ${cont} containers. ${over} containers have already exceeded the free storage period. Of these shipments, ${ex} include parts covered by Ex-tariff benefits.`,
    zh: `总结：目前有${red.length}批货物处于海关红色通道，共涉及${cont}个集装箱。其中，${over}个集装箱已超过免费堆存期。在这些批次中，${ex}批包含适用Ex-tariff关税优惠的零部件。`,
  };
}
function viewCanal() {
  const rows = filtered(true).filter((r) => r.R);
  const s = redSummary(rows);
  const found = rows.filter((r) => r.P).length;
  view().innerHTML = `<div class="title-row"><h1>${t("Canal vermelho e desembaraço")}</h1><div class="row">
    <button class="btn primary" onclick="editRed('')">+ ${t("Novo registro")}</button><a class="btn" href="#importar">⬆ ${t("Importar planilha Red Channel")}</a></div></div>
  ${filterBar()}
  <div class="panel"><h2>${t("Resumo")}</h2><p>${esc(s[LANG])}</p>${LANG !== "pt" ? "" : `<p class="muted small">${esc(s.en)}<br>${esc(s.zh)}</p>`}
    <p class="small">${t("Cruzamento com a Santos Brasil: {a} de {b} processos da planilha Red Channel têm demonstrativo importado; os demais aguardam o demonstrativo (não são duplicados).", { a: found, b: rows.length })}</p>
    <button class="btn sm" onclick="copySummary()">${t("Copiar resumo (EN / 中文)")}</button></div>
  <div class="panel"><div class="tbl-wrap"><table><thead><tr><th>${t("Processo")}</th><th>${t("Demonstrativo Santos Brasil")}</th><th>${t("Lote")}</th><th class="n">${t("Cont.")}</th><th>${t("Canal")}</th><th>${t("Data canal")}</th><th>${t("Exigências")}</th><th>${t("Situação")}</th><th class="n">${t("Dias")}</th>
    <th class="n">${t("Armazenagem 1º período")}</th><th class="n">${t("Período adicional")}</th><th>${t("Motivo")}</th><th>${t("Próximo passo")}</th></tr></thead><tbody>
  ${rows.map(({ id, A, R, M, P }) => {
    const done = M.stage === "cleared" || M.stage === "out";
    const days = done ? (R.assignedAt && M.clearedAt ? daysBetween(R.assignedAt, M.clearedAt) : R.daysHeld) : R.assignedAt ? daysBetween(R.assignedAt, today()) : R.daysHeld;
    const late = R.nextStepDate && R.nextStepDate < today() && !done;
    return `<tr class="click" onclick="location.hash='#p/${key(id)}'"><td><b>${esc(id)}</b></td><td>${P ? `<span class="badge b-ok">✓ ${t("encontrado")}</span>` : `<span class="badge b-warn">${t("aguardando")}</span>`}</td><td class="small">${esc(R.batch || "")}</td><td class="n">${A?.n ?? R.containers ?? "—"}</td><td>${chBadge(R.channel)}</td><td>${fmtD(R.assignedAt)}</td>
      <td class="small" style="white-space:nowrap">${(R.rounds || []).map((r, i) => `${i + 1}ª ${fmtDs(r.req)}${r.sub ? " → " + fmtDs(r.sub) : ` <b>(${t("sem resposta")})</b>`}`).join("<br>") || "—"}</td>
      <td>${stageBadge(M, R)}</td><td class="n">${days ?? "—"}</td>
      <td class="n">${A ? brl(A.storageFirst) : R.storageFirst ? brl(R.storageFirst) : "—"}</td><td class="n">${A ? brl(A.extra_storage) : R.storageAdd ? brl(R.storageAdd) : "—"}</td>
      <td class="small">${esc(R.reason || R.infoRequested || "")}</td><td class="small">${esc(R.nextStep || "")}${R.nextStepDate ? `<br><span class="${late ? "badge b-warn" : "muted"}">${late ? t("vencido") + " " : ""}${fmtD(R.nextStepDate)}</span>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="13" class="muted">${t("Nenhum registro. Importe a planilha Red Channel ou clique em Novo registro.")}</td></tr>`}
  </tbody></table></div></div>`;
  bindFilters();
}
function copySummary() { const s = redSummary(filtered(true).filter((r) => r.R)); navigator.clipboard?.writeText(s.en + "\n" + s.zh).then(() => toast(t("Copiado")), () => toast(t("Não foi possível copiar"))); }

/* ------------------------------------------------------------------ ESTRUTURA DE CUSTOS (fluxo) */
let flowSel = "inspection";
function viewEstrutura() {
  const T = totals(Data.rows());
  const span = (k, a, b) => `<div class="kpibar" style="grid-column:${a} / ${b + 1};--c:${KPI[k].color}">${esc(tx(KPI[k].name))}</div>`;
  view().innerHTML = `<h1>${t("Estrutura de custos")}</h1>
  <p class="lead">${t("Cada custo nasce numa etapa da operação, é cobrado por uma parte e pode aumentar por uma anormalidade. Clique num custo ou numa anormalidade para ver o breakdown, quem cobra, como é pago e como confirmar se a cobrança está correta.")}</p>
  <div class="legend">${Object.values(PARTIES).map((p) => `<span><span class="key" style="background:${p.color}"></span>${esc(tx(p.name))}</span>`).join("")}<span><span class="anom-dot">!</span>${t("Anormalidade")}</span></div>
  <div class="flow-wrap"><div class="flow">
    ${span(2, 1, 9)}${span(1, 2, 7)}${span(3, 3, 5)}
    ${STEPS.map((s) => `<div class="step ${s.n === 9 ? "last" : ""}" style="grid-column:${s.n}"><div class="num">${s.n}</div><div class="sname">${esc(tx(s.name))}</div></div>`).join("")}
    ${STEPS.map((s) => `<div class="costs" style="grid-column:${s.n}">
      ${s.costs.map((c) => `<button class="cost ${flowSel === c.id ? "sel" : ""} ${c.trigger ? "trigger" : ""}" style="--c:${PARTIES[c.party].color}" onclick="selFlow('${c.id}')">${esc(tx(c.name))}${c.kpi ? `<span class="kpi-mini">KPI ${c.kpi}</span>` : ""}</button>`).join("")}
      ${s.anomalies.map((a) => `<button class="anom ${flowSel === "a:" + a ? "sel" : ""}" onclick="selFlow('a:${a}')"><span class="anom-dot">!</span>${esc(tx(ANOMALIES[a]))}</button>`).join("")}
    </div>`).join("")}
  </div></div>
  <div id="flow-detail">${flowDetail(T)}</div>`;
}
function selFlow(id) { flowSel = flowSel === id ? null : id; viewEstrutura(); $("#flow-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
function findCost(id) { for (const s of STEPS) for (const c of s.costs) if (c.id === id) return { s, c }; return null; }
function flowDetail(T) {
  if (!flowSel) return `<div class="panel muted">${t("Selecione um custo ou uma anormalidade no fluxo acima.")}</div>`;
  if (flowSel.startsWith("a:")) {
    const a = flowSel.slice(2), steps = STEPS.filter((s) => s.anomalies.includes(a));
    return `<div class="panel anom-panel"><h2>⚠ ${esc(tx(ANOMALIES[a]))}</h2>
      <p>${t("Acontece na etapa")}: ${steps.map((s) => `<b>${s.n}. ${esc(tx(s.name))}</b>`).join(", ")}</p>
      <h3>${t("Custos gerados ou aumentados")}</h3><div class="row">${(IMPACTS[a] || []).map((cid) => { const f = findCost(cid); return f ? `<button class="cost" style="--c:${PARTIES[f.c.party].color}" onclick="selFlow('${cid}')">${f.s.n}. ${esc(tx(f.c.name))}</button>` : ""; }).join("")}</div></div>`;
  }
  const f = findCost(flowSel); if (!f) return "";
  const { s, c } = f;
  const anomalies = Object.entries(IMPACTS).filter(([, v]) => v.includes(c.id)).map(([k]) => k);
  let real = "";
  if (c.data && T.procs) {
    const v = c.data === "storageFirst" ? Data.rows().reduce((a, r) => a + (r.A?.storageFirst || 0), 0) : T[c.data];
    const items = c.data === "extra_customs" || c.data === "extra_storage" ? Object.values(T.byKey).filter((i) => i.group === c.data) : [];
    real = `<h3>${t("Nos processos importados")}</h3><p><b>${brl(v)}</b> · ${plural(T.procs, "processo")}</p>
      ${items.length ? `<table><tbody>${items.sort((a, b) => b.value - a.value).map((i) => `<tr class="click" onclick="location.hash='#extras/${encodeURIComponent(i.key)}'"><td>${esc(itemName(i.key))}</td><td class="n">${plural(i.conts.size, "contêiner", "contêineres")}</td><td class="n">${brl(i.value)}</td></tr>`).join("")}</tbody></table>` : ""}`;
  }
  return `<div class="panel cost-panel" style="--c:${PARTIES[c.party].color}"><h2>${esc(tx(c.name))}</h2>
    <div class="form">
      <div><div class="muted small">${t("Gerado na etapa")}</div><b>${s.n}. ${esc(tx(s.name))}</b></div>
      <div><div class="muted small">${t("Quem cobra")}</div><span class="key" style="background:${PARTIES[c.party].color}"></span> ${esc(tx(PARTIES[c.party].name))}</div>
      <div><div class="muted small">${t("Como é pago")}</div>${esc(tx(c.route))}</div>
      <div><div class="muted small">KPI</div>${c.kpi ? esc(tx(KPI[c.kpi].name)) : "—"}</div>
    </div>
    ${c.breakdown ? `<h3>${t("Breakdown")}</h3><ul>${c.breakdown.map((b) => `<li>${esc(tx(b))}</li>`).join("")}</ul>` : ""}
    ${anomalies.length ? `<h3>${t("Pode aumentar por")}</h3><div class="row">${anomalies.map((a) => `<button class="anom" onclick="selFlow('a:${a}')"><span class="anom-dot">!</span>${esc(tx(ANOMALIES[a]))}</button>`).join("")}</div>` : ""}
    <h3>✓ ${t("Como confirmar se a cobrança está correta")}</h3><p class="okbox">${esc(tx(c.check))}</p>
    ${real}</div>`;
}

/* ------------------------------------------------------------------ PAGAMENTOS E CONTROLE */
let paySel = 5;
function viewPagamentos() {
  const pays = Data.db.payments || [];
  const single = pays.filter((p) => p.ap1 && !p.ap2);
  const rows = Data.rows().filter((r) => r.A);
  const lanes = Object.keys(LANES);
  view().innerHTML = `<h1>${t("Pagamentos e controle")}</h1>
  <p class="lead">${t("Como cada cobrança da operação vira pagamento, onde está o risco e como confirmar, em cada passo, se o pagamento está de acordo.")}</p>
  <div class="panel"><h2>${t("Fluxo do pagamento")}</h2><p class="muted small">${t("Clique num passo para ver o que fazer, como confirmar e a evidência.")}</p>
    <div class="flow-wrap"><div class="swim" id="swim" style="grid-template-columns:150px repeat(${PAY_STEPS.length}, minmax(110px,1fr))">
      ${lanes.map((ln, li) => `<div class="lane-name" style="grid-row:${li + 1}">${esc(tx(LANES[ln]))}</div>${PAY_STEPS.map((p) => `<div class="lane-cell" style="grid-row:${li + 1};grid-column:${p.n + 1}"></div>`).join("")}`).join("")}
      ${PAY_STEPS.map((p) => `<button class="pnode ${p.risk ? "risk" : ""} ${p.counter ? "counter" : ""} ${paySel === p.n ? "sel" : ""}" data-n="${p.n}" style="grid-row:${lanes.indexOf(p.lane) + 1};grid-column:${p.n + 1}" onclick="paySel=${p.n};viewPagamentos()">
        <span class="pn">${p.n}</span>${esc(tx(p.title))}${p.risk ? `<span class="tag">⚠ ${t("RISCO")}</span>` : ""}${p.counter ? `<span class="tag">✓ ${t("CONTRAMEDIDA")}</span>` : ""}</button>`).join("")}
      <svg class="swim-svg" id="swim-svg"></svg>
    </div></div>
    ${payDetail()}
  </div>
  <div class="grid2">
    <div class="panel"><h2>${t("Riscos e contramedidas")}</h2><table><thead><tr><th>${t("Risco")}</th><th>${t("Impacto")}</th><th>${t("Contramedida")}</th></tr></thead><tbody>
      ${RISKS.map((r) => `<tr><td><span class="badge ${r.level === 3 ? "ch-Vermelho" : r.level === 2 ? "b-warn" : "b-none"}">${r.level === 3 ? t("Alto") : r.level === 2 ? t("Médio") : t("Baixo")}</span><br><b>${esc(tx(r.title))}</b></td><td class="small">${esc(tx(r.impact))}</td><td class="small">${esc(tx(r.counter))}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="panel"><h2>${t("Evidência do risco no ICG")}</h2>
      ${pays.length ? `<p>${t("Na planilha COMEX (aba de pagamentos), <b>{a} de {b}</b> pagamentos ({v}) foram aprovados por <b>apenas 1 aprovador</b>, sem segundo aprovador nem diretor.", { a: single.length, b: pays.length, v: brl(single.reduce((x, p) => x + p.value, 0)) })}</p>
        <table><thead><tr><th>${t("Processo")}</th><th>${t("Data")}</th><th>${t("Tipo")}</th><th class="n">${t("Valor")}</th><th>${t("Aprovadores")}</th></tr></thead><tbody>
        ${pays.slice().sort((a, b) => b.value - a.value).map((p) => `<tr><td>${esc(p.id)}</td><td>${fmtD(p.date)}</td><td class="small">${p.kind === "laudo" ? t("Laudo técnico (engenheiro)") : t("Outros")}</td><td class="n">${brl(p.value)}</td><td>${p.ap2 ? "2" : `<span class="badge ch-Vermelho">1</span>`}</td></tr>`).join("")}</tbody></table>
        <p class="axis-note">${t("Nomes de pessoas e de fornecedores não são guardados no sistema.")}</p>` : `<p class="muted">${t("Importe a planilha COMEX para ver os pagamentos feitos pelo sistema e quantos aprovadores cada um teve.")}</p>`}
    </div>
  </div>
  <div class="panel"><h2>${t("Aprovação dos processos")}</h2>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>${t("Processo")}</th><th class="n">${t("Total")}</th><th class="n">${t("Extra")}</th><th>${t("Conferências automáticas")}</th><th>${t("Aprovação")}</th><th>ICG</th><th></th></tr></thead><tbody>
    ${rows.map(({ id, P, A, R, M }) => { const c = checks(id, P, A, R, M).filter((x) => x.auto); const pay = Data.db.pay[id] || {}; return `<tr><td><a href="#p/${key(id)}"><b>${esc(id)}</b></a></td><td class="n">${brl(A.total)}</td><td class="n">${brl(A.extra)}</td>
      <td class="small">${c.map((x) => `<span title="${esc(x.t)}">${x.ok ? "✓" : "⚠"}</span>`).join(" ")} ${c.every((x) => x.ok) ? t("ok") : t("{n} pendência(s)", { n: c.filter((x) => !x.ok).length })}</td>
      <td>${approvalBadge(id)}</td><td class="small">${esc(pay.icg || "—")}</td><td style="white-space:nowrap"><button class="btn sm" title="${esc(t("Gerar e-mail de aprovação"))}" onclick="approvalEmail('${esc(id)}')">✉</button> <button class="btn sm" title="${esc(t("Editar"))}" onclick="editPay('${esc(id)}')">✎</button></td></tr>`; }).join("")}
    </tbody></table></div>` : `<p class="muted">${t("Sem processos importados.")}</p>`}
  </div>
  <div class="panel"><h2>${t("Procedimento")}</h2><div class="tbl-wrap"><table><thead><tr><th>#</th><th>${t("Responsável")}</th><th>${t("O que fazer")}</th><th>${t("Como confirmar")}</th><th>${t("Evidência")}</th></tr></thead><tbody>
    ${PAY_STEPS.map((p) => `<tr ${p.risk ? 'class="risk-row"' : p.counter ? 'class="counter-row"' : ""}><td><b>${p.n}</b></td><td class="small">${esc(tx(LANES[p.lane]))}</td><td><b>${esc(tx(p.title))}</b><br><span class="small">${esc(tx(p.what))}</span></td><td class="small">${esc(tx(p.check))}</td><td class="small">${esc(tx(p.evidence))}</td></tr>`).join("")}
  </tbody></table></div></div>`;
  requestAnimationFrame(drawSwim);
}
function payDetail() {
  const p = PAY_STEPS.find((x) => x.n === paySel); if (!p) return "";
  return `<div class="pdetail ${p.risk ? "risk" : ""} ${p.counter ? "counter" : ""}"><h3>${p.n}. ${esc(tx(p.title))} <span class="muted small">· ${esc(tx(LANES[p.lane]))}</span></h3>
    <p>${esc(tx(p.what))}</p><p class="okbox"><b>✓ ${t("Como confirmar")}:</b> ${esc(tx(p.check))}</p><p class="small muted">${t("Evidência")}: ${esc(tx(p.evidence))}</p></div>`;
}
function drawSwim() {
  const box = $("#swim"), svg = $("#swim-svg"); if (!box || !svg) return;
  const b = box.getBoundingClientRect();
  svg.setAttribute("width", box.scrollWidth); svg.setAttribute("height", box.scrollHeight);
  const nodes = PAY_STEPS.map((p) => box.querySelector(`.pnode[data-n="${p.n}"]`).getBoundingClientRect());
  let d = "";
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i], c = nodes[i + 1];
    const x1 = a.right - b.left, y1 = a.top + a.height / 2 - b.top, x2 = c.left - b.left, y2 = c.top + c.height / 2 - b.top, mx = (x1 + x2) / 2;
    d += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 6},${y2}" /><polygon points="${x2},${y2} ${x2 - 7},${y2 - 4} ${x2 - 7},${y2 + 4}" />`;
  }
  svg.innerHTML = d;
}
window.addEventListener("resize", () => { if (location.hash.startsWith("#pagamentos")) drawSwim(); });

/* ------------------------------------------------------------------ HISTÓRICO COMEX */
let histQ = "";
function viewHistorico() {
  const h = Data.db.history;
  if (!h) { view().innerHTML = `<h1>${t("Histórico COMEX")}</h1><div class="panel empty"><p>${t("Importe a planilha COMEX expenses analysis para ver o histórico de processos anteriores, comparar com os processos críticos e acompanhar os KPIs.")}</p><a class="btn primary" href="#importar">⬆ ${t("Importar planilhas")}</a></div>`; return; }
  const all = Object.values(h.processes);
  const free = Data.freeDays();
  const byCh = {};
  for (const p of all) (byCh[p.channel || "?"] ??= []).push(p);
  const cont = all.reduce((a, p) => a + p.n, 0), stor = all.reduce((a, p) => a + p.storage, 0), contBilled = all.filter((p) => p.storage > 0).reduce((a, p) => a + p.n, 0), dem = all.reduce((a, p) => a + p.demurrage, 0);
  const noOver = all.filter((p) => p.overDays !== null && p.overDays <= 0).length, withOver = all.filter((p) => p.overDays !== null).length;
  const months = {};
  for (const p of all) { const m = (p.presence || "").slice(0, 7); if (!m) continue; const x = (months[m] ??= { n: 0, cont: 0, storage: 0, over: 0, overN: 0 }); x.n++; if (p.storage > 0) { x.cont += p.n; x.storage += p.storage; } if (p.overDays !== null) { x.overN++; if (p.overDays > 0) x.over++; } }
  const mk = Object.keys(months).sort();
  const maxCpu = Math.max(REF_CPU.green * 1.2, ...mk.map((m) => (months[m].cont ? months[m].storage / months[m].cont : 0)));
  const q = histQ.trim().toUpperCase();
  const top = all.filter((p) => !q || [p.id, p.bl, p.duimp, p.batch].join(" ").toUpperCase().includes(q)).sort((a, b) => (b.overDays || 0) - (a.overDays || 0)).slice(0, 30);
  const crit = Object.keys(Data.db.processes);
  const medA = median(all.map((p) => daysBetween(p.presence, p.cleared)).filter((x) => x !== null && x >= 0)) ?? 0;
  const medB = median(all.map((p) => daysBetween(p.cleared, p.pickup)).filter((x) => x !== null && x >= 0)) ?? 0;
  view().innerHTML = `<h1>${t("Histórico COMEX")}</h1><p class="muted small">${t("Arquivo")}: ${esc(h.file)} · ${t("importado em {d}", { d: fmtD((h.at || "").slice(0, 10)) })}</p>
  <p class="lead">${t("O histórico tem <b>{p}</b> ({c}). Só <b>{w}</b> dos processos ficaram dentro da estadia sem custo extra ({d} dias): a maior parte do excesso acontece depois do desembaraço (mediana de {a} dias até desembaraçar e {b} dias do desembaraço até a retirada).", {
    p: plural(all.length, "processo"), c: plural(cont, "contêiner", "contêineres"), w: pct(noOver, withOver), d: free, a: nf(medA), b: nf(medB) })}</p>
  <div class="tiles">
    <div class="tile hero"><div class="k">${t("Processos")}</div><div class="v">${nf(all.length)}</div><div class="s">${plural(cont, "contêiner", "contêineres")}</div></div>
    <div class="tile kpi"><div class="k">${t("Estadia sem custo extra (≤ {d} dias)", { d: free })}</div><div class="v">${pct(noOver, withOver)}</div><div class="s">${t("{a} de {b} processos", { a: nf(noOver), b: nf(withOver) })}</div></div>
    <div class="tile"><div class="k">${t("Armazenagem")}</div><div class="v">${brlK(stor)}</div><div class="s">${t("{v} por contêiner · meta {m}", { v: brl(contBilled ? stor / contBilled : 0), m: brl(REF_CPU.green) })}</div></div>
    <div class="tile"><div class="k">Demurrage</div><div class="v">${brlK(dem)}</div><div class="s">KPI 2</div></div>
    <div class="tile"><div class="k">${t("Processos críticos no histórico")}</div><div class="v">${crit.filter((id) => h.processes[id]).length} / ${crit.length}</div><div class="s">${t("com demonstrativo da Santos Brasil")}</div></div>
  </div>
  <div class="grid2">
    <div class="panel"><h2>${t("Por canal")}</h2><div class="tbl-wrap"><table><thead><tr><th>${t("Canal")}</th><th class="n">${t("Processos")}</th><th class="n">${t("Contêineres")}</th><th class="n">${t("Dias até desembaraço")}</th><th class="n">${t("Desembaraço → retirada")}</th><th class="n">${t("% com excesso")}</th><th class="n">${t("Armazenagem / contêiner")}</th></tr></thead><tbody>
      ${Object.entries(byCh).sort((a, b) => b[1].length - a[1].length).map(([ch, L2]) => { const c = L2.reduce((a, p) => a + p.n, 0), cb = L2.filter((p) => p.storage > 0).reduce((a, p) => a + p.n, 0), s = L2.reduce((a, p) => a + p.storage, 0), ov = L2.filter((p) => p.overDays !== null); return `<tr><td>${ch === "?" ? t("sem canal") : chBadge(ch)}</td><td class="n">${nf(L2.length)}</td><td class="n">${nf(c)}</td>
        <td class="n">${nf(median(L2.map((p) => daysBetween(p.presence, p.cleared)).filter((x) => x !== null && x >= 0)) ?? 0)}</td><td class="n">${nf(median(L2.map((p) => daysBetween(p.cleared, p.pickup)).filter((x) => x !== null && x >= 0)) ?? 0)}</td>
        <td class="n">${pct(ov.filter((p) => p.overDays > 0).length, ov.length)}</td><td class="n">${brl(cb ? s / cb : 0)}</td></tr>`; }).join("")}
    </tbody></table></div><p class="axis-note">${t("Medianas em dias. Dias até desembaraço = presença de carga → desembaraço.")}</p></div>
    <div class="panel"><h2>${t("Armazenagem por contêiner, por mês")}</h2>
      <div class="hbar">${mk.map((m) => { const x = months[m], v = x.cont ? x.storage / x.cont : 0; return `<div class="lab">${m.slice(5)}/${m.slice(2, 4)}</div><div class="track ref" style="--ref:${(REF_CPU.green / maxCpu) * 100}%"><div class="seg" style="width:${(v / maxCpu) * 100}%;background:${v > REF_CPU.green ? "var(--s-storage)" : "var(--s-regular)"}" data-tip="${m}<br>${brl(v)} ${esc(t("por contêiner"))}<br>${plural(x.n, "processo")} · ${plural(x.cont, "contêiner", "contêineres")}<br>${esc(t("% com excesso"))}: ${pct(x.over, x.overN)}"></div></div><div class="val">${brl(v)}</div>`; }).join("")}</div>
      <p class="axis-note">${t("Mês da presença de carga. Linha tracejada = meta {m} por contêiner (canal verde). Laranja = acima da meta.", { m: brl(REF_CPU.green) })} ${t("Só processos com taxa de armazenagem lançada.")}</p></div>
  </div>
  <div class="panel"><div class="title-row"><h2>${t("Processos com mais dias além do período livre")}</h2><input id="hq" placeholder="${esc(t("Buscar processo, BL, DUIMP…"))}" value="${esc(histQ)}"></div>
    <div class="tbl-wrap"><table><thead><tr><th>${t("Processo")}</th><th>${t("Canal")}</th><th class="n">${t("Cont.")}</th><th>${t("Presença")}</th><th>${t("Desembaraço")}</th><th>${t("Retirada")}</th><th class="n">${t("Dias armaz.")}</th><th class="n">${t("Além de {d}", { d: free })}</th><th class="n">${t("Armazenagem")}</th><th class="n">Demurrage</th></tr></thead><tbody>
    ${top.map((p) => `<tr class="${Data.db.processes[p.id] ? "click" : ""}" ${Data.db.processes[p.id] ? `onclick="location.hash='#p/${key(p.id)}'"` : ""}><td><b>${esc(p.id)}</b>${Data.db.processes[p.id] ? ` <span class="badge b-warn">${t("crítico")}</span>` : ""}</td><td>${chBadge(p.channel)}</td><td class="n">${p.n}</td><td>${fmtD(p.presence)}</td><td>${fmtD(p.cleared)}</td><td>${fmtD(p.pickup)}</td><td class="n">${p.storageDays ?? "—"}</td><td class="n">${p.overDays ?? "—"}</td><td class="n">${brl(p.storage)}</td><td class="n">${brl(p.demurrage)}</td></tr>`).join("")}
    </tbody></table></div></div>`;
  $("#hq").addEventListener("input", (e) => { histQ = e.target.value; clearTimeout(viewHistorico._t); viewHistorico._t = setTimeout(() => { viewHistorico(); const i = $("#hq"); i.focus(); i.setSelectionRange(histQ.length, histQ.length); }, 300); });
}

/* ------------------------------------------------------------------ IMPORTAR */
let pending = [];
function viewImportar() {
  const ups = Data.db.uploads || [];
  const kindName = { sb: t("Demonstrativo Santos Brasil"), rc: t("Planilha Red Channel"), cx: t("Planilha COMEX (histórico)") };
  view().innerHTML = `<h1>${t("Importar planilhas")}</h1>
  <div class="grid3c">
    <div class="panel"><h2>${t("Demonstrativos da Santos Brasil")}</h2><p class="small">${t("Arquivos IRAxxxx-xx_Cost_Breakdown.xlsx. O sistema separa cada contêiner e serviço, divide a armazenagem em período livre × dias adicionais e confere com o tarifário e os totais do terminal.")}</p></div>
    <div class="panel"><h2>${t("Planilha Red Channel")}</h2><p class="small">${t("Cada linha é ligada ao processo de mesmo número IRA já importado da Santos Brasil (sem duplicar): traz canal, exigências, situação e próximos passos.")}</p></div>
    <div class="panel"><h2>${t("Planilha COMEX")}</h2><p class="small">${t("Histórico de muitos processos (canal, datas, armazenagem, demurrage, taxas) e pagamentos feitos pelo sistema. Pode levar alguns segundos.")}</p></div>
  </div>
  <label class="drop" id="drop"><input type="file" id="files" multiple accept=".xlsx,.xlsm,.csv" hidden>
    <b>${t("Arraste os arquivos aqui")}</b> ${t("ou clique para escolher")}<br><span class="muted small">${t("Pode mandar vários de uma vez. O tipo de cada planilha é reconhecido sozinho.")}</span></label>
  <div id="pending"></div>
  <div class="panel" style="margin-top:16px"><h2>${t("Arquivos importados")}</h2>
    ${ups.length ? `<div class="tbl-wrap"><table><thead><tr><th>${t("Arquivo")}</th><th>${t("Tipo")}</th><th>${t("Importado em")}</th><th>${t("Processos")}</th><th></th></tr></thead><tbody>
    ${ups.map((u) => `<tr><td>${esc(u.name)}</td><td>${kindName[u.kind] || u.kind}</td><td>${esc(u.at.slice(0, 16).replace("T", " "))}</td><td class="small">${u.kind === "cx" ? nf(u.ids.length) : esc([...new Set(u.ids)].join(", "))}</td>
      <td><button class="btn sm danger" onclick="delUpload('${u.id}')">🗑 ${t("Excluir")}</button></td></tr>`).join("")}</tbody></table></div>
    <p class="axis-note">${t("Excluir um arquivo desfaz o que ele trouxe: o processo volta para a versão anterior (se outro arquivo já tinha trazido o mesmo processo) ou sai do sistema.")}</p>`
    : `<p class="muted">${t("Nenhum arquivo importado ainda.")}</p>`}</div>`;
  const drop = $("#drop"), inp = $("#files");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFiles([...e.dataTransfer.files]); });
  inp.addEventListener("change", () => readFiles([...inp.files]));
  renderPending();
}
async function delUpload(uid) {
  const u = Data.db.uploads.find((x) => x.id === uid);
  if (!u || !confirm(t("Excluir o arquivo {f} e desfazer o que ele trouxe?", { f: u.name }))) return;
  await Data.deleteUpload(uid); await Data.save(); toast(t("Arquivo excluído")); route();
}
async function readFiles(files) {
  for (const file of files) {
    const item = { file, name: file.name };
    const el = $("#pending"); if (el) el.innerHTML = `<p class="muted">${t("Lendo {f}…", { f: esc(file.name) })}</p>`;
    try {
      const book = await Book.read(file);
      if (SB.pickSheet(book)) { item.kind = "sb"; item.P = SB.parse(book, file.name); }
      else if (CX.isComex(book)) { item.kind = "cx"; item.H = CX.parse(book); }
      else {
        const recs = RC.parse(book);
        if (recs.length) { item.kind = "rc"; item.recs = recs; }
        else throw new Error(t("Não reconheci a planilha: não há demonstrativo da Santos Brasil, planilha COMEX nem números de processo IRA."));
      }
    } catch (e) { item.error = e.message || String(e); }
    pending.push(item);
  }
  renderPending();
}
function renderPending() {
  const el = $("#pending"); if (!el) return;
  if (!pending.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="panel" style="margin-top:16px"><h2>${t("Conferir antes de salvar")}</h2>
  <div class="tbl-wrap"><table><thead><tr><th>${t("Arquivo")}</th><th>${t("Tipo")}</th><th>${t("Processo")}</th><th>${t("Conteúdo")}</th><th>${t("Conferência")}</th><th></th></tr></thead><tbody>
  ${pending.map((it, i) => {
    const rm = `<button class="btn sm" onclick="pending.splice(${i},1);renderPending()">${t("remover")}</button>`;
    if (it.error) return `<tr><td>${esc(it.name)}</td><td colspan="4"><span class="badge b-warn">${t("erro")}</span> ${esc(it.error)}</td><td>${rm}</td></tr>`;
    if (it.kind === "sb") {
      const A = analyze(it.P, Data.rules(), Data.freeDays(), Data.tariff()), exists = !!Data.db.processes[it.P.id];
      return `<tr><td>${esc(it.name)}</td><td>${t("Demonstrativo Santos Brasil")}</td>
        <td><input value="${esc(it.P.id)}" placeholder="IRA0000/26" onchange="pending[${i}].P.id=procId(this.value)||this.value.trim().toUpperCase();renderPending()" style="width:120px">
          ${!it.P.id ? `<br><span class="badge b-warn">${t("informe o número IRA")}</span>` : exists ? `<br><span class="badge b-warn">${t("já existe: será substituído")}</span>` : ""}${Data.db.red[it.P.id] ? `<br><span class="badge b-ok">${t("ligado ao Red Channel")}</span>` : ""}</td>
        <td class="small">BL ${esc(it.P.bl)} · ${plural(A.n, "contêiner", "contêineres")} · ${t("Total")} <b>${brl(A.total)}</b><br>${t("Regular")} ${brl(A.regular)} · ${t("Extra armaz.")} ${brl(A.extra_storage)} · ${t("Extra desemb.")} ${brl(A.extra_customs)}</td>
        <td>${it.P.warnings.length ? it.P.warnings.map((w) => `<div class="small" style="color:var(--warn)">⚠ ${esc(w)}</div>`).join("") : `<span class="badge b-ok">✓ ${t("bate com o terminal")}</span>`}${A.tariffIssues ? `<br><span class="badge b-warn">⚠ ${t("{n} cobrança(s) diferentes do tarifário", { n: A.tariffIssues })}</span>` : ""}</td><td>${rm}</td></tr>`;
    }
    if (it.kind === "cx") {
      const ps = Object.values(it.H.processes), crit = Object.keys(Data.db.processes).filter((id) => it.H.processes[id]);
      return `<tr><td>${esc(it.name)}</td><td>${t("Planilha COMEX (histórico)")}</td><td>${nf(ps.length)}</td>
        <td class="small">${plural(ps.reduce((a, p) => a + p.n, 0), "contêiner", "contêineres")} · ${t("{n} pagamentos", { n: it.H.payments.length })}</td>
        <td class="small">${t("{n} processos críticos encontrados no histórico", { n: crit.length })}${Data.db.history ? `<br><span class="badge b-warn">${t("substitui o histórico atual")}</span>` : ""}</td><td>${rm}</td></tr>`;
    }
    return `<tr><td>${esc(it.name)}</td><td>${t("Planilha Red Channel")}</td><td>${it.recs.length}</td>
      <td class="small">${it.recs.map((r) => `<b>${esc(r.id)}</b> ${esc(t(r.status))}${r.rounds.length ? ` · ${r.rounds.length} ${t("exig.")}` : ""} — ${Data.db.processes[r.id] ? `<span class="badge b-ok">✓ ${t("existe na Santos Brasil: atualiza o status")}</span>` : `<span class="badge b-warn">${t("sem demonstrativo da Santos Brasil (fica aguardando)")}</span>`}`).join("<br>")}</td>
      <td class="small muted">${t("Campos vazios na planilha não apagam o que já foi registrado.")}</td><td>${rm}</td></tr>`;
  }).join("")}</tbody></table></div>
  <div class="row" style="margin-top:12px"><button class="btn primary" id="commit">${t("Salvar")} (${pending.filter((p) => !p.error).length})</button><button class="btn" onclick="pending=[];renderPending()">${t("Descartar")}</button></div></div>`;
  $("#commit").addEventListener("click", commitPending);
}
async function commitPending() {
  const ok = pending.filter((p) => !p.error);
  if (ok.some((p) => p.kind === "sb" && !p.P.id)) return toast(t("Informe o número IRA de todos os demonstrativos"));
  for (const it of ok) {
    const u = Data.newUpload(it.name, it.kind);
    if (it.kind === "sb") Data.upsertProcess(it.P, u);
    else if (it.kind === "cx") { Data.setHistory(it.H, u); Data.log(`Importada planilha COMEX ${it.name} (${Object.keys(it.H.processes).length} processos)`); }
    else { for (const r of it.recs) Data.upsertRed(r, u); Data.log(`Importada planilha Red Channel ${it.name} (${it.recs.length} processos)`); }
    if (Data.folder) {
      const dir = { sb: "SANTOS_BRASIL", rc: "RED_CHANNEL", cx: "COMEX" }[it.kind];
      u.path = `${dir}/${today()}_${it.name.replace(/[\\/:*?"<>|]/g, "_")}`;
      try { await Data.write(u.path, it.file); } catch (e) { console.warn(e); }
    }
  }
  pending = pending.filter((p) => p.error);
  await Data.save();
  toast(t("{n} arquivo(s) salvos", { n: ok.length }));
  location.hash = "#painel";
}

/* ------------------------------------------------------------------ CONFIG */
function viewConfig() {
  const rules = Data.rules(), tariff = Data.tariff();
  const unknown = new Map();
  for (const P of Object.values(Data.db.processes)) for (const c of P.containers) for (const s of c.services) if (classify(s.name, rules).unknown) unknown.set(s.name, (unknown.get(s.name) || 0) + 1);
  const GR = [["storage", "Armazenagem (divide por período)"], ["regular", "Regular"], ["extra_customs", "Extra · desembaraço (KPI 3)"], ["extra_storage", "Extra · armazenagem (KPI 1)"]];
  view().innerHTML = `<h1>${t("Configurações")}</h1>
  <div class="panel"><h2>${t("Regras de classificação dos serviços")}</h2>
    <p class="small">${t("Cada serviço cobrado pela Santos Brasil é comparado com as regras de cima para baixo (texto sem acentos; use | para alternativas). A armazenagem é dividida sozinha: o 1º período é regular e os dias adicionais são extra de armazenagem (KPI 1).")}</p>
    ${unknown.size ? `<div class="warnbox">${t("Serviços sem regra")}: ${[...unknown].map(([n, q]) => `<b>${esc(n)}</b> (${q}×)`).join(", ")}</div>` : ""}
    <div class="tbl-wrap"><table><thead><tr><th>${t("Texto no nome do serviço")}</th><th>${t("Nome no sistema")}</th><th>${t("Grupo")}</th><th></th></tr></thead><tbody id="rules">
    ${rules.map((r, i) => `<tr><td><input data-i="${i}" data-k="match" value="${esc(r.match)}" style="width:100%"></td><td><input data-i="${i}" data-k="label" value="${esc(r.label)}" style="width:100%"></td>
      <td><select data-i="${i}" data-k="group">${GR.map(([v, l]) => `<option value="${v}" ${r.group === v ? "selected" : ""}>${t(l)}</option>`).join("")}</select></td>
      <td class="n" style="white-space:nowrap"><button class="btn sm" onclick="moveRule(${i},-1)">↑</button> <button class="btn sm" onclick="moveRule(${i},1)">↓</button> <button class="btn sm danger" onclick="delRule(${i})">×</button></td></tr>`).join("")}
    </tbody></table></div>
    <div class="row" style="margin-top:8px"><button class="btn sm" onclick="addRule()">+ ${t("Regra")}</button><button class="btn sm primary" onclick="saveRules()">${t("Salvar regras")}</button><button class="btn sm" onclick="resetRules()">${t("Restaurar padrão")}</button></div></div>
  <div class="panel"><h2>${t("Tarifário Santos Brasil (valor com impostos)")}</h2>
    <p class="small">${t("Usado para conferir cada cobrança. Mínimo = o valor pode ser maior quando calculado sobre o CIF. Valor vazio = pode variar (não confere).")}</p>
    <div class="tbl-wrap"><table><thead><tr><th>${t("Serviço")}</th><th>${t("Texto no nome")}</th><th class="n">${t("Valor (R$)")}</th><th>${t("Mínimo")}</th><th>${t("Só canal ≠ verde / MAPA")}</th></tr></thead><tbody id="tariff">
    ${tariff.map((x, i) => `<tr><td>${esc(t(x.label))}</td><td class="small muted">${esc(x.match)}</td><td class="n"><input data-t="${i}" type="number" step="0.01" value="${x.value ?? ""}" style="width:110px"></td><td>${x.min ? "✓" : ""}</td><td>${x.nonGreen ? "✓" : ""}</td></tr>`).join("")}
    </tbody></table></div><div class="row" style="margin-top:8px"><button class="btn sm primary" onclick="saveTariff()">${t("Salvar tarifário")}</button></div></div>
  <div class="grid2">
    <div class="panel"><h2>${t("KPIs")}</h2><div class="form">
      <label class="f">${t("Estadia sem custo extra (dias)")}<input type="number" id="freeDays" value="${Data.freeDays()}"></label>
      <label class="f">${t("Prazo livre de demurrage (dias)")}<input type="number" id="demDays" value="${Data.db.settings.demurrageDays || 40}"></label></div>
      <div class="row" style="margin-top:8px"><button class="btn sm primary" onclick="saveParams()">${t("Salvar")}</button></div>
      <p class="small muted">${t("Meta de custo regular por contêiner: {g} (canal verde) e {o} (outros canais), conforme planilha COMEX.", { g: brl(REF_CPU.green), o: brl(REF_CPU.other) })}</p></div>
    <div class="panel"><h2>${t("Onde ficam os dados")}</h2>
      <p class="small">${t("Os dados são salvos automaticamente neste navegador. Para ter backup e usar em equipe, escolha uma pasta de trabalho (ex.: OneDrive/SharePoint).")}</p>
      <p>${Data.folder ? `<span class="store-badge on">${t("Pasta")}: ${esc(Data.folder.name)}</span>` : `<span class="store-badge">${t("Só neste navegador")}</span>`}</p>
      <div class="row">${Data.folderSupported() ? `<button class="btn sm" onclick="pickFolder()">${Data.folder ? t("Trocar pasta") : t("Escolher pasta de trabalho")}</button>` : `<span class="muted small">${t("Pasta de trabalho exige Edge ou Chrome.")}</span>`}
      ${Data.pendingFolder && !Data.folder ? `<button class="btn sm" onclick="reconnect()">${t("Continuar com a pasta {f}", { f: esc(Data.pendingFolder.name) })}</button>` : ""}</div>
      <h3>${t("Backup")}</h3><div class="row"><button class="btn sm" onclick="exportJson()">⬇ ${t("Baixar backup (.json)")}</button><label class="btn sm">⬆ ${t("Restaurar backup")}<input type="file" accept=".json" hidden onchange="importJson(this.files[0])"></label>
      <button class="btn sm" onclick="exportCsv()">⬇ ${t("Linhas de custo (.csv)")}</button></div>
      <h3>${t("Dados de exemplo")}</h3><div class="row">${typeof SEED !== "undefined" ? `<button class="btn sm" onclick="loadSeed()">${t("Carregar exemplos")}</button>` : ""}<button class="btn sm danger" onclick="clearAll()">${t("Apagar todos os dados")}</button></div></div>
  </div>
  <div class="panel"><h2>${t("Histórico de alterações")}</h2><table><tbody>${Data.db.log.slice(0, 30).map((l) => `<tr><td class="small muted" style="width:160px">${esc(l.at.slice(0, 16).replace("T", " "))}</td><td class="small">${esc(l.msg)}</td></tr>`).join("") || `<tr><td class="muted">—</td></tr>`}</tbody></table></div>`;
}
function readRules() { const r = Data.rules().map((x) => ({ ...x })); $$("#rules [data-i]").forEach((el) => { r[+el.dataset.i][el.dataset.k] = el.value; }); return r; }
function addRule() { Data.db.rules = [...readRules(), { match: "", label: "", group: "extra_customs" }]; viewConfig(); }
function delRule(i) { const r = readRules(); r.splice(i, 1); Data.db.rules = r; viewConfig(); }
function moveRule(i, d) { const r = readRules(); const j = i + d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; Data.db.rules = r; viewConfig(); }
async function saveRules() { Data.db.rules = readRules().filter((r) => r.match.trim()); Data.log("Regras de classificação alteradas"); await Data.save(); toast(t("Regras salvas: os custos foram recalculados")); viewConfig(); }
async function resetRules() { if (!confirm(t("Restaurar as regras padrão?"))) return; Data.db.rules = DEFAULT_RULES.map((r) => ({ ...r })); await Data.save(); viewConfig(); }
async function saveTariff() { const tf = Data.tariff().map((x) => ({ ...x })); $$("#tariff [data-t]").forEach((el) => { tf[+el.dataset.t].value = el.value === "" ? null : +el.value; }); Data.db.tariff = tf; Data.log("Tarifário alterado"); await Data.save(); toast(t("Salvo")); }
async function saveParams() { Data.db.settings.freeDays = +$("#freeDays").value || 15; Data.db.settings.demurrageDays = +$("#demDays").value || 40; await Data.save(); toast(t("Salvo")); }
async function pickFolder() { try { await Data.pickFolder(); renderShell(); toast(t("Pasta conectada")); route(); } catch (e) { if (e.name !== "AbortError") toast(e.message); } }
async function reconnect() { if (await Data.reconnect()) { renderShell(); route(); } }
function download(name, data, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportJson() { download(`custos-aduaneiros-backup-${today()}.json`, JSON.stringify(Data.db, null, 1), "application/json"); }
async function importJson(file) {
  if (!file) return;
  try { const db = JSON.parse(await file.text()); if (!db.processes) throw new Error("?"); if (!confirm(t("Substituir todos os dados atuais pelo backup?"))) return; Data.db = Object.assign(Data.empty(), db); await Data.save(); toast(t("Backup restaurado")); route(); }
  catch { toast(t("Arquivo inválido")); }
}
function exportCsv() {
  const n2 = (v) => (v ?? 0).toFixed(2).replace(".", ",");
  const head = ["Processo", "BL", "DUIMP", "Navio", "Canal", "Contêiner", "Entrada", "Saída", "Estadia (dias)", "Serviço (terminal)", "Código", "Item", "Grupo", "KPI", "Qtd.", "Valor (R$)", "Tarifário (R$)"];
  const out = [head.map((h) => t(h)).join(";")];
  for (const { id, P, A, M } of filtered()) if (A) for (const c of A.containers) for (const l of c.lines)
    out.push([id, P.bl, P.duimp, P.vessel, M.channel ? t(M.channel) : "", c.id, fmtD(c.entry), fmtD(c.exit), c.stay ?? "", l.service.name, l.service.code, itemName(l.key), gName(l.group), kpiName(l.group), l.qty || 1, n2(l.value), l.tariff?.expected ? n2(l.tariff.expected) : ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
  download(`custos-aduaneiros-${today()}.csv`, "﻿" + out.join("\r\n"), "text/csv");
}
async function loadSeed() {
  const u = Data.newUpload(t("Exemplos (5 demonstrativos)"), "sb");
  for (const P of SEED.processes) Data.upsertProcess(P, u);
  if (SEED.history && !Data.db.history) {
    const cols = SEED.history.cols, procs = {};
    for (const row of SEED.history.rows) { const p = {}; cols.forEach((c, i) => { p[c] = row[i]; }); procs[p.id] = p; }
    const u2 = Data.newUpload(t("Exemplo: histórico COMEX"), "cx");
    Data.setHistory({ processes: procs, payments: SEED.history.payments || [] }, u2);
  }
  Data.log("Carregados os exemplos"); await Data.save(); toast(t("Exemplos carregados")); location.hash = "#painel"; route();
}
async function clearAll() { if (!confirm(t("Apagar TODOS os processos, registros de canal, histórico e anotações?"))) return; const { rules, settings, tariff } = Data.db; Data.db = Object.assign(Data.empty(), { rules, settings, tariff }); await Data.save(); route(); }
function emptyState() {
  view().innerHTML = `<div class="panel empty"><h1>${t("Custos aduaneiros")}</h1>
    <p>${t("Comece importando os demonstrativos da Santos Brasil (IRAxxxx-xx_Cost_Breakdown.xlsx) e, se quiser, a planilha Red Channel e a planilha COMEX.")}</p>
    <div class="row" style="justify-content:center"><a class="btn primary" href="#importar">⬆ ${t("Importar planilhas")}</a>${typeof SEED !== "undefined" ? `<button class="btn" onclick="loadSeed()">${t("Ver com os processos de exemplo")}</button>` : ""}</div></div>`;
}

/* ------------------------------------------------------------------ menu vertical e rotas */
const NAV = [
  ["painel", "Painel", "▦"], ["processos", "Processos", "☰"], ["extras", "Custos extras", "◆"], ["canal", "Canal vermelho", "●"],
  ["estrutura", "Estrutura de custos", "⇢"], ["pagamentos", "Pagamentos e controle", "✓"], ["historico", "Histórico COMEX", "◷"],
  ["importar", "Importar", "⬆"], ["config", "Configurações", "⚙"],
];
function renderShell() {
  $("#side").innerHTML = `<div class="brand">${t("Custos Aduaneiros")}<small>Storage · Customs costs · Santos Brasil</small></div>
    <select class="lang" onchange="setLang(this.value)" aria-label="Idioma / Language / 语言">
      <option value="pt" ${LANG === "pt" ? "selected" : ""}>Português</option><option value="en" ${LANG === "en" ? "selected" : ""}>English</option><option value="zh" ${LANG === "zh" ? "selected" : ""}>中文</option></select>
    <nav>${NAV.map(([h, label, ic]) => `<a href="#${h}" data-h="${h}"><span class="ic">${ic}</span>${t(label)}</a>`).join("")}</nav>
    <span class="store-badge ${Data.folder ? "on" : ""}">${Data.folder ? t("Pasta") + ": " + esc(Data.folder.name) : t("Salvo neste navegador")}</span>`;
  document.title = t("Custos Aduaneiros");
  markNav();
}
function markNav() {
  const page = (decodeURIComponent(location.hash.slice(1)) || "painel").split("/")[0];
  $$("#side nav a").forEach((a) => a.classList.toggle("active", a.dataset.h === (page === "p" ? "processos" : page)));
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1) || "painel");
  const [page, ...rest] = h.split("/");
  const arg = rest.join("/");
  markNav();
  if (page === "p") viewProcesso(unkey(arg));
  else if (page === "processos") viewProcessos();
  else if (page === "extras") viewExtras(arg || "");
  else if (page === "canal") viewCanal();
  else if (page === "estrutura") viewEstrutura();
  else if (page === "pagamentos") viewPagamentos();
  else if (page === "historico") viewHistorico();
  else if (page === "importar") viewImportar();
  else if (page === "config") viewConfig();
  else viewPainel();
}
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
(async () => { document.documentElement.lang = LOCALE[LANG]; await Data.load(); renderShell(); route(); })();
