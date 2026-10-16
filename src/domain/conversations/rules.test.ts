import { test } from "node:test";
import assert from "node:assert/strict";
import { terminalSessions } from "./rules.ts";
import type { AgentSession } from "./types";
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
