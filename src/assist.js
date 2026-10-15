/* Assistente de IA.
 *
 * - Registro rápido: o usuário escreve o que aconteceu (vários projetos e reuniões no mesmo dia) e o
 *   assistente propõe onde registrar cada ponto: progresso em projeto, progresso em item, item novo na
 *   lista geral, entrada para triagem ou reunião realizada.
 * - Alocação das demandas extraídas das atas na lista geral, com o mesmo mecanismo.
 * - Sugestão de horário para qualquer reunião (regras do usuário + agenda livre).
 * - Aprendizado: cada proposta confirmada ou corrigida vira exemplo (db.assist_examples). Os casos parecidos
 *   orientam a heurística offline e o Claude. Com o tempo a taxa de acerto sobe e dá para deixar a IA aplicar sozinha.
 */
const ASSIST_KINDS = ["item_new", "item_progress", "project_progress", "input", "meeting", "ignore"];
const ASSIST_KIND_LABEL = {
  item_new: "Novo item na lista geral", item_progress: "Progresso em item existente", project_progress: "Progresso em projeto",
  input: "Enviar para Entradas (triagem)", meeting: "Registrar reunião realizada", ignore: "Ignorar",
};
const needsTarget = (k) => k === "item_progress" || k === "project_progress";

// ------------------------------------------------------------------ IA / heurística
Object.assign(AI, {
  LIST_MARK: /^\s*(\d{1,2}\s*[.)\-–]|[-•*▪●○■□►])\s*/,
  /** Texto livre -> pontos (um por linha; texto corrido longo é dividido em frases). */
  segments(text) {
    let lines = String(text || "").split(/\r?\n/).map((l) => l.replace(this.LIST_MARK, "").trim()).filter(Boolean);
    if (lines.length === 1 && lines[0].length > 160) lines = lines[0].split(/(?<=[.!?;。！？；])\s+/).map((x) => x.trim()).filter(Boolean);
    return lines.map((l) => ({ text: l, title: l.slice(0, 160) }));
  },
  parseDue(s) {
    const iso = (s.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (iso) return iso;
    const m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (!m) return "";
    const y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : todayISO().slice(0, 4);
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  },
  parseOwner(s) {
    return ((s.match(/(?:resp(?:ons[aá]vel)?|owner|负责人)\s*[:：\-]\s*([^\d,;，；()]+)/i) || [])[1] || "").trim();
  },
  similarAssist(db, text, limit = 6) {
    return (db.assist_examples || []).map((x) => [this.similarity(text, x.text || ""), x]).filter(([s]) => s > 0.2)
      .sort((a, b) => b[0] - a[0]).slice(0, limit);
  },
  activeProjects: (db) => db.projects.filter((p) => !["Concluído", "Cancelado"].includes(p.status)),

  heuristicProposal(db, seg, ctx) {
    const text = seg.text, valid = (k, id) => (k === "project_progress" ? !!Core.find("projects", id) : k === "item_progress" ? !!Core.find("items", id) : true);
    const clean = (x) => x.replace(/\s*(?:resp(?:ons[aá]vel)?|owner|负责人)\s*[:：\-].*$/i, "").replace(/\s*\b\d{4}-\d{2}-\d{2}\b|\s*\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, "").trim() || x;
    const base = { text, title: clean(seg.title || text), owner: seg.owner || this.parseOwner(text), due_date: seg.due_date || this.parseDue(text), area_main: seg.area_main || "",
      date: todayISO(), time: "", duration: 60 };
    const out = (kind, target, reason) => ({ ...base, kind, target: target || "", reason });
    // 1) caso parecido que o usuário já decidiu
    const [best] = this.similarAssist(db, text, 1);
    if (best && best[0] >= 0.55 && valid(best[1].final.kind, best[1].final.target))
      return out(best[1].final.kind, best[1].final.target, ["Como você decidiu num caso parecido: «{ex}»", { ex: best[1].text.slice(0, 60) }]);
    // 2) ID citado
    const pid = (text.match(/\bPROJ\d{3,}\b/i) || [])[0]?.toUpperCase(), gid = (text.match(/\bGOV\d{3,}\b/i) || [])[0]?.toUpperCase();
    if (pid && Core.find("projects", pid)) return out("project_progress", pid, ["Cita {id}", { id: pid }]);
    if (gid && Core.find("items", gid)) return out("item_progress", gid, ["Cita {id}", { id: gid }]);
    // 3) item ligado pela extração / parecido com item ou projeto existente
    if (seg.related_item && Core.find("items", seg.related_item)) return out("item_progress", seg.related_item, ["Parecido com o item {id}", { id: seg.related_item }]);
    const proj = this.activeProjects(db).map((p) => [Math.max(this.similarity(text, p.name || ""), this.similarity(text, `${p.name || ""} ${p.description || ""}`) * 0.8), p])
      .sort((a, b) => b[0] - a[0])[0];
    const item = this.relatedItems(db, text, 1, 0.5)[0];
    if (proj && proj[0] >= 0.5 && (!item || proj[0] >= item.score)) return out("project_progress", proj[1].id, ["Parecido com o projeto {id}", { id: proj[1].id }]);
    if (item) return out("item_progress", item.id, ["Parecido com o item {id}", { id: item.id }]);
    // 4) reunião (só no registro livre)
    if (!ctx.meeting && /reuni[aã]o|meeting|会议|call\b|alinhamento com/i.test(text) && /\d{1,2}\s*(h|:)\s*\d{0,2}|\d+\s*min/i.test(text)) {
      const p = out("meeting", "", ["Parece uma reunião (horário/duração citados)", {}]);
      const tm = text.match(/\b(\d{1,2})(?:h|:)(\d{2})?(?!\d|\s*min)/i), dur = text.match(/(\d+)\s*min/i);
      if (tm) p.time = `${pad(+tm[1])}:${tm[2] || "00"}`;
      p.duration = dur ? +dur[1] : 60;
      const who = text.match(/\b(?:com|with)\s+([^.;\d]+)|[与和]([^。；\d]+)/i);
      if (who) p.owner = splitNames(who[1] || who[2]).join(", ");
      p.title = text.replace(/\b\d{1,2}(?:h|:)\d{0,2}\b|\d+\s*min\b|\b(?:com|with)\s+[^.;\d]+$/gi, "").replace(/\s{2,}/g, " ").trim() || text;
      return p;
    }
    return out("item_new", "", ["Assunto novo: vira item na lista geral", {}]);
  },

  get CAPTURE_SCHEMA() {
    const S = { type: "string" };
    return {
      type: "object", additionalProperties: false, required: ["proposals"],
      properties: { proposals: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["text", "title", "kind", "target_id", "owner", "due_date", "date", "time", "duration", "area_main", "reason"],
        properties: { text: S, title: S, kind: { type: "string", enum: ASSIST_KINDS }, target_id: { type: "string", description: "PROJ… ou GOV… quando kind é project_progress / item_progress, senão vazio" },
          owner: { type: "string", description: "Responsável (ou participantes, para kind=meeting)" }, due_date: { type: "string", description: "AAAA-MM-DD ou vazio" },
          date: { type: "string", description: "Data da reunião AAAA-MM-DD (kind=meeting)" }, time: { type: "string", description: "HH:MM ou vazio" },
          duration: { type: "integer", description: "minutos (kind=meeting)" }, area_main: S, reason: { type: "string", description: "Uma frase curta" } } } } },
    };
  },

  /** Propostas de registro para texto livre ou para as demandas de uma reunião (ctx.demands). */
  async capture(db, text, ctx = {}) {
    const segs = ctx.demands ? ctx.demands.map((d) => ({ text: d.description && d.description !== d.title ? `${d.title} — ${d.description}` : d.title, title: d.title,
      owner: d.owner, due_date: d.due_date, area_main: d.area_main, related_item: d.related_item })) : this.segments(text);
    const heur = () => segs.map((s) => this.heuristicProposal(db, s, ctx));
    const finish = (ps, engine, error) => ({ proposals: ps.map((p) => ({ ...p, ai: { kind: p.kind, target: p.target || "" } })), engine, error });
    if (!segs.length) return finish([], "heuristica");
    if (!this.enabled()) return finish(heur(), "heuristica");
    const J = (x) => JSON.stringify(x);
    const projects = this.activeProjects(db).map((p) => ({ id: p.id, name: p.name, main: p.main, description: (p.description || "").slice(0, 200) }));
    const items = db.items.filter((i) => i.status !== "Concluído").slice(-150).map((i) => ({ id: i.id, title: i.title, area: i.area_main, projects: i.links?.projects || [] }));
    const examples = [...new Map(segs.flatMap((s) => this.similarAssist(db, s.text, 3)).map(([, x]) => [x.date + x.text, x])).values()].slice(0, 12)
      .map((x) => ({ texto: x.text, ia_sugeriu: x.ai, usuario_decidiu: x.final }));
    const prompt = `Você é o assistente pessoal de governança do usuário, que participa de muitas reuniões e projetos por dia. Hoje é ${todayISO()}.\n`
      + (ctx.meeting ? `Demandas extraídas da reunião "${ctx.meeting.title || ""}" (${ctx.meeting.date || ""}). Retorne exatamente uma proposta por demanda, na mesma ordem:\n${J(segs)}\n\n`
        : `Anotações livres do usuário. Divida em registros, um por assunto, e proponha onde registrar cada um:\n${text}\n\n`)
      + "Destinos (kind): project_progress = atualização de um projeto existente (target_id = PROJ…); item_progress = andamento de um item existente da lista geral (target_id = GOV…); "
      + "item_new = assunto novo que deve entrar na lista geral; input = demanda que precisa de triagem completa (avaliar risco, criar projeto…); "
      + "meeting = o usuário relata uma reunião que aconteceu (preencha date, time, duration, owner = participantes); ignore = sem valor de registro.\n"
      + "Prefira atualizar o que já existe a criar itens novos. Escreva title claro e acionável.\n\n"
      + `Projetos ativos:\n${J(projects)}\n\nItens em aberto na lista geral:\n${J(items)}\n\n`
      + `Regras do usuário para alocar (siga com prioridade):\n${db.settings.assist_rules || "(nenhuma)"}\n\n`
      + `Decisões anteriores do usuário em casos parecidos (aprenda e repita o critério):\n${J(examples)}`;
    try {
      const out = await this.call(prompt, this.CAPTURE_SCHEMA, "medium");
      const ps = out.proposals.map((p) => {
        let kind = p.kind, target = (p.target_id || "").toUpperCase();
        if (kind === "project_progress" && !Core.find("projects", target)) { kind = "item_new"; target = ""; }
        if (kind === "item_progress" && !Core.find("items", target)) { kind = "item_new"; target = ""; }
        if (!needsTarget(kind)) target = "";
        return { text: p.text, title: p.title || p.text, kind, target, owner: p.owner, due_date: /^\d{4}-\d{2}-\d{2}$/.test(p.due_date) ? p.due_date : "",
          date: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : todayISO(), time: /^\d{2}:\d{2}$/.test(p.time) ? p.time : "", duration: +p.duration || 60, area_main: p.area_main, reason: p.reason };
      });
      return finish(ps, this.model);
    } catch (e) {
      return finish(heur(), "heuristica", e.message);
    }
  },

  SLOT_SCHEMA: {
    type: "object", additionalProperties: false, required: ["options"],
    properties: { options: { type: "array", items: { type: "object", additionalProperties: false, required: ["date", "time", "reason"],
      properties: { date: { type: "string", description: "AAAA-MM-DD" }, time: { type: "string", description: "HH:MM" }, reason: { type: "string" } } } } },
  },
  /** Sugestão de data/horário para qualquer reunião, pelas regras do usuário e pela agenda livre. */
  async suggestSlot(db, req) {
    const base = Core.freeSlots({ from: req.from, duration: +req.duration || 60, count: this.enabled() ? 8 : 3 });
    if (!this.enabled()) return { options: base, engine: "heuristica" };
    const from = req.from && req.from > todayISO() ? req.from : todayISO();
    const busy = db.meetings.filter((m) => m.date && m.date >= from && m.date <= addDays(from, 21) && !["Cancelada", "Não realizada"].includes(m.status))
      .map((m) => ({ date: m.date, time: m.time || "", duration: +m.duration || 60, title: m.title, attendees: m.attendees || [] }));
    const prompt = `Sugira 3 opções de data e horário para a reunião abaixo (hoje é ${todayISO()} ${localISO().slice(11, 16)}; nada no passado).\n`
      + `Reunião: ${J2(req)}\nExpediente: ${db.settings.work_hours.start}–${db.settings.work_hours.end}, segunda a sexta.\n`
      + `Regras e observações do usuário (valem para todas as reuniões; siga com prioridade):\n${db.settings.meeting_rules || "(nenhuma)"}\n\n`
      + `Agenda já ocupada (evite conflitos, inclusive dos participantes):\n${J2(busy)}\n\nHorários livres calculados (pode usar ou melhorar):\n${J2(base)}\n\n`
      + "Em reason, uma frase curta dizendo por que o horário respeita as regras.";
    try {
      const out = await this.call(prompt, this.SLOT_SCHEMA, "low");
      const opts = out.options.filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date) && /^\d{2}:\d{2}$/.test(o.time) && o.date >= todayISO()).slice(0, 3);
      return { options: opts.length ? opts : base.slice(0, 3), engine: this.model };
    } catch (e) {
      return { options: base.slice(0, 3), engine: "heuristica", error: e.message };
    }
  },
});
const J2 = (x) => JSON.stringify(x);

