// The orchestrator (?fixture=orch): the coordinator's conversation "c:orch" and its workers as `orch_workers` returns
// them (src-tauri/src/orch.rs), their transcripts, and the live `orch` events of a worker that reports.
import { NOW, iso } from "./util";

type Ev = Record<string, unknown> & { type: string };
type Report = {
  status: string;
  summary: string;
  questions: string | null;
  diff: string | null;
  flags: string[];
  options?: string[];
  files?: [string, number, number][];
};
export type Worker = {
  key: string;
  project: string | null;
  title: string;
  task: string;
  repo: string | null;
  worktree: string | null;
  branch: string | null;
  state: string;
  at: number;
  ended: number | null;
  report: Report | null;
  model?: string;
  step?: { done: number; total: number; note: string | null } | null;
  /** its `decision` trail over its whole life, oldest first: what it chose, why, a pointer to the evidence, the result */
  decisions?: { at: number; decision: string; why: string; evidence: string | null; result: string | null }[];
  answer?: string | null;
  stalled?: string | null;
};

export const ORCH = "c:orch";
const MIN = 60000;
const user = (text: string): Ev => ({ type: "user", text, images: [] });
const ai = (text: string): Ev => ({ type: "text", text, delta: false });
const time = (ms: number): Ev => ({ type: "time", at: iso(ms) });

const running: Worker = {
  key: "c:orch-w-a1",
  project: "Northwind Portal",
  title: "Fix the login redirect",
  task: "Find why SSO logins loop back to /login on staging and fix it on a branch, with a test.",
  repo: "/Users/demo/code/northwind",
  worktree: "/Users/demo/code/northwind-relay-a1",
  branch: "relay/fix-the-login-redirect-a1",
  state: "running",
  at: NOW - 100 * MIN,
  ended: null,
  report: null,
  model: "opus",
  step: { done: 2, total: 5, note: "Writing the redirect test" },
  decisions: [
    {
      at: NOW - 92 * MIN,
      decision: "Fix the cookie domain, not the redirect loop guard",
      why: "The loop only happens when the session cookie is set for the wrong host; a guard would hide it",
      evidence: "src/auth/session.ts:41",
      result: "open",
    },
    {
      at: NOW - 70 * MIN,
      decision: "Reproduce with a failing test first",
      why: "No test covers the SSO callback, so the fix needs one to stay fixed",
      evidence: "tests/auth/redirect.test.ts",
      result: "fails as expected",
    },
    {
      at: NOW - 41 * MIN,
      decision: "Set the cookie domain from the request host",
      why: "A fixed domain breaks the staging host; the config value is only a fallback",
      evidence: "a1b2c3d",
      result: "tests green",
    },
    {
      at: NOW - 18 * MIN,
      decision: "Reverted the shared-config change",
      why: "It moved the default for every environment, more than the ticket asks",
      evidence: "e4f5a6b",
      result: "reverted",
    },
  ],
};
const done: Worker = {
  key: "c:orch-w-b2",
  project: "Beacon Billing",
  title: "Patch the balance sync",
  task: "Replace add() with replace() in the balance sync, cover both orders of arrival with a test.",
  repo: "/Users/demo/code/beacon",
  worktree: "/Users/demo/code/beacon-relay-b2",
  branch: "relay/patch-the-balance-sync-b2",
  state: "done",
  model: "sonnet",
  at: NOW - 100 * MIN,
  ended: NOW - 21 * MIN,
  report: {
    status: "done",
    summary:
      "Balances now use `replace()`. The new test covers a credit note arriving before and after its invoice, 38 of 38 dossiers match on the dump.",
    questions: "- Deploy to staging tonight, or wait for the client's go?",
    diff: " src/Billing/BalanceSync.php       |  3 ++-\n tests/Billing/BalanceSyncTest.php | 14 +++++++++++---\n 2 files changed, 13 insertions(+), 4 deletions(-)",
    flags: ["branch main moved"],
    options: ["Deploy tonight", "Wait for the client"],
    files: [
      ["src/Billing/BalanceSync.php", 2, 1],
      ["tests/Billing/BalanceSyncTest.php", 11, 3],
    ],
  },
};
const silent: Worker = {
  key: "c:orch-w-c3",
  project: "Harbor CRM",
  title: "Summarise the contact sync options",
  task: "Compare full resync, incremental and webhooks for the contact import, one paragraph each.",
  repo: null,
  worktree: null,
  branch: null,
  state: "silent",
  model: "haiku",
  at: NOW - 100 * MIN,
  ended: NOW - 80 * MIN,
  report: null,
};
// a board pipeline's worker: picked from the board, a ticket over the project's two repos, a PR opened by Relay in each
const ticketed: Worker = {
  key: "c:orch-w-d4",
  project: "Northwind Portal",
  title: "Export invoices as CSV",
  task: 'Ticket #412 "Export invoices as CSV"',
  repo: "/Users/demo/code/northwind",
  worktree: "/Users/demo/code/northwind-relay-d4",
  branch: "relay/export-invoices-as-csv-d4",
  state: "done",
  at: NOW - 130 * MIN,
  ended: NOW - 35 * MIN,
  report: {
    status: "done",
    summary:
      "Invoices export as CSV from the list's menu, one row per invoice line. Tests for the empty list and for amounts in another currency.",
    questions: null,
    diff: "northwind-api:\n src/Invoice/CsvExport.php | 61 ++++++++++\n tests/Invoice/CsvExportTest.php | 48 +++++++++\n 2 files changed, 109 insertions(+)\n\nnorthwind:\n src/invoices/ExportMenu.tsx | 14 ++++\n 1 file changed, 14 insertions(+)",
    flags: [],
    files: [
      ["northwind-api/src/Invoice/CsvExport.php", 61, 0],
      ["northwind-api/tests/Invoice/CsvExportTest.php", 48, 0],
      ["northwind/src/invoices/ExportMenu.tsx", 14, 0],
    ],
  },
  ticket: {
    pipeline: "Northwind Portal",
    provider: "productive",
    project: "p1",
    board: "f1",
    card: "900103",
    number: "412",
    title: "Export invoices as CSV",
    url: "https://app.productive.io/40001/tasks/900103",
  },
  base_branch: "develop",
  pr: "https://github.com/acme/northwind/pull/88",
  board: `done:${NOW - 35 * MIN}`,
  trees: [
    {
      repo: "/Users/demo/code/northwind",
      worktree: "/Users/demo/code/northwind-relay-d4",
      start: "a1b2c3d",
      base: "develop",
      checks: "pnpm install && pnpm test",
      pr: "https://github.com/acme/northwind/pull/88",
      pr_error: null,
    },
    {
      repo: "/Users/demo/code/northwind-api",
      worktree: "/Users/demo/code/northwind-api-relay-d4",
      start: "e4f5a6b",
      base: "develop",
      checks: "composer install -q && vendor/bin/phpunit",
      pr: "https://github.com/acme/northwind-api/pull/31",
      pr_error: null,
    },
  ],
};
export const workers: Worker[] = [running, done, silent, ticketed];

