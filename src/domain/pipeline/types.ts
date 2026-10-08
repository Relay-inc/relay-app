// The board pipeline: Relay picks tickets from one column of a project's board, a worker of the orchestrator builds
// each in its own worktree, Relay opens the PR and moves the ticket on (application/pipeline/runner.ts).

/** A project's pipeline, settings.pipelines[vault project]. The columns are ids in the grouping `group`. */
export type Pipeline = {
  on: boolean;
  /** the checkout the worktrees are made from, an absolute path */
  repo: string;
  /** the branch work starts from and the PR goes to; empty: the remote's default branch */
  base: string;
  /** the board's grouping the columns are in (Productive: "list" or "status"); empty: the provider's first */
  group: string;
  /** tickets here are picked up */
  pick: string;
  /** a picked ticket while its worker runs */
  busy: string;
  /** a ticket with its PR open */
  review: string;
  /** a ticket that needs a person: questions, no PR, a failed run */
  input: string;
  /** a ticket whose PR was merged */
  merged: string;
  /** only tickets with this label are picked; empty: every ticket in the pick column */
  label: string;
  /** workers running at once */
  parallel: number;
  /** Relay's comments on the ticket are internal, kept from the client (Productive); absent: hidden */
  hidden?: boolean;
};

/** What a pipeline worker carries about its ticket (orch.rs keeps it as given). */
export type Ticket = {
  pipeline: string; // the vault project
  provider: string;
  project: string; // the tracker's project
  board: string;
  card: string;
  number: string;
  title: string;
  url: string;
};

/** A PR as orch_pr reads it from gh. */
export type PrStatus = {
  state: "OPEN" | "MERGED" | "CLOSED";
  reviewDecision: string | null;
  reviews: { author: { login: string } | null; body: string; state: string; submittedAt: string }[];
  comments: { author: { login: string } | null; body: string; createdAt: string }[];
  inline: { user: { login: string } | null; body: string; path: string; line: number | null; created_at: string }[];
};

/** Where a worker's end takes its ticket, and what the comment on it says. */
export type Step = {
  mark: string;
  to: "review" | "input" | "merged";
  kind: "pr" | "nopr" | "blocked" | "failed" | "merged" | "closed";
};