// ------------------------------------------------------------------ regras de negócio
Object.assign(Core, {
  assistStats() {
    const all = this.db.assist_examples || [], ex = all.slice(-30), ok = ex.filter((x) => x.ok).length;
    return { n: ex.length, ok, pct: ex.length ? Math.round((ok / ex.length) * 100) : 0, total: all.length };
  },
  /** Primeiro horário livre de cada dia útil a partir de `from`, respeitando expediente, almoço e regras simples. */
  freeSlots({ from = "", duration = 60, count = 3 }) {
    const db = this.db, today = todayISO();
    const toMin = (h) => { const [a, b] = (h || "09:00").split(":").map(Number); return a * 60 + (b || 0); };
    const toHH = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
    let start = toMin(db.settings.work_hours.start || "08:00"), end = toMin(db.settings.work_hours.end || "18:00");
    const rules = AI.norm(db.settings.meeting_rules || "");
    if (/(so|somente|apenas)\s+(a|de|pela)\s+tarde|only (in the )?afternoon|只在下午/.test(rules)) start = Math.max(start, 13 * 60);
    if (/(so|somente|apenas)\s+(de|pela)\s+manha|only (in the )?morning|只在上午/.test(rules)) end = Math.min(end, 12 * 60);
    const busy = db.meetings.filter((m) => m.date && m.time && !["Cancelada", "Não realizada"].includes(m.status)).map((m) => [m.date, toMin(m.time), toMin(m.time) + (+m.duration || 60)]);
    const now = toMin(localISO().slice(11, 16)), out = [];
    let d = from && from > today ? from : today;
    for (let i = 0; i < 40 && out.length < count; i++, d = addDays(d, 1)) {
      if ([0, 6].includes(this.weekday(d))) continue;
      for (let tm = start; tm + duration <= end; tm += 30) {
        if (d === today && tm < now + 30) continue;
        if (tm < 13 * 60 && tm + duration > 12 * 60) continue;  // almoço
        if (busy.some(([bd, bs, be]) => bd === d && tm < be && tm + duration > bs)) continue;
        out.push({ date: d, time: toHH(tm), reason: "Primeiro horário livre do dia, dentro do expediente e das suas regras." });
        break;
      }
    }
    return out;
  },
  /** Aplica as propostas confirmadas/corrigidas pelo usuário e guarda cada decisão como exemplo. */
  async applyProposals(list, ctx = {}) {
    const db = this.db, m = ctx.meeting_id ? this.find("meetings", ctx.meeting_id) : null, results = [];
    const origin = m ? m.title || m.id : t("Assistente");
    for (const p of list) {
      const text = (p.text || p.title || "").trim(), title = (p.title || p.text || "").trim().slice(0, 200);
      if (p.ai && !ctx.auto) db.assist_examples.push({ date: nowISO(), text: text.slice(0, 400), ai: p.ai, final: { kind: p.kind, target: p.target || "" },
        ok: p.ai.kind === p.kind && (p.ai.target || "") === (p.target || "") });
      if (!title || p.kind === "ignore") { results.push({ kind: "ignore", title }); continue; }
      if (p.kind === "item_new") {
        const dup = this.findDuplicates(title)[0];
        if (dup) { p.kind = "item_progress"; p.target = dup; }
      }
      if (p.kind === "project_progress") {
        const pr = this.find("projects", p.target);
        if (!pr) throw new ApiError(t("{id} não encontrado", { id: p.target }));
        this.addProjectUpdate(pr, m ? `${text} (${m.id})` : text, m ? "meeting" : "assistant", m?.id || "");
        if (m) this.link("meetings", m.id, "projects", pr.id);
        results.push({ kind: p.kind, target: pr.id, title });
      } else if (p.kind === "item_progress") {
        const it = this.find("items", p.target);
        if (!it) throw new ApiError(t("{id} não encontrado", { id: p.target }));
        (it.history ??= []).push({ date: nowISO(), text: m ? `${text} (${m.id})` : text, kind: "progress", meeting_id: m?.id || "" });
        if (it.status === "Concluído") it.status = "Em andamento";
        this.touch(it);
        this.log("items.progress", it.id, "{id} atualizado: {note}", { id: it.id, note: text.slice(0, 140) });
        if (m) this.link("meetings", m.id, "items", it.id);
        results.push({ kind: p.kind, target: it.id, title });
      } else if (p.kind === "item_new") {
        const it = await this.createRecord("items", { title, description: text !== title ? text : "", owner: p.owner || "", due_date: p.due_date || "", area_main: p.area_main || "",
          source: m ? "Reunião" : "Outro", source_detail: "Pedido pontual", origin, emitted_at: todayISO(), priority: "Média", urgency: "Média", item_actions: [], sub_seq: 0 });
        if (m) this.link("items", it.id, "meetings", m.id);
        results.push({ kind: p.kind, target: it.id, title });
      } else if (p.kind === "input") {
        const inp = await this.createRecord("inputs", { source: m ? "Reunião" : "Outro", source_detail: "Pedido pontual", title, description: text, origin,
          meeting_id: m?.id || "", owner: p.owner || "", due_date: p.due_date || "", area_main: p.area_main || "" });
        if (m) this.link("inputs", inp.id, "meetings", m.id);
        inp.ai_suggestion = await AI.assessInput(db, inp);  // já chega na triagem com a avaliação da IA
        inp.status = "Em avaliação";
        results.push({ kind: p.kind, target: inp.id, title });
      } else if (p.kind === "meeting") {
        const att = splitNames(p.owner || "");
        const mt = await this.createRecord("meetings", { title, date: p.date || todayISO(), time: p.time || "", duration: +p.duration || 60, actual_duration: +p.duration || 60,
          attendees: att, participants: att.join(", "), status: "Realizada", level: "Gerencial", notes: text !== title ? text : "" });
        db.settings.people = syncPeopleList(db.settings.people || [], att);
        results.push({ kind: p.kind, target: mt.id, title });
      }
    }
    db.assist_examples = db.assist_examples.slice(-500);
    if (m) {
      m.allocation = { ...(m.allocation || {}), applied: true, applied_at: nowISO(), results };
      this.touch(m);
      this.log("meetings.allocated", m.id, "Reunião {id}: {n} pontos registrados na lista geral e nos projetos", { id: m.id, n: results.filter((r) => r.kind !== "ignore").length });
    }
    return { results };
  },
});

