#!/usr/bin/env python3
"""Regression check for the stream-json pipe the app relies on (run after every Claude Code update).

vault-app offers its mail tools to the claude CLI as an in-process MCP server ({"type":"sdk"} in --mcp-config):
the CLI sends control_request/mcp_message on stdout, the app answers control_response on stdin. That wire format
comes from the Agent SDK's source, not from a documented protocol, so this script proves it still holds:

  1. initialize, tools/list and tools/call arrive as mcp_message, the tool result reaches the model
  2. can_use_tool arrives before the call with --permission-prompt-tool stdio, and a deny stops the call
  3. --disallowedTools, placed before -n the way lib.rs does it (a glob, a Bash rule with a space), denies a call
     before it reaches the app
     (the tool still shows in the init tool list, the deny is enforced at call time)
  4. no API key is used (apiKeySource "none": the claude.ai subscription)

Uses Haiku without settings, built-in tools or other MCP servers, in an empty temp dir. Exit 0 when all hold.
"""
import json, os, subprocess, sys, tempfile, threading

CLAUDE = os.path.expanduser("~/.local/bin/claude")
TOOLS = [{"name": n, "description": "Test tool, returns pong plus the text.",
          "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}} for n in ("ping", "gone")]

def run(decision: str, tool: str = "ping", bash: bool = False) -> dict:
    seen = {"initialize": False, "tools/list": False, "call": False, "can_use_tool": False, "result": "", "tools": [], "key": None, "denied": ""}
    mcp = {"mcpServers": {"vaultmail": {"type": "sdk", "name": "vaultmail"}}}
    args = [CLAUDE, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
            "--permission-prompt-tool", "stdio", "--mcp-config", json.dumps(mcp), "--strict-mcp-config",
            "--setting-sources", "", "--tools", "Bash" if bash else "", "--model", "haiku", "--no-session-persistence",
            # the same layout as lib.rs denied(): a glob, a Bash rule with a space inside one argv entry, then -n
            "--disallowedTools", "mcp__vaultmail__go*", "Bash(git push*)", "Bash(himalaya*)", "-n", "pipe-check"]
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                         env=env, cwd=tempfile.mkdtemp(prefix="pipe-check-"))
    timer = threading.Timer(120, p.kill); timer.start()
    def send(o): p.stdin.write(json.dumps(o) + "\n"); p.stdin.flush()
    send({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize", "sdkMcpServers": ["vaultmail"]}})
    ask = ("Run exactly this Bash command: git push --dry-run origin main. Reply with exactly the error or output you got." if bash else
           f"Call the {tool} tool of the vaultmail server with text 'check'. Reply with exactly the tool result, or with exactly the error you got.")
    send({"type": "user", "message": {"role": "user", "content": ask}})
    for line in p.stdout:
        try: m = json.loads(line)
        except json.JSONDecodeError: continue
        if m.get("type") == "system" and m.get("subtype") == "init":
            seen["tools"], seen["key"] = [t for t in m.get("tools", []) if "vaultmail" in t], m.get("apiKeySource")
        elif m.get("type") == "control_request":
            req = m["request"]
            if req.get("subtype") == "mcp_message":
                msg, mid = req["message"], req["message"].get("id")
                meth = msg.get("method")
                if mid is None: out = {"jsonrpc": "2.0", "result": {}, "id": 0}
                elif meth == "initialize":
                    seen["initialize"] = True
                    out = {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": msg["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "vaultmail", "version": "0"}}}
                elif meth == "tools/list": seen["tools/list"] = True; out = {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
                elif meth == "tools/call":
                    seen["call"] = True
                    out = {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "pong: " + msg["params"]["arguments"].get("text", "")}]}}
                else: out = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "unknown"}}
                resp = {"mcp_response": out}
            elif req.get("subtype") == "can_use_tool":
                seen["can_use_tool"] = True
                resp = {"behavior": "allow", "updatedInput": req.get("input", {})} if decision == "allow" else {"behavior": "deny", "message": "denied by pipe-check"}
            else: resp = {}
            send({"type": "control_response", "response": {"subtype": "success", "request_id": m["request_id"], "response": resp}})
        elif m.get("type") == "user" and isinstance(m["message"].get("content"), list):
            for c in m["message"]["content"]:
                if c.get("type") == "tool_result" and "denied" in json.dumps(c.get("content")): seen["denied"] = json.dumps(c.get("content"))
        elif m.get("type") == "result":
            seen["result"] = m.get("result") or ""; break
    timer.cancel(); p.stdin.close(); p.wait(timeout=10)
    return seen

def main():
    ok = True
    def check(name, cond):
        nonlocal ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name)
    a = run("allow")
    check("initialize + tools/list over the pipe", a["initialize"] and a["tools/list"])
    check("can_use_tool before the call", a["can_use_tool"])
    check("allowed call reaches the host and the model", a["call"] and "pong: check" in a["result"])
    check("no API key (subscription)", a["key"] == "none")
    d = run("deny")
    check("denied call never reaches the host", d["can_use_tool"] and not d["call"])
    g = run("allow", "gone")
    check("--disallowedTools glob blocks the call without asking or reaching the host", g["denied"] and not g["call"] and not g["can_use_tool"])
    b = run("allow", bash=True)
    check("Bash(git push*) is denied without asking", b["denied"] and not b["can_use_tool"])
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
