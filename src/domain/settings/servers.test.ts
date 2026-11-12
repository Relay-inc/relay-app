import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invitePlan,
  ORG_SETUP_DEFAULTS,
  orgDisplayName,
  orgInstallCommands,
  orgServerCommands,
  orgTabs,
  parseEmails,
  recogniseLine,
  resolveItem,
  setupChecklist,
  workspacesOf,
} from "./servers.ts";
import type { TeamOverview } from "./types.ts";

const overview = (): TeamOverview => ({
  accounts: [
    { email: "a@example.com", admin: true, off: false, devices: 2 },
    { email: "b@example.com", admin: false, off: false, devices: 1 },
    { email: "c@example.com", admin: true, off: true, devices: 0 },
  ],
  workspaces: [
    { id: "w1", name: "Handbook", nohistory: false, members: { "a@example.com": "admin", "b@example.com": "admin" } },
    { id: "w2", name: "Clients", nohistory: false, members: { "a@example.com": "admin", "b@example.com": "reader" } },
    { id: "w3", name: "Old", nohistory: true, members: { "c@example.com": "admin", "b@example.com": "admin" } },
  ],
  invites: [{ id: "i1", email: "new@example.com", expires: 100 }],
  sso: null,
});

test("org name: the host until the server has a name", () => {
  assert.equal(orgDisplayName({ host: "relay.example.com" }), "relay.example.com");
});

test("checklist: a turned-off admin does not count as the second one", () => {
  const items = setupChecklist(overview());
  assert.deepEqual(items[0], { kind: "admins", done: false, admins: ["a@example.com"] });
  assert.deepEqual(items[1], { kind: "signin", done: false });
});
test("checklist: workspaces with one admin that is on, then the open invites", () => {
  const items = setupChecklist(overview()).slice(2);
  assert.deepEqual(items, [
    {
      kind: "alone",
      done: false,
      workspaces: [
        { id: "w2", name: "Clients", admin: "a@example.com" },
        { id: "w3", name: "Old", admin: "b@example.com" },
      ],
    },
    { kind: "invite", done: false, id: "i1", email: "new@example.com", expires: 100 },
  ]);
});
test("checklist: sign-in and a second admin done", () => {
  const o = overview();
  o.sso = { issuer: "https://accounts.google.com", client: "x", domains: ["example.com"] };
  o.accounts[1].admin = true;
  const items = setupChecklist(o);
  assert.equal(items[0].done, true);
  assert.equal(items[1].done, true);
});

test("workspaces of an account, with its role", () => {
  assert.deepEqual(workspacesOf(overview(), "b@example.com"), [
    { id: "w1", name: "Handbook", role: "admin" },
    { id: "w2", name: "Clients", role: "reader" },
    { id: "w3", name: "Old", role: "admin" },
  ]);
});

test("emails: split on commas, spaces and lines, lower case, each once", () => {
  assert.deepEqual(parseEmails(" Nina@Example.com, jo@example.com\njo@example.com; <lee@example.com>"), {
    good: ["nina@example.com", "jo@example.com", "lee@example.com"],
    bad: [],
  });
});
test("emails: what the server refuses is set apart", () => {
  assert.deepEqual(parseEmails("plain, @example.com, a@b@c, x@"), {
    good: [],
    bad: ["plain", "@example.com", "a@b@c", "x@"],
  });
  assert.deepEqual(parseEmails("  \n "), { good: [], bad: [] });
});

test("invite plan: a new address gets a link, then its workspaces", () => {
  assert.deepEqual(invitePlan(overview(), ["new2@example.com"], false, { w1: "reader", w2: "member" }), [
    { op: "invite", email: "new2@example.com", admin: false },
    { op: "member", email: "new2@example.com", vault: "w1", role: "reader" },
    { op: "member", email: "new2@example.com", vault: "w2", role: "member" },
  ]);
});
test("invite plan: an existing account gets no link, keeps a role it has, and is made admin only when asked", () => {
  assert.deepEqual(invitePlan(overview(), ["b@example.com"], true, { w2: "member", w3: "reader" }), [
    { op: "admin", email: "b@example.com" },
  ]);
  assert.deepEqual(invitePlan(overview(), ["a@example.com"], true, { w3: "member" }), [
    { op: "member", email: "a@example.com", vault: "w3", role: "member" },
  ]);
});
test("invite plan: an organisation admin by invite", () => {
  assert.deepEqual(invitePlan(overview(), ["z@example.com"], true, {}), [
    { op: "invite", email: "z@example.com", admin: true },
  ]);
});