// rotas novas do assistente (o restante continua em Core.route)
const _coreRoute = Core.route;
Core.route = async function (parts, method, body) {
  const db = this.db, [head, rid, action] = parts;
  if (head === "assist" && method === "POST" && !rid) return AI.capture(db, body.text || "", {});
  if (head === "assist" && rid === "apply" && method === "POST") return this.applyProposals(body.proposals || [], body.ctx || {});
  if (head === "meeting_slot" && method === "POST") return AI.suggestSlot(db, body);
  if (head === "projects" && action === "progress" && method === "POST") {
    const p = this.find("projects", rid);
    if (!p) throw new ApiError(t("{id} não encontrado", { id: rid }));
    this.addProjectUpdate(p, body.text || "", "manual");
    return p;
  }
  if (head === "meetings" && action === "teach_extract" && method === "POST") {
    const m = this.find("meetings", rid);
    if (!m) throw new ApiError(t("{id} não encontrado", { id: rid }));
    const titles = (body.demands || []).map((s) => s.replace(AI.LIST_MARK, "").trim()).filter(Boolean);
    db.extraction_examples.push({ date: nowISO(), ref: rid, text: `${m.minutes || ""}\n${m.notes || ""}`.slice(0, 3000), demands: titles });
    db.extraction_examples = db.extraction_examples.slice(-100);
    if (typeof body.rules === "string") db.settings.extraction_rules = body.rules;
    const old = m.extraction?.demands || [];
    const demands = titles.map((tl) => old.find((d) => d.title === tl) || { title: tl, description: tl, owner: AI.parseOwner(tl), due_date: AI.parseDue(tl), area_main: "",
      related_item: AI.relatedItems(db, tl, 1, 0.45)[0]?.id || "" });
    m.extraction = { ...(m.extraction || {}), demands, taught: true, hint: "" };
    if (!m.allocation?.applied) m.allocation = demands.length ? await AI.capture(db, "", { meeting: m, demands }) : null;
    this.touch(m);
    this.log("meetings.teach", rid, "Extração da reunião {id} corrigida para a IA aprender", { id: rid });
    return m;
  }
  return _coreRoute.call(this, parts, method, body);
};

