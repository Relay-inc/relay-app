import type { Item } from "./types";
import type { Side } from "../pull-requests/diff";

// What a conversation changed, as git sees it (src-tauri/src/changes.rs): per repo it wrote in, the working tree
// against the merge base with the default branch. Comments on its lines go back to the agent as one message.

export type ChangedFile = {
  path: string;
  status: "A" | "M" | "D" | "R";
  add: number;
  del: number;
  patch: string;
  binary: boolean;
};
export type RepoChanges = { repo: string; name: string; branch: string; base: string; files: ChangedFile[] };
/** A comment on a changed line, kept until it is sent. */
export type LineComment = {
  id: string;
  repo: string;
  path: string;
  line: number;
  side: Side;
  code: string;
  body: string;
};

export const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** The absolute paths a conversation's file tools wrote to: where to look for its repos. */
export function writtenPaths(items: Item[] | undefined): string[] {
  const paths = (items ?? []).flatMap(item => {
    if (item.kind !== "tool" || !item.tool || !FILE_TOOLS.has(item.tool.name)) return [];
    const input = item.tool.input as { file_path?: unknown; notebook_path?: unknown };
    const path = input.file_path ?? input.notebook_path;
    return typeof path === "string" && path.startsWith("/") ? [path] : [];
  });
  return [...new Set(paths)];
}

/** All files over all repos, and their +/- totals. */
export const totals = (repos: RepoChanges[]) =>
  repos.reduce(
    (sum, repo) => repo.files.reduce((s, f) => ({ files: s.files + 1, add: s.add + f.add, del: s.del + f.del }), sum),
    { files: 0, add: 0, del: 0 },
  );

/** The message the comments become: each with its file and line, the code it is about, then the comment. */
export function commentsMessage(comments: LineComment[], several: boolean): string {
  const lines = comments.map(c => {
    const where = `${several ? `${c.repo}/` : ""}${c.path}:${c.line}${c.side === "LEFT" ? " (removed line)" : ""}`;
    return `- ${where}\n  \`${c.code.trim()}\`\n  ${c.body.trim().replace(/\n/g, "\n  ")}`;
  });
  return `Review comments on your changes:\n\n${lines.join("\n\n")}`;
}
