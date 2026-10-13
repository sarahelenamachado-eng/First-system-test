/* Plataforma de Governança — interface (JS puro, sem build).
 * Textos de tela passam por t() (i18n.js). Valores guardados nos dados (status, prioridade, origem…)
 * ficam como códigos fixos em português e são traduzidos só na exibição, com tv(). */
let S = null; // estado vindo de Core.api("state")

const STATUS_ITEM = ["Aberto", "Em andamento", "Aguardando", "Concluído"];
const LEVELS = ["Alta", "Média", "Baixa"];
const PITEM_STATUS = ["Aberto", "Em andamento", "Finalizado"];
const MEETING_STATUS = ["Pendente", "Solicitada", "Realizada", "Não realizada"];
const MODULES = ["painel", "entradas", "lista", "projetos", "reunioes", "riscos", "fluxos", "summaries"];
const SCENARIOS = { projects: ["se realizado", "se não realizado"], risks: ["se concretizar", "se tratado"] };
const ACT_FIELDS = { scope: "Scope", target: "Target", item: "Item", n: "Nº", subitem: "Subitem", last_progress: "Last Progress",
  owner: "Responsável", start: "Início", finish: "Término / prazo", progress: "% concluído" };

// ------------------------------------------------------------------ utilidades
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pill = (txt, cls = "") => (txt ? `<span class="pill ${esc(cls)}">${esc(txt)}</span>` : "");
const tv = (v) => (v ? t(v) : "");
const prio = (p) => pill(tv(p), "p-" + p);
const opts = (list, sel) => list.map((o) => `<option value="${esc(o)}" ${o === sel ? "selected" : ""}>${esc(t(o))}</option>`).join("");
const msg = (r) => (r.msg ? t(r.msg[0], r.msg[1]) : r.text || "");
const titleOf = (m) => (m.title_msg ? t(m.title_msg[0], m.title_msg[1]) : m.title || "");
const byId = (col, id) => (S.db[col] || []).find((r) => r.id === id);
const defLabel = (d) => t(S.definitions[d] || d);
const fmt = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) : "");
const th = (heads) => `<tr>${heads.map((h) => `<th>${h === "ID" ? "ID" : esc(t(h))}</th>`).join("")}</tr>`;
const L = (text) => `<label>${esc(t(text))}</label>`;
const LIST = (k) => S.db.settings.lists[k] || [];
const timeline = (list) => list.map((h) => `<li><span class="muted">${fmt(h.date || h.ts)}</span> ${esc(msg(h))}</li>`).join("") || '<li class="muted">—</li>';
const bar = (pct, label = "") => (pct == null ? `<span class="muted">—</span>`
  : `<div class="progress" title="${esc(label)}"><div class="progress-bar"><span style="width:${pct}%"></span></div><b>${pct}%</b></div>`);
const statusPill = (s) => pill(tv(s), { Realizada: "p-Baixa", "Não realizada": "p-Alta", Pendente: "p-Média", Solicitada: "p-Média", Finalizado: "p-Baixa", Concluído: "p-Baixa", Concluída: "p-Baixa" }[s] || "");
const tabs = (base, list, cur) => `<div class="tabs">${list.map(([k, label]) => `<a href="#${base}/${k}" class="${k === cur ? "on" : ""}">${label}</a>`).join("")}</div>`;
const actStatus = (a) => ((+a.progress || 0) >= 100 ? "Concluída" : (+a.progress || 0) > 0 ? "Em andamento" : "Não iniciada");

const api = (path, method = "GET", body) => Core.api(path, method, body);
function toast(text) {
  const el = $("#toast"); el.textContent = text; el.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add("hidden"), 3500);
}
async function busy(btn, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = t("Processando…");
  try { await fn(); } catch (e) { toast(t("Erro: ") + t(e.message)); } finally { btn.disabled = false; btn.textContent = old; }
}
function openModal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); }
async function uploadFiles(path, input, extra = {}) {
  if (!input.files.length) throw new Error(t("Escolha um arquivo."));
  for (const f of input.files) await api(path, "POST", { file: f, ...extra });
}
/** Abre um arquivo da pasta local numa nova aba. */
async function openFile(rel) {
  const f = await Store.read(rel);
  if (!f) return toast(t("Arquivo não encontrado na pasta."));
  const type = rel.toLowerCase().endsWith(".html") ? "text/html" : f.type || "application/octet-stream";
  const url = URL.createObjectURL(new Blob([f], { type }));
  if (/\.(html|pdf|png|jpe?g|gif|txt|csv)$/i.test(rel)) window.open(url, "_blank");
  else download(url, f.name);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function download(url, name) { const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
function downloadText(text, name, type) { const url = URL.createObjectURL(new Blob([text], { type })); download(url, name); setTimeout(() => URL.revokeObjectURL(url), 60000); }
function fileLink(rel, label) { return `<a href="#" data-rel="${esc(rel)}" onclick="openFile(this.dataset.rel);return false">${esc(label)}</a>`; }
function exportCsv() { downloadText(Core.exportCsv(), `${t("lista_governanca")}_${S.today}.csv`, "text/csv;charset=utf-8"); }
function linksHtml(rec) {
  const names = { items: "Itens", projects: "Projetos", risks: "Riscos", meetings: "Reuniões", inputs: "Entradas", flows: "Fluxos" };
  const views = { items: "lista", projects: "projetos", risks: "riscos", meetings: "reunioes", inputs: "entradas", flows: "fluxos" };
  const parts = Object.entries(rec.links || {}).filter(([, v]) => v.length).map(([k, v]) =>
    `<b>${esc(t(names[k] || k))}:</b> ` + v.map((id) => `<a href="#${views[k]}/${id}" onclick="closeModal()">${esc(id)}</a>`).join(", "));
  return parts.join(" · ") || `<span class="muted">${t("sem vínculos")}</span>`;
}
function linkForm(col, id) {
  return `<div class="toolbar"><select id="lk-col"><option value="items">${t("Item")}</option><option value="projects">${t("Projeto")}</option><option value="risks">${t("Risco")}</option><option value="meetings">${t("Reunião")}</option></select>
    <input id="lk-id" placeholder="${esc(t("ID (ex.: GOV003)"))}"><button class="ghost small" onclick="addLink('${col}','${id}')">${t("Vincular")}</button></div>`;
}
async function addLink(col, id) {
  try { await api(`${col}/${id}/link`, "POST", { collection: $("#lk-col").value, id: $("#lk-id").value.trim().toUpperCase() }); toast(t("Vínculo criado")); await refresh(); }
  catch (e) { toast(t(e.message)); }
}
async function sub(col, id, list, entry, extra = {}) { await api(`${col}/${id}/sub`, "POST", { list, entry, ...extra }); await refresh(); }
async function subRemove(col, id, list, sid) { if (confirm(t("Excluir este registro?"))) { await api(`${col}/${id}/sub`, "POST", { list, remove: sid }); await refresh(); } }

// ------------------------------------------------------------------ aparência e idioma
function applyAppearance() {
  const ap = S?.db.settings.appearance || { accent: "#C00000", font_scale: 1, density: "normal", show_bar: true };
  const root = document.documentElement.style;
  root.setProperty("--brand", ap.accent || "#C00000");
  root.setProperty("--font-scale", ap.font_scale || 1);
  document.body.dataset.density = ap.density || "normal";
  $("#redbar").classList.toggle("hidden", ap.show_bar === false);
  const logo = $("#logo");
  logo.src = ap.logo || DEFAULT_LOGO;
  logo.classList.toggle("hidden", ap.logo === "none");
  $("#app-title").textContent = ap.title || t("Governança");
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("hidden", (S?.db.settings.hidden_modules || []).includes(a.getAttribute("href").slice(1))));
}
function applyStaticTexts() {
  document.documentElement.lang = I18N.htmlLang();
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
  const sel = $("#lang");
  if (sel) sel.value = I18N.lang;
  document.querySelector(".brand .ai").textContent = I18N.lang === "pt" ? "IA" : "AI";
  if (!S?.db.settings.appearance.title) $("#app-title").textContent = t("Governança");
}
async function setLang(l) {
  await I18N.set(l);
  applyStaticTexts();
  if (S) await refresh(); else welcome(await Store.remembered());
}

// ------------------------------------------------------------------ roteamento
async function refresh() { S = await api("state"); render(); }
function render() {
  if (!S) return;
  applyAppearance();
  const [view, id, tab] = (location.hash.slice(1) || "painel").split("/");
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + view));
  const b = $("#ai-badge");
  b.className = "badge" + (S.ai.enabled ? " on" : "");
  b.textContent = S.ai.enabled ? t("IA: ") + S.ai.model : t("IA offline (heurística)");
  b.title = S.ai.detail ? t(S.ai.detail) : "";
  const V = { painel: viewPainel, entradas: viewEntradas, lista: viewLista, projetos: viewProjetos, reunioes: viewReunioes, riscos: viewRiscos,
    fluxos: viewFluxos, summaries: viewSummaries, config: viewConfig }[view] || viewPainel;
  $("#view").innerHTML = V(id, tab);
  if (V === viewEntradas && id) openTriage(id);
  if (V === viewLista && id) openItem(id);
  if (V === viewFluxos && id) FlowEd.mount();
  if (V === viewRiscos && id && (tab || "geral") === "docs") loadRiskFiles(id);
}
window.addEventListener("hashchange", render);

// ------------------------------------------------------------------ painel
function viewPainel() {
  const open = S.db.items.filter((i) => i.status !== "Concluído");
  const toConfirm = S.db.meetings.filter((m) => ["Pendente", "Solicitada"].includes(m.status));
  const k = [
    ["Entradas pendentes", S.db.inputs.filter((i) => i.status !== "Registrado").length, "entradas"],
    ["Itens em aberto", open.length, "lista"],
    ["Alta prioridade", open.filter((i) => i.priority === "Alta").length, "lista"],
    ["Vencidos", open.filter((i) => i.due_date && i.due_date < S.today).length, "lista"],
    ["Projetos ativos", S.db.projects.filter((p) => !["Concluído", "Cancelado"].includes(p.status)).length, "projetos"],
    ["Reuniões a confirmar", toConfirm.length, "reunioes"],
    ["Riscos abertos", S.db.risks.filter((r) => r.status !== "Fechado").length, "riscos"],
  ];
  const mains = S.db.projects.filter((p) => p.main && !["Concluído", "Cancelado"].includes(p.status));
  return `<h1>${t("Painel de governança")}</h1>
  <div class="kpis">${k.map(([n, v, h]) => `<a class="kpi" href="#${h}"><b>${v}</b><span>${t(n)}</span></a>`).join("")}</div>
  ${mains.length ? `<div class="card" style="margin-bottom:14px"><h2>${t("Projetos principais")}</h2><table>${th(["ID", "Projeto", "% concluído", "Atividades", "Próx. reunião"])}
    ${mains.map((p) => `<tr class="click" onclick="location.hash='projetos/${p.id}'"><td>${p.id}</td><td>${esc(p.name)}</td><td>${bar(Core.projectPct(p))}</td><td>${bar(Core.activitiesPct(p))}</td><td>${esc(p.next_meeting)}</td></tr>`).join("")}</table></div>` : ""}
  <div class="grid">
    <div class="card"><h2>${t("Alertas")}</h2>${S.alerts.map((a) => `<div class="alert lv-${a.level}">${esc(msg(a))}</div>`).join("") || `<p class="muted">${t("Nenhum alerta.")}</p>`}</div>
    <div class="card"><h2>${t("Atividade recente")}</h2><ul class="tl">${timeline(S.events.slice().reverse().slice(0, 15))}</ul></div>
  </div>
  <div class="actions"><a class="btn" href="#entradas">${t("+ Nova entrada")}</a><a class="btn ghost" href="#summaries">${t("Gerar summary do dia")}</a></div>`;
}

