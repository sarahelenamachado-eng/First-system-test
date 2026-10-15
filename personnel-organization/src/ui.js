/* Interface (JS puro, sem build). Rotas por hash: #painel, #tarefas, #registros, #sumario, #config. */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pill = (txt, cls = "") => (txt ? `<span class="pill ${esc(cls)}">${esc(txt)}</span>` : "");
const prio = (p) => pill(p, "p-" + p);
const opts = (list, sel, labels = {}) => list.map((o) => `<option value="${esc(o)}" ${o === sel ? "selected" : ""}>${esc(labels[o] || o)}</option>`).join("");
const statusPill = (s) => pill(s, { Feita: "p-Baixa", "Em andamento": "p-Média", Cancelada: "" }[s] || "");
const kpi = (n, label, href = "", small = "") => `<${href ? `a href="${href}"` : "div"} class="kpi"><b>${n}</b><span>${esc(label)}</span>${small ? `<small>${esc(small)}</small>` : ""}</${href ? "a" : "div"}>`;
const areas = () => Core.db.settings.areas;

function toast(text) {
  const el = $("#toast"); el.textContent = text; el.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add("hidden"), 3500);
}
async function busy(btn, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "Processando…";
  try { await fn(); } catch (e) { toast("Erro: " + e.message); } finally { btn.disabled = false; btn.textContent = old; }
}
function openModal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); }
async function save(msg) { await Core.save(); if (msg) toast(msg); render(); }
function badge() {
  const b = $("#ai-badge");
  b.className = "badge" + (AI.enabled() ? " on" : "");
  b.textContent = AI.enabled() ? `IA ativa (${AI.model})` : "Modo sem IA (heurístico)";
  $("#where").textContent = Store.mode ? (Store.mode === "pasta" ? `📁 ${Store.name}` : "💾 dados neste navegador") : "";
}
function download(name, text, type = "text/html") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------------ início
async function boot() {
  await AI.init();
  const mode = await Store.rememberedMode(), h = await Store.remembered();
  if (mode === "navegador") { await Store.useBrowser(); return start(); }
  if (mode === "pasta" && h && (await Store.hasPermission(h).catch(() => false))) { await Store.use(h); return start(); }
  welcome(mode === "pasta" ? h : null);
}
function welcome(h) {
  $("#nav").classList.add("hidden");
  $("#view").innerHTML = `<div class="card welcome">
    <h1>Personnel Organization <span class="ai-tag">IA</span></h1>
    <p>Escreva o seu dia, um ponto por linha. O assistente organiza o que você fez, o que faltou, as tarefas novas,
    o que aprendeu e onde errou — e monta o sumário diário.</p>
    <h2>Onde guardar os seus dados?</h2>
    <div class="actions">
      ${h ? `<button id="b-cont" onclick="pickAgain()">Continuar com a pasta “${esc(h.name)}”</button>` : ""}
      ${Store.supported() ? `<button class="${h ? "ghost" : ""}" id="b-pick" onclick="pickFolder()">Escolher pasta de trabalho</button>` : ""}
      <button class="ghost" id="b-browser" onclick="useBrowser()">Usar só neste navegador</button>
    </div>
    <p class="muted small">Pasta: os dados ficam num <code>db.json</code> na pasta escolhida (pode ser do OneDrive/Google Drive, para ter backup) e os sumários em <code>SUMARIOS/</code>.
    Só funciona no Edge ou Chrome.<br>Navegador: funciona em qualquer navegador, mas os dados ficam só aqui — faça backup em Config.</p>
  </div>`;
}
async function pickAgain() {
  const h = await Store.remembered();
  if (h && (await Store.requestPermission(h))) { await Store.use(h); start(); } else toast("Permissão negada. Escolha a pasta de novo.");
}
async function pickFolder() {
  try { await Store.pick(); start(); } catch (e) { if (e.name !== "AbortError") toast("Erro: " + e.message); }
}
async function useBrowser() { await Store.useBrowser(); start(); }
async function start() {
  Core.load(await Store.loadDB());
  await Core.save();
  $("#nav").classList.remove("hidden");
  if (!location.hash) location.hash = "#painel";
  render();
}

