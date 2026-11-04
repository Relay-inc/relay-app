// Fixture kb (K5, K1): the notes ⌘K searches by name and content, the templates New ▸ offers, and the answers of the
// backend's find_notes (src-tauri/src/related.rs `find`, which has its own tests): the same query words, `type:`, `in:`
// and `#tag`, kept small. Fictional data only.
import { NOW, HOUR } from "./util";
import { VAULT } from "./vault";
import { conversations } from "./conversations";

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

const hosting = `${docs}/Hosting plan.md`;
// the note the right rail (K2) is shown on: headings enough to scroll, three notes that link to it, two that name it
// without a link, and the conversations that used it
const lorem = (topic: string) =>
  `${topic} is planned in three steps. The first step moves the staging environment, the second the database and the ` +
  `third the public traffic. Every step has an owner, a rollback and a check that someone other than the owner runs.\n\n` +
  `The team agreed to keep the old cluster for two weeks after the move, so a rollback stays a switch and not a rebuild.\n`;
notes.push(
  {
    path: hosting,
    type: "Document",
    context: "Agency",
    tags: [],
    text:
      '---\ntype: Document\ncontext: "[[Agency]]"\nabout: "[[Northwind Portal]]"\naliases:\n  - Migration plan\n---\n# Hosting plan\n\n' +
      `## Briefing\n${lorem("The move to the new cluster")}\n## Scope\n${lorem("The scope")}\n### Staging\n${lorem("Staging")}\n` +
      `## Cutover\n${lorem("The cutover")}\n## Risks\n${lorem("The risk list")}\n## Next steps\n- Confirm the date with Sofie\n- Book the window\n`,
  },
  {
    path: `${meetingDir}/2026-09-29 Portal sync.md`,
    type: "Meeting",
    context: "Agency",
    tags: [],
    text: '---\ntype: Meeting\ncontext: "[[Agency]]"\n---\n# Portal sync\n\nLast sync: [[Hosting plan]], cutover on 15 Oct.\n',
  },
  {
    path: `${meetingDir}/2026-10-06 Portal sync.md`,
    type: "Meeting",
    context: "Agency",
    tags: [],
    text: '---\ntype: Meeting\ncontext: "[[Agency]]"\n---\n# Portal sync\n\nSince last time, from [[Hosting plan|the plan]]: staging is done.\n',
  },
  {
    path: "Calendar/Weekly review W40.md",
    type: "Daily",
    context: "Personal",
    tags: [],
    text: "---\ntype: Daily\n---\n# Weekly review W40\n\nPortal: see [[Hosting plan]] for the cutover scope.\n",
  },
  {
    path: "Calendar/Daily/2026/2026-09-29.md",
    type: "Daily",
    context: "Personal",
    tags: [],
    text: "---\ntype: Daily\n---\n# 2026-09-29\n\n09:30 Hosting plan sync with Sofie, then NW-212.\n",
  },
  {
    path: "Contexts/Agency/People/Sofie Claes.md",
    type: "Person",
    context: "Agency",
    tags: [],
    text: "---\ntype: Person\n---\n# Sofie Claes\n\nWeekly hosting plan review on Wednesdays.\n",
  },
);
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

const stemOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");
const kindOf = (text: string) => /^type: (.*)$/m.exec(text)?.[1] ?? "";
/** The notes conversations read and wrote this week, on top of the graph's: two used the note the rail is shown on. */
export const touches = () => {
  const [first, second] = [...conversations].sort((a, b) => b.at - a.at);
  return [
    { key: first.key, root: VAULT, path: hosting, at: NOW - 2 * HOUR, kind: "read" as const },
    { key: second.key, root: VAULT, path: hosting, at: NOW - HOUR, kind: "write" as const },
  ];
};

/** note_rail (related.rs `rail`, which has its own tests), over the notes as they are now: who links to `path`, where
 *  its name or an alias stands without a link (4 characters or more), a fixed list of what is near it. */
export function rail(path: string, textOf: (path: string) => string | undefined) {
  const me = stemOf(path);
  const all = paths.map(p => ({ p, text: textOf(p) ?? "" }));
  const names = [
    me,
    ...(/^aliases:\n((?: {2}- .*\n)+)/m
      .exec(textOf(path) ?? "")?.[1]
      .match(/- (.*)/g)
      ?.map(a => a.slice(2)) ?? []),
  ].filter(n => n.length >= 4);
  const context = (text: string, at: number, length: number) => {
    const line = text.slice(0, at).split("\n").length;
    const from = text.lastIndexOf("\n", at - 1) + 1;
    const to = text.indexOf("\n", at);
    const end = to < 0 ? text.length : to;
    return {
      line,
      before: text.slice(from, at),
      hit: text.slice(at, at + length),
      after: text.slice(at + length, end),
    };
  };
  const meta = (p: string, text: string) => ({ p, t: stemOf(p), k: kindOf(text) });
  const backlinks: unknown[] = [];
  const linking = new Set<string>();
  for (const { p, text } of all) {
    const m =
      p === path
        ? null
        : new RegExp(`\\[\\[${me}(?:[|#][^\\]]*)?\\]\\]`, "i").exec(text.replace(/^---[\s\S]*?\n---\n/, ""));
    if (m) {
      linking.add(p);
      const at = text.indexOf(m[0]);
      backlinks.push({ ...meta(p, text), ...context(text, at, m[0].length) });
    }
  }
  const mentions: unknown[] = [];
  for (const { p, text } of all) {
    if (p === path || linking.has(p)) continue;
    const body = text.replace(/^---[\s\S]*?\n---\n/, (m: string) => " ".repeat(m.length));
    for (const name of names) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, "giu");
      const found = [...body.matchAll(re)].find(m => !/\[\[[^\]]*$/.test(body.slice(0, m.index).split("\n").pop()!));
      if (found) {
        mentions.push({ ...meta(p, text), ...context(text, found.index, found[0].length) });
        break;
      }
    }
  }
  const related = ["Portal Architecture", "Billing Spec", "2026-09-30 Portal sync", "Rate limit findings"].flatMap(
    name => {
      const p = paths.find(x => stemOf(x) === name);
      return p ? [meta(p, textOf(p) ?? "")] : [];
    },
  );
  return { backlinks, mentions, related };
}

