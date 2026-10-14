/* Núcleo: base de dados (db.json na pasta escolhida), regras de governança e um "roteador" local
 * com as mesmas rotas que a interface usa (api("inputs/INP001/commit", "POST", {...})). */
const PREFIX = { inputs: "INP", items: "GOV", projects: "PROJ", risks: "RISK", meetings: "MEET", actions: "ACT", flows: "FLOW", mandatory: "OBR" };
const COLLECTIONS = Object.keys(PREFIX);
const DB_FILE = "db.json";

const pad = (n) => String(n).padStart(2, "0");
const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const nowISO = () => localISO();
const todayISO = () => localISO().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso.slice(0, 10) + "T12:00:00"); d.setDate(d.getDate() + n); return localISO(d).slice(0, 10); };
const daysSince = (iso) => (iso ? Math.floor((new Date(todayISO() + "T12:00:00") - new Date(iso.slice(0, 10) + "T12:00:00")) / 864e5) : 0);

class ApiError extends Error {}

function emptyDb() {
  const db = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  return Object.assign(db, {
    seq: Object.fromEntries(COLLECTIONS.map((c) => [c, 0])),
    events: [], feedback: [], summaries: [], flow_examples: [], risk_lessons: [], meeting_suggestions: [],
    settings: defaultSettings(),
  });
}

function defaultSettings() {
  return {
    alert_days_without_update: 15,
    project_meeting_cadence_days: 15,
    links_for_project_alert: 3,
    meeting_lead_days: 3,
    due_soon_days: 3,
    areas: ["Operação", "Manutenção", "RH", "Financeiro", "Jurídico", "Compras", "SSMA", "TI", "Comercial", "Engenharia"],
    lists: {
      sources: ["Diretora", "Reunião", "Departamento", "HQ", "Outro"],
      input_kinds: ["Pedido pontual", "Direcionamento / estratégia (reclamação, opinião)", "Nova solicitação do HQ", "Decisão conjunta entre departamentos", "Atualização de item existente", "Outro"],
      impact_types: ["Custo", "Eficiência", "Operação", "Compliance", "People", "Qualidade"],
      flow_edge_labels: ["origina", "afeta", "impacta", "mitiga", "depende de", "se realizado", "se não realizado", "se concretizar", "se tratado"],
      meeting_levels: ["Gerencial", "Diretoria", "Operacional", "Técnica"],
      meeting_types: ["Reporte", "Acompanhamento de projeto", "Decisão", "Alinhamento", "Outro"],
    },
    meeting_rules: "",
    work_hours: { start: "08:00", end: "18:00" },
    risk_guidelines: "",
    auto_translate: true,
    show_translated: true,
    translation_glossary: "",
    appearance: { title: "", accent: "#C00000", font_scale: 1, density: "normal", logo: "", show_bar: true },
    hidden_modules: [],
    schedule_mapping: null,
    flow_guidelines: "",
  };
}

/* Campos da planilha de atividades do projeto (layout Scope | Target | Item | nº | Subitem | Last Progress)
 * e sinônimos usados para reconhecer cada coluna automaticamente. */
