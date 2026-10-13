"""Servidor local da Plataforma de Governança (somente biblioteca padrão + `anthropic` opcional).

Uso:  python governance/server.py   ->  http://localhost:8765
"""
import base64
import csv
import io
import json
import mimetypes
import os
import re
import sys
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai  # noqa: E402
import storage as st  # noqa: E402

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
MAX_UPLOAD = 60 * 1024 * 1024


class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


def _days_since(iso):
    try:
        return (date.today() - datetime.fromisoformat(iso).date()).days
    except (TypeError, ValueError):
        return 0


# ------------------------------------------------------------------ regras de negócio

def touch(rec):
    rec["updated_at"] = st.now()


def create_record(db, col, data):
    rec = dict(data)
    rec["id"] = st.next_id(db, col)
    rec["created_at"] = rec["updated_at"] = st.now()
    rec.setdefault("links", {})
    rec.setdefault("history", [])
    if col == "projects":
        rec.setdefault("status", "Em andamento")
        rec.setdefault("actions", [])
        rec.setdefault("schedules", [])
        rec["last_monitored"] = st.today()
        cad = int(db["settings"].get("project_meeting_cadence_days", 15))
        rec.setdefault("next_meeting", (date.today() + timedelta(days=cad)).isoformat())
        rec["folder"] = os.path.relpath(st.folder_for("projects", rec["id"]), st.WORKSPACE)
    elif col == "risks":
        rec.setdefault("status", "Aberto")
        rec.setdefault("mode", "Monitorar")
        rec["folder"] = os.path.relpath(st.folder_for("risks", rec["id"]), st.WORKSPACE)
        with open(os.path.join(st.WORKSPACE, rec["folder"], "LEIA-ME.txt"), "w", encoding="utf-8") as f:
            f.write(f"{rec['id']} INFOS AND GENERAL OVERVIEW\n{rec.get('title', '')}\n\n"
                    "Coloque aqui todas as informações e documentos a cerca do problema.\n"
                    "A plataforma compila estes arquivos para análise e reporte.\n")
    elif col == "meetings":
        rec.setdefault("date", st.today())
    elif col == "items":
        rec.setdefault("status", "Aberto")
    db[col].append(rec)
    label = rec.get("title") or rec.get("name") or ""
    st.log(db, f"{col}.created", rec["id"], f"{rec['id']} criado: {label}")
    return rec


