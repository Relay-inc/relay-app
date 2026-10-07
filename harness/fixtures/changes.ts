// `conversation_changes`: what git says the long Beacon Billing conversation changed, one repo with a branch off
// main. The other conversations changed nothing in a repo.
const patch = (start: number, lines: string[]) =>
  `@@ -${start},${lines.filter(l => !l.startsWith("+")).length} +${start},${lines.filter(l => !l.startsWith("-")).length} @@\n${lines.join("\n")}`;

export const changes = [
  {
    repo: "/Users/demo/projects/beacon-billing",
    name: "beacon-billing",
    branch: "fix/double-balances",
    base: "origin/main",
    files: [
      {
        path: "src/Billing/Sync/DossierSync.php",
        status: "M",
        add: 6,
        del: 3,
        binary: false,
        patch: patch(40, [
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
        ]),
      },
      {
        path: "src/Billing/Sync/BalanceRepository.php",
        status: "M",
        add: 8,
        del: 0,
        binary: false,
        patch: patch(22, [
          "     }",
          "+",
          "+    public function hasBalanceFor(Dossier $dossier, Period $period): bool",
          "+    {",
          "+        return (bool) $this->db->fetchOne(",
          "+            'SELECT 1 FROM balances WHERE dossier_id = ? AND period = ?',",
          "+            [$dossier->id(), $period->key()],",
          "+        );",
          "+    }",
        ]),
      },
      {
        path: "tests/Billing/Sync/DossierSyncTest.php",
        status: "A",
        add: 24,
        del: 0,
        binary: false,
        patch: patch(1, Array.from({ length: 24 }, (_, i) => `+${i === 0 ? "<?php" : `    // line ${i + 1} of the new test`}`)),
      },
      {
        path: "migrations/Version20261007_unique_balance_period.php",
        status: "A",
        add: 12,
        del: 0,
        binary: false,
        patch: patch(1, Array.from({ length: 12 }, (_, i) => `+${i === 0 ? "<?php" : `    // migration line ${i + 1}`}`)),
      },
      { path: "docs/sync.png", status: "D", add: 0, del: 0, binary: true, patch: "" },
    ],
  },
];
