#!/usr/bin/env python3
"""One JSON snapshot of everything the control room shows.

Reads the vault (work-state.md, each project's ## Open, reminders.md) and `claude agents --json`.
Read-only. The app calls this and renders the result, so the parsing lives in one place. The app
passes the vault's mapped paths (VAULT_WORK_STATE, VAULT_REMINDERS, VAULT_NOTES; "" when missing);
run by hand, the known layouts are the fallback.
"""
import datetime as dt
import glob
import hashlib
import json
import os
import re
import subprocess
import sys

VAULT = os.environ.get("VAULT") or sys.exit("snapshot: VAULT not set")
# the brain lives in System/ in the new layout, in Resources/Meta/Claude/ in the old one
META = next((os.path.join(VAULT, d) for d in ("System", "Resources/Meta/Claude") if os.path.isdir(os.path.join(VAULT, d))), os.path.join(VAULT, "System"))
WORK_STATE = os.environ.get("VAULT_WORK_STATE", os.path.join(META, "rules/core/work-state.md"))
REMINDERS = os.environ.get("VAULT_REMINDERS", os.path.join(META, "reminders.md"))
NOTES = os.environ.get("VAULT_NOTES", os.path.join(VAULT, "Contexts"))
NOTES = NOTES if os.path.isdir(NOTES) else VAULT
# a context is a heading in work-state named after a folder of the notes (Contexts/Antenna…), or a known one
CONTEXTS = {"Antenna", "Meersman", "Personal"} | {d for d in os.listdir(NOTES) if os.path.isdir(os.path.join(NOTES, d)) and not d.startswith(".")}
TODAY = dt.date.fromisoformat(os.environ["TODAY"]) if os.environ.get("TODAY") else dt.date.today()


def projects():
    out, context = [], None
    for line in open(WORK_STATE, encoding="utf-8"):
        h = re.match(r"^#{2,3} (.+?)\s*$", line)
        if h:
            context = h.group(1) if h.group(1) in CONTEXTS else None
        # a row names its project as a [[link]] or as plain text: | [[Name]] | Active | 2026-09-29 | … |
        m = re.match(r"^\| (?:\[\[([^\]]+)\]\][^|]*|([^|\[]+?)) \| (\w+) \| ([\d-]+) \| (.*) \|$", line.rstrip("\n"))
        if m and context:
            link, plain, state, last, summary = m.groups()
            name = link or plain.strip()
            out.append({"name": name, "context": context, "state": state, "last": last,
                        "summary": summary, **note_state(name)})
    return out


def note_state(name):
    hits = [p for n in dict.fromkeys([name, re.sub(r"\s*\(.*\)$", "", name)])  # "Brutsaert (ERP op maat)": Brutsaert.md too
            for p in glob.glob(os.path.join(glob.escape(NOTES), "**", f"{glob.escape(n)}.md"), recursive=True)
            if not any(d in "/" + os.path.relpath(p, NOTES) for d in ("/Documents/", "/Gesprekken/", "/_archive/"))]
    if not hits:
        return {"open": None, "open_items": [], "stand": None, "aliases": []}
    s = open(hits[0], encoding="utf-8").read()
    op = re.search(r"^## Open\n(.*?)(?=^## |\Z)", s, re.S | re.M)
    items = [unlink(i) for i in re.findall(r"^\s*- \[ \] (.+)$", op.group(1), re.M)] if op else []
    st = re.search(r"^## Stand van zaken\n(.*?)(?=^## |\Z)", s, re.S | re.M)
    stand = unlink(re.sub(r"^\*Stand van zaken[^\n]*\n", "", st.group(1).strip())).strip() if st else None
    fm = re.match(r"^---\n(.*?)\n---", s, re.S)
    aliases = re.findall(r"^\s*-\s*\"?([^\"\n]+?)\"?\s*$", re.search(r"^aliases:\n((?:\s+-.*\n?)*)", fm.group(1), re.M).group(1), re.M) \
        if fm and re.search(r"^aliases:\n\s+-", fm.group(1), re.M) else []
    return {"open": len(items) if op else None, "open_items": items, "stand": stand, "aliases": aliases}


def reminders():
    out = []
    if not REMINDERS or not os.path.isfile(REMINDERS):
        return out
    # | date | reminder | source | repeat |, the repeat column optional
    for line in open(REMINDERS, encoding="utf-8"):
        m = re.match(r"^\| (\d{4}-\d\d-\d\d) \| (.*?) \| (.*?)(?: \| (.*?))? \|$", line.rstrip("\n"))
        if not m:
            continue
        date, text, _source, repeat = m.groups()
        proj = re.search(r"\[\[([^\]|]+)", text)
        title = re.search(r"\*\*(.+?)\*\*", text)
        days = (dt.date.fromisoformat(date) - TODAY).days
        out.append({"id": hashlib.sha1(f"{date}|{text}".encode("utf-8")).hexdigest()[:8],  # same id as reminder-digest.py
                    "date": date, "days": days, "project": proj.group(1) if proj else None,
                    "title": unlink(title.group(1) if title else first_sentence(text)).rstrip("."), "text": text,
                    "repeat": (repeat or "").strip() or None})
    return sorted(out, key=lambda r: r["date"])