def commit_input(db, inp, body):
    """Etapas 2 e 3 do fluxo: registra a classificação e a definição, cria/atualiza item e os módulos ligados."""
    a = body.get("assessment", {})
    defs = body.get("definitions", [])
    related = body.get("related", [])
    mode = body.get("relation_mode", "novo")
    target = body.get("include_in", "")

    if mode == "incluir_existente" and st.find(db, "items", target):
        item = st.find(db, "items", target)
        item["history"].append({"date": st.now(), "text": f"Nova entrada {inp['id']} ({inp.get('source')}): {inp.get('title')}"})
        for k in ("priority", "urgency"):
            order = {"Baixa": 0, "Média": 1, "Alta": 2}
            if order.get(a.get(k), -1) > order.get(item.get(k), -1):
                item[k] = a[k]
        item["impacts"] = sorted(set(item.get("impacts", [])) | set(a.get("impacts", [])))
        item["definitions"] = sorted(set(item.get("definitions", [])) | set(defs))
        if item.get("status") == "Concluído":
            item["status"] = "Em andamento"
        touch(item)
        st.log(db, "items.updated", item["id"], f"{item['id']} atualizado com a entrada {inp['id']}")
    else:
        item = create_record(db, "items", {
            "title": inp.get("title"), "description": inp.get("description"), "background": inp.get("background"),
            "source": inp.get("source"), "source_detail": inp.get("source_detail"), "origin": a.get("origin") or inp.get("origin"),
            "area_main": inp.get("area_main"), "areas_impacted": inp.get("areas_impacted"), "areas_impacting": inp.get("areas_impacting"),
            "owner": inp.get("owner"), "due_date": inp.get("due_date"), "emitted_at": inp.get("created_at", "")[:10],
            "scope": a.get("scope"), "scope_action": a.get("scope_action"), "priority": a.get("priority"),
            "urgency": a.get("urgency"), "risk_reason": a.get("risk_reason"), "impacts": a.get("impacts", []),
            "impact_details": a.get("impact_details"), "gap_analysis": a.get("gap_analysis"), "definitions": defs,
        })
    st.link(db, "inputs", inp["id"], "items", item["id"])
    for rid in related:
        if rid != item["id"] and st.find(db, "items", rid):
            st.link(db, "items", item["id"], "items", rid)
    if inp.get("meeting_id") and st.find(db, "meetings", inp["meeting_id"]):
        st.link(db, "items", item["id"], "meetings", inp["meeting_id"])

    created = {"item": item["id"]}
    included = mode == "incluir_existente"
    # --- definições -> módulos
    for d in defs:
        existing_risks = [r for r in (st.find(db, "risks", x) for x in item["links"].get("risks", [])) if r and r.get("status") != "Fechado"]
        if d in ("risco_monitorar", "risco_investigar") and included and existing_risks:
            # item on going já tem risco aberto: registra a nova informação nele em vez de duplicar
            for r in existing_risks:
                r.setdefault("history", []).append({"date": st.now(), "text": f"Nova entrada {inp['id']}: {inp.get('title')}"})
                if d == "risco_investigar":
                    r["mode"] = "Investigar"
                touch(r)
            created.setdefault("risks", []).extend(r["id"] for r in existing_risks)
        elif d == "novo_projeto" and included and item["links"].get("projects"):
            created["project"] = item["links"]["projects"][0]
        elif d in ("risco_monitorar", "risco_investigar"):
            risk = create_record(db, "risks", {
                "title": inp.get("title"), "description": inp.get("description"), "owner": inp.get("owner"),
                "mode": "Investigar" if d == "risco_investigar" else "Monitorar",
                "probability": a.get("urgency", "Média"), "impact": {"Alta": "Alto", "Média": "Médio", "Baixa": "Baixo"}.get(a.get("priority"), "Médio"),
                "notes": a.get("risk_reason", ""),
            })
            st.link(db, "items", item["id"], "risks", risk["id"])
            created.setdefault("risks", []).append(risk["id"])
        elif d == "novo_projeto":
            proj = create_record(db, "projects", {
                "name": body.get("new_project_name") or inp.get("title"), "description": inp.get("description"),
                "owner": inp.get("owner"), "origin_item": item["id"],
            })
            st.link(db, "items", item["id"], "projects", proj["id"])
            created["project"] = proj["id"]
        elif d == "acao_projeto":
            proj = st.find(db, "projects", body.get("project_id", ""))
            if not proj:
                raise ApiError(400, "Selecione o projeto para 'Ação dentro de um projeto'.")
            act_id = st.next_id(db, "actions")
            proj["actions"].append({"id": act_id, "text": inp.get("title"), "item_id": item["id"], "owner": inp.get("owner"),
                                    "due": inp.get("due_date"), "status": "Aberta", "gap_reason": body.get("gap_reason") or a.get("gap_analysis", ""),
                                    "created_at": st.now()})
            touch(proj)
            st.link(db, "items", item["id"], "projects", proj["id"])
            st.log(db, "projects.action", proj["id"], f"Ação {act_id} incluída no portfólio de {proj['id']}: {inp.get('title')}")
            created["action"] = act_id
        elif d == "info_reportar":
            item["report"] = True

    # --- aprendizado: guarda sugestão x decisão
    db["feedback"].append({"date": st.now(), "ref": inp["id"], "text": ai.input_text(inp),
                           "ai": inp.get("ai_suggestion"), "final": {**a, "definitions": defs, "relation_mode": mode}})
    inp.update({"status": "Registrado", "item_id": item["id"], "assessment": a, "definitions": defs})
    touch(inp)
    st.log(db, "inputs.committed", inp["id"], f"{inp['id']} classificado e registrado em {item['id']} ({', '.join(ai.DEFINITIONS.get(d, d) for d in defs)})")
    return created


