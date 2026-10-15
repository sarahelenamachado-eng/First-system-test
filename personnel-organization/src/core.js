/* Regras da plataforma pessoal: tarefas (itens pessoais), registros do dia e sumário diário.
 *
 * Base (db.json):
 *   tasks    -> itens pessoais a fazer: TAR001… (status Pendente / Em andamento / Feita / Cancelada,
 *               prazo, área, prioridade, histórico de progresso, dias em que "faltou")
 *   entries  -> registros do dia: REG001… (kind: done = fiz, progress = avancei, learned = aprendi,
 *               mistake = errei, note = anotação), sempre com a data a que se referem
 *   days     -> por data: nota do dia (1–5), reflexão escrita e reflexão da IA
 *   assist_examples -> cada proposta confirmada/corrigida, para o assistente aprender o seu critério
 */
const pad = (n) => String(n).padStart(2, "0");
const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const nowISO = () => localISO();
const todayISO = () => localISO().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso.slice(0, 10) + "T12:00:00"); d.setDate(d.getDate() + n); return localISO(d).slice(0, 10); };
const weekday = (iso) => new Date(iso.slice(0, 10) + "T12:00:00").getDay();
const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const TASK_STATUS = ["Pendente", "Em andamento", "Feita", "Cancelada"];
const LEVELS = ["Alta", "Média", "Baixa"];
const DEFAULT_AREAS = ["Saúde", "Estudos", "Trabalho", "Finanças", "Casa", "Família e amigos", "Lazer", "Outros"];
const KINDS = ["done", "missed", "todo", "progress", "learned", "mistake", "note", "ignore"];
const KIND_LABEL = {
  done: "✅ Fiz", missed: "⏳ Não fiz (faltou)", todo: "📝 Nova tarefa", progress: "➡️ Avancei numa tarefa",
  learned: "💡 Aprendi", mistake: "⚠️ Errei", note: "🗒️ Anotação", ignore: "Ignorar",
};
const ENTRY_LABEL = { done: "Fiz", progress: "Avancei", learned: "Aprendi", mistake: "Errei", note: "Anotação" };

