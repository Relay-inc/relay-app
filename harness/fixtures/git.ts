import { NOW, HOUR } from "./util";
// `git_repos`: the Git drawer of Beacon Billing (the long conversation's project), two checkouts. beacon on a
// branch with staged, unstaged and untracked files (two of them written by the conversation's tools), beacon-api with
// one staged file and no upstream, whose push the mock refuses. The other projects have no checkout.
const patch = (start: number, lines: string[]) =>
  `@@ -${start},${lines.filter(l => !l.startsWith("+")).length} +${start},${lines.filter(l => !l.startsWith("-")).length} @@\n${lines.join("\n")}`;
const file = (path: string, status: string, staged: boolean, lines: string[], start = 1) => ({
  path,
  orig: null,
  status,
  staged,
  untracked: status === "?",
  add: lines.filter(l => l.startsWith("+")).length,
  del: lines.filter(l => l.startsWith("-")).length,
  patch: patch(start, lines),
  binary: false,
});
const fresh = (n: number, what: string) =>
  Array.from({ length: n }, (_, i) => `+${i === 0 ? "<?php" : `    // ${what} line ${i + 1}`}`);

export const repos = [
  {
    repo: "/Users/demo/code/beacon",
    name: "beacon",
    branch: "fix/double-balances",
    upstream: "origin/fix/double-balances",
    ahead: 1,
    behind: 0,
    made: false,
    files: [
      file(
        "src/Billing/BalanceSync.php",
        "M",
        true,
        [
          "     public function sync(Dossier $dossier): void",
          "     {",
          "-        $balance = $this->ledger->balanceOf($dossier);",
          "-        $this->repository->addBalance($dossier, $balance);",
          "-        $this->events->dispatch(new BalanceSynced($dossier));",
          "+        $balance = $this->ledger->balanceOf($dossier);",
          "+        if ($this->repository->hasBalanceFor($dossier, $balance->period())) {",
          "+            return; // a retried job: the balance is already there",
          "+        }",
          "+        $this->repository->addBalance($dossier, $balance);",
          "+        $this->events->dispatch(new BalanceSynced($dossier));",
          "     }",
        ],
        40,
      ),
      file(
        "src/Billing/Sync/BalanceRepository.php",
        "M",
        false,
        [
          "     }",
          "+",
          "+    public function hasBalanceFor(Dossier $dossier, Period $period): bool",
          "+    {",
          "+        return (bool) $this->db->fetchOne(",
          "+            'SELECT 1 FROM balances WHERE dossier_id = ? AND period = ?',",
          "+            [$dossier->id(), $period->key()],",
          "+        );",
          "+    }",
        ],
        22,
      ),
      file("tests/Billing/BalanceSyncTest.php", "M", true, fresh(24, "test").slice(1), 12),
      { ...file("docs/sync.png", "D", false, []), patch: "", binary: true },
      file("migrations/Version20261007_unique_balance_period.php", "?", false, fresh(12, "migration")),
      file("scripts/backfill-balances.php", "?", false, fresh(6, "backfill")),
    ],
  },
  {
    repo: "/Users/demo/code/beacon-api",
    name: "beacon-api",
    branch: "main",
    upstream: "",
    ahead: 0,
    behind: 0,
    made: false,
    files: [
      file("src/Api/BalanceController.php", "M", true, [
        "     #[Route('/balances/{dossier}')]",
        "-    public function show(Dossier $dossier): Response",
        "+    public function show(Dossier $dossier, Period $period): Response",
      ]),
    ],
  },
];

/** What `git push` says when the remote has commits this checkout lacks. */
export const pushRejected = `To github.com:acme/beacon-api.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'github.com:acme/beacon-api.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. Integrate the remote changes (e.g. 'git pull ...') before pushing again.`;

/** ai_write's answer to the commit message prompt. */
export const commitMessage =
  "Skip a balance the sync already added\n\nA retried sync job added the same period's balance a second time.";

// `git_log`: beacon's history with two merged pull requests, a tag, HEAD one commit ahead on its branch, and a spike
// branch that only shows with All branches; beacon-api a straight line.
const hash = (n: number) => n.toString(16).padStart(4, "0").repeat(10);
const commit = (
  n: number,
  parents: number[],
  hoursAgo: number,
  author: string,
  subject: string,
  refs: string[] = [],
) => ({
  hash: hash(n),
  parents: parents.map(hash),
  author,
  at: Math.floor((NOW - hoursAgo * HOUR) / 1000),
  refs,
  head: refs[0] === "fix/double-balances" || refs[0] === "main",
  subject,
});
const beaconLog = [
  commit(1, [2], 0.3, "Noor Peeters", "Skip a balance the sync already added", ["fix/double-balances"]),
  commit(2, [3, 4], 5, "Sam Claes", "Merge pull request #41 from acme/feat/credit-notes", [
    "origin/fix/double-balances",
    "origin/main",
  ]),
  commit(11, [3], 8, "Jo Maes", "Try a queue per tenant", ["origin/spike/queues"]),
  commit(4, [6], 26, "Noor Peeters", "Match credit notes by reference"),
  commit(3, [6], 30, "release-bot", "Bump version to 2.4.1", ["tag: v2.4.1"]),
  commit(6, [7, 8], 50, "Sam Claes", "Merge pull request #40 from acme/fix/rounding"),
  commit(8, [9], 72, "Jo Maes", "Round balances per line, not per invoice"),
  commit(7, [9], 120, "Noor Peeters", "Add the nightly sync's retry policy"),
  commit(9, [10], 400, "Sam Claes", "Read invoices in pages of 500", ["tag: v2.4.0"]),
  commit(10, [], 2000, "Sam Claes", "Import the billing service"),
];
const apiLog = [
  commit(21, [22], 3, "Jo Maes", "Return the period with every balance", ["main"]),
  commit(22, [23], 40, "Jo Maes", "Validate the dossier id on the balance route"),
  commit(23, [], 900, "Sam Claes", "Start the balance API"),
];
export const log = (repo: string, all: boolean) =>
  repo.endsWith("/beacon")
    ? beaconLog.filter(c => all || c.hash !== hash(11))
    : repo.endsWith("/beacon-api")
      ? apiLog
      : [];

// `git_show`: a commit opened from the log, two files against the commit before it
export const show = (hash: string) => {
  const c = [...beaconLog, ...apiLog].find(x => x.hash === hash);
  const files = [
    file(
      "src/Billing/BalanceSync.php",
      "M",
      false,
      [
        "     public function sync(Dossier $dossier): void",
        "     {",
        "-        $this->repository->addBalance($dossier, $balance);",
        "+        if ($this->repository->hasBalance($dossier, $balance->period)) {",
        "+            return; // a retried job: the balance is already there",
        "+        }",
        "+        $this->repository->addBalance($dossier, $balance);",
        "     }",
      ],
      40,
    ),
    file("tests/Billing/BalanceSyncTest.php", "A", false, fresh(9, "test")),
  ];
  return { hash, body: c ? `${c.subject}\n\nA retried sync job added the same period's balance again.` : "", files };
};