def alerts(db):
    s = db["settings"]
    out = []
    limit = int(s.get("alert_days_without_update", 15))
    for p in db["projects"]:
        if p.get("status") in ("Concluído", "Cancelado"):
            continue
        d = _days_since(p.get("last_monitored") or p.get("updated_at"))
        if d >= limit:
            out.append({"level": "alta", "ref": p["id"], "text": f"Projeto {p['id']} — {p['name']}: {d} dias sem monitoramento/atualização."})
        if p.get("next_meeting") and p["next_meeting"] <= st.today():
            out.append({"level": "media", "ref": p["id"], "text": f"Reunião de acompanhamento de {p['id']} prevista para {p['next_meeting']}."})
    n = int(s.get("links_for_project_alert", 3))
    for it in db["items"]:
        if it.get("status") == "Concluído":
            continue
        links = it.get("links", {})
        if len(links.get("items", [])) >= n and not links.get("projects"):
            out.append({"level": "alta", "ref": it["id"], "text": f"{it['id']} está interligado a {len(links['items'])} itens: avaliar criação de um projeto com overview maior."})
        if it.get("due_date") and it["due_date"] < st.today():
            out.append({"level": "alta", "ref": it["id"], "text": f"{it['id']} — {it['title']}: prazo vencido em {it['due_date']}."})
        if len(links.get("inputs", [])) >= n:
            out.append({"level": "media", "ref": it["id"], "text": f"{it['id']} recebeu {len(links['inputs'])} entradas: tema recorrente."})
    for r in db["risks"]:
        if r.get("status") != "Fechado" and _days_since(r.get("updated_at")) >= limit:
            out.append({"level": "media", "ref": r["id"], "text": f"Risco {r['id']} sem atualização há {_days_since(r.get('updated_at'))} dias."})
    pending = [i for i in db["inputs"] if i.get("status") != "Registrado"]
    if pending:
        out.append({"level": "baixa", "ref": "inputs", "text": f"{len(pending)} entradas aguardando classificação."})
    return out


def build_summary(db, kind, ref):
    ref_d = date.fromisoformat(ref)
    if kind == "weekly":
        start = ref_d - timedelta(days=ref_d.weekday())
        end = start + timedelta(days=6)
    else:
        start = end = ref_d
    s, e = start.isoformat(), end.isoformat()
    inr = lambda iso: bool(iso) and s <= iso[:10] <= e
    events = [ev for ev in db["events"] if inr(ev["date"])]
    open_items = [i for i in db["items"] if i.get("status") != "Concluído"]
    new_inputs = [i for i in db["inputs"] if inr(i.get("created_at"))]
    by_source = {}
    for i in new_inputs:
        by_source.setdefault(i.get("source") or "Outro", []).append({"id": i["id"], "title": i.get("title"), "status": i.get("status")})
    upd_ids = {ev["ref"] for ev in events if ev["type"].startswith("items.")}
    horizon = (end + timedelta(days=7)).isoformat()
    brief = lambda i: {"id": i["id"], "title": i.get("title"), "owner": i.get("owner"), "due_date": i.get("due_date"),
                       "priority": i.get("priority"), "status": i.get("status")}
    summary = {
        "type": "Summary semanal" if kind == "weekly" else "Summary diário",
        "period": {"start": s, "end": e},
        "generated_at": st.now(),
        "kpis": {
            "new_inputs": len(new_inputs),
            "items_created": sum(1 for i in db["items"] if inr(i.get("created_at"))),
            "items_updated": len(upd_ids),
            "open_items": len(open_items),
            "high_priority_open": sum(1 for i in open_items if i.get("priority") == "Alta"),
            "overdue": sum(1 for i in open_items if i.get("due_date") and i["due_date"] < st.today()),
            "meetings": sum(1 for m in db["meetings"] if inr(m.get("date"))),
            "open_risks": sum(1 for r in db["risks"] if r.get("status") != "Fechado"),
            "active_projects": sum(1 for p in db["projects"] if p.get("status") not in ("Concluído", "Cancelado")),
        },
        "inputs_by_source": by_source,
        "critical_items": [brief(i) for i in open_items if i.get("priority") == "Alta"][:25],
        "due_items": sorted([brief(i) for i in open_items if i.get("due_date") and i["due_date"] <= horizon], key=lambda x: x["due_date"]),
        "projects": [{"id": p["id"], "name": p["name"], "status": p.get("status"), "next_meeting": p.get("next_meeting"),
                      "open_actions": sum(1 for a in p.get("actions", []) if a.get("status") != "Concluída"),
                      "last_monitored": p.get("last_monitored")} for p in db["projects"] if p.get("status") not in ("Concluído", "Cancelado")],
        "risks": [{"id": r["id"], "title": r.get("title"), "mode": r.get("mode"), "probability": r.get("probability"),
                   "impact": r.get("impact"), "status": r.get("status")} for r in db["risks"] if r.get("status") != "Fechado"],
        "meetings": [{"id": m["id"], "title": m.get("title"), "date": m.get("date"), "decisions": m.get("decisions", []),
                      "items": m.get("links", {}).get("items", [])} for m in db["meetings"] if inr(m.get("date"))],
        "report_items": [brief(i) for i in open_items if i.get("report")],
        "activity": [{"ts": ev["ts"], "text": ev["text"]} for ev in events][-200:],
        "alerts": alerts(db),
    }
    if kind == "weekly":
        per_day = {}
        for ev in events:
            per_day[ev["date"]] = per_day.get(ev["date"], 0) + 1
        summary["activity_per_day"] = per_day
    return summary


