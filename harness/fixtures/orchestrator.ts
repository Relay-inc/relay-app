// The orchestrator (?fixture=orch): the coordinator's conversation "c:orch" and its workers as `orch_workers` returns
// them (src-tauri/src/orch.rs), their transcripts, and the live `orch` events of a worker that reports.
import { NOW, iso } from "./util";

type Ev = Record<string, unknown> & { type: string };
type Report = { status: string; summary: string; questions: string | null; diff: string | null; flags: string[] };
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
  at: NOW - 6 * MIN,
  ended: null,
  report: null,
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
  at: NOW - 48 * MIN,
  ended: NOW - 21 * MIN,
  report: {
    status: "done",
    summary:
      "Balances now use `replace()`. The new test covers a credit note arriving before and after its invoice, 38 of 38 dossiers match on the dump.",
    questions: "- Deploy to staging tonight, or wait for the client's go?",
    diff: " src/Billing/BalanceSync.php       |  3 ++-\n tests/Billing/BalanceSyncTest.php | 14 +++++++++++---\n 2 files changed, 13 insertions(+), 4 deletions(-)",
    flags: ["branch main moved"],
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
  at: NOW - 95 * MIN,
  ended: NOW - 80 * MIN,
  report: null,
};
export const workers: Worker[] = [running, done, silent];

const REPORT = `[Relay] Report from worker ${done.key} (Beacon Billing, "Patch the balance sync"): done

${done.report!.summary}

Questions for Laurent:
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
    questions: "- Can I change the callback URL in the staging IdP, or does the client do that?",
    diff: null,
    flags: [],
  };
  return [
    { type: "worker", worker: started },
    { type: "worker", worker: { ...running, state: "blocked", ended: NOW, report } },
    {
      type: "sent",
      key: ORCH,
      text: `[Relay] Report from worker ${running.key} (Northwind Portal, "${running.title}"): blocked\n\n${report.summary}\n\nQuestions for Laurent:\n${report.questions}`,
    },
  ];
}
