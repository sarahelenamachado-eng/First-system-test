/* Plataforma de Governança — front-end (sem build, JS puro). */
let S = null; // estado vindo de /api/state

const SOURCES = ["Diretora", "Reunião", "Departamento", "HQ", "Outro"];
const INPUT_KIND = ["Pedido pontual", "Direcionamento / estratégia (reclamação, opinião)", "Nova solicitação do HQ", "Decisão conjunta entre departamentos", "Atualização de item existente", "Outro"];
const STATUS_ITEM = ["Aberto", "Em andamento", "Aguardando", "Concluído"];

// ------------------------------------------------------------------ utilidades
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pill = (t, cls = "") => (t ? `<span class="pill ${esc(cls)}">${esc(t)}</span>` : "");
const prio = (p) => pill(p, "p-" + p);
const opts = (list, sel) => list.map((o) => `<option ${o === sel ? "selected" : ""}>${esc(o)}</option>`).join("");
const byId = (col, id) => (S.db[col] || []).find((r) => r.id === id);
const defLabel = (d) => S.definitions[d] || d;
const fmt = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) : "");

async function api(path, method = "GET", body) {
  const r = await fetch("/api/" + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 3500);
}
async function busy(btn, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "Processando…";
  try { await fn(); } catch (e) { toast("Erro: " + e.message); } finally { btn.disabled = false; btn.textContent = old; }
}
function openModal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); }
function fileToB64(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(",")[1]); fr.onerror = rej; fr.readAsDataURL(file); });
}
async function uploadFiles(path, input, extra = {}) {
  for (const f of input.files) await api(path, "POST", { filename: f.name, content_b64: await fileToB64(f), ...extra });
}
function linksHtml(rec) {
  const L = rec.links || {}, names = { items: "Itens", projects: "Projetos", risks: "Riscos", meetings: "Reuniões", inputs: "Entradas" };
  const views = { items: "lista", projects: "projetos", risks: "riscos", meetings: "reunioes", inputs: "entradas" };
  const parts = Object.entries(L).filter(([, v]) => v.length).map(([k, v]) =>
    `<b>${names[k] || k}:</b> ` + v.map((id) => `<a href="#${views[k]}/${id}" onclick="closeModal()">${esc(id)}</a>`).join(", "));
  return parts.join(" · ") || '<span class="muted">sem vínculos</span>';
}
function linkForm(col, id) {
  return `<div class="toolbar"><select id="lk-col"><option value="items">Item</option><option value="projects">Projeto</option><option value="risks">Risco</option><option value="meetings">Reunião</option></select>
    <input id="lk-id" placeholder="ID (ex.: GOV003)"><button class="ghost small" onclick="addLink('${col}','${id}')">Vincular</button></div>`;
}
async function addLink(col, id) {
  try { await api(`${col}/${id}/link`, "POST", { collection: $("#lk-col").value, id: $("#lk-id").value.trim().toUpperCase() }); toast("Vínculo criado"); await refresh(); }
  catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ roteamento
async function refresh() { S = await api("state"); render(); }
function render() {
  const [view, id] = (location.hash.slice(1) || "painel").split("/");
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + view));
  const b = $("#ai-badge");
  b.className = "badge" + (S.ai.enabled ? " on" : "");
  b.textContent = S.ai.enabled ? "IA: " + S.ai.model : "IA offline (heurística)";
  b.title = S.ai.detail || "";
  const V = { painel: viewPainel, entradas: viewEntradas, lista: viewLista, projetos: viewProjetos, reunioes: viewReunioes, riscos: viewRiscos, summaries: viewSummaries, config: viewConfig }[view] || viewPainel;
  $("#view").innerHTML = V(id);
  if (V === viewEntradas && id) openTriage(id);
  if (V === viewLista && id) openItem(id);
}
window.addEventListener("hashchange", render);

// ------------------------------------------------------------------ painel
function viewPainel() {
  const items = S.db.items, open = items.filter((i) => i.status !== "Concluído");
  const k = [
    ["Entradas pendentes", S.db.inputs.filter((i) => i.status !== "Registrado").length],
    ["Itens em aberto", open.length],
    ["Alta prioridade", open.filter((i) => i.priority === "Alta").length],
    ["Vencidos", open.filter((i) => i.due_date && i.due_date < S.today).length],
    ["Projetos ativos", S.db.projects.filter((p) => !["Concluído", "Cancelado"].includes(p.status)).length],
    ["Riscos abertos", S.db.risks.filter((r) => r.status !== "Fechado").length],
  ];
  return `<h1>Painel de governança</h1>
  <div class="kpis">${k.map(([n, v]) => `<div class="kpi"><b>${v}</b><span>${n}</span></div>`).join("")}</div>
  <div class="grid">
    <div class="card"><h2>Alertas</h2>${S.alerts.map((a) => `<div class="alert lv-${a.level}">${esc(a.text)}</div>`).join("") || '<p class="muted">Nenhum alerta.</p>'}</div>
    <div class="card"><h2>Atividade recente</h2><ul class="tl">${S.events.slice().reverse().slice(0, 15).map((e) => `<li><span class="muted">${fmt(e.ts)}</span> ${esc(e.text)}</li>`).join("") || '<li class="muted">Sem atividade.</li>'}</ul></div>
  </div>
  <div class="actions"><a class="btn" href="#entradas">+ Nova entrada</a><a class="btn ghost" href="#summaries">Gerar summary do dia</a></div>`;
}