// ------------------------------------------------------------------ roteamento
let draft = { text: "", date: "", proposals: null, engine: "", error: "" };
let sumDate = "";
window.addEventListener("hashchange", () => render());
function render() {
  if (!Core.db) return;
  badge();
  // não perder o que já foi digitado no registro rápido quando a tela é redesenhada
  if ($("#cap-text")) { draft.text = $("#cap-text").value; draft.date = $("#cap-date").value; }
  const [route, arg] = (location.hash.slice(1) || "painel").split("/");
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + route));
  const v = { painel: viewPainel, tarefas: viewTarefas, registros: viewRegistros, sumario: viewSumario, config: viewConfig }[route] || viewPainel;
  $("#view").innerHTML = v(arg);
}

// ------------------------------------------------------------------ painel (assistente)
function viewPainel() {
  const today = todayISO(), d = Core.dayData(today), date = draft.date || today;
  const forToday = Core.openTasks().filter((t) => t.due && t.due <= today).sort((a, b) => a.due.localeCompare(b.due) || LEVELS.indexOf(a.priority) - LEVELS.indexOf(b.priority));
  const st = Core.assistStats();
  return `<h1>Olá! Como foi o seu dia?</h1>
  <div class="kpis">
    ${kpi(d.done.length, "coisas feitas hoje", "#sumario")}
    ${kpi(d.missed.length, "faltam para hoje", "#tarefas", d.planned.length ? `de ${d.planned.length} planejadas` : "")}
    ${kpi(d.pending.length, "tarefas em aberto", "#tarefas")}
    ${kpi(d.learned.length, "aprendizados hoje", "#registros")}
    ${kpi(d.mistakes.length, "erros hoje", "#registros")}
  </div>
  <div class="grid two">
  <div class="card assist-card">
    <h2>✨ Registro rápido do dia</h2>
    <p class="muted small">Um ponto por linha. Exemplos: “Fui à academia”, “Não fiz o relatório”, “Preciso pagar o boleto amanhã”,
    “Aprendi que…”, “Errei ao… — da próxima vez…”. Use também <code>[x]</code> para feito e <code>[ ]</code> para tarefa.</p>
    <div class="row"><div><label>Dia</label><input type="date" id="cap-date" value="${esc(date)}"></div></div>
    <label>Anotações</label>
    <textarea id="cap-text" rows="8" placeholder="Fui à academia&#10;Estudei 2h para a prova&#10;Não fiz o relatório&#10;Preciso pagar o boleto amanhã&#10;Aprendi que revisar de manhã rende mais&#10;Errei ao deixar tudo para a noite — da próxima vez começar cedo">${esc(draft.text)}</textarea>
    <div class="actions"><button id="b-capture" onclick="busy(this, capture)">Organizar com ${AI.enabled() ? "IA" : "o assistente"}</button>
      <span class="muted small">Taxa de acerto do assistente: ${st.n ? `${st.pct}% nas últimas ${st.n} propostas` : "ainda sem histórico"}.</span></div>
    ${draft.proposals ? proposalsTable() : ""}
  </div>
  <div class="card">
    <h2>📌 Para hoje</h2>
    ${forToday.length ? `<table class="todo-t">${forToday.map((t) => `<tr class="${t.due < today ? "overdue" : ""}">
      <td style="width:28px"><input type="checkbox" title="Marcar como feita" onchange="doneTask('${t.id}')"></td>
      <td>${esc(t.title)}<div class="muted small">${esc(t.area)} · ${t.due < today ? `<span class="late-txt">atrasada desde ${fmtDate(t.due)}</span>` : "hoje"}</div></td>
      <td class="nowrap">${prio(t.priority)}</td></tr>`).join("")}</table>` : '<p class="muted">Nada com prazo para hoje. 🎉</p>'}
    <div class="actions"><button class="ghost small" onclick="taskForm()">+ Nova tarefa</button>
      ${d.missed.length ? `<button class="ghost small" onclick="rollOver()">Passar o que faltou para amanhã</button>` : ""}
      <a class="btn small" href="#sumario">Ver sumário do dia</a></div>
  </div>
  </div>`;
}
async function capture() {
  draft.text = $("#cap-text").value; draft.date = $("#cap-date").value || todayISO();
  if (!draft.text.trim()) return toast("Escreva pelo menos uma linha.");
  const r = await AI.capture(Core.db, draft.text, draft.date);
  Object.assign(draft, { proposals: r.proposals, engine: r.engine, error: r.error || "" });
  if (Core.db.settings.auto_apply && !r.error && Core.assistStats().pct >= 90 && Core.assistStats().n >= 20) return applyAll(true);
  render();
}
function proposalsTable() {
  const tasks = Core.openTasks();
  const taskOpts = (sel) => `<option value="">— nenhuma —</option>` + tasks.map((t) => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.id + " · " + t.title.slice(0, 50))}</option>`).join("");
  return `<h3>Confira e corrija antes de registrar</h3>
  <p class="muted small">${draft.engine === "heuristica" ? "Sugestões do modo heurístico (sem IA)" : `Sugestões da IA (${esc(draft.engine)})`}${draft.error ? ` — a IA falhou (${esc(draft.error)}), usei o modo heurístico.` : "."}
  Cada correção ensina o assistente.</p>
  <table class="props-t"><tr><th>Anotação</th><th>Registrar como</th><th>Detalhes</th></tr>
  ${draft.proposals.map((p, i) => `<tr data-i="${i}">
    <td style="width:34%">${esc(p.text)}<div class="muted small">${esc(p.reason || "")}</div></td>
    <td style="width:24%"><select class="p-kind" onchange="propEdit(${i}, 'kind', this.value)">${opts(KINDS, p.kind, KIND_LABEL)}</select>
      ${["done", "missed", "progress", "todo", "mistake"].includes(p.kind) ? `<select class="p-target" title="Tarefa ligada" onchange="propEdit(${i}, 'target', this.value)">${taskOpts(p.target)}</select>` : ""}</td>
    <td>${p.kind === "ignore" ? "" : `<input class="p-title" value="${esc(p.title)}" onchange="propEdit(${i}, 'title', this.value)">
      <div class="row tight">
        <select onchange="propEdit(${i}, 'area', this.value)">${opts(areas(), p.area)}</select>
        ${["todo", "missed", "progress"].includes(p.kind) && !p.target ? `<select onchange="propEdit(${i}, 'priority', this.value)">${opts(LEVELS, p.priority)}</select>` : ""}
        ${p.kind === "todo" || (p.kind === "progress" && !p.target) ? `<input type="date" value="${esc(p.due)}" title="Prazo" onchange="propEdit(${i}, 'due', this.value)">` : ""}
      </div>
      ${p.kind === "mistake" ? `<input placeholder="Da próxima vez…" value="${esc(p.lesson)}" onchange="propEdit(${i}, 'lesson', this.value)">` : ""}`}</td>
  </tr>`).join("")}</table>
  <div class="actions"><button id="b-apply" onclick="applyAll()">Confirmar e registrar</button><button class="ghost" onclick="draft.proposals = null; render()">Descartar</button></div>`;
}
function propEdit(i, k, v) {
  draft.proposals[i][k] = v;
  if (k === "kind" || k === "target") { draft.text = $("#cap-text").value; render(); }
}
async function applyAll(auto = false) {
  const n = Core.applyProposals(draft.proposals, draft.date || todayISO(), { auto }).filter((r) => r.kind !== "ignore").length;
  draft = { text: "", date: "", proposals: null, engine: "", error: "" };
  $("#cap-text").value = "";
  await save(`${n} ${n === 1 ? "registro feito" : "registros feitos"}${auto ? " automaticamente" : ""}.`);
}
async function doneTask(id) { Core.completeTask(id, todayISO()); await save("Tarefa feita! ✅"); }
async function rollOver() { const n = Core.rollOver(todayISO()); await save(`${n} ${n === 1 ? "tarefa passada" : "tarefas passadas"} para amanhã (continuam contando como "faltou" hoje).`); }

// ------------------------------------------------------------------ tarefas (itens pessoais)
let tf = { status: "abertas", area: "", q: "" };
function viewTarefas() {
  const today = todayISO();
  let list = Core.db.tasks.filter((t) => (tf.status === "abertas" ? Core.isOpen(t) : tf.status === "todas" ? true : t.status === tf.status)
    && (!tf.area || t.area === tf.area) && (!tf.q || AI.norm(t.title).includes(AI.norm(tf.q))));
  list = list.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || LEVELS.indexOf(a.priority) - LEVELS.indexOf(b.priority));
  const byArea = areas().map((a) => [a, Core.openTasks().filter((t) => t.area === a).length]).filter(([, n]) => n);
  return `<div class="title-row"><h1>Minhas tarefas</h1><button onclick="taskForm()">+ Nova tarefa</button></div>
  ${byArea.length ? `<div class="chips">${byArea.map(([a, n]) => `<button class="chip ${tf.area === a ? "on" : ""}" onclick="toggleArea(${areas().indexOf(a)})">${esc(a)} · ${n}</button>`).join("")}</div>` : ""}
  <div class="toolbar">
    <select onchange="tf.status = this.value; render()">${opts(["abertas", ...TASK_STATUS, "todas"], tf.status, { abertas: "Em aberto", todas: "Todas" })}</select>
    <input placeholder="Buscar…" value="${esc(tf.q)}" onchange="tf.q = this.value; render()">
  </div>
  <div class="card"><table>
    <tr><th>ID</th><th>Tarefa</th><th>Área</th><th>Prioridade</th><th>Prazo</th><th>Status</th><th></th></tr>
    ${list.map((t) => `<tr class="click ${Core.isOpen(t) && t.due && t.due < today ? "overdue" : ""} ${t.status === "Feita" ? "done" : ""}" onclick="taskForm('${t.id}')">
      <td class="nowrap">${t.id}</td><td>${esc(t.title)}${t.missed.length ? `<div class="muted small">faltou ${t.missed.length}× </div>` : ""}</td><td>${esc(t.area)}</td><td>${prio(t.priority)}</td>
      <td class="nowrap">${t.due ? fmtDate(t.due) : "—"}${Core.isOpen(t) && t.due && t.due < today ? ' <span class="late-txt">atrasada</span>' : ""}</td><td>${statusPill(t.status)}</td>
      <td onclick="event.stopPropagation()">${Core.isOpen(t) ? `<button class="small" onclick="doneTask('${t.id}')">Feita</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">Nenhuma tarefa aqui.</td></tr>'}
  </table></div>`;
}
function toggleArea(i) { const a = areas()[i]; tf.area = tf.area === a ? "" : a; render(); }
function taskForm(id) {
  const t = id ? Core.task(id) : { title: "", area: areas().includes("Outros") ? "Outros" : areas()[0], priority: "Média", status: "Pendente", due: "", notes: "", history: [], missed: [] };
  openModal(`<h2>${id ? esc(id) : "Nova tarefa"}</h2>
    <label>Tarefa</label><input id="tf-title" value="${esc(t.title)}">
    <div class="row">
      <div><label>Área</label><select id="tf-area">${opts(areas(), t.area)}</select></div>
      <div><label>Prioridade</label><select id="tf-prio">${opts(LEVELS, t.priority)}</select></div>
      <div><label>Prazo</label><input type="date" id="tf-due" value="${esc(t.due)}"></div>
      <div><label>Status</label><select id="tf-status">${opts(TASK_STATUS, t.status)}</select></div>
    </div>
    <label>Observações</label><textarea id="tf-notes" rows="3">${esc(t.notes)}</textarea>
    ${id ? `<label>Registrar avanço</label><input id="tf-prog" placeholder="Ex.: fiz metade dos exercícios">
    <h3>Histórico</h3><ul class="tl">${t.history.map((h) => `<li><span class="muted">${esc(h.date.replace("T", " ").slice(0, 16))}</span> ${esc(h.text)}</li>`).join("") || '<li class="muted">—</li>'}</ul>` : ""}
    <div class="actions"><button id="tf-save" onclick="saveTask('${id || ""}')">Salvar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  $("#tf-title").focus();
}
async function saveTask(id) {
  const title = $("#tf-title").value.trim();
  if (!title) return toast("Escreva a tarefa.");
  const data = { title, area: $("#tf-area").value, priority: $("#tf-prio").value, due: $("#tf-due").value, notes: $("#tf-notes").value };
  const status = $("#tf-status").value;
  if (!id) { const t = Core.addTask(data); if (status === "Feita") Core.completeTask(t.id); else t.status = status; }
  else {
    const t = Core.task(id), prog = $("#tf-prog").value.trim();
    Object.assign(t, data);
    if (prog) Core.progressTask(id, prog);
    if (status !== t.status) {
      if (status === "Feita") Core.completeTask(id);
      else if (t.status === "Feita") { Core.reopenTask(id); t.status = status; }
      else { t.status = status; t.history.push({ date: nowISO(), text: `Status: ${status}` }); }
    }
  }
  closeModal();
  await save("Tarefa salva.");
}

// ------------------------------------------------------------------ registros (diário)
let rf = { kind: "", days: 30 };
function viewRegistros() {
  const from = addDays(todayISO(), -rf.days + 1);
  const list = Core.db.entries.filter((e) => e.date >= from && (!rf.kind || e.kind === rf.kind)).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const groups = {};
  for (const e of list) (groups[e.date] ??= []).push(e);
  return `<h1>Registros do dia a dia</h1>
  <div class="toolbar">
    <select onchange="rf.kind = this.value; render()"><option value="">Tudo</option>${opts(Object.keys(ENTRY_LABEL), rf.kind, ENTRY_LABEL)}</select>
    <select onchange="rf.days = +this.value; render()">${opts(["7", "30", "90", "365"], String(rf.days), { 7: "Últimos 7 dias", 30: "Últimos 30 dias", 90: "Últimos 90 dias", 365: "Último ano" })}</select>
  </div>
  ${Object.entries(groups).map(([date, es]) => `<div class="card day-card"><h2>${esc(WEEKDAYS[weekday(date)])}, ${fmtDate(date)} <a class="small" href="#sumario/${date}">sumário</a></h2>
    <table>${es.map((e) => `<tr><td class="nowrap" style="width:110px">${pill(ENTRY_LABEL[e.kind], "k-" + e.kind)}</td><td>${esc(e.text)}${e.lesson ? `<div class="muted small">Da próxima vez: ${esc(e.lesson)}</div>` : ""}</td>
      <td class="muted small nowrap">${esc(e.area)}${e.task_id ? " · " + esc(e.task_id) : ""}</td><td style="width:40px"><button class="ghost small" title="Apagar" onclick="delEntry('${e.id}')">×</button></td></tr>`).join("")}</table></div>`).join("")
    || '<div class="card"><p class="muted">Nenhum registro no período. Use o registro rápido no Painel.</p></div>'}`;
}
async function delEntry(id) {
  if (!confirm("Apagar este registro?")) return;
  Core.db.entries = Core.db.entries.filter((e) => e.id !== id);
  await save("Registro apagado.");
}

// ------------------------------------------------------------------ sumário diário
function viewSumario(arg) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(arg || "") ? arg : sumDate || todayISO();
  sumDate = date;
  const d = Core.dayData(date), week = Core.weekData(date);
  const max = Math.max(1, ...week.map((w) => Math.max(w.done, w.missed)));
  const saved = Core.db.summaries.find((s) => s.date === date);
  return `<div class="title-row no-print"><h1>Sumário diário</h1>
    <div class="toolbar"><button class="ghost small" onclick="location.hash='#sumario/${addDays(date, -1)}'">◀</button>
    <input type="date" value="${date}" onchange="location.hash='#sumario/' + this.value">
    <button class="ghost small" onclick="location.hash='#sumario/${addDays(date, 1)}'">▶</button>
    <button class="ghost small" onclick="location.hash='#sumario/${todayISO()}'">Hoje</button></div></div>
  <div class="grid two no-print">
    <div class="card"><h2>Como foi o dia?</h2>
      <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button class="star-btn ${n <= d.mood ? "on" : ""}" title="${n}" onclick="setMood('${date}', ${n})">★</button>`).join("")}</div>
      <label>Minha reflexão (opcional)</label><textarea id="refl" rows="3" placeholder="Como me senti, o que quero lembrar…">${esc(d.reflection)}</textarea>
      <div class="actions"><button class="ghost small" onclick="saveRefl('${date}')">Salvar reflexão</button>
        <button id="b-reflect" class="small" onclick="busy(this, () => reflect('${date}'))">🤖 Reflexão do assistente</button></div>
    </div>
    <div class="card"><h2>Últimos 7 dias</h2>
      <div class="cols">${week.map((w) => `<div class="col" title="${fmtDate(w.date)}: ${w.done} feitas, ${w.missed} faltaram">
        <div class="col-pair"><span class="col-bar" style="height:${(w.done / max) * 100}%"></span><span class="col-bar miss" style="height:${(w.missed / max) * 100}%"></span></div>
        <span class="col-label">${WEEKDAYS[weekday(w.date)].slice(0, 3)} ${w.date.slice(8)}</span></div>`).join("")}</div>
      <div class="legend"><span><i style="background:var(--brand)"></i>feitas</span><span><i style="background:#d08a2a"></i>faltaram</span></div>
      <p class="muted small">Na semana: ${week.reduce((s, w) => s + w.done, 0)} feitas, ${week.reduce((s, w) => s + w.missed, 0)} faltaram, ${week.reduce((s, w) => s + w.learned, 0)} aprendizados, ${week.reduce((s, w) => s + w.mistakes, 0)} erros.</p>
    </div>
  </div>
  <div class="summary-doc" id="summary">${Core.summaryHTML(d)}</div>
  <div class="actions no-print">
    ${Store.mode === "pasta" ? `<button onclick="busy(this, () => saveSummary('${date}'))">Salvar na pasta (SUMARIOS/${date}.html)</button>` : ""}
    <button class="ghost" onclick="download('sumario-${date}.html', Core.summaryHTML(Core.dayData('${date}'), { standalone: true }))">Baixar HTML</button>
    <button class="ghost" onclick="copySummary('${date}')">Copiar como texto</button>
    <button class="ghost" onclick="print()">Imprimir / PDF</button>
    ${saved ? `<span class="muted small">Salvo em ${esc(saved.file)} (${esc(saved.generated_at.replace("T", " ").slice(0, 16))})</span>` : ""}
  </div>`;
}
async function setMood(date, n) { Core.setDay(date, { mood: n }); await save(); }
async function saveRefl(date) { Core.setDay(date, { reflection: $("#refl").value }); await save("Reflexão salva."); }
async function reflect(date) {
  Core.setDay(date, { reflection: $("#refl").value });
  const r = await AI.reflect(Core.db, Core.dayData(date));
  Core.setDay(date, { ai_reflection: r.text });
  await save(r.error ? `A IA falhou (${r.error}); usei a reflexão automática.` : r.engine === "heuristica" ? "Reflexão automática (sem IA) gerada." : "Reflexão da IA gerada.");
}
async function saveSummary(date) { const f = await Core.saveSummaryFile(date); await save(`Sumário salvo em ${f}.`); }
function copySummary() {
  const txt = $("#summary").innerText;
  navigator.clipboard?.writeText(txt).then(() => toast("Sumário copiado."), () => toast("Não consegui copiar; selecione e copie manualmente."));
}

// ------------------------------------------------------------------ configurações
function viewConfig() {
  const s = Core.db.settings, st = Core.assistStats();
  return `<h1>Configurações</h1>
  <div class="grid two">
  <div class="card"><h2>IA (Claude)</h2>
    <p class="muted small">Sem chave, a plataforma funciona no modo heurístico. A chave fica guardada só neste navegador.</p>
    <label>Chave da API da Anthropic</label><input id="c-key" type="password" value="${esc(AI.key)}" placeholder="sk-ant-…">
    <label>Modelo</label><input id="c-model" value="${esc(AI.model)}">
    <div class="actions"><button id="c-save-ai" onclick="saveAI()">Salvar</button>${AI.key ? `<button class="ghost" onclick="$('#c-key').value=''; saveAI()">Remover chave</button>` : ""}</div>
  </div>
  <div class="card"><h2>Ensinar o assistente</h2>
    <p class="muted small">Taxa de acerto nas últimas ${st.n} propostas: <b>${st.n ? st.pct + "%" : "—"}</b> (${st.total} decisões guardadas).</p>
    <label>Regras para organizar as anotações</label>
    <textarea id="c-rules" rows="4" placeholder="Ex.: 'academia' é sempre Saúde; tudo que eu escrever com 'TCC' é Estudos e prioridade Alta.">${esc(s.assist_rules)}</textarea>
    <label class="inline-check"><input type="checkbox" id="c-auto" ${s.auto_apply ? "checked" : ""}> Deixar o assistente registrar sozinho quando acertar 90% ou mais (com 20+ decisões)</label>
    <label>Áreas da minha vida (uma por linha)</label><textarea id="c-areas" rows="5">${esc(s.areas.join("\n"))}</textarea>
    <div class="actions"><button onclick="saveSettings()">Salvar</button></div>
  </div>
  <div class="card"><h2>Dados e backup</h2>
    <p>Dados em: <b>${Store.mode === "pasta" ? "pasta " + esc(Store.name) : "este navegador"}</b>.</p>
    <div class="actions">
      <button class="ghost" onclick="download('atividades-backup-${todayISO()}.json', JSON.stringify(Core.db, null, 2), 'application/json')">Baixar backup (JSON)</button>
      <label class="btn ghost file-btn">Restaurar backup<input type="file" accept=".json" class="hidden" onchange="restore(this)"></label>
      <button class="ghost" onclick="changeStorage()">Trocar onde guardar</button>
    </div>
  </div>
  </div>`;
}
async function saveAI() { await AI.configure($("#c-key").value, $("#c-model").value); toast(AI.enabled() ? "IA ativada." : "Modo heurístico (sem IA)."); render(); }
async function saveSettings() {
  const s = Core.db.settings;
  s.assist_rules = $("#c-rules").value;
  s.auto_apply = $("#c-auto").checked;
  const list = $("#c-areas").value.split("\n").map((x) => x.trim()).filter(Boolean);
  if (list.length) s.areas = [...new Set(list)];
  await save("Configurações salvas.");
}
async function restore(input) {
  const f = input.files[0];
  if (!f || !confirm("Substituir os dados atuais pelo backup?")) return;
  try { Core.load(JSON.parse(await f.text())); await save("Backup restaurado."); } catch (e) { toast("Arquivo inválido: " + e.message); }
}
async function changeStorage() {
  if (!confirm("Escolher outro local? Os dados atuais serão copiados para o novo local, se ele estiver vazio.")) return;
  const current = Core.db;
  const go = async () => { const existing = await Store.loadDB(); Core.load(existing || current); await Core.save(); render(); toast(existing ? "Dados do novo local carregados." : "Dados copiados para o novo local."); };
  if (Store.mode === "pasta") { await Store.useBrowser(); return go(); }
  if (!Store.supported()) return toast("Este navegador não permite usar pastas. Use o Edge ou o Chrome.");
  try { await Store.pick(); await go(); } catch (e) { if (e.name !== "AbortError") toast("Erro: " + e.message); }
}

boot();
