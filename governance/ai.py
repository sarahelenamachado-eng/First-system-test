"""Camada de IA.

Usa o Claude (SDK oficial `anthropic`) quando há credenciais configuradas
(ANTHROPIC_API_KEY ou perfil `ant auth login`). Sem credenciais, cai para
heurísticas locais, para que a plataforma funcione offline.

"Aprendizado": cada vez que o usuário confirma/corrige uma sugestão, o par
(sugestão da IA, decisão final) é guardado em db["feedback"]. Os exemplos mais
parecidos com a nova demanda são enviados ao Claude como referência, e a
heurística local também os reutiliza.
"""
import base64
import csv
import io
import json
import os
import re
import unicodedata

MODEL = os.environ.get("GOV_MODEL", "claude-opus-5-5")

IMPACT_TYPES = ["Custo", "Eficiência", "Operação", "Compliance", "People"]
DEFINITIONS = {
    "risco_monitorar": "Risco a monitorar",
    "risco_investigar": "Risco a investigar",
    "info_reportar": "Info a ser reportada",
    "novo_projeto": "Criação de um novo projeto",
    "acao_projeto": "Ação dentro de um projeto",
    "acao_geral": "Ação geral",
}

SYSTEM_PROMPT = """Você é o assistente de governança corporativa de uma diretoria.
Você recebe demandas vindas da diretora, de reuniões, de departamentos ou do HQ e ajuda a fazer o
"demand management": verificar relação com itens já levantados, classificar (escopo, prioridade,
impactos) e sugerir a definição (risco, info a reportar, novo projeto, ação em projeto, ação geral).
Use a lógica de Hoshin Kanri para alinhar demandas à estratégia: conecte cada demanda aos objetivos
e projetos existentes, destaque desdobramentos e interfaces entre áreas, e aponte gaps (por que algo
não foi previsto antes). Responda sempre em português do Brasil, de forma objetiva.
O usuário sempre confirma ou corrige suas sugestões; trate os exemplos de decisões anteriores como
critério da organização e siga-os quando aplicáveis."""

_client = None
_client_error = None


def client():
    global _client, _client_error
    if _client is not None or _client_error is not None:
        return _client
    if os.environ.get("GOV_AI", "on").lower() == "off":
        _client_error = "IA desativada (GOV_AI=off)"
        return None
    has_creds = (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                 or os.path.isdir(os.path.expanduser("~/.config/anthropic")))
    if not has_creds:
        _client_error = "sem credenciais do Claude (defina ANTHROPIC_API_KEY ou rode `ant auth login`)"
        return None
    try:
        import anthropic
        _client = anthropic.Anthropic()
    except ImportError:
        _client_error = "pacote 'anthropic' não instalado (pip install anthropic)"
    except Exception as e:  # credenciais ausentes etc.
        _client_error = f"Claude indisponível: {e}"
    return _client


def status():
    c = client()
    return {"enabled": c is not None, "model": MODEL if c else None, "detail": _client_error}


def _call(messages, schema=None, effort="medium", max_tokens=16000):
    """Chama o Claude. Retorna dict (se schema) ou texto. Levanta RuntimeError em falha."""
    import anthropic
    c = client()
    if c is None:
        raise RuntimeError(_client_error or "IA indisponível")
    kwargs = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": SYSTEM_PROMPT,
        "messages": messages,
        "output_config": {"effort": effort},
        # Se um classificador de segurança recusar, o servidor tenta outro modelo automaticamente.
        "extra_headers": {"anthropic-beta": "server-side-fallback-2026-07-01"},
        "extra_body": {"fallbacks": "default"},
    }
    if schema:
        kwargs["output_config"]["format"] = {"type": "json_schema", "schema": schema}
    try:
        resp = c.messages.create(**kwargs)
    except anthropic.APIConnectionError as e:
        raise RuntimeError(f"Sem conexão com a API do Claude: {e}")
    except anthropic.RateLimitError:
        raise RuntimeError("Limite de requisições atingido; tente novamente em instantes.")
    except anthropic.APIStatusError as e:
        raise RuntimeError(f"Erro da API do Claude ({e.status_code}): {e.message}")
    except anthropic.AnthropicError as e:
        raise RuntimeError(f"Erro do cliente Claude: {e}")
    if resp.stop_reason == "refusal":
        raise RuntimeError("O modelo recusou a solicitação.")
    text = "".join(b.text for b in resp.content if b.type == "text")
    if not schema:
        return text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError("Resposta da IA em formato inválido.")


