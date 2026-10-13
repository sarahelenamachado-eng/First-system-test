/* Camada de IA.
 *
 * Chama o Claude direto do navegador (API HTTP da Anthropic) quando há uma chave configurada em
 * Config. Sem chave — ou se a chamada falhar — usa heurísticas locais, para a plataforma funcionar offline.
 *
 * "Aprendizado": cada vez que o usuário confirma/corrige uma sugestão, o par (sugestão da IA,
 * decisão final) é guardado em db.feedback. Os exemplos mais parecidos com a nova demanda são
 * enviados ao Claude como referência, e a heurística local também os reutiliza.
 */
const AI = {
  key: "",
  model: "claude-opus-5-5",

  IMPACT_TYPES: ["Custo", "Eficiência", "Operação", "Compliance", "People"],
  DEFINITIONS: {
    risco_monitorar: "Risco a monitorar",
    risco_investigar: "Risco a investigar",
    info_reportar: "Info a ser reportada",
    novo_projeto: "Criação de um novo projeto",
    acao_projeto: "Ação dentro de um projeto",
    acao_geral: "Ação geral",
  },

  get SYSTEM_PROMPT() { return `Você é o assistente de governança corporativa de uma diretoria.
Você recebe demandas vindas da diretora, de reuniões, de departamentos ou do HQ e ajuda a fazer o
"demand management": verificar relação com itens já levantados, classificar (escopo, prioridade,
impactos) e sugerir a definição (risco, info a reportar, novo projeto, ação em projeto, ação geral).
Use a lógica de Hoshin Kanri para alinhar demandas à estratégia: conecte cada demanda aos objetivos
e projetos existentes, destaque desdobramentos e interfaces entre áreas, e aponte gaps (por que algo
não foi previsto antes). Responda sempre em ${I18N.aiLanguage()}, de forma objetiva (todos os textos livres
do JSON também nesse idioma; os valores de enum ficam exatamente como definidos no schema).
O usuário sempre confirma ou corrige suas sugestões; trate os exemplos de decisões anteriores como
critério da organização e siga-os quando aplicáveis.`; },

  async init() {
    this.key = (await KV.get("api_key").catch(() => "")) || "";
    this.model = (await KV.get("model").catch(() => "")) || "claude-opus-5-5";
  },
  async configure(key, model) {
    this.key = (key || "").trim();
    this.model = (model || "").trim() || "claude-opus-5-5";
    await KV.set("api_key", this.key);
    await KV.set("model", this.model);
  },
  enabled() { return !!this.key; },
  status() {
    return this.enabled() ? { enabled: true, model: this.model, detail: null }
      : { enabled: false, model: null, detail: "sem chave do Claude (configure em Config.)" };  // traduzido na exibição
  },

  /** Chama o Claude. Retorna objeto (se schema) ou texto. Lança Error em falha. */
  async call(content, schema = null, effort = "medium", maxTokens = 16000) {
    if (!this.key) throw new Error(t("IA sem chave configurada"));
    const body = {
      model: this.model,
      max_tokens: maxTokens,
      system: this.SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      output_config: { effort },
      // Se um classificador de segurança recusar, o servidor tenta outro modelo automaticamente.
      fallbacks: "default",
    };
    if (schema) body.output_config.format = { type: "json_schema", schema };
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.key,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "server-side-fallback-2026-07-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(t("Sem conexão com a API do Claude (rede/proxy bloqueado?)"));
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || r.statusText;
      if (r.status === 401) throw new Error(t("Chave da IA inválida (401)"));
      if (r.status === 429) throw new Error(t("Limite de requisições atingido; tente novamente em instantes"));
      throw new Error(t("Erro da API do Claude ({status}): {msg}", { status: r.status, msg }));
    }
    if (data.stop_reason === "refusal") throw new Error(t("O modelo recusou a solicitação"));
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!schema) return text;
    try { return JSON.parse(text); } catch { throw new Error(t("Resposta da IA em formato inválido")); }
  },

  // ---------------------------------------------------------------- utilidades de texto
  STOP: new Set("a o os as de da do das dos e em no na nos nas um uma para por com sem que se ao à é ser sobre the of and to in".split(" ")),
  norm: (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, ""),
  tokens(s) {
    // radical simples (6 primeiras letras) para aproximar plural/gênero: gerador ~ geradores
    return new Set((this.norm(s).match(/[a-z0-9]{3,}/g) || []).filter((w) => !this.STOP.has(w)).map((w) => w.slice(0, 6)));
  },
  similarity(a, b) {
    const ta = this.tokens(a), tb = this.tokens(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return (inter / Math.min(ta.size, tb.size)) * 0.6 + (inter / (ta.size + tb.size - inter)) * 0.4;
  },
  itemText: (it) => ["title", "description", "background", "area_main", "scope"].map((k) => it[k] || "").join(" "),
  inputText: (i) => ["title", "description", "background", "origin", "area_main", "areas_impacted", "areas_impacting"].map((k) => i[k] || "").join(" "),
  relatedItems(db, text, limit = 5, threshold = 0.18) {
    return db.items.map((it) => [this.similarity(text, this.itemText(it)), it]).filter(([s]) => s >= threshold)
      .sort((a, b) => b[0] - a[0]).slice(0, limit)
      .map(([s, it]) => ({ id: it.id, title: it.title, score: Math.round(s * 100) / 100, status: it.status }));
  },
  similarFeedback(db, text, limit = 5) {
    return db.feedback.map((f) => [this.similarity(text, f.text || ""), f]).filter(([s]) => s > 0.1)
      .sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, f]) => f);
  },

  // ---------------------------------------------------------------- avaliação de demandas
  get ASSESS_SCHEMA() {
    const S = (d) => (d ? { type: "string", description: d } : { type: "string" });
    const lvl = { type: "string", enum: ["Alta", "Média", "Baixa"] };
    return {
      type: "object", additionalProperties: false,
      required: ["related", "relation_mode", "include_in", "relation_explanation", "scope", "scope_action", "priority", "urgency",
        "risk_reason", "impacts", "impact_details", "definitions", "project_id", "gap_analysis", "rationale"],
      properties: {
        related: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "relation"], properties: { id: S(), relation: S() } } },
        relation_mode: { type: "string", enum: ["novo", "incluir_existente"] },
        include_in: S("ID do item on going quando relation_mode=incluir_existente, senão vazio"),
        relation_explanation: S(),
        scope: S("O que é?"), scope_action: S("O que deve ser feito com isso?"),
        priority: lvl, urgency: lvl,
        risk_reason: S("Por que há risco e por que essa urgência"),
        impacts: { type: "array", items: { type: "string", enum: this.IMPACT_TYPES } },
        impact_details: S("Impactos em quais projetos/operações, por quê"),
        definitions: { type: "array", items: { type: "string", enum: Object.keys(this.DEFINITIONS) } },
        project_id: S("Projeto existente relacionado, ou vazio"),
        gap_analysis: S("Possíveis gaps / por que a ação não foi prevista antes"),
        rationale: S(),
      },
    };
  },

  PRIORITY_WORDS: ["urgente", "imediato", "critico", "ministerio", "multa", "acidente", "parada", "parado", "seguranca", "investigacao", "processo", "hq", "diretora"],
  IMPACT_WORDS: {
    Custo: ["custo", "multa", "orcamento", "contrato", "preco", "pagamento", "budget", "financeiro"],
    Eficiência: ["atraso", "produtividade", "eficiencia", "retrabalho", "prazo", "lento", "fluxo"],
    Operação: ["operacao", "gerador", "equipamento", "parada", "parado", "manutencao", "pecas", "yard", "patio", "energia", "voltage"],
    Compliance: ["ministerio", "lei", "auditoria", "norma", "compliance", "regulatorio", "fiscalizacao", "investigacao", "legal"],
    People: ["turnover", "funcionarios", "ambiente", "rh", "saude", "pessoas", "colaboradores", "ventiladores", "treinamento", "clima"],
  },

  heuristicAssess(db, inp, related) {
    const text = this.norm(this.inputText(inp));
    const has = (w) => text.includes(w);
    const learned = this.similarFeedback(db, this.inputText(inp), 1);
    const impacts = Object.entries(this.IMPACT_WORDS).filter(([, ws]) => ws.some(has)).map(([k]) => k);
    const hits = this.PRIORITY_WORDS.filter(has).length;
    const priority = hits >= 2 ? "Alta" : hits === 1 ? "Média" : "Baixa";
    const defs = [];
    if (["risco", "investig", "ministerio", "acidente", "multa"].some(has)) defs.push(has("investig") ? "risco_investigar" : "risco_monitorar");
    const project = db.projects.find((p) => this.similarity(this.inputText(inp), `${p.name || ""} ${p.description || ""}`) > 0.3)?.id || "";
    if (project) defs.push("acao_projeto");
    else if (related.length >= (db.settings.links_for_project_alert || 3)) defs.push("novo_projeto");
    if (!defs.length) defs.push("acao_geral");
    const mode = related.length && related[0].score >= 0.55 ? "incluir_existente" : "novo";
    const out = {
      related: related.map((r) => ({ id: r.id, relation: `${t("similaridade")} ${r.score}` })),
      relation_mode: mode,
      include_in: mode === "incluir_existente" ? related[0].id : "",
      relation_explanation: mode === "incluir_existente" ? "Relação direta (alta similaridade) com item on going."
        : related.length ? "Relacionado em impacto, mas não diretamente: criar item novo e vincular." : "Nenhum item relacionado encontrado.",
      scope: inp.title || "", scope_action: "", priority, urgency: priority, risk_reason: "", impacts, impact_details: "",
      definitions: defs, project_id: project, gap_analysis: "",
      rationale: t("Sugestão heurística (IA offline): palavras-chave, similaridade com o histórico e decisões anteriores."),
    };
    out.msg = ["Sugestão heurística (IA offline): palavras-chave, similaridade com o histórico e decisões anteriores.", {}];
    if (learned.length) {
      const fin = learned[0].final || {};
      for (const k of ["priority", "urgency", "impacts", "definitions"]) if (fin[k] && (!Array.isArray(fin[k]) || fin[k].length)) out[k] = fin[k];
      out.rationale += " " + t("Baseado na decisão anterior em {ref}.", { ref: learned[0].ref });
      out.msg = ["HEUR_LEARNED", { ref: learned[0].ref }];
    }
    return out;
  },

  /** Etapa 2 do fluxo (Assessment): relação com itens on going + classificação + definição sugerida. */
  async assessInput(db, inp) {
    const text = this.inputText(inp);
    const related = this.relatedItems(db, text, 8, 0.12);
    if (!this.enabled()) return { ...this.heuristicAssess(db, inp, related), engine: "heuristica" };
    const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
    const ongoing = db.items.filter((it) => it.status !== "Concluído").slice(-80)
      .map((it) => ({ id: it.id, title: it.title, status: it.status, scope: it.scope, priority: it.priority, projects: it.links?.projects || [] }));
    const projects = db.projects.map((p) => ({ id: p.id, name: p.name, description: (p.description || "").slice(0, 300) }));
    const examples = this.similarFeedback(db, text).map((f) => ({ demanda: (f.text || "").slice(0, 500), sugestao_ia: f.ai, decisao_final_usuario: f.final }));
    const J = (x) => JSON.stringify(x);
    const prompt = "Nova demanda (input):\n" + JSON.stringify(pick(inp, ["source", "source_detail", "title", "description", "background", "origin", "area_main", "areas_impacted", "areas_impacting", "owner", "due_date"]), null, 1)
      + "\n\nItens on going na lista geral de governança:\n" + J(ongoing)
      + "\n\nCandidatos mais parecidos (similaridade textual):\n" + J(related)
      + "\n\nProjetos existentes:\n" + J(projects)
      + "\n\nDecisões anteriores do usuário em demandas parecidas (aprenda com elas):\n" + J(examples)
      + "\n\nTarefa: 1) Verifique se tem relação com item já levantado. Relação direta -> relation_mode=incluir_existente "
      + "e include_in=<id>. Relacionado só em impacto -> relation_mode=novo, e liste o vínculo em related. "
      + "2) Classifique escopo (o que é / o que fazer), prioridade, urgência com justificativa do risco, impactos "
      + "(Custo, Eficiência, Operação, Compliance, People) e em quais projetos/operações. "
      + "3) Sugira uma ou mais definições. Use project_id quando for ação dentro de projeto existente. "
      + "4) Aponte gaps: por que isso não foi previsto antes.";
    try {
      const out = await this.call(prompt, this.ASSESS_SCHEMA, "medium");
      const valid = new Set(db.items.map((i) => i.id));
      out.related = (out.related || []).filter((r) => valid.has(r.id));
      if (!valid.has(out.include_in)) { out.include_in = ""; out.relation_mode = "novo"; }
      if (!db.projects.some((p) => p.id === out.project_id)) out.project_id = "";
      out.engine = this.model;
      return out;
    } catch (e) {
      const out = { ...this.heuristicAssess(db, inp, related), engine: "heuristica" };
      out.rationale += ` (${t("Claude falhou:")} ${e.message})`;
      delete out.msg;
      return out;
    }
  },

  // ---------------------------------------------------------------- reuniões
  EXTRACT_SCHEMA: {
    type: "object", additionalProperties: false, required: ["summary", "decisions", "demands"],
    properties: {
      summary: { type: "string" },
      decisions: { type: "array", items: { type: "string" } },
      demands: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["title", "description", "owner", "due_date", "area_main", "related_item"],
        properties: { title: { type: "string" }, description: { type: "string" }, owner: { type: "string" },
          due_date: { type: "string", description: "AAAA-MM-DD ou vazio" }, area_main: { type: "string" },
          related_item: { type: "string", description: "ID de item existente ou vazio" } } } },
    },
  },

  async extractMeeting(db, m) {
    const text = `${m.minutes || ""}\n${m.notes || ""}`;
    if (!this.enabled()) {
      const KW = /^(a[cç][aã]o|action|to-?do|task|pend[eê]ncia|demanda|tarefa|行动|待办|任务)\s*[:：\-]\s*/i;
      const demands = [];
      for (const line of text.split(/\r?\n/)) {
        const l = line.replace(/^[\s\-•*]+|[\s\-•*]+$/g, "");
        if (!KW.test(l)) continue;
        let title = l.replace(KW, "");
        const OWNER = /\s*(?:resp(?:ons[aá]vel)?|owner|负责人)\s*[:：\-]\s*/i;
        const owner = (l.match(new RegExp(OWNER.source + "([^\\d,;，；]+)", "i")) || [, ""])[1].trim();
        const due = (l.match(/(\d{4}-\d{2}-\d{2})/) || [, ""])[1];
        title = title.replace(new RegExp(OWNER.source + ".*$", "i"), "").trim() || title;
        const rel = this.relatedItems(db, title, 1, 0.4);
        demands.push({ title: title.slice(0, 120), description: l, owner, due_date: due, area_main: "", related_item: rel[0]?.id || "" });
      }
      const decisions = text.split(/\r?\n/).filter((l) => /^\s*[-•*]?\s*(decis|决定|决策)/i.test(l)).map((l) => l.replace(/^[\s\-•*]+/, ""));
      return { summary: text.slice(0, 400), decisions, demands, engine: "heuristica",
        hint: "EXTRACT_HINT" };
    }
    const items = db.items.slice(-120).map((it) => ({ id: it.id, title: it.title }));
    const prompt = `Reunião: ${m.title} em ${m.date} — participantes: ${m.participants || ""}\nAta / anotações:\n${text}\n\n`
      + `Itens já existentes na lista de governança:\n${JSON.stringify(items)}\n\n`
      + "Resuma a reunião, liste as decisões e extraia cada demanda/ação nova ou atualização (com responsável e prazo "
      + "quando citados). Se a demanda se refere a um item existente, informe o ID em related_item.";
    try {
      return { ...(await this.call(prompt, this.EXTRACT_SCHEMA, "medium")), engine: this.model };
    } catch (e) {
      return { summary: "", decisions: [], demands: [], engine: "erro", hint: e.message };
    }
  },

  // ---------------------------------------------------------------- master schedule
  heuristicSchedule(rows, ref) {
    if (!rows || !rows.length) return { overview: t("Arquivo armazenado. Formato sem leitura automática (envie .xlsx/.csv/.pdf para análise)."), tasks_count: 0 };
    let hi = rows.slice(0, 15).findIndex((r) => /tarefa|task|atividade|activity/.test(this.norm(r.join(" "))));
    if (hi < 0) hi = 0;
    const head = rows[hi].map((h) => this.norm(h));
    const col = (...ns) => { const i = head.findIndex((h) => ns.some((n) => h.includes(n))); return i < 0 ? null : i; };
    const ci = col("tarefa", "task", "atividade", "activity", "nome", "name"), cs = col("inicio", "start"),
      cf = col("termino", "fim", "finish", "end"), cp = col("%", "progress", "conclu");
    const toDate = (v) => { v = String(v || ""); return /^\d{5}(\.\d+)?$/.test(v) ? new Date(Date.UTC(1899, 11, 30) + Math.round(+v * 864e5)).toISOString().slice(0, 10)
      : /^\d{2}\/\d{2}\/\d{4}/.test(v) ? `${v.slice(6, 10)}-${v.slice(3, 5)}-${v.slice(0, 2)}` : v.slice(0, 10); };
    const tasks = [];
    for (const r of rows.slice(hi + 1)) {
      const g = (c) => (c !== null && c < r.length ? r[c] ?? "" : "");
      const name = g(ci);
      if (!name) continue;
      const raw = String(g(cp));
      let pct = parseFloat(raw.replace("%", "").replace(",", ".")) || 0;
      if (pct > 0 && pct <= 1 && !raw.includes("%")) pct *= 100;
      tasks.push({ task: name, start: toDate(g(cs)), finish: toDate(g(cf)), progress: Math.round(pct) });
    }
    const late = tasks.filter((t) => t.finish && t.finish < ref && t.progress < 100);
    const upcoming = tasks.filter((t) => t.finish && t.finish >= ref && t.progress < 100).sort((a, b) => a.finish.localeCompare(b.finish)).slice(0, 10);
    const done = tasks.filter((t) => t.progress >= 100).length;
    const p = { n: tasks.length, done, late: late.length };
    return { overview: t("{n} atividades lidas; {done} concluídas; {late} atrasadas.", p), msg: ["{n} atividades lidas; {done} concluídas; {late} atrasadas.", p], late: late.slice(0, 20), upcoming, tasks_count: tasks.length };
  },

  SCHEDULE_SCHEMA: (() => {
    const task = { type: "object", additionalProperties: false, required: ["task", "finish", "progress"],
      properties: { task: { type: "string" }, finish: { type: "string" }, progress: { type: "number" } } };
    return {
      type: "object", additionalProperties: false,
      required: ["overview", "phases", "late", "upcoming", "critical_points", "suggested_actions"],
      properties: {
        overview: { type: "string" },
        phases: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "start", "finish", "status"],
          properties: { name: { type: "string" }, start: { type: "string" }, finish: { type: "string" }, status: { type: "string" } } } },
        late: { type: "array", items: task }, upcoming: { type: "array", items: task },
        critical_points: { type: "array", items: { type: "string" } },
        suggested_actions: { type: "array", items: { type: "string" } },
      },
    };
  })(),

  async analyzeSchedule(project, file, ref) {
    const ext = file.name.toLowerCase().split(".").pop();
    let rows = null;
    try { rows = await Sheet.table(file); } catch (e) { rows = null; }
    if (!this.enabled() || (rows === null && ext !== "pdf")) return { ...this.heuristicSchedule(rows, ref), engine: "heuristica" };
    const intro = `Projeto ${project.id} — ${project.name}. Data de referência: ${ref}.\n`
      + "Organize esta master schedule: visão geral, fases/marcos, atividades atrasadas, próximas entregas "
      + "(próximas 4 semanas), pontos críticos (caminho crítico, interfaces com outras áreas) e ações sugeridas.";
    const content = ext === "pdf"
      ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: await fileToB64(file) } }, { type: "text", text: intro }]
      : intro + "\n\nCronograma (tabela):\n" + rows.map((r) => r.join(" | ")).join("\n");
    try {
      return { ...(await this.call(content, this.SCHEDULE_SCHEMA, "medium")), engine: this.model };
    } catch (e) {
      const out = { ...this.heuristicSchedule(rows, ref), engine: "heuristica" };
      out.overview += ` (${t("Claude falhou:")} ${e.message})`;
      delete out.msg;
      return out;
    }
  },

  // ---------------------------------------------------------------- riscos
  RISK_SCHEMA: {
    type: "object", additionalProperties: false,
    required: ["summary", "probability", "impact", "causes", "consequences", "mitigations", "report_points"],
    properties: {
      summary: { type: "string" }, probability: { type: "string", enum: ["Alta", "Média", "Baixa"] },
      impact: { type: "string", enum: ["Alto", "Médio", "Baixo"] },
      causes: { type: "array", items: { type: "string" } }, consequences: { type: "array", items: { type: "string" } },
      mitigations: { type: "array", items: { type: "string" } }, report_points: { type: "array", items: { type: "string" } },
    },
  },

  async analyzeRisk(db, risk, filesText) {
    const empty = { causes: [], consequences: [], mitigations: [], report_points: [] };
    if (!this.enabled()) return { summary: t("IA offline — análise automática indisponível. Preencha manualmente."),
      probability: risk.probability || "Média", impact: risk.impact || "Médio", ...empty, engine: "heuristica" };
    const linked = db.items.filter((it) => (risk.links?.items || []).includes(it.id)).map((i) => ({ id: i.id, title: i.title, risk_reason: i.risk_reason }));
    const prompt = `Risco ${risk.id}: ${risk.title} (${risk.mode})\nDescrição: ${risk.description || ""}\n`
      + `Itens vinculados: ${JSON.stringify(linked)}\nNotas: ${risk.notes || ""}\nConteúdo dos documentos da pasta (texto):\n${filesText.slice(0, 60000)}\n\n`
      + "Compile as informações do risco para análise e reporte. As sugestões serão confirmadas pelo usuário.";
    try {
      return { ...(await this.call(prompt, this.RISK_SCHEMA, "medium")), engine: this.model };
    } catch (e) {
      return { summary: `${t("Falha na análise:")} ${e.message}`, probability: "Média", impact: "Médio", ...empty, engine: "erro" };
    }
  },

  // ---------------------------------------------------------------- fluxos (mapa visual)
  FLOW_TYPES: ["project", "risk", "item", "cause", "impact", "action", "other"],
  get FLOW_SCHEMA() {
    return {
      type: "object", additionalProperties: false, required: ["nodes", "edges"],
      properties: {
        nodes: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "label", "type", "ref"],
          properties: { key: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: this.FLOW_TYPES },
            ref: { type: "string", description: "ID de registro existente (PROJ/RISK/GOV) ou vazio" } } } },
        edges: { type: "array", items: { type: "object", additionalProperties: false, required: ["from", "to", "label"],
          properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } } } },
      },
    };
  },

  /** Gera um fluxo que correlaciona projetos, riscos e impactos. Sem IA, usa os vínculos registrados. */
  async generateFlow(db, flow, description) {
    const base = Core.flowFromData(flow.scope_col, flow.scope_id);
    if (!this.enabled()) return { ...base, engine: "heuristica" };
    const brief = (col, r) => (col === "projects"
      ? { id: r.id, name: r.name, description: r.description, main: r.main, scenarios: r.scenarios, items: r.links?.items, risks: r.links?.risks }
      : { id: r.id, title: r.title, description: r.description, impacts: r.impacts, scenarios: r.scenarios, items: r.links?.items });
    const scope = flow.scope_col === "geral"
      ? { projects: db.projects.map((p) => brief("projects", p)), risks: db.risks.map((r) => brief("risks", r)) }
      : { [flow.scope_col]: [brief(flow.scope_col, Core.find(flow.scope_col, flow.scope_id) || {})] };
    const items = db.items.slice(-150).map((i) => ({ id: i.id, title: i.title, impacts: i.impacts, risk_reason: i.risk_reason }));
    const prompt = "Monte um FLUXO VISUAL que correlacione logicamente projetos, riscos, causas e impactos.\n"
      + `Descrição do usuário (o que o fluxo deve mostrar):\n${description || "(sem descrição: use os dados)"}\n\n`
      + `Como o usuário quer que os fluxos sejam montados (regras ensinadas por ele, siga com prioridade):\n${db.settings.flow_guidelines || "(nenhuma)"}\n\n`
      + `Exemplos de fluxos aprovados pelo usuário:\n${JSON.stringify(db.flow_examples.slice(-3))}\n\n`
      + `Dados do escopo:\n${JSON.stringify(scope)}\nItens da lista geral:\n${JSON.stringify(items)}\n\n`
      + `Fluxo atual montado a partir dos vínculos (pode melhorar, reorganizar, juntar ou acrescentar):\n${JSON.stringify({ nodes: base.nodes.map((n) => ({ key: n.id, label: n.label, type: n.type })), edges: base.edges })}\n\n`
      + "Regras: rótulos curtos (até ~8 palavras); use ref com o ID quando o nó for um registro existente; "
      + `rótulos de ligação preferidos: ${db.settings.lists.flow_edge_labels.join(", ")}; não invente fatos que não estejam nos dados ou na descrição.`;
    try {
      const out = await this.call(prompt, this.FLOW_SCHEMA, "medium");
      const keys = new Set(out.nodes.map((n) => n.key));
      const nodes = out.nodes.map((n) => ({ id: n.key, label: n.label, type: n.type, ref: n.ref || "" }));
      const edges = out.edges.filter((e) => keys.has(e.from) && keys.has(e.to)).map((e, i) => ({ id: "E" + (i + 1), ...e }));
      return { ...Core.layoutFlow(nodes, edges), engine: this.model };
    } catch (e) {
      return { ...base, engine: "heuristica", error: e.message };
    }
  },

  // ---------------------------------------------------------------- summaries
  async narrative(summary) {
    const k = summary.kpis;
    const basic = t("NARRATIVE_BASIC", { ...k, alerts: summary.alerts.length });
    if (!this.enabled()) return basic;
    const prompt = `Escreva os DESTAQUES deste summary de governança (${summary.type}) em até 8 bullets curtos, em ${I18N.aiLanguage()}: `
      + "o que mudou, o que exige atenção da diretoria, riscos, decisões e próximos passos. Use Hoshin Kanri "
      + "para conectar com os objetivos estratégicos. Dados:\n" + JSON.stringify(summary).slice(0, 80000);
    try { return await this.call(prompt, null, "low", 4000); }
    catch (e) { return `${basic}\n(${t("Destaques da IA indisponíveis:")} ${e.message})`; }
  },
};

function fileToB64(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(file); });
}
