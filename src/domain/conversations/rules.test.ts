import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeWorkspace,
  changesVault,
  chatVault,
  followChats,
  hasStarted,
  inWorkspace,
  pickedVault,
  sameVaultProjects,
  terminalSessions,
  vaultPick,
} from "./rules.ts";
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
    sameVaultProjects(snap).map(project => project.name),
    ["Alpha", "Beta", "Old"],
  );
  // a general conversation that runs in a vault picked for it: that vault's projects, and no move out of it
  assert.deepEqual(
    sameVaultProjects(snap, "/shared/team").map(project => project.name),
    ["Team"],
  );
  assert.equal(changesVault(snap, null, "Team", "/shared/team"), false);
  assert.equal(changesVault(snap, null, "Alpha", "/shared/team"), true);
});

test("a new conversation picks among every vault, a project's runs in its own and another vault runs on Claude Code here", () => {
  const settings = {
    vault: "/main",
    extraVaults: ["/me/Notes"],
    sharedVaults: [
      {
        id: "0123456789abcdef",
        name: "Team vault",
        host: "h",
        port: 1,
        fp: "ab",
        folder: "/shared/team",
        role: "member" as const,
      },
    ],
  };
  const snap = {
    vault: {
      vault: "/main",
      map: { workState: "", reminders: "", notes: "" },
      found: { workState: true, reminders: true, notes: true },
      ok: true,
    },
    projects: [
      {
        name: "Launch Plan",
        vault: "/shared/team",
        context: "",
        state: "",
        last: "",
        summary: "",
        open: null,
        open_items: [],
        stand: null,
        aliases: [],
      },
      {
        name: "Alpha",
        context: "",
        state: "",
        last: "",
        summary: "",
        open: null,
        open_items: [],
        stand: null,
        aliases: [],
      },
    ],
  };
  // the main vault first, an own folder by its name, a shared vault by its own name
  assert.deepEqual(vaultPick({ project: null }, settings, snap).list, [
    { folder: "/main", name: "main", main: true },
    { folder: "/me/Notes", name: "Notes", main: false },
    { folder: "/shared/team", name: "Team vault", main: false },
  ]);
  // only one vault: nothing to pick
  assert.deepEqual(vaultPick({ project: null }, { vault: "/main" }, snap).list, []);
  // a general conversation: the main vault until another is picked, then that one, on this Mac with Claude Code
  assert.deepEqual(
    { ...vaultPick({ project: null }, settings, snap), list: [] },
    { list: [], value: "/main", fixed: false, other: false },
  );
  const picked = { project: null, vault: pickedVault("/shared/team", "/main") };
  assert.deepEqual(
    { ...vaultPick(picked, settings, snap), list: [] },
    { list: [], value: "/shared/team", fixed: false, other: true },
  );
  // the main vault picked again stores nothing
  assert.equal(pickedVault("/main", "/main"), undefined);
  // a project's conversation: its project's vault, fixed, also over a pick left from before it moved there
  assert.deepEqual(
    { ...vaultPick({ project: "Launch Plan" }, settings, snap), list: [] },
    { list: [], value: "/shared/team", fixed: true, other: true },
  );
  assert.equal(chatVault({ project: "Alpha", vault: "/shared/team" }, snap), "/main");
});

test("the workspace shown: the one picked while it is still here, else the main vault", () => {
  const s = { vault: "/main", extraVaults: ["/me/Notes"] };
  assert.equal(activeWorkspace(s, ""), "/main");
  assert.equal(activeWorkspace(s, "/me/Notes"), "/me/Notes");
  // a folder removed since it was picked
  assert.equal(activeWorkspace(s, "/gone"), "/main");
});

test("in a workspace: its own vault's, and the main one keeps what ran in a folder no longer here", () => {
  const s = { vault: "/main", extraVaults: ["/me/Notes"] };
  assert.equal(inWorkspace("/main", "/main", s), true);
  assert.equal(inWorkspace("/me/Notes", "/me/Notes", s), true);
  assert.equal(inWorkspace("/me/Notes", "/main", s), false);
  assert.equal(inWorkspace("/main", "/me/Notes", s), false);
  // a folder removed since: under the main workspace, not under another
  assert.equal(inWorkspace("/gone", "/main", s), true);
  assert.equal(inWorkspace("/gone", "/me/Notes", s), false);
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
