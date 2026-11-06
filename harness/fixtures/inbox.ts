// Fixture inbox (K7, issue 372): four notes in the Inbox with the proposals Claude would make for them, and the answers of
// the backend's inbox_* commands (src-tauri/src/inbox.rs, which has its own tests). Fictional data only.
import { NOW } from "./util";

export const DIR = "Inbox";
const docs = "Contexts/Agency/Projects/Northwind Portal/Documents";
export type Proposal = { title: string; type: string; dest: string; links: { k: string; v: string }[] };
export const notes: { path: string; text: string; proposal: Proposal }[] = [
  {
    path: `${DIR}/2026-10-01 0915.md`,
    text: "Sofie confirms the tax rule Friday → then take the Northwind portal live, tell Tom\n",
    proposal: {
      title: "Portal go-live after tax rule check",
      type: "Document",
      dest: docs,
      links: [
        { k: "about", v: "Northwind Portal" },
        { k: "with", v: "Sofie Claes" },
      ],
    },
  },
  {
    path: `${DIR}/2026-10-01 0830.md`,
    text: "call tom re hosting window saturday, lena cc\n",
    proposal: {
      title: "2026-10-01 Call Tom – hosting",
      type: "Meeting",
      dest: "Calendar/Meetings/2026",
      links: [
        { k: "about", v: "Northwind Portal" },
        { k: "with", v: "Tom Willems" },
      ],
    },
  },
  {
    path: `${DIR}/2026-09-30 2210.md`,
    text: "Jonas, designer at Bluebird Studio, freelance, owns the simulator flow\n",
    proposal: {
      title: "Jonas Peeters",
      type: "Person",
      dest: "Contexts/Agency/People",
      links: [
        { k: "context", v: "Agency" },
        { k: "about", v: "Beacon Billing" },
      ],
    },
  },
  {
    path: `${DIR}/2026-09-30 1740.md`,
    text: "article on CRDTs for offline sync, read for Relay\n",
    proposal: {
      title: "CRDTs for offline sync",
      type: "Reference",
      dest: "Resources/References",
      links: [{ k: "about", v: "Northwind Portal" }],
    },
  },
];
export const paths = notes.map(n => n.path);
export const texts: Record<string, string> = Object.fromEntries(notes.map(n => [n.path, n.text]));
/** Notes of the meeting, daily and thread kinds have a home of their own in the backend (homes.rs). */
export const homes: Record<string, string> = {
  meeting: "Calendar/Meetings/2026",
  daily: "Calendar/Daily/2026",
  thread: "Calendar/Threads/2026",
};
/** The frontmatter a filed note gets, as inbox.rs `filed_text` writes it. */
export function filed(text: string, p: Proposal) {
  const links = p.links.map(l => `${l.k}: "[[${l.v}]]"`).join("\n");
  return `---\ntype: ${p.type}\n${links}\n---\n\n${text}`;
}
export const proposedAt = NOW + 60_000;