// ------------------------------------------------------------------ entradas (demand management)
function viewEntradas() {
  const list = S.db.inputs.slice().reverse();
  return `<h1>${t("Inputs management")}</h1>
  <div class="steps"><span class="step on">${t("1. Entrada da informação")}</span><span class="step">${t("2. Assessment (relação + classificação)")}</span><span class="step">${t("3. Definição")}</span><span class="step">${t("4. Lista geral + módulos")}</span></div>
  <div class="grid" style="grid-template-columns: minmax(320px, 1.1fr) minmax(300px, 1fr)">
  <div class="card"><h2>${t("Nova entrada")}</h2>${inputForm()}
    <div class="actions"><button onclick="busy(this, saveInput)">${t("Registrar e avaliar com IA")}</button></div></div>
  <div class="card"><h2>${t("Entradas")}</h2><table>${th(["ID", "Entrada", "Origem", "Status"])}
    ${list.map((i) => `<tr class="click" onclick="location.hash='entradas/${i.id}'"><td>${i.id}</td><td>${esc(i.title)}</td><td>${esc(tv(i.source))}</td>
      <td>${pill(tv(i.status), i.status === "Registrado" ? "p-Baixa" : "p-Média")} ${i.item_id ? pill(i.item_id) : ""}</td></tr>`).join("") || `<tr><td colspan=4 class="muted">${t("Nenhuma entrada.")}</td></tr>`}
  </table></div></div>`;
}
function inputForm(pre = {}) {
  const meetings = S.db.meetings.slice().reverse();
  return `<div class="row"><div>${L("Origem")}<select id="f-source">${opts(LIST("sources"), pre.source || LIST("sources")[0])}</select></div>
    <div>${L("Tipo")}<select id="f-kind">${opts(LIST("input_kinds"), pre.kind)}</select></div></div>
  ${L("Título / assunto")}<input id="f-title" value="${esc(pre.title)}">
  ${L("Descrição do input")}<textarea id="f-desc">${esc(pre.description)}</textarea>
  ${L("Background / contexto")}<textarea id="f-bg" style="min-height:60px">${esc(pre.background)}</textarea>
  <div class="row"><div>${L("De onde a demanda veio (pessoa / fórum)")}<input id="f-origin" value="${esc(pre.origin)}"></div>
    <div>${L("Reunião")}<select id="f-meeting"><option value="">—</option>${meetings.map((m) => `<option value="${m.id}" ${m.id === pre.meeting_id ? "selected" : ""}>${m.id} · ${esc(titleOf(m))}</option>`).join("")}</select></div></div>
  <div class="row"><div>${L("Área principal")}<input id="f-area" list="areas" value="${esc(pre.area_main)}"></div>
    <div>${L("Áreas impactadas")}<input id="f-areas-imp" value="${esc(pre.areas_impacted)}"></div>
    <div>${L("Áreas que impactam")}<input id="f-areas-by" value="${esc(pre.areas_impacting)}"></div></div>
  <datalist id="areas">${(S.db.settings.areas || []).map((a) => `<option>${esc(a)}</option>`).join("")}</datalist>
  <div class="row"><div>${L("Responsável")}<input id="f-owner" value="${esc(pre.owner)}"></div><div>${L("Prazo")}<input id="f-due" type="date" value="${esc(pre.due_date)}"></div></div>`;
}
function readInputForm() {
  return { source: $("#f-source").value, source_detail: $("#f-kind").value, title: $("#f-title").value.trim(), description: $("#f-desc").value,
    background: $("#f-bg").value, origin: $("#f-origin").value, meeting_id: $("#f-meeting").value, area_main: $("#f-area").value,
    areas_impacted: $("#f-areas-imp").value, areas_impacting: $("#f-areas-by").value, owner: $("#f-owner").value, due_date: $("#f-due").value };
}
async function saveInput() {
  const data = readInputForm();
  if (!data.title) throw new Error(t("Informe o título."));
  const rec = await api("inputs", "POST", data);
  await api(`inputs/${rec.id}/suggest`, "POST");
  await refresh();
  location.hash = "entradas/" + rec.id;
}

function openTriage(id) {
  const inp = byId("inputs", id);
  if (!inp) return;
  const sug = inp.ai_suggestion, a = inp.assessment || sug || {};
  const defs = inp.definitions || a.definitions || [];
  const done = inp.status === "Registrado";
  const items = S.db.items, projects = S.db.projects;
  const rel = (iid) => (a.related || []).find((r) => r.id === iid);
  openModal(`<h2>${inp.id} · ${esc(inp.title)}</h2>
  <p class="muted">${[tv(inp.source), tv(inp.source_detail), fmt(inp.created_at), inp.origin ? t("veio de") + " " + inp.origin : ""].filter(Boolean).map(esc).join(" · ")}</p>
  <p>${esc(inp.description)}</p>${inp.background ? `<p class="muted"><b>${t("Contexto:")}</b> ${esc(inp.background)}</p>` : ""}
  ${sug ? `<div class="ai-box"><b>${t("Sugestão da IA")}</b> (${esc(tv(sug.engine))}): ${esc(sug.msg ? msg(sug) : sug.rationale)}${sug.gap_analysis ? "\n" + t("Gaps:") + " " + esc(sug.gap_analysis) : ""}${sug.relation_explanation ? "\n" + t("Relação:") + " " + esc(t(sug.relation_explanation)) : ""}</div>`
        : `<div class="actions"><button onclick="busy(this, async()=>{await api('inputs/${id}/suggest','POST'); await refresh();})">${t("Pedir sugestão da IA")}</button></div>`}
  <div class="steps"><span class="step on">${t("2. Assessment")}</span></div>
  <h3>${t("2.1 Tem relação com item já levantado?")}</h3>
  <div class="row"><div>${L("Relação")}<select id="t-mode">
    <option value="novo" ${a.relation_mode !== "incluir_existente" ? "selected" : ""}>${t("Não / relação só em impacto → criar item novo")}</option>
    <option value="incluir_existente" ${a.relation_mode === "incluir_existente" ? "selected" : ""}>${t("Sim, relação direta → incluir no item on going")}</option></select></div>
    <div>${L("Item on going (relação direta)")}<select id="t-include"><option value="">—</option>${items.map((i) => `<option value="${i.id}" ${i.id === a.include_in ? "selected" : ""}>${i.id} · ${esc(i.title)}</option>`).join("")}</select></div></div>
  ${L("Itens relacionados (vincular)")}<div class="checks" style="max-height:140px;overflow:auto">${items.map((i) => `<label><input type="checkbox" class="t-rel" value="${i.id}" ${rel(i.id) ? "checked" : ""}> ${i.id} · ${esc(i.title)} ${rel(i.id) ? `<span class="muted">(${esc(rel(i.id).relation)})</span>` : ""}</label>`).join("") || `<span class="muted">${t("Lista geral vazia.")}</span>`}</div>
  <h3>${t("2.2 Classificação")}</h3>
  <div class="row"><div>${L("Escopo — o que é?")}<input id="t-scope" value="${esc(a.scope)}"></div><div>${L("O que deve ser feito com isso?")}<input id="t-scope-act" value="${esc(a.scope_action)}"></div></div>
  <div class="row"><div>${L("Prioridade")}<select id="t-prio">${opts(LEVELS, a.priority || "Média")}</select></div>
    <div>${L("Urgência")}<select id="t-urg">${opts(LEVELS, a.urgency || "Média")}</select></div>
    <div>${L("De onde a demanda veio")}<input id="t-origin" value="${esc(a.origin || inp.origin || tv(inp.source))}"></div></div>
  ${L("Riscos e urgência — explique o porquê")}<textarea id="t-risk" style="min-height:50px">${esc(a.risk_reason)}</textarea>
  ${L("Impactos")}<div class="checks inline">${S.impact_types.map((x) => `<label><input type="checkbox" class="t-imp" value="${esc(x)}" ${(a.impacts || []).includes(x) ? "checked" : ""}> ${esc(t(x))}</label>`).join("")}</div>
  ${L("Impactos em quais projetos / operações, por quê")}<textarea id="t-impd" style="min-height:50px">${esc(a.impact_details)}</textarea>
  ${L("Gaps (por que não foi previsto antes?)")}<textarea id="t-gap" style="min-height:50px">${esc(a.gap_analysis)}</textarea>
  <div class="steps" style="margin-top:14px"><span class="step on">${t("3. Definição (pode ser mais de uma)")}</span></div>
  <div class="checks">${Object.entries(S.definitions).map(([k, v]) => `<label><input type="checkbox" class="t-def" value="${k}" ${defs.includes(k) ? "checked" : ""}> ${esc(t(v))}</label>`).join("")}</div>
  <p class="muted">${t("“Ação dentro de um projeto” entra automaticamente na aba Itens adicionais do projeto.")}</p>
  <div class="row"><div>${L('Projeto (para "Ação dentro de um projeto")')}<select id="t-proj"><option value="">—</option>${projects.map((p) => `<option value="${p.id}" ${p.id === a.project_id ? "selected" : ""}>${p.id} · ${esc(p.name)}</option>`).join("")}</select></div>
    <div>${L('Nome do novo projeto (se "Criação de um novo projeto")')}<input id="t-newproj" value="${esc(inp.title)}"></div></div>
  <div class="actions">${done ? `<span class="pill p-Baixa">${t("Registrado em")} ${inp.item_id}</span> <a class="btn ghost" href="#lista/${inp.item_id}">${t("Abrir item")}</a>` : `<button onclick="busy(this, ()=>commitTriage('${id}'))">${t("Confirmar e registrar na lista geral")}</button>`}
    <button class="ghost" onclick="if(confirm(t('Excluir entrada?'))) api('inputs/${id}','DELETE').then(()=>{closeModal();location.hash='entradas';refresh();})">${t("Excluir")}</button></div>
  <p class="muted">${t("Ao confirmar, a IA guarda a sua decisão (vs. a sugestão) para aprender os critérios de classificação.")}</p>`);
}
async function commitTriage(id) {
  const vals = (cls) => [...document.querySelectorAll("." + cls)].filter((c) => c.checked).map((c) => c.value);
  const definitions = vals("t-def");
  if (!definitions.length) throw new Error(t("Escolha ao menos uma definição."));
  const body = {
    relation_mode: $("#t-mode").value, include_in: $("#t-include").value, related: vals("t-rel"), definitions,
    project_id: $("#t-proj").value, new_project_name: $("#t-newproj").value,
    assessment: { scope: $("#t-scope").value, scope_action: $("#t-scope-act").value, priority: $("#t-prio").value, urgency: $("#t-urg").value,
      origin: $("#t-origin").value, risk_reason: $("#t-risk").value, impacts: vals("t-imp"), impact_details: $("#t-impd").value, gap_analysis: $("#t-gap").value },
  };
  if (body.relation_mode === "incluir_existente" && !body.include_in) throw new Error(t("Selecione o item on going."));
  const c = (await api(`inputs/${id}/commit`, "POST", body)).created;
  toast(`${t("Registrado em")} ${c.item}` + (c.project ? ` · ${t("projeto")} ${c.project}` : "") + (c.risks ? ` · ${c.risks.join(", ")}` : "") + (c.action ? ` · ${t("ação")} ${c.action}` : ""));
  closeModal();
  location.hash = "lista";
  await refresh();
}

