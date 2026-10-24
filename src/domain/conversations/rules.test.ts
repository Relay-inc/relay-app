import { test } from "node:test";
import assert from "node:assert/strict";
import { followChats, terminalSessions } from "./rules.ts";
import type { AgentSession, Chat } from "./types";
import type { SessionItem } from "../workspace/types";

const agent = (sessionId: string, app?: boolean): AgentSession => ({
  id: sessionId,
  sessionId,
  provider: "claude",
  kind: "interactive",
  status: "idle",
  app,
});
const item = (sessionId: string): SessionItem => ({ sessionId, project: null, last_user: "", last_at: "" });
const sessions = [item("term"), item("ours")];

test("an app process whose session id the app has not recorded yet is no terminal session", () => {
  const s = { agentsList: [agent("term"), agent("ours", true)], appSids: [], forked: [] };
  assert.deepEqual(
    terminalSessions(s, sessions, {}, k => k).map(x => x.sid),
    ["term"],
  );
});

test("another window's conversations replace this one's, its unstored drafts stay and unchanged entries keep their object", () => {
  const kept: Chat = { key: "a", project: null, title: "A", at: 1 };
  const mine: Record<string, Chat> = {
    a: kept,
    b: { key: "b", project: null, title: "B", at: 2 },
    gone: { key: "gone", project: null, title: "Gone", at: 3 },
    draft: { key: "draft", project: "p", title: "New", at: 4, draft: true },
  };
  const next = followChats(mine, {
    a: { key: "a", project: null, title: "A", at: 1 },
    b: { key: "b", project: null, title: "B renamed", at: 2 },
  });
  assert.deepEqual(Object.keys(next).sort(), ["a", "b", "draft"]);
  assert.equal(next.a, kept);
  assert.equal(next.b.title, "B renamed");
});
