import { test } from "node:test";
import assert from "node:assert/strict";
import { blocked } from "./blocked.ts";
import { NOW, flags, snap, words } from "./fixtures.ts";
import type { AgentSession } from "../../conversations/types";
import type { EntryOf } from "./types.ts";

const session = (over: Partial<AgentSession>): AgentSession =>
  ({ id: "s1", kind: "background", state: "blocked", name: "deploy", ...over }) as AgentSession;

test("only blocked background sessions that were not hidden are items", () => {
  const entries = blocked.entries(
    snap({
      agents: [
        session({}),
        session({ id: "s2", state: "running" }),
        session({ id: "s3", kind: "terminal" }),
        session({ id: "s4" }),
      ],
      hiddenAgents: ["s4"],
    }),
    words,
    NOW,
  );
  assert.deepEqual(
    entries.map(e => e.id),
    ["blocked:s1"],
  );
  assert.equal(entries[0].title, "deploy");
  assert.equal(entries[0].tone, "soon");
  assert.equal(entries[0].project, null);
});

test("Enter attaches the terminal, Backspace stops it, hide is under the menu", () => {
  const [draft] = blocked.entries(snap({ agents: [session({})] }), words, NOW);
  const set = blocked.actions(draft as EntryOf<"blocked">, flags, words);
  assert.deepEqual(
    set.acts.map(a => a.id),
    ["attach", "stop", "hide"],
  );
  assert.equal(set.acts[set.primary!].id, "attach");
  assert.equal(set.acts[set.secondary!].id, "stop");
  assert.equal(set.done, undefined);
});
