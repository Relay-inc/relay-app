// What points at a project or a context: the notes whose `about:`, `context:` or `with:` names it, grouped as the Pages
// tree's virtual groups ("linked here") and a project page's auto sections ("From links") show them. Read from the
// index (related.rs `linked`); nothing is written into any note.
import { noteName } from "../navigation/pages.ts";

/** A note that points at another: where it is, its kind (`type:`), the file's mtime (seconds), what its `about:`,
 *  `context:` and `with:` name, the date of a meeting, its stage, and a person's role. */
export type LinkedNote = {
  p: string;
  t: string;
  k: string;
  at: number;
  about: string[];
  context: string[];
  with: string[];
  date: string;
  stage: "" | "planned" | "briefed" | "wrapped";
  role: string;
};
export type LinkedGroups = {
  meetings: LinkedNote[];
  documents: LinkedNote[];
  threads: LinkedNote[];
  people: LinkedNote[];
};
export type LinkedKey = keyof LinkedGroups;
export const LINKED_KEYS: LinkedKey[] = ["meetings", "documents", "threads", "people"];
/** The newest this many rows show in the tree before "Show all". */
export const LINKED_SHOWN = 4;

// a link goes by the note's name, as in Obsidian: `Contexts/Studio/Beacon` and `Beacon.md` are both Beacon
const nameOfLink = (link: string) => noteName(link).trim().toLowerCase();
const groupOf = (note: LinkedNote): LinkedKey => {
  const kind = note.k.toLowerCase();
  return kind === "meeting" ? "meetings" : kind === "thread" ? "threads" : kind === "person" ? "people" : "documents";
};
const byNewest = (a: LinkedNote, b: LinkedNote) =>
  (b.date || "").localeCompare(a.date || "") || b.at - a.at || a.t.localeCompare(b.t);

/** The notes that point at `name` (a project's or a context's note name) through `about:` or `context:`, outside
 *  `inside` (its folder, whose own notes the tree shows already), in groups: meetings and threads, people and the rest
 *  as documents. People also include those named in the `with:` of what points here, when they have a note. A note
 *  that names two projects is in both's groups. Newest first, people by name. */
export function linkedTo(notes: LinkedNote[], name: string, inside = ""): LinkedGroups {
  const key = name.trim().toLowerCase();
  const here = notes.filter(
    note =>
      !(inside && note.p.startsWith(`${inside}/`)) &&
      nameOfLink(note.p) !== key &&
      [...note.about, ...note.context].some(link => nameOfLink(link) === key),
  );
  const out: LinkedGroups = { meetings: [], documents: [], threads: [], people: [] };
  for (const note of here) out[groupOf(note)].push(note);
  const have = new Set(out.people.map(note => note.p));
  const named = new Set(here.flatMap(note => note.with.map(nameOfLink)));
  // a person is a note with a `type: Person`; the index lists only those that point somewhere, which a person does
  for (const note of notes)
    if (groupOf(note) === "people" && !have.has(note.p) && named.has(nameOfLink(note.p))) out.people.push(note);
  for (const group of ["meetings", "documents", "threads"] as const) out[group].sort(byNewest);
  out.people.sort((a, b) => a.t.localeCompare(b.t));
  return out;
}

/** Who a meeting was with: one person by name, several by first name ("Sam, Noor, Milan"). */
export function attendees(note: LinkedNote) {
  const names = note.with.map(name => noteName(name).trim()).filter(Boolean);
  return names.length > 1 ? names.map(name => name.split(/\s+/)[0]).join(", ") : (names[0] ?? "");
}

/** Which of a page's auto sections have anything to show, in their order: an empty one is not drawn. */
export const shownSections = (sections: Record<string, unknown[]>) =>
  Object.keys(sections).filter(key => sections[key].length);
