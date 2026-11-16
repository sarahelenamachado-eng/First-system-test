/* Interface do sistema de custos aduaneiros. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (v) => (v === null || v === undefined || isNaN(v) ? "—" : BRL.format(v));
const brlK = (v) => (Math.abs(v) >= 1e6 ? "R$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi" : Math.abs(v) >= 1e4 ? "R$ " + (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : brl(v));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0).toLocaleString("pt-BR") + "%";
const fmtD = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : iso || "—");
const plural = (n, s, p) => `${n.toLocaleString("pt-BR")} ${n === 1 ? s : p || s + "s"}`;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : null);
const key = (id) => encodeURIComponent(procKey(id));
const unkey = (k) => decodeURIComponent(k).replace(/^(IRA\d+)-(\d{2})$/, "$1/$2");

const view = () => $("#view");
let F = { q: "", ch: "", month: "" };

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 2600); }
function openModal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); }

function chBadge(ch) { return ch ? `<span class="badge ch-${esc(ch)}">${esc(ch)}</span>` : `<span class="badge b-none">sem canal</span>`; }
function stBadge(R) {
  if (!R) return `<span class="badge b-none">sem controle</span>`;
  return R.status === "Desembaraçado" ? `<span class="badge b-ok">✓ Desembaraçado${R.clearedAt ? " " + fmtD(R.clearedAt) : ""}</span>` : `<span class="badge b-warn">◷ ${esc(R.status || "Em andamento")}</span>`;
}
const gKey = (g) => `<span class="key" style="background:${GROUPS[g].color}"></span>`;

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
function filtered() {
  const q = F.q.trim().toUpperCase();
  return Data.rows().filter(({ id, P, R, A }) => {
    if (F.ch && (R?.channel || "") !== F.ch) return false;
    if (F.month && !(A?.firstEntry || R?.assignedAt || "").startsWith(F.month)) return false;
    if (q) {
      const hay = [id, P?.bl, P?.duimp, P?.vessel, R?.batch, ...(P?.containers || []).map((c) => c.id)].join(" ").toUpperCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function filterBar() {
  const months = [...new Set(Data.rows().map(({ A, R }) => (A?.firstEntry || R?.assignedAt || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const active = F.q || F.ch || F.month;
  return `<div class="filters">
    <input id="f-q" placeholder="Buscar processo, BL, DUIMP, contêiner…" value="${esc(F.q)}" style="min-width:260px">
    <select id="f-ch"><option value="">Todos os canais</option>${["Vermelho", "Amarelo", "Verde", "Cinza"].map((c) => `<option ${F.ch === c ? "selected" : ""}>${c}</option>`).join("")}</select>
    <select id="f-month"><option value="">Todas as entradas</option>${months.map((m) => `<option value="${m}" ${F.month === m ? "selected" : ""}>Entrada em ${m.slice(5)}/${m.slice(0, 4)}</option>`).join("")}</select>
    ${active ? `<button class="btn sm" id="f-clear">Limpar filtros</button>` : ""}
  </div>`;
}
function bindFilters() {
  const re = () => { const pos = $("#f-q")?.selectionStart; route(); const i = $("#f-q"); if (i && document.activeElement !== i && pos !== undefined) { i.focus(); i.setSelectionRange(pos, pos); } };
  $("#f-q")?.addEventListener("input", (e) => { F.q = e.target.value; clearTimeout(bindFilters._t); bindFilters._t = setTimeout(re, 250); });
  $("#f-ch")?.addEventListener("change", (e) => { F.ch = e.target.value; route(); });
  $("#f-month")?.addEventListener("change", (e) => { F.month = e.target.value; route(); });
  $("#f-clear")?.addEventListener("click", () => { F = { q: "", ch: "", month: "" }; route(); });
}

function totals(rows) {
  const t = { procs: 0, cont: 0, regular: 0, extra_storage: 0, extra_customs: 0, total: 0, over: 0, physical: 0, withExtra: 0, unknown: 0, redOpen: 0, redAll: 0, redCont: 0, byKey: {} };
  for (const { A, R } of rows) {
    if (R && R.channel === "Vermelho") { t.redAll++; if (R.status !== "Desembaraçado") t.redOpen++; t.redCont += A?.n || R.containers || 0; }
    if (!A) continue;
    t.procs++; t.cont += A.n; t.regular += A.regular; t.extra_storage += A.extra_storage; t.extra_customs += A.extra_customs; t.total += A.total;
    t.over += A.over; t.physical += A.physical; t.unknown += A.unknown; if (A.extra > 0.004) t.withExtra++;
    for (const l of A.lines) if (l.group !== "regular") {
      const k = (t.byKey[l.key] ??= { key: l.key, group: l.group, value: 0, conts: new Set(), qty: 0 });
      k.value += l.value; k.conts.add(l.container); k.qty += l.qty || 1;
    }
  }
  t.extra = t.extra_storage + t.extra_customs;
  return t;
}

/* ------------------------------------------------------------------ gráficos */
function stackedBars(rows, { onclick = "p" } = {}) {
  const data = rows.filter((r) => r.A).slice(0, 25);
  if (!data.length) return `<p class="muted">Sem demonstrativos importados.</p>`;
  const max = Math.max(...data.map((r) => r.A.total));
  return `<div class="legend">${["regular", "extra_storage", "extra_customs"].map((g) => `<span>${gKey(g)}${GROUPS[g].short || GROUPS[g].label}</span>`).join("")}</div>
  <div class="hbar">${data.map(({ id, A, R }) => {
    const segs = ["regular", "extra_storage", "extra_customs"].filter((g) => A[g] > 0.004).map((g) =>
      `<div class="seg" style="width:${(A[g] / max) * 100}%;background:${GROUPS[g].color}" onclick="location.hash='#p/${key(id)}'"
        data-tip="<b>${esc(id)}</b><br>${esc(GROUPS[g].short || GROUPS[g].label)}: ${brl(A[g])}<br>${pct(A[g], A.total)} do total do processo"></div>`).join("");
    return `<div class="lab"><a href="#p/${key(id)}">${esc(id)}</a> ${R?.channel === "Vermelho" ? `<span class="badge ch-Vermelho" title="Canal vermelho">V</span>` : ""}</div>
      <div class="track">${segs}</div><div class="val">${brlK(A.total)} · <span title="parcela extra">${pct(A.extra, A.total)} extra</span></div>`;
  }).join("")}</div>
  ${rows.filter((r) => r.A).length > 25 ? `<p class="axis-note">Mostrando os 25 maiores. Veja todos em Processos.</p>` : ""}`;
}

function extraByType(t) {
  const items = Object.values(t.byKey).sort((a, b) => b.value - a.value);
  if (!items.length) return `<p class="muted">Nenhum custo extra nos processos filtrados.</p>`;
  const max = items[0].value;
  const groups = [...new Set(items.map((i) => i.group))];
  return `${groups.length > 1 ? `<div class="legend">${groups.map((g) => `<span>${gKey(g)}${GROUPS[g].kpi}</span>`).join("")}</div>` : ""}
  <div class="hbar">${items.map((i) => `<div class="lab" title="${esc(i.key)}"><a href="#extras/${encodeURIComponent(i.key)}">${esc(i.key)}</a></div>
    <div class="track"><div class="seg" style="width:${(i.value / max) * 100}%;background:${GROUPS[i.group].color}" onclick="location.hash='#extras/${encodeURIComponent(i.key)}'"
      data-tip="<b>${esc(i.key)}</b><br>${brl(i.value)} · ${plural(i.conts.size, "contêiner", "contêineres")}<br>${esc(GROUPS[i.group].kpi)}"></div></div>
    <div class="val">${brlK(i.value)}</div>`).join("")}</div>`;
}