// ------------------------------------------------------------------ interface
window._PROPS = {};
const reasonText = (r) => (Array.isArray(r) ? t(r[0], r[1]) : r || "");
const targetLabel = (kind, id) => { const r = kind === "project_progress" ? byId("projects", id) : byId("items", id); return r ? `${id} · ${kind === "project_progress" ? lc(r, "name") : lc(r, "title")}` : id; };
function targetLists() {
  return `<datalist id="dl-projects">${S.db.projects.filter((p) => !["Concluído", "Cancelado"].includes(p.status)).map((p) => `<option value="${esc(p.id + " · " + lc(p, "name"))}">`).join("")}</datalist>
    <datalist id="dl-items">${S.db.items.filter((i) => i.status !== "Concluído").map((i) => `<option value="${esc(i.id + " · " + lc(i, "title"))}">`).join("")}</datalist>`;
}
/** Tabela editável de propostas: o usuário confirma ou corrige o destino de cada ponto. */
function proposalsPanel(key, res, onApply) {
  window._PROPS[key] = res.proposals;
  const engine = res.engine === "heuristica" ? t("IA offline (heurística)") : res.engine;
  return `<div class="props"><p class="muted small">${t("Proposta do assistente")} (${esc(engine)})${res.error ? ` · ${t("Claude falhou:")} ${esc(res.error)}` : ""} — ${t("confira o destino de cada ponto; suas correções ensinam a IA.")}</p>
    <div style="overflow:auto"><table class="props-t">${th(["Onde registrar", "Ponto", "Responsável / participantes", "Prazo / data", "Por quê"])}
    ${res.proposals.map((p, k) => `<tr class="${p.kind === "ignore" ? "done" : ""}"><td style="min-width:230px"><select id="${key}-k-${k}" onchange="propKind('${key}', ${k}, this.value)">${ASSIST_KINDS.map((x) => `<option value="${x}" ${x === p.kind ? "selected" : ""}>${esc(t(ASSIST_KIND_LABEL[x]))}</option>`).join("")}</select>
      <input id="${key}-t-${k}" class="tg-in" list="${p.kind === "project_progress" ? "dl-projects" : "dl-items"}" value="${esc(p.target ? targetLabel(p.kind, p.target) : "")}" placeholder="${esc(t("Buscar ID ou nome…"))}" ${needsTarget(p.kind) ? "" : "hidden"}></td>
      <td style="min-width:240px"><textarea id="${key}-ti-${k}" rows="2">${esc(p.title)}</textarea>${p.text && p.text !== p.title ? `<div class="muted small">${esc(p.text)}</div>` : ""}</td>
      <td><input id="${key}-o-${k}" value="${esc(p.owner)}" style="width:140px"></td>
      <td><input type="date" id="${key}-d-${k}" value="${esc(p.kind === "meeting" ? p.date : p.due_date)}">${p.kind === "meeting" ? `<input type="time" id="${key}-h-${k}" value="${esc(p.time)}"> <input type="number" id="${key}-m-${k}" value="${esc(p.duration || 60)}" style="width:70px"> min` : ""}</td>
      <td class="muted small">${esc(reasonText(p.reason))}</td></tr>`).join("")}</table></div>${targetLists()}
    <div class="actions"><button onclick="busy(this, ()=>${onApply})">${t("Aplicar")}</button></div></div>`;
}
function propKind(key, k, kind) {
  const inp = $(`#${key}-t-${k}`);
  inp.hidden = !needsTarget(kind);
  inp.setAttribute("list", kind === "project_progress" ? "dl-projects" : "dl-items");
  if (needsTarget(kind)) { inp.value = ""; inp.focus(); }
}
function readProposals(key) {
  return (window._PROPS[key] || []).map((p, k) => {
    const kind = $(`#${key}-k-${k}`).value, target = needsTarget(kind) ? ($(`#${key}-t-${k}`).value.match(/^\s*([A-Z]+\d+)/i) || [])[1]?.toUpperCase() || "" : "";
    if (needsTarget(kind) && !target) throw new Error(t("Escolha o projeto ou item de destino na linha {n}.", { n: k + 1 }));
    const d = $(`#${key}-d-${k}`).value;
    return { ...p, kind, target, title: $(`#${key}-ti-${k}`).value.trim(), owner: $(`#${key}-o-${k}`).value.trim(),
      ...(kind === "meeting" ? { date: d || S.today, time: $(`#${key}-h-${k}`)?.value || p.time, duration: +($(`#${key}-m-${k}`)?.value || p.duration || 60) } : { due_date: d }) };
  });
}
const resultsText = (rs) => rs.filter((r) => r.kind !== "ignore").map((r) => `${t(ASSIST_KIND_LABEL[r.kind])}: ${r.target}`).join(" · ");

