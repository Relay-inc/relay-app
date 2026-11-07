import { test } from "node:test";
import assert from "node:assert/strict";
import { headerOf, plural, relations } from "./header.ts";
import { SHIPPED } from "./registry.ts";
import { readProperties } from "../workspace/properties.ts";
import { linkOptions, type Row } from "../collections/rules.ts";
import type { RailNote } from "../workspace/rail.ts";

const header = (yaml: string) => headerOf(readProperties(yaml)!, SHIPPED);

test("a Meeting's header: the registry's fields with their editors, a required one it lacks as an empty slot", () => {
  const h = header(
    'type: Meeting\ncontext: "[[Northwind]]"\nwith:\n  - "[[Sofie Claes]]"\ndate: 2026-10-01\nstage: wrapped',
  );
  assert.equal(h?.type.name, "Meeting");
  assert.deepEqual(
    h?.slots.map(s => [s.field.key, s.field.kind, s.row.kind, s.missing]),
    [
      ["context", "link", "link", false],
      ["about", "link", "link", true], // where the note belongs: empty, a slot to fill
      ["with", "people", "list", false],
      ["date", "date", "date", false],
    ],
  );
  // keys outside the type stay plain properties, type: itself is the chip
  assert.deepEqual(
    h?.rest.map(r => r.key),
    ["stage"],
  );
  // what "Add property" offers first
  assert.deepEqual(
    h?.absent.map(f => f.key),
    ["language", "one-liner", "created"],
  );
  // context: is required: gone or empty, it is a highlighted slot, not an error
  for (const yaml of ["type: meeting", "type: Meeting\ncontext:"]) {
    const slot = header(yaml)?.slots.find(s => s.field.key === "context");
    assert.deepEqual([slot?.row.value, slot?.row.kind, slot?.missing], [null, "link", true]);
  }
  // a Person need not be about a project: no slot for it
  assert.deepEqual(
    header('type: Person\ncontext: "[[Northwind]]"')?.slots.map(s => s.field.key),
    ["context"],
  );
  // a Project's status is a select of the registry's values
  const status = header("type: Project\nstatus: Active")?.slots.find(s => s.field.key === "status");
  assert.deepEqual([status?.row.kind, status?.row.values?.length], ["select", 5]);
});

test("a note without type:, or of a type the registry does not know, keeps its plain properties", () => {
  assert.equal(header("context: x\nstatus: Active"), null);
  assert.equal(header("type: Recipe"), null);
});

test("a link field offers only the notes of its target types", () => {
  const row = (p: string, k: string, props: Record<string, string[]> = {}): Row => ({
    p,
    t: p.split("/").pop()!.replace(/\.md$/, ""),
    k,
    at: 0,
    date: "",
    stage: "",
    props,
  });
  const rows = [
    row("Contexts/Northwind/People/Sofie Claes.md", "Person"),
    row("Contexts/Northwind/People/Tom Willems.md", "person"),
    row("Contexts/Northwind/Northwind.md", "Context"),
    row("Contexts/Northwind/Projects/Portal/Portal.md", "Project"),
    row("Calendar/2026-10-01 Sync.md", "Meeting", { with: ["Lena"] }),
  ];
  assert.deepEqual(linkOptions(rows, "with", ["Person"]), ["Sofie Claes", "Tom Willems"]);
  assert.deepEqual(linkOptions(rows, "about", ["Project", "Context"]), ["Northwind", "Portal"]);
  // without a target the collections' old rule: the key's guess and the names the rows already use
  assert.deepEqual(linkOptions(rows, "with"), ["Lena", "Sofie Claes", "Tom Willems"]);
});

test("backlinks through a typed field are grouped by type and field, the others stay plain", () => {
  const note = (p: string, k: string, f?: string): RailNote => ({
    p,
    t: p,
    k,
    line: 1,
    before: "",
    hit: "",
    after: "",
    f,
  });
  const { groups, rest } = relations(
    [
      note("a", "Meeting", "about"),
      note("b", "Document", "about"),
      note("c", "Meeting", "about"),
      note("d", "Meeting"), // a link in the body
      note("e", "Meeting", "tags"), // a key the type does not have
      note("f", "Recipe", "about"), // a type the registry does not know
      note("g", "Meeting", "date"), // not a link field
    ],
    SHIPPED,
  );
  assert.deepEqual(
    groups.map(g => [g.kind, g.key, g.notes.map(n => n.p).join("")]),
    [
      ["Meeting", "about", "ac"],
      ["Document", "about", "b"],
    ],
  );
  assert.deepEqual(
    rest.map(n => n.p),
    ["d", "e", "f", "g"],
  );
  assert.deepEqual([plural("Meeting"), plural("Person")], ["Meetings", "People"]);
});