// ------------------------------------------------------------------ entradas (demand management)
function viewEntradas() {
  const pend = S.db.inputs.slice().reverse();
  return `<h1>Inputs management</h1>
  <div class="steps"><span class="step on">1. Entrada da informação</span><span class="step">2. Assessment (relação + classificação)</span><span class="step">3. Definição</span><span class="step">4. Lista geral + módulos</span></div>
  <div class="grid" style="grid-template-columns: minmax(320px, 1.1fr) minmax(300px, 1fr)">
  <div class="card"><h2>Nova entrada</h2>${inputForm()}
    <div class="actions"><button onclick="busy(this, saveInput)">Registrar e avaliar com IA</button></div></div>
  <div class="card"><h2>Entradas</h2><table><tr><th>ID</th><th>Entrada</th><th>Origem</th><th>Status</th></tr>
    ${pend.map((i) => `<tr class="click" onclick="location.hash='entradas/${i.id}'"><td>${i.id}</td><td>${esc(i.title)}</td><td>${esc(i.source)}</td>
      <td>${pill(i.status, i.status === "Registrado" ? "p-Baixa" : "p-Média")} ${i.item_id ? pill(i.item_id) : ""}</td></tr>`).join("") || '<tr><td colspan=4 class="muted">Nenhuma entrada.</td></tr>'}
  </table></div></div>`;
}
function inputForm(pre = {}) {
  const meetings = S.db.meetings.slice().reverse();
  return `<div class="row"><div><label>Origem</label><select id="f-source">${opts(SOURCES, pre.source || "Diretora")}</select></div>
    <div><label>Tipo</label><select id="f-kind">${opts(INPUT_KIND, pre.kind)}</select></div></div>
  <label>Título / assunto</label><input id="f-title" value="${esc(pre.title)}">
  <label>Descrição do input</label><textarea id="f-desc">${esc(pre.description)}</textarea>
  <label>Background / contexto</label><textarea id="f-bg" style="min-height:60px">${esc(pre.background)}</textarea>
  <div class="row"><div><label>De onde a demanda veio (pessoa / fórum)</label><input id="f-origin" value="${esc(pre.origin)}"></div>
    <div><label>Reunião</label><select id="f-meeting"><option value="">—</option>${meetings.map((m) => `<option value="${m.id}" ${m.id === pre.meeting_id ? "selected" : ""}>${m.id} · ${esc(m.title)}</option>`).join("")}</select></div></div>
  <div class="row"><div><label>Área principal</label><input id="f-area" list="areas" value="${esc(pre.area_main)}"></div>
    <div><label>Áreas impactadas</label><input id="f-areas-imp" value="${esc(pre.areas_impacted)}"></div>
    <div><label>Áreas que impactam</label><input id="f-areas-by" value="${esc(pre.areas_impacting)}"></div></div>
  <datalist id="areas">${(S.db.settings.areas || []).map((a) => `<option>${esc(a)}</option>`).join("")}</datalist>
  <div class="row"><div><label>Responsável</label><input id="f-owner" value="${esc(pre.owner)}"></div><div><label>Prazo</label><input id="f-due" type="date" value="${esc(pre.due_date)}"></div></div>`;
}
function readInputForm() {
  return { source: $("#f-source").value, source_detail: $("#f-kind").value, title: $("#f-title").value.trim(), description: $("#f-desc").value,
    background: $("#f-bg").value, origin: $("#f-origin").value, meeting_id: $("#f-meeting").value, area_main: $("#f-area").value,
    areas_impacted: $("#f-areas-imp").value, areas_impacting: $("#f-areas-by").value, owner: $("#f-owner").value, due_date: $("#f-due").value };
}
async function saveInput() {
  const data = readInputForm();
  if (!data.title) throw new Error("Informe o título.");
  const rec = await api("inputs", "POST", data);
  await api(`inputs/${rec.id}/suggest`, "POST");
  await refresh();
  location.hash = "entradas/" + rec.id;
}

