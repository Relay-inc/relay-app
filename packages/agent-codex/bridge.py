#!/usr/bin/env python3
"""The app's stdin/stdout to `codex app-server` (JSON-RPC 2.0, one JSON object per line), for one conversation.

    bridge.py <codex-bin> '<config json>'   config: {cwd, model, effort, sandbox, approval, resume, instructions}

It does the handshake the app cannot (initialize, initialized, thread/start or thread/resume, which gives the thread id)
and then passes lines both ways: every line codex writes goes to stdout unchanged, every line the app writes goes to
codex with the thread id, model and effort filled in (the Rust side writes `turn/start` without them). Server requests
the app has no card for are declined here, so a turn never waits on an answer nobody can give. When the app closes
stdin (or is gone) codex is stopped.
"""
import json, os, subprocess, sys, threading

# server requests the Rust side turns into permission cards (src/app_server.rs)
ASKS = {"item/commandExecution/requestApproval", "item/fileChange/requestApproval", "execCommandApproval", "applyPatchApproval"}


def prepare_turn(message, skills):
    """Slash UI commands become protocol operations, skills become explicit skill input items."""
    params = message.get("params") or {}
    inputs = params.get("input") or []
    first = next((item for item in inputs if item.get("type") == "text"), None)
    if not first or not first.get("text", "").startswith("/"):
        return message
    command, *rest = first["text"].split(maxsplit=1)
    arguments = rest[0] if rest else ""
    if command in ("/compact", "/review"):
        if any(item.get("type") != "text" for item in inputs):
            raise ValueError("This command does not accept attachments")
        if command == "/compact" and arguments:
            raise ValueError("/compact does not accept arguments")
        params = {"threadId": params["threadId"]}
        message = {"id": message["id"], "method": "thread/compact/start", "params": params}
        if command == "/review":
            message["method"] = "review/start"
            params.update(delivery="inline", target={"type": "custom", "instructions": arguments} if arguments else {"type": "uncommittedChanges"})
    elif command.startswith("/skill:"):
        name = command[len("/skill:"):]
        skill = skills.get(name)
        if not skill:
            raise ValueError("Skill is unavailable or disabled: " + name)
        first["text"] = "$" + name + (" " + arguments if arguments else "")
        first.pop("text_elements", None)
        inputs.append({"type": "skill", "name": name, "path": skill["path"]})
    return message


def main():
    bin, cfg = sys.argv[1], json.loads(sys.argv[2])
    codex = subprocess.Popen([bin, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
    lock = threading.Lock()

    def send(msg):
        with lock:
            codex.stdin.write(json.dumps(msg) + "\n")
            codex.stdin.flush()

    def out(line):
        sys.stdout.write(line if line.endswith("\n") else line + "\n")
        sys.stdout.flush()

    def until(rid):
        """Pass codex's lines on until the response to request `rid`, and return that one (not passed on)."""
        for line in codex.stdout:
            try:
                m = json.loads(line)
            except ValueError:
                m = {}
            if m.get("id") == rid and "method" not in m:
                return m
            out(line)
        sys.exit(codex.wait() or 1)

    send({"id": 0, "method": "initialize", "params": {"clientInfo": {"name": "relay", "title": "Relay", "version": "0.1.0"}, "capabilities": None}})
    until(0)
    send({"method": "initialized"})
    opts = {"cwd": cfg.get("cwd"), "approvalPolicy": cfg.get("approval") or "on-request", "sandbox": cfg.get("sandbox") or "workspace-write"}
    if cfg.get("model"):
        opts["model"] = cfg["model"]
    if cfg.get("effort"):
        opts["config"] = {"model_reasoning_effort": cfg["effort"]}
    if cfg.get("instructions"):
        opts["developerInstructions"] = cfg["instructions"]
    r = None
    if cfg.get("resume"):
        send({"id": 1, "method": "thread/resume", "params": {"threadId": cfg["resume"], **opts}})
        r = until(1)
    if r is None or "error" in r:  # nothing to resume, or codex no longer has it: a new thread
        send({"id": 2, "method": "thread/start", "params": opts})
        r = until(2)
    out(json.dumps(r))  # the Rust side reads the thread id (or the error) from it
    thread = ((r.get("result") or {}).get("thread") or {}).get("id")
    if not thread:
        codex.terminate()
        sys.exit(1)

    send({"id": 3, "method": "skills/list", "params": {"cwds": [cfg.get("cwd") or os.getcwd()], "forceReload": True}})
    result = until(3).get("result") or {}
    skills = {}
    for group in result.get("data", []):
        for skill in group.get("skills", []):
            if skill.get("enabled", True) and skill.get("path"):
                skills.setdefault(skill["name"], skill)

    def pump():
        for line in codex.stdout:
            out(line)
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if "id" in m and "method" in m and m["method"] not in ASKS:
                send({"id": m["id"], "error": {"code": -32601, "message": "not supported by the vault app"}})
        os._exit(codex.wait())  # codex is gone: so is the conversation's process

    threading.Thread(target=pump, daemon=True).start()
    n = 10
    for line in sys.stdin:
        try:
            m = json.loads(line)
        except ValueError:
            continue
        p = m.get("params")
        if "method" in m and isinstance(p, dict):
            if p.get("threadId") == "":
                p["threadId"] = thread
            if m["method"] == "turn/start":
                n += 1
                m.setdefault("id", n)
                if cfg.get("model"):
                    p.setdefault("model", cfg["model"])
                if cfg.get("effort"):
                    p.setdefault("effort", cfg["effort"])
        try:
            if m.get("method") == "turn/start":
                m = prepare_turn(m, skills)
            send(m)
        except ValueError as error:
            out(json.dumps({"id": m.get("id"), "error": {"message": str(error)}}))
        except BrokenPipeError:
            break
    codex.terminate()
    sys.exit(codex.wait())


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, BrokenPipeError):
        pass