// ?fixture=pipeline-panel: the board pipeline of Northwind Portal with three tickets: one building, one whose agent asks
// a question (in the input column), and the one above with its PRs in review. Each card is a task of the Productive
// board (fixtures/integrations.ts), in the column the panel reads it in
const pipelineTicket = (card: string, number: string, title: string) => ({
  pipeline: "Northwind Portal",
  provider: "productive",
  project: "p1",
  board: "f1",
  card,
  number,
  title,
  url: `https://app.productive.io/40001/tasks/${card}`,
});
const building = {
  ...running,
  key: "c:orch-w-p1",
  project: "Northwind Portal",
  title: "Plant the apple trees",
  task: 'Ticket #415 "Plant the apple trees"',
  branch: "relay/plant-the-apple-trees-p1",
  model: undefined,
  at: NOW - 12 * MIN,
  step: { done: 2, total: 5, note: "Rows in the north field" },
  decisions: [],
  ticket: pipelineTicket("900102", "415", "Plant the apple trees"),
  base_branch: "develop",
  pr: null,
  pr_error: null,
  board: null,
};
const asking = {
  ...building,
  key: "c:orch-w-p2",
  title: "Import the orchard map",
  task: 'Ticket #414 "Import the orchard map"',
  branch: "relay/import-the-orchard-map-p2",
  state: "blocked",
  step: null,
  at: NOW - 70 * MIN,
  ended: NOW - 25 * MIN,
  report: {
    status: "blocked",
    summary: "The map importer reads both layers, nothing is written yet.",
    questions: "The map has two layers for the north field. Import the newest one, or merge both?",
    diff: null,
    flags: [],
    options: ["The newest one", "Merge both"],
  },
  ticket: pipelineTicket("900100", "414", "Import the orchard map"),
  board: `blocked:${NOW - 25 * MIN}`,
};
// what the pipeline hands to a person, answered from the panel (PR pipeline-panel-answer): a plan for approval, a
// failed run and a done without a PR, each landed in the input column. A person took the last two on since: they are
// in the Review column now, the done one with a PR the person opened on its branch (orch_adopt finds it), the failed
// one without a PR yet
const planning = {
  ...asking,
  key: "c:orch-w-p3",
  title: "Prune the pear rows",
  task: 'Ticket #416 "Prune the pear rows"',
  branch: "relay/prune-the-pear-rows-p3",
  at: NOW - 50 * MIN,
  ended: NOW - 20 * MIN,
  report: {
    status: "blocked",
    summary: "A plan for the pruning schedule, nothing built yet.",
    questions:
      "Plan for approval:\n\n1. Add a `pruneAfter` date to each row in the orchard model.\n2. Show the rows due this week on the dashboard.\n3. Tests for a row without a date and for a leap year.\n\nLeft out: the mobile view.\n\nOpen question: one date per row, or per tree?",
    diff: null,
    flags: [],
    options: [],
  },
  ticket: pipelineTicket("900110", "416", "Prune the pear rows"),
  board: `blocked:${NOW - 20 * MIN}`,
};
const failing = {
  ...asking,
  key: "c:orch-w-p4",
  title: "Water the seedlings",
  task: 'Ticket #417 "Water the seedlings"',
  branch: "relay/water-the-seedlings-p4",
  state: "failed",
  at: NOW - 90 * MIN,
  ended: NOW - 60 * MIN,
  report: {
    status: "failed",
    summary: "The irrigation tests fail on a missing fixture file.",
    questions: null,
    diff: null,
    flags: [],
  },
  ticket: pipelineTicket("900108", "417", "Water the seedlings"),
  board: `failed:${NOW - 60 * MIN}`,
};
const nopr = {
  ...asking,
  key: "c:orch-w-p5",
  title: "Label the crates",
  task: 'Ticket #418 "Label the crates"',
  branch: "relay/label-the-crates-p5",
  state: "done",
  at: NOW - 110 * MIN,
  ended: NOW - 95 * MIN,
  report: {
    status: "done",
    summary: "The crate labels already print the harvest date, nothing to change.",
    questions: null,
    diff: null,
    flags: [],
  },
  ticket: pipelineTicket("900113", "418", "Label the crates"),
  pr: null,
  pr_error: "nothing to push",
  board: `done:${NOW - 95 * MIN}`,
};
export const pipelineWorkers = [building, asking, ticketed, planning, failing, nopr];
export const pipeOrchWorkers = [building, asking, failing, nopr];
// a ticket the pre-flight sent back before any agent started (#305 in the input column), as the panel keeps it
export const pipelineBounced = {
  "Northwind Portal": [
    {
      id: "900105",
      number: "305",
      title: "Rate limit docs",
      url: "https://app.productive.io/40001/tasks/900105",
      why: "unclear",
      questions: ["Which endpoints get a limit, all of them or only the public ones?", "Per user or per API key?"],
      reason: "",
      at: NOW - 40 * MIN,
    },
  ],
};

