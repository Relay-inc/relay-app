import { test } from "node:test";
import assert from "node:assert/strict";
import { agentBehind, releasesSince } from "./updates.ts";

const release = (version: string) => ({ version, notes: "", date: null });

test("only the releases after this version count, a skipped one included", () => {
  const status = {
    version: "0.0.20",
    checked: 1,
    latest: "0.0.22",
    error: null,
    releases: ["0.0.22", "0.0.21", "0.0.20", "0.0.9"].map(release),
  };
  assert.deepEqual(
    releasesSince(status).map(r => r.version),
    ["0.0.22", "0.0.21"],
  );
});
test("an agent is behind only when both versions are known and npm's is newer", () => {
  const agent = { id: "codex", name: "Codex", on: true, command: null };
  assert.equal(agentBehind({ ...agent, installed: "0.160.0", latest: "0.162.1" }), true);
  assert.equal(agentBehind({ ...agent, installed: "0.162.1", latest: "0.162.1" }), false);
  assert.equal(agentBehind({ ...agent, installed: "", latest: "0.162.1" }), false);
  assert.equal(agentBehind({ ...agent, installed: null, latest: "0.162.1" }), false);
});
