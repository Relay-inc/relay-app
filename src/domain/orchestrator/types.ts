// The orchestrator as the backend reports it (src-tauri/src/orch.rs): its workers and the `orch` event.

/** What a worker reported when it ended its turn; `diff` is what Relay read from git itself, not the worker's word. */
export type OrchReport = {
  status: "done" | "blocked" | "failed";
  summary: string;
  questions: string | null;
  diff: string | null;
  flags: string[];
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
};
/** The backend's `orch` event: a worker made or changed, or a user turn Relay wrote into a conversation itself. */
export type OrchEvent = { type: "worker"; worker: Worker } | { type: "sent"; key: string; text: string };
