#!/usr/bin/env python3
"""The app's stdin/stdout to `opencode serve` (HTTP + server-sent events), for one conversation.

    bridge.py <opencode-bin> '<config json>'   config: {cwd, model, variant, resume, fork, ask}

It starts a private server in the vault (127.0.0.1, a free port, a random password), opens or makes the session
(resume: GET /session/<id>, fork: POST /session/<id>/fork, else POST /session) and, once subscribed to
its events, writes `{"type":"bridge.session","id":…}`. Then it passes the server's events of that session to stdout, one JSON object per
line, as they come from GET /event, and turns the app's stdin lines into requests:

    {"type":"prompt","parts":[…]}                      POST /session/<id>/prompt_async (model and variant filled in)
    {"type":"permission","id":"per…","reply":"once"|"reject","message"?}   POST /permission/<id>/reply
    {"type":"question","id":"que…","answers":[[label…]…]} | {…,"reject":true}  POST /question/<id>/reply | reject
    {"type":"abort"}                                   POST /session/<id>/abort

A request that fails is written as `{"type":"bridge.error","message":…}`. When the app closes stdin (or is gone) the
server is stopped. With `ask`, edits and commands ask first (permission "ask" through OPENCODE_CONFIG_CONTENT, on top
of the user's own config), so they come to the app's permission cards.
"""
import base64, json, os, re, secrets, subprocess, sys, threading, urllib.error, urllib.request

lock = threading.Lock()


def out(msg):
    with lock:
        sys.stdout.write((msg if isinstance(msg, str) else json.dumps(msg)) + "\n")
        sys.stdout.flush()


def main():
    bin, cfg = sys.argv[1], json.loads(sys.argv[2])
    pw = secrets.token_hex(16)
    auth = "Basic " + base64.b64encode(f"opencode:{pw}".encode()).decode()
    env = dict(os.environ, OPENCODE_SERVER_PASSWORD=pw)
    if cfg.get("ask"):
        env["OPENCODE_CONFIG_CONTENT"] = json.dumps({"permission": {"edit": "ask", "bash": "ask", "webfetch": "ask"}})
    srv = subprocess.Popen([bin, "serve", "--hostname", "127.0.0.1", "--port", "0"], cwd=cfg.get("cwd") or None, env=env,
                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    url = None
    for line in srv.stdout:  # "opencode server listening on http://127.0.0.1:4096"
        m = re.search(r"https?://[\w.:\[\]-]+", line)
        if m and "listening" in line:
            url = m.group(0)
            break
        sys.stderr.write(line)
    if not url:
        out({"type": "bridge.error", "message": "opencode serve did not start"})
        sys.exit(srv.wait() or 1)
    # the rest of the server's log goes to stderr
    threading.Thread(target=lambda: [sys.stderr.write(l) for l in srv.stdout], daemon=True).start()

    def call(method, path, body=None, timeout=60):
        req = urllib.request.Request(url + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Authorization": auth, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            s = r.read()
            return json.loads(s) if s.strip() else None

    try:
        commands = {c["name"] for c in call("GET", "/command")}
    except Exception:
        commands = set()

    stopping = threading.Event()

    def stop(code=0):
        stopping.set()
        srv.terminate()
        try:
            srv.wait(5)
        except subprocess.TimeoutExpired:
            srv.kill()
        os._exit(code)

    sid = None
    try:
        if cfg.get("resume"):
            try:
                sid = call("GET", f"/session/{cfg['resume']}")["id"]
            except (urllib.error.HTTPError, KeyError, TypeError):
                sid = None  # opencode no longer has it: a new session
        if not sid and cfg.get("fork"):
            sid = call("POST", f"/session/{cfg['fork']}/fork", {})["id"]
        if not sid:
            sid = call("POST", "/session", {})["id"]
    except Exception as e:  # noqa: BLE001 - anything here ends the conversation
        out({"type": "bridge.error", "message": f"opencode session: {e}"})
        stop(1)

    def ours(p):
        return sid in (p.get("sessionID"), (p.get("part") or {}).get("sessionID"), (p.get("info") or {}).get("sessionID"))

    ready = threading.Event()

    def events():
        req = urllib.request.Request(url + "/event", headers={"Authorization": auth, "Accept": "text/event-stream"})
        try:
            with urllib.request.urlopen(req) as r:
                ready.set()  # subscribed: nothing of the first turn is missed
                for raw in r:
                    line = raw.decode("utf-8", "replace").rstrip("\r\n")
                    if not line.startswith("data:"):
                        continue
                    try:
                        ev = json.loads(line[5:])
                    except ValueError:
                        continue
                    if ours(ev.get("properties") or {}):
                        out(ev)
        except Exception as e:  # noqa: BLE001
            if not stopping.is_set():
                out({"type": "bridge.error", "message": f"opencode events: {e}"})
        ready.set()
        if not stopping.is_set():
            stop(1)  # the server is gone: so is the conversation's process

    threading.Thread(target=events, daemon=True).start()
    ready.wait()
    out({"type": "bridge.session", "id": sid})

    for line in sys.stdin:
        try:
            m = json.loads(line)
            t = m.get("type")
            if t == "prompt":
                body = {"parts": m.get("parts") or []}
                if "/" in (cfg.get("model") or ""):
                    p, mid = cfg["model"].split("/", 1)
                    body["model"] = {"providerID": p, "modelID": mid}
                if cfg.get("variant"):
                    body["variant"] = cfg["variant"]
                parts = body["parts"]
                text = next((p.get("text", "") for p in parts if p.get("type") == "text"), "")
                words = text.split(maxsplit=1)
                if words and words[0].startswith("/") and words[0][1:] in commands:
                    command_body = {"command": words[0][1:], "arguments": words[1] if len(words) > 1 else ""}
                    if body.get("model"):
                        command_body["model"] = cfg["model"]
                    if body.get("variant"):
                        command_body["variant"] = body["variant"]
                    files = [part for part in parts if part.get("type") == "file"]
                    if files:
                        command_body["parts"] = files
                    # /command waits for the turn: keep stdin free for permission/question replies.
                    def execute(payload):
                        try:
                            call("POST", f"/session/{sid}/command", payload, timeout=86400)
                        except Exception as error:
                            out({"type": "bridge.error", "message": str(error)})
                    threading.Thread(target=execute, args=(command_body,), daemon=True).start()
                else:
                    call("POST", f"/session/{sid}/prompt_async", body)
            elif t == "permission":
                body = {"reply": m.get("reply") or "reject"}
                if m.get("message"):
                    body["message"] = m["message"]
                call("POST", f"/permission/{m['id']}/reply", body)
            elif t == "question" and m.get("reject"):
                call("POST", f"/question/{m['id']}/reject", {})
            elif t == "question":
                call("POST", f"/question/{m['id']}/reply", {"answers": m.get("answers") or []})
            elif t == "abort":
                call("POST", f"/session/{sid}/abort", {})
        except Exception as e:  # noqa: BLE001 - a bad line or a failed request, the conversation goes on
            detail = e.read().decode("utf-8", "replace")[:500] if isinstance(e, urllib.error.HTTPError) else ""
            out({"type": "bridge.error", "message": f"{e} {detail}".strip()})
    stop(0)


if __name__ == "__main__":
    main()