// ?fixture=pipeline-orch: the pipeline's own conversation (orch.rs pipe_key) as it reads after a pass: Relay's facts
// (one ticket waiting with a question and options, one stuck, one a person took to review), the user's answer, the
// coordinator's reply. The ticket rows' workers are pipelineWorkers above
export const PIPE = "c:orch:Northwind Portal";
const t = (n: string) => `https://app.productive.io/40001/tasks/${n}`;
const DIGEST = `[Relay] Pipeline Northwind Portal: 1 waiting on you, 1 stuck, 1 done by Relay, 1 running.

Waiting on you:
- #414, in Input: the agent asks. [ticket](${t("900100")}) · [agent](relay://worker?key=${asking.key})
<ticket>
Import the orchard map
Column on the board: Input
Question: ${asking.report.questions}
Options: ${asking.report.options.join(" | ")}
</ticket>

Stuck:
- #417, in Input: the run failed. [ticket](${t("900108")}) · [agent](relay://worker?key=${failing.key})
<ticket>
Water the seedlings
Column on the board: Input
The agent's summary: ${failing.report.summary}
</ticket>

Done by Relay:
- #418: a person moved it to Review, Relay follows its PR now

Running:
- #415, in Busy: its agent builds (step 2 of 5). [ticket](${t("900102")}) · [agent](relay://worker?key=${building.key})
<ticket>
Plant the apple trees
Column on the board: Busy
The agent's step: Rows in the north field
</ticket>`;
export const PIPE_MARKER = "Next step is yours";
export function pipeHistory(key: string): Ev[] | null {
  if (key !== PIPE) return null;
  return [
    time(NOW - 24 * MIN),
    user(DIGEST),
    ai(
      `**Waiting on you**\n- [#414 Import the orchard map](${t("900100")}): the map has two layers for the north field. Import the newest one, or merge both? ([agent](relay://worker?key=${asking.key}))\n\n**Stuck**\n- [#417 Water the seedlings](${t("900108")}): the irrigation tests fail on a missing fixture file. ([agent](relay://worker?key=${failing.key}))\n\n**Relay did**\n- #418 Label the crates: someone moved it to Review, Relay follows its PR now.\n\n**Running**\n- [#415 Plant the apple trees](${t("900102")}), step 2 of 5.`,
    ),
    time(NOW - 6 * MIN),
    user("414: merge both layers, the newest wins where they overlap"),
    ai(
      `Done on #414 Import the orchard map: posted on the ticket as a comment: "merge both layers, the newest wins where they overlap". Its agent picks the ticket up again. ${PIPE_MARKER} on #417: try it again, or take it over?`,
    ),
  ];
}

