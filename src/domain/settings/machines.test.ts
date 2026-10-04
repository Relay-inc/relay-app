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
