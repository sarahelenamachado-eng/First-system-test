/* Plataforma de Governança — interface (JS puro, sem build).
 * Textos de tela passam por t() (i18n.js). Valores guardados nos dados (status, prioridade, origem…)
 * ficam como códigos fixos em português e são traduzidos só na exibição, com tv(). */
let S = null; // estado vindo de Core.api("state")

const SOURCES = ["Diretora", "Reunião", "Departamento", "HQ", "Outro"];
const INPUT_KIND = ["Pedido pontual", "Direcionamento / estratégia (reclamação, opinião)", "Nova solicitação do HQ", "Decisão conjunta entre departamentos", "Atualização de item existente", "Outro"];
const STATUS_ITEM = ["Aberto", "Em andamento", "Aguardando", "Concluído"];
const LEVELS = ["Alta", "Média", "Baixa"];

// ------------------------------------------------------------------ utilidades
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pill = (txt, cls = "") => (txt ? `<span class="pill ${esc(cls)}">${esc(txt)}</span>` : "");
const tv = (v) => (v ? t(v) : "");
const prio = (p) => pill(tv(p), "p-" + p);
const opts = (list, sel) => list.map((o) => `<option value="${esc(o)}" ${o === sel ? "selected" : ""}>${esc(t(o))}</option>`).join("");
const msg = (r) => (r.msg ? t(r.msg[0], r.msg[1]) : r.text || "");
const byId = (col, id) => (S.db[col] || []).find((r) => r.id === id);
const defLabel = (d) => t(S.definitions[d] || d);
const fmt = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) : "");
const th = (heads) => `<tr>${heads.map((h) => `<th>${h === "ID" ? "ID" : esc(t(h))}</th>`).join("")}</tr>`;
const L = (text) => `<label>${esc(t(text))}</label>`;
const timeline = (list) => list.map((h) => `<li><span class="muted">${fmt(h.date || h.ts)}</span> ${esc(msg(h))}</li>`).join("") || '<li class="muted">—</li>';

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
function fileLink(rel, label) { return `<a href="#" data-rel="${esc(rel)}" onclick="openFile(this.dataset.rel);return false">${esc(label)}</a>`; }
function exportCsv() {
  const url = URL.createObjectURL(new Blob([Core.exportCsv()], { type: "text/csv;charset=utf-8" }));
  download(url, `${t("lista_governanca")}_${S.today}.csv`);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function linksHtml(rec) {
  const names = { items: "Itens", projects: "Projetos", risks: "Riscos", meetings: "Reuniões", inputs: "Entradas" };
  const views = { items: "lista", projects: "projetos", risks: "riscos", meetings: "reunioes", inputs: "entradas" };
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

// ------------------------------------------------------------------ idioma
function applyStaticTexts() {
  document.documentElement.lang = { pt: "pt-BR", en: "en", zh: "zh-CN" }[I18N.lang];
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
  const sel = $("#lang");
  if (sel) sel.value = I18N.lang;
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
  const [view, id] = (location.hash.slice(1) || "painel").split("/");
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + view));
  const b = $("#ai-badge");
  b.className = "badge" + (S.ai.enabled ? " on" : "");
  document.querySelector(".brand .ai").textContent = I18N.lang === "pt" ? "IA" : "AI";
  b.textContent = S.ai.enabled ? t("IA: ") + S.ai.model : t("IA offline (heurística)");
  b.title = S.ai.detail ? t(S.ai.detail) : "";
  const V = { painel: viewPainel, entradas: viewEntradas, lista: viewLista, projetos: viewProjetos, reunioes: viewReunioes, riscos: viewRiscos, summaries: viewSummaries, config: viewConfig }[view] || viewPainel;
  $("#view").innerHTML = V(id);
  if (V === viewEntradas && id) openTriage(id);
  if (V === viewLista && id) openItem(id);
}
window.addEventListener("hashchange", render);

