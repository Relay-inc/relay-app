// The review screen's findings when more than one agent read the diff: whose a finding is, a new pass of one agent,
// and the lines two agents both flagged.

type Found = { id: string; pr: string; path: string; line: number; side: string; severity: string; agent?: string };

/** The agent of a finding; those from before there was a choice are Claude's. */
export const finder = (f: { agent?: string }) => f.agent ?? "claude";
/** A new pass of one agent: its earlier findings go, the answers and the other agents' findings stay. */
export const replaceBy = <F extends Found>(all: F[], agent: string, found: F[]) => [
  ...all.filter(x => x.severity === "answer" || finder(x) !== agent),
  ...found,
];
/** Another agent flagged the same line too. Answers to your questions don't count. */
export const agreed = (all: Found[], f: Found) =>
  f.severity !== "answer" &&
  all.some(
    x =>
      x.id !== f.id &&
      x.severity !== "answer" &&
      finder(x) !== finder(f) &&
      x.pr === f.pr &&
      x.path === f.path &&
      x.line === f.line &&
      x.side === f.side,
  );
