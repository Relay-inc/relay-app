import { test } from "node:test";
import assert from "node:assert/strict";
import { changesVault, followChats, hasStarted, mainVaultProjects, terminalSessions } from "./rules.ts";
import type { AgentSession, Chat, Item } from "./types";
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

test("a conversation changes vault only when its old and new project live in different vault folders", () => {
  const project = (name: string, vault?: string) => ({
    name,
    vault,
    context: "",
    state: "",
    last: "",
    summary: "",
    open: null,
    open_items: [],
    stand: null,
    aliases: [],
  });
  const snap = {
    vault: {
      vault: "/main",
      map: { workState: "", reminders: "", notes: "" },
      found: { workState: true, reminders: true, notes: true },
      ok: true,
    },
    projects: [project("Alpha", "/main"), project("Beta", "/main"), project("Team", "/shared/team"), project("Old")],
  };
  assert.equal(changesVault(snap, "Alpha", "Beta"), false);
  assert.equal(changesVault(snap, null, "Alpha"), false);
  assert.equal(changesVault(snap, "Old", null), false); // no vault from an older backend: the main one
  assert.equal(changesVault(snap, "Alpha", "Team"), true);
  assert.equal(changesVault(snap, "Team", null), true);
  // a project the snapshot lacks is in an unknown vault: no move from or into it, a folder move within it is fine
  assert.equal(changesVault(snap, "Gone", null), true);
  assert.equal(changesVault(snap, "Alpha", "Gone"), true);
  assert.equal(changesVault(snap, "Gone", "Gone"), false);
  // the move bar's offer (a general conversation, started): the main vault's projects
  assert.deepEqual(
    mainVaultProjects(snap).map(project => project.name),
    ["Alpha", "Beta", "Old"],
  );
});

test("a conversation started once a message went out or a session runs", () => {
  const s = (kind: Item["kind"], queued = 0) => ({
    sidOf: {},
    status: {},
    queued: { a: queued },
    messages: { a: [{ kind, text: "x" }] },
  });
  assert.equal(hasStarted(s("ai"), "a"), false);
  assert.equal(hasStarted(s("ai", 1), "a"), true);
  assert.equal(hasStarted(s("me"), "a"), true);
});
