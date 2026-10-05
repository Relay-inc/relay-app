/** A PR's changed files as a tree, the way GitHub shows them: folders first, then files, each by name, and a folder
 *  with only one folder in it joined with it ("src/auth"). `index` points back into the list it was built from. */
export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string; index: number };

export function fileTree(files: { path: string; index: number }[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let level = root;
    parts.slice(0, -1).forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let dir = level.find((n): n is Extract<TreeNode, { kind: "dir" }> => n.kind === "dir" && n.name === name);
      if (!dir) level.push((dir = { kind: "dir", name, path, children: [] }));
      level = dir.children;
    });
    level.push({ kind: "file", name: parts[parts.length - 1], path: file.path, index: file.index });
  }
  return tidy(root);
}

function tidy(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map(node => {
      if (node.kind === "file") return node;
      let dir = { ...node, children: tidy(node.children) };
      while (dir.children.length === 1 && dir.children[0].kind === "dir") {
        const only = dir.children[0];
        dir = { ...only, name: `${dir.name}/${only.name}` };
      }
      return dir;
    })
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}
