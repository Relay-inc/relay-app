#!/usr/bin/env python3
"""Leak check for the starter vault in src-tauri/resources/default-vault, and the team starter a workspace
starts as (that vault without TEAM_DROP, with src-tauri/resources/team-vault copied over it).

Fails when a file in it holds something that belongs to a real person or a real vault:
absolute home paths, e-mail addresses, IP addresses, and (with --vault) any project, person
or context name and repo from a real vault. That real vault is only read, never copied, so
no real name ever lands in this repo.

  scripts/check-default-vault.py                    generic patterns only (CI)
  scripts/check-default-vault.py --vault ~/MyVault  plus every name from that vault
  scripts/check-default-vault.py --vault ~/MyVault --show   also print the matched name (local only)
  scripts/check-default-vault.py --selftest

Also checks the template still works: the index exists, the hooks are executable, and
build-index.py and vault-health.py pass their selftests. The team starter gets the same checks, plus: team.md is
there, the personal parts are not, and nothing outside its setup skill still points at them.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src-tauri", "resources", "default-vault")
TEAM = os.path.join(os.path.dirname(ROOT), "team-vault")
# as TEAM_DROP in src-tauri/src/vault.rs
TEAM_DROP = ["System/rules/core/user-profile.md", "System/rules/personal", "Contexts/Personal"]
PERSONAL = re.compile(r"user-profile\.md|Contexts/Personal|rules/personal|\"Personal\"")
# Generic words that also occur as a context, folder or repo name in a real vault
ALLOWED_NAMES = {"work", "personal", "documents", "communication", "attachments", "people", "projects", "archive",
                 "vault", "test", "tests", "noted", "github", "notes", "docs", "sales"}
GENERIC = [
    ("home path", re.compile(r"/Users/[A-Za-z]|/home/[a-z]|~/(?:Documents|Desktop|Downloads)/")),
    ("e-mail", re.compile(r"[\w.+-]+@(?!example\.(?:com|org)\b)[\w-]+\.[\w.]+")),
    ("IP address", re.compile(r"\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b")),
]


def files(root):
    for d, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f)
            try:
                yield p, open(p, encoding="utf-8").read()
            except UnicodeDecodeError:
                continue


def names_from_vault(vault):
    """Project, person and context names, repo names and e-mail domains of a real vault."""
    names = set()
    ctx_root = os.path.join(vault, "Contexts")
    for ctx in os.listdir(ctx_root) if os.path.isdir(ctx_root) else []:
        names.add(ctx)
        for sub in ("Projects", "People"):
            d = os.path.join(ctx_root, ctx, sub)
            if os.path.isdir(d):
                stems = [os.path.splitext(n)[0] for n in os.listdir(d) if not n.startswith(".")]
                names.update(stems)
                if sub == "People":
                    names.update(s.split()[0] for s in stems if s.split())  # first names alone
    for _, text in files(ctx_root):
        names.update(m.rstrip("/").rsplit("/", 1)[-1] for m in re.findall(r"^\s+-\s*(~?/[^\s\"']+)", text, re.M))
        names.update(re.findall(r"@([\w-]+)\.[a-z]{2,}", text))
    return {n for n in names if len(n) >= 4 and n.lower() not in ALLOWED_NAMES}


def scan(root, names, show=False):
    words = re.compile(r"\b(" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)) + r")\b", re.I) if names else None
    hits = []
    for p, text in files(root):
        rel = os.path.relpath(p, root)
        for i, line in enumerate(text.split("\n"), 1):
            for label, rx in GENERIC:
                if rx.search(line):
                    hits.append(f"{rel}:{i}: {label}")
            if words and (m := words.search(line)):
                hits.append(f"{rel}:{i}: name from the real vault (" + (m.group(1) if show else f"{len(m.group(1))} characters") + ")")
    return hits


def structure(root):
    problems = []
    for need in ("CLAUDE.md", "System/rules/core/work-state.md", "System/reminders.md", "System/settings.json", ".relay/config.json"):
        if not os.path.isfile(os.path.join(root, need)):
            problems.append(f"missing {need}")
    hooks = os.path.join(root, "System", "hooks")
    for h in os.listdir(hooks) if os.path.isdir(hooks) else []:
        if not os.access(os.path.join(hooks, h), os.X_OK):
            problems.append(f"System/hooks/{h} is not executable")
    for script in ("build-index.py", "vault-health.py"):
        r = subprocess.run([sys.executable, os.path.join(root, "System", "scripts", script), "--selftest"], capture_output=True, text=True)
        if r.returncode != 0:
            problems.append(f"{script} --selftest failed: {(r.stderr or r.stdout).strip().splitlines()[-1:]}")
    r = subprocess.run([sys.executable, os.path.join(root, "System", "scripts", "build-index.py"), "--check"], capture_output=True, text=True)
    if r.returncode != 0:
        problems.append("work-state.md is out of date, run System/scripts/build-index.py in the template")
    return problems


def team_starter(dest):
    """The team starter as vault.rs create_team makes it, in `dest`."""
    shutil.copytree(ROOT, dest, symlinks=True)
    for d in TEAM_DROP:
        p = os.path.join(dest, d)
        shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    shutil.copytree(TEAM, dest, symlinks=True, dirs_exist_ok=True)


def team_problems(root):
    problems = [f"team starter: {p}" for p in structure(root)]
    if not os.path.isfile(os.path.join(root, "System/rules/core/team.md")):
        problems.append("team starter: missing System/rules/core/team.md")
    problems += [f"team starter: {d} is still there" for d in TEAM_DROP if os.path.exists(os.path.join(root, d))]
    # the setup skill names them on purpose: it converts a shared vault started as a personal one
    for p, text in files(root):
        rel = os.path.relpath(p, root)
        if rel.endswith((".md", ".json")) and rel != "System/skills/setup/SKILL.md" and (m := PERSONAL.search(text)):
            problems.append(f"team starter: {rel} still points at {m.group(0)}")
    return problems


def selftest():
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "Contexts", "Work", "Projects", "Bluebird"))
        os.makedirs(os.path.join(d, "Contexts", "Work", "People"))
        open(os.path.join(d, "Contexts", "Work", "People", "Jane Roe.md"), "w").write("mail: jane@bluebird.io\n")
        names = names_from_vault(d)
        assert {"Bluebird", "Jane Roe", "Jane", "bluebird"} <= names and "Work" not in names, names
        t = os.path.join(d, "t")
        os.makedirs(t)
        open(os.path.join(t, "a.md"), "w").write("ok line\nsee /Users/jane/x\nask jane roe\nmail a@example.com\n")
        assert scan(t, names) == ["a.md:2: home path", "a.md:2: name from the real vault (4 characters)", "a.md:3: name from the real vault (8 characters)"], scan(t, names)
    print("selftest ok")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0
    names = set()
    if "--vault" in argv:
        names = names_from_vault(os.path.expanduser(argv[argv.index("--vault") + 1]))
    hits, problems = scan(ROOT, names, "--show" in argv) + [f"team-vault/{h}" for h in scan(TEAM, names, "--show" in argv)], structure(ROOT)
    with tempfile.TemporaryDirectory() as d:
        team_starter(os.path.join(d, "team"))
        problems += team_problems(os.path.join(d, "team"))
    for line in hits + problems:
        print(line)
    print(f"default vault and team starter: {len(hits)} leak(s), {len(problems)} structure problem(s), {len(names)} names checked")
    return 1 if hits or problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