function openTriage(id) {
  const inp = byId("inputs", id);
  if (!inp) return;
  const sug = inp.ai_suggestion, fin = inp.assessment;
  const a = fin || sug || {};
  const defs = inp.definitions || a.definitions || [];
  const done = inp.status === "Registrado";
  const items = S.db.items, projects = S.db.projects;
  const relatedIds = (a.related || []).map((r) => r.id);
  openModal(`<h2>${inp.id} · ${esc(inp.title)}</h2>
  <p class="muted">${esc(inp.source)} · ${esc(inp.source_detail)} · ${fmt(inp.created_at)} ${inp.origin ? "· veio de " + esc(inp.origin) : ""}</p>
  <p>${esc(inp.description)}</p>${inp.background ? `<p class="muted"><b>Contexto:</b> ${esc(inp.background)}</p>` : ""}
  ${sug ? `<div class="ai-box"><b>Sugestão da IA</b> (${esc(sug.engine)}): ${esc(sug.rationale)}${sug.gap_analysis ? "\nGaps: " + esc(sug.gap_analysis) : ""}${sug.relation_explanation ? "\nRelação: " + esc(sug.relation_explanation) : ""}</div>`
        : `<div class="actions"><button onclick="busy(this, async()=>{await api('inputs/${id}/suggest','POST'); await refresh();})">Pedir sugestão da IA</button></div>`}
  <div class="steps"><span class="step on">2. Assessment</span></div>
  <h3>2.1 Tem relação com item já levantado?</h3>
  <div class="row"><div><label>Relação</label><select id="t-mode">
    <option value="novo" ${a.relation_mode !== "incluir_existente" ? "selected" : ""}>Não / relação só em impacto → criar item novo</option>
    <option value="incluir_existente" ${a.relation_mode === "incluir_existente" ? "selected" : ""}>Sim, relação direta → incluir no item on going</option></select></div>
    <div><label>Item on going (relação direta)</label><select id="t-include"><option value="">—</option>${items.map((i) => `<option value="${i.id}" ${i.id === a.include_in ? "selected" : ""}>${i.id} · ${esc(i.title)}</option>`).join("")}</select></div></div>
  <label>Itens relacionados (vincular)</label><div class="checks" style="max-height:140px;overflow:auto">${items.map((i) => `<label><input type="checkbox" class="t-rel" value="${i.id}" ${relatedIds.includes(i.id) ? "checked" : ""}> ${i.id} · ${esc(i.title)} ${(a.related || []).find((r) => r.id === i.id) ? `<span class="muted">(${esc((a.related.find((r) => r.id === i.id) || {}).relation)})</span>` : ""}</label>`).join("") || '<span class="muted">Lista geral vazia.</span>'}</div>
  <h3>2.2 Classificação</h3>
  <div class="row"><div><label>Escopo — o que é?</label><input id="t-scope" value="${esc(a.scope)}"></div><div><label>O que deve ser feito com isso?</label><input id="t-scope-act" value="${esc(a.scope_action)}"></div></div>
  <div class="row"><div><label>Prioridade</label><select id="t-prio">${opts(["Alta", "Média", "Baixa"], a.priority || "Média")}</select></div>
    <div><label>Urgência</label><select id="t-urg">${opts(["Alta", "Média", "Baixa"], a.urgency || "Média")}</select></div>
    <div><label>De onde a demanda veio</label><input id="t-origin" value="${esc(a.origin || inp.origin || inp.source)}"></div></div>
  <label>Riscos e urgência — explique o porquê</label><textarea id="t-risk" style="min-height:50px">${esc(a.risk_reason)}</textarea>
  <label>Impactos</label><div class="checks" style="display:flex;gap:16px;flex-wrap:wrap">${S.impact_types.map((t) => `<label><input type="checkbox" class="t-imp" value="${t}" ${(a.impacts || []).includes(t) ? "checked" : ""}> ${t}</label>`).join("")}</div>
  <label>Impactos em quais projetos / operações, por quê</label><textarea id="t-impd" style="min-height:50px">${esc(a.impact_details)}</textarea>
  <label>Gaps (por que não foi previsto antes?)</label><textarea id="t-gap" style="min-height:50px">${esc(a.gap_analysis)}</textarea>
  <div class="steps" style="margin-top:14px"><span class="step on">3. Definição (pode ser mais de uma)</span></div>
  <div class="checks">${Object.entries(S.definitions).map(([k, v]) => `<label><input type="checkbox" class="t-def" value="${k}" ${defs.includes(k) ? "checked" : ""}> ${v}</label>`).join("")}</div>
  <div class="row"><div><label>Projeto (para "Ação dentro de um projeto")</label><select id="t-proj"><option value="">—</option>${projects.map((p) => `<option value="${p.id}" ${p.id === a.project_id ? "selected" : ""}>${p.id} · ${esc(p.name)}</option>`).join("")}</select></div>
    <div><label>Nome do novo projeto (se "Criação de um novo projeto")</label><input id="t-newproj" value="${esc(inp.title)}"></div></div>
  <div class="actions">${done ? `<span class="pill p-Baixa">Registrado em ${inp.item_id}</span> <a class="btn ghost" href="#lista/${inp.item_id}">Abrir item</a>` : `<button onclick="busy(this, ()=>commitTriage('${id}'))">Confirmar e registrar na lista geral</button>`}
    <button class="ghost" onclick="if(confirm('Excluir entrada?')) api('inputs/${id}','DELETE').then(()=>{closeModal();location.hash='entradas';refresh();})">Excluir</button></div>
  <p class="muted">Ao confirmar, a IA guarda a sua decisão (vs. a sugestão) para aprender os critérios de classificação.</p>`);
}
async function commitTriage(id) {
  const vals = (cls) => [...document.querySelectorAll("." + cls)].filter((c) => c.checked).map((c) => c.value);
  const definitions = vals("t-def");
  if (!definitions.length) throw new Error("Escolha ao menos uma definição.");
  const body = {
    relation_mode: $("#t-mode").value, include_in: $("#t-include").value, related: vals("t-rel"), definitions,
    project_id: $("#t-proj").value, new_project_name: $("#t-newproj").value,
    assessment: { scope: $("#t-scope").value, scope_action: $("#t-scope-act").value, priority: $("#t-prio").value, urgency: $("#t-urg").value,
      origin: $("#t-origin").value, risk_reason: $("#t-risk").value, impacts: vals("t-imp"), impact_details: $("#t-impd").value, gap_analysis: $("#t-gap").value },
  };
  if (body.relation_mode === "incluir_existente" && !body.include_in) throw new Error("Selecione o item on going.");
  const r = await api(`inputs/${id}/commit`, "POST", body);
  const c = r.created;
  toast(`Registrado em ${c.item}` + (c.project ? ` · projeto ${c.project}` : "") + (c.risks ? ` · ${c.risks.join(", ")}` : "") + (c.action ? ` · ação ${c.action}` : ""));
  closeModal();
  location.hash = "lista";
  await refresh();
}

