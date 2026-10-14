/* Dashboards (projetos, reuniões, riscos), calendário de reuniões e reuniões obrigatórias.
 *
 * Escolha das formas: números de destaque em cartões (o "de XX projetos, XX…"); barras horizontais de uma cor
 * para contagens por categoria (valor na ponta); barra empilhada com cores de status (sempre com legenda e
 * números, nunca só a cor) para partes de um todo; mapa de calor de um só tom para probabilidade × impacto. */
const STATUS_COLORS = { good: "#2E7D32", warn: "#C98A00", bad: "#C00000", idle: "#B9BCC2" };
const HEAT = ["#f4f4f5", "#fbe1e1", "#f2b0b0", "#e07272", "#c53030", "#990000"];

// ------------------------------------------------------------------ peças de gráfico
function statTile(value, label, sub = "", href = "") {
  const tag = href ? "a" : "div";
  return `<${tag} class="kpi" ${href ? `href="#${href}"` : ""}><b>${value ?? "—"}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</${tag}>`;
}
/** Barras horizontais de uma série (uma cor), valor na ponta. rows: [[rótulo, valor, dica?]] */
function hbars(rows, { color = "var(--brand)", empty = "—", fmtv = (v) => v } = {}) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  if (!rows.length) return `<p class="muted">${empty}</p>`;
  return `<div class="hbars">${rows.map(([label, v, hint]) => `<div class="hb-row" title="${esc(label)}: ${esc(fmtv(v))}${hint ? " — " + esc(hint) : ""}">
    <span class="hb-label">${esc(label)}</span><span class="hb-track"><span class="hb-bar" style="width:${(v / max) * 100}%;background:${v ? color : "transparent"}"></span><span class="hb-val">${esc(fmtv(v))}</span></span></div>`).join("")}</div>`;
}
/** Barra empilhada (partes de um todo) + legenda com valores. segs: [{label, value, color}] */
function stackBar(segs) {
  const total = segs.reduce((a, s) => a + s.value, 0);
  const bar = total ? segs.filter((s) => s.value).map((s) => `<span class="sb-seg" style="flex:${s.value};background:${s.color}" title="${esc(s.label)}: ${s.value} (${Math.round((s.value / total) * 100)}%)"></span>`).join("")
    : `<span class="sb-seg" style="flex:1;background:#eee"></span>`;
  return `<div class="stackbar">${bar}</div><div class="legend">${segs.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)} <b>${s.value}</b>${total ? ` <span class="muted">(${Math.round((s.value / total) * 100)}%)</span>` : ""}</span>`).join("")}</div>`;
}
/** Medidor X de Y. */
function meter(done, total, label) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return `<div class="meter" title="${esc(label)}: ${done}/${total}"><div class="progress-bar"><span style="width:${pct}%;background:${pct >= 100 ? STATUS_COLORS.good : "var(--brand)"}"></span></div><b>${done}/${total}</b></div>`;
}
/** Colunas verticais (distribuição). */
function columns(rows) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="cols">${rows.map(([label, v]) => `<div class="col" title="${esc(label)}: ${v}"><span class="col-val">${v}</span><span class="col-bar" style="height:${(v / max) * 100}%"></span><span class="col-label">${esc(label)}</span></div>`).join("")}</div>`;
}
/** Mapa de calor probabilidade (linhas) × impacto (colunas). */
function heatmap(matrix, rowLabels, colLabels) {
  const max = Math.max(1, ...matrix.flat());
  const step = (v) => (v === 0 ? 0 : Math.max(1, Math.round((v / max) * (HEAT.length - 1))));
  return `<table class="heat"><tr><th>${esc(t("Probabilidade"))} ↓ / ${esc(t("Impacto"))} →</th>${colLabels.map((c) => `<th>${esc(t(c))}</th>`).join("")}</tr>
    ${matrix.map((row, i) => `<tr><th>${esc(t(rowLabels[i]))}</th>${row.map((v, j) => `<td style="background:${HEAT[step(v)]};color:${step(v) >= 4 ? "#fff" : "#1a1a1a"}" title="${esc(t(rowLabels[i]))} × ${esc(t(colLabels[j]))}: ${v}">${v}</td>`).join("")}</tr>`).join("")}</table>`;
}
function insightsBox(kind, extra = {}) {
  const last = S.db.settings.last_insights?.[kind];
  return `<div class="card"><h2>${t("Análise da IA")}</h2>
    ${last ? `<div class="ai-box">${esc(last.text)}</div><p class="muted">${fmt(last.at)}</p>` : `<p class="muted">${t("Peça à IA para interpretar este dashboard: o que exige atenção e a ação recomendada.")}</p>`}
    <div class="actions"><button onclick='busy(this, async()=>{await api("insights","POST",${JSON.stringify({ kind, ...extra })}); await refresh();})'>${t("Analisar com IA")}</button></div></div>`;
}

