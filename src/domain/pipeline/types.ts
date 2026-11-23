// The board pipeline: Relay picks tickets from one column of a project's board, a worker of the orchestrator builds
// each in a worktree of every repo of the project, Relay opens a PR in each repo it changed and moves the ticket on
// (application/pipeline/runner.ts).

/** A project's pipeline, settings.pipelines[vault project]. The columns are ids in the grouping `group`. */
export type Pipeline = {
  /** off: Relay leaves the board alone, also ended runs and PRs in review (see paused) */
  on: boolean;
  /** paused from the pipeline panel: no new tickets and nothing picked up again (review comments on a PR wait too,
   *  they would start the worker), while ended runs still land on the board and merges and closes are still followed.
   *  Absent: not paused */
  paused?: boolean;
  /** a checkout picked by hand, an absolute path: for a repo Relay does not find among the project's own (Settings ›
   *  Projects, GitHub repositories), or in place of the one it finds for that repo. Empty: only the project's own */
  repo: string;
  /** per repo of the project, by its GitHub name ("acme/web"): left out of the pipeline, and the command Relay checks
   *  that repo with before it pushes (see checks). Absent: in, without checks */
  repos?: Record<string, { off?: boolean; checks?: string }>;
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
  /** Relay's validation of a done before it pushes (orch.rs validate): a shell command in each worktree the agent
   *  changed (lint, static analysis, tests: now per repo in `repos`, this one only still counts for `repo` when that
   *  has none), a review of each diff by an agent ("" the first that can, a provider id, "off"), and how many times a
   *  failure goes back to the agent before a person gets the ticket */
  checks?: string;
  reviewer?: string;
  rounds?: number;
  /** auto: Relay picks up every ticket in the pick column; manual: only the tickets you start from the ticket window.
   *  Absent: auto */
  mode?: "auto" | "manual";
  /** the agent reports its plan on the ticket first and builds once the ticket comes back to it; absent: off */
  plan?: boolean;
  /** a Claude Code skill the worker follows for the ticket (e.g. ticket-flow:develop), within Relay's own rules; the
   *  skill then judges whether the ticket is ready and whether it needs a plan approved, so Relay's pre-flight and
   *  `plan` are skipped, and with Relay's review on, the skill's own review is skipped. Empty or absent: Relay's flow */
  skill?: string;
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

/** A checkout of a project's repo, as pipeline_repos finds it on this Mac. */
export type PipelineRepo = { slug: string; path: string };

/** A PR as orch_pr reads it from gh, one per repo the worker opened one in. */
export type PrStatus = {
  url: string;
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
  /** partial: PRs in some repos, a repo it changed got none */
  kind: "pr" | "partial" | "nopr" | "blocked" | "failed" | "merged" | "closed";
};
