import { test } from "node:test";
import assert from "node:assert/strict";
import { findPages, isSystemPage, pagesModel, pageTree, placeOf, recentPages, sortPages, typedTree } from "./pages.ts";

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

test("a workspace's own contexts show without a project, after the ordered ones, with the folder of their note", () => {
  const model = pagesModel(
    [...paths, "Contexts/Agency/Agency.md", "Contexts/Home/Home.md"],
    [{ key: "Beacon", name: "Beacon", label: "Beacon", context: "Agency" }],
    ["Agency"],
    ["Home", "Agency"],
  );
  assert.deepEqual(
    model.contexts.map(context => [context.name, context.index, context.folder, context.projects.length]),
    [
      ["Agency", 0, "Contexts/Agency", 1],
      ["Home", 1, "Contexts/Home", 0],
    ],
  );
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

test("a note taken off Recent stays off until a conversation touches it again", () => {
  const touch = (path: string, at: number) => ({ root: "/v", path, at });
  const touches = [touch("README.md", 5), touch("Calendar/2026-10-01.md", 3)];
  const removed = { "README.md": 5 };
  assert.deepEqual(
    recentPages(touches, "/v", () => true, 5, removed),
    ["Calendar/2026-10-01.md"],
  );
  assert.deepEqual(
    recentPages([...touches, touch("README.md", 9)], "/v", () => true, 5, removed),
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

test("a folder lists its notes by name or the last changed first", () => {
  const list = ["B.md", "A.md", "C.md"];
  assert.deepEqual(sortPages(list, "name", {}), list);
  assert.deepEqual(sortPages(list, "modified", { "A.md": 5, "C.md": 9 }), ["C.md", "A.md", "B.md"]);
});

test("a new note's place: the project whose folder it is asked in, and that project's context", () => {
  const model = pagesModel(paths, [{ key: "Beacon", name: "Beacon", label: "Beacon", context: "Agency" }], ["Agency"]);
  assert.deepEqual(placeOf(model, "Contexts/Agency/Portfolio/Beacon/Documents"), {
    folder: "Contexts/Agency/Portfolio/Beacon/Documents",
    about: "Beacon",
    context: "Agency",
  });
  assert.deepEqual(placeOf(model, "Calendar"), { folder: "Calendar", about: "", context: "" });
});

test("the tree by type: a project's notes by folder or about:, a context's by context:, the rest loose, no type Unsorted", () => {
  const notes = [
    ...paths,
    "Contexts/Agency/Agency.md",
    "Calendar/Meetings/2026/2026-10-02 Beacon sync.md",
    "Calendar/Meetings/2026/2026-10-03 Agency review.md",
    "Inbox/Loose idea.md",
    "Inbox/Older idea.md",
    "Resources/Templates/Meeting.md",
  ];
  const model = pagesModel(notes, [{ key: "Beacon", name: "Beacon", label: "Beacon", context: "Agency" }], ["Agency"]);
  const row = (p: string, k: string, at: number, props: Record<string, string[]> = {}) => ({ p, k, at, props });
  const tree = typedTree(
    model,
    [
      row("Contexts/Agency/Portfolio/Beacon/Beacon.md", "Project", 9),
      row("Contexts/Agency/Agency.md", "Context", 9),
      row("Contexts/Agency/Portfolio/Beacon/Documents/Spec.md", "document", 1),
      row("Contexts/Agency/Portfolio/Beacon/Log.md", "", 2),
      row("Calendar/Meetings/2026/2026-10-02 Beacon sync.md", "Meeting", 3, { about: ["Beacon"], context: ["Agency"] }),
      row("Calendar/Meetings/2026/2026-10-03 Agency review.md", "Meeting", 4, { context: ["Agency"] }),
      row("Contexts/Agency/Portfolio/Flat.md", "Recipe", 5),
      row("Calendar/2026-10-01.md", "Daily", 6),
      row("README.md", "", 1),
      row("Inbox/Loose idea.md", "", 8),
      row("Inbox/Older idea.md", "", 7),
      row("Resources/Templates/Meeting.md", "", 9),
    ],
    ["Meeting", "Document", "Daily"],
  );
  assert.deepEqual(tree.projects.Beacon, [
    { type: "Meeting", notes: ["Calendar/Meetings/2026/2026-10-02 Beacon sync.md"] },
    { type: "Document", notes: ["Contexts/Agency/Portfolio/Beacon/Documents/Spec.md"] },
  ]);
  // in the context by its context: (the meeting), or by its folder (no context: given); a type the registry lacks last
  assert.deepEqual(tree.contexts.Agency, [
    { type: "Meeting", notes: ["Calendar/Meetings/2026/2026-10-03 Agency review.md"] },
    { type: "Recipe", notes: ["Contexts/Agency/Portfolio/Flat.md"] },
  ]);
  assert.deepEqual(tree.loose, [{ type: "Daily", notes: ["Calendar/2026-10-01.md"] }]);
  // newest first, inside a project's folder too; the vault's own notes (templates) not
  assert.deepEqual(tree.unsorted, [
    "Inbox/Loose idea.md",
    "Inbox/Older idea.md",
    "Contexts/Agency/Portfolio/Beacon/Log.md",
    "README.md",
  ]);
});