def export_items_csv(db):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["ID", "Título", "Status", "Origem", "Detalhe origem", "De onde veio", "Responsável", "Data emitida", "Prazo",
                "Escopo (o que é)", "O que fazer", "Prioridade", "Urgência", "Justificativa risco", "Impactos", "Detalhe impactos",
                "Área principal", "Áreas impactadas", "Definições", "Projetos", "Riscos", "Reuniões", "Itens relacionados", "Atualizado em"])
    for i in db["items"]:
        L = i.get("links", {})
        w.writerow([i["id"], i.get("title"), i.get("status"), i.get("source"), i.get("source_detail"), i.get("origin"), i.get("owner"),
                    i.get("emitted_at") or i.get("created_at", "")[:10], i.get("due_date"), i.get("scope"), i.get("scope_action"),
                    i.get("priority"), i.get("urgency"), i.get("risk_reason"), ", ".join(i.get("impacts", [])), i.get("impact_details"),
                    i.get("area_main"), i.get("areas_impacted"), ", ".join(ai.DEFINITIONS.get(d, d) for d in i.get("definitions", [])),
                    ", ".join(L.get("projects", [])), ", ".join(L.get("risks", [])), ", ".join(L.get("meetings", [])),
                    ", ".join(L.get("items", [])), i.get("updated_at")])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def save_upload(folder, body):
    name = st.safe_name(body.get("filename"))
    data = base64.b64decode(body.get("content_b64", ""))
    if len(data) > MAX_UPLOAD:
        raise ApiError(413, "Arquivo muito grande.")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    root, ext = os.path.splitext(path)
    n = 1
    while os.path.exists(path):
        path = f"{root} ({n}){ext}"
        n += 1
    with open(path, "wb") as f:
        f.write(data)
    return path


def sync_schedules(project):
    """Registra arquivos colocados diretamente na pasta local master_schedule."""
    folder = os.path.join(st.WORKSPACE, project["folder"], "master_schedule")
    known = {s["rel"] for s in project.get("schedules", [])}
    for f in st.list_files(folder):
        if f["rel"] not in known:
            project["schedules"].append({"rel": f["rel"], "name": f["name"], "uploaded_at": f["modified"], "size": f["size"], "analysis": None})
    project["schedules"] = [s for s in project["schedules"] if os.path.exists(os.path.join(st.WORKSPACE, s["rel"]))]


def files_text(folder):
    parts = []
    for f in st.list_files(folder):
        full = os.path.join(st.WORKSPACE, f["rel"])
        if f["name"].lower().endswith((".txt", ".md", ".csv")) and f["size"] < 500_000:
            with open(full, encoding="utf-8", errors="replace") as fh:
                parts.append(f"--- {f['name']} ---\n{fh.read()}")
        elif f["name"].lower().endswith(".xlsx"):
            rows = ai._table_from_file(full) or []
            parts.append(f"--- {f['name']} ---\n" + "\n".join(" | ".join(r) for r in rows[:300]))
        else:
            parts.append(f"--- {f['name']} (arquivo binário, {f['size']} bytes) ---")
    return "\n".join(parts)