def unlink(text):
    return re.sub(r"\[\[([^\]|]+)(\|[^\]]+)?\]\]", r"\1", text)


def first_sentence(text):
    plain = unlink(text)
    return re.split(r"(?<=[.:?!])\s", plain, maxsplit=1)[0][:120]


CACHE = os.path.expanduser("~/Library/Application Support/be.laurentmeersman.vault/topics.json")
# Claude Code keeps a project's transcripts under its path with every non-alphanumeric character as "-"
TRANSCRIPTS = os.path.expanduser("~/.claude/projects/" + re.sub(r"[^A-Za-z0-9]", "-", VAULT))


# user-role messages the harness injects, not typed by the user
INJECTED = ("<", "Another Claude session", "Base directory for this skill", "[Image", "Stop hook feedback",
            "[Request interrupted", "The user sent a new message", "This session is being continued")


def matcher(projs):
    terms = [(t, p["name"]) for p in projs for t in [p["name"], *p.get("aliases", [])] if len(t) >= 3]
    rx = [(re.compile(r"(?<![\w])" + re.escape(t) + r"(?![\w])", re.I), n) for t, n in terms]
    return lambda text: {n for r, n in rx if r.search(text)}


def topics(items, projs):
    """Which project each open session is about, from the tail of its transcript.

    Transcripts only grow at the end, so per session we keep an offset and the last 40 project hits
    (user messages naming a project, project notes Claude read or edited). Recent hits decide, so a
    session that moved on to another project follows. Parsing 200 MB once, then only new lines.
    """
    try:
        cache = json.load(open(CACHE))
    except (OSError, ValueError):
        cache = {}
    find, names = matcher(projs), {p["name"] for p in projs}
    for it in items:
        sid = it.get("sessionId")
        f = os.path.join(TRANSCRIPTS, f"{sid}.jsonl")
        if not sid or not os.path.exists(f):
            continue
        c = cache.get(sid, {"offset": 0, "hits": [], "last": "", "last_at": ""})
        size = os.path.getsize(f)
        if size < c["offset"]:
            c = {"offset": 0, "hits": [], "last": "", "last_at": ""}
        with open(f, "rb") as fh:
            fh.seek(c["offset"])
            for raw in fh:
                if b'"type":"user"' not in raw and b'"tool_use"' not in raw:
                    continue
                try:
                    e = json.loads(raw)
                except ValueError:
                    continue
                content = (e.get("message") or {}).get("content")
                if e.get("type") == "user" and not e.get("isSidechain"):
                    texts = [content] if isinstance(content, str) else [x.get("text", "") for x in content or [] if isinstance(x, dict) and x.get("type") == "text"]
                    for t in texts:
                        if t and not t.startswith(INJECTED):
                            c["last"] = t[:80]
                            c["last_at"] = e.get("timestamp", "")
                            c["hits"] += sorted(find(t))
                elif e.get("type") == "assistant" and isinstance(content, list):
                    for x in content:
                        path = (x.get("input") or {}).get("file_path", "") if x.get("type") == "tool_use" else ""
                        m = re.search(r"/Contexts/[^/]+/(?:Portfolio|Projects|Documents)/([^/]+?)(?:\.md)?(?:/|$)", path)
                        if m and m.group(1) in names:
                            c["hits"] += [m.group(1)] * 2
            c["offset"] = fh.tell()
        c["hits"] = c["hits"][-40:]
        cache[sid] = c
        name = it.get("name") or ""
        named = [] if re.match(r"^obsidian-context-management-\w+$", name) else sorted(find(name)) * 3
        recent = c["hits"][-20:] + named
        it["project"] = max(set(recent), key=lambda n: (recent.count(n), len(recent) - recent[::-1].index(n))) if recent else None
        it["last_user"] = c["last"]
        # last message the user typed (ISO timestamp): the real "working on it now", unlike the file mtime
        it["last_at"] = c.get("last_at", "")
    live = {it.get("sessionId") for it in items}
    cache = {k: v for k, v in cache.items() if k in live}
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE + ".tmp", "w") as fh:
        json.dump(cache, fh)
    os.replace(CACHE + ".tmp", CACHE)
    return items


def sessions():
    try:
        raw = subprocess.run(["claude", "agents", "--json"], capture_output=True, text=True,
                             timeout=15, stdin=subprocess.DEVNULL).stdout
        items = json.loads(raw)
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        return {"error": str(e), "items": []}
    return {"error": None, "items": items}


if __name__ == "__main__":
    projs = projects()
    ses = sessions()
    ses["items"] = topics(ses["items"], projs)
    json.dump({"today": TODAY.isoformat(), "projects": projs, "reminders": reminders(),
               "sessions": ses}, sys.stdout, ensure_ascii=False, indent=1)