# ----------------------------------------------------------------- utilidades de texto

_STOP = set("a o os as de da do das dos e em no na nos nas um uma para por com sem que se ao à é ser sobre the of and to in".split())


def _norm(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def tokens(s):
    # radical simples (6 primeiras letras) para aproximar plural/gênero: gerador ~ geradores
    return {w[:6] for w in re.findall(r"[a-z0-9]{3,}", _norm(s)) if w not in _STOP}


def similarity(a, b):
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb)) * 0.6 + len(ta & tb) / len(ta | tb) * 0.4


def item_text(it):
    return " ".join(str(it.get(k) or "") for k in ("title", "description", "background", "area_main", "scope"))


def input_text(inp):
    return " ".join(str(inp.get(k) or "") for k in ("title", "description", "background", "origin", "area_main", "areas_impacted", "areas_impacting"))


def related_items(db, text, limit=5, threshold=0.18):
    scored = []
    for it in db["items"]:
        s = similarity(text, item_text(it))
        if s >= threshold:
            scored.append((s, it))
    scored.sort(key=lambda x: -x[0])
    return [{"id": it["id"], "title": it["title"], "score": round(s, 2), "status": it.get("status")} for s, it in scored[:limit]]


def similar_feedback(db, text, limit=5):
    scored = sorted(db["feedback"], key=lambda f: -similarity(text, f.get("text", "")))
    return [f for f in scored[:limit] if similarity(text, f.get("text", "")) > 0.1]


# ----------------------------------------------------------------- avaliação de demandas

ASSESS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["related", "relation_mode", "include_in", "relation_explanation", "scope", "scope_action",
                 "priority", "urgency", "risk_reason", "impacts", "impact_details", "definitions",
                 "project_id", "gap_analysis", "rationale"],
    "properties": {
        "related": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                    "required": ["id", "relation"], "properties": {"id": {"type": "string"}, "relation": {"type": "string"}}}},
        "relation_mode": {"type": "string", "enum": ["novo", "incluir_existente"]},
        "include_in": {"type": "string", "description": "ID do item on going quando relation_mode=incluir_existente, senão vazio"},
        "relation_explanation": {"type": "string"},
        "scope": {"type": "string", "description": "O que é?"},
        "scope_action": {"type": "string", "description": "O que deve ser feito com isso?"},
        "priority": {"type": "string", "enum": ["Alta", "Média", "Baixa"]},
        "urgency": {"type": "string", "enum": ["Alta", "Média", "Baixa"]},
        "risk_reason": {"type": "string", "description": "Por que há risco e por que essa urgência"},
        "impacts": {"type": "array", "items": {"type": "string", "enum": IMPACT_TYPES}},
        "impact_details": {"type": "string", "description": "Impactos em quais projetos/operações, por quê"},
        "definitions": {"type": "array", "items": {"type": "string", "enum": list(DEFINITIONS.keys())}},
        "project_id": {"type": "string", "description": "Projeto existente relacionado, ou vazio"},
        "gap_analysis": {"type": "string", "description": "Possíveis gaps / por que a ação não foi prevista antes"},
        "rationale": {"type": "string"},
    },
}

_PRIORITY_WORDS = ["urgente", "imediato", "critico", "ministerio", "multa", "acidente", "parada", "seguranca", "investigacao", "processo", "hq", "diretora"]
_IMPACT_WORDS = {
    "Custo": ["custo", "multa", "orcamento", "contrato", "preco", "pagamento", "budget", "financeiro"],
    "Eficiência": ["atraso", "produtividade", "eficiencia", "retrabalho", "prazo", "lento", "fluxo"],
    "Operação": ["operacao", "gerador", "equipamento", "parada", "manutencao", "pecas", "yard", "patio", "energia", "voltage"],
    "Compliance": ["ministerio", "lei", "auditoria", "norma", "compliance", "regulatorio", "fiscalizacao", "investigacao", "legal"],
    "People": ["turnover", "funcionarios", "ambiente", "rh", "saude", "pessoas", "colaboradores", "ventiladores", "treinamento", "clima"],
}