def summary_html(summary, text):
    """Versão do summary salva na pasta local SUMMARIES (abre no navegador / imprime em PDF)."""
    esc = lambda x: (str(x or "")).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    rows = lambda lst, cols: "".join("<tr>" + "".join(f"<td>{esc(r.get(c))}</td>" for c in cols) + "</tr>" for r in lst) or f"<tr><td colspan={len(cols)}>—</td></tr>"
    k = summary["kpis"]
    return f"""<!doctype html><meta charset="utf-8"><title>{esc(summary['type'])} {esc(summary['period']['start'])}</title>
<style>body{{font:14px system-ui;margin:32px;color:#1f2937}}h1{{margin:0}}h2{{border-bottom:2px solid #1e3a8a;padding-bottom:4px;margin-top:28px}}
table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #d1d5db;padding:4px 8px;text-align:left}}.k{{display:inline-block;margin:6px 12px 6px 0;padding:8px 12px;background:#eef2ff;border-radius:8px}}</style>
<h1>{esc(summary['type'])}</h1><p>Período: {esc(summary['period']['start'])} a {esc(summary['period']['end'])} · gerado em {esc(summary['generated_at'])}</p>
<h2>1. Destaques</h2><div style="white-space:pre-wrap">{esc(text)}</div>
<h2>2. Indicadores</h2>{''.join(f'<span class=k><b>{v}</b> {esc(n)}</span>' for n, v in [('novas demandas', k['new_inputs']), ('itens criados', k['items_created']), ('itens atualizados', k['items_updated']), ('em aberto', k['open_items']), ('alta prioridade', k['high_priority_open']), ('vencidos', k['overdue']), ('reuniões', k['meetings']), ('riscos abertos', k['open_risks']), ('projetos ativos', k['active_projects'])])}
<h2>3. Novas demandas por origem</h2>{''.join(f'<h3>{esc(src)}</h3><table>{rows(lst, ["id", "title", "status"])}</table>' for src, lst in summary['inputs_by_source'].items()) or '<p>—</p>'}
<h2>4. Itens críticos (alta prioridade)</h2><table><tr><th>ID</th><th>Título</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr>{rows(summary['critical_items'], ['id', 'title', 'owner', 'due_date', 'status'])}</table>
<h2>5. Prazos (vencidos e próximos 7 dias)</h2><table><tr><th>ID</th><th>Título</th><th>Responsável</th><th>Prazo</th></tr>{rows(summary['due_items'], ['id', 'title', 'owner', 'due_date'])}</table>
<h2>6. Projetos</h2><table><tr><th>ID</th><th>Projeto</th><th>Status</th><th>Ações abertas</th><th>Próx. reunião</th></tr>{rows(summary['projects'], ['id', 'name', 'status', 'open_actions', 'next_meeting'])}</table>
<h2>7. Riscos</h2><table><tr><th>ID</th><th>Risco</th><th>Modo</th><th>Prob.</th><th>Impacto</th></tr>{rows(summary['risks'], ['id', 'title', 'mode', 'probability', 'impact'])}</table>
<h2>8. Reuniões e decisões</h2>{''.join(f"<p><b>{esc(m['id'])} — {esc(m['title'])}</b> ({esc(m['date'])})<br>{'<br>'.join(esc(d) for d in m['decisions']) or 'Sem decisões registradas'}</p>" for m in summary['meetings']) or '<p>—</p>'}
<h2>9. Alertas</h2><ul>{''.join(f"<li>{esc(a['text'])}</li>" for a in summary['alerts']) or '<li>—</li>'}</ul>"""


