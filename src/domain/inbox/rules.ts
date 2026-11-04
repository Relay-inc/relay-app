// The Inbox: notes dropped in without a place (src-tauri/src/inbox.rs), and what Claude proposes for them.
export const INBOX = "Inbox";
export type InboxNote = { path: string; text: string; modified: number };
/** What Claude proposes for one Inbox note: `dest` "Inbox" keeps it where it is. */
export type FilingItem = { path: string; title: string; type: string; dest: string; links: { k: string; v: string }[] };

/** A note's file name as the rows show it: `2026-11-04 1432.md`. */
export const fileName = (path: string) => path.split("/").pop() ?? path;

/** What a note says, on one line, without its frontmatter: the quote in a row. */
export function rawText(text: string, max = 140) {
  const body = text.startsWith("---\n") ? text.replace(/^---\n[\s\S]*?\n---\n?/, "") : text;
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A proposal that leaves the note where it is (a note too short to file, or a folder picked as Keep in Inbox/). */
export const keeps = (item: FilingItem) => item.dest === INBOX;

/** The folders of a workspace that hold notes, from their paths: no hidden or system folder, not the Inbox itself,
 *  with every folder above them, sorted. */
export function folderList(paths: string[]) {
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    if (!parts.length || parts[0] === INBOX || parts[0] === "System" || parts.some(part => part.startsWith(".")))
      continue;
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  return [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

/** One line of the destination picker. `home`: the type this folder is the home of. */
export type Choice = { path: string; home?: string };
const MORE = 6;

/** The picker's folders: the one picked, the home of the note's type, then the folders that match what is typed (a few,
 *  or all of them once Browse folders is clicked). */
export function choices(o: {
  current: string;
  kind: string;
  home: string | null;
  folders: string[];
  query: string;
  all: boolean;
}): Choice[] {
  const out: Choice[] = [];
  const add = (path: string, home?: string) => {
    if (!path || path === INBOX) return;
    const known = out.find(choice => choice.path === path);
    if (known) known.home ??= home;
    else out.push(home ? { path, home } : { path });
  };
  const home = o.home ? o.home : null;
  add(o.current, home === o.current ? o.kind : undefined);
  if (home) add(home, o.kind);
  const q = o.query.trim().toLowerCase();
  const rest = o.folders.filter(folder => !q || folder.toLowerCase().includes(q));
  for (const folder of o.all ? rest : rest.slice(0, MORE)) add(folder);
  return out;
}

const two = (n: number) => String(n).padStart(2, "0");
/** The name quick capture gives a note made now, as the backend does: `Inbox/2026-11-04 1432.md`. */
export const captureName = (now: Date) =>
  `${INBOX}/${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}${two(now.getMinutes())}.md`;
