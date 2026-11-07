import test from "node:test";
import assert from "node:assert/strict";
import { findBaseBlocks, parseStatement, readBase, showBase, viewOf, type Base } from "./bases.ts";
import type { Row } from "./rules.ts";

const row = (p: string, props: Record<string, string[]>, extra: Partial<Row> = {}): Row => ({
  p,
  t: p.split("/").pop()!.replace(/\.md$/, ""),
  k: props.type?.[0] ?? "",
  at: 1_700_000_000,
  date: "",
  stage: "",
  props,
  ...extra,
});
const rows = [
  row("Calendar/Meetings/2026-10-08 Kickoff.md", {
    type: ["Meeting"],
    about: ["Northwind Portal"],
    date: ["2026-10-08"],
  }),
  row("Calendar/Meetings/2026-10-20 Review.md", {
    type: ["Meeting"],
    about: ["Northwind Portal"],
    date: ["2026-10-20"],
  }),
  row(
    "Calendar/Meetings/2026-10-12 Sync.md",
    { type: ["Meeting"], about: ["Atlas"], date: ["2026-10-12"] },
    { stage: "wrapped" },
  ),
  row(
    "Contexts/Agency/Northwind Portal.md",
    { type: ["Project"], status: ["Active"], tags: ["client"] },
    {
      links: ["Atlas", "Sofie Claes"],
      tags: ["client"],
    },
  ),
];
const PAGE = { path: "Contexts/Agency/Northwind Portal.md" };
const MEETINGS = `filters:
  and:
    - type == "Meeting"
    - about.contains(this)
views:
  - type: table
    name: Meetings
    order:
      - file.name
      - date
    sort:
      - property: date
        direction: DESC
`;
const base = (text: string) => {
  const read = readBase(text);
  assert.ok("base" in read, JSON.stringify(read));
  return read.base;
};
const names = (b: Base, here = PAGE, view = "") => {
  const shown = showBase(b, viewOf(b, view), rows, here);
  assert.ok(!("unsupported" in shown), JSON.stringify(shown));
  return shown.rows.map(r => r.t);
};

test("a page's meetings: `this` is the page the block is in, so the same block lists another project's on its page", () => {
  const b = base(MEETINGS);
  assert.deepEqual(viewOf(b).order, ["file.name", "date"]);
  assert.deepEqual(names(b), ["2026-10-20 Review", "2026-10-08 Kickoff"]);
  assert.deepEqual(names(b, { path: "Contexts/Agency/Atlas.md" }), ["2026-10-12 Sync"]);
});

test("the statements of the subset", () => {
  const with_ = (filter: string) => names(base(`filters: '${filter.replace(/'/g, "''")}'\nviews:\n  - type: table\n`));
  assert.deepEqual(with_("about == this"), ["2026-10-08 Kickoff", "2026-10-20 Review"]);
  assert.deepEqual(with_('note.about == link("Atlas")'), ["2026-10-12 Sync"]);
  assert.deepEqual(with_('date >= "2026-10-12"'), ["2026-10-12 Sync", "2026-10-20 Review"]);
  assert.deepEqual(with_('file.hasLink("Sofie Claes")'), ["Northwind Portal"]);
  assert.deepEqual(with_('file.hasTag("#client")'), ["Northwind Portal"]);
  assert.deepEqual(with_('file.ext == "md"').length, 4);
  assert.deepEqual(
    names(
      base(
        `filters:\n  and:\n    - file.ext == "md"\n    - not:\n        - file.inFolder("Calendar")\nviews:\n  - type: table\n`,
      ),
    ),
    ["Northwind Portal"],
  );
  assert.deepEqual(
    names(base(`filters:\n  or:\n    - status == "Active"\n    - about == "Atlas"\nviews:\n  - type: table\n`)),
    ["2026-10-12 Sync", "Northwind Portal"],
  );
  // `stage` is worked out by Relay, not a property: a base sees only what the frontmatter says
  assert.deepEqual(with_('stage == "wrapped"'), []);
});

test("outside the subset: unsupported, never a wrong result", () => {
  const no = (text: string) => assert.ok("unsupported" in readBase(text), text);
  no("formulas:\n  x: 'price * 2'\nviews:\n  - type: table\n");
  no("views:\n  - type: cards\n");
  no("filters: 'file.mtime > now() - \"1 week\"'\nviews:\n  - type: table\n");
  no("filters: 'status != \"done\" && priority > 1'\nviews:\n  - type: table\n");
  no("views:\n  - type: table\n    order: [formula.ppu]\n");
  no("views:\n  - type: table\n    summaries:\n      price: Average\n");
  no("views: [");
  // a base that could list attachments too (Relay's rows are notes only)
  const b = base(`filters:\n  not:\n    - file.inFolder("Calendar")\nviews:\n  - type: table\n`);
  assert.ok("unsupported" in showBase(b, viewOf(b), rows, PAGE));
  assert.throws(() => parseStatement("file.backlinks.contains(this)"));
});

test("limit, groupBy and a view picked by name", () => {
  const b = base(
    `views:\n  - type: table\n    name: Meetings\n  - type: table\n    name: By project\n    filters: type == "Meeting"\n    limit: 2\n    groupBy:\n      property: about\n      direction: ASC\n`,
  );
  const shown = showBase(b, viewOf(b, "By project"), rows, PAGE);
  assert.ok(!("unsupported" in shown));
  assert.equal(shown.total, 3);
  assert.deepEqual(
    shown.groups.map(g => [g.value, g.rows.map(r => r.t)]),
    [
      ["Atlas", ["2026-10-12 Sync"]],
      ["Northwind Portal", ["2026-10-08 Kickoff"]],
    ],
  );
  assert.equal(viewOf(b, "Nope").name, "Meetings");
});

test("fenced base blocks are found with their YAML, other fences are not", () => {
  const text = "# P\n\n```base\nviews:\n  - type: table\n```\n\n```js\nx\n```\n~~~~base\nfilters: a == 1\n~~~~\n";
  const found = findBaseBlocks(text);
  assert.deepEqual(
    found.map(b => b.source),
    ["views:\n  - type: table\n", "filters: a == 1\n"],
  );
  assert.equal(text.slice(found[0].from, found[0].to), "```base\nviews:\n  - type: table\n```");
});
