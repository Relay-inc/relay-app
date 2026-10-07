import { test } from "node:test";
import assert from "node:assert/strict";
import { fileTree, type TreeNode } from "./tree.ts";

const show = (nodes: TreeNode[]): string[] =>
  nodes.flatMap(n =>
    n.kind === "file" ? [`${n.name}#${n.index}`] : [`${n.name}/`, ...show(n.children).map(s => `  ${s}`)],
  );

test("folders first, single-folder chains joined, files keep their index", () => {
  const paths = ["src/auth/session.ts", "README.md", "src/auth/callback.ts", "src/long.ts", "assets/img/logo.png"];
  assert.deepEqual(show(fileTree(paths.map((path, index) => ({ path, index })))), [
    "assets/img/",
    "  logo.png#4",
    "src/",
    "  auth/",
    "    callback.ts#2",
    "    session.ts#0",
    "  long.ts#3",
    "README.md#1",
  ]);
});
