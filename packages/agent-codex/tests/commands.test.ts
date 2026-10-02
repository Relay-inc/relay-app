import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bridge = fileURLToPath(new URL("../bridge.py", import.meta.url));
function prepare(text: string, extra: unknown[] = []) {
  return JSON.parse(execFileSync("python3", ["-c", `
import json, runpy, sys
prepare = runpy.run_path(sys.argv[1])['prepare_turn']
message = {'id': 11, 'method': 'turn/start', 'params': {'threadId': 't', 'model': 'm', 'effort': 'high', 'input': [{'type':'text', 'text':sys.argv[2]}] + json.loads(sys.argv[3])}}
try:
 print(json.dumps(prepare(message, {'writer': {'name':'writer','path':'/skills/writer/SKILL.md'}})))
except ValueError as e:
 print(json.dumps({'error':str(e)}))
`, bridge, text, JSON.stringify(extra)], { encoding: "utf8" }));
}

test("Codex dispatches compact and review without leaking turn-only fields", () => {
  assert.deepEqual(prepare("/compact"), { id: 11, method: "thread/compact/start", params: { threadId: "t" } });
  assert.deepEqual(prepare("/review").params.target, { type: "uncommittedChanges" });
  assert.deepEqual(prepare("/review focus on errors").params.target, { type: "custom", instructions: "focus on errors" });
  assert.ok(prepare("/compact instructions").error);
  assert.ok(prepare("/compact", [{ type: "image", url: "data:x" }]).error);
});

test("Codex skill invocation is explicit and preserves arguments and attachments", () => {
  const image = { type: "image", url: "data:x" };
  const result = prepare("/skill:writer rewrite this\nwith examples", [image]);
  assert.deepEqual(result.params.input, [
    { type: "text", text: "$writer rewrite this\nwith examples" }, image,
    { type: "skill", name: "writer", path: "/skills/writer/SKILL.md" },
  ]);
  assert.equal(result.params.model, "m");
  assert.ok(prepare("/skill:removed").error);
  assert.equal(prepare("ordinary /text").params.input[0].text, "ordinary /text");
});