// ------------------------------------------------------------------ lista geral
let F = { q: "", status: "", prio: "", src: "", def: "" };
function viewLista() {
  const rows = S.db.items.filter((i) => (!F.status || i.status === F.status) && (!F.prio || i.priority === F.prio) && (!F.src || i.source === F.src)
    && (!F.def || (i.definitions || []).includes(F.def)) && (!F.q || JSON.stringify(i).toLowerCase().includes(F.q.toLowerCase()))).reverse();
  return `<h1>${t("Lista geral de governança")}</h1>
  <div class="toolbar"><input placeholder="${esc(t("Buscar…"))}" value="${esc(F.q)}" onchange="F.q=this.value;render()">
    <select onchange="F.status=this.value;render()"><option value="">${t("Status")}</option>${opts(STATUS_ITEM, F.status)}</select>
    <select onchange="F.prio=this.value;render()"><option value="">${t("Prioridade")}</option>${opts(LEVELS, F.prio)}</select>
    <select onchange="F.src=this.value;render()"><option value="">${t("Origem")}</option>${opts(LIST("sources"), F.src)}</select>
    <select onchange="F.def=this.value;render()"><option value="">${t("Definição")}</option>${Object.entries(S.definitions).map(([k, v]) => `<option value="${k}" ${F.def === k ? "selected" : ""}>${esc(t(v))}</option>`).join("")}</select>
    <button class="ghost" onclick="exportCsv()">${t("Baixar planilha (CSV)")}</button></div>
  <div class="card" style="overflow:auto"><table>${th(["ID", "Item", "Origem", "Responsável", "Emitido", "Prazo", "Prioridade", "Impactos", "Definição", "Vínculos", "Status"])}
  ${rows.map((i) => `<tr class="click" onclick="location.hash='lista/${i.id}'"><td>${i.id}</td><td>${esc(i.title)}</td><td>${esc(tv(i.source))}</td><td>${esc(i.owner)}</td>
    <td>${esc(i.emitted_at || (i.created_at || "").slice(0, 10))}</td><td>${i.due_date && i.due_date < S.today && i.status !== "Concluído" ? pill(i.due_date, "p-Alta") : esc(i.due_date)}</td>
    <td>${prio(i.priority)}</td><td>${(i.impacts || []).map((x) => pill(t(x))).join("")}</td><td>${(i.definitions || []).map((d) => pill(defLabel(d))).join("")}</td>
    <td class="muted">${Object.entries(i.links || {}).filter(([, v]) => v.length).map(([k, v]) => v.length + " " + t(k)).join(", ")}</td><td>${esc(tv(i.status))}</td></tr>`).join("") || `<tr><td colspan=11 class="muted">${t("Nenhum item.")}</td></tr>`}
  </table></div>`;
}
function openItem(id) {
  const i = byId("items", id);
  if (!i) return;
  openModal(`<h2>${i.id} · ${esc(i.title)}</h2>
  <p>${prio(i.priority)} ${pill(t("Urgência") + " " + (tv(i.urgency) || "—"))} ${(i.impacts || []).map((x) => pill(t(x))).join("")} ${(i.definitions || []).map((d) => pill(defLabel(d))).join("")}</p>
  <p>${esc(i.description)}</p>
  <div class="row"><div>${L("Escopo")}${esc(i.scope)}<br><span class="muted">${esc(i.scope_action)}</span></div><div>${L("Origem")}${esc(tv(i.source))} · ${esc(i.origin)}</div><div>${L("Áreas")}${esc(i.area_main)} ${i.areas_impacted ? "→ " + esc(i.areas_impacted) : ""}</div></div>
  ${i.risk_reason ? L("Riscos / urgência") + esc(i.risk_reason) : ""}${i.impact_details ? L("Impactos") + esc(i.impact_details) : ""}${i.gap_analysis ? L("Gaps") + esc(i.gap_analysis) : ""}
  ${L("Vínculos")}<div>${linksHtml(i)}</div>${linkForm("items", i.id)}
  <div class="row"><div>${L("Status")}<select id="i-status">${opts(STATUS_ITEM, i.status)}</select></div><div>${L("Responsável")}<input id="i-owner" value="${esc(i.owner)}"></div>
    <div>${L("Prazo")}<input type="date" id="i-due" value="${esc(i.due_date)}"></div><div>${L("Prioridade")}<select id="i-prio">${opts(LEVELS, i.priority)}</select></div></div>
  ${L("Registrar atualização")}<textarea id="i-note" style="min-height:50px" placeholder="${esc(t("O que aconteceu? (entra no histórico e no summary)"))}"></textarea>
  <div class="checks"><label><input type="checkbox" id="i-report" ${i.report ? "checked" : ""}> ${t("Info a ser reportada (entra no summary)")}</label></div>
  <div class="actions"><button onclick="busy(this, ()=>saveItem('${i.id}'))">${t("Salvar")}</button></div>
  <h3>${t("Histórico")}</h3><ul class="tl">${timeline((i.history || []).slice().reverse())}</ul>`);
}
async function saveItem(id) {
  await api("items/" + id, "PATCH", { status: $("#i-status").value, owner: $("#i-owner").value, due_date: $("#i-due").value, priority: $("#i-prio").value,
    report: $("#i-report").checked, _note: $("#i-note").value.trim() || undefined });
  toast(t("Item atualizado")); closeModal(); location.hash = "lista"; await refresh();
}

// ------------------------------------------------------------------ impactos e riscos (cenários) — projetos e riscos
function scenariosTab(col, rec) {
  const [sA, sB] = SCENARIOS[col];
  const block = (sc) => {
    const list = (rec.scenarios || []).filter((x) => x.scenario === sc);
    return `<div class="card"><h2>${esc(t(col === "projects" ? (sc === sA ? "Se o projeto for realizado" : "Se o projeto NÃO for realizado") : (sc === sA ? "Se o risco se concretizar" : "Se o risco for tratado / mitigado")))}</h2>
      <table>${th(["Tipo", "Categoria", "Descrição", "Severidade", "Vínculo", ""])}
      ${list.map((x) => `<tr><td>${pill(tv(x.kind), x.kind === "Risco" ? "p-Alta" : "")}</td><td>${esc(tv(x.category))}</td><td>${esc(x.description)}</td><td>${prio(x.severity)}</td>
        <td>${x.link ? esc(x.link) : ""}</td><td><button class="small ghost danger" onclick="busy(this, ()=>subRemove('${col}','${rec.id}','scenarios','${x.id}'))">×</button></td></tr>`).join("") || `<tr><td colspan=6 class="muted">—</td></tr>`}</table>
      <div class="row"><div>${L("Tipo")}<select id="sc-kind-${sc.replace(/\W/g, "")}">${opts(["Impacto", "Risco", "Benefício"])}</select></div>
        <div>${L("Categoria")}<select id="sc-cat-${sc.replace(/\W/g, "")}">${opts(LIST("impact_types"))}</select></div>
        <div>${L("Severidade")}<select id="sc-sev-${sc.replace(/\W/g, "")}">${opts(LEVELS, "Média")}</select></div>
        <div>${L("Vínculo (ID opcional)")}<input id="sc-link-${sc.replace(/\W/g, "")}" placeholder="RISK001"></div></div>
      ${L("Descrição")}<textarea id="sc-desc-${sc.replace(/\W/g, "")}" style="min-height:50px"></textarea>
      <div class="actions"><button class="small" onclick="busy(this, ()=>addScenario('${col}','${rec.id}','${sc}'))">${t("Adicionar")}</button></div></div>`;
  };
  return `<p class="muted">${t(col === "projects" ? "Registre os impactos e riscos gerados pela realização ou não do projeto. Eles alimentam o fluxo visual." : "Registre os impactos e riscos gerados se o risco se concretizar ou se for tratado. Eles alimentam o fluxo visual.")}</p>
    <div class="grid">${block(sA)}${block(sB)}</div>`;
}
async function addScenario(col, id, sc) {
  const k = sc.replace(/\W/g, "");
  const description = $(`#sc-desc-${k}`).value.trim();
  if (!description) throw new Error(t("Descreva o impacto."));
  await sub(col, id, "scenarios", { scenario: sc, kind: $(`#sc-kind-${k}`).value, category: $(`#sc-cat-${k}`).value, severity: $(`#sc-sev-${k}`).value,
    link: $(`#sc-link-${k}`).value.trim().toUpperCase(), description });
}