// ------------------------------------------------------------------ dashboard de projetos
function dashProjectsView() {
  const d = Core.dashProjects();
  const lateOnly = d.rows.filter((r) => r.late > 0 && !r.delayRisk).length;
  const attention = d.rows.filter((r) => r.late > 0 || r.delayRisk);
  return `<div class="hero">${t("De {total} projetos ativos, {late} têm itens atrasados e {risk} representam risco em relação ao atraso.", { total: d.total, late: d.withLate, risk: d.delayRisk })}</div>
  <div class="kpis">${statTile(d.total, t("Projetos ativos"), t("{n} concluídos", { n: d.done }))}${statTile(d.withLate, t("Com itens atrasados"))}${statTile(d.delayRisk, t("Risco de atraso"), "", "")}
    ${statTile(d.onTrack, t("No prazo"))}${statTile(d.avgPct == null ? "—" : d.avgPct + "%", t("Conclusão média"))}${statTile(d.stale, t("Sem atualização recente"))}${statTile(d.main, t("Projetos principais"))}</div>
  <div class="grid">
    <div class="card"><h2>${t("Situação dos projetos")}</h2>${stackBar([
      { label: t("No prazo"), value: d.onTrack, color: STATUS_COLORS.good },
      { label: t("Itens atrasados, sem risco"), value: lateOnly, color: STATUS_COLORS.warn },
      { label: t("Risco de atraso"), value: d.delayRisk, color: STATUS_COLORS.bad }])}
      <p class="muted small">${t("DELAY_RISK_RULE")}</p></div>
    <div class="card"><h2>${t("Itens atrasados por tipo")}</h2>${hbars([[t("Itens do projeto"), d.lateBy.items], [t("Atividades (planilha)"), d.lateBy.acts], [t("Itens adicionais do projeto"), d.lateBy.adds]])}</div>
    <div class="card"><h2>${t("Distribuição da conclusão")}</h2>${columns(d.buckets.map(([l, v]) => [t(l), v]))}</div>
  </div>
  <div class="grid" style="margin-top:var(--gap)">
    <div class="card" style="overflow:auto"><h2>${t("Projetos que exigem atenção")}</h2><table>${th(["ID", "Projeto", "Atrasados", "Atraso mais antigo", "% concluído", "Risco aberto ligado", "Situação"])}
      ${attention.map((r) => `<tr class="click" onclick="location.hash='projetos/${r.id}'"><td>${r.id}</td><td>${r.main ? "★ " : ""}${esc(r.name)}</td><td>${r.late}</td><td>${esc(r.oldest)}</td><td>${bar(r.pct)}</td>
        <td>${r.openRisk ? t("Sim") : t("Não")}</td><td>${r.delayRisk ? pill(t("Risco de atraso"), "p-Alta") : pill(t("Itens atrasados"), "p-Média")}</td></tr>`).join("") || `<tr><td colspan=7 class="muted">${t("Nenhum projeto com atraso.")}</td></tr>`}</table></div>
    ${insightsBox("projects")}
  </div>`;
}

