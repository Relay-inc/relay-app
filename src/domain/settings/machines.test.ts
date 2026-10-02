import { test } from "node:test";
import assert from "node:assert/strict";
import { foldersOf, machinePick, projectChoices } from "./machines.ts";

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