const REPORT = `[Relay] Report from worker ${done.key} (Beacon Billing, "Patch the balance sync"): done

${done.report!.summary}

Questions for the user:
${done.report!.questions}

Branch ${done.branch} in ${done.worktree}

Diff (read by Relay):
${done.report!.diff}

Flags:
- branch main moved`;
export const REPORT_MARKER = "Beacon is done on its branch";

export function history(key: string): Ev[] | null {
  if (key === ORCH)
    return [
      time(NOW - 100 * MIN),
      user(
        "Fix the Northwind login redirect, patch the Beacon balance sync and summarise the Harbor contact sync options.",
      ),
      ai("Three workers started, one per project. Their reports come back here."),
      time(NOW - 21 * MIN),
      user(REPORT),
      ai(
        `${REPORT_MARKER}. One question for you: deploy to staging tonight, or wait for the client's go? Northwind still runs.`,
      ),
    ];
  const worker = workers.find(w => w.key === key);
  if (!worker) return null;
  return [
    time(worker.at),
    user(`[Relay] ${worker.task}\n\nWork in ${worker.worktree ?? "the vault"}. End with report.`),
    ai(worker.report ? worker.report.summary : "Reading the project note first."),
  ];
}

/** The live `orch` events: a new worker starts, the running one reports into the coordinator. */
export function live(): Ev[] {
  const started: Worker = {
    key: "c:orch-w-d4",
    project: "Atlas Logistics",
    title: "Draft the depot import ticket",
    task: "Write the ticket for the depot import script, acceptance criteria included.",
    repo: null,
    worktree: null,
    branch: null,
    state: "running",
    at: NOW - MIN,
    ended: null,
    report: null,
  };
  const report: Report = {
    status: "blocked",
    summary: "The loop comes from the SSO callback URL on staging, it still points at the old domain.",
    questions: "Can I change the callback URL in the staging IdP, or does the client do that?",
    diff: null,
    flags: [],
    options: ["Change it yourself", "Ask the client", "I'll do it"],
  };
  return [
    { type: "worker", worker: started },
    { type: "worker", worker: { ...running, state: "blocked", ended: NOW, report } },
    {
      type: "sent",
      key: ORCH,
      text: `[Relay] Report from worker ${running.key} (Northwind Portal, "${running.title}"): blocked\n\n${report.summary}\n\nQuestions for the user:\n${report.questions}`,
    },
  ];
}