def _heuristic_assess(db, inp, related):
    text = _norm(input_text(inp))
    learned = similar_feedback(db, input_text(inp), 1)
    impacts = [k for k, words in _IMPACT_WORDS.items() if any(w in text for w in words)]
    hits = sum(1 for w in _PRIORITY_WORDS if w in text)
    priority = "Alta" if hits >= 2 else "Média" if hits == 1 else "Baixa"
    defs = []
    if any(w in text for w in ["risco", "investig", "ministerio", "acidente", "multa"]):
        defs.append("risco_investigar" if "investig" in text else "risco_monitorar")
    project = ""
    for p in db["projects"]:
        if similarity(input_text(inp), p.get("name", "") + " " + p.get("description", "")) > 0.3:
            project = p["id"]
            break
    if project:
        defs.append("acao_projeto")
    elif len(related) >= db["settings"].get("links_for_project_alert", 3):
        defs.append("novo_projeto")
    if not defs:
        defs.append("acao_geral")
    mode = "incluir_existente" if related and related[0]["score"] >= 0.55 else "novo"
    result = {
        "related": [{"id": r["id"], "relation": f"similaridade {r['score']}"} for r in related],
        "relation_mode": mode,
        "include_in": related[0]["id"] if mode == "incluir_existente" else "",
        "relation_explanation": "Relação direta (alta similaridade) com item on going." if mode == "incluir_existente"
        else ("Relacionado em impacto, mas não diretamente: criar item novo e vincular." if related else "Nenhum item relacionado encontrado."),
        "scope": inp.get("title", ""),
        "scope_action": "",
        "priority": priority,
        "urgency": priority,
        "risk_reason": "",
        "impacts": impacts,
        "impact_details": "",
        "definitions": defs,
        "project_id": project,
        "gap_analysis": "",
        "rationale": "Sugestão heurística (IA offline): palavras-chave, similaridade com o histórico e decisões anteriores.",
    }
    if learned:
        final = learned[0].get("final", {})
        for k in ("priority", "urgency", "impacts", "definitions"):
            if final.get(k):
                result[k] = final[k]
        result["rationale"] += f" Baseado na decisão anterior em {learned[0].get('ref')}."
    return result


def assess_input(db, inp):
    """Etapa 2 do fluxo (Assessment): relação com itens on going + classificação + definição sugerida."""
    text = input_text(inp)
    related = related_items(db, text, limit=8, threshold=0.12)
    c = client()
    if c is None:
        out = _heuristic_assess(db, inp, related)
        out["engine"] = "heuristica"
        return out
    ongoing = [{"id": it["id"], "title": it["title"], "status": it.get("status"), "scope": it.get("scope"),
                "priority": it.get("priority"), "projects": it.get("links", {}).get("projects", [])}
               for it in db["items"] if it.get("status") != "Concluído"][-80:]
    projects = [{"id": p["id"], "name": p["name"], "description": p.get("description", "")[:300]} for p in db["projects"]]
    examples = [{"demanda": f["text"][:500], "sugestao_ia": f.get("ai"), "decisao_final_usuario": f.get("final")}
                for f in similar_feedback(db, text)]
    prompt = (
        "Nova demanda (input):\n" + json.dumps({k: inp.get(k) for k in (
            "source", "source_detail", "title", "description", "background", "origin", "area_main",
            "areas_impacted", "areas_impacting", "owner", "due_date")}, ensure_ascii=False, indent=1)
        + "\n\nItens on going na lista geral de governança:\n" + json.dumps(ongoing, ensure_ascii=False)
        + "\n\nCandidatos mais parecidos (similaridade textual):\n" + json.dumps(related, ensure_ascii=False)
        + "\n\nProjetos existentes:\n" + json.dumps(projects, ensure_ascii=False)
        + "\n\nDecisões anteriores do usuário em demandas parecidas (aprenda com elas):\n" + json.dumps(examples, ensure_ascii=False)
        + "\n\nTarefa: 1) Verifique se tem relação com item já levantado. Relação direta -> relation_mode=incluir_existente "
          "e include_in=<id>. Relacionado só em impacto -> relation_mode=novo, e liste o vínculo em related. "
          "2) Classifique escopo (o que é / o que fazer), prioridade, urgência com justificativa do risco, impactos "
          "(Custo, Eficiência, Operação, Compliance, People) e em quais projetos/operações. "
          "3) Sugira uma ou mais definições. Use project_id quando for ação dentro de projeto existente. "
          "4) Aponte gaps: por que isso não foi previsto antes."
    )
    try:
        out = _call([{"role": "user", "content": prompt}], ASSESS_SCHEMA, effort="medium")
        valid = {it["id"] for it in db["items"]}
        out["related"] = [r for r in out.get("related", []) if r["id"] in valid]
        if out.get("include_in") not in valid:
            out["include_in"], out["relation_mode"] = "", "novo"
        if out.get("project_id") not in {p["id"] for p in db["projects"]}:
            out["project_id"] = ""
        out["engine"] = MODEL
        return out
    except RuntimeError as e:
        out = _heuristic_assess(db, inp, related)
        out["engine"] = "heuristica"
        out["rationale"] += f" (Claude falhou: {e})"
        return out


