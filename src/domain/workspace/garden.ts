// The vault check's list (src-tauri/src/vaultcheck.rs `check` and `garden`): its findings grouped by kind.
/** What the list reads of a finding (a `VaultFinding` of the backend is one). */
export type Found = { kind: string; context: string; path: string; paths: string[] };

/** The kinds the health check finds, in the order the list shows them, before the garden's. */
export const HEALTH = [
  "claude_link",
  "missing_file",
  "context_note",
  "context_rule",
  "context_heading",
  "context_mismatch",
  "card_fields",
  "orphan_rule",
  "row_without_note",
  "missing_tool",
] as const;
/** The kinds the garden finds, in the order the list shows them. */
export const GARDEN = ["outside_home", "no_project", "broken_link", "orphan", "unused_attachment", "no_type"] as const;
export const isGarden = (kind: string) => (GARDEN as readonly string[]).includes(kind);

/** One group of the list: how many it names and them. A health finding is one entry (its `path`); a garden finding
 *  names many notes (or files) in `paths`, and `outside_home` is one finding per type. */
export type Group<F extends Found = Found> = { kind: string; n: number; paths: string[]; findings: F[] };
/** Health kinds first, then the garden's, then any kind this app does not know yet (so no finding goes missing). */
export function findingGroups<F extends Found>(found: F[]): Group<F>[] {
  return [...new Set<string>([...HEALTH, ...GARDEN, ...found.map(f => f.kind)])].flatMap(kind => {
    const findings = found.filter(f => f.kind === kind);
    const paths = isGarden(kind) ? findings.flatMap(f => f.paths) : findings.map(f => f.path);
    return paths.length ? [{ kind, n: paths.length, paths, findings }] : [];
  });
}

/** A broken link as the check names it: "note<TAB>line<TAB>target". */
export type BrokenLink = { note: string; line: number; target: string };
export function brokenLink(path: string): BrokenLink {
  const [note, line, ...target] = path.split("\t");
  return { note, line: Number(line) || 1, target: target.join("\t") };
}

/** The folder every path sits in, "Attachments/2026/" (or "" when they share none). */
export function commonFolder(paths: string[]) {
  if (!paths.length) return "";
  const dirs = paths.map(p => p.split("/").slice(0, -1));
  const first = dirs[0];
  let n = 0;
  while (n < first.length && dirs.every(d => d[n] === first[n])) n++;
  return n ? `${first.slice(0, n).join("/")}/` : "";
}

/** 4300000 → "4.1 MB" in the user's number format. */
export function bytes(n: number, locale: string) {
  const [v, unit] = n >= 1 << 20 ? [n / (1 << 20), "MB"] : n >= 1 << 10 ? [n / (1 << 10), "KB"] : [n, "B"];
  return `${v.toLocaleString(locale, { maximumFractionDigits: unit === "B" ? 0 : 1 })} ${unit}`;
}
