import { test } from "node:test";
import assert from "node:assert/strict";
import { foldersOf, projectChoices } from "./machines.ts";

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