test("picked item: kept while there, else the first organisation, else Add a server", () => {
  const teams = [{ fp: "f1" }, { fp: "f2" }];
  assert.equal(resolveItem("org:f2", teams), "org:f2");
  assert.equal(resolveItem("org:gone", teams), "org:f1");
  assert.equal(resolveItem("", []), "add");
  assert.equal(resolveItem("add", teams), "add");
  const machines = [{ id: "m1" }];
  assert.equal(resolveItem("machine:m1", teams, machines), "machine:m1");
  assert.equal(resolveItem("machine:gone", [], machines), "machine:m1");
  assert.equal(resolveItem("mac", [], []), "mac");
  assert.equal(resolveItem("setup", [], [], true), "setup");
  assert.equal(resolveItem("setup", [], [], false), "add");
});
test("tabs: a member sees Overview and Workspaces", () => {
  assert.deepEqual(orgTabs(false), ["overview", "workspaces"]);
  assert.equal(orgTabs(true).length, 5);
});

test("organisation server: the image tag of this Relay, the cron line as the docs have it", () => {
  const c = orgServerCommands("ghcr.io/relay-inc/relay-server", "0.0.52");
  assert.equal(c.env, "RELAY_SERVER_IMAGE=ghcr.io/relay-inc/relay-server:0.0.52");
  assert.equal(c.update, "docker compose pull && docker compose up -d --wait");
  assert.equal(c.cron, "30 3 * * * cd /opt/relay-server && ./backup.sh backup /mnt/backup/relay-$(date +\\%u).tar.gz");
  assert.match(orgServerCommands("i", "1", "/srv/relay/").cron, /cd \/srv\/relay &&/);
});

const FP = "ab".repeat(32);
test("pasted line: an organisation's invite, its sign-in link, a workspace invite, a pairing line", () => {
  const at = { host: "relay.example.com", port: 47800 };
  assert.deepEqual(
    recogniseLine(` relay://relay.example.com:47800#team&fp=${FP}&invite=${"1".repeat(16)}&code=${"c".repeat(64)} `),
    { kind: "team-invite", ...at },
  );
  assert.deepEqual(recogniseLine(`relay://relay.example.com:47800#team&fp=${FP}`), { kind: "team-signin", ...at });
  assert.deepEqual(
    recogniseLine(
      `relay://relay.example.com:47800#fp=${FP}&code=${"d".repeat(32)}&vault=${"2".repeat(16)}&invite=${"3".repeat(16)}&secret=${"e".repeat(64)}`,
    ),
    { kind: "workspace", ...at },
  );
  assert.deepEqual(recogniseLine(`relay://192.168.1.2:47800#fp=${FP}&code=${"d".repeat(32)}`), {
    kind: "pairing",
    host: "192.168.1.2",
    port: 47800,
  });
  assert.deepEqual(recogniseLine(`relay://[fd00::2]:47800#fp=${FP}&code=${"d".repeat(32)}`)?.host, "fd00::2");
});
test("pasted line: anything else is not recognised", () => {
  for (const bad of [
    "",
    "https://example.com",
    `relay://relay.example.com#team&fp=${FP}`, // no port
    `relay://relay.example.com:47800#team&fp=short`,
    `relay://relay.example.com:47800#team&fp=${FP}&invite=${"1".repeat(16)}`, // an invite without its code
    `relay://relay.example.com:47800#fp=${FP}&code=${"d".repeat(31)}`,
    `relay://relay.example.com:47800#fp=${FP}&code=${"d".repeat(32)}&key=${"e".repeat(64)}&link=${"f".repeat(64)}`, // a phone's
    `relay://bad host:47800#fp=${FP}&code=${"d".repeat(32)}`,
  ])
    assert.equal(recogniseLine(bad), null, bad);
});

test("organisation install: the docs' commands with the address, admin, folder and network filled in", () => {
  const c = orgInstallCommands({
    host: "relay.example.com",
    admin: "alex@example.com",
    folder: "/opt/relay-server/",
    network: "192.168.1.0/24",
  });
  assert.match(
    c.install,
    /^sudo mkdir -p \/opt\/relay-server && sudo chown "\$USER" \/opt\/relay-server && cd \/opt\/relay-server\n/,
  );
  assert.match(c.install, /docker compose up -d --wait$/);
  assert.equal(c.port, "ufw allow from 192.168.1.0/24 to any port 47800 proto tcp");
  assert.equal(c.team, "docker compose exec relay-server relay-server team alex@example.com --host relay.example.com");
  assert.match(c.cron, /cd \/opt\/relay-server &&/);
});
test("organisation install: odd values are quoted, empty ones fall back to examples", () => {
  const c = orgInstallCommands({ host: "", admin: "a b@example.com", folder: "/srv/my relay", network: "" });
  assert.match(c.install, /cd "\/srv\/my relay"/);
  assert.equal(c.team, 'docker compose exec relay-server relay-server team "a b@example.com" --host relay.example.com');
  assert.match(c.port, /^ufw allow from 192\.168\.1\.0\/24 /);
  assert.match(orgInstallCommands({ ...ORG_SETUP_DEFAULTS, folder: "/x/$(rm)" }).install, /"\/x\/\\\$\(rm\)"/);
});