// ------------------------------------------------------------------ dashboard de reuniões
let M_PERIOD = "month";
function dashMeetingsView() {
  const d = Core.dashMeetings(M_PERIOD);
  const pname = { today: "hoje", week: "nesta semana", month: "neste mês" }[M_PERIOD];
  const mand = d.mandatory;
  return `<div class="toolbar">${[["today", "Hoje"], ["week", "Esta semana"], ["month", "Este mês"]].map(([k, l]) => `<button class="small ${k === M_PERIOD ? "" : "ghost"}" onclick="M_PERIOD='${k}';render()">${t(l)}</button>`).join("")}
    <span class="muted">${esc(d.range[0])} – ${esc(d.range[1])}</span></div>
  <div class="hero">${t("MEET_HERO", { held: d.held, period: t(pname), ger: d.heldManagerial, rep: d.heldReport, pre: d.heldPre, urg: d.heldUrgent })}</div>
  <div class="kpis">${statTile(d.held, t("Realizadas"))}${statTile(d.heldManagerial, t("De nível gerencial"))}${statTile(d.heldReport, t("Relacionadas a reporte"))}
    ${statTile(d.heldPre, t("Pré-agendadas"))}${statTile(d.heldUrgent, t("Agendadas com urgência"))}${statTile(d.toConfirm, t("A confirmar"), "", "reunioes/confirmar")}</div>
  <div class="grid">
    <div class="card"><h2>${t("Reuniões gerenciais do período")}</h2>${stackBar([
      { label: t("Realizadas"), value: d.managerial.done, color: STATUS_COLORS.good },
      { label: t("Não realizadas"), value: d.managerial.notDone, color: STATUS_COLORS.bad },
      { label: t("Aguardando confirmação"), value: d.managerial.pending, color: STATUS_COLORS.warn },
      { label: t("Futuras"), value: d.managerial.upcoming, color: STATUS_COLORS.idle }])}</div>
    <div class="card"><h2>${t("Realizadas por nível")}</h2>${hbars(d.byLevel.map(([l, v]) => [t(l), v]))}</div>
    <div class="card"><h2>${t("Realizadas por tipo")}</h2>${hbars(d.byType.map(([l, v]) => [t(l), v]))}</div>
  </div>
  <div class="grid" style="margin-top:var(--gap)">
    <div class="card"><h2>${t("Reuniões obrigatórias — mês atual")}</h2>
      ${mand.length ? `<table>${th(["Reunião", "Realizadas / exigidas", "Agendadas", "Não realizadas"])}${mand.map((m) => `<tr><td>${esc(m.title)}</td><td>${meter(m.held, m.required, m.title)}</td><td>${m.scheduled}</td><td>${m.missed ? pill(m.missed, "p-Alta") : 0}</td></tr>`).join("")}</table>`
        : `<p class="muted">${t("Nenhuma reunião obrigatória cadastrada.")} <a href="#reunioes/obrigatorias">${t("Cadastrar")}</a></p>`}</div>
    ${insightsBox("meetings", { period: M_PERIOD })}
  </div>`;
}

// ------------------------------------------------------------------ dashboard de riscos
function dashRisksView() {
  const d = Core.dashRisks();
  return `<div class="hero">${t("RISK_HERO", { total: d.total, crit: d.critical, inv: d.investigate, stale: d.stale })}</div>
  <div class="kpis">${statTile(d.total, t("Riscos abertos"), t("{n} fechados", { n: d.closed }))}${statTile(d.critical, t("Críticos (prob. alta × impacto alto)"))}${statTile(d.investigate, t("Em investigação"))}
    ${statTile(d.monitor, t("Em monitoramento"))}${statTile(d.stale, t("Sem atualização recente"))}${statTile(d.inputs30, t("Inputs nos últimos 30 dias"))}${statTile(d.withProjects, t("Ligados a projetos"))}</div>
  <div class="grid">
    <div class="card"><h2>${t("Matriz probabilidade × impacto")}</h2>${heatmap(d.matrix, ["Alta", "Média", "Baixa"], ["Alto", "Médio", "Baixo"])}<p class="muted small">${t("Número de riscos abertos em cada combinação; quanto mais escuro, mais riscos.")}</p></div>
    <div class="card"><h2>${t("Riscos abertos por impacto principal")}</h2>${hbars(d.byImpact.map(([l, v]) => [t(l), v]))}</div>
    ${insightsBox("risks")}
  </div>`;
}

