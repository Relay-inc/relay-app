#!/usr/bin/env python3
"""Regression check for the orchestrator's start flags (src-tauri/src/orch.rs flags, packages/agent-claude command).

Proves against the real claude CLI (Haiku, no settings, empty temp dir) what the orchestrator relies on:

  1. relay-orch next to relay-mail as two in-process MCP servers: its tools/list and tools/call arrive as
     mcp_message with server_name relay-orch, and a tool in --allowedTools runs without a card
  2. --append-system-prompt reaches the model
  3. an ask rule in --settings beats an allow for the same command: git push asks (can_use_tool) even when
     --allowedTools allows it, the way a worker's push asks while the user's settings allow `git push *`, and
     `git -C <dir> push` asks through the `git * push*` form
  4. --disallowedTools Write(//<abs path>) and Edit(//<abs path>) deny the shared vault files without asking,
     another file in the same folder can still be written

Exit 0 when all hold. Run after a Claude Code update, next to pipe-check.py.
"""
import json, os, subprocess, sys, tempfile, threading

CLAUDE = os.path.expanduser("~/.local/bin/claude")
ORCH_TOOLS = [{"name": "dispatch", "description": "Start a worker. Returns its key.",
               "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}, "task": {"type": "string"}}, "required": ["title", "task"]}}]

def run(prompt, tools, extra, system=None, decision="deny"):
    seen = {"servers": set(), "call": None, "can_use_tool": [], "result": "", "denied": [], "written": []}
    d = tempfile.mkdtemp(prefix="orch-check-")
    mcp = {"mcpServers": {"relay-mail": {"type": "sdk", "name": "relay-mail"}, "relay-orch": {"type": "sdk", "name": "relay-orch"}}}
    args = [CLAUDE, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
            "--permission-prompt-tool", "stdio", "--mcp-config", json.dumps(mcp), "--strict-mcp-config",
            "--setting-sources", "", "--tools", tools, "--model", "haiku", "--no-session-persistence", *extra(d)]
    if system: args += ["--append-system-prompt", system]
    args += ["-n", "orch-check"]
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env, cwd=d)
    timer = threading.Timer(150, p.kill); timer.start()
    def send(o): p.stdin.write(json.dumps(o) + "\n"); p.stdin.flush()
    send({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize", "sdkMcpServers": ["relay-mail", "relay-orch"]}})
    send({"type": "user", "message": {"role": "user", "content": prompt.replace("{dir}", d)}})
    for line in p.stdout:
        try: m = json.loads(line)
        except json.JSONDecodeError: continue
        if m.get("type") == "control_request":
            req = m["request"]
            if req.get("subtype") == "mcp_message":
                msg, mid, server = req["message"], req["message"].get("id"), req.get("server_name")
                seen["servers"].add(server)
                meth = msg.get("method")
                if mid is None: out = {"jsonrpc": "2.0", "result": {}, "id": 0}
                elif meth == "initialize": out = {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": msg["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": server, "version": "0"}}}
                elif meth == "tools/list": out = {"jsonrpc": "2.0", "id": mid, "result": {"tools": ORCH_TOOLS if server == "relay-orch" else []}}
                elif meth == "tools/call":
                    seen["call"] = (server, msg["params"]["name"], msg["params"].get("arguments"))
                    out = {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "Started worker c:orch-w-test."}]}}
                else: out = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "unknown"}}
                resp = {"mcp_response": out}
            elif req.get("subtype") == "can_use_tool":
                seen["can_use_tool"].append(req.get("tool_name"))
                resp = {"behavior": "allow", "updatedInput": req.get("input", {})} if decision == "allow" else {"behavior": "deny", "message": "denied by orch-check"}
            else: resp = {}
            send({"type": "control_response", "response": {"subtype": "success", "request_id": m["request_id"], "response": resp}})
        elif m.get("type") == "user" and isinstance(m["message"].get("content"), list):
            for c in m["message"]["content"]:
                if c.get("type") == "tool_result" and c.get("is_error"): seen["denied"].append(json.dumps(c.get("content")))
        elif m.get("type") == "result":
            seen["result"] = m.get("result") or ""; break
    timer.cancel(); p.stdin.close(); p.wait(timeout=10)
    seen["written"] = sorted(os.listdir(d))
    return seen

def main():
    ok = True
    def check(name, cond):
        nonlocal ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name)
    a = run("Call the dispatch tool of the relay-orch server with title 'check' and task 'say hi'. Then reply with the tool result and, on a new line, the code word from your instructions.",
            "", lambda d: ["--allowedTools", "mcp__relay-orch__dispatch"], system="The code word is PELICAN.")
    check("relay-orch and relay-mail both initialize over the pipe", {"relay-orch", "relay-mail"} <= a["servers"])
    check("relay-orch tools/call arrives with its server name and arguments", a["call"] and a["call"][:2] == ("relay-orch", "dispatch") and a["call"][2].get("title") == "check")
    check("an allowed relay-orch tool needs no card", a["call"] and not a["can_use_tool"])
    check("--append-system-prompt reaches the model", "PELICAN" in a["result"])
    b = run("Run exactly this Bash command: git push --dry-run origin main. Reply with exactly the output or error you got.",
            "Bash", lambda d: ["--allowedTools", "Bash(git push*)", "--settings", json.dumps({"permissions": {"ask": ["Bash(git push*)"]}})])
    check("an ask rule beats an allow: git push asks first", "Bash" in b["can_use_tool"])
    g = run("Run exactly this Bash command and nothing else: git -C /tmp push origin HEAD. Reply with exactly the output or error you got.",
            "Bash", lambda d: ["--allowedTools", "Bash(git *)", "--settings", json.dumps({"permissions": {"ask": ["Bash(git push*)", "Bash(git * push*)"]}})])
    check("git -C <dir> push asks too (the git * push* form)", "Bash" in g["can_use_tool"])
    c = run("Use the Write tool to create {dir}/System/reminders.md with the text x, then {dir}/free.md with the text y. Reply with what happened to each.",
            "Write,Edit", lambda d: ["--disallowedTools", f"Write(/{d}/System/reminders.md)", f"Edit(/{d}/System/reminders.md)"], decision="allow")
    check("a shared file is denied without asking, another file is written", "free.md" in c["written"] and "System" not in c["written"]
          and not any("reminders" in str(t) for t in c["can_use_tool"]) and c["denied"])
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