# ----------------------------------------------------------------- reuniões

EXTRACT_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["summary", "decisions", "demands"],
    "properties": {
        "summary": {"type": "string"},
        "decisions": {"type": "array", "items": {"type": "string"}},
        "demands": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                    "required": ["title", "description", "owner", "due_date", "area_main", "related_item"],
                    "properties": {"title": {"type": "string"}, "description": {"type": "string"},
                                   "owner": {"type": "string"}, "due_date": {"type": "string", "description": "AAAA-MM-DD ou vazio"},
                                   "area_main": {"type": "string"}, "related_item": {"type": "string", "description": "ID de item existente ou vazio"}}}},
    },
}


def extract_meeting(db, meeting):
    text = f"{meeting.get('minutes', '')}\n{meeting.get('notes', '')}"
    c = client()
    if c is None:
        demands = []
        for line in text.splitlines():
            l = line.strip(" -•*\t")
            if re.match(r"(?i)^(a[cç][aã]o|action|todo|pend[eê]ncia|demanda|tarefa)\s*[:\-]", l) or l.lower().startswith(("ação ", "acao ")):
                title = re.sub(r"(?i)^(a[cç][aã]o|action|todo|pend[eê]ncia|demanda|tarefa)\s*[:\-]\s*", "", l)
                owner = (re.search(r"(?i)resp(?:ons[aá]vel)?\s*[:\-]\s*([^\d,;]+)", l) or [None, ""])[1]
                due = (re.search(r"(\d{4}-\d{2}-\d{2})", l) or [None, ""])[1]
                title = re.sub(r"(?i)\s*resp(?:ons[aá]vel)?\s*[:\-].*$", "", title).strip() or title
                rel = related_items(db, title, 1, 0.4)
                demands.append({"title": title[:120], "description": l, "owner": owner.strip(), "due_date": due,
                                "area_main": "", "related_item": rel[0]["id"] if rel else ""})
        decisions = [l.strip(" -•*") for l in text.splitlines() if re.match(r"(?i)^\s*[-•*]?\s*decis", l)]
        return {"summary": text[:400], "decisions": decisions, "demands": demands, "engine": "heuristica",
                "hint": "IA offline: marque linhas como 'Ação: ... resp: Nome 2026-10-20' para extração automática."}
    items = [{"id": it["id"], "title": it["title"]} for it in db["items"]][-120:]
    prompt = (f"Reunião: {meeting.get('title')} em {meeting.get('date')} — participantes: {meeting.get('participants', '')}\n"
              f"Ata / anotações:\n{text}\n\nItens já existentes na lista de governança:\n{json.dumps(items, ensure_ascii=False)}\n\n"
              "Resuma a reunião, liste as decisões e extraia cada demanda/ação nova ou atualização (com responsável e prazo "
              "quando citados). Se a demanda se refere a um item existente, informe o ID em related_item.")
    try:
        out = _call([{"role": "user", "content": prompt}], EXTRACT_SCHEMA, effort="medium")
        out["engine"] = MODEL
        return out
    except RuntimeError as e:
        return {"summary": "", "decisions": [], "demands": [], "engine": "erro", "hint": str(e)}