// registro rápido (Painel)
let ASSIST = null;
function assistantCard() {
  return `<div class="card assist-card" style="margin-bottom:var(--gap)"><h2>✨ ${t("Assistente — o que aconteceu?")}</h2>
    <p class="muted">${t("ASSIST_HINT")}</p>
    <textarea id="as-text" style="min-height:90px" placeholder="${esc(t("ASSIST_PLACEHOLDER"))}">${esc(window._asDraft || "")}</textarea>
    <div class="actions"><button onclick="busy(this, runAssistant)">${t("Analisar e propor registros")}</button>${ASSIST ? `<button class="ghost" onclick="ASSIST=null;render()">${t("Descartar")}</button>` : ""}</div>
    ${ASSIST ? proposalsPanel("as", ASSIST, "applyAssistant()") : ""}
    ${teachAssistBox()}</div>`;
}
function teachAssistBox() {
  const st = S.assist_stats || { n: 0, ok: 0, pct: 0 }, s = S.db.settings;
  return `<details class="more"><summary>🎓 ${t("Ensinar o assistente")}${st.n ? ` · ${t("acerto de {pct}% nas últimas {n} propostas", st)}` : ""}</summary>
    <p class="muted small">${st.n ? t("A IA acertou {ok} de {n} propostas recentes (você não precisou corrigir).", st) : t("Ainda sem histórico: confirme ou corrija as primeiras propostas para a IA aprender o seu critério.")}
      ${st.n >= 20 && st.pct >= 90 ? " " + t("Já dá para deixar o assistente aplicar sozinho.") : ""}</p>
    ${L("Regras para alocar (ex.: tudo de Xushui vai para o projeto PROJ002; dúvidas sem ação, ignorar)")}<textarea id="as-rules" style="min-height:60px">${esc(s.assist_rules)}</textarea>
    <div class="checks"><label><input type="checkbox" id="as-auto" ${s.assist_auto ? "checked" : ""}> ${t("Aplicar automaticamente, sem revisar (quando todos os destinos estiverem definidos)")}</label></div>
    <div class="actions"><button class="small ghost" onclick="busy(this, async()=>{await api('settings','PATCH',{assist_rules:$('#as-rules').value,assist_auto:$('#as-auto').checked}); toast(t('Salvo')); await refresh();})">${t("Salvar")}</button></div></details>`;
}
async function runAssistant() {
  const text = $("#as-text").value.trim();
  if (!text) throw new Error(t("Escreva o que aconteceu."));
  window._asDraft = text;
  const res = await api("assist", "POST", { text });
  if (S.db.settings.assist_auto && res.proposals.length && res.proposals.every((p) => !needsTarget(p.kind) || p.target)) {
    const r = await api("assist/apply", "POST", { proposals: res.proposals, ctx: { auto: true } });
    window._asDraft = ""; ASSIST = null;
    toast(t("Registrado automaticamente: {list}", { list: resultsText(r.results) }));
  } else ASSIST = res;
  await refresh();
}
async function applyAssistant() {
  const r = await api("assist/apply", "POST", { proposals: readProposals("as") });
  ASSIST = null; window._asDraft = "";
  toast(t("Registrado: {list}", { list: resultsText(r.results) || "—" }));
  await refresh();
}