// ------------------------------------------------------------------ lista geral
let F = { q: "", status: "", prio: "", src: "", def: "" };
function viewLista() {
  const rows = S.db.items.filter((i) => (!F.status || i.status === F.status) && (!F.prio || i.priority === F.prio) && (!F.src || i.source === F.src)
    && (!F.def || (i.definitions || []).includes(F.def)) && (!F.q || JSON.stringify(i).toLowerCase().includes(F.q.toLowerCase()))).reverse();
  return `<h1>Lista geral de governança</h1>
  <div class="toolbar"><input placeholder="Buscar…" value="${esc(F.q)}" onchange="F.q=this.value;render()">
    <select onchange="F.status=this.value;render()"><option value="">Status</option>${opts(STATUS_ITEM, F.status)}</select>
    <select onchange="F.prio=this.value;render()"><option value="">Prioridade</option>${opts(["Alta", "Média", "Baixa"], F.prio)}</select>
    <select onchange="F.src=this.value;render()"><option value="">Origem</option>${opts(SOURCES, F.src)}</select>
    <select onchange="F.def=this.value;render()"><option value="">Definição</option>${Object.entries(S.definitions).map(([k, v]) => `<option value="${k}" ${F.def === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <a class="btn ghost" href="/api/export/items.csv">Baixar planilha (CSV)</a></div>
  <div class="card" style="overflow:auto"><table><tr><th>ID</th><th>Item</th><th>Origem</th><th>Responsável</th><th>Emitido</th><th>Prazo</th><th>Prioridade</th><th>Impactos</th><th>Definição</th><th>Vínculos</th><th>Status</th></tr>
  ${rows.map((i) => `<tr class="click" onclick="location.hash='lista/${i.id}'"><td>${i.id}</td><td>${esc(i.title)}</td><td>${esc(i.source)}</td><td>${esc(i.owner)}</td>
    <td>${esc(i.emitted_at || (i.created_at || "").slice(0, 10))}</td><td>${i.due_date && i.due_date < S.today && i.status !== "Concluído" ? pill(i.due_date, "p-Alta") : esc(i.due_date)}</td>
    <td>${prio(i.priority)}</td><td>${(i.impacts || []).map((x) => pill(x)).join("")}</td><td>${(i.definitions || []).map((d) => pill(defLabel(d))).join("")}</td>
    <td class="muted">${Object.entries(i.links || {}).filter(([, v]) => v.length).map(([k, v]) => v.length + " " + k).join(", ")}</td><td>${esc(i.status)}</td></tr>`).join("") || '<tr><td colspan=11 class="muted">Nenhum item.</td></tr>'}
  </table></div>`;
}
function openItem(id) {
  const i = byId("items", id);
  if (!i) return;
  openModal(`<h2>${i.id} · ${esc(i.title)}</h2>
  <p>${prio(i.priority)} ${pill("Urgência " + (i.urgency || "—"))} ${(i.impacts || []).map((x) => pill(x)).join("")} ${(i.definitions || []).map((d) => pill(defLabel(d))).join("")}</p>
  <p>${esc(i.description)}</p>
  <div class="row"><div><label>Escopo</label>${esc(i.scope)}<br><span class="muted">${esc(i.scope_action)}</span></div><div><label>Origem</label>${esc(i.source)} · ${esc(i.origin)}</div><div><label>Áreas</label>${esc(i.area_main)} ${i.areas_impacted ? "→ " + esc(i.areas_impacted) : ""}</div></div>
  ${i.risk_reason ? `<label>Riscos / urgência</label>${esc(i.risk_reason)}` : ""}${i.impact_details ? `<label>Impactos</label>${esc(i.impact_details)}` : ""}${i.gap_analysis ? `<label>Gaps</label>${esc(i.gap_analysis)}` : ""}
  <label>Vínculos</label><div>${linksHtml(i)}</div>${linkForm("items", i.id)}
  <div class="row"><div><label>Status</label><select id="i-status">${opts(STATUS_ITEM, i.status)}</select></div><div><label>Responsável</label><input id="i-owner" value="${esc(i.owner)}"></div>
    <div><label>Prazo</label><input type="date" id="i-due" value="${esc(i.due_date)}"></div><div><label>Prioridade</label><select id="i-prio">${opts(["Alta", "Média", "Baixa"], i.priority)}</select></div></div>
  <label>Registrar atualização</label><textarea id="i-note" style="min-height:50px" placeholder="O que aconteceu? (entra no histórico e no summary)"></textarea>
  <div class="checks"><label><input type="checkbox" id="i-report" ${i.report ? "checked" : ""}> Info a ser reportada (entra no summary)</label></div>
  <div class="actions"><button onclick="busy(this, ()=>saveItem('${i.id}'))">Salvar</button></div>
  <h3>Histórico</h3><ul class="tl">${(i.history || []).slice().reverse().map((h) => `<li><span class="muted">${fmt(h.date)}</span> ${esc(h.text)}</li>`).join("") || '<li class="muted">—</li>'}</ul>`);
}
async function saveItem(id) {
  await api("items/" + id, "PATCH", { status: $("#i-status").value, owner: $("#i-owner").value, due_date: $("#i-due").value, priority: $("#i-prio").value,
    report: $("#i-report").checked, _note: $("#i-note").value.trim() || undefined });
  toast("Item atualizado"); closeModal(); location.hash = "lista"; await refresh();
}

// ------------------------------------------------------------------ projetos
function viewProjetos(id) {
  if (id) return projectDetail(byId("projects", id));
  return `<h1>Gerenciamento de projetos</h1>
  <div class="grid" style="grid-template-columns: minmax(300px,2fr) minmax(280px,1fr)">
  <div class="card"><table><tr><th>ID</th><th>Projeto</th><th>Responsável</th><th>Ações abertas</th><th>Últ. monitoramento</th><th>Próx. reunião</th><th>Status</th></tr>
  ${S.db.projects.map((p) => `<tr class="click" onclick="location.hash='projetos/${p.id}'"><td>${p.id}</td><td>${esc(p.name)}</td><td>${esc(p.owner)}</td>
    <td>${(p.actions || []).filter((a) => a.status !== "Concluída").length}</td><td>${esc(p.last_monitored)}</td><td>${p.next_meeting <= S.today ? pill(p.next_meeting, "p-Alta") : esc(p.next_meeting)}</td><td>${esc(p.status)}</td></tr>`).join("") || '<tr><td colspan=7 class="muted">Nenhum projeto.</td></tr>'}
  </table></div>
  <div class="card"><h2>Novo projeto</h2><label>Nome</label><input id="p-name"><label>Descrição</label><textarea id="p-desc"></textarea><label>Responsável</label><input id="p-owner">
    <div class="actions"><button onclick="busy(this, async()=>{const r=await api('projects','POST',{name:$('#p-name').value,description:$('#p-desc').value,owner:$('#p-owner').value}); await refresh(); location.hash='projetos/'+r.id;})">Criar projeto e pasta local</button></div></div></div>`;
}
function projectDetail(p) {
  if (!p) return "<p>Projeto não encontrado.</p>";
  const items = S.db.items.filter((i) => (p.links.items || []).includes(i.id));
  return `<p><a href="#projetos">← Projetos</a></p><h1>${p.id} · ${esc(p.name)}</h1>
  <p class="muted">Pasta local: <code>${esc(S.workspace)}/${esc(p.folder)}</code></p>
  <div class="grid">
  <div class="card"><h2>Dados</h2><label>Descrição</label><textarea id="pd-desc">${esc(p.description)}</textarea>
    <div class="row"><div><label>Responsável</label><input id="pd-owner" value="${esc(p.owner)}"></div><div><label>Status</label><select id="pd-status">${opts(["Em andamento", "Em risco", "Pausado", "Concluído", "Cancelado"], p.status)}</select></div><div><label>Próxima reunião</label><input type="date" id="pd-next" value="${esc(p.next_meeting)}"></div></div>
    <label>Atualização / monitoramento</label><textarea id="pd-note" style="min-height:50px"></textarea>
    <div class="actions"><button onclick="busy(this, async()=>{await api('projects/${p.id}','PATCH',{description:$('#pd-desc').value,owner:$('#pd-owner').value,status:$('#pd-status').value,next_meeting:$('#pd-next').value,_note:$('#pd-note').value.trim()||undefined}); toast('Projeto atualizado'); await refresh();})">Salvar (marca monitoramento)</button>
    <a class="btn ghost" href="#reunioes" onclick="window._newMeetingProject='${p.id}'">Registrar reunião</a></div>
    <label>Vínculos</label><div>${linksHtml(p)}</div>${linkForm("projects", p.id)}</div>
  <div class="card"><h2>Master schedules</h2>
    <p class="muted">Os arquivos ficam na pasta local <code>master_schedule</code>. Você pode copiá-los direto para a pasta e clicar em "Sincronizar", ou fazer upload aqui. Formatos analisáveis: .xlsx, .csv, .pdf (MS Project: exporte para .xlsx/.pdf).</p>
    <div class="toolbar"><input type="file" id="pd-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('projects/${p.id}/upload', $('#pd-file')); await refresh();})">Upload</button><button class="ghost small" onclick="refresh()">Sincronizar pasta</button></div>
    <table><tr><th>Arquivo</th><th>Data</th><th></th></tr>${(p.schedules || []).map((s, k) => `<tr><td class="files"><a href="/files/${encodeURI(s.rel)}" target="_blank">${esc(s.name)}</a></td><td>${fmt(s.uploaded_at)}</td>
      <td><button class="small" onclick="busy(this, async()=>{await api('projects/${p.id}/analyze','POST',{rel:byId('projects','${p.id}').schedules[${k}].rel}); await refresh();})">Organizar com IA</button></td></tr>
      ${s.analysis ? `<tr><td colspan=3>${scheduleAnalysis(s.analysis)}</td></tr>` : ""}`).join("") || '<tr><td colspan=3 class="muted">Nenhum cronograma.</td></tr>'}</table></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Portfólio de ações</h2>
    <table><tr><th>ID</th><th>Ação</th><th>Item</th><th>Responsável</th><th>Prazo</th><th>Gap (por que não foi prevista)</th><th>Status</th></tr>
    ${(p.actions || []).map((a) => `<tr><td>${a.id}</td><td>${esc(a.text)}</td><td>${a.item_id ? `<a href="#lista/${a.item_id}">${a.item_id}</a>` : ""}</td><td>${esc(a.owner)}</td><td>${esc(a.due)}</td><td>${esc(a.gap_reason)}</td>
      <td><select onchange="api('projects/${p.id}/actions','POST',{id:'${a.id}',status:this.value}).then(refresh)">${opts(["Aberta", "Em andamento", "Concluída"], a.status)}</select></td></tr>`).join("") || '<tr><td colspan=7 class="muted">Sem ações.</td></tr>'}</table>
    <div class="row"><div><label>Nova ação</label><input id="pa-text"></div><div><label>Responsável</label><input id="pa-owner"></div><div><label>Prazo</label><input type="date" id="pa-due"></div><div><label>Gap</label><input id="pa-gap"></div></div>
    <div class="actions"><button class="small" onclick="busy(this, async()=>{await api('projects/${p.id}/actions','POST',{text:$('#pa-text').value,owner:$('#pa-owner').value,due:$('#pa-due').value,gap_reason:$('#pa-gap').value}); await refresh();})">Adicionar ação</button></div>
    <h3>Itens da lista geral vinculados</h3>${items.map((i) => `<div><a href="#lista/${i.id}">${i.id}</a> ${esc(i.title)} ${prio(i.priority)} <span class="muted">${esc(i.status)}</span></div>`).join("") || '<p class="muted">—</p>'}
    <h3>Histórico</h3><ul class="tl">${(p.history || []).slice().reverse().map((h) => `<li><span class="muted">${fmt(h.date)}</span> ${esc(h.text)}</li>`).join("") || '<li class="muted">—</li>'}</ul></div>`;
}
function scheduleAnalysis(a) {
  const list = (arr) => (arr || []).map((t) => `<li>${esc(typeof t === "string" ? t : `${t.task || t.name} — ${t.finish || ""} ${t.progress != null ? "(" + t.progress + "%)" : ""} ${t.status || ""}`)}</li>`).join("");
  return `<div class="ai-box" style="white-space:normal"><b>Análise (${esc(a.engine)})</b><p>${esc(a.overview)}</p>
    ${a.phases?.length ? `<b>Fases / marcos</b><ul>${list(a.phases)}</ul>` : ""}${a.late?.length ? `<b>Atrasadas</b><ul>${list(a.late)}</ul>` : ""}
    ${a.upcoming?.length ? `<b>Próximas entregas</b><ul>${list(a.upcoming)}</ul>` : ""}${a.critical_points?.length ? `<b>Pontos críticos</b><ul>${list(a.critical_points)}</ul>` : ""}
    ${a.suggested_actions?.length ? `<b>Ações sugeridas</b><ul>${list(a.suggested_actions)}</ul>` : ""}</div>`;
}

// ------------------------------------------------------------------ reuniões
function viewReunioes(id) {
  if (id) return meetingDetail(byId("meetings", id));
  const pre = window._newMeetingProject || ""; window._newMeetingProject = "";
  return `<h1>Gerenciamento de reuniões</h1>
  <div class="grid" style="grid-template-columns: minmax(300px,1fr) minmax(300px,1.3fr)">
  <div class="card"><table><tr><th>ID</th><th>Reunião</th><th>Data</th><th>Itens</th></tr>
  ${S.db.meetings.slice().reverse().map((m) => `<tr class="click" onclick="location.hash='reunioes/${m.id}'"><td>${m.id}</td><td>${esc(m.title)}</td><td>${esc(m.date)}</td><td>${(m.links.items || []).length + (m.links.inputs || []).length}</td></tr>`).join("") || '<tr><td colspan=4 class="muted">Nenhuma reunião.</td></tr>'}
  </table></div>
  <div class="card"><h2>Nova ata / anotação</h2>
    <div class="row"><div><label>Título</label><input id="m-title"></div><div><label>Data</label><input type="date" id="m-date" value="${S.today}"></div></div>
    <div class="row"><div><label>Participantes</label><input id="m-part"></div><div><label>Departamentos</label><input id="m-dept"></div>
      <div><label>Projeto (acompanhamento)</label><select id="m-proj"><option value="">—</option>${S.db.projects.map((p) => `<option value="${p.id}" ${p.id === pre ? "selected" : ""}>${p.id} · ${esc(p.name)}</option>`).join("")}</select></div></div>
    <label>Ata</label><textarea id="m-min" style="min-height:140px" placeholder="Cole a ata. Dica: linhas como 'Ação: ... resp: Nome 2026-10-20' e 'Decisão: ...' ajudam a extração."></textarea>
    <label>Anotações pessoais</label><textarea id="m-notes"></textarea>
    <div class="actions"><button onclick="busy(this, saveMeeting)">Salvar e extrair demandas com IA</button></div></div></div>`;
}
async function saveMeeting() {
  const r = await api("meetings", "POST", { title: $("#m-title").value || "Reunião", date: $("#m-date").value, participants: $("#m-part").value,
    departments: $("#m-dept").value, project_id: $("#m-proj").value, minutes: $("#m-min").value, notes: $("#m-notes").value });
  await api(`meetings/${r.id}/extract`, "POST");
  await refresh(); location.hash = "reunioes/" + r.id;
}
function meetingDetail(m) {
  if (!m) return "<p>Reunião não encontrada.</p>";
  const ex = m.extraction;
  window._demands = ex?.demands || [];
  return `<p><a href="#reunioes">← Reuniões</a></p><h1>${m.id} · ${esc(m.title)}</h1><p class="muted">${esc(m.date)} · ${esc(m.participants)} ${m.departments ? "· " + esc(m.departments) : ""}</p>
  <div class="grid">
  <div class="card"><h2>Ata</h2><textarea id="md-min" style="min-height:200px">${esc(m.minutes)}</textarea><label>Anotações</label><textarea id="md-notes">${esc(m.notes)}</textarea>
    <div class="actions"><button onclick="busy(this, async()=>{await api('meetings/${m.id}','PATCH',{minutes:$('#md-min').value,notes:$('#md-notes').value}); await api('meetings/${m.id}/extract','POST'); await refresh();})">Salvar e reprocessar</button></div>
    <label>Anexos</label><div class="toolbar"><input type="file" id="md-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('meetings/${m.id}/upload', $('#md-file')); toast('Anexado'); await refresh();})">Upload</button></div>
    <label>Vínculos</label><div>${linksHtml(m)}</div></div>
  <div class="card"><h2>Extração (${esc(ex?.engine || "—")})</h2>${ex?.hint ? `<p class="muted">${esc(ex.hint)}</p>` : ""}
    ${ex?.summary ? `<div class="ai-box">${esc(ex.summary)}</div>` : ""}
    <h3>Decisões</h3><ul>${(m.decisions || []).map((d) => `<li>${esc(d)}</li>`).join("") || '<li class="muted">—</li>'}</ul>
    <h3>Demandas identificadas → Inputs management</h3>
    ${(ex?.demands || []).map((d, k) => `<div class="alert" style="border:1px solid var(--line)"><b>${esc(d.title)}</b> ${d.related_item ? pill("rel. " + d.related_item) : ""}<br><span class="muted">${esc(d.owner)} ${esc(d.due_date)}</span> ${esc(d.description)}
      <div class="actions" style="margin-top:6px"><button class="small" onclick="busy(this, ()=>demandToInput('${m.id}', ${k}))">Enviar para entradas</button></div></div>`).join("") || '<p class="muted">Nenhuma demanda extraída.</p>'}
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
  return `<h1>Gerenciamento de riscos</h1>
  <div class="grid" style="grid-template-columns: minmax(300px,2fr) minmax(260px,1fr)">
  <div class="card"><table><tr><th>ID</th><th>Risco</th><th>Modo</th><th>Prob.</th><th>Impacto</th><th>Responsável</th><th>Status</th></tr>
  ${S.db.risks.map((r) => `<tr class="click" onclick="location.hash='riscos/${r.id}'"><td>${r.id}</td><td>${esc(r.title)}</td><td>${esc(r.mode)}</td><td>${prio(r.probability)}</td><td>${pill(r.impact, "p-" + r.impact)}</td><td>${esc(r.owner)}</td><td>${esc(r.status)}</td></tr>`).join("") || '<tr><td colspan=7 class="muted">Nenhum risco.</td></tr>'}
  </table></div>
  <div class="card"><h2>Novo risco</h2><p class="muted">Normalmente nasce pela definição de uma entrada; aqui é o cadastro direto.</p><label>Título</label><input id="r-title"><label>Descrição</label><textarea id="r-desc"></textarea>
    <div class="row"><div><label>Modo</label><select id="r-mode">${opts(["Monitorar", "Investigar"])}</select></div><div><label>Responsável</label><input id="r-owner"></div></div>
    <div class="actions"><button onclick="busy(this, async()=>{const r=await api('risks','POST',{title:$('#r-title').value,description:$('#r-desc').value,mode:$('#r-mode').value,owner:$('#r-owner').value}); await refresh(); location.hash='riscos/'+r.id;})">Criar risco e pasta</button></div></div></div>`;
}
function riskDetail(r) {
  if (!r) return "<p>Risco não encontrado.</p>";
  const a = r.analysis;
  setTimeout(() => api(`risks/${r.id}/files`).then((fs) => { const el = $("#rk-files"); if (el) el.innerHTML = fs.map((f) => `<li><a href="/files/${encodeURI(f.rel)}" target="_blank">${esc(f.name)}</a> <span class="muted">${fmt(f.modified)}</span></li>`).join("") || "<li class='muted'>Pasta vazia</li>"; }), 0);
  return `<p><a href="#riscos">← Riscos</a></p><h1>${r.id} · ${esc(r.title)}</h1><p class="muted">Pasta: <code>${esc(S.workspace)}/${esc(r.folder)}</code></p>
  <div class="grid"><div class="card">
    <div class="row"><div><label>Modo</label><select id="rd-mode">${opts(["Monitorar", "Investigar"], r.mode)}</select></div><div><label>Probabilidade</label><select id="rd-prob">${opts(["Alta", "Média", "Baixa"], r.probability)}</select></div>
      <div><label>Impacto</label><select id="rd-imp">${opts(["Alto", "Médio", "Baixo"], r.impact)}</select></div><div><label>Status</label><select id="rd-status">${opts(["Aberto", "Em tratamento", "Fechado"], r.status)}</select></div></div>
    <label>Descrição</label><textarea id="rd-desc">${esc(r.description)}</textarea><label>Notas / informações</label><textarea id="rd-notes">${esc(r.notes)}</textarea>
    <div class="actions"><button onclick="busy(this, async()=>{await api('risks/${r.id}','PATCH',{mode:$('#rd-mode').value,probability:$('#rd-prob').value,impact:$('#rd-imp').value,status:$('#rd-status').value,description:$('#rd-desc').value,notes:$('#rd-notes').value}); toast('Risco atualizado'); await refresh();})">Salvar</button></div>
    <label>Vínculos</label><div>${linksHtml(r)}</div>${linkForm("risks", r.id)}</div>
  <div class="card"><h2>Documentos da pasta</h2><div class="toolbar"><input type="file" id="rd-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('risks/${r.id}/upload', $('#rd-file')); await refresh();})">Upload</button></div>
    <ul id="rk-files" class="files"><li class="muted">carregando…</li></ul>
    <div class="actions"><button onclick="busy(this, async()=>{await api('risks/${r.id}/analyze','POST'); await refresh();})">Compilar e analisar com IA</button></div>
    ${a ? `<div class="ai-box" style="white-space:normal"><b>Análise (${esc(a.engine)}) — confirme antes de reportar</b><p>${esc(a.summary)}</p><p>Probabilidade: ${esc(a.probability)} · Impacto: ${esc(a.impact)}</p>
      ${["causes", "consequences", "mitigations", "report_points"].map((k) => a[k]?.length ? `<b>${{ causes: "Causas", consequences: "Consequências", mitigations: "Mitigações", report_points: "Pontos para reporte" }[k]}</b><ul>${a[k].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "").join("")}</div>` : ""}
  </div></div>`;
}

// ------------------------------------------------------------------ summaries
let LAST_SUMMARY = null;
function viewSummaries() {
  return `<h1>Summaries</h1>
  <div class="toolbar no-print"><select id="s-type"><option value="daily">Diário</option><option value="weekly">Semanal</option></select><input type="date" id="s-date" value="${S.today}">
    <button onclick="busy(this, genSummary)">Gerar summary</button><button class="ghost" onclick="window.print()">Imprimir / PDF</button></div>
  <div id="s-out">${LAST_SUMMARY ? summaryDoc(LAST_SUMMARY) : '<p class="muted">Escolha o tipo e a data. O summary também é salvo como HTML na pasta local SUMMARIES.</p>'}</div>
  <div class="card no-print" style="margin-top:14px"><h2>Gerados anteriormente</h2><ul>${S.summaries.slice().reverse().map((s) => `<li><a href="/files/${encodeURI(s.file)}" target="_blank">${esc(s.file)}</a> <span class="muted">${fmt(s.generated_at)}</span></li>`).join("") || '<li class="muted">—</li>'}</ul></div>`;
}
async function genSummary() {
  LAST_SUMMARY = await api("summary", "POST", { type: $("#s-type").value, date: $("#s-date").value });
  await refresh();
}
function summaryDoc({ summary: s, narrative }) {
  const k = s.kpis;
  const tbl = (rows, cols, heads) => `<table><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${cols.map((c) => `<td>${c === "priority" ? prio(r[c]) : esc(r[c])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan=${cols.length} class="muted">—</td></tr>`}</table>`;
  return `<div class="summary-doc"><h1>${esc(s.type)}</h1><p class="muted">Período ${esc(s.period.start)}${s.period.end !== s.period.start ? " a " + esc(s.period.end) : ""} · gerado ${fmt(s.generated_at)}</p>
  <h2>1. Destaques</h2><div class="ai-box">${esc(narrative)}</div>
  <h2>2. Indicadores</h2><div class="kpis">${[["Novas demandas", k.new_inputs], ["Itens criados", k.items_created], ["Itens atualizados", k.items_updated], ["Em aberto", k.open_items], ["Alta prioridade", k.high_priority_open], ["Vencidos", k.overdue], ["Reuniões", k.meetings], ["Riscos abertos", k.open_risks], ["Projetos ativos", k.active_projects]].map(([n, v]) => `<div class="kpi"><b>${v}</b><span>${n}</span></div>`).join("")}</div>
  <h2>3. Novas demandas por origem</h2>${Object.entries(s.inputs_by_source).map(([src, l]) => `<h3>${esc(src)} (${l.length})</h3>${tbl(l, ["id", "title", "status"], ["ID", "Demanda", "Status"])}`).join("") || '<p class="muted">Nenhuma nova demanda.</p>'}
  <h2>4. Itens críticos (alta prioridade)</h2>${tbl(s.critical_items, ["id", "title", "owner", "due_date", "status"], ["ID", "Item", "Responsável", "Prazo", "Status"])}
  <h2>5. Prazos — vencidos e próximos 7 dias</h2>${tbl(s.due_items, ["id", "title", "owner", "due_date", "priority"], ["ID", "Item", "Responsável", "Prazo", "Prioridade"])}
  <h2>6. Projetos</h2>${tbl(s.projects, ["id", "name", "status", "open_actions", "last_monitored", "next_meeting"], ["ID", "Projeto", "Status", "Ações abertas", "Últ. monitoramento", "Próx. reunião"])}
  <h2>7. Riscos</h2>${tbl(s.risks, ["id", "title", "mode", "probability", "impact"], ["ID", "Risco", "Modo", "Prob.", "Impacto"])}
  <h2>8. Reuniões e decisões</h2>${s.meetings.map((m) => `<p><b>${esc(m.id)} — ${esc(m.title)}</b> (${esc(m.date)})</p><ul>${(m.decisions || []).map((d) => `<li>${esc(d)}</li>`).join("") || '<li class="muted">Sem decisões registradas</li>'}</ul>`).join("") || '<p class="muted">Nenhuma reunião no período.</p>'}
  <h2>9. Infos a reportar</h2>${tbl(s.report_items, ["id", "title", "owner", "status"], ["ID", "Item", "Responsável", "Status"])}
  <h2>10. Alertas</h2><ul>${s.alerts.map((a) => `<li>${esc(a.text)}</li>`).join("") || '<li class="muted">—</li>'}</ul>
  <h2>11. Linha do tempo</h2><ul class="tl">${s.activity.map((e) => `<li><span class="muted">${fmt(e.ts)}</span> ${esc(e.text)}</li>`).join("") || '<li class="muted">—</li>'}</ul></div>`;
}

// ------------------------------------------------------------------ config
function viewConfig() {
  const st = S.db.settings;
  return `<h1>Configurações</h1><div class="card">
  <p>Pasta local de trabalho: <code>${esc(S.workspace)}</code></p>
  <p>IA: ${S.ai.enabled ? "ativa — " + esc(S.ai.model) : "offline — " + esc(S.ai.detail)}</p>
  <div class="row"><div><label>Alerta: dias sem atualização</label><input type="number" id="c-days" value="${st.alert_days_without_update}"></div>
    <div><label>Cadência de reunião de projeto (dias)</label><input type="number" id="c-cad" value="${st.project_meeting_cadence_days}"></div>
    <div><label>Nº de vínculos para sugerir projeto</label><input type="number" id="c-links" value="${st.links_for_project_alert}"></div></div>
  <label>Áreas (separadas por vírgula)</label><input id="c-areas" value="${esc((st.areas || []).join(", "))}">
  <div class="actions"><button onclick="busy(this, async()=>{await api('settings','PATCH',{alert_days_without_update:+$('#c-days').value,project_meeting_cadence_days:+$('#c-cad').value,links_for_project_alert:+$('#c-links').value,areas:$('#c-areas').value.split(',').map(s=>s.trim()).filter(Boolean)}); toast('Salvo'); await refresh();})">Salvar</button></div></div>`;
}

refresh().catch((e) => { $("#view").innerHTML = `<p>Não foi possível carregar: ${esc(e.message)}</p>`; });
