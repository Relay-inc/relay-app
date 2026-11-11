import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agoParts,
  conflictPath,
  excludePath,
  machinePick,
  setupCommands,
  SETUP_FOLDERS,
  newerVersion,
  repoState,
  repoWorkOf,
  snapshotBranch,
  vaultsByMachine,
} from "./machines.ts";

const list = [
  { id: "a", name: "LServer", online: true, default: false },
  { id: "b", name: "docker", online: false, default: true },
];
test("machine pick: the user's, else the default machine, else this Mac", () => {
  assert.equal(machinePick(list, "a", true), "a");
  assert.equal(machinePick(list, "", true), "");
  assert.equal(machinePick(list, undefined, true), "b");
  assert.equal(machinePick(list, "gone", true), "b", "a machine forgotten since reads as the default");
  assert.equal(machinePick([{ ...list[0] }], undefined, true), "");
});
test("machine pick: this Mac only for another agent or a mail, nothing without machines", () => {
  assert.equal(machinePick(list, "a", false), "");
  assert.equal(machinePick([], "a", true), null);
  assert.equal(machinePick(undefined, undefined, true), null);
});

test("exclude: trimmed, trailing slash dropped, nested paths kept", () => {
  assert.equal(excludePath("  Contexts/Personal/ "), "Contexts/Personal");
});
test("exclude: empty, absolute and climbing paths are refused", () => {
  for (const bad of ["", "  ", "/etc", "../x", "a/../b", "a//b"]) assert.equal(excludePath(bad), null);
});
test("ago: picks the unit, never in the future", () => {
  assert.equal(agoParts(0), null);
  assert.deepEqual(agoParts(1000, 1_030_000), { value: -30, unit: "second" });
  assert.deepEqual(agoParts(1000, 1_000_000 + 600_000), { value: -10, unit: "minute" });
  assert.deepEqual(agoParts(1000, 1_000_000 + 2 * 3600_000), { value: -2, unit: "hour" });
  assert.deepEqual(agoParts(1000, 1_000_000 + 3 * 86400_000), { value: -3, unit: "day" });
  assert.deepEqual(agoParts(2000, 1_000_000), { value: -0, unit: "second" });
});
test("conflict path loses its vault/ prefix", () => {
  assert.equal(conflictPath("vault/Notes/a (conflict).md"), "Notes/a (conflict).md");
});

test("setup: the image of this version, the folders under the one given", () => {
  const c = setupCommands("ghcr.io/x/relay-server", "0.3.0", "/srv/relay/", "unraid");
  assert.match(
    c.install,
    /^mkdir -p \/srv\/relay\/data \/srv\/relay\/claude \/srv\/relay\/repos \/srv\/relay\/local\nchown -R 1000:1000 \/srv\/relay\n/,
  );
  assert.match(c.install, /-v \/srv\/relay\/local:\/home\/relay\/.local \\\n {2}ghcr.io\/x\/relay-server:0.3.0$/);
  assert.match(c.update, /^docker pull ghcr.io\/x\/relay-server:0.3.0\ndocker rm -f relay-server\ndocker run /);
});
test("setup: an empty folder is the default, one with a space is quoted", () => {
  assert.ok(setupCommands("i", "1", " ", "linux").install.includes(`${SETUP_FOLDERS.linux}/data`));
  assert.ok(
    setupCommands("i", "1", "/mnt/my disk", "unraid").install.includes('-v "/mnt/my disk/data:/home/relay/data"'),
  );
});
test("setup: a Mac skips chown and keeps ~ outside the quotes, Linux makes the folders with sudo", () => {
  const mac = setupCommands("i", "1", "~/my relay", "mac");
  assert.match(mac.install, /^mkdir -p ~\/"my relay\/data" /);
  assert.ok(!mac.install.includes("chown"));
  assert.ok(setupCommands("i", "1", "", "mac").install.includes("-v ~/relay-server/data:/home/relay/data"));
  assert.match(
    setupCommands("i", "1", "", "linux").install,
    /^sudo mkdir -p .*\nsudo chown -R 1000:1000 \/srv\/relay-server\n/,
  );
});
test("setup: the pairing line looks up the machine's own LAN address", () => {
  assert.match(setupCommands("i", "1", "", "mac").pair, /--host "\$\(ipconfig getifaddr en0/);
  assert.match(setupCommands("i", "1", "", "unraid").pair, /--host "\$\(ip route get 1 /);
});

test("versions compare by number, not as text", () => {
  assert.ok(newerVersion("0.0.10", "0.0.9"));
  assert.ok(newerVersion("0.0.5", "0.0.4"));
  assert.ok(!newerVersion("0.0.4", "0.0.4"));
  assert.ok(!newerVersion("0.0.4", "0.1.0"));
});

test("a repo's state: commits not pushed, work not committed, or clean", () => {
  assert.deepEqual(repoState({ dirty: false, unpushed: 0 }), [{ key: "mc.repoClean" }]);
  assert.deepEqual(repoState({ dirty: false, unpushed: 2 }), [{ key: "mc.repoUnpushed", n: 2 }]);
  assert.deepEqual(repoState({ dirty: true, unpushed: 1 }), [
    { key: "mc.repoUnpushed", n: 1 },
    { key: "mc.repoDirty" },
  ]);
});
test("a machine's snapshot branch is its name as a slug, as the backend makes it", () => {
  assert.equal(snapshotBranch("Server", "a1b2"), "relay/server");
  assert.equal(snapshotBranch("  My Server 2 ", "a1b2"), "relay/my-server-2");
  assert.equal(snapshotBranch("NAS / Büro", "a1b2"), "relay/nas-b-ro");
  assert.equal(snapshotBranch("--", "a1b2"), "relay/a1b2");
});
test("a refused move names the repo work it would leave behind", () => {
  const work = { repo: "acme/shop", name: "shop", branch: "relay/server", machine: "Server" };
  assert.deepEqual(repoWorkOf(`repo-work:${JSON.stringify(work)}`), work);
  assert.equal(repoWorkOf("Work machine unreachable: timeout"), null);
  assert.equal(repoWorkOf("repo-work:{broken"), null);
});

test("shared vaults go under the machine whose fingerprint pins their server, the rest to the members' section", () => {
  const fp = (c: string) => c.repeat(64);
  const studio = { id: "m1", name: "Studio Mac", host: "192.168.1.2", port: 47800, fp: fp("a"), sharedOnly: true };
  const server = { id: "m2", name: "Server", host: "192.168.1.3", port: 47800, fp: fp("b") };
  const vault = (id: string, fp: string, host = "192.168.1.2") => ({
    id,
    name: `Team vault ${id}`,
    host,
    port: 47800,
    fp,
    folder: `/Users/me/${id}`,
    role: "admin" as const,
  });
  const made = vault("v1", fp("a"));
  const second = vault("v2", fp("A")); // the same fingerprint in capitals
  const joined = vault("v3", fp("c"));
  // the same address as Studio Mac but another server: the fingerprint decides, not the host
  const moved = vault("v4", fp("d"));
  const { on, elsewhere } = vaultsByMachine([studio, server], [made, joined, second, moved]);
  assert.deepEqual(on, { m1: [made, second], m2: [] });
  assert.deepEqual(elsewhere, [joined, moved]);
  // a member with no machines sees every vault in the section, and an empty fingerprint never matches
  assert.deepEqual(vaultsByMachine([], [made]), { on: {}, elsewhere: [made] });
  assert.equal(vaultsByMachine([{ ...server, fp: "" }], [vault("v5", "")]).elsewhere.length, 1);
});
