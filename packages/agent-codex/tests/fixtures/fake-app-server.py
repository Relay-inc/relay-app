#!/usr/bin/python3
# A stand-in for `codex app-server` for the bridge's test (src/lib.rs): answers the handshake (a resume that fails, a
# new thread), echoes turn/start, asks for one approval and one thing the app has no card for, reports the answers.
import json, sys

seen, answers = [], []
def say(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if "method" not in m:
        answers.append(m)
        if len(answers) == 2:
            say({"method": "got", "params": sorted(answers, key=lambda a: a["id"])})
        continue
    seen.append(m["method"])
    if m["method"] == "initialize":
        say({"id": m["id"], "result": {"userAgent": "fake"}})
    elif m["method"] == "skills/list":
        say({"id": m["id"], "result": {"data": []}})
    elif m["method"] == "thread/resume":
        say({"id": m["id"], "error": {"code": -32600, "message": "no rollout found for thread id " + m["params"]["threadId"]}})
    elif m["method"] == "thread/start":
        say({"id": m["id"], "result": {"thread": {"id": "019a0000-ffff-7000-8000-00000000000f"}, "model": m["params"].get("model")}})
    elif m["method"] == "turn/start":
        say({"method": "echo", "params": m["params"], "seen": seen})
        say({"id": 5, "method": "item/commandExecution/requestApproval", "params": {"threadId": m["params"]["threadId"], "turnId": "t1", "itemId": "c1", "command": "ls", "cwd": "/v"}})
        say({"id": 6, "method": "item/tool/requestUserInput", "params": {}})