// reunião: ata / anotações / ensinar a IA + alocação na lista geral
function meetingNotesCard(m) {
  const tabsH = [["ata", t("Ata")], ["notas", t("Anotações")], ["ensinar", "🎓 " + t("Ensinar a IA")]];
  const demands = (m.extraction?.demands || []).map((d) => d.title).join("\n");
  return `<div class="card"><div class="tabs mini">${tabsH.map(([k, l], i) => `<a href="#" class="${i ? "" : "on"}" onclick="mdTab(this,'${k}');return false">${l}</a>`).join("")}</div>
    <div class="md-pane" data-k="ata"><textarea id="md-min" style="min-height:200px" placeholder="${esc(t("MINUTES_HINT"))}">${esc(m.minutes)}</textarea>${trPreview(m, "minutes")}
      <div class="actions"><button onclick="busy(this, ()=>saveMinutes('${m.id}'))">${t("Salvar e extrair demandas")}</button></div>
      ${L("Arquivo da ata")}<div class="toolbar">${(m.minutes_files || []).map((f) => fileLink(f, f.split("/").pop())).join(" · ") || `<span class="muted">—</span>`}
        <label class="btn small ghost file-btn">${t("Anexar ata")}<input type="file" hidden multiple onchange="attachMinutes('${m.id}', this)"></label></div>
      ${L("Outros anexos")}<div class="toolbar"><input type="file" id="md-file" multiple><button class="small" onclick="busy(this, async()=>{await uploadFiles('meetings/${m.id}/upload', $('#md-file')); toast(t('Anexado')); await refresh();})">${t("Upload")}</button></div></div>
    <div class="md-pane" data-k="notas" hidden><textarea id="md-notes" style="min-height:200px">${esc(m.notes)}</textarea>
      <div class="actions"><button onclick="busy(this, ()=>saveMinutes('${m.id}'))">${t("Salvar e extrair demandas")}</button></div></div>
    <div class="md-pane" data-k="ensinar" hidden><p class="muted">${t("TEACH_EXTRACT_HINT")}</p>
      ${L("Demandas corretas desta reunião (uma por linha)")}<textarea id="te-dem" style="min-height:150px">${esc(demands)}</textarea>
      ${L("Regras de extração (valem para todas as atas)")}<textarea id="te-rules" style="min-height:70px" placeholder="${esc(t("TEACH_EXTRACT_PLACEHOLDER"))}">${esc(S.db.settings.extraction_rules)}</textarea>
      <div class="actions"><button onclick="busy(this, ()=>teachExtraction('${m.id}'))">${t("Salvar e ensinar a IA")}</button>
        <span class="muted small">${t("{n} atas já ensinadas", { n: S.extraction_count || 0 })}</span></div></div>
    ${L("Vínculos")}<div>${linksHtml(m)}</div>
    <h3>${t("Histórico")}</h3><ul class="tl">${timeline((m.history || []).slice().reverse())}</ul></div>`;
}
function mdTab(a, k) {
  const card = a.closest(".card");
  card.querySelectorAll(".tabs.mini a").forEach((x) => x.classList.toggle("on", x === a));
  card.querySelectorAll(".md-pane").forEach((p) => { p.hidden = p.dataset.k !== k; });
}
async function saveMinutes(id) {
  await api(`meetings/${id}`, "PATCH", { minutes: $("#md-min").value, notes: $("#md-notes").value, _silent: true });
  await api(`meetings/${id}/extract`, "POST"); await refresh();
}
async function teachExtraction(id) {
  await api(`meetings/${id}/teach_extract`, "POST", { demands: $("#te-dem").value.split(/\r?\n/), rules: $("#te-rules").value });
  toast(t("Obrigado! A IA vai usar esta correção nas próximas atas.")); await refresh();
}
function extractionCard(m) {
  const ex = m.extraction;
  return `<div class="card"><h2>${t("Extração")} (${esc(tv(ex?.engine) || "—")})</h2>${ex?.hint ? `<p class="muted">${esc(t(ex.hint))}</p>` : ""}
    ${ex?.summary ? `<div class="ai-box">${esc(ex.summary)}</div>` : ""}
    <h3>${t("Decisões")}</h3><ul>${(m.decisions || []).map((d) => `<li>${esc(d)}</li>`).join("") || '<li class="muted">—</li>'}</ul></div>`;
}
function allocationCard(m) {
  const al = m.allocation;
  let body;
  if (!al?.proposals?.length) body = `<p class="muted">${t("Nenhuma demanda extraída.")} ${t("Use a aba Ensinar a IA para dizer quais são os pontos desta ata.")}</p>
      ${m.minutes || m.notes ? `<div class="actions"><button class="small" onclick="busy(this, async()=>{await api('meetings/${m.id}/extract','POST'); await refresh();})">${t("Extrair demandas novamente")}</button></div>` : ""}`;
  else if (al.applied) body = `<ul>${(al.results || []).map((r) => `<li>${r.kind === "ignore" ? `<span class="muted">${esc(r.title)} — ${t("ignorado")}</span>` : `${esc(t(ASSIST_KIND_LABEL[r.kind]))}: ${linkTo(r.target)} — ${esc(r.title)}`}</li>`).join("")}</ul>
      <div class="actions"><button class="small ghost" onclick="busy(this, async()=>{await api('meetings/${m.id}','PATCH',{allocation:{...byId('meetings','${m.id}').allocation, applied:false}, _silent:true}); await refresh();})">${t("Revisar alocação")}</button></div>`;
  else body = proposalsPanel("al", al, `applyAllocation('${m.id}')`);
  return `<div class="card" style="margin-top:var(--gap)"><h2>${t("Pontos da reunião → lista geral e projetos")}</h2>${body}</div>`;
}
function linkTo(id) {
  const col = /^PROJ/.test(id) ? "projetos" : /^GOV/.test(id) ? "lista" : /^INP/.test(id) ? "entradas" : /^MEET/.test(id) ? "reunioes" : "";
  return col ? `<a href="#${col}/${id}">${id}</a>` : esc(id);
}
async function applyAllocation(mid) {
  const r = await api("assist/apply", "POST", { proposals: readProposals("al"), ctx: { meeting_id: mid } });
  toast(t("Registrado: {list}", { list: resultsText(r.results) || "—" })); await refresh();
}