# ------------------------------------------------------------------ HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "GovPlatform/1.0"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s\n" % (fmt % args))

    def _send(self, status, body, ctype="application/json; charset=utf-8", extra=None):
        if not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD * 1.4:
            raise ApiError(413, "Requisição muito grande.")
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        url = urlparse(self.path)
        try:
            if url.path.startswith("/api/"):
                return self._api(method, url.path[5:].strip("/").split("/"), parse_qs(url.query))
            if method != "GET":
                raise ApiError(405, "Método não permitido")
            if url.path.startswith("/files/"):
                return self._serve_file(os.path.join(st.WORKSPACE, unquote(url.path[7:])), st.WORKSPACE)
            rel = "index.html" if url.path in ("/", "") else unquote(url.path.lstrip("/"))
            return self._serve_file(os.path.join(STATIC, rel), STATIC)
        except ApiError as e:
            self._send(e.status, {"error": str(e)})
        except (ValueError, KeyError) as e:
            self._send(400, {"error": f"Requisição inválida: {e}"})
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            self._send(500, {"error": f"Erro interno: {e}"})

    def _serve_file(self, path, root):
        full = os.path.realpath(path)
        if not full.startswith(os.path.realpath(root) + os.sep) or not os.path.isfile(full):
            raise ApiError(404, "Não encontrado")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)

    def _api(self, method, parts, q):
        with st._lock:
            db = st.load()
            result = self._route(db, method, parts, q)
            if method != "GET" or parts[0] in ("projects",):
                st.save(db)
        if isinstance(result, tuple):
            self._send(200, result[0], result[1], result[2] if len(result) > 2 else None)
        else:
            self._send(200, result)

    def _route(self, db, method, parts, q):
        head = parts[0]
        rid = parts[1] if len(parts) > 1 else None
        action = parts[2] if len(parts) > 2 else None

        if head == "state" and method == "GET":
            for p in db["projects"]:
                sync_schedules(p)
            return {"db": {k: db[k] for k in st.COLLECTIONS + ["settings"]}, "events": db["events"][-60:],
                    "alerts": alerts(db), "ai": ai.status(), "workspace": st.WORKSPACE, "definitions": ai.DEFINITIONS,
                    "impact_types": ai.IMPACT_TYPES, "summaries": db["summaries"][-30:], "today": st.today()}

        if head == "settings" and method == "PATCH":
            db["settings"].update(self._body())
            return db["settings"]

        if head == "export" and rid == "items.csv":
            return (export_items_csv(db), "text/csv; charset=utf-8",
                    {"Content-Disposition": f'attachment; filename="lista_governanca_{st.today()}.csv"'})

        if head == "summary" and method == "POST":
            body = self._body()
            kind = body.get("type", "daily")
            summary = build_summary(db, kind, body.get("date") or st.today())
            text = ai.narrative(summary) if body.get("narrative", True) else ""
            folder = os.path.join(st.WORKSPACE, "SUMMARIES")
            os.makedirs(folder, exist_ok=True)
            fname = f"{'semanal' if kind == 'weekly' else 'diario'}_{summary['period']['start']}.html"
            with open(os.path.join(folder, fname), "w", encoding="utf-8") as f:
                f.write(summary_html(summary, text))
            db["summaries"] = [x for x in db["summaries"] if x["file"] != f"SUMMARIES/{fname}"]
            db["summaries"].append({"type": kind, "period": summary["period"], "file": f"SUMMARIES/{fname}", "generated_at": st.now()})
            return {"summary": summary, "narrative": text, "file": f"SUMMARIES/{fname}"}

        if head not in st.COLLECTIONS or head == "actions":
            raise ApiError(404, "Rota desconhecida")
        col = head

        if method == "POST" and rid is None:
            data = self._body()
            data.pop("id", None)
            rec = create_record(db, col, data)
            if col == "inputs":
                rec["status"] = "Novo"
                if rec.get("meeting_id"):
                    st.link(db, "inputs", rec["id"], "meetings", rec["meeting_id"])
            if col == "meetings" and st.find(db, "projects", rec.get("project_id") or ""):
                proj = st.find(db, "projects", rec["project_id"])
                st.link(db, "meetings", rec["id"], "projects", proj["id"])
                cad = int(db["settings"].get("project_meeting_cadence_days", 15))
                proj["next_meeting"] = (date.fromisoformat(rec["date"][:10]) + timedelta(days=cad)).isoformat()
                proj["last_monitored"] = st.today()
            return rec

        rec = st.find(db, col, rid) if rid else None
        if rid and not rec:
            raise ApiError(404, f"{rid} não encontrado")

        if method == "GET" and rec and not action:
            return rec
        if method == "PATCH" and rec and not action:
            data = self._body()
            for k in ("id", "created_at", "links", "folder"):
                data.pop(k, None)
            note = data.pop("_note", None)
            rec.update(data)
            if note:
                rec.setdefault("history", []).append({"date": st.now(), "text": note})
            if col == "projects":
                rec["last_monitored"] = st.today()
            touch(rec)
            st.log(db, f"{col}.updated", rid, f"{rid} atualizado" + (f": {note}" if note else ""))
            return rec
        if method == "DELETE" and rec:
            db[col] = [r for r in db[col] if r["id"] != rid]
            for other in st.COLLECTIONS:
                for r in db[other]:
                    lst = r.get("links", {}).get(col)
                    if lst and rid in lst:
                        lst.remove(rid)
            st.log(db, f"{col}.deleted", rid, f"{rid} removido")
            return {"ok": True}

        # ---- ações específicas
        if method == "POST" and action == "link":
            body = self._body()
            st.link(db, col, rid, body["collection"], body["id"])
            st.log(db, "link", rid, f"{rid} vinculado a {body['id']}")
            return rec
        if col == "inputs" and action == "suggest":
            rec["ai_suggestion"] = ai.assess_input(db, rec)
            rec["status"] = "Em avaliação"
            touch(rec)
            return rec
        if col == "inputs" and action == "commit":
            return {"input": rec, "created": commit_input(db, rec, self._body())}
        if col == "projects" and action == "upload":
            body = self._body()
            sub = "master_schedule" if body.get("kind", "schedule") == "schedule" else "documentos"
            path = save_upload(os.path.join(st.WORKSPACE, rec["folder"], sub), body)
            sync_schedules(rec)
            rec["last_monitored"] = st.today()
            touch(rec)
            st.log(db, "projects.upload", rid, f"Upload em {rid}: {os.path.basename(path)}")
            return rec
        if col == "projects" and action == "analyze":
            body = self._body()
            sched = next((s for s in rec["schedules"] if s["rel"] == body.get("rel")), None)
            if not sched:
                raise ApiError(404, "Cronograma não encontrado")
            sched["analysis"] = ai.analyze_schedule(db, rec, os.path.join(st.WORKSPACE, sched["rel"]), st.today())
            sched["analyzed_at"] = st.now()
            touch(rec)
            st.log(db, "projects.analyzed", rid, f"Master schedule de {rid} analisada: {sched['name']}")
            return rec
        if col == "projects" and action == "actions":
            body = self._body()
            if body.get("id"):
                act = next((a for a in rec["actions"] if a["id"] == body["id"]), None)
                if not act:
                    raise ApiError(404, "Ação não encontrada")
                act.update({k: v for k, v in body.items() if k != "id"})
            else:
                body["id"] = st.next_id(db, "actions")
                body.setdefault("status", "Aberta")
                body["created_at"] = st.now()
                rec["actions"].append(body)
            rec["last_monitored"] = st.today()
            touch(rec)
            st.log(db, "projects.action", rid, f"Portfólio {rid}: ação {body.get('id')} {body.get('status', '')}")
            return rec
        if col in ("risks", "meetings", "items") and action == "upload":
            path = save_upload(st.folder_for(col, rid), self._body())
            touch(rec)
            st.log(db, f"{col}.upload", rid, f"Documento anexado a {rid}: {os.path.basename(path)}")
            return rec
        if col in ("risks", "meetings", "items", "projects") and action == "files":
            return st.list_files(st.folder_for(col, rid, create=False) if col != "projects" else os.path.join(st.WORKSPACE, rec["folder"]))
        if col == "risks" and action == "analyze":
            rec["analysis"] = ai.analyze_risk(db, rec, files_text(st.folder_for("risks", rid)))
            touch(rec)
            st.log(db, "risks.analyzed", rid, f"Risco {rid} analisado")
            return rec
        if col == "meetings" and action == "extract":
            out = ai.extract_meeting(db, rec)
            rec["extraction"] = out
            if out.get("decisions"):
                rec["decisions"] = out["decisions"]
            touch(rec)
            return rec
        raise ApiError(404, "Rota desconhecida")


def main():
    port = int(os.environ.get("GOV_PORT", "8765"))
    host = os.environ.get("GOV_HOST", "127.0.0.1")
    st.load()
    print(f"Plataforma de Governança em http://{host}:{port}")
    print(f"Pasta local de trabalho: {st.WORKSPACE}")
    print(f"IA: {ai.status()}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
