#!/usr/bin/python3
# A stand-in for `agy acp` for the bridge's test (src/lib.rs): answers the handshake (a resume that fails, a new
# session, the model and the mode), echoes session/prompt, asks for one permission and one thing the app has no card
# for, reports the answers, then runs the tool, says a word and ends the turn.
import json, sys

seen, answers, opened, turn = [], [], None, None
def say(m):
    print(json.dumps(m), flush=True)
def update(u):
    say({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "5e55-0001", "update": u}})

for line in sys.stdin:
    m = json.loads(line)
    if "method" not in m:
        answers.append(m)
        if len(answers) == 2:
            say({"method": "got", "params": sorted(answers, key=lambda a: a["id"])})
            update({"sessionUpdate": "tool_call_update", "toolCallId": "c1", "name": "run_command", "kind": "execute", "status": "completed", "rawInput": {"CommandLine": "ls"}})
            update({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Kl"}})
            update({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "aar."}})
            say({"jsonrpc": "2.0", "id": turn, "result": {"stopReason": "end_turn", "usage": {"inputTokens": 100, "outputTokens": 20, "cachedReadTokens": 40, "cachedWriteTokens": 0}}})
        continue
    seen.append(m["method"])
    if m["method"] == "initialize":
        say({"jsonrpc": "2.0", "id": m["id"], "result": {"protocolVersion": 1, "agentCapabilities": {"_meta": {"antigravity": {"systemPrompt": {"append": True}}}}}})
    elif m["method"] == "session/resume":
        say({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32002, "message": "session not found: " + m["params"]["sessionId"]}})
    elif m["method"] == "session/new":
        opened = m["params"]
        say({"jsonrpc": "2.0", "id": m["id"], "result": {"sessionId": "5e55-0001", "models": {"currentModelId": "m1"}}})
    elif m["method"] in ("session/set_model", "session/set_mode"):
        say({"jsonrpc": "2.0", "id": m["id"], "result": {}})
    elif m["method"] == "session/prompt":
        turn = m["id"]
        say({"method": "echo", "params": m["params"], "seen": seen, "opened": opened})
        update({"sessionUpdate": "available_commands_update", "availableCommands": [{"name": "compact", "description": "Compact"}]})
        update({"sessionUpdate": "tool_call", "toolCallId": "c1", "name": "run_command", "kind": "execute", "status": "pending", "rawInput": {"CommandLine": "ls"}})
        say({"jsonrpc": "2.0", "id": "p1", "method": "session/request_permission", "params": {"sessionId": "5e55-0001",
            "toolCall": {"toolCallId": "c1", "name": "run_command", "kind": "execute", "rawInput": {"CommandLine": "ls"}},
            "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"}, {"optionId": "deny", "name": "Deny", "kind": "reject_once"}]}})
        say({"jsonrpc": "2.0", "id": "x1", "method": "fs/read_text_file", "params": {"path": "/etc/hosts"}})