// ------------------------------------------------------------------ painel
function viewPainel() {
  const open = S.db.items.filter((i) => i.status !== "Concluído");
  const k = [
    ["Entradas pendentes", S.db.inputs.filter((i) => i.status !== "Registrado").length],
    ["Itens em aberto", open.length],
    ["Alta prioridade", open.filter((i) => i.priority === "Alta").length],
    ["Vencidos", open.filter((i) => i.due_date && i.due_date < S.today).length],
    ["Projetos ativos", S.db.projects.filter((p) => !["Concluído", "Cancelado"].includes(p.status)).length],
    ["Riscos abertos", S.db.risks.filter((r) => r.status !== "Fechado").length],
  ];
  return `<h1>${t("Painel de governança")}</h1>
  <div class="kpis">${k.map(([n, v]) => `<div class="kpi"><b>${v}</b><span>${t(n)}</span></div>`).join("")}</div>
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
  return `<div class="row"><div>${L("Origem")}<select id="f-source">${opts(SOURCES, pre.source || "Diretora")}</select></div>
    <div>${L("Tipo")}<select id="f-kind">${opts(INPUT_KIND, pre.kind)}</select></div></div>
  ${L("Título / assunto")}<input id="f-title" value="${esc(pre.title)}">
  ${L("Descrição do input")}<textarea id="f-desc">${esc(pre.description)}</textarea>
  ${L("Background / contexto")}<textarea id="f-bg" style="min-height:60px">${esc(pre.background)}</textarea>
  <div class="row"><div>${L("De onde a demanda veio (pessoa / fórum)")}<input id="f-origin" value="${esc(pre.origin)}"></div>
    <div>${L("Reunião")}<select id="f-meeting"><option value="">—</option>${meetings.map((m) => `<option value="${m.id}" ${m.id === pre.meeting_id ? "selected" : ""}>${m.id} · ${esc(m.title)}</option>`).join("")}</select></div></div>
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
  ${L("Impactos")}<div class="checks" style="display:flex;gap:16px;flex-wrap:wrap">${S.impact_types.map((x) => `<label><input type="checkbox" class="t-imp" value="${x}" ${(a.impacts || []).includes(x) ? "checked" : ""}> ${esc(t(x))}</label>`).join("")}</div>
  ${L("Impactos em quais projetos / operações, por quê")}<textarea id="t-impd" style="min-height:50px">${esc(a.impact_details)}</textarea>
  ${L("Gaps (por que não foi previsto antes?)")}<textarea id="t-gap" style="min-height:50px">${esc(a.gap_analysis)}</textarea>
  <div class="steps" style="margin-top:14px"><span class="step on">${t("3. Definição (pode ser mais de uma)")}</span></div>
  <div class="checks">${Object.entries(S.definitions).map(([k, v]) => `<label><input type="checkbox" class="t-def" value="${k}" ${defs.includes(k) ? "checked" : ""}> ${esc(t(v))}</label>`).join("")}</div>
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
    <select onchange="F.src=this.value;render()"><option value="">${t("Origem")}</option>${opts(SOURCES, F.src)}</select>
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

// ------------------------------------------------------------------ projetos
function viewProjetos(id) {
  if (id) return projectDetail(byId("projects", id));
  return `<h1>${t("Gerenciamento de projetos")}</h1>
  <div class="grid" style="grid-template-columns: minmax(300px,2fr) minmax(280px,1fr)">
  <div class="card"><table>${th(["ID", "Projeto", "Responsável", "Ações abertas", "Últ. monitoramento", "Próx. reunião", "Status"])}
  ${S.db.projects.map((p) => `<tr class="click" onclick="location.hash='projetos/${p.id}'"><td>${p.id}</td><td>${esc(p.name)}</td><td>${esc(p.owner)}</td>
    <td>${(p.actions || []).filter((a) => a.status !== "Concluída").length}</td><td>${esc(p.last_monitored)}</td><td>${p.next_meeting <= S.today ? pill(p.next_meeting, "p-Alta") : esc(p.next_meeting)}</td><td>${esc(tv(p.status))}</td></tr>`).join("") || `<tr><td colspan=7 class="muted">${t("Nenhum projeto.")}</td></tr>`}
  </table></div>
  <div class="card"><h2>${t("Novo projeto")}</h2>${L("Nome")}<input id="p-name">${L("Descrição")}<textarea id="p-desc"></textarea>${L("Responsável")}<input id="p-owner">
    <div class="actions"><button onclick="busy(this, async()=>{const r=await api('projects','POST',{name:$('#p-name').value,description:$('#p-desc').value,owner:$('#p-owner').value}); await refresh(); location.hash='projetos/'+r.id;})">${t("Criar projeto e pasta local")}</button></div></div></div>`;
}
function projectDetail(p) {
  if (!p) return `<p>${t("Projeto não encontrado.")}</p>`;
  const items = S.db.items.filter((i) => (p.links.items || []).includes(i.id));
  return `<p><a href="#projetos">← ${t("Projetos")}</a></p><h1>${p.id} · ${esc(p.name)}</h1>
  <p class="muted">${t("Pasta local:")} <code>${esc(S.workspace)}/${esc(p.folder)}</code></p>
  <div class="grid">
  <div class="card"><h2>${t("Dados")}</h2>${L("Descrição")}<textarea id="pd-desc">${esc(p.description)}</textarea>
    <div class="row"><div>${L("Responsável")}<input id="pd-owner" value="${esc(p.owner)}"></div><div>${L("Status")}<select id="pd-status">${opts(["Em andamento", "Em risco", "Pausado", "Concluído", "Cancelado"], p.status)}</select></div><div>${L("Próxima reunião")}<input type="date" id="pd-next" value="${esc(p.next_meeting)}"></div></div>
    ${L("Atualização / monitoramento")}<textarea id="pd-note" style="min-height:50px"></textarea>
    <div class="actions"><button onclick="busy(this, async()=>{await api('projects/${p.id}','PATCH',{description:$('#pd-desc').value,owner:$('#pd-owner').value,status:$('#pd-status').value,next_meeting:$('#pd-next').value,_note:$('#pd-note').value.trim()||undefined}); toast(t('Projeto atualizado')); await refresh();})">${t("Salvar (marca monitoramento)")}</button>
    <a class="btn ghost" href="#reunioes" onclick="window._newMeetingProject='${p.id}'">${t("Registrar reunião")}</a></div>
    ${L("Vínculos")}<div>${linksHtml(p)}</div>${linkForm("projects", p.id)}</div>
  <div class="card"><h2>${t("Master schedules")}</h2>
    <p class="muted">${t("MS_HELP")}</p>
    <div class="toolbar"><input type="file" id="pd-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('projects/${p.id}/upload', $('#pd-file')); await refresh();})">${t("Upload")}</button><button class="ghost small" onclick="refresh()">${t("Sincronizar pasta")}</button></div>
    <table>${th(["Arquivo", "Data", ""])}${(p.schedules || []).map((s, k) => `<tr><td class="files">${fileLink(s.rel, s.name)}</td><td>${fmt(s.uploaded_at)}</td>
      <td><button class="small" onclick="busy(this, async()=>{await api('projects/${p.id}/analyze','POST',{rel:byId('projects','${p.id}').schedules[${k}].rel}); await refresh();})">${t("Organizar com IA")}</button></td></tr>
      ${s.analysis ? `<tr><td colspan=3>${scheduleAnalysis(s.analysis)}</td></tr>` : ""}`).join("") || `<tr><td colspan=3 class="muted">${t("Nenhum cronograma.")}</td></tr>`}</table></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>${t("Portfólio de ações")}</h2>
    <table>${th(["ID", "Ação", "Item", "Responsável", "Prazo", "Gap (por que não foi prevista)", "Status"])}
    ${(p.actions || []).map((a) => `<tr><td>${a.id}</td><td>${esc(a.text)}</td><td>${a.item_id ? `<a href="#lista/${a.item_id}">${a.item_id}</a>` : ""}</td><td>${esc(a.owner)}</td><td>${esc(a.due)}</td><td>${esc(a.gap_reason)}</td>
      <td><select onchange="api('projects/${p.id}/actions','POST',{id:'${a.id}',status:this.value}).then(refresh)">${opts(["Aberta", "Em andamento", "Concluída"], a.status)}</select></td></tr>`).join("") || `<tr><td colspan=7 class="muted">${t("Sem ações.")}</td></tr>`}</table>
    <div class="row"><div>${L("Nova ação")}<input id="pa-text"></div><div>${L("Responsável")}<input id="pa-owner"></div><div>${L("Prazo")}<input type="date" id="pa-due"></div><div>${L("Gap")}<input id="pa-gap"></div></div>
    <div class="actions"><button class="small" onclick="busy(this, async()=>{await api('projects/${p.id}/actions','POST',{text:$('#pa-text').value,owner:$('#pa-owner').value,due:$('#pa-due').value,gap_reason:$('#pa-gap').value}); await refresh();})">${t("Adicionar ação")}</button></div>
    <h3>${t("Itens da lista geral vinculados")}</h3>${items.map((i) => `<div><a href="#lista/${i.id}">${i.id}</a> ${esc(i.title)} ${prio(i.priority)} <span class="muted">${esc(tv(i.status))}</span></div>`).join("") || '<p class="muted">—</p>'}
    <h3>${t("Histórico")}</h3><ul class="tl">${timeline((p.history || []).slice().reverse())}</ul></div>`;
}
function scheduleAnalysis(a) {
  const list = (arr) => (arr || []).map((x) => `<li>${esc(typeof x === "string" ? x : `${x.task || x.name} — ${x.finish || ""} ${x.progress != null ? "(" + x.progress + "%)" : ""} ${x.status || ""}`)}</li>`).join("");
  const sec = (key, title) => (a[key]?.length ? `<b>${t(title)}</b><ul>${list(a[key])}</ul>` : "");
  return `<div class="ai-box" style="white-space:normal"><b>${t("Análise")} (${esc(tv(a.engine))})</b><p>${esc(a.msg ? msg(a) : a.overview)}</p>
    ${sec("phases", "Fases / marcos")}${sec("late", "Atrasadas")}${sec("upcoming", "Próximas entregas")}${sec("critical_points", "Pontos críticos")}${sec("suggested_actions", "Ações sugeridas")}</div>`;
}

// ------------------------------------------------------------------ reuniões
function viewReunioes(id) {
  if (id) return meetingDetail(byId("meetings", id));
  const pre = window._newMeetingProject || ""; window._newMeetingProject = "";
  return `<h1>${t("Gerenciamento de reuniões")}</h1>
  <div class="grid" style="grid-template-columns: minmax(300px,1fr) minmax(300px,1.3fr)">
  <div class="card"><table>${th(["ID", "Reunião", "Data", "Itens"])}
  ${S.db.meetings.slice().reverse().map((m) => `<tr class="click" onclick="location.hash='reunioes/${m.id}'"><td>${m.id}</td><td>${esc(m.title)}</td><td>${esc(m.date)}</td><td>${(m.links.items || []).length + (m.links.inputs || []).length}</td></tr>`).join("") || `<tr><td colspan=4 class="muted">${t("Nenhuma reunião.")}</td></tr>`}
  </table></div>
  <div class="card"><h2>${t("Nova ata / anotação")}</h2>
    <div class="row"><div>${L("Título")}<input id="m-title"></div><div>${L("Data")}<input type="date" id="m-date" value="${S.today}"></div></div>
    <div class="row"><div>${L("Participantes")}<input id="m-part"></div><div>${L("Departamentos")}<input id="m-dept"></div>
      <div>${L("Projeto (acompanhamento)")}<select id="m-proj"><option value="">—</option>${S.db.projects.map((p) => `<option value="${p.id}" ${p.id === pre ? "selected" : ""}>${p.id} · ${esc(p.name)}</option>`).join("")}</select></div></div>
    ${L("Ata")}<textarea id="m-min" style="min-height:140px" placeholder="${esc(t("MINUTES_HINT"))}"></textarea>
    ${L("Anotações pessoais")}<textarea id="m-notes"></textarea>
    <div class="actions"><button onclick="busy(this, saveMeeting)">${t("Salvar e extrair demandas com IA")}</button></div></div></div>`;
}
async function saveMeeting() {
  const r = await api("meetings", "POST", { title: $("#m-title").value || t("Reunião"), date: $("#m-date").value, participants: $("#m-part").value,
    departments: $("#m-dept").value, project_id: $("#m-proj").value, minutes: $("#m-min").value, notes: $("#m-notes").value });
  await api(`meetings/${r.id}/extract`, "POST");
  await refresh(); location.hash = "reunioes/" + r.id;
}
function meetingDetail(m) {
  if (!m) return `<p>${t("Reunião não encontrada.")}</p>`;
  const ex = m.extraction;
  window._demands = ex?.demands || [];
  return `<p><a href="#reunioes">← ${t("Reuniões")}</a></p><h1>${m.id} · ${esc(m.title)}</h1><p class="muted">${esc(m.date)} · ${esc(m.participants)} ${m.departments ? "· " + esc(m.departments) : ""}</p>
  <div class="grid">
  <div class="card"><h2>${t("Ata")}</h2><textarea id="md-min" style="min-height:200px">${esc(m.minutes)}</textarea>${L("Anotações")}<textarea id="md-notes">${esc(m.notes)}</textarea>
    <div class="actions"><button onclick="busy(this, async()=>{await api('meetings/${m.id}','PATCH',{minutes:$('#md-min').value,notes:$('#md-notes').value}); await api('meetings/${m.id}/extract','POST'); await refresh();})">${t("Salvar e reprocessar")}</button></div>
    ${L("Anexos")}<div class="toolbar"><input type="file" id="md-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('meetings/${m.id}/upload', $('#md-file')); toast(t('Anexado')); await refresh();})">${t("Upload")}</button></div>
    ${L("Vínculos")}<div>${linksHtml(m)}</div></div>
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
    origin: m.title, meeting_id: mid, owner: d.owner, due_date: d.due_date, area_main: d.area_main });
  await api(`inputs/${rec.id}/suggest`, "POST");
  await refresh(); location.hash = "entradas/" + rec.id;
}

// ------------------------------------------------------------------ riscos
function viewRiscos(id) {
  if (id) return riskDetail(byId("risks", id));
  return `<h1>${t("Gerenciamento de riscos")}</h1>
  <div class="grid" style="grid-template-columns: minmax(300px,2fr) minmax(260px,1fr)">
  <div class="card"><table>${th(["ID", "Risco", "Modo", "Prob.", "Impacto", "Responsável", "Status"])}
  ${S.db.risks.map((r) => `<tr class="click" onclick="location.hash='riscos/${r.id}'"><td>${r.id}</td><td>${esc(r.title)}</td><td>${esc(tv(r.mode))}</td><td>${prio(r.probability)}</td><td>${pill(tv(r.impact), "p-" + r.impact)}</td><td>${esc(r.owner)}</td><td>${esc(tv(r.status))}</td></tr>`).join("") || `<tr><td colspan=7 class="muted">${t("Nenhum risco.")}</td></tr>`}
  </table></div>
  <div class="card"><h2>${t("Novo risco")}</h2><p class="muted">${t("Normalmente nasce pela definição de uma entrada; aqui é o cadastro direto.")}</p>${L("Título")}<input id="r-title">${L("Descrição")}<textarea id="r-desc"></textarea>
    <div class="row"><div>${L("Modo")}<select id="r-mode">${opts(["Monitorar", "Investigar"])}</select></div><div>${L("Responsável")}<input id="r-owner"></div></div>
    <div class="actions"><button onclick="busy(this, async()=>{const r=await api('risks','POST',{title:$('#r-title').value,description:$('#r-desc').value,mode:$('#r-mode').value,owner:$('#r-owner').value}); await refresh(); location.hash='riscos/'+r.id;})">${t("Criar risco e pasta")}</button></div></div></div>`;
}
function riskDetail(r) {
  if (!r) return `<p>${t("Risco não encontrado.")}</p>`;
  const a = r.analysis;
  setTimeout(() => api(`risks/${r.id}/files`).then((fs) => { const el = $("#rk-files"); if (el) el.innerHTML = fs.map((f) => `<li>${fileLink(f.rel, f.name)} <span class="muted">${fmt(f.modified)}</span></li>`).join("") || `<li class="muted">${t("Pasta vazia")}</li>`; }), 0);
  const sections = { causes: "Causas", consequences: "Consequências", mitigations: "Mitigações", report_points: "Pontos para reporte" };
  return `<p><a href="#riscos">← ${t("Riscos")}</a></p><h1>${r.id} · ${esc(r.title)}</h1><p class="muted">${t("Pasta:")} <code>${esc(S.workspace)}/${esc(r.folder)}</code></p>
  <div class="grid"><div class="card">
    <div class="row"><div>${L("Modo")}<select id="rd-mode">${opts(["Monitorar", "Investigar"], r.mode)}</select></div><div>${L("Probabilidade")}<select id="rd-prob">${opts(LEVELS, r.probability)}</select></div>
      <div>${L("Impacto")}<select id="rd-imp">${opts(["Alto", "Médio", "Baixo"], r.impact)}</select></div><div>${L("Status")}<select id="rd-status">${opts(["Aberto", "Em tratamento", "Fechado"], r.status)}</select></div></div>
    ${L("Descrição")}<textarea id="rd-desc">${esc(r.description)}</textarea>${L("Notas / informações")}<textarea id="rd-notes">${esc(r.notes)}</textarea>
    <div class="actions"><button onclick="busy(this, async()=>{await api('risks/${r.id}','PATCH',{mode:$('#rd-mode').value,probability:$('#rd-prob').value,impact:$('#rd-imp').value,status:$('#rd-status').value,description:$('#rd-desc').value,notes:$('#rd-notes').value}); toast(t('Risco atualizado')); await refresh();})">${t("Salvar")}</button></div>
    ${L("Vínculos")}<div>${linksHtml(r)}</div>${linkForm("risks", r.id)}
    <h3>${t("Histórico")}</h3><ul class="tl">${timeline((r.history || []).slice().reverse())}</ul></div>
  <div class="card"><h2>${t("Documentos da pasta")}</h2><div class="toolbar"><input type="file" id="rd-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('risks/${r.id}/upload', $('#rd-file')); await refresh();})">${t("Upload")}</button></div>
    <ul id="rk-files" class="files"><li class="muted">${t("carregando…")}</li></ul>
    <div class="actions"><button onclick="busy(this, async()=>{await api('risks/${r.id}/analyze','POST'); await refresh();})">${t("Compilar e analisar com IA")}</button></div>
    ${a ? `<div class="ai-box" style="white-space:normal"><b>${t("Análise")} (${esc(tv(a.engine))}) — ${t("confirme antes de reportar")}</b><p>${esc(a.msg ? msg(a) : a.summary)}</p><p>${t("Probabilidade")}: ${esc(tv(a.probability))} · ${t("Impacto")}: ${esc(tv(a.impact))}</p>
      ${Object.entries(sections).map(([k, title]) => (a[k]?.length ? `<b>${t(title)}</b><ul>${a[k].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "")).join("")}</div>` : ""}
  </div></div>`;
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
  const tbl = (rows, cols, heads) => `<table>${th(heads)}${rows.map((r) => `<tr>${cols.map((c) => `<td>${c === "priority" ? prio(r[c]) : ["status", "mode", "probability", "impact"].includes(c) ? esc(tv(r[c])) : esc(r[c])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan=${cols.length} class="muted">—</td></tr>`}</table>`;
  const kp = [["Novas demandas", k.new_inputs], ["Itens criados", k.items_created], ["Itens atualizados", k.items_updated], ["Em aberto", k.open_items], ["Alta prioridade", k.high_priority_open], ["Vencidos", k.overdue], ["Reuniões", k.meetings], ["Riscos abertos", k.open_risks], ["Projetos ativos", k.active_projects]];
  return `<div class="summary-doc"><h1>${esc(t(s.type))}</h1><p class="muted">${t("Período")} ${esc(s.period.start)}${s.period.end !== s.period.start ? " – " + esc(s.period.end) : ""} · ${t("gerado")} ${fmt(s.generated_at)}</p>
  <h2>1. ${t("Destaques")}</h2><div class="ai-box">${esc(narrative)}</div>
  <h2>2. ${t("Indicadores")}</h2><div class="kpis">${kp.map(([n, v]) => `<div class="kpi"><b>${v}</b><span>${t(n)}</span></div>`).join("")}</div>
  <h2>3. ${t("Novas demandas por origem")}</h2>${Object.entries(s.inputs_by_source).map(([src, l]) => `<h3>${esc(tv(src))} (${l.length})</h3>${tbl(l, ["id", "title", "status"], ["ID", "Demanda", "Status"])}`).join("") || `<p class="muted">${t("Nenhuma nova demanda.")}</p>`}
  <h2>4. ${t("Itens críticos (alta prioridade)")}</h2>${tbl(s.critical_items, ["id", "title", "owner", "due_date", "status"], ["ID", "Item", "Responsável", "Prazo", "Status"])}
  <h2>5. ${t("Prazos — vencidos e próximos 7 dias")}</h2>${tbl(s.due_items, ["id", "title", "owner", "due_date", "priority"], ["ID", "Item", "Responsável", "Prazo", "Prioridade"])}
  <h2>6. ${t("Projetos")}</h2>${tbl(s.projects, ["id", "name", "status", "open_actions", "last_monitored", "next_meeting"], ["ID", "Projeto", "Status", "Ações abertas", "Últ. monitoramento", "Próx. reunião"])}
  <h2>7. ${t("Riscos")}</h2>${tbl(s.risks, ["id", "title", "mode", "probability", "impact"], ["ID", "Risco", "Modo", "Prob.", "Impacto"])}
  <h2>8. ${t("Reuniões e decisões")}</h2>${s.meetings.map((m) => `<p><b>${esc(m.id)} — ${esc(m.title)}</b> (${esc(m.date)})</p><ul>${(m.decisions || []).map((d) => `<li>${esc(d)}</li>`).join("") || `<li class="muted">${t("Sem decisões registradas")}</li>`}</ul>`).join("") || `<p class="muted">${t("Nenhuma reunião no período.")}</p>`}
  <h2>9. ${t("Infos a reportar")}</h2>${tbl(s.report_items, ["id", "title", "owner", "status"], ["ID", "Item", "Responsável", "Status"])}
  <h2>10. ${t("Alertas")}</h2><ul>${s.alerts.map((a) => `<li>${esc(msg(a))}</li>`).join("") || '<li class="muted">—</li>'}</ul>
  <h2>11. ${t("Linha do tempo")}</h2><ul class="tl">${timeline(s.activity)}</ul></div>`;
}

// ------------------------------------------------------------------ config
function viewConfig() {
  const st = S.db.settings;
  return `<h1>${t("Configurações")}</h1>
  <div class="grid">
  <div class="card"><h2>${t("IA (Claude)")}</h2>
    <p class="muted">${t("Sem chave, a plataforma usa sugestões heurísticas locais. A chave fica guardada só neste navegador (não vai para a pasta).")}</p>
    ${L("Chave da API da Anthropic")}<input id="c-key" type="password" placeholder="sk-ant-..." value="${esc(AI.key)}">
    ${L("Modelo")}<input id="c-model" value="${esc(AI.model)}">
    <div class="actions"><button onclick="busy(this, saveAi)">${t("Salvar e testar")}</button>
      <span class="muted">${S.ai.enabled ? t("IA ativa —") + " " + esc(S.ai.model) : t("IA offline")}</span></div></div>
  <div class="card"><h2>${t("Pasta de trabalho")}</h2>
    <p>${t("Pasta atual:")} <code>${esc(S.workspace)}</code></p>
    <p class="muted">${t("FOLDER_HELP")}</p>
    <div class="actions"><button class="ghost" onclick="busy(this, changeFolder)">${t("Trocar de pasta")}</button></div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>${t("Regras")}</h2>
  <div class="row"><div>${L("Alerta: dias sem atualização")}<input type="number" id="c-days" value="${st.alert_days_without_update}"></div>
    <div>${L("Cadência de reunião de projeto (dias)")}<input type="number" id="c-cad" value="${st.project_meeting_cadence_days}"></div>
    <div>${L("Nº de vínculos para sugerir projeto")}<input type="number" id="c-links" value="${st.links_for_project_alert}"></div></div>
  ${L("Áreas (separadas por vírgula)")}<input id="c-areas" value="${esc((st.areas || []).join(", "))}">
  <div class="actions"><button onclick="busy(this, async()=>{await api('settings','PATCH',{alert_days_without_update:+$('#c-days').value,project_meeting_cadence_days:+$('#c-cad').value,links_for_project_alert:+$('#c-links').value,areas:$('#c-areas').value.split(',').map(s=>s.trim()).filter(Boolean)}); toast(t('Salvo')); await refresh();})">${t("Salvar")}</button></div></div>`;
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
  const ok = Store.supported();
  const fromZip = /\/(temp|tmp)\//i.test(decodeURI(location.href));
  $("#view").innerHTML = `<div class="card" style="max-width:640px;margin:40px auto">
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
