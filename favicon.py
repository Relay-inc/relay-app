#!/usr/bin/env python3
"""Guess each project's website from its notes and fetch the site's favicon. No AI, stdlib only.

stdin: {"projects": [{"name", "aliases"}], "tried": {name: site}}. The site is a domain named in the
project folder that holds the project's name or an alias (resolvus.be for Resolvus), else the domain
named most often on the project note itself (at least twice). A project whose guess equals its entry
in "tried" is skipped, so a site without a favicon is only fetched once.
stdout: {name: {"site": "" when no guess, "data": data url of the raw icon or null}} for the rest.
"""
import base64
import concurrent.futures
import glob
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter

VAULT = os.environ.get("VAULT") or sys.exit("favicon: VAULT not set")
NOTES = os.environ.get("VAULT_NOTES") or os.path.join(VAULT, "Contexts")
NOTES = NOTES if os.path.isdir(NOTES) else VAULT
try:
    CONFIG = json.load(open(os.path.join(VAULT, ".relay", "config.json"), encoding="utf-8"))
except (OSError, ValueError):
    CONFIG = {}
SKIP = CONFIG.get("skip") or ["Documents", "Gesprekken", "_archive"]
SKIP_DIRS = ("/transcripts/", "/_archive/", "/Attachments/")
DOMAIN = re.compile(r"\b((?:[a-z0-9-]+\.)+(?:be|com|eu|nl|io|app|gent|shop|net|org|fr|de|co|ai|dev|tech))\b", re.I)
# tools and platforms that show up in any note, never a project's own site
NOISE = {"notion.so", "notion.com", "claude.ai", "claude.com", "anthropic.com", "github.com", "google.com", "gmail.com",
         "googleapis.com", "gstatic.com", "weareantenna.be", "combell.com", "productive.io", "sentry.io", "linkedin.com",
         "slack.com", "w3.org", "youtube.com", "apple.com", "microsoft.com", "amazon.com", "openai.com", "figma.com",
         "run.app", "webhosting.be", "vercel.app", "lovable.app", "typekit.net", "licdn.com", "wordpress.org"}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15"


def compact(s):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower())


def registrable(d):
    parts = d.lower().removeprefix("www.").split(".")
    return ".".join(parts[-3:] if len(parts) > 2 and parts[-2] in ("co", "com") else parts[-2:])


def domains(files):
    c = Counter()
    for f in files:
        try:
            c.update(registrable(d) for d in DOMAIN.findall(open(f, encoding="utf-8", errors="ignore").read()))
        except OSError:
            pass
    return c


def guess(name, aliases):
    notes = [p for p in glob.glob(os.path.join(glob.escape(NOTES), "**", f"{glob.escape(name)}.md"), recursive=True)
             if not any(f"/{d}/" in "/" + os.path.relpath(p, NOTES) for d in SKIP)]
    if not notes:
        return ""
    folder = os.path.dirname(notes[0])
    everything = domains(f for f in glob.glob(os.path.join(glob.escape(folder), "**", "*.md"), recursive=True)
                         if not any(d in f[len(folder):] + "/" for d in SKIP_DIRS))
    keys = {k for n in [name, *aliases] for k in [compact(n), *(compact(w) for w in re.split(r"[\s/-]+", n))] if len(k) >= 4}
    # the domain starts with the name: weemaesglas.be for Weemaes, not filmfestival.be for Trefpunt Festival
    named = [(n, d) for d, n in everything.items() if d not in NOISE and any(compact(d.split(".")[0]).startswith(k) for k in keys)]
    if named:
        return max(named)[1]
    common = [(n, d) for d, n in domains(notes[:1]).items() if d not in NOISE and n >= 2]
    return max(common)[1] if common else ""


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,image/*,*/*"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read(2_000_000), r.geturl()


def mime(b):
    head = b[:300].lstrip().lower()
    if b.startswith(b"\x89PNG"): return "image/png"
    if b.startswith(b"\0\0\1\0"): return "image/x-icon"
    if b.startswith(b"\xff\xd8"): return "image/jpeg"
    if b.startswith(b"GIF8"): return "image/gif"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP": return "image/webp"
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in b[:1000].lower()): return "image/svg+xml"
    return None


def favicon(site):
    html, base = get(f"https://{site}")
    links = []
    for tag in re.findall(r"<link[^>]+>", html.decode("utf-8", "ignore"), re.I):
        rel, href = re.search(r"rel=[\"']?([^\"'>]+)", tag, re.I), re.search(r"href=[\"']?([^\"' >]+)", tag, re.I)
        if not rel or not href or "icon" not in rel.group(1).lower() or "mask" in rel.group(1).lower():
            continue
        size = re.search(r"sizes=[\"']?(\d+)", tag)
        # the largest wins: an svg scales, an apple-touch-icon is 180 px
        n = int(size.group(1)) if size else 512 if ".svg" in href.group(1) else 180 if "apple" in rel.group(1).lower() else 16
        links.append((n, urllib.parse.urljoin(base, href.group(1).replace("&amp;", "&"))))
    for _, url in sorted(links, reverse=True) + [(0, urllib.parse.urljoin(base, "/favicon.ico"))]:
        try:
            b, _ = get(url)
        except Exception:
            continue
        if m := mime(b):
            return f"data:{m};base64,{base64.b64encode(b).decode()}"
    return None


def check(p, tried):
    site = guess(p["name"], p.get("aliases") or [])
    if site == tried.get(p["name"]):
        return None
    try:
        data = favicon(site) if site else None
    except Exception:  # unreachable, bad certificate, blocked: counts as tried
        data = None
    return p["name"], {"site": site, "data": data}


if __name__ == "__main__":
    job = json.load(sys.stdin)
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        done = ex.map(lambda p: check(p, job.get("tried") or {}), job["projects"])
    json.dump(dict(r for r in done if r), sys.stdout)
