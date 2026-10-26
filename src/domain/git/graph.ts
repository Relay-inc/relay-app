// The Git drawer's log as a graph, as Sourcetree and JetBrains draw it: every commit a dot in a lane, a line down to
// each of its parents. Commits come newest first in topo order (src-tauri/src/git.rs log), so a commit always comes
// before its parents. A lane keeps the commit it waits for until that commit's row; lanes never move sideways, a freed
// lane is taken again by the next branch that needs one.

export type GitCommit = {
  hash: string;
  parents: string[];
  author: string;
  at: number; // unix seconds
  refs: string[]; // "main", "origin/main", "tag: v1"; HEAD's branch first
  head: boolean; // HEAD points here
  subject: string;
};

/** A file a commit changed, against its first parent (src-tauri/src/git.rs show). */
export type CommitFile = { path: string; status: string; add: number; del: number; patch: string; binary: boolean };
/** A commit opened from the log: the row it came from, its whole message and its files, null while loading. */
export type OpenCommit = { repo: string; commit: GitCommit; body: string; files: CommitFile[] | null; err: string };

/** A line in one row, in lane numbers: from (`from`, top or the dot) to (`to`, the dot or the bottom). */
export type Edge = { from: number; to: number; part: "in" | "through" | "out"; lane: number };
export type GraphRow = { commit: GitCommit; lane: number; edges: Edge[]; width: number };

/** The rows of the graph: per commit its lane, the lines through its row and how many lanes the row spans. An edge's
 *  `lane` is the lane whose colour it takes. "in" runs from the top of `from` to the dot, "through" straight down in
 *  `from`, "out" from the dot to the bottom of `to`. */
export function graphRows(commits: GitCommit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const free = () => {
    const i = lanes.indexOf(null);
    return i < 0 ? lanes.length : i;
  };
  return commits.map(commit => {
    const before = [...lanes];
    let lane = before.indexOf(commit.hash);
    if (lane < 0) lane = free();
    const edges: Edge[] = [];
    before.forEach((waits, i) => {
      if (waits === commit.hash) edges.push({ from: i, to: lane, part: "in", lane: i });
      else if (waits !== null) edges.push({ from: i, to: i, part: "through", lane: i });
    });
    // every lane that waited for this commit ends here, its first parent goes on in its lane
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.hash) lanes[i] = null;
    const [first, ...rest] = commit.parents;
    lanes[lane] = first ?? null;
    if (first) edges.push({ from: lane, to: lane, part: "out", lane });
    for (const parent of rest) {
      // a parent another lane already waits for: the line joins that lane, else a free lane takes it
      let at = lanes.indexOf(parent);
      if (at < 0) {
        at = free();
        lanes[at] = parent;
      }
      edges.push({ from: lane, to: at, part: "out", lane: at });
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const width = Math.max(lane + 1, before.length, lanes.length);
    return { commit, lane, edges, width };
  });
}
