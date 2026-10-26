import { VAULT } from "./vault";

// The Files drawer of Beacon Billing: its code folder (the two checkouts of git.ts side by side, as the vault's index
// lists the folder they are in) and its folder in the vault. `list_dir` answers from this tree, `read_file_text` the
// PHP file as text and anything else as binary. Other projects get only their vault folder.
const CODE = "/Users/demo/code";
const NOTES = `${VAULT}/Contexts/Agency/Projects/Beacon Billing`;
const tree: Record<string, [string, boolean, boolean?][]> = {
  [CODE]: [
    ["beacon", true],
    ["beacon-api", true],
    ["docs", true],
    ["BILLING_SYNC_PLAN.md", false],
    ["Offerte facturatie.docx", false],
  ],
  [`${CODE}/beacon`]: [
    ["migrations", true],
    ["node_modules", true, true],
    ["src", true],
    ["tests", true],
    ["vendor", true, true],
    [".env.local", false, true],
    ["composer.json", false],
    ["README.md", false],
  ],
  [`${CODE}/beacon/src`]: [["Billing", true]],
  [`${CODE}/beacon/src/Billing`]: [
    ["Sync", true],
    ["BalanceSync.php", false],
    ["Invoice.php", false],
  ],
  [`${CODE}/beacon/src/Billing/Sync`]: [["BalanceRepository.php", false]],
  [NOTES]: [
    ["Communication", true],
    ["Documents", true],
    ["Beacon Billing.md", false],
    ["Log.md", false],
  ],
};

export const roots = (project: string) => ({
  vault: VAULT,
  roots:
    project === "Beacon Billing"
      ? [
          { label: "code", path: CODE, vault: false },
          { label: "Beacon Billing", path: NOTES, vault: true },
        ]
      : [{ label: project || "Vault", path: VAULT, vault: true }],
});
export const list = (path: string) =>
  (tree[path] ?? []).map(([name, dir, ignored]) => ({ name, path: `${path}/${name}`, dir, ignored: !!ignored }));
export const read = (path: string) =>
  path.endsWith(".php")
    ? Promise.resolve(
        `<?php\n\nnamespace App\\Billing;\n\nfinal class BalanceSync\n{\n    public function __construct(private BalanceRepository $repository)\n    {\n    }\n\n    public function sync(Dossier $dossier, Balance $balance): void\n    {\n        if ($this->repository->hasBalance($dossier, $balance->period)) {\n            return; // a retried job: the balance is already there\n        }\n        $this->repository->addBalance($dossier, $balance);\n    }\n}\n`,
      )
    : Promise.reject("binary");
