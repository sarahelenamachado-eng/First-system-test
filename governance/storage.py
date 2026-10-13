"""Persistência local: banco JSON + pastas de trabalho no computador do usuário.

Tudo fica dentro de WORKSPACE (padrão: ./workspace, ou a variável GOV_WORKSPACE).
  workspace/
    db.json                                   -> base de dados de governança
    PROJECTS/PROJ001 INFOS AND GENERAL OVERVIEW/master_schedule/...
    RISKS/RISK001 INFOS AND GENERAL OVERVIEW/...
    MEETINGS/MEET001/...
    SUMMARIES/...
"""
import json
import os
import re
import threading
from datetime import datetime, date

WORKSPACE = os.path.abspath(os.environ.get("GOV_WORKSPACE", os.path.join(os.path.dirname(__file__), "..", "workspace")))
DB_PATH = os.path.join(WORKSPACE, "db.json")

PREFIX = {"inputs": "INP", "items": "GOV", "projects": "PROJ", "risks": "RISK", "meetings": "MEET", "actions": "ACT"}
COLLECTIONS = list(PREFIX.keys())

_lock = threading.RLock()


def now():
    return datetime.now().isoformat(timespec="seconds")


def today():
    return date.today().isoformat()


def _empty_db():
    db = {c: [] for c in COLLECTIONS}
    db.update({
        "seq": {c: 0 for c in COLLECTIONS},
        "events": [],
        "feedback": [],
        "summaries": [],
        "settings": {
            "alert_days_without_update": 15,
            "project_meeting_cadence_days": 15,
            "links_for_project_alert": 3,
            "areas": ["Operação", "Manutenção", "RH", "Financeiro", "Jurídico", "Compras", "SSMA", "TI", "Comercial", "Engenharia"],
        },
    })
    return db


def load():
    with _lock:
        if not os.path.exists(DB_PATH):
            os.makedirs(WORKSPACE, exist_ok=True)
            save(_empty_db())
        with open(DB_PATH, encoding="utf-8") as f:
            db = json.load(f)
        base = _empty_db()
        for k, v in base.items():
            db.setdefault(k, v)
        for c in COLLECTIONS:
            db["seq"].setdefault(c, 0)
        return db


def save(db):
    with _lock:
        os.makedirs(WORKSPACE, exist_ok=True)
        tmp = DB_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DB_PATH)


def next_id(db, collection):
    db["seq"][collection] += 1
    return f"{PREFIX[collection]}{db['seq'][collection]:03d}"


def find(db, collection, rid):
    for r in db[collection]:
        if r["id"] == rid:
            return r
    return None


def log(db, kind, ref, text):
    db["events"].append({"ts": now(), "date": today(), "type": kind, "ref": ref, "text": text})


def link(db, a_col, a_id, b_col, b_id):
    """Cria um vínculo bidirecional entre dois registros (ex.: item <-> projeto)."""
    a, b = find(db, a_col, a_id), find(db, b_col, b_id)
    if not a or not b:
        return
    for rec, col, rid in ((a, b_col, b_id), (b, a_col, a_id)):
        links = rec.setdefault("links", {})
        lst = links.setdefault(col, [])
        if rid not in lst:
            lst.append(rid)


def safe_name(name):
    name = re.sub(r"[^\w\-. ()]+", "_", os.path.basename(name or "arquivo"), flags=re.UNICODE).strip()
    return name or "arquivo"


def folder_for(collection, rid, create=True):
    sub = {
        "projects": ("PROJECTS", f"{rid} INFOS AND GENERAL OVERVIEW"),
        "risks": ("RISKS", f"{rid} INFOS AND GENERAL OVERVIEW"),
        "meetings": ("MEETINGS", rid),
        "items": ("ITEMS", rid),
    }[collection]
    path = os.path.join(WORKSPACE, *sub)
    if create:
        os.makedirs(path, exist_ok=True)
        if collection == "projects":
            os.makedirs(os.path.join(path, "master_schedule"), exist_ok=True)
            os.makedirs(os.path.join(path, "documentos"), exist_ok=True)
    return path


def list_files(path):
    out = []
    if not os.path.isdir(path):
        return out
    for root, _, files in os.walk(path):
        for fn in sorted(files):
            full = os.path.join(root, fn)
            st = os.stat(full)
            out.append({
                "name": fn,
                "rel": os.path.relpath(full, WORKSPACE).replace(os.sep, "/"),
                "folder": os.path.relpath(root, path).replace(os.sep, "/"),
                "size": st.st_size,
                "modified": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
            })
    return out
