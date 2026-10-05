#!/usr/bin/env python3
"""A stand-in for `opencode serve` in the bridge test (src/lib.rs): prints the listening line, checks the password,
has no session ses_gone, makes ses_new1, and answers a prompt with an event of another session, an echo of what it
got and a permission request; a permission reply is echoed too. Anything else is a 404."""
import base64, json, os, queue, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

events, seen = queue.Queue(), []
command_allowed = threading.Event()
AUTH = "Basic " + base64.b64encode(("opencode:" + os.environ.get("OPENCODE_SERVER_PASSWORD", "")).encode()).decode()
ASK = (json.loads(os.environ.get("OPENCODE_CONFIG_CONTENT") or "{}").get("permission") or {}).get("edit")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_one(self, method):
        seen.append(f"{method} {self.path}")
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n)) if n else None
        ok = self.headers.get("Authorization") == AUTH
        if self.path == "/event":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b'data: {"type":"server.connected","properties":{}}\n\n')
            self.wfile.flush()
            while True:
                self.wfile.write(("data: " + json.dumps(events.get()) + "\n\n").encode())
                self.wfile.flush()
        elif self.path == "/command":
            self.reply(200, [{"name": "check", "description": "Check changes"}])
        elif self.path == "/session/ses_new1/command":
            events.put({"type": "command", "properties": {"sessionID": "ses_new1", "body": body}})
            events.put({"type": "permission.asked", "properties": {"id": "per_command", "sessionID": "ses_new1", "permission": "bash", "patterns": ["test"], "metadata": {"command": "test"}, "always": []}})
            if not command_allowed.wait(5):
                self.reply(500, {"error": "permission reply blocked by synchronous command"})
                return
            self.reply(200, {})
        elif method == "POST" and self.path == "/session":
            self.reply(200, {"id": "ses_new1"})
        elif self.path == "/session/ses_new1/prompt_async":
            events.put({"type": "echo", "properties": {"sessionID": "ses_other"}})
            events.put({"type": "echo", "properties": {"sessionID": "ses_new1", "seen": list(seen), "body": body, "auth": ok, "ask": ASK}})
            events.put({"type": "permission.asked", "properties": {"id": "per_1", "sessionID": "ses_new1", "permission": "bash",
                        "patterns": ["ls"], "metadata": {"command": "ls"}, "always": ["ls *"]}})
            self.reply(204)
        elif self.path == "/permission/per_command/reply":
            command_allowed.set()
            events.put({"type": "command.allowed", "properties": {"sessionID": "ses_new1"}})
            self.reply(200, True)
        elif self.path == "/permission/per_1/reply":
            events.put({"type": "reply", "properties": {"sessionID": "ses_new1", "seen": seen[-1], "body": body}})
            self.reply(200, True)
        else:
            self.reply(404, {"name": "NotFoundError"})

    def do_GET(self):
        self.handle_one("GET")

    def do_POST(self):
        self.handle_one("POST")


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
srv.daemon_threads = True
print(f"opencode server listening on http://127.0.0.1:{srv.server_address[1]}", flush=True)
srv.serve_forever()