// ------------------------------------------------------------------ calendário de reuniões
let CAL_MONTH = null;
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
function calendarView() {
  CAL_MONTH ||= S.today.slice(0, 7);
  const days = Core.monthDays(CAL_MONTH), lead = (Core.weekday(days[0]) + 6) % 7;
  const evs = S.db.meetings.filter((m) => (m.date || "").startsWith(CAL_MONTH)).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  const sugs = (S.db.meeting_suggestions || []).filter((x) => x.date.startsWith(CAL_MONTH));
  const [y, m] = CAL_MONTH.split("-").map(Number);
  const ml = new Date(y, m - 1, 1).toLocaleDateString(I18N.htmlLang(), { month: "long", year: "numeric" });
  const monthLabel = ml.charAt(0).toUpperCase() + ml.slice(1);
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const cell = (date) => {
    const de = evs.filter((e) => e.date === date), ds = sugs.filter((x) => x.date === date);
    return `<div class="cal-day ${date === S.today ? "today" : ""} ${[0, 6].includes(Core.weekday(date)) ? "weekend" : ""}" onclick="if(event.target===this||event.target.classList.contains('cal-num'))quickMeeting('${date}')">
      <span class="cal-num">${+date.slice(8)}</span>
      ${de.map((e) => `<a class="cal-ev st-${e.status.replace(/\W/g, "")}" href="#reunioes/${e.id}" title="${esc(titleOf(e))} · ${esc(t(e.status))}">${esc(e.time || "")} ${esc(titleOf(e))}</a>`).join("")}
      ${ds.map((x) => `<span class="cal-ev sug" title="${esc(t(x.reason))}"><span class="sug-t">${esc(x.time)} ${esc(x.title)}</span>
        <button class="mini" title="${esc(t("Aceitar"))}" onclick="event.stopPropagation();busy(this, ()=>acceptSuggestions(['${x.id}']))">✓</button><button class="mini" title="${esc(t("Descartar"))}" onclick="event.stopPropagation();busy(this, ()=>discardSuggestion('${x.id}'))">×</button></span>`).join("")}
    </div>`;
  };
  return `<div class="toolbar"><button class="small ghost" onclick="CAL_MONTH='${shift(-1)}';render()">←</button><b class="cal-title">${esc(monthLabel)}</b>
      <button class="small ghost" onclick="CAL_MONTH='${shift(1)}';render()">→</button><button class="small ghost" onclick="CAL_MONTH=null;render()">${t("Hoje")}</button>
      <button class="small" onclick="busy(this, ()=>suggestMonth(CAL_MONTH))">${t("Sugerir datas das obrigatórias (IA)")}</button>
      ${sugs.length ? `<button class="small ghost" onclick="busy(this, ()=>acceptSuggestions(${JSON.stringify(sugs.map((x) => x.id)).replace(/"/g, "'")}))">${t("Aceitar todas as sugestões")} (${sugs.length})</button>` : ""}</div>
  <p class="muted">${t("Clique em um dia para inserir uma reunião. Sugestões da IA aparecem tracejadas: ✓ aceita, × descarta.")}</p>
  <div class="cal">${WEEKDAYS.map((w) => `<div class="cal-head">${t(w)}</div>`).join("")}${"<div class='cal-day empty'></div>".repeat(lead)}${days.map(cell).join("")}</div>
  <div class="legend">${["Agendada", "Pendente", "Solicitada", "Realizada", "Não realizada"].map((s) => `<span><i class="st-${s.replace(/\W/g, "")}"></i>${esc(t(s))}</span>`).join("")}<span><i class="sug"></i>${t("Sugestão")}</span></div>`;
}
/** Campos comuns das reuniões: nível, tipo, agendamento, duração e participantes cadastrados (gerentes, sr managers, diretor…). */
function meetingFields(pre = {}) {
  return `<div class="row"><div>${L("Nível")}<select id="mq-level">${opts(LIST("meeting_levels"), pre.level || "Gerencial")}</select></div>
    <div>${L("Tipo")}<select id="mq-type">${opts(LIST("meeting_types"), pre.mtype || "Reporte")}</select></div>
    <div>${L("Agendamento")}<select id="mq-sched">${opts(["Pré-agendada", "Urgente"], pre.scheduling || "Pré-agendada")}</select></div>
    <div>${L("Duração (min)")}<input type="number" min="5" step="5" id="mq-dur" value="${esc(pre.duration || 60)}"></div></div>
  ${L("Participantes cadastrados")}${attendeesPicker(pre.attendees || [], "mq-")}`;
}
function attendeesPicker(selected, prefix) {
  const people = S.db.settings.people || [];
  if (!people.length) return `<p class="muted small">${t("Nenhuma pessoa cadastrada.")} <a href="#reunioes/tempo">${t("Cadastrar pessoas (gerentes, sr managers, diretor)")}</a></p>`;
  const roles = [...new Set(people.map((p) => p.role || "Outro"))];
  return `<div class="att-picker">${roles.map((r) => `<div class="att-group"><b>${esc(t(r))}</b>${people.filter((p) => (p.role || "Outro") === r).map((p) =>
    `<label><input type="checkbox" class="${prefix}att" value="${esc(p.name)}" ${selected.includes(p.name) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div>`).join("")}</div>`;
}
const readAttendees = (prefix) => [...document.querySelectorAll(`.${prefix}att`)].filter((c) => c.checked).map((c) => c.value);
const readMeetingFields = (prefix = "mq-") => ({ level: $(`#${prefix}level`).value, mtype: $(`#${prefix}type`).value, scheduling: $(`#${prefix}sched`).value,
  duration: Math.max(5, +$(`#${prefix}dur`).value || 60), attendees: readAttendees(prefix) });
function quickMeeting(date) {
  openModal(`<h2>${t("Nova reunião em {date}", { date })}</h2>
    <div class="row"><div>${L("Título")}<input id="mq-title"></div><div>${L("Horário")}<input type="time" id="mq-time" value="${esc(S.db.settings.work_hours.start)}"></div></div>
    ${meetingFields()}
    <div class="row"><div>${L("Reunião obrigatória")}<select id="mq-mand"><option value="">—</option>${S.db.mandatory.map((m) => `<option value="${m.id}">${esc(m.title)}</option>`).join("")}</select></div>
      <div>${L("Projeto")}<select id="mq-proj"><option value="">—</option>${S.db.projects.map((p) => `<option value="${p.id}">${p.id} · ${esc(p.name)}</option>`).join("")}</select></div>
      <div>${L("Participantes")}<input id="mq-part"></div></div>
    ${L("Pauta / objetivo")}<textarea id="mq-agenda" style="min-height:60px"></textarea>
    <div class="actions"><button onclick="busy(this, ()=>saveQuickMeeting('${date}'))">${t("Salvar")}</button><button class="ghost" onclick="closeModal()">${t("Cancelar")}</button></div>`);
  $("#mq-mand").onchange = () => { const m = S.db.mandatory.find((x) => x.id === $("#mq-mand").value); if (m) { $("#mq-title").value ||= m.title; $("#mq-level").value = m.level || "Gerencial"; $("#mq-type").value = m.mtype || "Reporte"; if (m.preferred_time) $("#mq-time").value = m.preferred_time;
    $("#mq-dur").value = m.duration || 60; document.querySelectorAll(".mq-att").forEach((c) => { c.checked = (m.attendees || []).includes(c.value); }); } };
}
async function saveQuickMeeting(date) {
  const title = $("#mq-title").value.trim();
  if (!title) throw new Error(t("Informe o título."));
  await api("meetings", "POST", { title, date, time: $("#mq-time").value, ...readMeetingFields(), mandatory_id: $("#mq-mand").value,
    project_id: $("#mq-proj").value, participants: $("#mq-part").value, agenda: $("#mq-agenda").value, status: date < S.today ? "Pendente" : "Agendada" });
  closeModal(); toast(t("Reunião agendada")); await refresh();
}
async function suggestMonth(month) {
  if (!S.db.mandatory.some((m) => m.active !== false)) throw new Error(t("Cadastre primeiro as reuniões obrigatórias."));
  const r = await api("meeting_suggest", "POST", { month });
  toast(r.engine === "heuristica" ? t("Sugestões calculadas pela frequência (IA offline).") : t("Sugestões da IA prontas: confira no calendário."));
  await refresh();
}
async function acceptSuggestions(ids) { const r = await api("meeting_suggest_accept", "POST", { ids }); toast(t("{n} reuniões agendadas", { n: r.created.length })); await refresh(); }
async function discardSuggestion(id) { await api("meeting_suggest_accept", "POST", { ids: [], discard: [id] }); await refresh(); }

// ------------------------------------------------------------------ reuniões obrigatórias
let MAND_EDIT = null;
function mandatoryView() {
  const month = S.today.slice(0, 7), st = Object.fromEntries(Core.mandatoryStatus(month).map((x) => [x.id, x]));
  const e = MAND_EDIT ? S.db.mandatory.find((x) => x.id === MAND_EDIT) || {} : {};
  const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const sugs = (S.db.meeting_suggestions || []).filter((x) => x.date.startsWith(month));
  return `<div class="card" style="overflow:auto;margin-bottom:var(--gap)"><h2>${t("Reuniões obrigatórias")}</h2>
    <p class="muted">${t("Reuniões que, pelos requisitos da empresa, precisam acontecer. A IA sugere datas e horários do mês respeitando a frequência e as suas regras.")}</p>
    <table>${th(["ID", "Reunião", "Frequência", "Dias preferidos", "Horário", "Duração", "Nível", "Mês atual", "Ativa", ""])}
    ${S.db.mandatory.map((m) => `<tr><td>${m.id}</td><td>${esc(lc(m, "title"))}</td><td>${esc(t(m.frequency))}${m.frequency === "Personalizada" ? ` (${m.times_per_month}×)` : ""}</td>
      <td>${(m.preferred_days || []).map((d) => t(dayNames[d])).join(", ") || "—"}</td><td>${esc(m.preferred_time || "—")}</td><td>${esc(m.duration || 60)} min</td><td>${esc(tv(m.level))}</td>
      <td>${st[m.id] ? meter(st[m.id].held, st[m.id].required, m.title) : ""}</td><td>${m.active === false ? t("Não") : t("Sim")}</td>
      <td class="nowrap"><button class="small ghost" onclick="MAND_EDIT='${m.id}';render()">${t("Editar")}</button><button class="small ghost danger" onclick="if(confirm(t('Excluir este registro?')))api('mandatory/${m.id}','DELETE').then(refresh)">×</button></td></tr>`).join("")
      || `<tr><td colspan=10 class="muted">${t("Nenhuma reunião obrigatória cadastrada.")}</td></tr>`}</table></div>
  <div class="grid">
  <div class="card"><h2>${t(MAND_EDIT ? "Editar reunião obrigatória" : "Nova reunião obrigatória")}</h2>
    ${L("Título")}<input id="mo-title" value="${esc(e.title)}">
    <div class="row"><div>${L("Frequência")}<select id="mo-freq">${opts(FREQUENCIES, e.frequency || "Mensal")}</select></div><div>${L("Vezes por mês (personalizada)")}<input type="number" id="mo-times" min="1" value="${esc(e.times_per_month || 1)}"></div>
      <div>${L("Horário preferido")}<input type="time" id="mo-time" value="${esc(e.preferred_time || "")}"></div><div>${L("Duração (min)")}<input type="number" id="mo-dur" value="${esc(e.duration || 60)}"></div></div>
    ${L("Dias preferidos")}<div class="checks inline">${[1, 2, 3, 4, 5].map((d) => `<label><input type="checkbox" class="mo-day" value="${d}" ${(e.preferred_days || []).map(Number).includes(d) ? "checked" : ""}> ${t(dayNames[d])}</label>`).join("")}</div>
    <div class="row"><div>${L("Nível")}<select id="mo-level">${opts(LIST("meeting_levels"), e.level || "Gerencial")}</select></div><div>${L("Tipo")}<select id="mo-type">${opts(LIST("meeting_types"), e.mtype || "Reporte")}</select></div>
      <div>${L("Participantes")}<input id="mo-part" value="${esc(e.participants)}"></div></div>
    ${L("Participantes cadastrados")}${attendeesPicker(e.attendees || [], "mo-")}
    ${L("Requisito / observações")}<textarea id="mo-notes" style="min-height:50px">${esc(e.notes)}</textarea>
    <div class="checks"><label><input type="checkbox" id="mo-active" ${e.active === false ? "" : "checked"}> ${t("Ativa")}</label></div>
    <div class="actions"><button onclick="busy(this, saveMandatory)">${t("Salvar")}</button>${MAND_EDIT ? `<button class="ghost" onclick="MAND_EDIT=null;render()">${t("Cancelar")}</button>` : ""}</div></div>
  <div class="card"><h2>${t("Regras para a IA sugerir horários")}</h2>
    <p class="muted">${t("Escreva observações e regras: dias e horários a evitar, disponibilidade da diretoria, feriados, intervalo entre reuniões…")}</p>
    <div class="row"><div>${L("Início do expediente")}<input type="time" id="mr-start" value="${esc(S.db.settings.work_hours.start)}"></div><div>${L("Fim do expediente")}<input type="time" id="mr-end" value="${esc(S.db.settings.work_hours.end)}"></div></div>
    ${L("Regras e observações")}<textarea id="mr-rules" style="min-height:140px" placeholder="${esc(t("MEETING_RULES_PLACEHOLDER"))}">${esc(S.db.settings.meeting_rules)}</textarea>
    <div class="actions"><button class="ghost" onclick="busy(this, saveMeetingRules)">${t("Salvar regras")}</button>
      <button onclick="busy(this, async()=>{await saveMeetingRules(); await suggestMonth('${month}');})">${t("Sugerir datas do mês atual (IA)")}</button></div>
    ${sugs.length ? `<h3>${t("Sugestões para o mês")}</h3><table>${th(["Reunião", "Data", "Horário", "Motivo", ""])}${sugs.map((x) => `<tr><td>${esc(x.title)}</td><td>${esc(x.date)} (${t(dayNames[Core.weekday(x.date)])})</td><td>${esc(x.time)}</td><td class="muted">${esc(t(x.reason))}</td>
      <td class="nowrap"><button class="small" onclick="busy(this, ()=>acceptSuggestions(['${x.id}']))">✓</button><button class="small ghost danger" onclick="busy(this, ()=>discardSuggestion('${x.id}'))">×</button></td></tr>`).join("")}</table>
      <div class="actions"><button onclick="busy(this, ()=>acceptSuggestions(${JSON.stringify(sugs.map((x) => x.id)).replace(/"/g, "'")}))">${t("Aceitar todas as sugestões")}</button><a class="btn ghost" href="#reunioes/calendario">${t("Ver no calendário")}</a></div>` : ""}
  </div></div>`;
}
async function saveMandatory() {
  const title = $("#mo-title").value.trim();
  if (!title) throw new Error(t("Informe o título."));
  const data = { title, frequency: $("#mo-freq").value, times_per_month: +$("#mo-times").value || 1, preferred_time: $("#mo-time").value, duration: +$("#mo-dur").value || 60,
    preferred_days: [...document.querySelectorAll(".mo-day")].filter((c) => c.checked).map((c) => +c.value), level: $("#mo-level").value, mtype: $("#mo-type").value,
    participants: $("#mo-part").value, attendees: readAttendees("mo-"), notes: $("#mo-notes").value, active: $("#mo-active").checked };
  if (MAND_EDIT) await api(`mandatory/${MAND_EDIT}`, "PATCH", data); else await api("mandatory", "POST", data);
  MAND_EDIT = null; toast(t("Salvo")); await refresh();
}
async function saveMeetingRules() {
  await api("settings", "PATCH", { meeting_rules: $("#mr-rules").value, work_hours: { start: $("#mr-start").value || "08:00", end: $("#mr-end").value || "18:00" } });
  S.db.settings.meeting_rules = $("#mr-rules").value;
  toast(t("Regras salvas"));
}

// ------------------------------------------------------------------ ensinar a IA: análise de risco
function teachBox(col, rec) {
  const a = rec.risk_analysis || {};
  const factors = LIST("impact_types");
  return `<div class="card teach"><h2>${t("Minha análise de risco (ensinar a IA)")}</h2>
    <p class="muted">${t("TEACH_RISK_HELP")}</p>
    <div class="row"><div>${L("Nível de risco na sua avaliação")}<select id="tc-level">${opts(LEVELS, a.level || "Média")}</select></div></div>
    ${L("Fatores que pesaram")}<div class="checks inline">${factors.map((x) => `<label><input type="checkbox" class="tc-f" value="${esc(x)}" ${(a.factors || []).includes(x) ? "checked" : ""}> ${esc(t(x))}</label>`).join("")}</div>
    ${L("Sua análise")}<textarea id="tc-text" style="min-height:90px" placeholder="${esc(t("TEACH_RISK_PLACEHOLDER"))}">${esc(a.analysis)}</textarea>
    <div class="actions"><button onclick="busy(this, ()=>saveTeach('${col}','${rec.id}'))">${t("Salvar análise e ensinar a IA")}</button>
      ${a.date ? `<span class="muted">${t("Última análise")}: ${fmt(a.date)}</span>` : ""}</div></div>`;
}
async function saveTeach(col, id) {
  const analysis = $("#tc-text").value.trim();
  if (!analysis) throw new Error(t("Escreva a sua análise."));
  await api(`${col}/${id}/teach`, "POST", { analysis, level: $("#tc-level").value, factors: [...document.querySelectorAll(".tc-f")].filter((c) => c.checked).map((c) => c.value) });
  toast(t("Análise salva: a IA vai usar o seu raciocínio nas próximas avaliações."));
  if (col === "items") { closeModal(); location.hash = "lista"; }
  await refresh();
}

// ------------------------------------------------------------------ tempo em reuniões (gerentes, sr managers, diretor)
let TM = { period: "month", from: "", to: "", role: "", person: "" };
function timeView() {
  const people = S.db.settings.people || [];
  const roles = LIST("people_roles");
  let range = TM.period === "custom" ? [TM.from || S.today, TM.to || S.today] : Core.periodRange(TM.period);
  const d = Core.dashTime({ from: range[0], to: range[1], role: TM.role, person: TM.person });
  const h = (min) => (min / 60).toLocaleString(I18N.htmlLang(), { maximumFractionDigits: 1 }) + " h";
  const directorRole = roles.find((r) => AI.norm(r).startsWith("diretor")) || "Diretor";
  const sameRole = TM.role ? people.filter((p) => p.role === TM.role) : [];
  const who = TM.person || (sameRole.length === 1 ? `${sameRole[0].name} (${t(TM.role)})` : TM.role ? t(TM.role) : t("todas as pessoas cadastradas"));
  return `<div class="toolbar">${[["week", "Esta semana"], ["month", "Este mês"], ["custom", "Período"]].map(([k, l]) => `<button class="small ${TM.period === k ? "" : "ghost"}" onclick="TM.period='${k}';render()">${t(l)}</button>`).join("")}
      ${TM.period === "custom" ? `<input type="date" value="${esc(TM.from)}" onchange="TM.from=this.value;render()"> – <input type="date" value="${esc(TM.to)}" onchange="TM.to=this.value;render()">` : `<span class="muted">${esc(range[0])} – ${esc(range[1])}</span>`}</div>
    <div class="toolbar"><span class="muted">${t("Cargo")}:</span>
      <button class="small ${!TM.role && !TM.person ? "" : "ghost"}" onclick="TM.role='';TM.person='';render()">${t("Todos")}</button>
      ${roles.map((r) => `<button class="small ${TM.role === r && !TM.person ? "" : "ghost"}" onclick="TM.role='${esc(r)}';TM.person='';render()">${esc(t(r))}</button>`).join("")}
      <button class="small director-btn ${TM.role === directorRole && !TM.person ? "on" : ""}" onclick="TM.role='${esc(directorRole)}';TM.person='';render()">★ ${t("Só o diretor")}</button>
      <select onchange="TM.person=this.value;render()"><option value="">${t("Pessoa")}…</option>${people.map((p) => `<option value="${esc(p.name)}" ${TM.person === p.name ? "selected" : ""}>${esc(p.name)} (${esc(t(p.role || "Outro"))})</option>`).join("")}</select></div>
    <div class="hero">${t("TIME_HERO", { who, hours: h(d.totalMin), n: d.meetings.length, pct: d.pctWork })}</div>
    <div class="kpis">${statTile(h(d.totalMin), t("Horas em reunião"))}${statTile(d.meetings.length, t("Reuniões realizadas"))}${statTile(d.meetings.length ? Math.round(d.totalMin / d.meetings.length) + " min" : "—", t("Duração média"))}
      ${statTile(d.pctWork + "%", t("Do expediente"), t("{h} h úteis no período", { h: d.workHours }))}${statTile(h(d.urgentMin), t("Em reuniões urgentes"))}${statTile(d.noDuration, t("Sem duração informada"), t("contadas como 60 min"))}</div>
    <div class="grid">
      <div class="card"><h2>${t("Horas por pessoa")}</h2>${hbars(d.byPerson.map(([n, m]) => [n, m]), { empty: t("Nenhuma reunião com participantes cadastrados no período."), fmtv: h })}</div>
      <div class="card"><h2>${t("Horas por cargo")}</h2>${hbars(d.byRole.map(([n, m]) => [t(n), m]), { fmtv: h })}</div>
      <div class="card"><h2>${t("Horas por tipo de reunião")}</h2>${hbars(d.byType.map(([n, m]) => [t(n), m]), { fmtv: h })}</div>
    </div>
    <div class="grid" style="margin-top:var(--gap)">
      <div class="card" style="overflow:auto"><h2>${t("Reuniões do período")}</h2><table>${th(["ID", "Reunião", "Data", "Duração", "Tipo", "Participantes"])}
        ${d.meetings.map((m) => `<tr class="click" onclick="location.hash='reunioes/${m.id}'"><td>${m.id}</td><td>${esc(titleOf(m))}</td><td>${esc(m.date)} ${esc(m.time || "")}</td>
          <td>${m.duration ? m.duration + " min" : `<span class="muted">60 min*</span>`}</td><td>${esc(tv(m.mtype))}</td><td>${(m.attendees || []).map((x) => pill(x)).join("")}</td></tr>`).join("") || `<tr><td colspan=6 class="muted">—</td></tr>`}</table></div>
      ${peopleCard()}
    </div>`;
}
function peopleCard() {
  const people = S.db.settings.people || [];
  return `<div class="card"><h2>${t("Pessoas (participantes)")}</h2>
    <p class="muted">${t("Cadastre gerentes, sr managers e o diretor para marcar quem participou de cada reunião e medir o tempo gasto.")}</p>
    <table>${th(["Nome", "Cargo", "Departamento", ""])}${people.map((p, k) => `<tr><td>${esc(p.name)}</td><td>${esc(t(p.role || "Outro"))}</td><td>${esc(p.dept)}</td>
      <td><button class="small ghost danger" onclick="busy(this, ()=>removePerson(${k}))">×</button></td></tr>`).join("") || `<tr><td colspan=4 class="muted">${t("Nenhuma pessoa cadastrada.")}</td></tr>`}</table>
    <div class="row"><div>${L("Nome")}<input id="pp-name"></div><div>${L("Cargo")}<select id="pp-role">${opts(LIST("people_roles"), "Gerente")}</select></div><div>${L("Departamento")}<input id="pp-dept" list="pp-depts"></div></div>
    <datalist id="pp-depts">${(S.db.settings.areas || []).map((a) => `<option>${esc(a)}</option>`).join("")}</datalist>
    <div class="actions"><button class="small" onclick="busy(this, addPerson)">${t("Adicionar pessoa")}</button></div></div>`;
}
async function addPerson() {
  const name = $("#pp-name").value.trim();
  if (!name) throw new Error(t("Informe o nome."));
  const people = [...(S.db.settings.people || [])];
  if (people.some((p) => AI.norm(p.name) === AI.norm(name))) throw new Error(t("Essa pessoa já está cadastrada."));
  people.push({ name, role: $("#pp-role").value, dept: $("#pp-dept").value.trim() });
  await api("settings", "PATCH", { people }); await refresh();
}
async function removePerson(k) {
  if (!confirm(t("Excluir este registro?"))) return;
  const people = [...(S.db.settings.people || [])]; people.splice(k, 1);
  await api("settings", "PATCH", { people }); await refresh();
}
