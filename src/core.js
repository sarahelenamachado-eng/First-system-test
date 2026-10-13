/* Núcleo: base de dados (db.json na pasta escolhida), regras de governança e um "roteador" local
 * com as mesmas rotas que a interface usa (api("inputs/INP001/commit", "POST", {...})). */
const PREFIX = { inputs: "INP", items: "GOV", projects: "PROJ", risks: "RISK", meetings: "MEET", actions: "ACT" };
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
    events: [], feedback: [], summaries: [],
    settings: {
      alert_days_without_update: 15,
      project_meeting_cadence_days: 15,
      links_for_project_alert: 3,
      areas: ["Operação", "Manutenção", "RH", "Financeiro", "Jurídico", "Compras", "SSMA", "TI", "Comercial", "Engenharia"],
    },
  });
}

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
      db.settings = { ...base.settings, ...db.settings };
    }
    this.db = db;
    if (!f) await this.save();
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
      rec.last_monitored = todayISO();
      rec.next_meeting ??= addDays(todayISO(), +db.settings.project_meeting_cadence_days || 15);
      rec.folder = this.folderFor("projects", rec.id);
      await Store.dir(rec.folder + "/master_schedule");
      await Store.dir(rec.folder + "/documentos");
    } else if (col === "risks") {
      rec.status ??= "Aberto";
      rec.mode ??= "Monitorar";
      rec.folder = this.folderFor("risks", rec.id);
      await Store.write(rec.folder + "/LEIA-ME.txt", `${rec.id} INFOS AND GENERAL OVERVIEW\n${rec.title || ""}\n\n`
        + "Coloque aqui todas as informações e documentos a cerca do problema.\n"
        + "A plataforma compila estes arquivos para análise e reporte.\n");
    } else if (col === "meetings") {
      rec.date ||= todayISO();
    } else if (col === "items") {
      rec.status ??= "Aberto";
    }
    db[col].push(rec);
    this.log(`${col}.created`, rec.id, "{id} criado: {label}", { id: rec.id, label: rec.title || rec.name || "" });
    return rec;
  },

  /** Etapas 2 e 3 do fluxo: registra a classificação e a definição, cria/atualiza o item e os módulos ligados. */
  async commitInput(inp, body) {
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
      if ((L.inputs || []).length >= n) add("media", it.id, "{id} recebeu {n} entradas: tema recorrente.", { id: it.id, n: L.inputs.length });
    }
    for (const r of db.risks) {
      if (r.status !== "Fechado" && daysSince(r.updated_at) >= limit) add("media", r.id, "Risco {id} sem atualização há {d} dias.", { id: r.id, d: daysSince(r.updated_at) });
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
    for (const i of newInputs) (bySource[i.source || "Outro"] ??= []).push({ id: i.id, title: i.title, status: i.status });
    const updIds = new Set(events.filter((ev) => ev.type.startsWith("items.")).map((ev) => ev.ref));
    const horizon = addDays(e, 7);
    const brief = (i) => ({ id: i.id, title: i.title, owner: i.owner, due_date: i.due_date, priority: i.priority, status: i.status });
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
      projects: activeP.map((p) => ({ id: p.id, name: p.name, status: p.status, next_meeting: p.next_meeting,
        open_actions: (p.actions || []).filter((a) => a.status !== "Concluída").length, last_monitored: p.last_monitored })),
      risks: openR.map((r) => ({ id: r.id, title: r.title, mode: r.mode, probability: r.probability, impact: r.impact, status: r.status })),
      meetings: db.meetings.filter((m) => inr(m.date)).map((m) => ({ id: m.id, title: m.title, date: m.date, decisions: m.decisions || [], items: m.links?.items || [] })),
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
<style>body{font:14px system-ui;margin:32px;color:#1f2937}h1{margin:0}h2{border-bottom:2px solid #1e3a8a;padding-bottom:4px;margin-top:28px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #d1d5db;padding:4px 8px;text-align:left}.k{display:inline-block;margin:6px 12px 6px 0;padding:8px 12px;background:#eef2ff;border-radius:8px}</style>
<h1>${esc(t(s.type))}</h1><p>${esc(t("Período"))}: ${esc(s.period.start)} – ${esc(s.period.end)} · ${esc(t("gerado"))} ${esc(s.generated_at)}</p>
<h2>1. ${esc(t("Destaques"))}</h2><div style="white-space:pre-wrap">${esc(text)}</div>
<h2>2. ${esc(t("Indicadores"))}</h2>${kp.map(([n, v]) => `<span class=k><b>${v}</b> ${esc(t(n))}</span>`).join("")}
<h2>3. ${esc(t("Novas demandas por origem"))}</h2>${Object.entries(s.inputs_by_source).map(([src, l]) => `<h3>${esc(t(src))}</h3><table>${rows(l, ["id", "title", "status"])}</table>`).join("") || "<p>—</p>"}
<h2>4. ${esc(t("Itens críticos (alta prioridade)"))}</h2><table>${th(["ID", "Título", "Responsável", "Prazo", "Status"])}${rows(s.critical_items, ["id", "title", "owner", "due_date", "status"])}</table>
<h2>5. ${esc(t("Prazos — vencidos e próximos 7 dias"))}</h2><table>${th(["ID", "Título", "Responsável", "Prazo"])}${rows(s.due_items, ["id", "title", "owner", "due_date"])}</table>
<h2>6. ${esc(t("Projetos"))}</h2><table>${th(["ID", "Projeto", "Status", "Ações abertas", "Próx. reunião"])}${rows(s.projects, ["id", "name", "status", "open_actions", "next_meeting"])}</table>
<h2>7. ${esc(t("Riscos"))}</h2><table>${th(["ID", "Risco", "Modo", "Prob.", "Impacto"])}${rows(s.risks, ["id", "title", "mode", "probability", "impact"])}</table>
<h2>8. ${esc(t("Reuniões e decisões"))}</h2>${s.meetings.map((m) => `<p><b>${esc(m.id)} — ${esc(m.title)}</b> (${esc(m.date)})<br>${m.decisions.map(esc).join("<br>") || esc(t("Sem decisões registradas"))}</p>`).join("") || "<p>—</p>"}
<h2>9. ${esc(t("Infos a reportar"))}</h2><table>${th(["ID", "Título", "Responsável", "Status"])}${rows(s.report_items, ["id", "title", "owner", "status"])}</table>
<h2>10. ${esc(t("Alertas"))}</h2><ul>${s.alerts.map((a) => `<li>${esc(msgOf(a))}</li>`).join("") || "<li>—</li>"}</ul>`;
  },

  // ------------------------------------------------------------ roteador local
  async api(path, method = "GET", body = {}) {
    const res = await this.route(path.split("?")[0].replace(/^\/+|\/+$/g, "").split("/"), method, body || {});
    if (method !== "GET" || res?._dirty) await this.save();
    if (res && res._dirty) delete res._dirty;
    return res === undefined ? res : structuredClone(res);
  },

  async route(parts, method, body) {
    const db = this.db;
    const [head, rid, action] = parts;

    if (head === "state" && method === "GET") {
      let dirty = false;
      for (const p of db.projects) dirty = (await this.syncSchedules(p)) || dirty;
      return { _dirty: dirty, db: Object.fromEntries([...COLLECTIONS, "settings"].map((k) => [k, db[k]])), events: db.events.slice(-60),
        alerts: this.alerts(), ai: AI.status(), workspace: Store.name, definitions: AI.DEFINITIONS, impact_types: AI.IMPACT_TYPES,
        summaries: db.summaries.slice(-30), today: todayISO() };
    }
    if (head === "settings" && method === "PATCH") { Object.assign(db.settings, body); return db.settings; }

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
      const rec = await this.createRecord(col, data);
      if (col === "inputs") {
        rec.status = "Novo";
        if (rec.meeting_id) this.link("inputs", rec.id, "meetings", rec.meeting_id);
      }
      const proj = col === "meetings" && rec.project_id ? this.find("projects", rec.project_id) : null;
      if (proj) {
        this.link("meetings", rec.id, "projects", proj.id);
        proj.next_meeting = addDays(rec.date, +db.settings.project_meeting_cadence_days || 15);
        proj.last_monitored = todayISO();
      }
      return rec;
    }

    const rec = rid ? this.find(col, rid) : null;
    if (rid && !rec) throw new ApiError(t("{id} não encontrado", { id: rid }));

    if (method === "GET" && rec && !action) return rec;
    if (method === "PATCH" && rec && !action) {
      const data = { ...body };
      for (const k of ["id", "created_at", "links", "folder"]) delete data[k];
      const note = data._note;
      delete data._note;
      Object.assign(rec, data);
      if (note) (rec.history ??= []).push({ date: nowISO(), text: note });  // texto do usuário: não traduzido
      if (col === "projects") rec.last_monitored = todayISO();
      this.touch(rec);
      if (note) this.log(`${col}.updated`, rid, "{id} atualizado: {note}", { id: rid, note });
      else this.log(`${col}.updated`, rid, "{id} atualizado", { id: rid });
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