const Core = {
  db: null,

  blank() {
    return {
      version: 1,
      settings: { name: "Personnel Organization", areas: [...DEFAULT_AREAS], assist_rules: "", auto_apply: false },
      tasks: [], entries: [], days: {}, assist_examples: [], summaries: [],
      counters: { TAR: 0, REG: 0 },
    };
  },
  load(db) {
    const b = this.blank();
    this.db = Object.assign(b, db || {});
    this.db.settings = Object.assign(b.settings, (db || {}).settings || {});
    this.db.counters = Object.assign({ TAR: 0, REG: 0 }, this.db.counters);
    return this.db;
  },
  async save() {
    if (typeof Store !== "undefined" && Store.mode) await Store.saveDB(this.db);
  },
  nextId(prefix) { return prefix + String(++this.db.counters[prefix]).padStart(3, "0"); },
  task(id) { return this.db.tasks.find((t) => t.id === id); },
  isOpen: (t) => t && (t.status === "Pendente" || t.status === "Em andamento"),
  openTasks() { return this.db.tasks.filter(this.isOpen); },

  // ---------------------------------------------------------------- tarefas
  addTask(data) {
    const t = { id: this.nextId("TAR"), title: (data.title || "").trim(), area: data.area || "Outros", priority: data.priority || "Média",
      status: data.status || "Pendente", due: data.due || "", notes: data.notes || "", created_at: (data.date ? data.date + nowISO().slice(10) : nowISO()),
      done_at: "", missed: [], history: [] };
    if (data.date && data.date > todayISO()) t.created_at = nowISO();
    this.db.tasks.push(t);
    return t;
  },
  addEntry(kind, text, date, extra = {}) {
    const e = { id: this.nextId("REG"), date: date || todayISO(), kind, text: (text || "").trim(), area: extra.area || "", task_id: extra.task_id || "",
      lesson: extra.lesson || "", created_at: nowISO() };
    this.db.entries.push(e);
    return e;
  },
  completeTask(id, date = todayISO(), note = "") {
    const t = this.task(id);
    if (!t) return null;
    t.status = "Feita";
    t.done_at = date;
    t.history.push({ date: nowISO(), text: note ? `Feita: ${note}` : "Marcada como feita" });
    return this.addEntry("done", note || t.title, date, { area: t.area, task_id: t.id });
  },
  reopenTask(id) {
    const t = this.task(id);
    if (!t) return;
    t.status = "Pendente"; t.done_at = "";
    t.history.push({ date: nowISO(), text: "Reaberta" });
    this.db.entries = this.db.entries.filter((e) => !(e.kind === "done" && e.task_id === id && e.text === t.title));
  },
  progressTask(id, text, date = todayISO()) {
    const t = this.task(id);
    if (!t) return null;
    if (t.status === "Pendente") t.status = "Em andamento";
    t.history.push({ date: nowISO(), text });
    return this.addEntry("progress", text, date, { area: t.area, task_id: t.id });
  },
  markMissed(id, date = todayISO()) {
    const t = this.task(id);
    if (!t) return;
    if (!t.missed.includes(date)) t.missed.push(date);
    t.history.push({ date: nowISO(), text: `Faltou fazer em ${fmtDate(date)}` });
  },
  /** Passa para o dia seguinte o que faltou: o dia continua contando como "faltou". */
  rollOver(date = todayISO()) {
    const { missed } = this.dayData(date);
    for (const t of missed) {
      if (!t.missed.includes(date)) t.missed.push(date);
      t.due = addDays(date, 1);
      t.history.push({ date: nowISO(), text: `Faltou em ${fmtDate(date)}; prazo passado para ${fmtDate(t.due)}` });
    }
    return missed.length;
  },

  // ---------------------------------------------------------------- assistente: aplicar propostas
  /** Aplica as propostas confirmadas/corrigidas e guarda cada decisão como exemplo para o assistente aprender. */
  applyProposals(list, date = todayISO(), opts = {}) {
    const results = [];
    for (const p of list) {
      const text = (p.text || p.title || "").trim(), title = (p.title || p.text || "").trim().slice(0, 200);
      if (p.ai && !opts.auto) this.db.assist_examples.push({ date: nowISO(), text: text.slice(0, 400), ai: p.ai, final: { kind: p.kind, target: p.target || "" },
        ok: p.ai.kind === p.kind && (p.ai.target || "") === (p.target || "") });
      if (!title || p.kind === "ignore") { results.push({ kind: "ignore", title }); continue; }
      const t = p.target ? this.task(p.target) : null;
      switch (p.kind) {
        case "done":
          if (t) this.completeTask(t.id, date, title !== t.title ? title : "");
          else this.addEntry("done", title, date, { area: p.area });
          break;
        case "missed":
          if (t) this.markMissed(t.id, date);
          else { const n = this.addTask({ title, area: p.area, priority: p.priority, due: date, date }); this.markMissed(n.id, date); }
          break;
        case "todo":
          if (t) { if (p.due) t.due = p.due; if (p.priority) t.priority = p.priority; t.history.push({ date: nowISO(), text: `Lembrete: ${title}` }); }
          else this.addTask({ title, area: p.area, priority: p.priority, due: p.due, date });
          break;
        case "progress":
          if (t) this.progressTask(t.id, title, date);
          else { const n = this.addTask({ title, area: p.area, priority: p.priority, due: p.due, status: "Em andamento", date }); this.progressTask(n.id, title, date); }
          break;
        case "learned": case "note":
          this.addEntry(p.kind, title, date, { area: p.area, task_id: t?.id });
          break;
        case "mistake":
          this.addEntry("mistake", title, date, { area: p.area, task_id: t?.id, lesson: p.lesson });
          break;
      }
      results.push({ kind: p.kind, title, target: t?.id || "" });
    }
    return results;
  },
  assistStats() {
    const all = this.db.assist_examples || [], ex = all.slice(-30), ok = ex.filter((x) => x.ok).length;
    return { n: ex.length, ok, pct: ex.length ? Math.round((ok / ex.length) * 100) : 0, total: all.length };
  },

  // ---------------------------------------------------------------- sumário
  /** Tudo o que interessa de um dia: o que fiz, o que faltou, o que aprendi, onde errei. */
  dayData(date = todayISO()) {
    const db = this.db, of = (k) => db.entries.filter((e) => e.date === date && e.kind === k);
    const createdBy = (t) => (t.created_at || "").slice(0, 10) <= date;
    // planejadas para o dia: prazo até o dia (e ainda abertas no começo do dia) ou marcadas como "faltou" nesse dia
    const planned = db.tasks.filter((t) => t.status !== "Cancelada" && createdBy(t)
      && ((t.due && t.due <= date && !(t.status === "Feita" && t.done_at && t.done_at < date)) || (t.missed || []).includes(date)));
    const doneOnDay = (t) => t.status === "Feita" && t.done_at === date;
    const missed = planned.filter((t) => !doneOnDay(t) && !(t.status === "Feita" && t.done_at && t.done_at <= date));
    const plannedDone = planned.filter(doneOnDay);
    const late = missed.filter((t) => t.due && t.due < date);
    const pending = db.tasks.filter((t) => createdBy(t) && t.status !== "Cancelada" && !(t.status === "Feita" && t.done_at && t.done_at <= date));
    const day = db.days[date] || {};
    const pct = planned.length ? Math.round((plannedDone.length / planned.length) * 100) : null;
    return { date, done: of("done"), progress: of("progress"), learned: of("learned"), mistakes: of("mistake"), notes: of("note"),
      planned, plannedDone, missed, late, pending, pct, mood: day.mood || 0, reflection: day.reflection || "", ai_reflection: day.ai_reflection || "" };
  },
  weekData(end = todayISO(), n = 7) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = this.dayData(addDays(end, -i));
      out.push({ date: d.date, done: d.done.length, missed: d.missed.length, planned: d.planned.length, learned: d.learned.length, mistakes: d.mistakes.length, mood: d.mood, pct: d.pct });
    }
    return out;
  },
  setDay(date, patch) { this.db.days[date] = Object.assign(this.db.days[date] || {}, patch); },

  /** Reflexão sem IA: frases montadas a partir dos números do dia. */
  heuristicReflection(d) {
    const out = [];
    const n = d.done.length;
    out.push(n ? `Você registrou ${n} ${n === 1 ? "coisa feita" : "coisas feitas"}${d.progress.length ? ` e avançou em ${d.progress.length} ${d.progress.length === 1 ? "tarefa" : "tarefas"}` : ""}.`
      : "Nenhuma conclusão registrada neste dia.");
    if (d.planned.length) out.push(`${d.planned.length === 1 ? "Da 1 tarefa planejada" : `Das ${d.planned.length} tarefas planejadas`} para o dia, ${d.plannedDone.length} ${d.plannedDone.length === 1 ? "foi feita" : "foram feitas"} (${d.pct}%)`
      + (d.missed.length ? ` e ${d.missed.length === 1 ? "faltou 1" : `faltaram ${d.missed.length}`}.` : "."));
    if (d.late.length) out.push(`${d.late.length} ${d.late.length === 1 ? "tarefa está atrasada" : "tarefas estão atrasadas"} de dias anteriores: vale decidir se ainda fazem sentido.`);
    if (d.learned.length) out.push(`Aprendizado do dia: “${d.learned[0].text}”.`);
    if (d.mistakes.length) out.push(`Ponto de atenção: “${d.mistakes[0].text}”` + (d.mistakes[0].lesson ? ` (da próxima vez: ${d.mistakes[0].lesson}).` : "."));
    const next = [...d.missed].sort((a, b) => LEVELS.indexOf(a.priority) - LEVELS.indexOf(b.priority)).slice(0, 3);
    if (next.length) out.push(`Para amanhã, comece por: ${next.map((t) => t.title).join("; ")}.`);
    return out.join("\n");
  },

  summaryHTML(d, opts = {}) {
    const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const li = (arr, f) => (arr.length ? `<ul>${arr.map((x) => `<li>${f(x)}</li>`).join("")}</ul>` : '<p class="muted">—</p>');
    const tk = (id) => (id && this.task(id) ? ` <span class="muted">(${e(id)})</span>` : "");
    const stars = d.mood ? "★".repeat(d.mood) + "☆".repeat(5 - d.mood) : "—";
    const body = `<h1>Sumário de ${e(WEEKDAYS[weekday(d.date)])}, ${e(fmtDate(d.date))}</h1>
<div class="kpis">
  <div class="kpi"><b>${d.done.length}</b><span>coisas que fiz</span></div>
  <div class="kpi"><b>${d.missed.length}</b><span>faltaram fazer${d.planned.length ? ` (de ${d.planned.length} planejadas)` : ""}</span></div>
  <div class="kpi"><b>${d.pct == null ? "—" : d.pct + "%"}</b><span>do planejado concluído</span></div>
  <div class="kpi"><b>${d.learned.length}</b><span>aprendizados</span></div>
  <div class="kpi"><b>${d.mistakes.length}</b><span>erros / pontos de atenção</span></div>
  <div class="kpi"><b>${stars}</b><span>como foi o dia</span></div>
</div>
<h2>✅ Coisas que fiz</h2>${li(d.done, (x) => e(x.text) + tk(x.task_id))}
${d.progress.length ? `<h2>➡️ Avanços</h2>${li(d.progress, (x) => e(x.text) + tk(x.task_id))}` : ""}
<h2>⏳ Faltaram fazer (${d.missed.length})</h2>${li(d.missed, (t) => `${e(t.title)} <span class="muted">— ${e(t.priority)}${t.due ? ", prazo " + e(fmtDate(t.due)) : ""}${t.due && t.due < d.date ? ", atrasada" : ""}</span>`)}
<p class="muted">Tarefas em aberto no total: ${d.pending.length}.</p>
<h2>💡 O que aprendi</h2>${li(d.learned, (x) => e(x.text))}
<h2>⚠️ Onde errei</h2>${li(d.mistakes, (x) => e(x.text) + (x.lesson ? `<br><span class="muted">Da próxima vez: ${e(x.lesson)}</span>` : ""))}
${d.notes.length ? `<h2>🗒️ Anotações</h2>${li(d.notes, (x) => e(x.text))}` : ""}
${d.reflection ? `<h2>✍️ Minha reflexão</h2><p style="white-space:pre-wrap">${e(d.reflection)}</p>` : ""}
${d.ai_reflection ? `<h2>🤖 Reflexão do assistente</h2><p style="white-space:pre-wrap">${e(d.ai_reflection)}</p>` : ""}`;
    if (!opts.standalone) return body;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Personnel Organization · Sumário ${e(d.date)}</title>
<style>body{font:15px/1.5 "Segoe UI",system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#1a1a1a}h1{color:#0f6e6e}h2{font-size:1.1rem;border-left:4px solid #0f6e6e;padding-left:8px;margin-top:22px}
.kpis{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}.kpi{border:1px solid #ddd;border-top:3px solid #0f6e6e;border-radius:6px;padding:10px}.kpi b{display:block;font-size:1.5rem;color:#0f6e6e}.kpi span,.muted{color:#6a6d72;font-size:.9rem}</style>
</head><body>${body}<p class="muted">Gerado em ${e(fmtDate(nowISO()))} ${e(nowISO().slice(11, 16))}</p></body></html>`;
  },
  async saveSummaryFile(date) {
    const html = this.summaryHTML(this.dayData(date), { standalone: true });
    if (typeof Store !== "undefined" && Store.mode === "pasta") {
      const file = `SUMARIOS/${date}.html`;
      await Store.write(file, html);
      this.db.summaries = this.db.summaries.filter((s) => s.date !== date);
      this.db.summaries.push({ date, file, generated_at: nowISO() });
      return file;
    }
    return "";
  },
};