function stayBars(rows) {
  const data = rows.filter((r) => r.A || r.R?.daysHeld).map((r) => ({ ...r, stay: r.A?.maxStay || r.R?.daysHeld || 0 })).sort((a, b) => b.stay - a.stay).slice(0, 25);
  if (!data.length) return `<p class="muted">Sem dados de estadia.</p>`;
  const free = Data.freeDays();
  const max = Math.max(free * 1.2, ...data.map((d) => d.stay));
  return `<div class="hbar">${data.map(({ id, stay, A }) => `<div class="lab"><a href="#p/${key(id)}">${esc(id)}</a></div>
    <div class="track ref" style="--ref:${(free / max) * 100}%"><div class="seg" style="width:${(stay / max) * 100}%;background:${stay > free ? "var(--s-storage)" : "var(--s-regular)"}"
      data-tip="<b>${esc(id)}</b><br>Maior estadia: ${stay} dias${A ? `<br>${A.over} de ${A.n} contêineres além de ${free} dias` : ""}"></div></div>
    <div class="val">${stay} dias</div>`).join("")}</div>
  <p class="axis-note">Linha tracejada = período livre de ${free} dias (1º período de armazenagem). Laranja = passou do período livre.</p>`;
}

function compBar(A) {
  return `<div class="compbar">${["regular", "extra_storage", "extra_customs"].filter((g) => A[g] > 0.004).map((g) =>
    `<div class="seg" style="flex:${A[g]};background:${GROUPS[g].color}" data-tip="${esc(GROUPS[g].label)}<br>${brl(A[g])} (${pct(A[g], A.total)})"></div>`).join("")}</div>
  <div class="legend">${["regular", "extra_storage", "extra_customs"].map((g) => `<span>${gKey(g)}${esc(GROUPS[g].short || GROUPS[g].label)}: <b>${brl(A[g])}</b> (${pct(A[g], A.total)})</span>`).join("")}</div>`;
}

/* ------------------------------------------------------------------ resumo em texto */
function summaryText(rows, t) {
  const free = Data.freeDays();
  const s = [];
  s.push(`Há <b>${plural(t.procs, "processo")}</b> com demonstrativo da Santos Brasil, somando <b>${plural(t.cont, "contêiner", "contêineres")}</b> e <b>${brl(t.total)}</b> em custos de terminal.`);
  if (t.total) s.push(`Desse total, <b>${brl(t.extra)} (${pct(t.extra, t.total)})</b> são custos extras: ${brl(t.extra_storage)} de armazenagem além do período livre (KPI 1) e ${brl(t.extra_customs)} de inspeção/desembaraço (KPI 3), em ${plural(t.withExtra, "processo")}.`);
  if (t.over || t.physical) s.push(`<b>${plural(t.over, "contêiner", "contêineres")}</b> passaram do período livre de ${free} dias e <b>${t.physical}</b> tiveram inspeção física (posicionamento).`);
  if (t.redAll) s.push(`<b>${plural(t.redAll, "processo")}</b> no canal vermelho (${t.redOpen} ainda não desembaraçado${t.redOpen === 1 ? "" : "s"}).`);
  return s.join(" ");
}

/* ------------------------------------------------------------------ PAINEL */
function viewPainel() {
  const all = Data.rows();
  if (!all.length) return emptyState();
  const rows = filtered(), t = totals(rows);
  view().innerHTML = `
  <div class="title-row"><h1>Painel de custos aduaneiros</h1><div class="row"><a class="btn" href="#importar">⬆ Importar planilhas</a><button class="btn" onclick="exportCsv()">⬇ Exportar CSV</button></div></div>
  ${filterBar()}
  <p class="lead">${summaryText(rows, t)}</p>
  <div class="tiles">
    <a class="tile hero" href="#processos"><div class="k">Processos</div><div class="v">${t.procs}</div><div class="s">${plural(t.cont, "contêiner", "contêineres")}${rows.length > t.procs ? ` · +${rows.length - t.procs} só no controle de canal` : ""}</div></a>
    <a class="tile hero" href="#processos"><div class="k">Custo total</div><div class="v">${brlK(t.total)}</div><div class="s">${t.cont ? brl(t.total / t.cont) + " por contêiner" : ""}</div></a>
    <div class="tile"><div class="k">${gKey("regular")}Custos regulares</div><div class="v">${brlK(t.regular)}</div><div class="s">${pct(t.regular, t.total)} do total</div></div>
    <a class="tile" href="#extras"><div class="k"><span class="key" style="background:var(--brand)"></span>Custos extras</div><div class="v">${brlK(t.extra)}</div><div class="s">${pct(t.extra, t.total)} do total · ${plural(t.withExtra, "processo")}</div></a>
    <a class="tile" href="#extras"><div class="k">${gKey("extra_storage")}Extra armazenagem</div><div class="v">${brlK(t.extra_storage)}</div><div class="s">KPI 1 · Storage</div></a>
    <a class="tile" href="#extras"><div class="k">${gKey("extra_customs")}Extra desembaraço</div><div class="v">${brlK(t.extra_customs)}</div><div class="s">KPI 3 · Customs costs</div></a>
    <div class="tile"><div class="k">Além do período livre</div><div class="v">${t.over}</div><div class="s">de ${plural(t.cont, "contêiner", "contêineres")} (> ${Data.freeDays()} dias)</div></div>
    <div class="tile"><div class="k">Inspeção física</div><div class="v">${t.physical}</div><div class="s">contêineres com posicionamento</div></div>
    <a class="tile" href="#canal"><div class="k"><span class="badge ch-Vermelho">Vermelho</span></div><div class="v">${t.redOpen}</div><div class="s">em aberto · ${t.redAll} no total</div></a>
  </div>
  ${t.unknown ? `<div class="warnbox">⚠ ${plural(t.unknown, "serviço")} sem regra de classificação (contado como extra de desembaraço). Revise em <a href="#config">Configurações → Regras</a>.</div>` : ""}
  <div class="grid3">
    <div class="panel"><h2>Custo por processo</h2><p class="muted small">Clique numa barra para abrir o processo.</p>${stackedBars(rows)}</div>
    <div class="panel"><h2>Custos extras por tipo</h2><p class="muted small">Clique para ver quais processos e contêineres.</p>${extraByType(t)}</div>
  </div>
  <div class="grid2">
    <div class="panel"><h2>Estadia no terminal</h2>${stayBars(rows)}</div>
    <div class="panel"><h2>Processos que exigem atenção</h2>${attention(rows)}</div>
  </div>
  <div class="panel"><div class="title-row"><h2>Processos</h2><a href="#processos" class="small">ver tabela completa →</a></div>${procTable(rows.slice(0, 10))}</div>`;
  bindFilters();
}

