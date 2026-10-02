import { test } from "node:test";
import assert from "node:assert/strict";
import { agoParts, conflictPath, excludePath, foldersOf, machinePick, projectChoices } from "./machines.ts";

test("folders: empty rows drop out, paths are trimmed", () => {
  assert.deepEqual(
    foldersOf([
      { project: "Radar", path: " /srv/radar " },
      { project: "", path: "  " },
    ]),
    { Radar: "/srv/radar" },
  );
});
test("folders: a row without a project or with a relative path refuses the save", () => {
  assert.equal(foldersOf([{ project: "", path: "/srv/x" }]), null);
  assert.equal(foldersOf([{ project: "Radar", path: "srv/radar" }]), null);
});
test("a project linked in another row is not offered again", () => {
  const rows = [
    { project: "Radar", path: "/a" },
    { project: "", path: "" },
  ];
  assert.deepEqual(projectChoices(["C-All", "Radar"], rows, rows[1]), ["C-All"]);
  assert.deepEqual(projectChoices(["C-All", "Radar"], rows, rows[0]), ["C-All", "Radar"]);
});

const list = [
  { id: "a", name: "LServer", online: true, default: false },
  { id: "b", name: "docker", online: false, default: true },
];
test("machine pick: the user's, else the project's machine, else this Mac", () => {
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
