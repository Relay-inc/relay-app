#!/usr/bin/env python3
"""One JSON snapshot of everything the control room shows.

Reads the vault (work-state.md, each project's ## Open, reminders.md) and `claude agents --json`.
Read-only. The app calls this and renders the result, so the parsing lives in one place.
"""
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys

VAULT = os.environ.get("VAULT", os.path.expanduser("~/Documents/LaurentMe/Obsidian - Context-management"))
META = os.path.join(VAULT, "Resources/Meta/Claude")
TODAY = dt.date.fromisoformat(os.environ["TODAY"]) if os.environ.get("TODAY") else dt.date.today()


def projects():
    out, context = [], None
    for line in open(os.path.join(META, "rules/core/work-state.md"), encoding="utf-8"):
        h = re.match(r"^### (Antenna|Meersman|Personal)", line)
        if h:
            context = h.group(1)
        m = re.match(r"^\| \[\[([^\]]+)\]\][^|]* \| (\w+) \| ([\d-]+) \| (.*) \|$", line.rstrip("\n"))
        if m and context:
            name, state, last, summary = m.groups()
            out.append({"name": name, "context": context, "state": state, "last": last,
                        "summary": summary, **note_state(name)})
    return out


def note_state(name):
    hits = [p for p in glob.glob(os.path.join(VAULT, "Contexts/**", f"{name}.md"), recursive=True)
            if "/Documents/" not in os.path.relpath(p, VAULT)]
    if not hits:
        return {"open": None, "open_items": [], "stand": None}
    s = open(hits[0], encoding="utf-8").read()
    op = re.search(r"^## Open\n(.*?)(?=^## |\Z)", s, re.S | re.M)
    items = [unlink(i) for i in re.findall(r"^\s*- \[ \] (.+)$", op.group(1), re.M)] if op else []
    st = re.search(r"^## Stand van zaken\n(.*?)(?=^## |\Z)", s, re.S | re.M)
    stand = unlink(re.sub(r"^\*Stand van zaken[^\n]*\n", "", st.group(1).strip())).strip() if st else None
    return {"open": len(items) if op else None, "open_items": items, "stand": stand}


def reminders():
    out = []
    for line in open(os.path.join(META, "reminders.md"), encoding="utf-8"):
        m = re.match(r"^\| (\d{4}-\d\d-\d\d) \| (.*?) \| (.*?) \| (.*?) \|$", line.rstrip("\n"))
        if not m:
            continue
        date, text, _source, repeat = m.groups()
        proj = re.search(r"\[\[([^\]|]+)", text)
        title = re.search(r"\*\*(.+?)\*\*", text)
        days = (dt.date.fromisoformat(date) - TODAY).days
        out.append({"date": date, "days": days, "project": proj.group(1) if proj else None,
                    "title": unlink(title.group(1) if title else first_sentence(text)).rstrip("."),
                    "repeat": repeat.strip() or None})
    return sorted(out, key=lambda r: r["date"])


def unlink(text):
    return re.sub(r"\[\[([^\]|]+)(\|[^\]]+)?\]\]", r"\1", text)


def first_sentence(text):
    plain = unlink(text)
    return re.split(r"(?<=[.:?!])\s", plain, maxsplit=1)[0][:120]


def sessions():
    try:
        raw = subprocess.run(["claude", "agents", "--json"], capture_output=True, text=True,
                             timeout=15, stdin=subprocess.DEVNULL).stdout
        items = json.loads(raw)
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        return {"error": str(e), "items": []}
    return {"error": None, "items": items}


if __name__ == "__main__":
    json.dump({"today": TODAY.isoformat(), "projects": projects(), "reminders": reminders(),
               "sessions": sessions()}, sys.stdout, ensure_ascii=False, indent=1)
