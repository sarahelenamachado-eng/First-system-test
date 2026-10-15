/* Camada de IA (mesma lógica da plataforma de governança).
 *
 * Com a chave do Claude (Config.), o assistente usa o modelo; sem chave — ou se a chamada falhar — usa
 * heurísticas locais (palavras‑chave, datas, semelhança com as suas tarefas e com decisões anteriores).
 *
 * Aprendizado: cada proposta que você confirma ou corrige vira exemplo (db.assist_examples). Os casos
 * parecidos orientam a heurística offline e são enviados ao Claude como critério.
 */
const AI = {
  key: "",
  model: "claude-opus-5-5",

  SYSTEM_PROMPT: `Você é o assistente pessoal de produtividade e autoconhecimento do usuário.
Você transforma anotações livres do dia em registros organizados (o que fez, o que faltou, tarefas novas,
avanços, aprendizados e erros) e ajuda a refletir sobre o dia com gentileza e objetividade.
Responda sempre em português do Brasil, de forma simples e direta. O usuário confirma ou corrige as suas
sugestões; trate as decisões anteriores dele como critério e siga-as quando aplicáveis.`,

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

  /** Chama o Claude. Retorna objeto (se schema) ou texto. Lança Error em falha. */
  async call(content, schema = null, effort = "medium", maxTokens = 8000) {
    if (!this.key) throw new Error("IA sem chave configurada");
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
      throw new Error("Sem conexão com a API do Claude (rede/proxy bloqueado?)");
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) throw new Error("Chave da IA inválida (401)");
      if (r.status === 429) throw new Error("Limite de requisições atingido; tente novamente em instantes");
      throw new Error(`Erro da API do Claude (${r.status}): ${data?.error?.message || r.statusText}`);
    }
    if (data.stop_reason === "refusal") throw new Error("O modelo recusou a solicitação");
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!schema) return text;
    try { return JSON.parse(text); } catch { throw new Error("Resposta da IA em formato inválido"); }
  },

  // ---------------------------------------------------------------- utilidades de texto
  STOP: new Set("a o os as de da do das dos e em no na nos nas um uma para pra por com sem que se ao à é ser sobre meu minha meus minhas".split(" ")),
  norm: (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""),
  tokens(s) {
    // radical simples (5 primeiras letras) para aproximar flexões: estudar ~ estudei, relatório ~ relatórios
    return new Set((this.norm(s).match(/[a-z0-9]{3,}/g) || []).filter((w) => !this.STOP.has(w)).map((w) => w.slice(0, 5)));
  },
  similarity(a, b) {
    const ta = this.tokens(a), tb = this.tokens(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return (inter / Math.min(ta.size, tb.size)) * 0.6 + (inter / (ta.size + tb.size - inter)) * 0.4;
  },
  similarAssist(db, text, limit = 6) {
    return (db.assist_examples || []).map((x) => [this.similarity(text, x.text || ""), x]).filter(([s]) => s > 0.2)
      .sort((a, b) => b[0] - a[0]).slice(0, limit);
  },
  bestTask(db, text, threshold) {
    const best = db.tasks.filter(Core.isOpen).map((t) => [this.similarity(text, t.title), t]).sort((a, b) => b[0] - a[0])[0];
    return best && best[0] >= threshold ? best[1] : null;
  },

  // ---------------------------------------------------------------- anotações -> pontos
  LIST_MARK: /^\s*(\d{1,2}\s*[.)\-–]|[-•*▪●○■□►])\s*/,
  segments(text) {
    let lines = String(text || "").split(/\r?\n/).map((l) => l.replace(this.LIST_MARK, "").trim()).filter(Boolean);
    if (lines.length === 1 && lines[0].length > 160) lines = lines[0].split(/(?<=[.!?;])\s+/).map((x) => x.trim()).filter(Boolean);
    return lines;
  },
  parseDue(s, base = todayISO()) {
    const n = this.norm(s);
    const iso = (s.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (iso) return iso;
    const m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
      const y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : base.slice(0, 4);
      return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
    }
    if (/\bdepois de amanha\b/.test(n)) return addDays(base, 2);
    if (/\bamanha\b/.test(n)) return addDays(base, 1);
    if (/\bhoje\b/.test(n)) return base;
    const days = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
    const wd = days.findIndex((d) => new RegExp(`\\b(na|no|ate|até)?\\s*${d}(-feira)?\\b`).test(n));
    if (wd >= 0) { let k = (wd - weekday(base) + 7) % 7; if (k === 0) k = 7; return addDays(base, k); }
    if (/\b(semana que vem|proxima semana)\b/.test(n)) return addDays(base, 7);
    return "";
  },
  AREA_WORDS: {
    "Saúde": ["academia", "treino", "treinei", "corri", "corrida", "medic", "consulta", "remedio", "dormi", "sono", "yoga", "caminhada", "caminhei", "dieta", "agua", "dentista", "terapia", "exame", "pilates", "alongamento", "natacao"],
    "Estudos": ["estud", "curso", "aula", "livro", "leitura", "li ", "prova", "artigo", "tese", "faculdade", "usp", "mestrado", "doutorado", "pesquisa", "ingles", "disciplina", "seminario", "tcc", "orientador"],
    "Trabalho": ["reuniao", "relatorio", "email", "e-mail", "cliente", "projeto", "apresentacao", "trabalho", "chefe", "entrega", "planilha", "slides"],
    "Finanças": ["pagar", "paguei", "conta ", "boleto", "banco", "fatura", "investi", "orcamento", "gastei", "dinheiro", "pix", "cartao", "imposto"],
    "Casa": ["limpar", "limpei", "lavar", "lavei", "louca", "roupa", "mercado", "casa", "cozinhei", "cozinhar", "arrumei", "arrumar", "faxina", "compras"],
    "Família e amigos": ["mae", "pai", "familia", "amig", "aniversario", "visita", "namorad", "irma", "avo", "filh"],
    "Lazer": ["filme", "serie", "passeio", "viagem", "jogo", "musica", "descans", "praia", "show", "cinema"],
  },
  guessArea(db, text) {
    const n = " " + this.norm(text) + " ";
    const areas = db.settings.areas || DEFAULT_AREAS;
    // área com mais palavras-chave na frase (empate: a primeira da lista)
    const best = Object.entries(this.AREA_WORDS).filter(([a]) => areas.includes(a)).map(([a, ws]) => [a, ws.filter((w) => n.includes(w)).length])
      .sort((x, y) => y[1] - x[1])[0];
    if (best && best[1]) return best[0];
    for (const a of areas) if (n.includes(" " + this.norm(a) + " ")) return a;
    return areas.includes("Outros") ? "Outros" : areas[areas.length - 1] || "";
  },
  RX: {
    labelDone: /^(\[x\]|✓|✔|✅|fiz\s*:|feito\s*:|ok\s*:)\s*/i,
    labelTodo: /^(\[\s?\]|☐|todo\s*:|pendente\s*:|fazer\s*:|tarefa\s*:)\s*/i,
    labelLearn: /^(aprendi\s*:|aprendizado\s*:|licao\s*:|lição\s*:|💡)\s*/i,
    labelMistake: /^(errei\s*:|erro\s*:|⚠️?)\s*/i,
    labelNote: /^(nota\s*:|obs\s*:|ideia\s*:|anotacao\s*:|anotação\s*:|🗒️?)\s*/i,
    mistake: /\b(errei|erro|esqueci|falhei|deveria ter|nao deveria|me atrasei|atrasei|cheguei atrasad|perdi o|perdi a|perdi meu|perdi minha|deixei de|vacilei|furei|me distrai|procrastinei)\b/,
    learned: /\b(aprendi|descobri|entendi|percebi|licao|aprendizado|insight|li que|vi que|conclui que)\b/,
    missed: /\b(nao fiz|nao consegui|faltou|ficou para|ficou pra|nao deu tempo|adiei|nao terminei|deixei para|deixei pra)\b/,
    todo: /^(preciso|tenho que|tenho de|lembrar|fazer|comprar|ligar|marcar|agendar|pagar|enviar|responder|estudar|ler|devo|quero|vou|amanha)\b|\b(amanha|ate (o dia|dia)? ?\d{1,2}\/\d{1,2}|semana que vem)\b/,
    progress: /\b(comecei|avancei|continuei|em andamento|metade|parte d[ao]|\d{1,3}\s*%|iniciei)\b/,
    note: /^(ideia|nota|obs|lembrete)\b/,
    done: /^(fiz|fui|li|terminei|termin|conclu|finalizei|entreguei|paguei|comprei|liguei|enviei|respondi|estudei|treinei|corri|limpei|lavei|cozinhei|arrumei|mandei|marquei|agendei|resolvi|organizei|escrevi|assisti|visitei|feito|pronto|ok)\b|^\p{L}+ei\b/u,
    high: /\b(urgente|importante|prioridade|sem falta)\b/,
  },
  cleanTitle(s) {
    return s.replace(this.RX.labelDone, "").replace(this.RX.labelTodo, "").replace(this.RX.labelLearn, "").replace(this.RX.labelMistake, "").replace(this.RX.labelNote, "")
      .replace(/\s*\b\d{4}-\d{2}-\d{2}\b|\s*\b(at[eé]\s+)?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi, "").replace(/\s*\((urgente|importante)\)/i, "").trim() || s;
  },

  heuristicProposal(db, line, date) {
    const raw = line.trim(), n = this.norm(raw);
    const base = { text: raw, title: this.cleanTitle(raw), area: this.guessArea(db, raw), priority: this.RX.high.test(n) ? "Alta" : "Média",
      due: this.parseDue(raw, date), lesson: "" };
    const out = (kind, target, reason) => ({ ...base, kind, target: target || "", reason });
    const valid = (k, id) => !id || Core.isOpen(Core.task(id));
    // 1) marcação explícita
    if (this.RX.labelDone.test(raw)) { const t = this.bestTask(db, base.title, 0.5); return out("done", t?.id, "Marcado como feito"); }
    if (this.RX.labelTodo.test(raw)) return out("todo", "", "Marcado como tarefa");
    if (this.RX.labelLearn.test(raw)) return out("learned", "", "Marcado como aprendizado");
    if (this.RX.labelMistake.test(raw)) return out("mistake", "", "Marcado como erro");
    if (this.RX.labelNote.test(raw)) return out("note", "", "Marcado como anotação");
    // 2) caso parecido que você já decidiu
    const [best] = this.similarAssist(db, raw, 1);
    if (best && best[0] >= 0.55 && valid(best[1].final.kind, best[1].final.target))
      return out(best[1].final.kind, best[1].final.target, `Como você decidiu num caso parecido: «${best[1].text.slice(0, 60)}»`);
    // 3) ID citado
    const tid = (raw.match(/\bTAR\d{3,}\b/i) || [])[0]?.toUpperCase();
    if (tid && Core.isOpen(Core.task(tid))) {
      if (this.RX.missed.test(n)) return out("missed", tid, `Cita ${tid}`);
      if (this.RX.progress.test(n)) return out("progress", tid, `Cita ${tid}`);
      return out("done", tid, `Cita ${tid}`);
    }
    // 4) erro, aprendizado, o que faltou
    if (this.RX.mistake.test(n)) {
      const p = out("mistake", "", "Fala de erro ou esquecimento");
      const m = raw.split(/\s+(?:—|–|->|→|=>)\s+|\b(?:da pr[oó]xima vez|na pr[oó]xima)\b[:,]?\s*/i);
      if (m.length > 1 && m[m.length - 1]) { p.title = m[0].trim(); p.lesson = m[m.length - 1].trim(); }
      return p;
    }
    if (this.RX.learned.test(n)) return out("learned", "", "Fala de algo que você aprendeu");
    if (this.RX.missed.test(n)) {
      const t = this.bestTask(db, raw, 0.35);
      const p = out("missed", t?.id, t ? `Faltou a tarefa ${t.id}` : "Algo que ficou por fazer");
      const rest = base.title.replace(/^(n[aã]o (fiz|consegui|terminei)( fazer)?|faltou( fazer)?|n[aã]o deu tempo( de)?|adiei)\s*/i, "").replace(/\s*,?\s*(ficou|deixei) p(ara|ra).*$/i, "")
        .replace(/^(o|a|os|as)\s+/i, "").trim();
      p.title = rest ? rest[0].toUpperCase() + rest.slice(1) : base.title;
      return p;
    }
    // 5) avanço numa tarefa
    if (this.RX.progress.test(n)) { const t = this.bestTask(db, raw, 0.35); return out("progress", t?.id, t ? `Avanço na tarefa ${t.id}` : "Avanço em algo novo"); }
    // 6) tarefa a fazer
    if (this.RX.todo.test(n)) {
      const p = out("todo", "", base.due ? `Tarefa com prazo ${fmtDate(base.due)}` : "Algo a fazer");
      const rest = base.title.replace(/^(preciso( de)?|tenho (que|de)|devo|lembrar( de)?|n[aã]o esquecer( de)?|vou)\s+/i, "")
        .replace(/\s*,?\s*\b(depois de amanh[aã]|amanh[aã]|hoje|(na|no|at[eé])\s+(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(-feira)?|(na )?semana que vem|(na )?pr[oó]xima semana)\s*$/i, "").trim();
      if (rest) p.title = rest[0].toUpperCase() + rest.slice(1);
      return p;
    }
    if (this.RX.note.test(n)) return out("note", "", "Ideia ou anotação");
    // 7) concluiu uma tarefa que já existia
    const t = this.bestTask(db, raw, 0.5);
    if (t) return out("done", t.id, `Parece a tarefa ${t.id}`);
    if (this.RX.done.test(n)) return out("done", "", "Verbo no passado: coisa feita");
    return out("done", "", "Relato do dia: registrado como feito");
  },

  get CAPTURE_SCHEMA() {
    const S = { type: "string" };
    return {
      type: "object", additionalProperties: false, required: ["proposals"],
      properties: { proposals: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["text", "title", "kind", "target_id", "area", "priority", "due_date", "lesson", "reason"],
        properties: { text: S, title: { type: "string", description: "Título curto e claro" }, kind: { type: "string", enum: KINDS },
          target_id: { type: "string", description: "TAR… quando o ponto se refere a uma tarefa em aberto (done, missed, progress, todo), senão vazio" },
          area: S, priority: { type: "string", enum: LEVELS }, due_date: { type: "string", description: "AAAA-MM-DD ou vazio" },
          lesson: { type: "string", description: "Para kind=mistake: o que fazer diferente da próxima vez, ou vazio" },
          reason: { type: "string", description: "Uma frase curta" } } } } },
    };
  },

  /** Propostas de registro para as anotações livres do dia. */
  async capture(db, text, date = todayISO()) {
    const lines = this.segments(text);
    const heur = () => lines.map((l) => this.heuristicProposal(db, l, date));
    const finish = (ps, engine, error) => ({ proposals: ps.map((p) => ({ ...p, ai: { kind: p.kind, target: p.target || "" } })), engine, error });
    if (!lines.length) return finish([], "heuristica");
    if (!this.enabled()) return finish(heur(), "heuristica");
    const J = (x) => JSON.stringify(x);
    const tasks = Core.openTasks().slice(-150).map((t) => ({ id: t.id, title: t.title, area: t.area, due: t.due, status: t.status }));
    const examples = [...new Map(lines.flatMap((l) => this.similarAssist(db, l, 3)).map(([, x]) => [x.date + x.text, x])).values()].slice(0, 12)
      .map((x) => ({ texto: x.text, ia_sugeriu: x.ai, usuario_decidiu: x.final }));
    const prompt = `Anotações livres do usuário sobre o dia ${date} (${WEEKDAYS[weekday(date)]}), um ponto por linha. Retorne uma proposta por linha, na mesma ordem:\n${J(lines)}\n\n`
      + "Tipos (kind): done = algo que a pessoa fez (se concluiu uma tarefa em aberto, target_id = TAR…); missed = algo planejado que não foi feito / faltou; "
      + "todo = tarefa nova a fazer (due_date se houver prazo: 'amanhã', 'sexta', '20/10'…); progress = avançou numa tarefa sem concluir; "
      + "learned = algo que aprendeu; mistake = erro, esquecimento ou algo que faria diferente (preencha lesson); note = anotação/ideia; ignore = sem valor de registro.\n"
      + `Áreas possíveis: ${J(db.settings.areas)}.\nPrefira ligar a uma tarefa em aberto quando o ponto for sobre ela.\n\n`
      + `Tarefas em aberto:\n${J(tasks)}\n\n`
      + `Regras do usuário (siga com prioridade):\n${db.settings.assist_rules || "(nenhuma)"}\n\n`
      + `Decisões anteriores do usuário em casos parecidos (aprenda e repita o critério):\n${J(examples)}`;
    try {
      const out = await this.call(prompt, this.CAPTURE_SCHEMA, "medium");
      const ps = out.proposals.map((p, i) => {
        const kind = KINDS.includes(p.kind) ? p.kind : "done";
        let target = (p.target_id || "").toUpperCase();
        if (!Core.isOpen(Core.task(target)) || ["learned", "note", "ignore"].includes(kind)) target = "";
        return { text: p.text || lines[i] || "", title: p.title || p.text, kind, target, area: db.settings.areas.includes(p.area) ? p.area : this.guessArea(db, p.text || ""),
          priority: LEVELS.includes(p.priority) ? p.priority : "Média", due: /^\d{4}-\d{2}-\d{2}$/.test(p.due_date) ? p.due_date : "", lesson: p.lesson || "", reason: p.reason };
      });
      return finish(ps, this.model);
    } catch (e) {
      return finish(heur(), "heuristica", e.message);
    }
  },

  /** Reflexão do dia para o sumário. */
  async reflect(db, d) {
    if (!this.enabled()) return { text: Core.heuristicReflection(d), engine: "heuristica" };
    const J = (x) => JSON.stringify(x);
    const data = { dia: d.date, fiz: d.done.map((x) => x.text), avancos: d.progress.map((x) => x.text),
      faltaram: d.missed.map((t) => ({ tarefa: t.title, prioridade: t.priority, prazo: t.due })), planejadas: d.planned.length, concluidas_do_planejado: d.plannedDone.length,
      aprendi: d.learned.map((x) => x.text), errei: d.mistakes.map((x) => ({ erro: x.text, proxima_vez: x.lesson })), anotacoes: d.notes.map((x) => x.text),
      nota_do_dia: d.mood || null, reflexao_do_usuario: d.reflection };
    const prompt = `Escreva uma reflexão curta (no máximo 8 linhas, texto simples, sem markdown) sobre o dia abaixo, em três partes: `
      + `"O que foi bem:", "Onde melhorar:" (ligando os erros a uma ação concreta) e "Para amanhã:" (no máximo 3 prioridades, começando pelo que faltou e é mais importante).\n${J(data)}`;
    try { return { text: (await this.call(prompt, null, "low", 2000)).trim(), engine: this.model }; }
    catch (e) { return { text: Core.heuristicReflection(d), engine: "heuristica", error: e.message }; }
  },
};
