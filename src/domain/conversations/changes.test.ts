import { test } from "node:test";
import assert from "node:assert/strict";
import { commentsMessage, totals, writtenPaths, type RepoChanges } from "./changes.ts";
import type { Item } from "./types.ts";

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

test("totals add up every repo", () => {
  const f = (add: number, del: number) => ({ path: "x", status: "M" as const, add, del, patch: "", binary: false });
  const repos: RepoChanges[] = [
    { repo: "/a", name: "a", branch: "b", base: "HEAD", files: [f(1, 2), f(3, 0)] },
    { repo: "/c", name: "c", branch: "b", base: "HEAD", files: [f(5, 5)] },
  ];
  assert.deepEqual(totals(repos), { files: 3, add: 9, del: 7 });
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