// ------------------------------------------------------------------ projetos
function viewProjetos(id, tab) {
  if (id) return projectDetail(byId("projects", id), tab || "geral");
  const list = S.db.projects.slice().sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0));
  return `<h1>${t("Gerenciamento de projetos")}</h1>
  <div class="grid" style="grid-template-columns: minmax(300px,2.2fr) minmax(280px,1fr)">
  <div class="card" style="overflow:auto"><table>${th(["ID", "Projeto", "Responsável", "% concluído", "Atividades", "Itens adicionais abertos", "Próx. reunião", "Status"])}
  ${list.map((p) => `<tr class="click" onclick="location.hash='projetos/${p.id}'"><td>${p.id}</td><td>${p.main ? `<span class="star" title="${esc(t("Projeto principal"))}">★</span> ` : ""}${esc(p.name)}</td><td>${esc(p.owner)}</td>
    <td>${bar(Core.projectPct(p))}</td><td>${bar(Core.activitiesPct(p))}</td><td>${(p.actions || []).filter((a) => a.status !== "Concluída").length}</td>
    <td>${p.next_meeting <= S.today ? pill(p.next_meeting, "p-Alta") : esc(p.next_meeting)}</td><td>${esc(tv(p.status))}</td></tr>`).join("") || `<tr><td colspan=8 class="muted">${t("Nenhum projeto.")}</td></tr>`}
  </table></div>
  <div class="card"><h2>${t("Novo projeto")}</h2>${L("Nome")}<input id="p-name">${L("Descrição")}<textarea id="p-desc"></textarea>${L("Responsável")}<input id="p-owner">
    <div class="checks"><label><input type="checkbox" id="p-main"> ${t("Projeto principal (gera reuniões de acompanhamento automaticamente)")}</label></div>
    <div class="actions"><button onclick="busy(this, async()=>{const r=await api('projects','POST',{name:$('#p-name').value,description:$('#p-desc').value,owner:$('#p-owner').value,main:$('#p-main').checked}); await refresh(); location.hash='projetos/'+r.id;})">${t("Criar projeto e pasta local")}</button></div></div></div>`;
}
function projectDetail(p, tab) {
  if (!p) return `<p>${t("Projeto não encontrado.")}</p>`;
  const pct = Core.projectPct(p), apct = Core.activitiesPct(p);
  const open = (p.actions || []).filter((a) => a.status !== "Concluída").length;
  const T = [["geral", t("Visão geral")], ["itens", `${t("Itens do projeto")} (${pct == null ? 0 : pct}%)`], ["atividades", `${t("Atividades (planilha)")} (${p.activities.length})`],
    ["adicionais", `${t("Itens adicionais do projeto")} (${open})`], ["impactos", t("Impactos e riscos")], ["arquivos", t("Arquivos / master schedule")], ["fluxo", t("Fluxo")]];
  const body = { geral: projOverview, itens: projItems, atividades: projActivities, adicionais: projAdditional, impactos: (x) => scenariosTab("projects", x), arquivos: projFiles, fluxo: projFlow }[tab] || projOverview;
  return `<p><a href="#projetos">← ${t("Projetos")}</a></p>
  <div class="title-row"><h1>${p.main ? '<span class="star">★</span> ' : ""}${p.id} · ${esc(p.name)}</h1><div class="pct-big">${t("Concluído")}: ${bar(pct)}</div></div>
  <p class="muted">${t("Pasta local:")} <code>${esc(S.workspace)}/${esc(p.folder)}</code>${apct != null ? ` · ${t("Progresso das atividades")}: ${apct}%` : ""}</p>
  ${tabs("projetos/" + p.id, T, tab)}${body(p)}`;
}
function projOverview(p) {
  const meetings = S.db.meetings.filter((m) => m.project_id === p.id).slice().reverse();
  return `<div class="grid">
  <div class="card"><h2>${t("Dados")}</h2>${L("Descrição")}<textarea id="pd-desc">${esc(p.description)}</textarea>
    ${L("Objetivo do projeto")}<textarea id="pd-obj" style="min-height:50px">${esc(p.objective)}</textarea>
    <div class="row"><div>${L("Responsável")}<input id="pd-owner" value="${esc(p.owner)}"></div><div>${L("Status")}<select id="pd-status">${opts(["Em andamento", "Em risco", "Pausado", "Concluído", "Cancelado"], p.status)}</select></div><div>${L("Próxima reunião")}<input type="date" id="pd-next" value="${esc(p.next_meeting)}"></div></div>
    <div class="checks"><label><input type="checkbox" id="pd-main" ${p.main ? "checked" : ""}> ${t("Projeto principal (gera reuniões de acompanhamento automaticamente)")}</label></div>
    ${L("Atualização / monitoramento")}<textarea id="pd-note" style="min-height:50px"></textarea>
    <div class="actions"><button onclick="busy(this, async()=>{await api('projects/${p.id}','PATCH',{description:$('#pd-desc').value,objective:$('#pd-obj').value,owner:$('#pd-owner').value,status:$('#pd-status').value,next_meeting:$('#pd-next').value,main:$('#pd-main').checked,_note:$('#pd-note').value.trim()||undefined}); toast(t('Projeto atualizado')); await refresh();})">${t("Salvar (marca monitoramento)")}</button>
    <a class="btn ghost" href="#reunioes" onclick="window._newMeetingProject='${p.id}'">${t("Registrar reunião")}</a></div>
    ${L("Vínculos")}<div>${linksHtml(p)}</div>${linkForm("projects", p.id)}</div>
  <div class="card"><h2>${t("Reuniões do projeto")}</h2><table>${th(["ID", "Reunião", "Data", "Status"])}
    ${meetings.map((m) => `<tr class="click" onclick="location.hash='reunioes/${m.id}'"><td>${m.id}</td><td>${esc(titleOf(m))}</td><td>${esc(m.date)}</td><td>${statusPill(m.status)}</td></tr>`).join("") || `<tr><td colspan=4 class="muted">—</td></tr>`}</table>
    <h3>${t("Histórico")}</h3><ul class="tl">${timeline((p.history || []).slice().reverse())}</ul></div></div>`;
}
function projItems(p) {
  const pct = Core.projectPct(p);
  return `<div class="card"><h2>${t("Itens do projeto")}</h2>
    <p>${t("Projeto concluído em")} ${bar(pct)} <span class="muted">${t("(itens finalizados ÷ total de itens)")}</span></p>
    <div style="overflow:auto"><table>${th(["ID", "Item", "Objetivo", "Descrição do progresso", "Responsável", "Prazo", "Status", ""])}
    ${(p.pitems || []).map((x) => `<tr class="${x.status === "Finalizado" ? "done" : ""}"><td>${x.id}</td>
      <td><input id="pi-t-${x.id}" value="${esc(x.title)}"></td><td><textarea id="pi-o-${x.id}" rows="2">${esc(x.objective)}</textarea></td>
      <td><textarea id="pi-p-${x.id}" rows="2">${esc(x.progress_desc)}</textarea></td><td><input id="pi-w-${x.id}" value="${esc(x.owner)}" style="width:110px"></td>
      <td><input type="date" id="pi-d-${x.id}" value="${esc(x.due)}"></td><td><select id="pi-s-${x.id}">${opts(PITEM_STATUS, x.status)}</select></td>
      <td class="nowrap"><button class="small" onclick="busy(this, ()=>savePItem('${p.id}','${x.id}'))">${t("Salvar")}</button>
        <button class="small ghost danger" onclick="busy(this, ()=>subRemove('projects','${p.id}','pitems','${x.id}'))">×</button></td></tr>`).join("") || `<tr><td colspan=8 class="muted">${t("Nenhum item. Adicione os itens que compõem o projeto abaixo.")}</td></tr>`}</table></div>
    <h3>${t("Novo item do projeto")}</h3>
    <div class="row"><div>${L("Item")}<input id="pi-new-t"></div><div>${L("Objetivo")}<input id="pi-new-o"></div><div>${L("Responsável")}<input id="pi-new-w"></div><div>${L("Prazo")}<input type="date" id="pi-new-d"></div></div>
    ${L("Descrição do progresso")}<textarea id="pi-new-p" style="min-height:50px"></textarea>
    <div class="actions"><button onclick="busy(this, ()=>addPItem('${p.id}'))">${t("Adicionar item")}</button></div></div>`;
}
async function addPItem(pid) {
  const title = $("#pi-new-t").value.trim();
  if (!title) throw new Error(t("Informe o título."));
  await sub("projects", pid, "pitems", { title, objective: $("#pi-new-o").value, owner: $("#pi-new-w").value, due: $("#pi-new-d").value, progress_desc: $("#pi-new-p").value, status: "Aberto" });
}
async function savePItem(pid, id) {
  const g = (k) => $(`#pi-${k}-${id}`).value;
  await sub("projects", pid, "pitems", { id, title: g("t"), objective: g("o"), progress_desc: g("p"), owner: g("w"), due: g("d"), status: g("s") });
  toast(t("Item atualizado"));
}
let ACT_FILTER = "";
function projActivities(p) {
  const acts = (p.activities || []).filter((a) => !ACT_FILTER || a.scope === ACT_FILTER);
  const scopes = [...new Set((p.activities || []).map((a) => a.scope).filter(Boolean))];
  let lastScope = null, lastItem = null;
  return `<div class="card"><h2>${t("Atividades (planilha)")}</h2>
    <p class="muted">${t("ACT_HELP")}</p>
    <div class="toolbar"><input type="file" id="act-file" accept=".xlsx,.xlsm,.csv"><button onclick="busy(this, ()=>startImport('${p.id}'))">${t("Importar planilha")}</button>
      ${scopes.length ? `<select onchange="ACT_FILTER=this.value;render()"><option value="">${t("Todos os escopos")}</option>${scopes.map((s) => `<option ${s === ACT_FILTER ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
      <span>${t("Progresso das atividades")}: ${bar(Core.activitiesPct(p))}</span></div>
    <div style="overflow:auto"><table class="acts">${th(["Scope", "Target", "Item", "Nº", "Subitem", "Last Progress", "% concluído", "Status", "Atualização", "Responsável", "Prazo", ""])}
    ${acts.map((a) => {
      const showScope = a.scope !== lastScope, showItem = showScope || a.item !== lastItem;
      lastScope = a.scope; lastItem = a.item;
      const late = a.finish && a.finish < S.today && (+a.progress || 0) < 100;
      return `<tr class="${(+a.progress || 0) >= 100 ? "done" : ""} ${showScope ? "group-start" : ""}">
        <td class="grp">${showScope ? esc(a.scope) : ""}</td><td class="grp">${showScope ? esc(a.target) : ""}</td><td class="grp">${showItem ? esc(a.item) : ""}</td>
        <td>${esc(a.n)}</td><td>${esc(a.subitem)}</td><td class="lp">${esc(a.last_progress)}</td>
        <td class="nowrap"><input type="number" min="0" max="100" step="5" id="ac-p-${a.id}" value="${+a.progress || 0}" style="width:70px"> %
          <div class="progress-bar mini"><span style="width:${+a.progress || 0}%"></span></div></td>
        <td>${pill(t(actStatus(a)), actStatus(a) === "Concluída" ? "p-Baixa" : late ? "p-Alta" : "")}</td>
        <td><textarea id="ac-n-${a.id}" rows="2" placeholder="${esc(t("Novo progresso…"))}">${esc(a.notes)}</textarea></td>
        <td><input id="ac-w-${a.id}" value="${esc(a.owner)}" style="width:100px"></td>
        <td><input type="date" id="ac-d-${a.id}" value="${esc(a.finish)}" class="${late ? "late" : ""}"></td>
        <td class="nowrap"><button class="small" onclick="busy(this, ()=>saveActivity('${p.id}','${a.id}'))">${t("Salvar")}</button>
          <button class="small ghost danger" onclick="busy(this, ()=>subRemove('projects','${p.id}','activities','${a.id}'))">×</button></td></tr>`;
    }).join("") || `<tr><td colspan=12 class="muted">${t("Nenhuma atividade. Importe a planilha do projeto.")}</td></tr>`}</table></div>
    <h3>${t("Adicionar atividade manualmente")}</h3>
    <div class="row"><div>${L("Scope")}<input id="ac-new-s" list="act-scopes"></div><div>${L("Item")}<input id="ac-new-i"></div><div>${L("Subitem")}<input id="ac-new-sub"></div><div>${L("Responsável")}<input id="ac-new-w"></div><div>${L("Prazo")}<input type="date" id="ac-new-d"></div></div>
    <datalist id="act-scopes">${scopes.map((s) => `<option>${esc(s)}</option>`).join("")}</datalist>
    <div class="actions"><button class="small" onclick="busy(this, ()=>addActivity('${p.id}'))">${t("Adicionar atividade")}</button></div></div>`;
}
async function saveActivity(pid, id) {
  const pct = Math.max(0, Math.min(100, +$(`#ac-p-${id}`).value || 0));
  await sub("projects", pid, "activities", { id, progress: pct, notes: $(`#ac-n-${id}`).value, owner: $(`#ac-w-${id}`).value, finish: $(`#ac-d-${id}`).value });
  toast(t("Atividade atualizada"));
}
async function addActivity(pid) {
  const subitem = $("#ac-new-sub").value.trim(), item = $("#ac-new-i").value.trim();
  if (!subitem && !item) throw new Error(t("Informe o item ou subitem."));
  await sub("projects", pid, "activities", { scope: $("#ac-new-s").value, item, subitem, owner: $("#ac-new-w").value, finish: $("#ac-new-d").value, progress: 0, notes: "" });
}
let IMPORT = null;
async function startImport(pid) {
  const file = $("#act-file").files[0];
  if (!file) throw new Error(t("Escolha um arquivo."));
  const rows = await Sheet.table(file);
  if (!rows || !rows.length) throw new Error(t("Não foi possível ler a planilha (use .xlsx ou .csv)."));
  const hr = Core.findHeaderRow(rows);
  IMPORT = { pid, file, rows, hr, map: Core.guessMapping(rows[hr]) };
  importModal();
}
function importModal() {
  const { rows, hr, map } = IMPORT, header = rows[hr] || [];
  const ncol = Math.max(...rows.slice(0, 40).map((r) => r.length));
  const colName = (i) => `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}: ${header[i] || "—"}`;
  const sel = (f) => `<select data-field="${f}" onchange="IMPORT.map['${f}']=this.value===''?undefined:+this.value;importModal()"><option value="">${t("(não usar)")}</option>
    ${Array.from({ length: ncol }, (_, i) => `<option value="${i}" ${map[f] === i ? "selected" : ""}>${esc(colName(i))}</option>`).join("")}</select>`;
  const preview = rows.slice(hr + 1, hr + 8);
  openModal(`<h2>${t("Importar planilha de atividades")}</h2>
    <p class="muted">${t("Confira qual coluna corresponde a cada campo. O mapeamento fica salvo para as próximas importações.")}</p>
    <div class="row"><div>${L("Linha do cabeçalho")}<select onchange="IMPORT.hr=+this.value;IMPORT.map=Core.guessMapping(IMPORT.rows[IMPORT.hr]);importModal()">
      ${rows.slice(0, 15).map((r, i) => `<option value="${i}" ${i === hr ? "selected" : ""}>${i + 1}: ${esc(r.filter(Boolean).slice(0, 4).join(" | ").slice(0, 60))}</option>`).join("")}</select></div></div>
    <div class="map-grid">${Object.entries(ACT_FIELDS).map(([f, label]) => `<div>${L(label)}${sel(f)}</div>`).join("")}</div>
    <h3>${t("Prévia")}</h3><div style="overflow:auto"><table>${th(Object.values(ACT_FIELDS).filter((_, i) => map[Object.keys(ACT_FIELDS)[i]] !== undefined))}
      ${preview.map((r) => `<tr>${Object.keys(ACT_FIELDS).filter((f) => map[f] !== undefined).map((f) => `<td>${esc(r[map[f]])}</td>`).join("")}</tr>`).join("")}</table></div>
    <div class="actions"><button onclick="busy(this, doImport)">${t("Importar")} (${Math.max(0, rows.length - hr - 1)} ${t("linhas")})</button><button class="ghost" onclick="closeModal()">${t("Cancelar")}</button></div>`);
}
async function doImport() {
  const { pid, file, rows, hr, map } = IMPORT;
  const r = await api(`projects/${pid}/import`, "POST", { rows, header_row: hr, mapping: map, file });
  closeModal(); IMPORT = null;
  toast(t("Importado: {added} novas, {updated} atualizadas", r.result));
  location.hash = `projetos/${pid}/atividades`;
  await refresh();
}
function projAdditional(p) {
  return `<div class="card"><h2>${t("Itens adicionais do projeto")}</h2>
    <p class="muted">${t("Itens que chegaram pelo Inputs management classificados como “Ação dentro de um projeto”, ou adicionados aqui.")}</p>
    <div style="overflow:auto"><table>${th(["ID", "Ação", "Item", "Responsável", "Prazo", "Gap (por que não foi prevista)", "Status"])}
    ${(p.actions || []).map((a) => `<tr><td>${a.id}</td><td>${esc(a.text)}</td><td>${a.item_id ? `<a href="#lista/${a.item_id}">${a.item_id}</a>` : ""}</td><td>${esc(a.owner)}</td><td>${esc(a.due)}</td><td>${esc(a.gap_reason)}</td>
      <td><select onchange="api('projects/${p.id}/actions','POST',{id:'${a.id}',status:this.value}).then(refresh)">${opts(["Aberta", "Em andamento", "Concluída"], a.status)}</select></td></tr>`).join("") || `<tr><td colspan=7 class="muted">${t("Sem ações.")}</td></tr>`}</table></div>
    <div class="row"><div>${L("Nova ação")}<input id="pa-text"></div><div>${L("Responsável")}<input id="pa-owner"></div><div>${L("Prazo")}<input type="date" id="pa-due"></div><div>${L("Gap")}<input id="pa-gap"></div></div>
    <div class="actions"><button class="small" onclick="busy(this, async()=>{await api('projects/${p.id}/actions','POST',{text:$('#pa-text').value,owner:$('#pa-owner').value,due:$('#pa-due').value,gap_reason:$('#pa-gap').value}); await refresh();})">${t("Adicionar ação")}</button></div>
    <h3>${t("Itens da lista geral vinculados")}</h3>${S.db.items.filter((i) => (p.links.items || []).includes(i.id)).map((i) => `<div><a href="#lista/${i.id}">${i.id}</a> ${esc(i.title)} ${prio(i.priority)} <span class="muted">${esc(tv(i.status))}</span></div>`).join("") || '<p class="muted">—</p>'}</div>`;
}
function projFiles(p) {
  return `<div class="card"><h2>${t("Master schedules")}</h2>
    <p class="muted">${t("MS_HELP")}</p>
    <div class="toolbar"><input type="file" id="pd-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('projects/${p.id}/upload', $('#pd-file')); await refresh();})">${t("Upload")}</button><button class="ghost small" onclick="refresh()">${t("Sincronizar pasta")}</button></div>
    <table>${th(["Arquivo", "Data", ""])}${(p.schedules || []).map((s, k) => `<tr><td class="files">${fileLink(s.rel, s.name)}</td><td>${fmt(s.uploaded_at)}</td>
      <td><button class="small" onclick="busy(this, async()=>{await api('projects/${p.id}/analyze','POST',{rel:byId('projects','${p.id}').schedules[${k}].rel}); await refresh();})">${t("Organizar com IA")}</button></td></tr>
      ${s.analysis ? `<tr><td colspan=3>${scheduleAnalysis(s.analysis)}</td></tr>` : ""}`).join("") || `<tr><td colspan=3 class="muted">${t("Nenhum cronograma.")}</td></tr>`}</table></div>`;
}
function projFlow(p) {
  const f = S.db.flows.find((x) => x.scope_col === "projects" && x.scope_id === p.id);
  return `<div class="card"><h2>${t("Fluxo")}</h2><p class="muted">${t("Mapa visual que conecta este projeto aos itens, riscos e impactos.")}</p>
    <div class="actions"><button onclick="busy(this, ()=>openFlowFor('projects','${p.id}'))">${t(f ? "Abrir fluxo" : "Criar fluxo")}</button></div></div>`;
}
function scheduleAnalysis(a) {
  const list = (arr) => (arr || []).map((x) => `<li>${esc(typeof x === "string" ? x : `${x.task || x.name} — ${x.finish || ""} ${x.progress != null ? "(" + x.progress + "%)" : ""} ${x.status || ""}`)}</li>`).join("");
  const sec = (key, title) => (a[key]?.length ? `<b>${t(title)}</b><ul>${list(a[key])}</ul>` : "");
  return `<div class="ai-box" style="white-space:normal"><b>${t("Análise")} (${esc(tv(a.engine))})</b><p>${esc(a.msg ? msg(a) : a.overview)}</p>
    ${sec("phases", "Fases / marcos")}${sec("late", "Atrasadas")}${sec("upcoming", "Próximas entregas")}${sec("critical_points", "Pontos críticos")}${sec("suggested_actions", "Ações sugeridas")}</div>`;
}

// ------------------------------------------------------------------ reuniões
let M_FILTER = "";
function viewReunioes(id) {
  if (id) return meetingDetail(byId("meetings", id));
  const pre = window._newMeetingProject || ""; window._newMeetingProject = "";
  const pend = S.db.meetings.filter((m) => ["Pendente", "Solicitada"].includes(m.status)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const all = S.db.meetings.filter((m) => !M_FILTER || m.status === M_FILTER).slice().reverse();
  const projSel = (idp) => `<select id="${idp}"><option value="">—</option>${S.db.projects.map((p) => `<option value="${p.id}" ${p.id === pre ? "selected" : ""}>${p.id} · ${esc(p.name)}</option>`).join("")}</select>`;
  return `<h1>${t("Gerenciamento de reuniões")}</h1>
  <div class="card" style="margin-bottom:14px"><h2>${t("Aguardando confirmação")} (${pend.length})</h2>
    <p class="muted">${t("Reuniões solicitadas e as geradas automaticamente pelos projetos principais. Confirme se a reunião foi feita ou não.")}</p>
    <table>${th(["ID", "Reunião", "Data", "Projeto", "Solicitada por", "Status", ""])}
    ${pend.map((m) => `<tr class="${m.date && m.date < S.today ? "overdue" : ""}"><td><a href="#reunioes/${m.id}">${m.id}</a></td><td>${esc(titleOf(m))}${m.auto ? ` ${pill(t("automática"))}` : ""}</td><td>${esc(m.date)}</td>
      <td>${m.project_id ? `<a href="#projetos/${m.project_id}">${m.project_id}</a>` : ""}</td><td>${esc(tv(m.requested_by))}</td><td>${statusPill(m.status)}</td>
      <td class="nowrap"><button class="small" onclick="busy(this, ()=>meetingDone('${m.id}'))">${t("Foi realizada")}</button>
        <button class="small ghost danger" onclick="busy(this, ()=>meetingNotDone('${m.id}'))">${t("Não foi realizada")}</button></td></tr>`).join("") || `<tr><td colspan=7 class="muted">${t("Nada a confirmar.")}</td></tr>`}</table></div>
  <div class="grid">
  <div class="card"><h2>${t("Solicitar reunião")}</h2>
    <div class="row"><div>${L("Título / pauta")}<input id="rq-title"></div><div>${L("Data prevista")}<input type="date" id="rq-date" value="${S.today}"></div></div>
    <div class="row"><div>${L("Solicitada por")}<input id="rq-by" list="rq-sources"></div><div>${L("Participantes")}<input id="rq-part"></div><div>${L("Projeto")}${projSel("rq-proj")}</div></div>
    <datalist id="rq-sources">${LIST("sources").map((s) => `<option value="${esc(t(s))}">`).join("")}</datalist>
    ${L("Pauta / objetivo")}<textarea id="rq-agenda" style="min-height:60px"></textarea>
    <div class="actions"><button onclick="busy(this, requestMeeting)">${t("Registrar solicitação")}</button></div></div>
  <div class="card"><h2>${t("Nova ata / anotação")}</h2>
    <div class="row"><div>${L("Título")}<input id="m-title"></div><div>${L("Data")}<input type="date" id="m-date" value="${S.today}"></div></div>
    <div class="row"><div>${L("Participantes")}<input id="m-part"></div><div>${L("Departamentos")}<input id="m-dept"></div><div>${L("Projeto (acompanhamento)")}${projSel("m-proj")}</div></div>
    ${L("Ata")}<textarea id="m-min" style="min-height:120px" placeholder="${esc(t("MINUTES_HINT"))}"></textarea>
    ${L("Anotações pessoais")}<textarea id="m-notes"></textarea>
    <div class="actions"><button onclick="busy(this, saveMeeting)">${t("Salvar e extrair demandas com IA")}</button></div></div></div>
  <div class="card" style="margin-top:14px"><h2>${t("Todas as reuniões")}</h2>
    <div class="toolbar"><select onchange="M_FILTER=this.value;render()"><option value="">${t("Status")}</option>${opts(MEETING_STATUS, M_FILTER)}</select></div>
    <table>${th(["ID", "Reunião", "Data", "Projeto", "Itens", "Status"])}
    ${all.map((m) => `<tr class="click" onclick="location.hash='reunioes/${m.id}'"><td>${m.id}</td><td>${esc(titleOf(m))}</td><td>${esc(m.date)}</td><td>${esc(m.project_id)}</td>
      <td>${(m.links.items || []).length + (m.links.inputs || []).length}</td><td>${statusPill(m.status)}</td></tr>`).join("") || `<tr><td colspan=6 class="muted">${t("Nenhuma reunião.")}</td></tr>`}</table></div>`;
}
async function requestMeeting() {
  const title = $("#rq-title").value.trim();
  if (!title) throw new Error(t("Informe o título."));
  await api("meetings", "POST", { title, date: $("#rq-date").value, requested_by: $("#rq-by").value, participants: $("#rq-part").value,
    project_id: $("#rq-proj").value, agenda: $("#rq-agenda").value, status: "Solicitada", kind: "Solicitada" });
  toast(t("Solicitação registrada")); await refresh();
}
async function meetingDone(id) {
  await api(`meetings/${id}/status`, "POST", { status: "Realizada", date: byId("meetings", id).date });
  toast(t("Reunião confirmada. Registre a ata, se quiser."));
  await refresh(); location.hash = "reunioes/" + id;
}
async function meetingNotDone(id) {
  const m = byId("meetings", id);
  const reason = prompt(t("Motivo (opcional):")) ?? "";
  let new_date;
  if (m.project_id) new_date = prompt(t("Nova data para a reunião de acompanhamento (AAAA-MM-DD):"), addDays(S.today, 7)) || undefined;
  await api(`meetings/${id}/status`, "POST", { status: "Não realizada", note: reason || undefined, new_date });
  await refresh();
}
async function saveMeeting() {
  const r = await api("meetings", "POST", { title: $("#m-title").value || t("Reunião"), date: $("#m-date").value, participants: $("#m-part").value,
    departments: $("#m-dept").value, project_id: $("#m-proj").value, minutes: $("#m-min").value, notes: $("#m-notes").value, status: "Realizada" });
  await api(`meetings/${r.id}/extract`, "POST");
  await refresh(); location.hash = "reunioes/" + r.id;
}
function meetingDetail(m) {
  if (!m) return `<p>${t("Reunião não encontrada.")}</p>`;
  const ex = m.extraction;
  window._demands = ex?.demands || [];
  const pending = ["Pendente", "Solicitada"].includes(m.status);
  return `<p><a href="#reunioes">← ${t("Reuniões")}</a></p><h1>${m.id} · ${esc(titleOf(m))}</h1>
  <p>${statusPill(m.status)} <span class="muted">${[m.date, m.participants, m.departments, m.requested_by ? t("Solicitada por") + ": " + tv(m.requested_by) : ""].filter(Boolean).map(esc).join(" · ")}</span></p>
  ${pending ? `<div class="alert lv-media">${t("Esta reunião aguarda confirmação.")} <button class="small" onclick="busy(this, ()=>meetingDone('${m.id}'))">${t("Foi realizada")}</button>
    <button class="small ghost danger" onclick="busy(this, ()=>meetingNotDone('${m.id}'))">${t("Não foi realizada")}</button></div>` : ""}
  ${m.agenda ? `<div class="card" style="margin-bottom:14px"><b>${t("Pauta / objetivo")}:</b> ${esc(m.agenda)}</div>` : ""}
  <div class="grid">
  <div class="card"><h2>${t("Ata")}</h2><textarea id="md-min" style="min-height:200px">${esc(m.minutes)}</textarea>${L("Anotações")}<textarea id="md-notes">${esc(m.notes)}</textarea>
    <div class="actions"><button onclick="busy(this, async()=>{await api('meetings/${m.id}','PATCH',{minutes:$('#md-min').value,notes:$('#md-notes').value}); await api('meetings/${m.id}/extract','POST'); await refresh();})">${t("Salvar e reprocessar")}</button></div>
    ${L("Anexos")}<div class="toolbar"><input type="file" id="md-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('meetings/${m.id}/upload', $('#md-file')); toast(t('Anexado')); await refresh();})">${t("Upload")}</button></div>
    ${L("Vínculos")}<div>${linksHtml(m)}</div>
    <h3>${t("Histórico")}</h3><ul class="tl">${timeline((m.history || []).slice().reverse())}</ul></div>
  <div class="card"><h2>${t("Extração")} (${esc(tv(ex?.engine) || "—")})</h2>${ex?.hint ? `<p class="muted">${esc(t(ex.hint))}</p>` : ""}
    ${ex?.summary ? `<div class="ai-box">${esc(ex.summary)}</div>` : ""}
    <h3>${t("Decisões")}</h3><ul>${(m.decisions || []).map((d) => `<li>${esc(d)}</li>`).join("") || '<li class="muted">—</li>'}</ul>
    <h3>${t("Demandas identificadas → Inputs management")}</h3>
    ${(ex?.demands || []).map((d, k) => `<div class="alert" style="border:1px solid var(--line)"><b>${esc(d.title)}</b> ${d.related_item ? pill(t("rel.") + " " + d.related_item) : ""}<br><span class="muted">${esc(d.owner)} ${esc(d.due_date)}</span> ${esc(d.description)}
      <div class="actions" style="margin-top:6px"><button class="small" onclick="busy(this, ()=>demandToInput('${m.id}', ${k}))">${t("Enviar para entradas")}</button></div></div>`).join("") || `<p class="muted">${t("Nenhuma demanda extraída.")}</p>`}
  </div></div>`;
}
async function demandToInput(mid, k) {
  const d = window._demands[k], m = byId("meetings", mid);
  const rec = await api("inputs", "POST", { source: "Reunião", source_detail: "Pedido pontual", title: d.title, description: d.description,
    origin: titleOf(m), meeting_id: mid, owner: d.owner, due_date: d.due_date, area_main: d.area_main });
  await api(`inputs/${rec.id}/suggest`, "POST");
  await refresh(); location.hash = "entradas/" + rec.id;
}

// ------------------------------------------------------------------ riscos
function viewRiscos(id, tab) {
  if (id) return riskDetail(byId("risks", id), tab || "geral");
  return `<h1>${t("Gerenciamento de riscos")}</h1>
  <div class="grid" style="grid-template-columns: minmax(300px,2fr) minmax(260px,1fr)">
  <div class="card" style="overflow:auto"><table>${th(["ID", "Risco", "Modo", "Prob.", "Impacto", "Principais impactos", "Inputs", "Responsável", "Status"])}
  ${S.db.risks.map((r) => `<tr class="click" onclick="location.hash='riscos/${r.id}'"><td>${r.id}</td><td>${esc(r.title)}</td><td>${esc(tv(r.mode))}</td><td>${prio(r.probability)}</td><td>${pill(tv(r.impact), "p-" + r.impact)}</td>
    <td>${(r.impacts || []).map((x) => pill(t(x))).join("")}</td><td>${(r.inputs_log || []).length}</td><td>${esc(r.owner)}</td><td>${esc(tv(r.status))}</td></tr>`).join("") || `<tr><td colspan=9 class="muted">${t("Nenhum risco.")}</td></tr>`}
  </table></div>
  <div class="card"><h2>${t("Novo risco")}</h2><p class="muted">${t("Normalmente nasce pela definição de uma entrada; aqui é o cadastro direto.")}</p>${L("Título")}<input id="r-title">${L("Descrição")}<textarea id="r-desc"></textarea>
    <div class="row"><div>${L("Modo")}<select id="r-mode">${opts(["Monitorar", "Investigar"])}</select></div><div>${L("Responsável")}<input id="r-owner"></div></div>
    ${L("Principais impactos")}<div class="checks inline">${LIST("impact_types").map((x) => `<label><input type="checkbox" class="r-imp" value="${esc(x)}"> ${esc(t(x))}</label>`).join("")}</div>
    <div class="actions"><button onclick="busy(this, async()=>{const r=await api('risks','POST',{title:$('#r-title').value,description:$('#r-desc').value,mode:$('#r-mode').value,owner:$('#r-owner').value,impacts:[...document.querySelectorAll('.r-imp')].filter(c=>c.checked).map(c=>c.value)}); await refresh(); location.hash='riscos/'+r.id;})">${t("Criar risco e pasta")}</button></div></div></div>`;
}
function riskDetail(r, tab) {
  if (!r) return `<p>${t("Risco não encontrado.")}</p>`;
  const T = [["geral", t("Visão geral")], ["inputs", `${t("Inputs do risco")} (${(r.inputs_log || []).length})`], ["impactos", t("Impactos e riscos")], ["docs", t("Documentos e análise")], ["fluxo", t("Fluxo")]];
  const body = { geral: riskOverview, inputs: riskInputs, impactos: (x) => scenariosTab("risks", x), docs: riskDocs, fluxo: riskFlow }[tab] || riskOverview;
  return `<p><a href="#riscos">← ${t("Riscos")}</a></p><h1>${r.id} · ${esc(r.title)}</h1>
  <p>${(r.impacts || []).map((x) => pill(t(x), "p-Alta")).join("")} <span class="muted">${t("Pasta:")} <code>${esc(S.workspace)}/${esc(r.folder)}</code></span></p>
  ${tabs("riscos/" + r.id, T, tab)}${body(r)}`;
}
function riskOverview(r) {
  return `<div class="grid"><div class="card">
    <div class="row"><div>${L("Modo")}<select id="rd-mode">${opts(["Monitorar", "Investigar"], r.mode)}</select></div><div>${L("Probabilidade")}<select id="rd-prob">${opts(LEVELS, r.probability)}</select></div>
      <div>${L("Impacto")}<select id="rd-imp">${opts(["Alto", "Médio", "Baixo"], r.impact)}</select></div><div>${L("Status")}<select id="rd-status">${opts(["Aberto", "Em tratamento", "Fechado"], r.status)}</select></div><div>${L("Responsável")}<input id="rd-owner" value="${esc(r.owner)}"></div></div>
    ${L("Principais impactos deste risco")}<div class="checks inline">${LIST("impact_types").map((x) => `<label><input type="checkbox" class="rd-impc" value="${esc(x)}" ${(r.impacts || []).includes(x) ? "checked" : ""}> ${esc(t(x))}</label>`).join("")}</div>
    ${L("Como cada impacto se manifesta")}<textarea id="rd-impnotes" style="min-height:60px">${esc(r.impact_notes)}</textarea>
    ${L("Descrição")}<textarea id="rd-desc">${esc(r.description)}</textarea>${L("Notas / informações")}<textarea id="rd-notes">${esc(r.notes)}</textarea>
    <div class="actions"><button onclick="busy(this, saveRisk.bind(null,'${r.id}'))">${t("Salvar")}</button></div></div>
    <div class="card">${L("Vínculos")}<div>${linksHtml(r)}</div>${linkForm("risks", r.id)}
    <h3>${t("Histórico")}</h3><ul class="tl">${timeline((r.history || []).slice().reverse())}</ul></div></div>`;
}
async function saveRisk(id) {
  await api("risks/" + id, "PATCH", { mode: $("#rd-mode").value, probability: $("#rd-prob").value, impact: $("#rd-imp").value, status: $("#rd-status").value, owner: $("#rd-owner").value,
    impacts: [...document.querySelectorAll(".rd-impc")].filter((c) => c.checked).map((c) => c.value), impact_notes: $("#rd-impnotes").value,
    description: $("#rd-desc").value, notes: $("#rd-notes").value });
  toast(t("Risco atualizado")); await refresh();
}
function riskInputs(r) {
  const linked = S.db.inputs.filter((i) => (r.links?.inputs || []).includes(i.id) || i.risk_id === r.id);
  return `<div class="grid"><div class="card"><h2>${t("Novo input do risco")}</h2>
    <div class="row"><div>${L("Data")}<input type="date" id="ri-date" value="${S.today}"></div><div>${L("Origem")}<select id="ri-src">${opts(LIST("sources"))}</select></div><div>${L("Quem informou")}<input id="ri-author"></div></div>
    ${L("Informação")}<textarea id="ri-text" style="min-height:90px"></textarea>
    <div class="checks"><label><input type="checkbox" id="ri-toinp"> ${t("Também enviar para o Inputs management (classificar)")}</label></div>
    <div class="actions"><button onclick="busy(this, ()=>addRiskInput('${r.id}'))">${t("Registrar input")}</button></div></div>
  <div class="card"><h2>${t("Inputs registrados")}</h2><ul class="tl">${(r.inputs_log || []).slice().reverse().map((x) => `<li><span class="muted">${esc(x.date)} · ${esc(tv(x.source))}${x.author ? " · " + esc(x.author) : ""}</span><br>${esc(x.text)}
      ${x.input_id ? ` ${pill(x.input_id)}` : ""} <button class="small ghost danger" onclick="busy(this, ()=>subRemove('risks','${r.id}','inputs_log','${x.id}'))">×</button></li>`).join("") || '<li class="muted">—</li>'}</ul>
    ${linked.length ? `<h3>${t("Entradas do Inputs management ligadas")}</h3>${linked.map((i) => `<div><a href="#entradas/${i.id}">${i.id}</a> ${esc(i.title)} ${pill(tv(i.status))}</div>`).join("")}` : ""}</div></div>`;
}
async function addRiskInput(id) {
  const text = $("#ri-text").value.trim();
  if (!text) throw new Error(t("Escreva a informação."));
  await sub("risks", id, "inputs_log", { date: $("#ri-date").value, source: $("#ri-src").value, author: $("#ri-author").value, text }, { to_inputs: $("#ri-toinp").checked });
  toast(t("Input registrado"));
}
function loadRiskFiles(id) {
  api(`risks/${id}/files`).then((fs) => { const el = $("#rk-files"); if (el) el.innerHTML = fs.map((f) => `<li>${fileLink(f.rel, f.name)} <span class="muted">${fmt(f.modified)}</span></li>`).join("") || `<li class="muted">${t("Pasta vazia")}</li>`; });
}
function riskDocs(r) {
  const a = r.analysis;
  const sections = { causes: "Causas", consequences: "Consequências", mitigations: "Mitigações", report_points: "Pontos para reporte" };
  return `<div class="card"><h2>${t("Documentos da pasta")}</h2><div class="toolbar"><input type="file" id="rd-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('risks/${r.id}/upload', $('#rd-file')); await refresh();})">${t("Upload")}</button></div>
    <ul id="rk-files" class="files"><li class="muted">${t("carregando…")}</li></ul>
    <div class="actions"><button onclick="busy(this, async()=>{await api('risks/${r.id}/analyze','POST'); await refresh();})">${t("Compilar e analisar com IA")}</button></div>
    ${a ? `<div class="ai-box" style="white-space:normal"><b>${t("Análise")} (${esc(tv(a.engine))}) — ${t("confirme antes de reportar")}</b><p>${esc(a.msg ? msg(a) : a.summary)}</p><p>${t("Probabilidade")}: ${esc(tv(a.probability))} · ${t("Impacto")}: ${esc(tv(a.impact))}</p>
      ${Object.entries(sections).map(([k, title]) => (a[k]?.length ? `<b>${t(title)}</b><ul>${a[k].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "")).join("")}</div>` : ""}</div>`;
}
function riskFlow(r) {
  const f = S.db.flows.find((x) => x.scope_col === "risks" && x.scope_id === r.id);
  return `<div class="card"><h2>${t("Fluxo")}</h2><p class="muted">${t("Mapa visual que conecta este risco às causas, projetos e impactos.")}</p>
    <div class="actions"><button onclick="busy(this, ()=>openFlowFor('risks','${r.id}'))">${t(f ? "Abrir fluxo" : "Criar fluxo")}</button></div></div>`;
}

// ------------------------------------------------------------------ fluxos
function viewFluxos(id) {
  if (id) { const f = byId("flows", id); return f ? FlowEd.view(structuredClone(f)) : `<p>${t("Fluxo não encontrado.")}</p>`; }
  const scopeName = (f) => (f.scope_col === "geral" ? t("Geral") : `${f.scope_id} · ${esc((byId(f.scope_col, f.scope_id) || {}).name || (byId(f.scope_col, f.scope_id) || {}).title || "")}`);
  return `<h1>${t("Fluxos de projetos, riscos e impactos")}</h1>
  <p class="muted">${t("FLOWS_HELP")}</p>
  <div class="grid" style="grid-template-columns: minmax(300px,2fr) minmax(260px,1fr)">
  <div class="card"><table>${th(["ID", "Fluxo", "Escopo", "Nós", "Atualizado em"])}
    ${S.db.flows.slice().reverse().map((f) => `<tr class="click" onclick="location.hash='fluxos/${f.id}'"><td>${f.id}</td><td>${esc(f.title)}</td><td>${scopeName(f)}</td><td>${(f.nodes || []).length}</td><td>${fmt(f.updated_at)}</td></tr>`).join("") || `<tr><td colspan=5 class="muted">${t("Nenhum fluxo.")}</td></tr>`}</table></div>
  <div class="card"><h2>${t("Novo fluxo")}</h2>${L("Título")}<input id="fw-title">
    ${L("Escopo")}<select id="fw-scope"><option value="geral:">${t("Geral (todos os projetos e riscos)")}</option>
      ${S.db.projects.map((p) => `<option value="projects:${p.id}">${t("Projeto")} · ${p.id} · ${esc(p.name)}</option>`).join("")}
      ${S.db.risks.map((r) => `<option value="risks:${r.id}">${t("Risco")} · ${r.id} · ${esc(r.title)}</option>`).join("")}</select>
    ${L("Descrição para a IA")}<textarea id="fw-desc" style="min-height:80px"></textarea>
    <div class="actions"><button onclick="busy(this, ()=>newFlow('data'))">${t("Criar pelos dados")}</button><button class="ghost" onclick="busy(this, ()=>newFlow('ai'))">${t("Criar com IA")}</button><button class="ghost" onclick="busy(this, ()=>newFlow('blank'))">${t("Em branco")}</button></div></div></div>`;
}
async function newFlow(mode) {
  const [scope_col, scope_id] = $("#fw-scope").value.split(":");
  const f = await api("flows", "POST", { title: $("#fw-title").value || t("Fluxo"), scope_col, scope_id, description: $("#fw-desc").value, nodes: [], edges: [] });
  if (mode !== "blank") await api(`flows/${f.id}/generate`, "POST", { mode, description: $("#fw-desc").value });
  await refresh(); location.hash = "fluxos/" + f.id;
}

// ------------------------------------------------------------------ summaries
let LAST_SUMMARY = null;
function viewSummaries() {
  return `<h1>${t("Summaries")}</h1>
  <div class="toolbar no-print"><select id="s-type"><option value="daily">${t("Diário")}</option><option value="weekly">${t("Semanal")}</option></select><input type="date" id="s-date" value="${S.today}">
    <button onclick="busy(this, genSummary)">${t("Gerar summary")}</button><button class="ghost" onclick="window.print()">${t("Imprimir / PDF")}</button></div>
  <div id="s-out">${LAST_SUMMARY ? summaryDoc(LAST_SUMMARY) : `<p class="muted">${t("Escolha o tipo e a data. O summary também é salvo como HTML na pasta local SUMMARIES.")}</p>`}</div>
  <div class="card no-print" style="margin-top:14px"><h2>${t("Gerados anteriormente")}</h2><ul>${S.summaries.slice().reverse().map((s) => `<li>${fileLink(s.file, s.file)} <span class="muted">${fmt(s.generated_at)}</span></li>`).join("") || '<li class="muted">—</li>'}</ul></div>`;
}
async function genSummary() {
  LAST_SUMMARY = await api("summary", "POST", { type: $("#s-type").value, date: $("#s-date").value });
  await refresh();
}
function summaryDoc({ summary: s, narrative }) {
  const k = s.kpis;
  const tbl = (rows, cols, heads) => `<table>${th(heads)}${rows.map((r) => `<tr>${cols.map((c) => `<td>${c === "priority" ? prio(r[c]) : c === "pct" ? bar(r[c]) : ["status", "mode", "probability", "impact"].includes(c) ? esc(tv(r[c])) : esc(r[c])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan=${cols.length} class="muted">—</td></tr>`}</table>`;
  const kp = [["Novas demandas", k.new_inputs], ["Itens criados", k.items_created], ["Itens atualizados", k.items_updated], ["Em aberto", k.open_items], ["Alta prioridade", k.high_priority_open], ["Vencidos", k.overdue], ["Reuniões", k.meetings], ["Riscos abertos", k.open_risks], ["Projetos ativos", k.active_projects]];
  return `<div class="summary-doc"><h1>${esc(t(s.type))}</h1><p class="muted">${t("Período")} ${esc(s.period.start)}${s.period.end !== s.period.start ? " – " + esc(s.period.end) : ""} · ${t("gerado")} ${fmt(s.generated_at)}</p>
  <h2>1. ${t("Destaques")}</h2><div class="ai-box">${esc(narrative)}</div>
  <h2>2. ${t("Indicadores")}</h2><div class="kpis">${kp.map(([n, v]) => `<div class="kpi"><b>${v}</b><span>${t(n)}</span></div>`).join("")}</div>
  <h2>3. ${t("Novas demandas por origem")}</h2>${Object.entries(s.inputs_by_source).map(([src, l]) => `<h3>${esc(tv(src))} (${l.length})</h3>${tbl(l, ["id", "title", "status"], ["ID", "Demanda", "Status"])}`).join("") || `<p class="muted">${t("Nenhuma nova demanda.")}</p>`}
  <h2>4. ${t("Itens críticos (alta prioridade)")}</h2>${tbl(s.critical_items, ["id", "title", "owner", "due_date", "status"], ["ID", "Item", "Responsável", "Prazo", "Status"])}
  <h2>5. ${t("Prazos — vencidos e próximos 7 dias")}</h2>${tbl(s.due_items, ["id", "title", "owner", "due_date", "priority"], ["ID", "Item", "Responsável", "Prazo", "Prioridade"])}
  <h2>6. ${t("Projetos")}</h2>${tbl(s.projects, ["id", "name", "status", "pct", "open_actions", "last_monitored", "next_meeting"], ["ID", "Projeto", "Status", "% concluído", "Itens adicionais abertos", "Últ. monitoramento", "Próx. reunião"])}
  <h2>7. ${t("Riscos")}</h2>${tbl(s.risks, ["id", "title", "mode", "probability", "impact"], ["ID", "Risco", "Modo", "Prob.", "Impacto"])}
  <h2>8. ${t("Reuniões e decisões")}</h2>${s.meetings.map((m) => `<p><b>${esc(m.id)} — ${esc(m.title)}</b> (${esc(m.date)}) ${statusPill(m.status)}</p><ul>${(m.decisions || []).map((d) => `<li>${esc(d)}</li>`).join("") || `<li class="muted">${t("Sem decisões registradas")}</li>`}</ul>`).join("") || `<p class="muted">${t("Nenhuma reunião no período.")}</p>`}
  <h2>9. ${t("Infos a reportar")}</h2>${tbl(s.report_items, ["id", "title", "owner", "status"], ["ID", "Item", "Responsável", "Status"])}
  <h2>10. ${t("Alertas")}</h2><ul>${s.alerts.map((a) => `<li>${esc(msg(a))}</li>`).join("") || '<li class="muted">—</li>'}</ul>
  <h2>11. ${t("Linha do tempo")}</h2><ul class="tl">${timeline(s.activity)}</ul></div>`;
}

// ------------------------------------------------------------------ configurações
let CFG_TAB = "aparencia";
function viewConfig(id) {
  CFG_TAB = id || CFG_TAB;
  const T = [["aparencia", t("Aparência")], ["modulos", t("Módulos e idioma")], ["listas", t("Listas")], ["regras", t("Regras")], ["ia", t("IA (Claude)")], ["pasta", t("Pasta e backup")]];
  const body = { aparencia: cfgAppearance, modulos: cfgModules, listas: cfgLists, regras: cfgRules, ia: cfgAI, pasta: cfgFolder }[CFG_TAB] || cfgAppearance;
  return `<h1>${t("Configurações")}</h1>${tabs("config", T, CFG_TAB)}${body(S.db.settings)}`;
}
function cfgAppearance(st) {
  const ap = st.appearance;
  const presets = [["#C00000", "Vermelho GWM"], ["#8B0A1A", "Vinho"], ["#333333", "Grafite"], ["#1F4E79", "Azul"], ["#2E7D32", "Verde"]];
  return `<div class="grid"><div class="card"><h2>${t("Identidade")}</h2>
    ${L("Nome da plataforma (topo da tela)")}<input id="ap-title" value="${esc(ap.title)}" placeholder="${esc(t("Governança"))}">
    ${L("Cor principal")}<div class="toolbar"><input type="color" id="ap-accent" value="${esc(ap.accent)}" style="width:60px;height:36px;padding:2px">
      ${presets.map(([c, n]) => `<button class="swatch" style="background:${c}" title="${esc(t(n))}" onclick="$('#ap-accent').value='${c}'"></button>`).join("")}</div>
    ${L("Tamanho do texto")}<input type="range" id="ap-font" min="0.85" max="1.25" step="0.05" value="${ap.font_scale}">
    ${L("Densidade")}<select id="ap-density">${opts(["compacta", "normal", "confortável"], ap.density)}</select>
    <div class="checks"><label><input type="checkbox" id="ap-bar" ${ap.show_bar !== false ? "checked" : ""}> ${t("Mostrar faixa vermelha abaixo do topo")}</label></div>
    <div class="actions"><button onclick="busy(this, saveAppearance)">${t("Aplicar")}</button></div></div>
  <div class="card"><h2>${t("Logo (canto superior direito)")}</h2>
    <div class="logo-preview"><img src="${ap.logo && ap.logo !== "none" ? ap.logo : DEFAULT_LOGO}" alt="logo"></div>
    <p class="muted">${t("Envie o arquivo oficial do logo (PNG, SVG ou JPG) para melhor qualidade.")}</p>
    <div class="toolbar"><input type="file" id="ap-logo" accept="image/*"><button class="small" onclick="busy(this, uploadLogo)">${t("Usar este logo")}</button></div>
    <div class="actions"><button class="small ghost" onclick="busy(this, ()=>saveAp({logo:''}))">${t("Restaurar logo padrão")}</button><button class="small ghost" onclick="busy(this, ()=>saveAp({logo:'none'}))">${t("Ocultar logo")}</button></div></div></div>`;
}
async function saveAp(patch) { await api("settings", "PATCH", { appearance: patch }); await refresh(); toast(t("Salvo")); }
async function saveAppearance() {
  await saveAp({ title: $("#ap-title").value.trim(), accent: $("#ap-accent").value, font_scale: +$("#ap-font").value, density: $("#ap-density").value, show_bar: $("#ap-bar").checked });
}
async function uploadLogo() {
  const f = $("#ap-logo").files[0];
  if (!f) throw new Error(t("Escolha um arquivo."));
  if (f.size > 1.5e6) throw new Error(t("Imagem muito grande (máx. 1,5 MB)."));
  const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
  await saveAp({ logo: data });
}
function cfgModules(st) {
  const names = { painel: "Painel", entradas: "Entradas", lista: "Lista geral", projetos: "Projetos", reunioes: "Reuniões", riscos: "Riscos", fluxos: "Fluxos", summaries: "Summaries" };
  return `<div class="grid"><div class="card"><h2>${t("Módulos visíveis no menu")}</h2>
    <div class="checks">${MODULES.map((m) => `<label><input type="checkbox" class="mod" value="${m}" ${(st.hidden_modules || []).includes(m) ? "" : "checked"}> ${t(names[m])}</label>`).join("")}</div>
    <div class="actions"><button onclick="busy(this, async()=>{await api('settings','PATCH',{hidden_modules:[...document.querySelectorAll('.mod')].filter(c=>!c.checked).map(c=>c.value)}); await refresh(); toast(t('Salvo'));})">${t("Salvar")}</button></div></div>
  <div class="card"><h2>${t("Idioma")}</h2><select onchange="setLang(this.value)">${Object.entries(I18N.LANGS).map(([k, v]) => `<option value="${k}" ${k === I18N.lang ? "selected" : ""}>${v}</option>`).join("")}</select>
    <p class="muted">${t("O idioma também define o idioma das respostas da IA e dos summaries.")}</p></div></div>`;
}
function cfgLists(st) {
  const L2 = st.lists;
  const box = (k, label, help) => `<div class="card"><h2>${t(label)}</h2><p class="muted">${t(help)}</p><textarea id="ls-${k}" style="min-height:150px">${esc((k === "areas" ? st.areas : L2[k]).join("\n"))}</textarea></div>`;
  return `<p class="muted">${t("Um valor por linha. Os valores padrão são traduzidos automaticamente; os que você criar aparecem como escritos.")}</p>
  <div class="grid">${box("sources", "Origens das demandas", "Ex.: Diretora, HQ, Departamento…")}${box("input_kinds", "Tipos de entrada", "Ex.: Pedido pontual, Nova solicitação do HQ…")}
    ${box("impact_types", "Categorias de impacto", "Usadas na classificação, nos riscos e nos fluxos.")}${box("areas", "Áreas", "Sugestões no campo Área principal.")}
    ${box("flow_edge_labels", "Rótulos das ligações dos fluxos", "Ex.: causa, impacta, mitiga…")}</div>
  <div class="actions"><button onclick="busy(this, saveLists)">${t("Salvar listas")}</button></div>`;
}
async function saveLists() {
  const v = (k) => $(`#ls-${k}`).value.split("\n").map((x) => x.trim()).filter(Boolean);
  await api("settings", "PATCH", { areas: v("areas"), lists: { sources: v("sources"), input_kinds: v("input_kinds"), impact_types: v("impact_types"), flow_edge_labels: v("flow_edge_labels") } });
  toast(t("Salvo")); await refresh();
}
function cfgRules(st) {
  return `<div class="card"><h2>${t("Regras")}</h2>
  <div class="row"><div>${L("Alerta: dias sem atualização")}<input type="number" id="c-days" value="${st.alert_days_without_update}"></div>
    <div>${L("Cadência de reunião de projeto (dias)")}<input type="number" id="c-cad" value="${st.project_meeting_cadence_days}"></div>
    <div>${L("Antecedência para gerar a reunião (dias)")}<input type="number" id="c-lead" value="${st.meeting_lead_days}"></div>
    <div>${L("Nº de vínculos para sugerir projeto")}<input type="number" id="c-links" value="${st.links_for_project_alert}"></div></div>
  <div class="actions"><button onclick="busy(this, async()=>{await api('settings','PATCH',{alert_days_without_update:+$('#c-days').value,project_meeting_cadence_days:+$('#c-cad').value,meeting_lead_days:+$('#c-lead').value,links_for_project_alert:+$('#c-links').value}); toast(t('Salvo')); await refresh();})">${t("Salvar")}</button></div></div>`;
}
function cfgAI() {
  return `<div class="grid"><div class="card"><h2>${t("IA (Claude)")}</h2>
    <p class="muted">${t("Sem chave, a plataforma usa sugestões heurísticas locais. A chave fica guardada só neste navegador (não vai para a pasta).")}</p>
    ${L("Chave da API da Anthropic")}<input id="c-key" type="password" placeholder="sk-ant-..." value="${esc(AI.key)}">
    ${L("Modelo")}<input id="c-model" value="${esc(AI.model)}">
    <div class="actions"><button onclick="busy(this, saveAi)">${t("Salvar e testar")}</button>
      <span class="muted">${S.ai.enabled ? t("IA ativa —") + " " + esc(S.ai.model) : t("IA offline")}</span></div></div>
  <div class="card"><h2>${t("Aprendizado")}</h2>
    <p>${t("{n} decisões de classificação guardadas", { n: Core.db.feedback.length })} · ${t("{n} exemplos salvos", { n: (S.db.flow_examples || []).length })}</p>
    ${L("Regras para montar fluxos (valem para todos)")}<textarea id="c-guide" style="min-height:120px" placeholder="${esc(t("FLOW_GUIDE_PLACEHOLDER"))}">${esc(S.db.settings.flow_guidelines)}</textarea>
    <div class="actions"><button class="ghost" onclick="busy(this, async()=>{await api('settings','PATCH',{flow_guidelines:$('#c-guide').value}); toast(t('Regras salvas')); await refresh();})">${t("Salvar regras")}</button></div></div></div>`;
}
function cfgFolder() {
  return `<div class="grid"><div class="card"><h2>${t("Pasta de trabalho")}</h2>
    <p>${t("Pasta atual:")} <code>${esc(S.workspace)}</code></p>
    <p class="muted">${t("FOLDER_HELP")}</p>
    <div class="actions"><button class="ghost" onclick="busy(this, changeFolder)">${t("Trocar de pasta")}</button></div></div>
  <div class="card"><h2>${t("Backup")}</h2>
    <p class="muted">${t("Baixe uma cópia completa da base (db.json) ou restaure uma cópia anterior. Ao restaurar, a base atual é guardada na pasta BACKUPS.")}</p>
    <div class="actions"><button onclick="downloadText(JSON.stringify(Core.db, null, 2), 'governanca_backup_' + S.today + '.json', 'application/json')">${t("Baixar backup")}</button></div>
    <div class="toolbar"><input type="file" id="bk-file" accept=".json"><button class="small ghost" onclick="busy(this, restoreBackup)">${t("Restaurar backup")}</button></div></div></div>`;
}
async function restoreBackup() {
  const f = $("#bk-file").files[0];
  if (!f) throw new Error(t("Escolha um arquivo."));
  let db;
  try { db = JSON.parse(await f.text()); } catch { throw new Error(t("Arquivo de backup inválido")); }
  if (!confirm(t("Substituir a base atual por este backup?"))) return;
  await api("backup", "POST", { db });
  await refresh(); toast(t("Backup restaurado"));
}
async function saveAi() {
  await AI.configure($("#c-key").value, $("#c-model").value);
  if (AI.enabled()) {
    try { await AI.call("OK?", null, "low", 200); toast(t("IA conectada:") + " " + AI.model); }
    catch (e) { toast(t("Chave salva, mas o teste falhou:") + " " + t(e.message)); }
  } else toast(t("IA desativada (sem chave)"));
  await refresh();
}
async function changeFolder() {
  await Store.pick();
  await Core.load();
  await refresh();
  toast(t("Pasta:") + " " + Store.name);
}

// ------------------------------------------------------------------ inicialização (escolha da pasta)
function welcome(remembered) {
  document.querySelectorAll("nav a").forEach((a) => a.classList.remove("active"));
  $("#logo").src = DEFAULT_LOGO;
  const ok = Store.supported();
  const fromZip = /\/(temp|tmp)\//i.test(decodeURI(location.href));
  $("#view").innerHTML = `<div class="card welcome">
    <h1>${t("Plataforma de Governança")}</h1>
    ${fromZip ? `<div class="alert lv-media">${t("ZIP_WARNING")}</div>` : ""}
    ${ok ? `<p>${t("WELCOME_1")}</p><p class="muted">${t("WELCOME_2")}</p>
      <div class="actions">${remembered ? `<button onclick="busy(this, ()=>reconnect())">${esc(t("Continuar com a pasta \"{name}\"", { name: remembered.name }))}</button>` : ""}
        <button class="${remembered ? "ghost" : ""}" onclick="busy(this, startWithNewFolder)">${t(remembered ? "Escolher outra pasta" : "Escolher pasta de trabalho")}</button></div>`
      : `<p><b>${t("Este navegador não permite acessar pastas do computador.")}</b></p><p>${t("Abra este arquivo no Microsoft Edge ou no Google Chrome.")}</p>`}
  </div>`;
}
async function startWithNewFolder() { await Store.pick(); await boot(); }
async function reconnect() {
  const h = await Store.remembered();
  if (!h || !(await Store.requestPermission(h))) throw new Error(t("Permissão negada para a pasta."));
  await Store.use(h);
  await boot();
}
async function boot() {
  await Core.load();
  await refresh();
}
(async () => {
  try {
    await I18N.init();
    applyStaticTexts();
    await AI.init();
    const h = await Store.remembered();
    if (h && (await Store.hasPermission(h).catch(() => false))) { await Store.use(h); return boot(); }
    welcome(h);
  } catch (e) {
    $("#view").innerHTML = `<p>${esc(t("Não foi possível iniciar:"))} ${esc(e.message)}</p>`;
  }
})();