# ----------------------------------------------------------------- master schedule

def _table_from_file(path):
    ext = os.path.splitext(path)[1].lower()
    rows = []
    if ext in (".csv", ".txt"):
        with open(path, encoding="utf-8-sig", errors="replace") as f:
            sample = f.read(4096)
            f.seek(0)
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=";,\t")
            except csv.Error:
                dialect = csv.excel
            rows = [r for r in csv.reader(f, dialect)]
    elif ext in (".xlsx", ".xlsm"):
        try:
            import openpyxl
        except ImportError:
            return None
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb.worksheets[0]
        for r in ws.iter_rows(values_only=True):
            if any(v is not None for v in r):
                rows.append(["" if v is None else (v.date().isoformat() if hasattr(v, "date") else str(v)) for v in r])
        wb.close()
    else:
        return None
    return rows


def _heuristic_schedule(rows, ref_date):
    if not rows:
        return {"overview": "Arquivo armazenado. Formato sem leitura automática (envie .xlsx/.csv/.pdf para análise).", "tasks": []}
    header_idx = 0
    for i, r in enumerate(rows[:15]):
        h = _norm(" ".join(r))
        if any(k in h for k in ("tarefa", "task", "atividade", "activity")):
            header_idx = i
            break
    head = [_norm(h) for h in rows[header_idx]]

    def col(*names):
        for i, h in enumerate(head):
            if any(n in h for n in names):
                return i
        return None
    ci, cs, cf, cp = col("tarefa", "task", "atividade", "activity", "nome", "name"), col("inicio", "start"), col("termino", "fim", "finish", "end"), col("%", "progress", "conclu")
    tasks = []
    for r in rows[header_idx + 1:]:
        g = lambda c: (r[c] if c is not None and c < len(r) else "") or ""
        name = g(ci)
        if not name:
            continue
        try:
            pct = float(str(g(cp)).replace("%", "").replace(",", ".") or 0)
            pct = pct * 100 if pct <= 1 and "%" not in str(g(cp)) and pct != 0 else pct
        except ValueError:
            pct = 0.0
        tasks.append({"task": name, "start": str(g(cs))[:10], "finish": str(g(cf))[:10], "progress": round(pct)})
    late = [t for t in tasks if t["finish"] and t["finish"] < ref_date and t["progress"] < 100]
    upcoming = sorted([t for t in tasks if t["finish"] and t["finish"] >= ref_date and t["progress"] < 100], key=lambda t: t["finish"])[:10]
    done = sum(1 for t in tasks if t["progress"] >= 100)
    return {
        "overview": f"{len(tasks)} atividades lidas; {done} concluídas; {len(late)} atrasadas.",
        "late": late[:20], "upcoming": upcoming, "tasks_count": len(tasks),
    }


SCHEDULE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["overview", "phases", "late", "upcoming", "critical_points", "suggested_actions"],
    "properties": {
        "overview": {"type": "string"},
        "phases": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["name", "start", "finish", "status"],
                   "properties": {"name": {"type": "string"}, "start": {"type": "string"}, "finish": {"type": "string"}, "status": {"type": "string"}}}},
        "late": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["task", "finish", "progress"],
                 "properties": {"task": {"type": "string"}, "finish": {"type": "string"}, "progress": {"type": "number"}}}},
        "upcoming": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["task", "finish", "progress"],
                     "properties": {"task": {"type": "string"}, "finish": {"type": "string"}, "progress": {"type": "number"}}}},
        "critical_points": {"type": "array", "items": {"type": "string"}},
        "suggested_actions": {"type": "array", "items": {"type": "string"}},
    },
}