function attention(rows) {
  const items = [];
  for (const { id, A, R } of rows) {
    if (R && R.status !== "Desembaraçado" && R.nextStepDate && R.nextStepDate < today()) items.push({ id, w: 3, t: `Próximo passo vencido em ${fmtD(R.nextStepDate)}: ${R.nextStep || "—"}` });
    if (A && A.extra > 0.004 && !(R?.reason || R?.infoRequested)) items.push({ id, w: 2, t: `${brl(A.extra)} de custo extra sem motivo registrado` });
    if (R && R.channel === "Vermelho" && R.status !== "Desembaraçado") items.push({ id, w: 2, t: `Canal vermelho em aberto${R.assignedAt ? ` há ${daysBetween(R.assignedAt, today())} dias` : ""}${R.rounds?.length ? ` · ${R.rounds.length} exigência(s)` : ""}` });
    if (A && A.over) items.push({ id, w: 1, t: `${A.over} de ${A.n} contêineres além do período livre (máx. ${A.maxStay} dias)` });
    if (!A && R) items.push({ id, w: 1, t: `Sem demonstrativo da Santos Brasil importado` });
    if (A && Data.db.processes[id]?.warnings?.length) items.push({ id, w: 2, t: `Valores não conferem com o total do terminal` });
  }
  items.sort((a, b) => b.w - a.w);
  if (!items.length) return `<p class="okbox">Nada pendente nos processos filtrados.</p>`;
  return `<table><tbody>${items.slice(0, 12).map((i) => `<tr class="click" onclick="location.hash='#p/${key(i.id)}'"><td style="width:110px"><b>${esc(i.id)}</b></td><td>${i.w === 3 ? "🔴" : i.w === 2 ? "🟠" : "🟡"} ${esc(i.t)}</td></tr>`).join("")}</tbody></table>
  ${items.length > 12 ? `<p class="axis-note">+${items.length - 12} outros pontos.</p>` : ""}`;
}

