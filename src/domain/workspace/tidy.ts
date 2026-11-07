// Tidy structure (src-tauri/src/tidy.rs): what the sheet shows of the plan.

/** One note on its way to the home of its type; `renamed`: its name was taken there and it gets a number. */
export type TidyMove = { kind: string; from: string; to: string; renamed: boolean };
/** The plan: every move, how many notes of a type with a home already `stay`, and the `links` rewritten in `notes` notes. */
export type TidyPlan = { moves: TidyMove[]; stay: number; links: number; notes: number };

/** The moves the sheet lists: the renamed ones first (the preview names them), then the rest in order, `n` at most. */
export const tidySample = (moves: TidyMove[], n: number) =>
  [...moves.filter(m => m.renamed), ...moves.filter(m => !m.renamed)].slice(0, n);

/** "Meeting 12, Thread 5": the finding of each type outside its home with how many notes it names. */
export const outsideKinds = (findings: { path: string; paths: string[] }[]) =>
  findings.map(f => `${f.path} ${f.paths.length}`).join(", ");