def analyze_schedule(db, project, path, ref_date):
    rows = _table_from_file(path)
    ext = os.path.splitext(path)[1].lower()
    c = client()
    if c is None or (rows is None and ext != ".pdf"):
        out = _heuristic_schedule(rows or [], ref_date)
        out["engine"] = "heuristica"
        return out
    intro = (f"Projeto {project['id']} — {project['name']}. Data de referência: {ref_date}.\n"
             "Organize esta master schedule: visão geral, fases/marcos, atividades atrasadas, próximas entregas "
             "(próximas 4 semanas), pontos críticos (caminho crítico, interfaces com outras áreas) e ações sugeridas.")
    if ext == ".pdf":
        with open(path, "rb") as f:
            data = base64.standard_b64encode(f.read()).decode()
        content = [{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}},
                   {"type": "text", "text": intro}]
    else:
        table = "\n".join(" | ".join(r) for r in rows)
        content = intro + "\n\nCronograma (tabela):\n" + table
    try:
        out = _call([{"role": "user", "content": content}], SCHEDULE_SCHEMA, effort="medium")
        out["engine"] = MODEL
        return out
    except RuntimeError as e:
        out = _heuristic_schedule(rows or [], ref_date)
        out["engine"] = "heuristica"
        out["overview"] += f" (Claude falhou: {e})"
        return out


# ----------------------------------------------------------------- riscos

RISK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["summary", "probability", "impact", "causes", "consequences", "mitigations", "report_points"],
    "properties": {
        "summary": {"type": "string"}, "probability": {"type": "string", "enum": ["Alta", "Média", "Baixa"]},
        "impact": {"type": "string", "enum": ["Alto", "Médio", "Baixo"]},
        "causes": {"type": "array", "items": {"type": "string"}}, "consequences": {"type": "array", "items": {"type": "string"}},
        "mitigations": {"type": "array", "items": {"type": "string"}}, "report_points": {"type": "array", "items": {"type": "string"}},
    },
}


def analyze_risk(db, risk, files_text):
    linked = [it for it in db["items"] if it["id"] in risk.get("links", {}).get("items", [])]
    c = client()
    if c is None:
        return {"summary": "IA offline — análise automática indisponível. Preencha manualmente.", "probability": risk.get("probability", "Média"),
                "impact": risk.get("impact", "Médio"), "causes": [], "consequences": [], "mitigations": [], "report_points": [], "engine": "heuristica"}
    prompt = (f"Risco {risk['id']}: {risk['title']} ({risk.get('mode')})\nDescrição: {risk.get('description', '')}\n"
              f"Itens vinculados: {json.dumps([{'id': i['id'], 'title': i['title'], 'risk_reason': i.get('risk_reason')} for i in linked], ensure_ascii=False)}\n"
              f"Notas: {risk.get('notes', '')}\nConteúdo dos documentos da pasta (texto):\n{files_text[:60000]}\n\n"
              "Compile as informações do risco para análise e reporte. As sugestões serão confirmadas pelo usuário.")
    try:
        out = _call([{"role": "user", "content": prompt}], RISK_SCHEMA, effort="medium")
        out["engine"] = MODEL
        return out
    except RuntimeError as e:
        return {"summary": f"Falha na análise: {e}", "probability": "Média", "impact": "Médio", "causes": [], "consequences": [],
                "mitigations": [], "report_points": [], "engine": "erro"}


# ----------------------------------------------------------------- summaries

def narrative(summary):
    """Texto de destaques do summary diário/semanal."""
    k = summary["kpis"]
    basic = (f"{k['new_inputs']} novas demandas, {k['items_created']} itens criados e {k['items_updated']} atualizados. "
             f"{k['overdue']} itens vencidos e {k['high_priority_open']} de alta prioridade em aberto. "
             f"{k['meetings']} reuniões registradas. {len(summary['alerts'])} alertas ativos.")
    if client() is None:
        return basic
    prompt = ("Escreva os DESTAQUES deste summary de governança (" + summary["type"] + ") em até 8 bullets curtos: "
              "o que mudou, o que exige atenção da diretoria, riscos, decisões e próximos passos. Use Hoshin Kanri "
              "para conectar com os objetivos estratégicos. Dados:\n" + json.dumps(summary, ensure_ascii=False, default=str)[:80000])
    try:
        return _call([{"role": "user", "content": prompt}], effort="low", max_tokens=4000)
    except RuntimeError as e:
        return f"{basic}\n(Destaques da IA indisponíveis: {e})"
