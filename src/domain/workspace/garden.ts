// The garden (src-tauri/src/vaultcheck.rs `garden`): what the Garden tab of the vault check shows of its findings.
/** What the tab reads of a finding (a `VaultFinding` of the backend is one). */
export type Found = { kind: string; context: string; paths: string[] };

/** The kinds the garden finds, in the order the tab lists them. */
export const GARDEN = ["outside_home", "no_project", "broken_link", "orphan", "unused_attachment", "no_type"] as const;
export type GardenKind = (typeof GARDEN)[number];

/** One row of the tab: how many notes (or files) a kind names, and them. `outside_home` is one finding per type. */
export type GardenRow<F extends Found = Found> = { kind: GardenKind; n: number; paths: string[]; findings: F[] };
export function gardenRows<F extends Found>(found: F[]): GardenRow<F>[] {
  return GARDEN.flatMap(kind => {
    const findings = found.filter(f => f.kind === kind);
    const paths = findings.flatMap(f => f.paths);
    return paths.length ? [{ kind, n: paths.length, paths, findings }] : [];
  });
}
export const gardenTotal = (found: Found[]) => gardenRows(found).reduce((n, r) => n + r.n, 0);

/** A broken link as the check names it: "note<TAB>line<TAB>target". */
export type BrokenLink = { note: string; line: number; target: string };
export function brokenLink(path: string): BrokenLink {
  const [note, line, ...target] = path.split("\t");
  return { note, line: Number(line) || 1, target: target.join("\t") };
}

/** The folder every path sits in, "Attachments/2026/" (or "" when they share none). */
export function commonFolder(paths: string[]) {
  const dirs = paths.map(p => p.split("/").slice(0, -1));
  const first = dirs[0] ?? [];
  let n = first.length;
  for (const d of dirs) while (n && d.slice(0, n).join("/") !== first.slice(0, n).join("/")) n--;
  return n ? `${first.slice(0, n).join("/")}/` : "";
}

/** 4300000 → "4.1 MB" in the user's number format. */
export function bytes(n: number, locale: string) {
  const [v, unit] = n >= 1 << 20 ? [n / (1 << 20), "MB"] : n >= 1 << 10 ? [n / (1 << 10), "KB"] : [n, "B"];
  return `${v.toLocaleString(locale, { maximumFractionDigits: unit === "B" ? 0 : 1 })} ${unit}`;
}
