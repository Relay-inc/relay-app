// The orchestrator as the backend reports it (src-tauri/src/orch.rs): its workers and the `orch` event.

/** What a worker reported when it ended its turn; `diff` is what Relay read from git itself, not the worker's word. */
export type OrchReport = {
  status: "done" | "blocked" | "failed";
  summary: string;
  questions: string | null;
  diff: string | null;
  flags: string[];
  /** for blocked: the answers the worker offers, as buttons */
  options?: string[];
  /** what Relay read from git per file: path, lines added, lines removed */
  files?: [string, number, number][];
};
/** silent: its turn ended without a report. */
export type WorkerState = "running" | "done" | "blocked" | "failed" | "stopped" | "silent";
export type Worker = {
  key: string; // its conversation key, "c:orch-w-<base36>"
  project: string | null; // the vault project it hangs under, null for Algemeen
  title: string;
  task: string;
  repo: string | null;
  worktree: string | null;
  branch: string | null;
  state: WorkerState;
  at: number; // started, ms
  ended: number | null;
  report: OrchReport | null;
  model?: string;
  /** the user's answer to its blocked report, until its next report */
  answer?: string | null; // what dispatch asked for (fable, opus, sonnet, haiku), "" for the CLI default
  /** its own progress from its `step` tool, while it works: steps done of its plan, the one it is on */
  step?: { done: number; total: number; note: string | null } | null;
  /** a board pipeline's worker: its ticket (domain/pipeline Ticket), the branch its PR goes to, the PR or why there is
   *  none, and what the pipeline last did on the board for it */
  ticket?: unknown;
  base_branch?: string | null;
  pr?: string | null;
  pr_error?: string | null;
  board?: string | null;
  /** while Relay validates a pipeline worker's done: "checks" or "review" (it still counts as running) */
  phase?: string | null;
  rounds?: number;
  review_notes?: string | null;
  /** why a running worker looks stuck (a card nobody answered, no output for a long while), from the backend */
  stalled?: string | null;
};
/** The backend's `orch` event: a worker made or changed, or a user turn Relay wrote into a conversation itself. */
export type OrchEvent = { type: "worker"; worker: Worker } | { type: "sent"; key: string; text: string };
