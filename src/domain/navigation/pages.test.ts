import { test } from "node:test";
import assert from "node:assert/strict";
import { findPages, isSystemPage, pagesModel, pageTree, recentPages } from "./pages.ts";

const paths = [
  "Contexts/Agency/Portfolio/Beacon/Beacon.md",
  "Contexts/Agency/Portfolio/Beacon/Documents/Spec.md",
  "Contexts/Agency/Portfolio/Beacon/Log.md",
  "Contexts/Agency/Portfolio/Flat.md",
  "Calendar/2026-10-01.md",
  "README.md",
];

test("the tree counts every note below a folder and sorts by name", () => {
  const root = pageTree(paths);
  assert.equal(root.count, 6);
  assert.deepEqual(
    root.folders.map(folder => [folder.name, folder.count]),
    [
      ["Calendar", 1],
      ["Contexts", 4],
    ],
  );
  assert.deepEqual(root.notes, ["README.md"]);
});

test("a project is the folder named like its note, else just its note; a project without a note is left out", () => {
  const model = pagesModel(
    paths,
    [
      { key: "Beacon", name: "Beacon", label: "Beacon", context: "Agency" },
      { key: "Flat\u001fx", name: "Flat", label: "Flat (team)", context: "Agency" },
      { key: "Ghost", name: "Ghost", label: "Ghost", context: "Agency" },
      { key: "Other", name: "Other", label: "Other", context: "Home" },
    ],
    ["Home", "Agency"],
  );
  assert.equal(model.contexts.length, 1);
  const [beacon, flat] = model.contexts[0].projects;
  assert.equal(beacon.folder?.path, "Contexts/Agency/Portfolio/Beacon");
  assert.equal(beacon.count, 3);
  assert.equal(flat.note, "Contexts/Agency/Portfolio/Flat.md");
  assert.equal(flat.folder, null);
  assert.equal(flat.count, 1);
});

test("the search matches note names, the recent notes are this workspace's, newest first, once", () => {
  assert.deepEqual(findPages(paths, "spec"), ["Contexts/Agency/Portfolio/Beacon/Documents/Spec.md"]);
  const touches = [
    { root: "/v", path: "README.md", at: 1 },
    { root: "/v", path: "Calendar/2026-10-01.md", at: 3 },
    { root: "/other", path: "README.md", at: 5 },
    { root: "/v", path: "README.md", at: 4 },
    { root: "/v", path: "Gone.md", at: 9 },
  ];
  assert.deepEqual(
    recentPages(touches, "/v", path => paths.includes(path)),
    ["README.md", "Calendar/2026-10-01.md"],
  );
});

test("the notes the vault runs on are system pages, the ones people write in are not", () => {
  for (const path of [
    "CLAUDE.md",
    "AGENTS.md",
    "System/rules/core/memory.md",
    "scripts/x.md",
    "Resources/Meta/Claude/a.md",
    "Resources/Templates/Meeting.md",
  ])
    assert.equal(isSystemPage(path), true, path);
  for (const path of ["README.md", "Resources/Reference/Article.md", "Contexts/Work/CLAUDE.md", "Systems.md"])
    assert.equal(isSystemPage(path), false, path);
});
