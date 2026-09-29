#!/usr/bin/env python3
"""Permission tool for Claude Code sessions started by the Vault app (stdio MCP server).

Claude calls `approve` for every tool call that needs Laurent, and for AskUserQuestion. The request
is written to $PENDING/<id>.json, the app shows it, and writes $PENDING/<id>.answer.json. We wait for
that file, pass the decision back to Claude, and remove both. Files, not a socket: nothing listens on
a port, and a waiting question survives an app restart.
"""
import json
import os
import sys
import time
import uuid

PENDING = os.environ["PENDING"]
PROJECT = os.environ.get("PROJECT", "")


def send(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def ask(args):
    rid = uuid.uuid4().hex[:12]
    req = os.path.join(PENDING, f"{rid}.json")
    ans = os.path.join(PENDING, f"{rid}.answer.json")
    with open(req + ".tmp", "w") as f:
        json.dump({"id": rid, "project": PROJECT, "at": time.time(), **args}, f)
    os.replace(req + ".tmp", req)
    while not os.path.exists(ans):
        time.sleep(0.25)
    with open(ans) as f:
        decision = json.load(f)
    for p in (req, ans):
        try:
            os.remove(p)
        except FileNotFoundError:
            pass
    return decision


TOOL = {
    "name": "approve",
    "description": "Ask Laurent to approve a tool call or answer a question",
    "inputSchema": {"type": "object", "required": ["tool_name", "input"], "properties": {
        "tool_name": {"type": "string"}, "input": {"type": "object"}, "tool_use_id": {"type": "string"}}},
}

os.makedirs(PENDING, exist_ok=True)
for line in sys.stdin:
    req = json.loads(line)
    method, rid = req.get("method"), req.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": req["params"]["protocolVersion"], "capabilities": {"tools": {}},
            "serverInfo": {"name": "vaultperm", "version": "0.1"}}})
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": rid, "result": {"tools": [TOOL]}})
    elif method == "tools/call":
        decision = ask(req["params"]["arguments"])
        send({"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": json.dumps(decision)}]}})
    elif rid is not None:
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
