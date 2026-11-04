// Fixture kb (K5, K1): the notes ⌘K searches by name and content, the templates New ▸ offers, and the answers of the
// backend's find_notes (src-tauri/src/related.rs `find`, which has its own tests): the same query words, `type:`, `in:`
// and `#tag`, kept small. Fictional data only.
export type KbNote = { path: string; type: string; context: string; tags: string[]; text: string };

const meetingDir = "Calendar/Meetings/2026";
const docs = "Contexts/Agency/Projects/Northwind Portal/Documents";
export const notes: KbNote[] = [
  {
    path: `${docs}/Rate limit findings.md`,
    type: "Document",
    context: "Agency",
    tags: ["plan"],
    text: '---\ntype: Document\ncontext: "[[Agency]]"\n---\n# Rate limit findings\n\n## Status\nGo live in sprint 24.\n\n## Rate limits\n- Northwind rate limit: 60 requests per minute per API key, then 429 with Retry-After.\n',
  },
  {
    path: `${docs}/Rate limit test plan.md`,
    type: "Document",
    context: "Agency",
    tags: [],
    text: '---\ntype: Document\ncontext: "[[Agency]]"\n---\n# Rate limit test plan\n\nCases for the limits of the sandbox.\n',
  },
  {
    path: "Contexts/Agency/Projects/Beacon Billing/Documents/Billing Spec.md",
    type: "Document",
    context: "Agency",
    tags: [],
    text: "---\ntype: Document\n---\n# Billing Spec\n\nThe simulator respects the Northwind rate limit with a cache per plate (24 h).\n",
  },
  {
    path: "Contexts/Agency/Projects/Northwind Portal/Documents/Portal Architecture.md",
    type: "Document",
    context: "Agency",
    tags: [],
    text: "---\ntype: Document\n---\n# Portal Architecture\n\nExternal APIs (Northwind, Paywell) via the queue, max. 1 call/s per rate bucket.\n",
  },
  {
    path: `${meetingDir}/2026-09-30 Portal sync.md`,
    type: "Meeting",
    context: "Agency",
    tags: [],
    text: '---\ntype: Meeting\ncontext: "[[Agency]]"\n---\n# Portal sync\n\nAfter the migration the Northwind rate limit is retested from the new outbound IP.\n',
  },
  {
    path: "Contexts/Personal/Notes/Rate card.md",
    type: "Document",
    context: "Personal",
    tags: [],
    text: "---\ntype: Document\n---\n# Rate card\n\nMy Northwind rate for a day of consulting.\n",
  },
];
export const paths = notes.map(n => n.path);
export const texts: Record<string, string> = Object.fromEntries(notes.map(n => [n.path, n.text]));
export const templates = ["Document", "Meeting", "Person"];
/** The note Today's note makes, on the fixture's date. */
export const dailyPath = (day: string) => `Calendar/Daily/${day.slice(0, 4)}/${day}.md`;
/** A note in the second workspace ⇥ switches to. */
export const sideNote = { path: "Handbook/Rate policy.md", title: "Rate policy", type: "Document" };

const parse = (q: string) => {
  const out = { text: [] as string[], type: "", within: "", tags: [] as string[] };
  for (const m of q.matchAll(/(?:[^\s"]|"[^"]*")+/g)) {
    const w = m[0].replace(/"/g, "");
    const lower = w.toLowerCase();
    if (lower.startsWith("type:")) out.type = lower.slice(5);
    else if (lower.startsWith("in:")) out.within = lower.slice(3);
    else if (lower.startsWith("#") && w.length > 1) out.tags.push(lower.slice(1));
    else out.text.push(lower);
  }
  return out;
};
const title = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");
const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const hasAll = (s: string, terms: string[]) => terms.every(t => wordsOf(s).some(w => w.startsWith(t)));

/** find_notes for the main vault; the second workspace has one note. */
export function find(main: boolean, query: string) {
  const q = parse(query);
  const terms = q.text.flatMap(wordsOf);
  if (!main) {
    const ok = terms.length && hasAll(sideNote.title, terms);
    return {
      names: ok ? [{ path: sideNote.path, title: sideNote.title, type: sideNote.type }] : [],
      content: [],
    };
  }
  const pass = (n: KbNote) =>
    (!q.type || n.type.toLowerCase() === q.type) &&
    (!q.within ||
      n.path
        .split("/")
        .slice(0, -1)
        .some(d => d.toLowerCase() === q.within) ||
      n.context.toLowerCase() === q.within) &&
    q.tags.every(t => n.tags.includes(t));
  const names = notes
    .filter(n => pass(n) && (terms.length ? hasAll(title(n.path), terms) : !!(q.type || q.within || q.tags.length)))
    .slice(0, 8)
    .map(n => ({ path: n.path, title: title(n.path), type: n.type }));
  const content = terms.length
    ? notes
        .filter(pass)
        .flatMap(n => {
          const lines = n.text.split("\n");
          const at = lines.findIndex((l, i) => i > 4 && hasAll(l, terms));
          if (at < 0) return [];
          const line = lines[at].replace(/^[-\s]+/, "");
          const m = new RegExp(terms.map(t => `${t}\\w*`).join("[^\\w]+"), "i").exec(line);
          const [from, to] = m ? [m.index, m.index + m[0].length] : [0, 0];
          return [
            {
              path: n.path,
              title: title(n.path),
              line: at + 1,
              before: line.slice(0, from),
              hit: line.slice(from, to),
              after: line.slice(to),
            },
          ];
        })
        .slice(0, 12)
    : [];
  return { names, content };
}
