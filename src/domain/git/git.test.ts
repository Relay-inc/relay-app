import { test } from "node:test";
import assert from "node:assert/strict";
import { commentsMessage, stagedDiff, worksIn, writtenPaths, type GitRepo } from "./git.ts";
import type { Item } from "../conversations/types.ts";

const tool = (name: string, input: Record<string, unknown>): Item =>
  ({ kind: "tool", text: "", tool: { name, input } }) as Item;

test("writtenPaths keeps the absolute paths of file tools, once each", () => {
  const items: Item[] = [
    tool("Edit", { file_path: "/p/a.ts" }),
    tool("Write", { file_path: "/p/a.ts" }),
    tool("NotebookEdit", { notebook_path: "/p/n.ipynb" }),
    tool("Read", { file_path: "/p/r.ts" }),
    tool("Edit", { file_path: "relative.ts" }),
    { kind: "me", text: "hi" },
  ];
  assert.deepEqual(writtenPaths(items), ["/p/a.ts", "/p/n.ipynb"]);
  assert.deepEqual(writtenPaths(undefined), []);
});

test("worksIn sees a tool call that names the checkout, not one next to it", () => {
  const items = [tool("Bash", { command: "cd /p/apple && git status" })];
  assert.equal(worksIn(items, "/p/apple"), true);
  assert.equal(worksIn([tool("Edit", { file_path: "/p/apple/src/a.ts" })], "/p/apple"), true);
  assert.equal(worksIn([tool("Bash", { command: "ls /p/apple-trees" })], "/p/apple"), false);
  assert.equal(worksIn([{ kind: "me", text: "/p/apple" }], "/p/apple"), false);
  assert.equal(worksIn(undefined, "/p/apple"), false);
});

test("stagedDiff holds only the staged files, cut at the limit", () => {
  const f = (path: string, staged: boolean) => ({
    path,
    orig: null,
    status: "M",
    staged,
    untracked: false,
    add: 1,
    del: 0,
    patch: "@@ -1 +1 @@\n+x",
    binary: false,
  });
  const repo: GitRepo = {
    repo: "/r",
    name: "r",
    branch: "main",
    upstream: "",
    ahead: 0,
    behind: 0,
    made: false,
    files: [f("a.ts", true), f("b.ts", false)],
  };
  assert.equal(stagedDiff(repo, 1000), "--- a.ts (M)\n@@ -1 +1 @@\n+x");
  assert.equal(stagedDiff(repo, 5), "--- a\n…");
});

test("commentsMessage names the file, line and code of each comment", () => {
  const msg = commentsMessage(
    [
      { id: "1", repo: "app", path: "src/a.ts", line: 4, side: "RIGHT", code: "  const x = 1;", body: "rename x" },
      { id: "2", repo: "app", path: "src/b.ts", line: 9, side: "LEFT", code: "old()", body: "why\nremoved?" },
    ],
    false,
  );
  assert.equal(
    msg,
    "Review comments on your changes:\n\n- src/a.ts:4\n  `const x = 1;`\n  rename x\n\n- src/b.ts:9 (removed line)\n  `old()`\n  why\n  removed?",
  );
  assert.match(
    commentsMessage([{ id: "1", repo: "app", path: "a", line: 1, side: "RIGHT", code: "", body: "b" }], true),
    /- app\/a:1/,
  );
});
