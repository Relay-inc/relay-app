import test from "node:test";
import assert from "node:assert/strict";
import {
  commonFolder,
  evaluate,
  grouped,
  isDerived,
  linkOptions,
  lanes,
  newView,
  range,
  readView,
  scoped,
  stageOf,
  type Row,
} from "./rules.ts";

const row = (p: string, k: string, props: Record<string, string[]>, extra: Partial<Row> = {}): Row => ({
  p,
  t: p.split("/").pop()!.replace(/\.md$/, ""),
  k,
  at: 1_700_000_000,
  date: "",
  stage: "",
  props,
  ...extra,
});
const meeting = (day: string, about: string, stage: Row["stage"], context = "Studio") =>
  row(
    `Calendar/Meetings/2026/${day} ${about} sync.md`,
    "Meeting",
    { about: [about], context: [context] },
    { date: day, stage },
  );
const rows = [
  meeting("2026-10-08", "Beacon", "planned"),
  meeting("2026-09-24", "Beacon", "wrapped"),
  meeting("2026-10-02", "Atlas", "wrapped"),
  meeting("2026-10-03", "Beacon", "wrapped", "Clients"),
  row("Contexts/Studio/Beacon.md", "Project", { status: ["Active"], context: ["Studio"] }),
  row("Contexts/Studio/Atlas.md", "Product", { status: ["active"], context: ["Studio"] }),
  row("Contexts/Studio/Old.md", "Project", { status: ["Paused"], context: ["Studio"] }),
  row("Contexts/Studio/Brief.md", "Document", { context: ["Studio"] }),
  row("Loose.md", "", {}),
];

test("meetings in a context are every type: Meeting note with that context:, newest first", () => {
  const list = evaluate(rows, newView("meetings", "Studio"));
  assert.deepEqual(
    list.map(r => r.date),
    ["2026-10-08", "2026-10-02", "2026-09-24"],
  );
  assert.equal(scoped(rows, newView("meetings")).length, 4); // any context
});

test("a filter about: narrows it, a date range too", () => {
  const view = newView("meetings", "Studio", [{ key: "about", is: "beacon" }]);
  assert.equal(evaluate(rows, view).length, 2);
  view.filters.push({ key: "date", from: "2026-10-01", to: "2026-12-31" });
  assert.deepEqual(
    evaluate(rows, view).map(r => r.date),
    ["2026-10-08"],
  );
});

test("a sort puts a row without the value last, either way", () => {
  const view = { ...newView("projects", "Studio"), sort: { key: "status", dir: "desc" as const } };
  const list = evaluate([...rows, row("Contexts/Studio/NoStatus.md", "Project", { context: ["Studio"] })], view);
  assert.equal(list.at(-1)?.t, "NoStatus");
  assert.equal(list[0].t, "Old");
});

test("projects take the portfolio types, documents the other typed notes, an untyped note neither", () => {
  assert.deepEqual(
    evaluate(rows, newView("projects"))
      .map(r => r.t)
      .sort(),
    ["Atlas", "Beacon", "Old"],
  );
  assert.deepEqual(
    evaluate(rows, newView("documents")).map(r => r.t),
    ["Brief"],
  );
});

test("a board by status has the four lanes, files a row by its value whatever the case, and a lane for none", () => {
  const list = evaluate(
    [...rows, row("Contexts/Studio/NoStatus.md", "Project", { context: ["Studio"] })],
    newView("projects", "Studio"),
  );
  const out = lanes(list, "status", "projects");
  assert.deepEqual(
    out.map(l => l.value),
    ["Active", "Blocked", "Quiet", "Paused", ""],
  );
  assert.deepEqual(
    out[0].rows.map(r => r.t),
    ["Atlas", "Beacon"],
  );
});

test("a meeting's stage is derived: three lanes always, and not editable", () => {
  const list = evaluate(rows, newView("meetings", "Studio"));
  assert.deepEqual(
    lanes(list, "stage", "meetings").map(l => [l.value, l.rows.length]),
    [
      ["planned", 1],
      ["briefed", 0],
      ["wrapped", 2],
    ],
  );
  assert.ok(isDerived("meetings", "stage"));
  assert.ok(!isDerived("projects", "status"));
});