const ACTIVITY_FIELDS = {
  scope: ["scope", "escopo", "范围"],
  target: ["target", "objetivo", "meta", "目标"],
  item: ["item", "tema", "事项"],
  n: ["nº", "no.", "n°", "#", "num", "seq", "编号", "序号"],
  subitem: ["subitem", "sub-item", "sub item", "atividade", "activity", "task", "tarefa", "子项", "任务"],
  last_progress: ["last progress", "progress update", "último progresso", "ultimo progresso", "andamento", "status update", "最新进展", "进展"],
  owner: ["responsável", "responsavel", "owner", "resp", "负责人"],
  start: ["início", "inicio", "start", "开始"],
  finish: ["término", "termino", "fim", "finish", "end", "prazo", "due", "deadline", "完成", "截止"],
  progress: ["%", "percent", "progresso %", "concluído", "concluido", "完成率"],
};
/** Reuniões ainda não confirmadas (realizada / não realizada). */
const OPEN_MEETING = ["Pendente", "Solicitada", "Agendada"];
const FREQUENCIES = ["Diária", "Semanal", "Quinzenal", "Mensal", "Personalizada"];
/* Campos de texto livre traduzidos automaticamente (pt / en / zh). */
const TRANSLATABLE = {
  inputs: ["title", "description", "background"],
  items: ["title", "description", "background", "scope", "scope_action", "risk_reason", "impact_details", "gap_analysis"],
  projects: ["name", "description", "objective"],
  risks: ["title", "description", "notes", "impact_notes"],
  meetings: ["title", "agenda", "minutes", "notes"],
  mandatory: ["title", "notes"],
};
const SUB_TRANSLATABLE = { item_actions: ["text", "progress"], pitems: ["title", "objective", "progress_desc"], activities: ["notes"], scenarios: ["description"], inputs_log: ["text"], actions: ["text", "gap_reason"], history: ["text"] };
function strHash(s) { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const SUB_LISTS = { projects: ["pitems", "activities", "scenarios"], risks: ["inputs_log", "scenarios"], items: ["item_actions"] };
const SUB_PREFIX = { pitems: "IT", activities: "AT", scenarios: "SC", inputs_log: "RI", item_actions: "AC" };
const SUB_LABEL = { pitems: "Itens do projeto", activities: "Atividades", scenarios: "Impactos e riscos", inputs_log: "Inputs do risco", item_actions: "Ações do item" };

const Core = {
  db: null,

  async load() {
    const f = await Store.read(DB_FILE);
    const base = emptyDb();
    let db = base;
    if (f) {
      try { db = JSON.parse(await f.text()); } catch { throw new Error(t("db.json corrompido na pasta escolhida")); }
      for (const [k, v] of Object.entries(base)) if (db[k] === undefined) db[k] = v;
      for (const c of COLLECTIONS) db.seq[c] ??= 0;
    }
    this.normalize(db);
    this.db = db;
    AI.IMPACT_TYPES = db.settings.lists.impact_types;
    if (!f) await this.save();
  },
  /** Completa campos novos em bases criadas por versões anteriores. */
  normalize(db) {
    const d = defaultSettings();
    db.settings = { ...d, ...db.settings, lists: { ...d.lists, ...(db.settings?.lists || {}) }, appearance: { ...d.appearance, ...(db.settings?.appearance || {}) } };
    for (const p of db.projects) { p.main ??= false; p.pitems ??= []; p.activities ??= []; p.scenarios ??= []; p.actions ??= []; p.schedules ??= []; p.sub_seq ??= 0; }
    for (const r of db.risks) { r.impacts ??= []; r.inputs_log ??= []; r.scenarios ??= []; r.sub_seq ??= 0; }
    for (const m of db.meetings) { m.status ??= "Realizada"; m.scheduling ??= m.auto || m.status === "Solicitada" ? "Pré-agendada" : ""; }
    db.flows ??= [];
    db.flow_examples ??= [];
    db.mandatory ??= [];
    db.risk_lessons ??= [];
    db.meeting_suggestions ??= [];
    db.settings.work_hours = { ...d.work_hours, ...(db.settings.work_hours || {}) };
    // migração: nova área de impacto "Qualidade" em listas já personalizadas (uma vez só)
    if (!db.settings.migrated_quality) { if (!db.settings.lists.impact_types.includes("Qualidade")) db.settings.lists.impact_types.push("Qualidade"); db.settings.migrated_quality = true; }
    for (const it of db.items) { it.item_actions ??= []; it.sub_seq ??= 0; }
  },
  /** % de conclusão do projeto = itens do projeto finalizados / total. */
  projectPct(p) {
    const list = p.pitems || [];
    return list.length ? Math.round((list.filter((i) => i.status === "Finalizado").length / list.length) * 100) : null;
  },
  /** Progresso médio das atividades da planilha. */
  activitiesPct(p) {
    const list = p.activities || [];
    return list.length ? Math.round(list.reduce((s, a) => s + (+a.progress || 0), 0) / list.length) : null;
  },
  _saving: Promise.resolve(),
  save() {
    const json = JSON.stringify(this.db, null, 2);
    this._saving = this._saving.then(() => Store.write(DB_FILE, json));
    return this._saving;
  },

  nextId(col) { this.db.seq[col] += 1; return `${PREFIX[col]}${String(this.db.seq[col]).padStart(3, "0")}`; },
  find(col, id) { return this.db[col].find((r) => r.id === id) || null; },
  /** Eventos guardam a chave da mensagem + parâmetros, para serem exibidos no idioma atual. */
  log(type, ref, key, params = {}) { this.db.events.push({ ts: nowISO(), date: todayISO(), type, ref, msg: [key, params], text: I18N.fill(key, params) }); },
  hist(rec, key, params = {}) { (rec.history ??= []).push({ date: nowISO(), msg: [key, params], text: I18N.fill(key, params) }); },
  touch(rec) { rec.updated_at = nowISO(); },
  /** Vínculo bidirecional entre dois registros (ex.: item <-> projeto). */
  link(aCol, aId, bCol, bId) {
    const a = this.find(aCol, aId), b = this.find(bCol, bId);
    if (!a || !b) return;
    for (const [rec, col, id] of [[a, bCol, bId], [b, aCol, aId]]) {
      rec.links ??= {};
      rec.links[col] ??= [];
      if (!rec.links[col].includes(id)) rec.links[col].push(id);
    }
  },
  folderFor(col, id) {
    return { projects: `PROJECTS/${id} INFOS AND GENERAL OVERVIEW`, risks: `RISKS/${id} INFOS AND GENERAL OVERVIEW`, meetings: `MEETINGS/${id}`, items: `ITEMS/${id}` }[col];
  },

  // ------------------------------------------------------------ regras de negócio
  async createRecord(col, data) {
    const db = this.db;
    const rec = { ...data, id: this.nextId(col), created_at: nowISO(), updated_at: nowISO() };
    rec.links ??= {};
    rec.history ??= [];
    if (col === "projects") {
      rec.status ??= "Em andamento";
      rec.actions ??= [];
      rec.schedules ??= [];
      rec.pitems ??= []; rec.activities ??= []; rec.scenarios ??= []; rec.main ??= false; rec.sub_seq = 0;
      rec.last_monitored = todayISO();
      rec.next_meeting ??= addDays(todayISO(), +db.settings.project_meeting_cadence_days || 15);
      rec.folder = this.folderFor("projects", rec.id);
      await Store.dir(rec.folder + "/master_schedule");
      await Store.dir(rec.folder + "/documentos");
    } else if (col === "risks") {
      rec.status ??= "Aberto";
      rec.mode ??= "Monitorar";
      rec.impacts ??= []; rec.inputs_log ??= []; rec.scenarios ??= []; rec.sub_seq = 0;
      rec.folder = this.folderFor("risks", rec.id);
      await Store.write(rec.folder + "/LEIA-ME.txt", `${rec.id} INFOS AND GENERAL OVERVIEW\n${rec.title || ""}\n\n`
        + "Coloque aqui todas as informações e documentos a cerca do problema.\n"
        + "A plataforma compila estes arquivos para análise e reporte.\n");
    } else if (col === "meetings") {
      rec.date ||= todayISO();
      rec.status ||= "Realizada";
    } else if (col === "items") {
      rec.status ??= "Aberto";
    }
    db[col].push(rec);
    this.log(`${col}.created`, rec.id, "{id} criado: {label}", { id: rec.id, label: rec.title || rec.name || "" });
    return rec;
  },

  /** Etapas 2 e 3 do fluxo: registra a classificação e a definição, cria/atualiza o item e os módulos ligados. */
  async commitInput(inp, body) {
    if (inp.status === "Registrado" && inp.item_id) throw new ApiError(t("Esta entrada já foi registrada em {id}.", { id: inp.item_id }));
    const a = body.assessment || {}, defs = body.definitions || [], related = body.related || [];
    const mode = body.relation_mode || "novo";
    let item = mode === "incluir_existente" ? this.find("items", body.include_in || "") : null;
    const included = !!item;
    if (item) {
      const order = { Baixa: 0, Média: 1, Alta: 2 };
      this.hist(item, "Nova entrada {inp} ({source}): {title}", { inp: inp.id, source: [inp.source], title: inp.title });
      for (const k of ["priority", "urgency"]) if ((order[a[k]] ?? -1) > (order[item[k]] ?? -1)) item[k] = a[k];
      item.impacts = [...new Set([...(item.impacts || []), ...(a.impacts || [])])].sort();
      item.definitions = [...new Set([...(item.definitions || []), ...defs])].sort();
      if (item.status === "Concluído") item.status = "Em andamento";
      this.touch(item);
      this.log("items.updated", item.id, "{id} atualizado com a entrada {inp}", { id: item.id, inp: inp.id });
    } else {
      item = await this.createRecord("items", {
        title: inp.title, description: inp.description, background: inp.background, source: inp.source, source_detail: inp.source_detail,
        origin: a.origin || inp.origin, area_main: inp.area_main, areas_impacted: inp.areas_impacted, areas_impacting: inp.areas_impacting,
        owner: inp.owner, due_date: inp.due_date, emitted_at: (inp.created_at || "").slice(0, 10),
        scope: a.scope, scope_action: a.scope_action, priority: a.priority, urgency: a.urgency, risk_reason: a.risk_reason,
        impacts: a.impacts || [], impact_details: a.impact_details, gap_analysis: a.gap_analysis, definitions: defs,
      });
    }
    this.link("inputs", inp.id, "items", item.id);
    for (const rid of related) if (rid !== item.id && this.find("items", rid)) this.link("items", item.id, "items", rid);
    if (inp.meeting_id && this.find("meetings", inp.meeting_id)) this.link("items", item.id, "meetings", inp.meeting_id);

    const created = { item: item.id };
    for (const d of defs) {
      const openRisks = (item.links.risks || []).map((x) => this.find("risks", x)).filter((r) => r && r.status !== "Fechado");
      if ((d === "risco_monitorar" || d === "risco_investigar") && included && openRisks.length) {
        // item on going já tem risco aberto: registra a nova informação nele em vez de duplicar
        for (const r of openRisks) {
          this.hist(r, "Nova entrada {inp}: {title}", { inp: inp.id, title: inp.title });
          if (d === "risco_investigar") r.mode = "Investigar";
          this.touch(r);
        }
        (created.risks ??= []).push(...openRisks.map((r) => r.id));
      } else if (d === "novo_projeto" && included && item.links.projects?.length) {
        created.project = item.links.projects[0];
      } else if (d === "risco_monitorar" || d === "risco_investigar") {
        const risk = await this.createRecord("risks", {
          title: inp.title, description: inp.description, owner: inp.owner, mode: d === "risco_investigar" ? "Investigar" : "Monitorar",
          probability: a.urgency || "Média", impact: { Alta: "Alto", Média: "Médio", Baixa: "Baixo" }[a.priority] || "Médio", notes: a.risk_reason || "",
        });
        this.link("items", item.id, "risks", risk.id);
        (created.risks ??= []).push(risk.id);
      } else if (d === "novo_projeto") {
        const proj = await this.createRecord("projects", { name: body.new_project_name || inp.title, description: inp.description, owner: inp.owner, origin_item: item.id });
        this.link("items", item.id, "projects", proj.id);
        created.project = proj.id;
      } else if (d === "acao_projeto") {
        const proj = this.find("projects", body.project_id || "");
        if (!proj) throw new ApiError(t("Selecione o projeto para 'Ação dentro de um projeto'."));
        const actId = this.nextId("actions");
        proj.actions.push({ id: actId, text: inp.title, item_id: item.id, owner: inp.owner, due: inp.due_date, status: "Aberta",
          gap_reason: body.gap_reason || a.gap_analysis || "", created_at: nowISO() });
        this.touch(proj);
        this.link("items", item.id, "projects", proj.id);
        this.log("projects.action", proj.id, "Ação {act} incluída no portfólio de {id}: {title}", { act: actId, id: proj.id, title: inp.title });
        created.action = actId;
      } else if (d === "info_reportar") {
        item.report = true;
      }
    }
    // aprendizado: guarda sugestão x decisão
    this.db.feedback.push({ date: nowISO(), ref: inp.id, text: AI.inputText(inp), ai: inp.ai_suggestion || null, final: { ...a, definitions: defs, relation_mode: mode } });
    Object.assign(inp, { status: "Registrado", item_id: item.id, assessment: a, definitions: defs });
    this.touch(inp);
    this.log("inputs.committed", inp.id, "{inp} classificado e registrado em {item} ({defs})", { inp: inp.id, item: item.id, defs: defs.map((d) => AI.DEFINITIONS[d] || d) });
    return created;
  },

  alerts() {
    const db = this.db, s = db.settings, out = [], today = todayISO();
    const add = (level, ref, key, params) => out.push({ level, ref, msg: [key, params], text: I18N.fill(key, params) });
    const limit = +s.alert_days_without_update || 15, n = +s.links_for_project_alert || 3;
    for (const p of db.projects) {
      if (["Concluído", "Cancelado"].includes(p.status)) continue;
      const d = daysSince(p.last_monitored || p.updated_at);
      if (d >= limit) add("alta", p.id, "Projeto {id} — {name}: {d} dias sem monitoramento/atualização.", { id: p.id, name: p.name, d });
      if (p.next_meeting && p.next_meeting <= today) add("media", p.id, "Reunião de acompanhamento de {id} prevista para {date}.", { id: p.id, date: p.next_meeting });
    }
    for (const it of db.items) {
      if (it.status === "Concluído") continue;
      const L = it.links || {};
      if ((L.items || []).length >= n && !(L.projects || []).length)
        add("alta", it.id, "{id} está interligado a {n} itens: avaliar criação de um projeto com overview maior.", { id: it.id, n: L.items.length });
      if (it.due_date && it.due_date < today) add("alta", it.id, "{id} — {title}: prazo vencido em {date}.", { id: it.id, title: it.title, date: it.due_date });
      else if (it.due_date && it.due_date <= addDays(today, +s.due_soon_days || 3)) add("media", it.id, "{id} — {title}: vence em {date}.", { id: it.id, title: it.title, date: it.due_date });
      for (const a of it.item_actions || []) if (a.due && a.due < today && a.status !== "Concluída") add("alta", it.id, "{id}: ação {act} ({text}) vencida em {date}.", { id: it.id, act: a.id, text: a.text, date: a.due });
      if ((L.inputs || []).length >= n) add("media", it.id, "{id} recebeu {n} entradas: tema recorrente.", { id: it.id, n: L.inputs.length });
    }
    for (const r of db.risks) {
      if (r.status !== "Fechado" && daysSince(r.updated_at) >= limit) add("media", r.id, "Risco {id} sem atualização há {d} dias.", { id: r.id, d: daysSince(r.updated_at) });
    }
    for (const m of db.meetings) {
      if (OPEN_MEETING.includes(m.status) && m.date && m.date <= today)
        add(m.status === "Pendente" ? "alta" : "media", m.id, "Reunião {id} ({title}) de {date}: confirme se foi realizada.", { id: m.id, title: m.title, date: m.date });
    }
    const pending = db.inputs.filter((i) => i.status !== "Registrado").length;
    if (pending) add("baixa", "inputs", "{n} entradas aguardando classificação.", { n: pending });
    return out;
  },

  buildSummary(kind, ref) {
    const db = this.db, today = todayISO();
    let s = ref, e = ref;
    if (kind === "weekly") {
      const wd = (new Date(ref + "T12:00:00").getDay() + 6) % 7; // segunda = 0
      s = addDays(ref, -wd); e = addDays(s, 6);
    }
    const inr = (iso) => !!iso && s <= iso.slice(0, 10) && iso.slice(0, 10) <= e;
    const events = db.events.filter((ev) => inr(ev.date));
    const open = db.items.filter((i) => i.status !== "Concluído");
    const newInputs = db.inputs.filter((i) => inr(i.created_at));
    const bySource = {};
    for (const i of newInputs) (bySource[i.source || "Outro"] ??= []).push({ id: i.id, title: this.loc(i, "title"), status: i.status });
    const updIds = new Set(events.filter((ev) => ev.type.startsWith("items.")).map((ev) => ev.ref));
    const horizon = addDays(e, 7);
    const brief = (i) => ({ id: i.id, title: this.loc(i, "title"), owner: i.owner, due_date: i.due_date, priority: i.priority, status: i.status });
    const activeP = db.projects.filter((p) => !["Concluído", "Cancelado"].includes(p.status));
    const openR = db.risks.filter((r) => r.status !== "Fechado");
    const summary = {
      type: kind === "weekly" ? "Summary semanal" : "Summary diário",
      period: { start: s, end: e },
      generated_at: nowISO(),
      kpis: {
        new_inputs: newInputs.length,
        items_created: db.items.filter((i) => inr(i.created_at)).length,
        items_updated: updIds.size,
        open_items: open.length,
        high_priority_open: open.filter((i) => i.priority === "Alta").length,
        overdue: open.filter((i) => i.due_date && i.due_date < today).length,
        meetings: db.meetings.filter((m) => inr(m.date)).length,
        open_risks: openR.length,
        active_projects: activeP.length,
      },
      inputs_by_source: bySource,
      critical_items: open.filter((i) => i.priority === "Alta").slice(0, 25).map(brief),
      due_items: open.filter((i) => i.due_date && i.due_date <= horizon).map(brief).sort((a, b) => a.due_date.localeCompare(b.due_date)),
      projects: activeP.map((p) => ({ id: p.id, name: this.loc(p, "name"), status: p.status, next_meeting: p.next_meeting, main: p.main,
        pct: this.projectPct(p), activities_pct: this.activitiesPct(p),
        open_actions: (p.actions || []).filter((a) => a.status !== "Concluída").length, last_monitored: p.last_monitored })),
      risks: openR.map((r) => ({ id: r.id, title: this.loc(r, "title"), mode: r.mode, probability: r.probability, impact: r.impact, status: r.status })),
      meetings: db.meetings.filter((m) => inr(m.date)).map((m) => ({ id: m.id, title: m.title_msg ? t(m.title_msg[0], m.title_msg[1]) : this.loc(m, "title"), date: m.date, status: m.status, decisions: m.decisions || [], items: m.links?.items || [] })),
      report_items: open.filter((i) => i.report).map(brief),
      activity: events.slice(-200).map((ev) => ({ ts: ev.ts, msg: ev.msg, text: ev.text })),
      alerts: this.alerts(),
    };
    if (kind === "weekly") {
      summary.activity_per_day = {};
      for (const ev of events) summary.activity_per_day[ev.date] = (summary.activity_per_day[ev.date] || 0) + 1;
    }
    return summary;
  },

  exportCsv() {
    const q = (v) => { v = Array.isArray(v) ? v.join(", ") : String(v ?? ""); return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const tv = (v) => (Array.isArray(v) ? v.map((x) => t(x)) : v ? t(v) : "");
    const lines = [["ID", "Título", "Status", "Origem", "Detalhe origem", "De onde veio", "Responsável", "Data emitida", "Prazo",
      "Escopo (o que é)", "O que fazer", "Prioridade", "Urgência", "Justificativa risco", "Impactos", "Detalhe impactos",
      "Área principal", "Áreas impactadas", "Definições", "Projetos", "Riscos", "Reuniões", "Itens relacionados", "Atualizado em"].map((h) => (h === "ID" ? h : t(h)))];
    for (const i of this.db.items) {
      const L = i.links || {};
      lines.push([i.id, i.title, tv(i.status), tv(i.source), tv(i.source_detail), i.origin, i.owner, i.emitted_at || (i.created_at || "").slice(0, 10), i.due_date,
        i.scope, i.scope_action, tv(i.priority), tv(i.urgency), i.risk_reason, tv(i.impacts || []), i.impact_details, i.area_main, i.areas_impacted,
        tv((i.definitions || []).map((d) => AI.DEFINITIONS[d] || d)), L.projects || [], L.risks || [], L.meetings || [], L.items || [], i.updated_at]);
    }
    return "﻿" + lines.map((r) => r.map(q).join(";")).join("\r\n");
  },

  /** Registra arquivos colocados diretamente na pasta local master_schedule. */
  async syncSchedules(p) {
    const files = await Store.list(p.folder + "/master_schedule");
    const known = new Set((p.schedules || []).map((s) => s.rel));
    for (const f of files) if (!known.has(f.rel)) p.schedules.push({ rel: f.rel, name: f.name, uploaded_at: f.modified, size: f.size, analysis: null });
    const present = new Set(files.map((f) => f.rel));
    const before = p.schedules.length;
    p.schedules = p.schedules.filter((s) => present.has(s.rel));
    return files.length !== known.size || before !== p.schedules.length;
  },

  async filesText(folder) {
    const parts = [];
    for (const f of await Store.list(folder)) {
      const file = await Store.read(f.rel), n = f.name.toLowerCase();
      if (/\.(txt|md|csv)$/.test(n) && f.size < 500000) parts.push(`--- ${f.name} ---\n${await file.text()}`);
      else if (/\.xlsx?$/.test(n)) {
        try { parts.push(`--- ${f.name} ---\n` + ((await Sheet.table(file)) || []).slice(0, 300).map((r) => r.join(" | ")).join("\n")); }
        catch { parts.push(`--- ${f.name} (unreadable) ---`); }
      } else parts.push(`--- ${f.name} (binary file, ${f.size} bytes) ---`);
    }
    return parts.join("\n");
  },

  /** Versão do summary salva na pasta local SUMMARIES (abre no navegador / imprime em PDF). */
  summaryHtml(s, text) {
    const esc = (x) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const coded = ["status", "mode", "probability", "impact", "priority"];
    const rows = (lst, cols) => lst.map((r) => "<tr>" + cols.map((c) => `<td>${esc(coded.includes(c) && r[c] ? t(r[c]) : r[c])}</td>`).join("") + "</tr>").join("") || `<tr><td colspan=${cols.length}>—</td></tr>`;
    const th = (hs) => "<tr>" + hs.map((h) => `<th>${esc(h === "ID" ? h : t(h))}</th>`).join("") + "</tr>";
    const k = s.kpis;
    const kp = [["Novas demandas", k.new_inputs], ["Itens criados", k.items_created], ["Itens atualizados", k.items_updated], ["Em aberto", k.open_items],
      ["Alta prioridade", k.high_priority_open], ["Vencidos", k.overdue], ["Reuniões", k.meetings], ["Riscos abertos", k.open_risks], ["Projetos ativos", k.active_projects]];
    const msgOf = (a) => (a.msg ? t(a.msg[0], a.msg[1]) : a.text);
    return `<!doctype html><html lang="${I18N.htmlLang()}"><meta charset="utf-8"><title>${esc(t(s.type))} ${esc(s.period.start)}</title>
<style>body{font:14px system-ui;margin:32px;color:#1a1a1a;background:#fafafa}h1{margin:0;color:${esc(Core.db.settings.appearance.accent)}}
h2{color:#1a1a1a;border-left:5px solid ${esc(Core.db.settings.appearance.accent)};padding-left:8px;margin-top:28px}
table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #d9d9d9;padding:4px 8px;text-align:left}th{background:#f0f0f0}
.k{display:inline-block;margin:6px 12px 6px 0;padding:8px 12px;background:#fff;border:1px solid #e1e1e1;border-top:3px solid ${esc(Core.db.settings.appearance.accent)};border-radius:6px}</style>
<h1>${esc(t(s.type))}</h1><p>${esc(t("Período"))}: ${esc(s.period.start)} – ${esc(s.period.end)} · ${esc(t("gerado"))} ${esc(s.generated_at)}</p>
<h2>1. ${esc(t("Destaques"))}</h2><div style="white-space:pre-wrap">${esc(text)}</div>
<h2>2. ${esc(t("Indicadores"))}</h2>${kp.map(([n, v]) => `<span class=k><b>${v}</b> ${esc(t(n))}</span>`).join("")}
<h2>3. ${esc(t("Novas demandas por origem"))}</h2>${Object.entries(s.inputs_by_source).map(([src, l]) => `<h3>${esc(t(src))}</h3><table>${rows(l, ["id", "title", "status"])}</table>`).join("") || "<p>—</p>"}
<h2>4. ${esc(t("Itens críticos (alta prioridade)"))}</h2><table>${th(["ID", "Título", "Responsável", "Prazo", "Status"])}${rows(s.critical_items, ["id", "title", "owner", "due_date", "status"])}</table>
<h2>5. ${esc(t("Prazos — vencidos e próximos 7 dias"))}</h2><table>${th(["ID", "Título", "Responsável", "Prazo"])}${rows(s.due_items, ["id", "title", "owner", "due_date"])}</table>
<h2>6. ${esc(t("Projetos"))}</h2><table>${th(["ID", "Projeto", "Status", "% concluído", "Itens adicionais abertos", "Próx. reunião"])}${rows(s.projects.map((p) => ({ ...p, pct: p.pct == null ? "—" : p.pct + "%" })), ["id", "name", "status", "pct", "open_actions", "next_meeting"])}</table>
<h2>7. ${esc(t("Riscos"))}</h2><table>${th(["ID", "Risco", "Modo", "Prob.", "Impacto"])}${rows(s.risks, ["id", "title", "mode", "probability", "impact"])}</table>
<h2>8. ${esc(t("Reuniões e decisões"))}</h2>${s.meetings.map((m) => `<p><b>${esc(m.id)} — ${esc(m.title)}</b> (${esc(m.date)} · ${esc(t(m.status || "Realizada"))})<br>${m.decisions.map(esc).join("<br>") || esc(t("Sem decisões registradas"))}</p>`).join("") || "<p>—</p>"}
<h2>9. ${esc(t("Infos a reportar"))}</h2><table>${th(["ID", "Título", "Responsável", "Status"])}${rows(s.report_items, ["id", "title", "owner", "status"])}</table>
<h2>10. ${esc(t("Alertas"))}</h2><ul>${s.alerts.map((a) => `<li>${esc(msgOf(a))}</li>`).join("") || "<li>—</li>"}</ul>`;
  },

  // ------------------------------------------------------------ reuniões automáticas de projetos principais
  /** Projetos principais geram, na aba Reuniões, a necessidade de reunião de acompanhamento (a confirmar). */
  autoMeetings() {
    const db = this.db, lead = +db.settings.meeting_lead_days || 0, limit = addDays(todayISO(), lead);
    let created = false;
    for (const p of db.projects) {
      if (!p.main || ["Concluído", "Cancelado"].includes(p.status) || !p.next_meeting || p.next_meeting > limit) continue;
      if (db.meetings.some((m) => m.project_id === p.id && OPEN_MEETING.includes(m.status))) continue;
      const m = { id: this.nextId("meetings"), title: I18N.fill("Acompanhamento: {name}", { name: p.name }), title_msg: ["Acompanhamento: {name}", { name: p.name }],
        date: p.next_meeting, project_id: p.id, status: "Pendente", auto: true, kind: "Acompanhamento de projeto",
        level: "Gerencial", mtype: "Acompanhamento de projeto", scheduling: "Pré-agendada",
        created_at: nowISO(), updated_at: nowISO(), links: {}, history: [] };
      db.meetings.push(m);
      this.link("meetings", m.id, "projects", p.id);
      this.log("meetings.auto", m.id, "Reunião {id} gerada automaticamente para o projeto principal {proj} ({date})", { id: m.id, proj: p.id, date: m.date });
      created = true;
    }
    return created;
  },

  // ------------------------------------------------------------ atividades a partir da planilha
  /** Sugere qual coluna corresponde a cada campo, a partir da linha de cabeçalho. */
  guessMapping(header) {
    const norm = (x) => AI.norm(x).trim();
    const H = header.map(norm), map = {};
    const saved = this.db.settings.schedule_mapping;
    for (const [field, syn] of Object.entries(ACTIVITY_FIELDS)) {
      let idx = -1;
      if (saved?.[field]) idx = H.indexOf(norm(saved[field]));
      if (idx < 0) idx = H.findIndex((h) => h && syn.some((s) => h === norm(s)));
      if (idx < 0) idx = H.findIndex((h) => h && syn.some((s) => norm(s).length > 2 && h.includes(norm(s))));
      if (idx >= 0 && !Object.values(map).includes(idx)) map[field] = idx;
    }
    // coluna de numeração sem título logo antes do Subitem (como no layout padrão)
    if (map.n === undefined && map.subitem > 0 && !H[map.subitem - 1]) map.n = map.subitem - 1;
    return map;
  },
  findHeaderRow(rows) {
    let best = 0, score = -1;
    rows.slice(0, 15).forEach((r, i) => {
      const m = this.guessMapping(r);
      const sc = Object.keys(m).length;
      if (sc > score) { score = sc; best = i; }
    });
    return best;
  },
  importActivities(p, rows, headerRow, mapping) {
    const header = rows[headerRow] || [];
    const get = (r, f) => (mapping[f] === undefined || mapping[f] === "" || mapping[f] === null ? "" : String(r[+mapping[f]] ?? "").trim());
    const key = (a) => [a.scope, a.item, a.n, a.subitem].map((x) => AI.norm(x)).join("|");
    const existing = new Map(p.activities.map((a) => [key(a), a]));
    const out = [];
    let added = 0, updated = 0;
    for (const r of rows.slice(headerRow + 1)) {
      const a = Object.fromEntries(Object.keys(ACTIVITY_FIELDS).map((f) => [f, get(r, f)]));
      if (!a.subitem && !a.item && !a.n && !a.last_progress) continue;
      const pct = a.progress ? parseFloat(a.progress.replace("%", "").replace(",", ".")) : NaN;
      const old = existing.get(key(a));
      if (old) {
        Object.assign(old, { scope: a.scope, target: a.target, item: a.item, n: a.n, subitem: a.subitem, last_progress: a.last_progress || old.last_progress,
          owner: a.owner || old.owner, start: a.start || old.start, finish: a.finish || old.finish });
        if (!isNaN(pct)) old.progress = pct <= 1 && !a.progress.includes("%") ? Math.round(pct * 100) : Math.round(pct);
        out.push(old); existing.delete(key(a)); updated++;
      } else {
        out.push({ ...a, id: this.subId(p, "activities"), progress: isNaN(pct) ? 0 : (pct <= 1 && !a.progress.includes("%") ? Math.round(pct * 100) : Math.round(pct)), notes: "", created_at: nowISO() });
        added++;
      }
    }
    // atividades que não estão mais na planilha são mantidas (podem ter progresso registrado)
    p.activities = [...out, ...existing.values()];
    this.db.settings.schedule_mapping = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== "" && v !== null && v !== undefined).map(([f, i]) => [f, header[+i] ?? ""]));
    return { added, updated, kept: existing.size };
  },
  subId(rec, list) { rec.sub_seq = (rec.sub_seq || 0) + 1; return `${SUB_PREFIX[list]}${String(rec.sub_seq).padStart(3, "0")}`; },

  // ------------------------------------------------------------ fluxos (mapa visual)
  /** Monta um fluxo a partir dos vínculos e impactos já registrados. */
  flowFromData(scopeCol, scopeId) {
    const db = this.db, nodes = new Map(), edges = [];
    const node = (key, label, type, ref) => { if (!nodes.has(key)) nodes.set(key, { id: key, label, type, ref: ref || "" }); return key; };
    const edge = (from, to, label) => { if (from !== to && !edges.some((e) => e.from === from && e.to === to)) edges.push({ id: "E" + (edges.length + 1), from, to, label }); };
    const addImpacts = (rec, key, col) => {
      for (const s of rec.scenarios || []) {
        const k = node(`${rec.id}-${s.id}`, `${s.category ? s.category + ": " : ""}${s.description || ""}`.slice(0, 80), s.kind === "Risco" ? "risk" : "impact");
        edge(key, k, s.scenario || (col === "projects" ? "se não realizado" : "se concretizar"));
      }
      for (const imp of rec.impacts || []) edge(key, node(`impact-${imp}`, imp, "impact"), "impacta");
    };
    const addProject = (p) => {
      const pk = node(p.id, `${p.id} · ${p.name}`, "project", p.id);
      for (const iid of p.links?.items || []) { const it = this.find("items", iid); if (it) edge(node(it.id, `${it.id} · ${it.title}`, "item", it.id), pk, "origina"); }
      // riscos ligados ao projeto, diretamente ou pelos mesmos itens, com os impactos de cada risco
      const riskIds = new Set([...(p.links?.risks || []), ...(p.links?.items || []).flatMap((iid) => this.find("items", iid)?.links?.risks || [])]);
      for (const rid of riskIds) {
        const r = this.find("risks", rid);
        if (!r) continue;
        const rk = node(r.id, `${r.id} · ${r.title}`, "risk", r.id);
        edge(rk, pk, "afeta");
        addImpacts(r, rk, "risks");
      }
      addImpacts(p, pk, "projects");
      return pk;
    };
    const addRisk = (r) => {
      const rk = node(r.id, `${r.id} · ${r.title}`, "risk", r.id);
      for (const iid of r.links?.items || []) { const it = this.find("items", iid); if (it) edge(node(it.id, `${it.id} · ${it.title}`, "cause", it.id), rk, "origina"); }
      for (const iid of r.links?.items || []) for (const pid of this.find("items", iid)?.links?.projects || []) { const p = this.find("projects", pid); if (p) edge(rk, node(p.id, `${p.id} · ${p.name}`, "project", p.id), "afeta"); }
      addImpacts(r, rk, "risks");
      return rk;
    };
    if (scopeCol === "projects") { const p = this.find("projects", scopeId); if (p) addProject(p); }
    else if (scopeCol === "risks") { const r = this.find("risks", scopeId); if (r) addRisk(r); }
    else {
      db.projects.filter((p) => !["Concluído", "Cancelado"].includes(p.status)).forEach(addProject);
      db.risks.filter((r) => r.status !== "Fechado").forEach(addRisk);
    }
    return this.layoutFlow([...nodes.values()], edges);
  },
  /** Organiza os nós em colunas: causas/itens → projetos/riscos → impactos. */
  layoutFlow(nodes, edges) {
    const COL = { cause: 0, item: 0, input: 0, action: 1, project: 1, risk: 1, other: 1, impact: 2 };
    const count = {};
    for (const n of nodes) {
      const c = COL[n.type] ?? 1;
      count[c] = (count[c] || 0) + 1;
      n.x = 40 + c * 320;
      n.y = 40 + (count[c] - 1) * 90;
    }
    return { nodes, edges };
  },

  // ------------------------------------------------------------ duplicidade
  /** Itens da lista geral com o mesmo título (ou quase) — possíveis duplicados. */
  findDuplicates(title, excludeId = null) {
    const n = AI.norm(title).replace(/\s+/g, " ").trim();
    if (!n) return [];
    return this.db.items.filter((it) => it.id !== excludeId && it.status !== "Concluído" &&
      (AI.norm(it.title).replace(/\s+/g, " ").trim() === n || AI.similarity(title, it.title) >= 0.9)).map((it) => it.id);
  },
  /** Junta o item `from` no item `into`: vínculos, entradas, histórico e ações; depois remove `from`. */
  mergeItems(from, into) {
    const a = this.find("items", from), b = this.find("items", into);
    if (!a || !b || a === b) throw new ApiError(t("{id} não encontrado", { id: !b ? into : from }));
    for (const [col, ids] of Object.entries(a.links || {})) for (const id of ids) { if (!(col === "items" && id === into)) this.link("items", into, col, id); }
    for (const col of COLLECTIONS) for (const r of this.db[col]) {
      const l = r.links?.items; if (l?.includes(from)) { l.splice(l.indexOf(from), 1); if (r.id !== into && !l.includes(into)) l.push(into); }
    }
    b.links.items = (b.links.items || []).filter((x) => x !== from && x !== into);
    for (const inp of this.db.inputs) if (inp.item_id === from) inp.item_id = into;
    for (const p of this.db.projects) for (const act of p.actions || []) if (act.item_id === from) act.item_id = into;
    b.history = [...(b.history || []), ...(a.history || [])].sort((x, y) => (x.date || "").localeCompare(y.date || ""));
    for (const act of a.item_actions || []) b.item_actions.push({ ...act, id: this.subId(b, "item_actions") });
    b.definitions = [...new Set([...(b.definitions || []), ...(a.definitions || [])])];
    b.impacts = [...new Set([...(b.impacts || []), ...(a.impacts || [])])];
    if (!b.due_date || (a.due_date && a.due_date < b.due_date)) b.due_date = a.due_date || b.due_date;
    this.db.items = this.db.items.filter((x) => x.id !== from);
    this.hist(b, "{from} mesclado neste item (duplicado)", { from });
    this.touch(b);
    this.log("items.merged", into, "{from} mesclado em {into}", { from, into });
    return b;
  },

  // ------------------------------------------------------------ reuniões obrigatórias
  monthDays(month) {
    const [y, m] = month.split("-").map(Number), out = [];
    for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) out.push(`${month}-${pad(d)}`);
    return out;
  },
  weekday(iso) { return new Date(iso + "T12:00:00").getDay(); }, // 0 = domingo
  workdays(month) { return this.monthDays(month).filter((d) => ![0, 6].includes(this.weekday(d))); },
  /** Quantas vezes a reunião obrigatória precisa acontecer no mês. */
  requiredCount(m, month) {
    const wd = this.workdays(month);
    switch (m.frequency) {
      case "Diária": return wd.length;
      case "Semanal": return new Set(wd.map((d) => this.isoWeek(d))).size;
      case "Quinzenal": return 2;
      case "Mensal": return 1;
      default: return Math.max(1, +m.times_per_month || 1);
    }
  },
  isoWeek(iso) { const d = new Date(iso + "T12:00:00"); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day + 3); return d.toISOString().slice(0, 10); },
  /** Situação de cada reunião obrigatória no mês: exigidas, agendadas, realizadas, não realizadas. */
  mandatoryStatus(month) {
    return this.db.mandatory.filter((m) => m.active !== false).map((m) => {
      const ms = this.db.meetings.filter((x) => x.mandatory_id === m.id && (x.date || "").startsWith(month));
      return { id: m.id, title: m.title, required: this.requiredCount(m, month),
        scheduled: ms.filter((x) => OPEN_MEETING.includes(x.status)).length,
        held: ms.filter((x) => x.status === "Realizada").length,
        missed: ms.filter((x) => x.status === "Não realizada").length };
    });
  },
  /** Sugestão local (sem IA): distribui pela frequência, nos dias e horários preferidos, evitando conflitos. */
  heuristicSuggestions(month) {
    const db = this.db, today = todayISO(), out = [];
    const busy = new Set(db.meetings.filter((x) => x.date && x.time).map((x) => `${x.date} ${x.time}`));
    const toMin = (h) => { const [a, b] = (h || "09:00").split(":").map(Number); return a * 60 + (b || 0); };
    const toHH = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
    const end = toMin(db.settings.work_hours.end || "18:00");
    for (const m of db.mandatory.filter((x) => x.active !== false)) {
      const st = this.mandatoryStatus(month).find((x) => x.id === m.id);
      let need = st.required - st.scheduled - st.held;
      if (need <= 0) continue;
      let days = this.workdays(month).filter((d) => d >= today);
      if (m.preferred_days?.length) { const pref = days.filter((d) => m.preferred_days.map(Number).includes(this.weekday(d))); if (pref.length) days = pref; }
      if (!days.length) continue;
      let picks;
      if (m.frequency === "Diária") picks = days;
      else if (m.frequency === "Semanal") {
        const byWeek = new Map(); for (const d of days) if (!byWeek.has(this.isoWeek(d))) byWeek.set(this.isoWeek(d), d);
        const held = new Set(db.meetings.filter((x) => x.mandatory_id === m.id && (x.date || "").startsWith(month)).map((x) => this.isoWeek(x.date)));
        picks = [...byWeek.entries()].filter(([w]) => !held.has(w)).map(([, d]) => d);
      } else {
        picks = Array.from({ length: Math.min(need, days.length) }, (_, i) => days[Math.floor((i * days.length) / Math.min(need, days.length))]);
      }
      for (const date of picks.slice(0, need)) {
        let tm = toMin(m.preferred_time || db.settings.work_hours.start || "09:00");
        while (busy.has(`${date} ${toHH(tm)}`) && tm + (+m.duration || 60) <= end) tm += 60;
        busy.add(`${date} ${toHH(tm)}`);
        out.push({ mandatory_id: m.id, title: m.title, date, time: toHH(tm), reason: "Distribuída pela frequência e pelos dias/horários preferidos, sem conflito com outras reuniões." });
      }
    }
    return out;
  },

  // ------------------------------------------------------------ dashboards
  lateInfo(p) {
    const today = todayISO();
    const items = (p.pitems || []).filter((x) => x.due && x.due < today && x.status !== "Finalizado");
    const acts = (p.activities || []).filter((x) => x.finish && x.finish < today && (+x.progress || 0) < 100);
    const adds = (p.actions || []).filter((x) => x.due && x.due < today && x.status !== "Concluída");
    const dated = (p.pitems || []).filter((x) => x.due).length + (p.activities || []).filter((x) => x.finish).length + (p.actions || []).filter((x) => x.due).length;
    const late = items.length + acts.length + adds.length;
    const risks = new Set([...(p.links?.risks || []), ...(p.links?.items || []).flatMap((i) => this.find("items", i)?.links?.risks || [])]);
    const openRisk = [...risks].some((r) => this.find("risks", r)?.status !== "Fechado");
    const oldest = [...items.map((x) => x.due), ...acts.map((x) => x.finish), ...adds.map((x) => x.due)].sort()[0] || "";
    // risco de atraso: status "Em risco", ou itens atrasados combinados com risco aberto ligado ou ≥ 30% do que tem prazo atrasado
    const delayRisk = p.status === "Em risco" || (late > 0 && (openRisk || (dated && late / dated >= 0.3)));
    return { items: items.length, acts: acts.length, adds: adds.length, late, dated, openRisk, delayRisk, oldest };
  },
  dashProjects() {
    const s = this.db.settings, active = this.db.projects.filter((p) => !["Concluído", "Cancelado"].includes(p.status));
    const rows = active.map((p) => ({ id: p.id, name: p.name, main: p.main, pct: this.projectPct(p), apct: this.activitiesPct(p), stale: daysSince(p.last_monitored || p.updated_at), ...this.lateInfo(p) }));
    const pcts = rows.map((r) => r.pct).filter((x) => x != null);
    const bucket = (lo, hi) => rows.filter((r) => r.pct != null && r.pct >= lo && (hi === 100 ? r.pct <= hi : r.pct < hi)).length;
    return {
      total: active.length, done: this.db.projects.filter((p) => p.status === "Concluído").length,
      withLate: rows.filter((r) => r.late > 0).length, delayRisk: rows.filter((r) => r.delayRisk).length,
      onTrack: rows.filter((r) => r.late === 0 && !r.delayRisk).length,
      main: rows.filter((r) => r.main).length, stale: rows.filter((r) => r.stale >= (+s.alert_days_without_update || 15)).length,
      avgPct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
      lateBy: { items: rows.reduce((a, r) => a + r.items, 0), acts: rows.reduce((a, r) => a + r.acts, 0), adds: rows.reduce((a, r) => a + r.adds, 0) },
      buckets: [["0–25%", bucket(0, 25)], ["25–50%", bucket(25, 50)], ["50–75%", bucket(50, 75)], ["75–100%", bucket(75, 100)], ["Sem itens", rows.filter((r) => r.pct == null).length]],
      rows: rows.sort((a, b) => (b.delayRisk - a.delayRisk) || (b.late - a.late)),
    };
  },
  periodRange(period, ref = todayISO()) {
    if (period === "today") return [ref, ref];
    if (period === "week") { const s = addDays(ref, -((new Date(ref + "T12:00:00").getDay() + 6) % 7)); return [s, addDays(s, 6)]; }
    const m = ref.slice(0, 7); return [`${m}-01`, this.monthDays(m).at(-1)];
  },
  dashMeetings(period) {
    const [a, b] = this.periodRange(period), today = todayISO();
    const ms = this.db.meetings.filter((m) => m.date && m.date >= a && m.date <= b);
    const held = ms.filter((m) => m.status === "Realizada");
    const ger = ms.filter((m) => m.level === "Gerencial");
    const levels = this.db.settings.lists.meeting_levels, types = this.db.settings.lists.meeting_types;
    return {
      range: [a, b], total: ms.length, held: held.length,
      heldManagerial: held.filter((m) => m.level === "Gerencial").length,
      heldReport: held.filter((m) => m.mtype === "Reporte").length,
      heldPre: held.filter((m) => m.scheduling === "Pré-agendada").length,
      heldUrgent: held.filter((m) => m.scheduling === "Urgente").length,
      managerial: { done: ger.filter((m) => m.status === "Realizada").length, notDone: ger.filter((m) => m.status === "Não realizada").length,
        pending: ger.filter((m) => OPEN_MEETING.includes(m.status) && m.date <= today).length, upcoming: ger.filter((m) => OPEN_MEETING.includes(m.status) && m.date > today).length },
      byLevel: levels.map((l) => [l, held.filter((m) => m.level === l).length]),
      byType: types.map((x) => [x, held.filter((m) => m.mtype === x).length]),
      mandatory: this.mandatoryStatus(today.slice(0, 7)),
      toConfirm: this.db.meetings.filter((m) => OPEN_MEETING.includes(m.status) && m.date && m.date <= today).length,
    };
  },
  dashRisks() {
    const open = this.db.risks.filter((r) => r.status !== "Fechado"), s = this.db.settings;
    const P = ["Alta", "Média", "Baixa"], I = ["Alto", "Médio", "Baixo"];
    const since = addDays(todayISO(), -30);
    return {
      total: open.length, closed: this.db.risks.length - open.length,
      investigate: open.filter((r) => r.mode === "Investigar").length, monitor: open.filter((r) => r.mode !== "Investigar").length,
      critical: open.filter((r) => r.probability === "Alta" && r.impact === "Alto").length,
      stale: open.filter((r) => daysSince(r.updated_at) >= (+s.alert_days_without_update || 15)).length,
      matrix: P.map((p) => I.map((i) => open.filter((r) => (r.probability || "Média") === p && (r.impact || "Médio") === i).length)),
      byImpact: s.lists.impact_types.map((x) => [x, open.filter((r) => (r.impacts || []).includes(x)).length]),
      inputs30: open.reduce((a, r) => a + (r.inputs_log || []).filter((x) => (x.date || "") >= since).length, 0),
      withProjects: open.filter((r) => (r.links?.projects || []).length || (r.links?.items || []).some((i) => (this.find("items", i)?.links?.projects || []).length)).length,
    };
  },

  // ------------------------------------------------------------ tradução automática
  /** Texto do campo no idioma pedido (tradução válida para o texto atual) ou o original. */
  loc(rec, field, lang = I18N.lang) {
    const v = rec?.[field], tr = rec?.tr?.[field];
    if (!v || !tr || tr.hash !== strHash(v) || tr.source === lang || !tr.segments?.length) return v || "";
    return tr.segments.map((x) => x[lang]).filter(Boolean).join(" ") || v;
  },
  /** Lista de [registro, campo] com texto ainda sem tradução atualizada. */
  pendingTranslations(only = null) {
    const out = [];
    const scan = (rec, fields) => { for (const f of fields) { const v = rec[f]; if (typeof v === "string" && v.trim() && !rec.history_user && (!rec.tr?.[f] || rec.tr[f].hash !== strHash(v)) && !(rec.tr?.[f]?.failed === strHash(v))) out.push([rec, f]); } };
    for (const [col, fields] of Object.entries(TRANSLATABLE)) {
      for (const rec of this.db[col] || []) {
        if (only && (only.col !== col || only.id !== rec.id)) continue;
        scan(rec, fields);
        for (const [list, sf] of Object.entries(SUB_TRANSLATABLE)) for (const e of rec[list] || []) if (list !== "history" || !e.msg) scan(e, sf);
      }
    }
    return out;
  },
  async translatePending(only = null, max = 400) {
    let done = 0;
    while (done < max) {
      const pend = this.pendingTranslations(only);
      if (!pend.length) break;
      // lotes de até ~6000 caracteres
      const batch = []; let size = 0;
      for (const p of pend) { const len = p[0][p[1]].length; if (batch.length && size + len > 6000) break; batch.push(p); size += len; }
      const res = await AI.translateBatch(batch.map(([r, f], i) => ({ key: String(i), text: r[f] })));
      batch.forEach(([r, f], i) => {
        const tr = res[String(i)];
        r.tr ??= {};
        if (tr) r.tr[f] = { hash: strHash(r[f]), source: tr.source_lang, segments: tr.segments, at: nowISO() };
        else r.tr[f] = { ...(r.tr[f] || {}), failed: strHash(r[f]) };
      });
      done += batch.length;
      if (!Object.keys(res).length) break; // IA indisponível: para e tenta na próxima alteração
    }
    return done;
  },
  _trq: Promise.resolve(),
  /** Traduz em segundo plano depois de cada alteração (não atrasa o salvamento). */
  queueTranslation() {
    if (!this.db?.settings.auto_translate || !AI.enabled()) return;
    this._trq = this._trq.then(async () => {
      try {
        const n = await this.translatePending(null, 120);
        if (n) { await this.save(); window.dispatchEvent(new Event("gov-translated")); }
      } catch (e) { console.warn("tradução:", e); }
    });
  },

  // ------------------------------------------------------------ roteador local
  async api(path, method = "GET", body = {}) {
    const res = await this.route(path.split("?")[0].replace(/^\/+|\/+$/g, "").split("/"), method, body || {});
    if (method !== "GET" || res?._dirty) await this.save();
    if (res && res._dirty) delete res._dirty;
    if (method !== "GET" && !path.startsWith("translate")) this.queueTranslation();
    return res === undefined ? res : structuredClone(res);
  },

  async route(parts, method, body) {
    const db = this.db;
    const [head, rid, action] = parts;

    if (head === "state" && method === "GET") {
      let dirty = this.autoMeetings();
      for (const p of db.projects) dirty = (await this.syncSchedules(p)) || dirty;
      return { _dirty: dirty, db: Object.fromEntries([...COLLECTIONS, "settings", "flow_examples", "meeting_suggestions", "risk_lessons"].map((k) => [k, db[k]])), events: db.events.slice(-60),
        alerts: this.alerts(), ai: AI.status(), workspace: Store.name, definitions: AI.DEFINITIONS, impact_types: AI.IMPACT_TYPES,
        summaries: db.summaries.slice(-30), today: todayISO() };
    }
    if (head === "settings" && method === "PATCH") {
      for (const [k, v] of Object.entries(body)) {
        if ((k === "lists" || k === "appearance") && v && typeof v === "object") db.settings[k] = { ...db.settings[k], ...v };
        else db.settings[k] = v;
      }
      AI.IMPACT_TYPES = db.settings.lists.impact_types;
      return db.settings;
    }
    if (head === "meeting_suggest" && method === "POST") {
      const month = body.month || todayISO().slice(0, 7);
      const res = await AI.suggestMeetings(db, month);
      db.meeting_suggestions = [...db.meeting_suggestions.filter((x) => !x.date.startsWith(month)),
        ...res.suggestions.map((x, i) => ({ ...x, id: `SUG${Date.now().toString(36)}${i}`, month }))];
      return { suggestions: db.meeting_suggestions, engine: res.engine, error: res.error };
    }
    if (head === "meeting_suggest_accept" && method === "POST") {
      const created = [];
      for (const id of body.ids || []) {
        const sg = db.meeting_suggestions.find((x) => x.id === id);
        if (!sg) continue;
        const m = db.mandatory.find((x) => x.id === sg.mandatory_id) || {};
        const rec = await this.createRecord("meetings", { title: sg.title || m.title, date: sg.date, time: sg.time, status: "Agendada", mandatory_id: m.id,
          level: m.level || "Gerencial", mtype: m.mtype || "Reporte", scheduling: "Pré-agendada", participants: m.participants || "", agenda: m.notes || "", duration: m.duration || 60 });
        created.push(rec.id);
      }
      db.meeting_suggestions = db.meeting_suggestions.filter((x) => !(body.ids || []).includes(x.id) && !(body.discard || []).includes(x.id));
      return { created };
    }
    if (head === "translate" && method === "POST") {
      // traduz agora um registro (col/id) ou tudo o que estiver pendente
      if (!AI.enabled()) throw new ApiError(t("A tradução automática precisa da IA ligada (Configurações → IA)."));
      if (body.force && body.col) { const r = this.find(body.col, body.id); if (r) { delete r.tr; for (const l of Object.keys(SUB_TRANSLATABLE)) for (const e of r[l] || []) delete e.tr; } }
      const n = await this.translatePending(body.col ? { col: body.col, id: body.id } : null);
      return { translated: n, rec: body.col ? this.find(body.col, body.id) : null };
    }
    if (head === "insights" && method === "POST") {
      const metrics = { projects: () => this.dashProjects(), meetings: () => this.dashMeetings(body.period || "month"), risks: () => this.dashRisks() }[body.kind]?.();
      if (!metrics) throw new ApiError("Unknown route");
      const text = await AI.dashboardInsights(body.kind, metrics);
      db.settings.last_insights = { ...(db.settings.last_insights || {}), [body.kind]: { text, at: nowISO() } };
      return { text };
    }
    if (head === "backup" && method === "POST") {
      // restaura um db.json exportado (substitui a base atual; a anterior é guardada em BACKUPS/)
      const incoming = body.db;
      if (!incoming || !Array.isArray(incoming.items) || !incoming.seq) throw new ApiError(t("Arquivo de backup inválido"));
      await Store.write(`BACKUPS/db_${nowISO().replace(/[:T]/g, "-")}.json`, JSON.stringify(db, null, 2));
      this.normalize(incoming);
      this.db = incoming;
      AI.IMPACT_TYPES = incoming.settings.lists.impact_types;
      return { ok: true };
    }

    if (head === "summary" && method === "POST") {
      const kind = body.type || "daily";
      const summary = this.buildSummary(kind, body.date || todayISO());
      const text = body.narrative === false ? "" : await AI.narrative(summary);
      const file = `SUMMARIES/${kind === "weekly" ? "semanal" : "diario"}_${summary.period.start}_${I18N.lang}.html`;
      await Store.write(file, this.summaryHtml(summary, text));
      db.summaries = db.summaries.filter((x) => x.file !== file);
      db.summaries.push({ type: kind, period: summary.period, file, generated_at: nowISO() });
      return { summary, narrative: text, file };
    }

    if (!COLLECTIONS.includes(head) || head === "actions") throw new ApiError("Unknown route");
    const col = head;

    if (method === "POST" && !rid) {
      const data = { ...body };
      delete data.id;
      if (col === "meetings" && data.status === "Solicitada") data.requested_at ??= todayISO();
      const rec = await this.createRecord(col, data);
      if (col === "inputs") {
        rec.status = "Novo";
        if (rec.meeting_id) this.link("inputs", rec.id, "meetings", rec.meeting_id);
      }
      const proj = col === "meetings" && rec.project_id ? this.find("projects", rec.project_id) : null;
      if (proj) {
        this.link("meetings", rec.id, "projects", proj.id);
        if (rec.status === "Realizada") {
          proj.next_meeting = addDays(rec.date, +db.settings.project_meeting_cadence_days || 15);
          proj.last_monitored = todayISO();
        }
      }
      if (col === "flows" && rec.scope_col && rec.scope_col !== "geral") this.link("flows", rec.id, rec.scope_col, rec.scope_id);
      return rec;
    }

    const rec = rid ? this.find(col, rid) : null;
    if (rid && !rec) throw new ApiError(t("{id} não encontrado", { id: rid }));

    if (method === "GET" && rec && !action) return rec;
    if (method === "PATCH" && rec && !action) {
      const data = { ...body };
      for (const k of ["id", "created_at", "links", "folder", "pitems", "activities", "scenarios", "inputs_log", "actions", "schedules", "item_actions"]) delete data[k];
      const note = data._note, silent = data._silent;
      delete data._note; delete data._silent;
      Object.assign(rec, data);
      if (note) (rec.history ??= []).push({ date: nowISO(), text: note });  // texto do usuário: não traduzido
      if (col === "projects") rec.last_monitored = todayISO();
      this.touch(rec);
      if (note) this.log(`${col}.updated`, rid, "{id} atualizado: {note}", { id: rid, note });
      else if (!silent) this.log(`${col}.updated`, rid, "{id} atualizado", { id: rid });
      return rec;
    }
    if (method === "DELETE" && rec) {
      db[col] = db[col].filter((r) => r.id !== rid);
      for (const other of COLLECTIONS) for (const r of db[other]) {
        const lst = r.links?.[col];
        if (lst?.includes(rid)) lst.splice(lst.indexOf(rid), 1);
      }
      this.log(`${col}.deleted`, rid, "{id} removido (a pasta local foi mantida)", { id: rid });
      return { ok: true };
    }

    // ---- ações específicas
    if (method === "POST" && action === "link") {
      if (!this.find(body.collection, body.id)) throw new ApiError(t("{id} não encontrado", { id: body.id }));
      this.link(col, rid, body.collection, body.id);
      this.log("link", rid, "{a} vinculado a {b}", { a: rid, b: body.id });
      return rec;
    }
    if (col === "inputs" && action === "suggest") {
      rec.ai_suggestion = await AI.assessInput(db, rec);
      rec.status = "Em avaliação";
      this.touch(rec);
      return rec;
    }
    if (col === "inputs" && action === "commit") return { input: rec, created: await this.commitInput(rec, body) };
    if (col === "projects" && action === "upload") {
      const sub = (body.kind || "schedule") === "schedule" ? "master_schedule" : "documentos";
      const rel = await Store.writeUnique(`${rec.folder}/${sub}`, body.file.name, body.file);
      await this.syncSchedules(rec);
      rec.last_monitored = todayISO();
      this.touch(rec);
      this.log("projects.upload", rid, "Upload em {id}: {file}", { id: rid, file: rel.split("/").pop() });
      return rec;
    }
    if (col === "projects" && action === "analyze") {
      const sched = rec.schedules.find((s) => s.rel === body.rel);
      const file = sched && (await Store.read(sched.rel));
      if (!file) throw new ApiError(t("Cronograma não encontrado na pasta"));
      sched.analysis = await AI.analyzeSchedule(rec, file, todayISO());
      sched.analyzed_at = nowISO();
      this.touch(rec);
      this.log("projects.analyzed", rid, "Master schedule de {id} analisada: {file}", { id: rid, file: sched.name });
      return rec;
    }
    if (col === "projects" && action === "actions") {
      if (body.id) {
        const act = rec.actions.find((a) => a.id === body.id);
        if (!act) throw new ApiError(t("Ação não encontrada"));
        Object.assign(act, body);
      } else {
        rec.actions.push({ ...body, id: this.nextId("actions"), status: body.status || "Aberta", created_at: nowISO() });
      }
      rec.last_monitored = todayISO();
      this.touch(rec);
      if (body.id) this.log("projects.action", rid, "Portfólio {id}: ação {act} → {status}", { id: rid, act: body.id, status: [body.status || ""] });
      else this.log("projects.action", rid, "Portfólio {id}: ação {act} criada", { id: rid, act: rec.actions.at(-1).id });
      return rec;
    }
    if (["risks", "meetings", "items"].includes(col) && action === "upload") {
      const rel = await Store.writeUnique(this.folderFor(col, rid), body.file.name, body.file);
      this.touch(rec);
      this.log(`${col}.upload`, rid, "Documento anexado a {id}: {file}", { id: rid, file: rel.split("/").pop() });
      return rec;
    }
    if (action === "files" && method === "GET") return Store.list(rec.folder || this.folderFor(col, rid));
    if (col === "risks" && action === "analyze") {
      rec.analysis = await AI.analyzeRisk(db, rec, await this.filesText(rec.folder));
      this.touch(rec);
      this.log("risks.analyzed", rid, "Risco {id} analisado", { id: rid });
      return rec;
    }
    if (action === "sub" && SUB_LISTS[col]?.includes(body.list)) {
      const list = (rec[body.list] ??= []);
      let entry = null;
      if (body.remove) {
        rec[body.list] = list.filter((x) => x.id !== body.remove);
      } else if (body.entry?.id) {
        entry = list.find((x) => x.id === body.entry.id);
        if (!entry) throw new ApiError(t("{id} não encontrado", { id: body.entry.id }));
        const wasDone = entry.status === "Finalizado";
        Object.assign(entry, body.entry, { updated_at: nowISO() });
        if (body.list === "pitems" && entry.status === "Finalizado" && !wasDone) {
          entry.done_at = todayISO();
          this.log("projects.item_done", rid, "Item {sub} de {id} finalizado — projeto {pct}% concluído", { sub: entry.id, id: rid, pct: this.projectPct(rec) });
        }
      } else {
        entry = { ...body.entry, id: this.subId(rec, body.list), created_at: nowISO() };
        list.push(entry);
        if (body.list === "inputs_log" && body.to_inputs) {
          const inp = await this.createRecord("inputs", { source: entry.source || "Outro", source_detail: "Atualização de item existente", title: `${rec.id}: ${entry.text.slice(0, 80)}`,
            description: entry.text, origin: entry.author || "", risk_id: rec.id });
          inp.status = "Novo";
          this.link("inputs", inp.id, "risks", rec.id);
          entry.input_id = inp.id;
        }
      }
      if (col === "projects") rec.last_monitored = todayISO();
      this.touch(rec);
      if (!(body.list === "pitems" && entry?.status === "Finalizado")) this.log(`${col}.sub`, rid, "{id}: {list} atualizado", { id: rid, list: [SUB_LABEL[body.list]] });
      return rec;
    }
    if (col === "projects" && action === "import") {
      if (body.file) await Store.writeUnique(`${rec.folder}/master_schedule`, body.file.name, body.file);
      const res = this.importActivities(rec, body.rows || [], +body.header_row || 0, body.mapping || {});
      await this.syncSchedules(rec);
      rec.last_monitored = todayISO();
      this.touch(rec);
      this.log("projects.import", rid, "Planilha importada em {id}: {added} novas atividades, {updated} atualizadas", { id: rid, ...res });
      return { project: rec, result: res };
    }
    if (col === "meetings" && action === "status") {
      const proj = rec.project_id ? this.find("projects", rec.project_id) : null;
      rec.status = body.status;
      if (body.note) (rec.history ??= []).push({ date: nowISO(), text: body.note });
      if (body.status === "Realizada") {
        rec.held_at = body.date || rec.date || todayISO();
        if (proj) { proj.next_meeting = addDays(rec.held_at, +db.settings.project_meeting_cadence_days || 15); proj.last_monitored = todayISO(); }
        this.log("meetings.done", rid, "Reunião {id} confirmada como realizada", { id: rid });
      } else if (body.status === "Cancelada") {
        this.log("meetings.cancelled", rid, "Reunião {id} cancelada", { id: rid });
      } else if (body.status === "Não realizada") {
        if (proj) proj.next_meeting = body.new_date || addDays(todayISO(), 7);
        this.log("meetings.not_done", rid, "Reunião {id} não realizada", { id: rid });
      }
      this.touch(rec);
      return rec;
    }
    if (col === "flows" && action === "generate") {
      let g;
      if (body.mode === "ai") g = await AI.generateFlow(db, rec, body.description ?? rec.description ?? "");
      else g = this.flowFromData(rec.scope_col, rec.scope_id);
      if (body.description !== undefined) rec.description = body.description;
      rec.nodes = g.nodes; rec.edges = g.edges; rec.engine = g.engine || "dados";
      this.touch(rec);
      this.log("flows.generated", rid, "Fluxo {id} gerado", { id: rid });
      return rec;
    }
    if (col === "items" && action === "merge") return this.mergeItems(rid, (body.into || "").toUpperCase());
    if (col === "items" && action === "progress") {
      // registro de progresso (histórico geral do item), opcionalmente ligado a uma ação do item
      const act = body.action_id ? rec.item_actions.find((x) => x.id === body.action_id) : null;
      if (act) { act.progress = body.text; act.updated_at = nowISO(); if (body.status) act.status = body.status; }
      (rec.history ??= []).push({ date: nowISO(), text: body.text, action_id: body.action_id || "", kind: "progress" });
      if (body.status_item) rec.status = body.status_item;
      this.touch(rec);
      this.log("items.progress", rid, "{id} atualizado: {note}", { id: rid, note: body.text });
      return rec;
    }
    if (action === "teach" && ["items", "risks", "inputs"].includes(col)) {
      // análise de risco do usuário: fica no registro e vira exemplo para a IA
      const lesson = { date: nowISO(), ref: rid, col, text: col === "risks" ? `${rec.title || ""} ${rec.description || ""}` : AI.itemText(rec) + " " + AI.inputText(rec),
        analysis: body.analysis || "", level: body.level || "", factors: body.factors || [] };
      rec.risk_analysis = { analysis: lesson.analysis, level: lesson.level, factors: lesson.factors, date: lesson.date };
      db.risk_lessons = [...db.risk_lessons.filter((x) => x.ref !== rid), lesson].slice(-200);
      this.touch(rec);
      this.log(`${col}.teach`, rid, "Análise de risco de {id} registrada para a IA aprender", { id: rid });
      return rec;
    }
    if (col === "flows" && action === "learn") {
      db.flow_examples.push({ date: nowISO(), title: rec.title, scope: `${rec.scope_col}:${rec.scope_id || ""}`, description: rec.description || "",
        nodes: (rec.nodes || []).map((n) => ({ key: n.id, label: n.label, type: n.type })), edges: (rec.edges || []).map((e) => ({ from: e.from, to: e.to, label: e.label })) });
      db.flow_examples = db.flow_examples.slice(-10);
      this.log("flows.learned", rid, "Fluxo {id} salvo como exemplo para a IA", { id: rid });
      return rec;
    }
    if (col === "meetings" && action === "extract") {
      const out = await AI.extractMeeting(db, rec);
      rec.extraction = out;
      if (out.decisions?.length) rec.decisions = out.decisions;
      this.touch(rec);
      return rec;
    }
    throw new ApiError("Unknown route");
  },
};
