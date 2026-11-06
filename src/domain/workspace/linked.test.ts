import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTypes, type NoteType } from "./noteTypes.ts";
import { attendees, linkedTo, shownSections, typedIn, unsortedOf, type LinkedNote } from "./linked.ts";

// the registry the app ships: what counts as a project comes from it
setTypes(
  JSON.parse(readFileSync(new URL("../../../src-tauri/resources/types.json", import.meta.url), "utf8")) as NoteType[],
);

const note = (p: string, o: Partial<LinkedNote> = {}): LinkedNote => ({
  p,
  t: p.split("/").pop()!.replace(/\.md$/, ""),
  k: "Document",
  at: 1,
  about: [],
  context: [],
  with: [],
  date: "",
  stage: "",
  role: "",
  ...o,
});
const meeting = (day: string, o: Partial<LinkedNote> = {}) =>
  note(`Calendar/Meetings/2026/${day} Sync.md`, { k: "Meeting", date: day, stage: "wrapped", ...o });

test("a meeting about a project is in its Meetings, newest first, and nowhere else", () => {
  const notes = [
    meeting("2026-10-28", { about: ["Beacon"] }),
    meeting("2026-11-04", { about: ["Beacon"], with: ["Sam Peeters"] }),
    meeting("2026-11-05", { about: ["Harbor"] }),
  ];
  assert.deepEqual(
    linkedTo(notes, "Beacon", "Contexts/Studio/Beacon").meetings.map(n => n.date),
    ["2026-11-04", "2026-10-28"],
  );
  assert.equal(linkedTo(notes, "Northwind").meetings.length, 0);
});

test("a note in two projects' about: shows in both", () => {
  const both = meeting("2026-11-04", { about: ["Beacon", "Harbor"] });
  assert.equal(linkedTo([both], "Beacon").meetings.length, 1);
  assert.equal(linkedTo([both], "Harbor").meetings.length, 1);
});

test("a link goes by the note's name: a path, an extension and case do not matter", () => {
  const n = meeting("2026-11-04", { about: ["Contexts/Studio/beacon.md"] });
  assert.equal(linkedTo([n], "Beacon").meetings.length, 1);
});

test("documents in the project's own folder are left out, the others group by kind", () => {
  const notes = [
    note("Contexts/Studio/Beacon/Documents/Plan.md", { about: ["Beacon"] }),
    note("Resources/Reference/Pricing.md", { about: ["Beacon"], at: 5 }),
    note("Calendar/Threads/Mail.md", { k: "Thread", context: ["Beacon"] }),
  ];
  const groups = linkedTo(notes, "Beacon", "Contexts/Studio/Beacon");
  assert.deepEqual(
    groups.documents.map(n => n.t),
    ["Pricing"],
  );
  assert.deepEqual(
    groups.threads.map(n => n.t),
    ["Mail"],
  );
});

test("people are the person notes linked here and those named in the with: of what is linked here", () => {
  const notes = [
    meeting("2026-11-04", { about: ["Beacon"], with: ["Sam Peeters", "Noor"] }),
    note("People/Sam Peeters.md", { k: "Person", role: "Developer" }),
    note("People/Noor.md", { k: "Person", about: ["Beacon"] }),
    note("People/Lena.md", { k: "Person" }),
  ];
  assert.deepEqual(
    linkedTo(notes, "Beacon").people.map(n => n.t),
    ["Noor", "Sam Peeters"],
  );
});

test("attendees: one by full name, several by first name", () => {
  assert.equal(attendees(meeting("2026-11-04", { with: ["Sam Peeters"] })), "Sam Peeters");
  assert.equal(attendees(meeting("2026-11-04", { with: ["Sam Peeters", "Noor", "Milan Jacobs"] })), "Sam, Noor, Milan");
  assert.equal(attendees(meeting("2026-11-04")), "");
});

test("a project with only meetings shows only the Meetings section", () => {
  const groups = linkedTo([meeting("2026-11-04", { about: ["Beacon"] })], "Beacon");
  assert.deepEqual(
    shownSections({ meetings: groups.meetings, documents: groups.documents, people: groups.people, reminders: [] }),
    ["meetings"],
  );
  assert.deepEqual(shownSections({ meetings: [], documents: [] }), []);
});

test("at a context, projects are a group of their own and not also documents; at a project they stay documents", () => {
  const notes = [
    note("Contexts/Studio/Projects/Harbor.md", { k: "Project", context: ["Studio"] }),
    note("Contexts/Studio/Documents/Brand.md", { context: ["Studio"] }),
  ];
  const context = linkedTo(notes, "Studio", "", true);
  assert.deepEqual(
    context.projects.map(n => n.t),
    ["Harbor"],
  );
  assert.deepEqual(
    context.documents.map(n => n.t),
    ["Brand"],
  );
  const project = linkedTo([note("Features/Search.md", { k: "Feature", about: ["Harbor"] })], "Harbor");
  assert.equal(project.projects.length, 0);
  assert.equal(project.documents.length, 1);
});

test("a typed note with a context and no project is in that context's type group", () => {
  const label = (k: string) => k.toUpperCase();
  const notes = [
    note("Docs/Brief.md", { k: "Document", context: ["Northwind"], at: 1 }),
    note("Docs/Plan.md", { k: "Document", context: ["Contexts/Northwind"], at: 2 }),
    meeting("2026-11-05", { context: ["Northwind"] }),
    note("Docs/InProject.md", { context: ["Northwind"], about: ["Beacon"] }),
    note("Docs/Untyped.md", { k: "", context: ["Northwind"] }),
    note("Docs/Other.md", { context: ["Harbor"] }),
  ];
  const groups = typedIn(notes, "Northwind", label, new Set());
  assert.deepEqual(
    groups.map(g => [g.type, g.notes.map(n => n.t)]),
    [
      ["DOCUMENT", ["Plan", "Brief"]],
      ["MEETING", ["2026-11-05 Sync"]],
    ],
  );
  assert.equal(typedIn(notes, "Northwind", label, new Set(["Docs/Brief.md"]))[0].notes.length, 1);
});

test("Unsorted lists the notes without a type, newest first, without the hidden ones", () => {
  const rows = [
    { p: "a.md", k: "", at: 1 },
    { p: "b.md", k: "", at: 3 },
    { p: "c.md", k: "Meeting", at: 9 },
    { p: "CLAUDE.md", k: "", at: 8 },
  ];
  assert.deepEqual(
    unsortedOf(rows, p => p === "CLAUDE.md"),
    ["b.md", "a.md"],
  );
});
