#!/usr/bin/env python3
"""Health check of the vault itself. No LLM, no dependencies.

Five measurements: fixed load, long index rows, overdue reminders, stale Active projects,
long `## Status` sections. Reads the reminder table and the work-state index in the same
format Relay uses.

  vault-health.py              print the report
  vault-health.py --quiet      print only the measurements that are red
  vault-health.py --selftest   run the built-in checks

Exit code is 1 when something is red.
"""

import datetime as dt
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SYSTEM = os.path.dirname(HERE)                   # System/, the target of .claude
VAULT = os.path.dirname(SYSTEM)
WORK_STATE = os.path.join(SYSTEM, "rules", "core", "work-state.md")
REMINDERS = os.path.join(SYSTEM, "reminders.md")

LOAD_LIMIT_KB = 20     # CLAUDE.md + rules/core + rules/vault, loaded in every session
ROW_LIMIT = 160        # characters per index row
STATUS_LIMIT = 2000    # characters per ## Status section
OVERDUE_LIMIT = 5      # more overdue reminders than this means nobody triages
STALE_DAYS = 30        # an Active project without activity should become Quiet

CELL_SPLIT = re.compile(r"(?<!\\)\|")
WIKILINK = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STATUS_RE = re.compile(r"^## Status$(.*?)(?=^## |\Z)", re.S | re.M)


def split_row(line):
    cells = [c.strip().replace("\\|", "|") for c in CELL_SPLIT.split(line.strip())]
    return cells[1:-1] if len(cells) >= 2 and cells[0] == "" and cells[-1] == "" else cells


def table_rows(path, date_col):
    """Table rows of a markdown file whose cell `date_col` is an ISO date. Missing file: none."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        rows = [split_row(l) for l in fh if l.startswith("|")]
    return [c for c in rows if len(c) > date_col and DATE_RE.match(c[date_col])]


def measure(name, ok, value, details=()):
    return {"name": name, "ok": ok, "value": value, "details": list(details)}


def fixed_load():
    paths = [os.path.join(VAULT, "CLAUDE.md")]
    for sub in ("core", "vault"):
        d = os.path.join(SYSTEM, "rules", sub)
        if os.path.isdir(d):
            paths += [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(".md")]
    sizes = sorted(((os.path.basename(p), os.path.getsize(p)) for p in paths if os.path.exists(p)), key=lambda t: -t[1])
    kb = sum(s for _, s in sizes) / 1024
    return measure("Fixed load", kb <= LOAD_LIMIT_KB, f"{kb:.0f} KB of {LOAD_LIMIT_KB} KB",
                   [f"{n}: {s / 1024:.0f} KB" for n, s in sizes[:3]])


def long_rows(path=WORK_STATE):
    over = sorted(((m.group(1), len(c[-1])) for c in table_rows(path, 2)
                   if (m := WIKILINK.search(c[0])) and len(c[-1]) > ROW_LIMIT), key=lambda t: -t[1])
    return measure("Long index rows", not over, f"{len(over)} over {ROW_LIMIT} characters",
                   [f"{n}: {c} characters, shorten `index` on the card" for n, c in over[:5]])


def overdue_reminders(today, path=REMINDERS):
    late = sorted((dt.date.fromisoformat(c[0]), WIKILINK.sub(r"\1", c[1]).replace("**", "")[:80])
                  for c in table_rows(path, 0) if dt.date.fromisoformat(c[0]) < today)
    return measure("Overdue reminders", len(late) <= OVERDUE_LIMIT, f"{len(late)} (limit {OVERDUE_LIMIT})",
                   [f"{(today - d).days}d: {t}" for d, t in late[:5]])


def stale_rows(today, path=WORK_STATE):
    stale = [(m.group(1), (today - dt.date.fromisoformat(c[2])).days) for c in table_rows(path, 2)
             if (m := WIKILINK.search(c[0])) and c[1] == "Active"
             and (today - dt.date.fromisoformat(c[2])).days > STALE_DAYS]
    return measure("Stale Active projects", not stale, f"{len(stale)} older than {STALE_DAYS} days",
                   [f"{n}: {d}d quiet, set status: Quiet" for n, d in stale[:5]])


def long_status_sections():
    over = []
    for root, _, files in os.walk(os.path.join(VAULT, "Contexts")):
        for f in files:
            if f.endswith(".md"):
                with open(os.path.join(root, f), encoding="utf-8", errors="replace") as fh:
                    m = STATUS_RE.search(fh.read())
                if m and len(m.group(1).strip()) > STATUS_LIMIT:
                    over.append((f[:-3], len(m.group(1).strip())))
    over.sort(key=lambda t: -t[1])
    return measure("Long Status sections", not over, f"{len(over)} over {STATUS_LIMIT} characters",
                   [f"{n}: {c} characters, history to Log.md" for n, c in over[:5]])


def collect(today):
    return [fixed_load(), long_rows(), overdue_reminders(today), stale_rows(today), long_status_sections()]


def render(results, quiet=False):
    shown = [m for m in results if not m["ok"]] if quiet else results
    if not shown:
        return "Vault health: everything within limits."
    out = [f"**Vault health {dt.date.today().isoformat()}**", ""]
    for m in shown:
        out.append(f"{'🔴' if not m['ok'] else '✅'} {m['name']}: {m['value']}")
        out += [f"    - {d}" for d in m["details"]]
    return "\n".join(out)


def selftest():
    import tempfile
    today = dt.date(2026, 9, 14)
    with tempfile.TemporaryDirectory() as d:
        rem = os.path.join(d, "reminders.md")
        with open(rem, "w", encoding="utf-8") as fh:
            fh.write("| Date | Reminder | Source | Repeat |\n|---|---|---|---|\n"
                     "| 2026-09-13 | **Old.** | x |  |\n| 2026-09-20 | **New.** | x |  |\n")
        assert overdue_reminders(today, rem)["details"] == ["1d: Old."]
        ws = os.path.join(d, "work-state.md")
        with open(ws, "w", encoding="utf-8") as fh:
            fh.write("| Project | State | Last | Summary |\n|---|---|---|---|\n"
                     f"| [[Short]] | Active | 2026-09-14 | {'k' * 40} |\n"
                     f"| [[Long]] | Active | 2026-08-01 | {'l' * (ROW_LIMIT + 1)} |\n")
        assert long_rows(ws)["details"] == [f"Long: {ROW_LIMIT + 1} characters, shorten `index` on the card"]
        assert stale_rows(today, ws)["details"] == ["Long: 44d quiet, set status: Quiet"]
        assert overdue_reminders(today, os.path.join(d, "missing.md"))["ok"]
    body = "# X\n\n## Status\n" + ("a" * 50) + "\n\n## Other\n" + ("b" * 5000) + "\n"
    assert 50 <= len(STATUS_RE.search(body).group(1)) <= 60
    assert render([measure("T", True, "ok")], quiet=True) == "Vault health: everything within limits."
    print("selftest ok")


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if "--selftest" in argv:
        selftest()
        return 0
    results = collect(dt.date.today())
    print(render(results, quiet="--quiet" in argv))
    return 1 if any(not m["ok"] for m in results) else 0


if __name__ == "__main__":
    sys.exit(main())