test("a past meeting that is not wrapped is a lane of its own", () => {
  const list = evaluate(rows, newView("meetings", "Studio"));
  assert.deepEqual(
    lanes(list, "stage", "meetings", "2026-10-05").map(l => [l.value, l.rows.length]),
    [
      ["planned", 1],
      ["briefed", 0],
      ["wrapped", 2],
    ],
  );
  assert.deepEqual(
    lanes(list, "stage", "meetings", "2026-10-20").map(l => [l.value, l.rows.length]),
    [
      ["planned", 0],
      ["briefed", 0],
      ["wrapped", 2],
      ["unwrapped", 1],
    ],
  );
  assert.equal(stageOf(list[0], "2026-10-09"), "unwrapped");
  assert.equal(stageOf(list[1], "2026-10-09"), "wrapped");
});

test("grouping a table drops the empty groups", () => {
  assert.deepEqual(
    grouped(evaluate(rows, newView("projects")), "status", "projects").map(g => g.value),
    ["Active", "Paused"],
  );
  assert.equal(grouped(rows, "", "projects").length, 1);
});

test("a view read from a file keeps what fits and refuses what is not a collection", () => {
  assert.equal(readView({ collection: "nope" }), null);
  assert.deepEqual(
    readView({
      collection: "people",
      layout: "board",
      filters: [{ key: "a", is: "b" }, 3],
      sort: { key: "title", dir: "asc" },
    }),
    {
      collection: "people",
      context: "",
      layout: "board",
      filters: [{ key: "a", is: "b" }],
      sort: { key: "title", dir: "asc" },
      group: "",
    },
  );
});

test("date presets", () => {
  assert.deepEqual(range("date", "quarter", "2026-11-04"), { key: "date", from: "2026-10-01", to: "2026-12-31" });
  assert.deepEqual(range("date", "month", "2026-02-10"), { key: "date", from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(range("date", "days30", "2026-11-04"), { key: "date", from: "2026-10-05", to: "2026-11-04" });
});

test("the folder the notes share", () => {
  assert.equal(commonFolder(evaluate(rows, newView("meetings"))), "Calendar/Meetings/2026/");
  assert.equal(commonFolder(rows), "");
});

test("a links cell offers the projects of its type and what the rows name already", () => {
  assert.deepEqual(linkOptions(rows, "about"), ["Atlas", "Beacon", "Old"]);
  assert.deepEqual(linkOptions([...rows, row("People/Sofie Claes.md", "Person", {})], "with"), ["Sofie Claes"]);
});

test("the linked filter is the tree group's rule: about: or context:, outside its folder, a person named in with:", () => {
  const all = [
    row("Calendar/M/2026-10-01 A.md", "Meeting", { about: ["Beacon"], with: ["Sofie Claes"] }, { date: "2026-10-01" }),
    row("Calendar/M/2026-09-01 B.md", "Meeting", { context: ["Beacon"] }, { date: "2026-09-01" }),
    row("Calendar/M/2026-08-01 C.md", "Meeting", { about: ["Atlas"] }),
    row("Contexts/S/Beacon/Documents/Own.md", "Document", { about: ["Beacon"] }),
    row("Resources/Ref.md", "Reference", { about: ["Beacon"] }),
    row("Resources/Loose.md", "", { about: ["Beacon"] }),
    row("Contexts/S/Beacon/Beacon.md", "Project", { context: ["Beacon"] }),
    row("People/Sofie Claes.md", "Person", {}),
    row("People/Tom Willems.md", "Person", { about: ["Atlas"] }),
  ];
  const filters = [{ key: "linked", is: "Beacon", outside: "Contexts/S/Beacon" }];
  const names = (c: "meetings" | "documents" | "people") => evaluate(all, { ...newView(c, "", filters) }).map(r => r.t);
  assert.deepEqual(names("meetings"), ["2026-10-01 A", "2026-09-01 B"]);
  assert.deepEqual(names("documents").sort(), ["Loose", "Ref"]); // untyped counts, the project's own folder does not
  assert.deepEqual(names("people"), ["Sofie Claes"]);
});