function procTable(rows) {
  if (!rows.length) return `<p class="muted">Nenhum processo com esses filtros.</p>`;
  const tot = totals(rows);
  return `<div class="tbl-wrap"><table><thead><tr><th>Processo</th><th>Canal</th><th>Status</th><th>BL / DUIMP</th><th>Navio</th><th class="n">Cont.</th><th class="n">Estadia máx.</th>
    <th class="n">Regular</th><th class="n">Extra armaz.</th><th class="n">Extra desemb.</th><th class="n">Total</th><th class="n">% extra</th></tr></thead><tbody>
  ${rows.map(({ id, P, A, R }) => `<tr class="click" onclick="location.hash='#p/${key(id)}'">
    <td><b>${esc(id)}</b></td><td>${chBadge(R?.channel)}</td><td>${stBadge(R)}</td>
    <td class="small">${esc(P?.bl || "—")}<br><span class="muted">${esc(P?.duimp || "")}</span></td><td class="small">${esc(P?.vessel || "—")}</td>
    <td class="n">${A?.n ?? R?.containers ?? "—"}</td><td class="n">${A ? A.maxStay + " d" : R?.daysHeld ? R.daysHeld + " d" : "—"}</td>
    <td class="n">${A ? brl(A.regular) : "—"}</td><td class="n">${A ? brl(A.extra_storage) : "—"}</td><td class="n">${A ? brl(A.extra_customs) : "—"}</td>
    <td class="n"><b>${A ? brl(A.total) : "—"}</b></td><td class="n">${A ? pct(A.extra, A.total) : "—"}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="5">Total (${plural(tot.procs, "processo")})</td><td class="n">${tot.cont}</td><td></td><td class="n">${brl(tot.regular)}</td><td class="n">${brl(tot.extra_storage)}</td><td class="n">${brl(tot.extra_customs)}</td><td class="n">${brl(tot.total)}</td><td class="n">${pct(tot.extra, tot.total)}</td></tr></tfoot></table></div>`;
}

function viewProcessos() {
  const rows = filtered();
  view().innerHTML = `<div class="title-row"><h1>Processos</h1><div class="row"><a class="btn" href="#importar">⬆ Importar planilhas</a><button class="btn" onclick="exportCsv()">⬇ Exportar CSV</button></div></div>
  ${filterBar()}<div class="panel">${procTable(rows)}</div>`;
  bindFilters();
}

/* ------------------------------------------------------------------ PROCESSO */
function viewProcesso(id) {
  const P = Data.db.processes[id], R = Data.db.red[id] || null;
  if (!P && !R) { view().innerHTML = `<h1>Processo não encontrado</h1><p><a href="#processos">← voltar</a></p>`; return; }
  const A = P ? Data.analysis(id) : null;
  const free = Data.freeDays();

  // breakdown por tipo
  const agg = (group) => {
    const m = {};
    for (const l of A.lines.filter((x) => (group === "regular" ? x.group === "regular" : x.group !== "regular"))) {
      const k = (m[l.key] ??= { key: l.key, group: l.group, value: 0, conts: new Set(), qty: 0, unit: new Set() });
      k.value += l.value; k.conts.add(l.container); k.qty += l.qty || 1; k.unit.add((l.unit ?? l.value).toFixed(2));
    }
    return Object.values(m).sort((a, b) => b.value - a.value);
  };
  const brkTable = (items, sum, isExtra) => items.length ? `<table><thead><tr><th>Item</th>${isExtra ? "<th>KPI</th>" : ""}<th class="n">Contêineres</th><th class="n">Qtd.</th><th class="n">Valor unit.</th><th class="n">Total</th><th class="n">%</th></tr></thead><tbody>
    ${items.map((i) => `<tr><td>${gKey(i.group)} ${esc(i.key)}</td>${isExtra ? `<td><span class="kpi-tag">${esc(GROUPS[i.group].kpi)}</span></td>` : ""}<td class="n">${i.conts.size}</td><td class="n">${i.qty}${i.group === "extra_storage" ? " dias" : ""}</td>
      <td class="n">${i.unit.size === 1 ? brl(+[...i.unit][0]) : "variável"}</td><td class="n">${brl(i.value)}</td><td class="n">${pct(i.value, sum)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="${isExtra ? 5 : 4}">Total</td><td class="n">${brl(sum)}</td><td></td></tr></tfoot></table>` : `<p class="okbox">Nenhum custo extra neste processo.</p>`;

  view().innerHTML = `
  <p class="small"><a href="#processos">← Processos</a></p>
  <div class="title-row"><h1>${esc(id)} ${R ? chBadge(R.channel) : ""} ${stBadge(R)}</h1>
    <div class="row"><button class="btn" onclick="editRed('${esc(id)}')">✎ Desembaraço / motivo</button>${P ? `<button class="btn danger" onclick="delProcess('${esc(id)}')">Excluir demonstrativo</button>` : ""}</div></div>
  ${P ? `<p class="muted small">BL <b>${esc(P.bl)}</b> · ${esc(P.duimp)} · Navio ${esc(P.vessel)} ${esc(P.voyage)} · Origem ${esc(P.origin)} · CIF US$ ${(P.cifUsd ?? 0).toLocaleString("pt-BR")} · NF-e ${esc(P.nfe)} · RPS ${esc(P.rps)} · Despachante ${esc(P.broker)}<br>
    Demonstrativo Santos Brasil emitido em ${esc(P.issuedAt || "—")} · período ${fmtD(P.periodFrom)} a ${fmtD(P.periodTo)} · arquivo <i>${esc(P.file)}</i></p>` : `<div class="warnbox">Este processo está só no controle de canal: importe o demonstrativo da Santos Brasil (${esc(id)}) para ver os custos.</div>`}
  ${P?.warnings?.length ? P.warnings.map((w) => `<div class="warnbox">⚠ ${esc(w)}</div>`).join("") : P ? `<div class="okbox small">✓ Valores conferidos: a soma dos serviços bate com os totais informados pelo terminal (${brl(P.grandTotal)}).</div>` : ""}
  ${A ? `<div class="tiles">
    <div class="tile hero"><div class="k">Custo total</div><div class="v">${brl(A.total)}</div><div class="s">${brl(A.total / A.n)} por contêiner</div></div>
    <div class="tile"><div class="k">${gKey("regular")}Regular</div><div class="v">${brl(A.regular)}</div><div class="s">${pct(A.regular, A.total)}</div></div>
    <div class="tile"><div class="k">${gKey("extra_storage")}Extra armazenagem</div><div class="v">${brl(A.extra_storage)}</div><div class="s">KPI 1 · ${A.containers.reduce((a, c) => a + c.extraDays, 0)} contêiner-dias</div></div>
    <div class="tile"><div class="k">${gKey("extra_customs")}Extra desembaraço</div><div class="v">${brl(A.extra_customs)}</div><div class="s">KPI 3 · ${A.physical} com inspeção física</div></div>
    <div class="tile"><div class="k">Contêineres</div><div class="v">${A.n}</div><div class="s">${A.over} além de ${free} dias</div></div>
    <div class="tile"><div class="k">Estadia</div><div class="v">${A.maxStay} dias</div><div class="s">${fmtD(A.firstEntry)} → ${fmtD(A.lastExit)}</div></div>
  </div>
  <div class="panel"><h2>Composição do custo</h2>${compBar(A)}</div>` : ""}
  <div class="panel"><div class="title-row"><h2>Desembaraço e motivo da estadia / custos extras</h2><button class="btn sm" onclick="editRed('${esc(id)}')">✎ Editar</button></div>${redPanel(id, R, A)}</div>
  ${A ? `<div class="grid2">
    <div class="panel"><h2>Breakdown dos custos extras</h2>${brkTable(agg("extra"), A.extra, true)}</div>
    <div class="panel"><h2>Custos regulares</h2>${brkTable(agg("regular"), A.regular, false)}</div>
  </div>
  <div class="panel"><h2>Contêineres</h2><p class="muted small">Clique num contêiner para ver os serviços cobrados pelo terminal e as observações (períodos de armazenagem).</p>
  <div class="tbl-wrap"><table><thead><tr><th>Contêiner</th><th>Entrada</th><th>Saída</th><th class="n">Estadia</th><th class="n">Períodos</th><th>Inspeção física</th><th class="n">Regular</th><th class="n">Extra armaz.</th><th class="n">Extra desemb.</th><th class="n">Total</th><th>Conferência</th></tr></thead><tbody>
  ${A.containers.map((c, i) => `<tr class="click" onclick="toggleRow(${i})"><td><b>${esc(c.id)}</b> <span class="muted">▸</span></td><td>${fmtD(c.entry)}</td><td>${fmtD(c.exit)}</td>
    <td class="n">${c.stay ?? "—"} d ${c.overFree ? `<span class="badge b-warn">> ${free}</span>` : ""}</td><td class="n">${c.periods ?? "—"}</td><td>${c.physical ? "Sim" : "—"}</td>
    <td class="n">${brl(c.regular)}</td><td class="n">${brl(c.extra_storage)}${c.extraDays ? `<br><span class="muted small">${c.extraDays} d × ${brl(c.dayRate)}</span>` : ""}</td><td class="n">${brl(c.extra_customs)}</td><td class="n"><b>${brl(c.total)}</b></td>
    <td>${c.reported === null ? "—" : Math.abs(c.reported - c.total) < 0.05 ? `<span class="badge b-ok">✓ ${brl(c.reported)}</span>` : `<span class="badge b-warn">terminal: ${brl(c.reported)}</span>`}</td></tr>
    <tr class="sub hidden" id="sub-${i}"><td colspan="11"><table><thead><tr><th>Serviço (como no terminal)</th><th>Código</th><th>Classificação</th><th class="n">Valor</th><th>Observação do terminal</th></tr></thead><tbody>
      ${c.lines.map((l) => `<tr><td>${esc(l.service.name)}</td><td>${esc(l.service.code)}</td><td>${gKey(l.group)} ${esc(l.label)} ${l.unknown ? `<span class="badge b-warn">sem regra</span>` : ""}</td><td class="n">${brl(l.value)}</td><td><div class="obs">${esc(l.service.obs.split("\n").slice(0, 3).join("\n"))}${l.service.obs.split("\n").length > 3 ? `\n… +${l.service.obs.split("\n").length - 3} períodos de 1 dia` : ""}</div></td></tr>`).join("")}
    </tbody></table></td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="6">Total</td><td class="n">${brl(A.regular)}</td><td class="n">${brl(A.extra_storage)}</td><td class="n">${brl(A.extra_customs)}</td><td class="n">${brl(A.total)}</td><td></td></tr></tfoot></table></div></div>` : ""}
  <div class="panel"><h2>Anotações</h2><textarea id="note" placeholder="Anotações livres sobre o processo (negociação, contestação de cobrança, contato com o terminal…)">${esc(Data.db.notes[id] || "")}</textarea>
    <div class="row" style="margin-top:6px"><button class="btn sm" onclick="saveNote('${esc(id)}')">Salvar anotação</button></div></div>`;
}
function toggleRow(i) { $("#sub-" + i).classList.toggle("hidden"); }
async function saveNote(id) { Data.db.notes[id] = $("#note").value; await Data.save(); toast("Anotação salva"); }
async function delProcess(id) {
  if (!confirm(`Excluir o demonstrativo de ${id}? (O controle de canal e as anotações continuam.)`)) return;
  delete Data.db.processes[id]; Data.log(`Excluído demonstrativo ${id}`); await Data.save(); location.hash = "#processos";
}

function redPanel(id, R, A) {
  if (!R) return `<p class="muted">Sem informações de desembaraço. Use <b>Editar</b> para registrar o canal, as exigências da fiscalização e o motivo da estadia longa ou dos custos extras — ou importe a planilha Red Channel.</p>`;
  const ev = [];
  if (A?.firstEntry) ev.push({ d: A.firstEntry, t: "Entrada no terminal" });
  if (R.assignedAt) ev.push({ d: R.assignedAt, t: `Canal ${R.channel || ""}` });
  (R.rounds || []).forEach((r, i) => { if (r.req) ev.push({ d: r.req, t: `${i + 1}ª exigência${r.note ? " · " + r.note : ""}` }); if (r.sub) ev.push({ d: r.sub, t: `Resposta à ${i + 1}ª exigência` }); });
  if (R.clearedAt) ev.push({ d: R.clearedAt, t: "Desembaraçado" });
  if (A?.lastExit) ev.push({ d: A.lastExit, t: "Saída do terminal" });
  if (R.nextStepDate && R.status !== "Desembaraçado") ev.push({ d: R.nextStepDate, t: "Próximo passo", off: true });
  ev.sort((a, b) => a.d.localeCompare(b.d));
  const dur = R.assignedAt && R.clearedAt ? daysBetween(R.assignedAt, R.clearedAt) : null;
  const f = (k, v) => (v ? `<div><div class="muted small">${k}</div><div>${v}</div></div>` : "");
  return `${ev.length ? `<div class="timeline">${ev.map((e, i) => `<div class="tl">${i < ev.length - 1 ? '<div class="line"></div>' : ""}<div class="dot ${e.off ? "off" : ""}"></div><div class="d">${fmtD(e.d)}</div><div class="t">${esc(e.t)}</div></div>`).join("")}</div>` : ""}
  ${dur !== null ? `<p class="small">Do canal ao desembaraço: <b>${dur} dias</b>${R.rounds?.length ? ` · ${plural(R.rounds.length, "exigência")} da fiscalização` : ""}.</p>` : ""}
  <div class="form" style="margin-top:10px">
    ${f("Motivo da estadia longa / custos extras", R.reason ? `<b>${esc(R.reason)}</b>` : "")}
    ${f("Informação solicitada pela fiscalização", esc(R.infoRequested))}
    ${f("Lote (batch)", esc(R.batch))}
    ${f("Ex-tarifário", esc(R.exTariff))}
    ${f("Documentos / laudos", esc(R.official))}
    ${f("Próximo passo", R.nextStep ? esc(R.nextStep) + (R.nextStepDate ? ` (até ${fmtD(R.nextStepDate)})` : "") : "")}
    ${f("Total de dias no porto (planilha)", R.daysHeld ? R.daysHeld + " dias" : "")}
    ${f("Demurrage estimado", R.demurrage ? "US$ " + (+R.demurrage).toLocaleString("pt-BR") : "")}
    ${R.notes ? `<div class="wide">${f("Observações", esc(R.notes))}</div>` : ""}
  </div>
  <p class="axis-note">Fonte: ${esc(R.source || "registro manual")} · atualizado em ${fmtD((R.updatedAt || "").slice(0, 10))}</p>`;
}

function editRed(id) {
  const R = Data.db.red[id] || { channel: "", status: "Em andamento", rounds: [] };
  const rounds = [...(R.rounds || [])];
  while (rounds.length < 3) rounds.push({ req: "", sub: "", note: "" });
  const isNew = !id;
  openModal(`<h2>${isNew ? "Novo registro de desembaraço" : "Desembaraço · " + esc(id)}</h2>
  <form id="red-form" class="form">
    ${isNew ? `<label class="f">Processo (IRA)<input name="id" placeholder="IRA1818/26" required></label>` : ""}
    <label class="f">Canal<select name="channel">${["", "Verde", "Amarelo", "Vermelho", "Cinza"].map((c) => `<option ${R.channel === c ? "selected" : ""} value="${c}">${c || "—"}</option>`).join("")}</select></label>
    <label class="f">Data do canal<input type="date" name="assignedAt" value="${esc(R.assignedAt || "")}"></label>
    <label class="f">Status<select name="status">${["Em andamento", "Aguardando fiscalização", "Exigência em aberto", "Desembaraçado"].map((c) => `<option ${R.status === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    <label class="f">Data do desembaraço<input type="date" name="clearedAt" value="${esc(R.clearedAt || "")}"></label>
    <label class="f">Lote (batch)<input name="batch" value="${esc(R.batch || "")}"></label>
    <label class="f">Contêineres<input type="number" name="containers" value="${esc(R.containers ?? "")}"></label>
    <label class="f">Total de dias no porto<input type="number" name="daysHeld" value="${esc(R.daysHeld ?? "")}"></label>
    <label class="f">Demurrage estimado (US$)<input type="number" step="0.01" name="demurrage" value="${esc(R.demurrage ?? "")}"></label>
    <label class="f">Ex-tarifário<input name="exTariff" value="${esc(R.exTariff || "")}" placeholder="Sim / Não / itens"></label>
    <div class="wide"><h3>Exigências da fiscalização</h3>
      <table><thead><tr><th>#</th><th>Data da exigência</th><th>Data da resposta</th><th>Observação</th></tr></thead><tbody>
      ${rounds.map((r, i) => `<tr><td>${i + 1}ª</td><td><input type="date" name="req-${i}" value="${esc(r.req || "")}"></td><td><input type="date" name="sub-${i}" value="${esc(r.sub || "")}"></td><td><input name="note-${i}" value="${esc(r.note || "")}" style="width:100%"></td></tr>`).join("")}
      </tbody></table></div>
    <label class="f wide">Motivo da estadia longa / custos extras<textarea name="reason" placeholder="Ex.: canal vermelho com conferência física; exigência de laudo técnico; retificação da DUIMP…">${esc(R.reason || "")}</textarea></label>
    <label class="f wide">Informação solicitada pela fiscalização<textarea name="infoRequested">${esc(R.infoRequested || "")}</textarea></label>
    <label class="f wide">Documentos / laudos (Official)<input name="official" value="${esc(R.official || "")}"></label>
    <label class="f wide">Próximo passo<input name="nextStep" value="${esc(R.nextStep || "")}"></label>
    <label class="f">Data do próximo passo<input type="date" name="nextStepDate" value="${esc(R.nextStepDate || "")}"></label>
    <label class="f wide">Observações<textarea name="notes">${esc(R.notes || "")}</textarea></label>
    <div class="wide row"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" onclick="closeModal()">Cancelar</button>
      ${!isNew && Data.db.red[id] ? `<button class="btn danger" type="button" onclick="delRed('${esc(id)}')">Excluir registro</button>` : ""}</div>
  </form>`);
  $("#red-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const pid = isNew ? procId(fd.id) || fd.id.trim().toUpperCase() : id;
    if (!pid) return toast("Informe o número do processo");
    const rec = { id: pid, source: R.source || "registro manual", rounds: [] };
    for (const k of ["channel", "assignedAt", "status", "clearedAt", "batch", "exTariff", "reason", "infoRequested", "official", "nextStep", "nextStepDate", "notes"]) rec[k] = fd[k] || "";
    for (const k of ["containers", "daysHeld", "demurrage"]) rec[k] = fd[k] === "" ? null : +fd[k];
    for (let i = 0; i < rounds.length; i++) if (fd["req-" + i] || fd["sub-" + i]) rec.rounds.push({ req: fd["req-" + i], sub: fd["sub-" + i], note: fd["note-" + i] });
    Data.db.red[pid] = { ...(Data.db.red[pid] || {}), ...rec, updatedAt: new Date().toISOString() };
    Data.log(`Desembaraço ${pid} atualizado`);
    await Data.save(); closeModal(); toast("Salvo"); route();
  });
}
async function delRed(id) { if (!confirm("Excluir o registro de desembaraço de " + id + "?")) return; delete Data.db.red[id]; await Data.save(); closeModal(); route(); }

/* ------------------------------------------------------------------ CUSTOS EXTRAS */
function viewExtras(sel) {
  const rows = filtered(), t = totals(rows);
  const items = Object.values(t.byKey).sort((a, b) => b.value - a.value);
  const lines = [];
  for (const { id, A, R } of rows) if (A) for (const l of A.lines) if (l.group !== "regular" && (!sel || l.key === sel)) lines.push({ id, R, l });
  const perProc = rows.filter((r) => r.A && r.A.extra > 0.004).sort((a, b) => b.A.extra - a.A.extra);
  view().innerHTML = `<div class="title-row"><h1>Custos extras ${sel ? "· " + esc(sel) : ""}</h1>${sel ? `<a class="btn" href="#extras">← todos os tipos</a>` : ""}</div>
  ${filterBar()}
  <div class="tiles">
    <div class="tile hero"><div class="k">Custos extras</div><div class="v">${brl(t.extra)}</div><div class="s">${pct(t.extra, t.total)} do custo total</div></div>
    <div class="tile"><div class="k">${gKey("extra_storage")}Armazenagem além do período livre</div><div class="v">${brl(t.extra_storage)}</div><div class="s">KPI 1 · Storage</div></div>
    <div class="tile"><div class="k">${gKey("extra_customs")}Inspeção e desembaraço</div><div class="v">${brl(t.extra_customs)}</div><div class="s">KPI 3 · Customs costs</div></div>
  </div>
  <div class="grid2">
  <div class="panel"><h2>Por tipo de custo</h2><p class="muted small">Clique num tipo para ver os contêineres.</p>
    <table><thead><tr><th>Tipo</th><th>KPI</th><th class="n">Processos</th><th class="n">Contêineres</th><th class="n">Total</th><th class="n">% extra</th></tr></thead><tbody>
    ${items.map((i) => { const procs = new Set(rows.filter((r) => r.A?.lines.some((l) => l.key === i.key)).map((r) => r.id)); return `<tr class="click ${sel === i.key ? "sel" : ""}" onclick="location.hash='#extras/${encodeURIComponent(i.key)}'" ${sel === i.key ? 'style="outline:2px solid var(--brand)"' : ""}><td>${gKey(i.group)} ${esc(i.key)}</td><td><span class="kpi-tag">${esc(GROUPS[i.group].kpi)}</span></td><td class="n">${procs.size}</td><td class="n">${i.conts.size}</td><td class="n">${brl(i.value)}</td><td class="n">${pct(i.value, t.extra)}</td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">Nenhum custo extra.</td></tr>`}
    </tbody></table></div>
  <div class="panel"><h2>Por processo e motivo</h2>
    <table><thead><tr><th>Processo</th><th class="n">Armazenagem</th><th class="n">Desembaraço</th><th class="n">Total extra</th><th>Motivo registrado</th></tr></thead><tbody>
    ${perProc.map(({ id, A, R }) => `<tr class="click" onclick="location.hash='#p/${key(id)}'"><td><b>${esc(id)}</b><br>${chBadge(R?.channel)}</td><td class="n">${brl(A.extra_storage)}</td><td class="n">${brl(A.extra_customs)}</td><td class="n"><b>${brl(A.extra)}</b></td>
      <td class="small">${R?.reason ? esc(R.reason) : R?.infoRequested ? esc(R.infoRequested) : `<span class="badge b-warn">sem motivo</span>`}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Nenhum.</td></tr>`}
    </tbody></table></div>
  </div>
  <div class="panel"><h2>Detalhe por contêiner ${sel ? "· " + esc(sel) : ""}</h2><div class="tbl-wrap"><table><thead><tr><th>Processo</th><th>Contêiner</th><th>Item</th><th class="n">Qtd.</th><th class="n">Valor</th><th>Canal</th><th>Status</th></tr></thead><tbody>
  ${lines.sort((a, b) => b.l.value - a.l.value).map(({ id, R, l }) => `<tr class="click" onclick="location.hash='#p/${key(id)}'"><td><b>${esc(id)}</b></td><td>${esc(l.container)}</td><td>${gKey(l.group)} ${esc(l.label)}</td><td class="n">${l.qty ? l.qty + " d" : 1}</td><td class="n">${brl(l.value)}</td><td>${chBadge(R?.channel)}</td><td>${stBadge(R)}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">Nenhum.</td></tr>`}
  </tbody></table></div></div>`;
  bindFilters();
}

/* ------------------------------------------------------------------ CANAL VERMELHO */
function redSummary(rows) {
  const red = rows.filter((r) => r.R?.channel === "Vermelho");
  const free = Data.freeDays();
  const cont = red.reduce((a, r) => a + (r.A?.n || r.R.containers || 0), 0);
  const over = red.reduce((a, r) => a + (r.A ? r.A.over : (r.R.daysHeld || 0) > free ? r.R.containers || 0 : 0), 0);
  const ex = red.filter((r) => /^(S|Y|SIM|YES)/i.test(r.R.exTariff || "")).length;
  return {
    pt: `Há ${plural(red.length, "processo")} no canal vermelho, totalizando ${plural(cont, "contêiner", "contêineres")}. ${over === 1 ? "1 contêiner já excedeu" : over + " contêineres já excederam"} o período livre de armazenagem. Desses processos, ${ex === 1 ? "1 inclui" : ex + " incluem"} peças com benefício de Ex-tarifário.`,
    en: `Summary: There are currently ${red.length} shipments in the red customs channel, totaling ${cont} containers. ${over} containers have already exceeded the free storage period. Of these shipments, ${ex} include parts covered by Ex-tariff benefits.`,
    zh: `总结：目前有${red.length}批货物处于海关红色通道，共涉及${cont}个集装箱。其中，${over}个集装箱已超过免费堆存期。在这些批次中，${ex}批包含适用Ex-tariff关税优惠的零部件。`,
  };
}
function viewCanal() {
  const rows = filtered().filter((r) => r.R);
  const s = redSummary(rows);
  view().innerHTML = `<div class="title-row"><h1>Canal vermelho e desembaraço</h1><div class="row">
    <button class="btn primary" onclick="editRed('')">+ Novo registro</button><a class="btn" href="#importar">⬆ Importar planilha Red Channel</a></div></div>
  ${filterBar()}
  <div class="panel"><h2>Resumo</h2><p>${esc(s.pt)}</p><p class="muted small">${esc(s.en)}<br>${esc(s.zh)}</p>
    <button class="btn sm" onclick="copySummary()">Copiar resumo (EN / 中文)</button></div>
  <div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Processo</th><th>Lote</th><th class="n">Cont.</th><th>Canal</th><th>Data canal</th><th>Exigências</th><th>Status</th><th class="n">Dias</th>
    <th class="n">Armazenagem 1º período</th><th class="n">Período adicional</th><th>Motivo</th><th>Próximo passo</th></tr></thead><tbody>
  ${rows.map(({ id, A, R }) => {
    const days = R.status === "Desembaraçado" ? (R.assignedAt && R.clearedAt ? daysBetween(R.assignedAt, R.clearedAt) : R.daysHeld) : R.assignedAt ? daysBetween(R.assignedAt, today()) : R.daysHeld;
    const late = R.nextStepDate && R.nextStepDate < today() && R.status !== "Desembaraçado";
    return `<tr class="click" onclick="location.hash='#p/${key(id)}'"><td><b>${esc(id)}</b></td><td class="small">${esc(R.batch || "")}</td><td class="n">${A?.n ?? R.containers ?? "—"}</td><td>${chBadge(R.channel)}</td><td>${fmtD(R.assignedAt)}</td>
      <td class="small" style="white-space:nowrap">${(R.rounds || []).map((r, i) => `${i + 1}ª ${fmtD(r.req).slice(0, 5)}${r.sub ? " → " + fmtD(r.sub).slice(0, 5) : " <b>(sem resposta)</b>"}`).join("<br>") || "—"}</td>
      <td>${stBadge(R)}</td><td class="n">${days ?? "—"}</td>
      <td class="n">${A ? brl(A.storageFirst) : R.storageFirst ? brl(R.storageFirst) : "—"}</td><td class="n">${A ? brl(A.extra_storage) : R.storageAdd ? brl(R.storageAdd) : "—"}</td>
      <td class="small">${esc(R.reason || R.infoRequested || "")}</td><td class="small">${esc(R.nextStep || "")}${R.nextStepDate ? `<br><span class="${late ? "badge b-warn" : "muted"}">${late ? "vencido " : ""}${fmtD(R.nextStepDate)}</span>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="12" class="muted">Nenhum registro. Importe a planilha Red Channel ou clique em “Novo registro”.</td></tr>`}
  </tbody></table></div><p class="axis-note">“Armazenagem 1º período” e “Período adicional” vêm do demonstrativo da Santos Brasil quando ele foi importado (senão, da planilha). Dias = do canal ao desembaraço (ou até hoje).</p></div>`;
  bindFilters();
}
function copySummary() { const s = redSummary(filtered().filter((r) => r.R)); navigator.clipboard?.writeText(s.en + "\n" + s.zh).then(() => toast("Resumo copiado"), () => toast("Não foi possível copiar")); }

/* ------------------------------------------------------------------ IMPORTAR */
let pending = [];
function viewImportar() {
  view().innerHTML = `<h1>Importar planilhas</h1>
  <div class="grid2">
    <div class="panel"><h2>Demonstrativos da Santos Brasil</h2><p class="small">Arquivos <b>IRAxxxx-xx_Cost_Breakdown.xlsx</b> (ou o demonstrativo puro do terminal). O sistema lê a aba do demonstrativo,
      separa cada contêiner e serviço, divide a armazenagem em período livre × períodos adicionais e confere os valores com os totais do terminal.</p></div>
    <div class="panel"><h2>Planilha Red Channel</h2><p class="small">A planilha de controle do desembaraço (<i>RED CHANNEL STATUS</i>). Cada processo é localizado pelo número IRA
      e o sistema traz canal, datas das exigências, status, próximos passos e informações pedidas pela fiscalização. Os registros podem ser editados depois.</p></div>
  </div>
  <label class="drop" id="drop"><input type="file" id="files" multiple accept=".xlsx,.xlsm,.csv" hidden>
    <b>Arraste os arquivos aqui</b> ou clique para escolher<br><span class="muted small">Pode mandar vários de uma vez. O tipo de cada planilha é reconhecido sozinho.</span></label>
  <div id="pending"></div>`;
  const drop = $("#drop"), inp = $("#files");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFiles([...e.dataTransfer.files]); });
  inp.addEventListener("change", () => readFiles([...inp.files]));
  renderPending();
}

async function readFiles(files) {
  for (const file of files) {
    const item = { file, name: file.name };
    try {
      const book = await Book.read(file);
      if (SB.pickSheet(book)) { item.kind = "sb"; item.P = SB.parse(book, file.name); }
      else {
        const recs = RC.parse(book);
        if (recs.length) { item.kind = "rc"; item.recs = recs; }
        else throw new Error("Não reconheci a planilha: não há demonstrativo da Santos Brasil nem números de processo IRA.");
      }
    } catch (e) { item.error = e.message || String(e); }
    pending.push(item);
  }
  renderPending();
}

function renderPending() {
  const el = $("#pending"); if (!el) return;
  if (!pending.length) { el.innerHTML = ""; return; }
  const rules = Data.rules(), free = Data.freeDays();
  el.innerHTML = `<div class="panel" style="margin-top:16px"><h2>Conferir antes de salvar</h2>
  <table><thead><tr><th>Arquivo</th><th>Tipo</th><th>Processo</th><th>Conteúdo</th><th>Conferência</th><th></th></tr></thead><tbody>
  ${pending.map((it, i) => {
    if (it.error) return `<tr><td>${esc(it.name)}</td><td colspan="4"><span class="badge b-warn">erro</span> ${esc(it.error)}</td><td><button class="btn sm" onclick="pending.splice(${i},1);renderPending()">remover</button></td></tr>`;
    if (it.kind === "sb") {
      const A = analyze(it.P, rules, free), exists = !!Data.db.processes[it.P.id];
      return `<tr><td>${esc(it.name)}</td><td>Demonstrativo Santos Brasil</td>
        <td><input value="${esc(it.P.id)}" placeholder="IRA0000/26" onchange="pending[${i}].P.id=procId(this.value)||this.value.trim().toUpperCase();renderPending()" style="width:120px">
          ${!it.P.id ? `<br><span class="badge b-warn">informe o número IRA</span>` : exists ? `<br><span class="badge b-warn">já existe: será substituído</span>` : ""}</td>
        <td class="small">BL ${esc(it.P.bl)} · ${plural(A.n, "contêiner", "contêineres")} · total <b>${brl(A.total)}</b><br>regular ${brl(A.regular)} · extra armaz. ${brl(A.extra_storage)} · extra desemb. ${brl(A.extra_customs)}${A.unknown ? `<br><span class="badge b-warn">${A.unknown} serviço(s) sem regra</span>` : ""}</td>
        <td>${it.P.warnings.length ? it.P.warnings.map((w) => `<div class="small" style="color:var(--warn)">⚠ ${esc(w)}</div>`).join("") : `<span class="badge b-ok">✓ bate com o terminal</span>`}</td>
        <td><button class="btn sm" onclick="pending.splice(${i},1);renderPending()">remover</button></td></tr>`;
    }
    return `<tr><td>${esc(it.name)}</td><td>Planilha Red Channel</td><td>${it.recs.length} processos</td>
      <td class="small">${it.recs.map((r) => `<b>${esc(r.id)}</b> ${esc(r.status)}${r.rounds.length ? ` · ${r.rounds.length} exig.` : ""}${Data.db.red[r.id] ? " (atualiza)" : ""}`).join("<br>")}</td>
      <td class="small muted">Campos vazios na planilha não apagam o que já foi registrado no sistema.</td><td><button class="btn sm" onclick="pending.splice(${i},1);renderPending()">remover</button></td></tr>`;
  }).join("")}</tbody></table>
  <div class="row" style="margin-top:12px"><button class="btn primary" onclick="commitPending()">Salvar ${plural(pending.filter((p) => !p.error).length, "arquivo")}</button><button class="btn" onclick="pending=[];renderPending()">Descartar</button></div></div>`;
}

async function commitPending() {
  const ok = pending.filter((p) => !p.error);
  if (ok.some((p) => p.kind === "sb" && !p.P.id)) return toast("Informe o número IRA de todos os demonstrativos");
  let n = 0;
  for (const it of ok) {
    if (it.kind === "sb") { Data.upsertProcess(it.P); n++; }
    else { for (const r of it.recs) Data.upsertRed(r); Data.log(`Importada planilha Red Channel ${it.name} (${it.recs.length} processos)`); n += it.recs.length; }
    if (Data.folder) {
      try { await Data.write(`${it.kind === "sb" ? "SANTOS_BRASIL" : "RED_CHANNEL"}/${today()}_${it.name.replace(/[\\/:*?"<>|]/g, "_")}`, it.file); } catch (e) { console.warn(e); }
    }
  }
  pending = pending.filter((p) => p.error);
  await Data.save();
  toast(`${n} registro(s) salvos`);
  location.hash = "#painel";
}

/* ------------------------------------------------------------------ CONFIG */
function viewConfig() {
  const rules = Data.rules();
  const unknown = new Map();
  for (const P of Object.values(Data.db.processes)) for (const c of P.containers) for (const s of c.services) if (classify(s.name, rules).unknown) unknown.set(s.name, (unknown.get(s.name) || 0) + 1);
  view().innerHTML = `<h1>Configurações</h1>
  <div class="panel"><h2>Regras de classificação dos serviços</h2>
    <p class="small">Cada serviço cobrado pela Santos Brasil é comparado com as regras de cima para baixo (texto sem acentos; use | para alternativas).
    <b>Armazenagem</b> é dividida sozinha: o 1º período (período livre) é custo regular e os períodos adicionais são extra de armazenagem (KPI 1).
    Padrão inicial = mesma lógica da planilha de breakdown manual (escaneamento conta como regular; posicionamento, lacres, ova/desova = extra de desembaraço, KPI 3).</p>
    ${unknown.size ? `<div class="warnbox">Serviços sem regra: ${[...unknown].map(([n, q]) => `<b>${esc(n)}</b> (${q}×)`).join(", ")}</div>` : ""}
    <table><thead><tr><th>Texto no nome do serviço</th><th>Nome no sistema</th><th>Grupo</th><th></th></tr></thead><tbody id="rules">
    ${rules.map((r, i) => `<tr><td><input data-i="${i}" data-k="match" value="${esc(r.match)}" style="width:100%"></td><td><input data-i="${i}" data-k="label" value="${esc(r.label)}" style="width:100%"></td>
      <td><select data-i="${i}" data-k="group">${[["storage", "Armazenagem (divide por período)"], ["regular", "Regular"], ["extra_customs", "Extra · desembaraço (KPI 3)"], ["extra_storage", "Extra · armazenagem (KPI 1)"]].map(([v, l]) => `<option value="${v}" ${r.group === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td class="n"><button class="btn sm" onclick="moveRule(${i},-1)">↑</button> <button class="btn sm" onclick="moveRule(${i},1)">↓</button> <button class="btn sm danger" onclick="delRule(${i})">×</button></td></tr>`).join("")}
    </tbody></table>
    <div class="row" style="margin-top:8px"><button class="btn sm" onclick="addRule()">+ Regra</button><button class="btn sm primary" onclick="saveRules()">Salvar regras</button><button class="btn sm" onclick="resetRules()">Restaurar padrão</button></div></div>
  <div class="grid2">
    <div class="panel"><h2>Parâmetros</h2><div class="form">
      <label class="f">Período livre de armazenagem (dias)<input type="number" id="freeDays" value="${Data.freeDays()}"></label></div>
      <div class="row" style="margin-top:8px"><button class="btn sm primary" onclick="saveParams()">Salvar</button></div>
      <p class="small muted">Usado para marcar contêineres “além do período livre” e a linha de referência do gráfico de estadia. O valor cobrado vem sempre do demonstrativo.</p></div>
    <div class="panel"><h2>Onde ficam os dados</h2>
      <p class="small">Os dados são salvos automaticamente <b>neste navegador</b>. Para ter backup e usar em equipe, escolha uma <b>pasta de trabalho</b> (ex.: pasta do OneDrive/SharePoint): a base vai para <code>custos-aduaneiros.json</code> e as planilhas importadas são arquivadas em <code>SANTOS_BRASIL/</code> e <code>RED_CHANNEL/</code>.</p>
      <p>${Data.folder ? `<span class="store-badge on">Pasta: ${esc(Data.folder.name)}</span>` : `<span class="store-badge">Só neste navegador</span>`}</p>
      <div class="row">${Data.folderSupported() ? `<button class="btn sm" onclick="pickFolder()">${Data.folder ? "Trocar pasta" : "Escolher pasta de trabalho"}</button>` : `<span class="muted small">Pasta de trabalho exige Edge ou Chrome.</span>`}
      ${Data.pendingFolder && !Data.folder ? `<button class="btn sm" onclick="reconnect()">Continuar com a pasta ${esc(Data.pendingFolder.name)}</button>` : ""}</div>
      <h3>Backup</h3><div class="row"><button class="btn sm" onclick="exportJson()">⬇ Baixar backup (.json)</button><label class="btn sm">⬆ Restaurar backup<input type="file" accept=".json" hidden onchange="importJson(this.files[0])"></label>
      <button class="btn sm" onclick="exportCsv()">⬇ Linhas de custo (.csv)</button></div>
      <h3>Dados de exemplo</h3><div class="row">${typeof SEED !== "undefined" ? `<button class="btn sm" onclick="loadSeed()">Carregar os 5 processos de exemplo</button>` : ""}<button class="btn sm danger" onclick="clearAll()">Apagar todos os dados</button></div></div>
  </div>
  <div class="panel"><h2>Histórico</h2><table><tbody>${Data.db.log.slice(0, 30).map((l) => `<tr><td class="small muted" style="width:160px">${esc(l.at.slice(0, 16).replace("T", " "))}</td><td class="small">${esc(l.msg)}</td></tr>`).join("") || `<tr><td class="muted">Sem registros.</td></tr>`}</tbody></table></div>`;
}
function readRules() { const r = Data.rules().map((x) => ({ ...x })); $$("#rules [data-i]").forEach((el) => { r[+el.dataset.i][el.dataset.k] = el.value; }); return r; }
function addRule() { Data.db.rules = [...readRules(), { match: "", label: "", group: "extra_customs" }]; viewConfig(); }
function delRule(i) { const r = readRules(); r.splice(i, 1); Data.db.rules = r; viewConfig(); }
function moveRule(i, d) { const r = readRules(); const j = i + d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; Data.db.rules = r; viewConfig(); }
async function saveRules() { Data.db.rules = readRules().filter((r) => r.match.trim()); Data.log("Regras de classificação alteradas"); await Data.save(); toast("Regras salvas: os custos foram recalculados"); viewConfig(); }
async function resetRules() { if (!confirm("Restaurar as regras padrão?")) return; Data.db.rules = DEFAULT_RULES.map((r) => ({ ...r })); await Data.save(); viewConfig(); }
async function saveParams() { Data.db.settings.freeDays = +$("#freeDays").value || 15; await Data.save(); toast("Salvo"); }
async function pickFolder() { try { await Data.pickFolder(); updateBadge(); toast("Pasta conectada"); route(); } catch (e) { if (e.name !== "AbortError") toast(e.message); } }
async function reconnect() { if (await Data.reconnect()) { updateBadge(); route(); } }
function download(name, data, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportJson() { download(`custos-aduaneiros-backup-${today()}.json`, JSON.stringify(Data.db, null, 1), "application/json"); }
async function importJson(file) {
  if (!file) return;
  try { const db = JSON.parse(await file.text()); if (!db.processes) throw new Error("arquivo inválido"); if (!confirm("Substituir todos os dados atuais pelo backup?")) return; Data.db = Object.assign(Data.empty(), db); await Data.save(); toast("Backup restaurado"); route(); }
  catch (e) { toast("Erro: " + e.message); }
}
function exportCsv() {
  const n2 = (v) => (v ?? 0).toFixed(2).replace(".", ",");
  const out = [["Processo", "BL", "DUIMP", "Navio", "Canal", "Status", "Contêiner", "Entrada", "Saída", "Estadia (dias)", "Serviço (terminal)", "Código", "Item", "Grupo", "KPI", "Qtd", "Valor (R$)"].join(";")];
  for (const { id, P, A, R } of filtered()) if (A) for (const c of A.containers) for (const l of c.lines)
    out.push([id, P.bl, P.duimp, P.vessel, R?.channel || "", R?.status || "", c.id, fmtD(c.entry), fmtD(c.exit), c.stay ?? "", l.service.name, l.service.code, l.label, GROUPS[l.group].short || GROUPS[l.group].label, GROUPS[l.group].kpi, l.qty || 1, n2(l.value)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
  download(`custos-aduaneiros-${today()}.csv`, "﻿" + out.join("\r\n"), "text/csv");
}
async function loadSeed() {
  for (const P of SEED.processes) Data.db.processes[P.id] = P;
  Data.log(`Carregados ${SEED.processes.length} processos de exemplo`); await Data.save(); toast("Exemplos carregados"); location.hash = "#painel"; route();
}
async function clearAll() { if (!confirm("Apagar TODOS os processos, registros de canal e anotações?")) return; const rules = Data.db.rules, settings = Data.db.settings; Data.db = Object.assign(Data.empty(), { rules, settings }); await Data.save(); route(); }

function emptyState() {
  view().innerHTML = `<div class="panel empty"><h1>Custos aduaneiros</h1>
    <p>Comece importando os demonstrativos da Santos Brasil (<b>IRAxxxx-xx_Cost_Breakdown.xlsx</b>) e, se quiser, a planilha <b>Red Channel Status</b>.</p>
    <div class="row" style="justify-content:center"><a class="btn primary" href="#importar">⬆ Importar planilhas</a>${typeof SEED !== "undefined" ? `<button class="btn" onclick="loadSeed()">Ver com os 5 processos de exemplo</button>` : ""}</div></div>`;
}

/* ------------------------------------------------------------------ roteamento */
function updateBadge() {
  const b = $("#store"); if (!b) return;
  b.className = "store-badge" + (Data.folder ? " on" : "");
  b.textContent = Data.folder ? "Pasta: " + Data.folder.name : "Salvo neste navegador";
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1) || "painel");
  const [page, ...rest] = h.split("/");
  const arg = rest.join("/");
  $$("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + (page === "p" ? "processos" : page)));
  if (page === "p") viewProcesso(unkey(arg));
  else if (page === "processos") viewProcessos();
  else if (page === "extras") viewExtras(arg || "");
  else if (page === "canal") viewCanal();
  else if (page === "importar") viewImportar();
  else if (page === "config") viewConfig();
  else viewPainel();
}
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
(async () => { await Data.load(); updateBadge(); route(); })();
