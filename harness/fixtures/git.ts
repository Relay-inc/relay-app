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