// sugestão de horário (qualquer reunião)
async function suggestSlot(prefix, duration) {
  const res = await api("meeting_slot", "POST", { from: $(`#${prefix}date`)?.value || "", duration: duration || +$(`#${prefix}dur`)?.value || 60,
    title: $(`#${prefix}title`)?.value || "", attendees: $(`#${prefix}attn`) ? readAttendees(prefix) : [], level: $(`#${prefix}level`)?.value || "" });
  const box = $(`#${prefix}slots`);
  box.innerHTML = res.options.length ? res.options.map((o) => `<button type="button" class="chip slot" title="${esc(t(o.reason))}" onclick="$('#${prefix}date').value='${o.date}';$('#${prefix}time').value='${o.time}';this.parentElement.querySelectorAll('.slot').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${esc(o.date)} ${esc(o.time)}</button>`).join("")
    + `<span class="muted small">${esc(t(res.options[0].reason))}</span>` : `<span class="muted small">${t("Nenhum horário livre encontrado nas próximas semanas.")}</span>`;
}
function meetingRulesBox() {
  return `<p class="muted">${t("Escreva observações e regras: dias e horários a evitar, disponibilidade da diretoria, feriados, intervalo entre reuniões…")} ${t("Valem para todas as reuniões (solicitadas, do calendário e obrigatórias).")}</p>
    <div class="row"><div>${L("Início do expediente")}<input type="time" id="mr-start" value="${esc(S.db.settings.work_hours.start)}"></div><div>${L("Fim do expediente")}<input type="time" id="mr-end" value="${esc(S.db.settings.work_hours.end)}"></div></div>
    ${L("Regras e observações")}<textarea id="mr-rules" style="min-height:120px" placeholder="${esc(t("MEETING_RULES_PLACEHOLDER"))}">${esc(S.db.settings.meeting_rules)}</textarea>
    <div class="actions"><button class="ghost" onclick="busy(this, saveMeetingRules)">${t("Salvar regras")}</button></div>`;
}

// projeto: registrar progresso (vai para o summary diário)
function projectProgressBox(p) {
  const ups = (p.updates || []).slice().reverse();
  return `<div class="card"><h2>${t("Progresso do projeto")}</h2>
    <p class="muted small">${t("Cada registro aparece no summary diário em \"Progressos dos projetos\".")}</p>
    <textarea id="pp-text-${p.id}" style="min-height:60px" placeholder="${esc(t("Ex.: cabos do painel de média tensão instalados; teste marcado para sexta."))}"></textarea>
    <div class="actions"><button class="small" onclick="busy(this, async()=>{await api('projects/${p.id}/progress','POST',{text:$('#pp-text-${p.id}').value}); toast(t('Progresso registrado')); await refresh();})">${t("Registrar progresso")}</button></div>
    <ul class="tl">${ups.slice(0, 12).map((u) => `<li><span class="muted">${fmt(u.date)}</span> ${esc(u.text)}</li>`).join("") || `<li class="muted">${t("Nenhum progresso registrado.")}</li>`}</ul></div>`;
}
