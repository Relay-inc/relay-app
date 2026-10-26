import type { Item } from "../conversations/types";
import type { Side } from "../pull-requests/diff";

// The Git drawer of a project, as git sees it (src-tauri/src/git.rs): per checkout, what git status says changed,
// each file's diff against HEAD, staged or not. Comments on its lines go back to the agent as one message.

export type GitFile = {
  path: string;
  orig: string | null; // where a rename came from
  status: string; // git's letter: M, A, D, R, C, T, U (a conflict), ? (not tracked)
  staged: boolean;
  untracked: boolean;
  add: number;
  del: number;
  patch: string;
  binary: boolean;
};
export type GitRepo = {
  repo: string; // the checkout's top, absolute
  name: string;
  branch: string;
  upstream: string; // "" when the branch has none: a push sets it
  ahead: number;
  behind: number;
  made: boolean; // a worktree the open conversation made
  files: GitFile[];
  err?: string; // git could not read it
};
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

/** The absolute paths a conversation's file tools wrote to: a hint in the drawer, git decides what changed. */
export function writtenPaths(items: Item[] | undefined): string[] {
  const paths = (items ?? []).flatMap(item => {
    if (item.kind !== "tool" || !item.tool || !FILE_TOOLS.has(item.tool.name)) return [];
    const input = item.tool.input as { file_path?: unknown; notebook_path?: unknown };
    const path = input.file_path ?? input.notebook_path;
    return typeof path === "string" && path.startsWith("/") ? [path] : [];
  });
  return [...new Set(paths)];
}

/** Whether a conversation works in checkout `repo`: one of its tool calls names the folder (an edit in it, a `cd` or
 *  `git -C` there). Committing then would take its half-done work. */
export function worksIn(items: Item[] | undefined, repo: string): boolean {
  const named = new RegExp(`${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`);
  return (items ?? []).some(item => item.kind === "tool" && !!item.tool && named.test(JSON.stringify(item.tool.input)));
}

/** The message the comments become: each with its file and line, the code it is about, then the comment. */
export function commentsMessage(comments: LineComment[], several: boolean): string {
  const lines = comments.map(c => {
    const where = `${several ? `${c.repo}/` : ""}${c.path}:${c.line}${c.side === "LEFT" ? " (removed line)" : ""}`;
    return `- ${where}\n  \`${c.code.trim()}\`\n  ${c.body.trim().replace(/\n/g, "\n  ")}`;
  });
  return `Review comments on your changes:\n\n${lines.join("\n\n")}`;
}

/** What the model reads to suggest a commit message: the staged files' diffs, cut at `max` characters. */
export function stagedDiff(repo: GitRepo, max: number): string {
  const text = repo.files
    .filter(f => f.staged)
    .map(f => `--- ${f.path} (${f.status})\n${f.binary ? "(binary)" : f.patch}`)
    .join("\n\n");
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}