// ---------- the Changes feed (K6, issue 371): fixture kb-changes
/** The page the table scenarios and screenshots edit (fixture kb-tables): a 3-column table with alignment, an empty
 *  cell, an escaped pipe and inline bold, link and code in cells, and a wide one. */
export const tables = {
  path: `${docs}/Vendor overview.md`,
  text:
    '---\ntype: Document\ncontext: "[[Agency]]"\n---\n# Vendor overview\n\n' +
    "| Vendor | Contact | Monthly cost |\n| :-- | :-: | --: |\n" +
    "| Atlas Logistics | Sofie Claes | 1.240,00 |\n" +
    "| **Bluebird Studio** | [Tom Willems](mailto:tom.willems@example.com) | `860,50` |\n" +
    "| Harbour \\| Docks |  | 2.100,00 |\n\n" +
    "Open questions per vendor:\n\n" +
    "| ID | Vendor | Question | Owner | Phase | Due | Status | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n" +
    "| V1 | Atlas Logistics | Does the rate card include weekend pickups or only weekdays within the metro area? | Sofie Claes | Review | 2026-11-12 | Open | Waiting for the updated contract from the vendor |\n" +
    "| V2 | Bluebird Studio | Can the invoices be delivered as UBL instead of PDF? | Tom Willems | Intake | 2026-11-19 | Open | Asked on the call |\n\n" +
    "Closing line.\n",
};
/** A note without `type:`: what Fix properties is for. */
export const untyped = {
  path: `${docs}/Pricing sketch.md`,
  text: "# Pricing sketch\n\nPer-plate pricing for the sandbox, to discuss on Friday.\n",
};
const billing = "Contexts/Agency/Projects/Beacon Billing/Documents/Billing Spec.md";
const findings = `${docs}/Rate limit findings.md`;
const decision = "- 2026-09-30 · Dry run first, live after [[Sofie Claes]] confirms the rate rule";
/** What a capture run edits: two notes (the Billing Spec's decision, the findings' status), and what it answered. */
export const capture = {
  subject: "Pricing check",
  reason: "Decision: dry run first, live after Sofie confirms the rate rule",
  files: [
    { path: billing, before: texts[billing], after: `${texts[billing]}\n## Decisions\n${decision}\n` },
    {
      path: findings,
      before: texts[findings],
      after: texts[findings].replace(
        "Go live in sprint 24.",
        "Dry run in sprint 24 against the sandbox.\nLive once Sofie confirms the rate rule.",
      ),
    },
  ],
};
const portal = "Contexts/Agency/Projects/Northwind Portal/Documents/Portal Architecture.md";
const sync = `${meetingDir}/2026-09-30 Portal sync.md`;
/** The feed K6 shows: the capture run open, one more open entry, two kept ones. The notes hold the text after them. */
export function seedChanges() {
  const entry = (
    id: number,
    source: string,
    subject: string,
    reason: string,
    hours: number,
    files: typeof capture.files,
    state = "open",
  ) => ({
    id: `${NOW - hours * HOUR}-${id}`,
    at: NOW - hours * HOUR,
    source,
    subject,
    reason,
    files: files.map(f => ({ ...f, state })),
  });
  const filed = {
    path: portal,
    before: texts[portal],
    after: `${texts[portal]}\n## Follow-ups\n- Retest the rate limit from the new outbound IP.\n`,
  };
  const wrapped = { path: sync, before: texts[sync], after: `${texts[sync]}\nNext: retest on Friday.\n` };
  return [
    entry(1, "capture", capture.subject, capture.reason, 0.2, capture.files),
    entry(2, "capture", "Hosting migration", "Filed 1 follow-up from the migration chat", 1, [filed]),
    entry(3, "action:summarise", "Portal sync", "Added a one-line next step", 20, [wrapped], "kept"),
    entry(
      4,
      "capture",
      "Start the security audit",
      "Decision: audit starts in sprint 25",
      60,
      [{ path: portal, before: texts[portal], after: texts[portal] }],
      "kept",
    ),
  ];
}
