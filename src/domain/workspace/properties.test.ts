import { test } from "node:test";
import assert from "node:assert/strict";
import {
  frontmatterOf,
  moveProperty,
  readProperties,
  removeProperty,
  setProperty,
  withFrontmatter,
} from "./properties.ts";

// the frontmatter of the vault's own templates and notes (keys only, no content)
const PRODUCT = `lastSync: Sun Apr 05 2026 22:21:55 GMT+0200 (Central European Summer Time)
type: Product
context:
parent:
priority:
product-status:
product-stage:
aliases:
tags:
cover:
archive: false
created: <% tp.date.now("YYYY-MM-DD") %>
modified:
cssclasses:`;
const MEETING = `type: Meeting
context:
about:
with:
aliases:
one-liner:
created: <% tp.date.now("YYYY-MM-DD") %>
modified:`;
const NOTE = `type: Product
context: "[[Personal]]"
parent:
product-status: Active
aliases:
  - "Relay"
  - "vault-app"
archive: false
created: 2026-10-01`;
// comments, unusual quoting, an inline list, a folded string and a nested map
const ODD = `# kept on top
title: 'It''s: odd'
status: "Active"   # trailing comment
tags: [a, "b c"]
summary: >
  folded
  text
# above meta
meta:
  nested: 1
done: no`;

const changed = (before: string, after: string) => {
  const a = before.split("\n");
  const b = after.split("\n");
  return { removed: a.filter(l => !b.includes(l)), added: b.filter(l => !a.includes(l)) };
};

test("setting one key rewrites only its line, in every fixture", () => {
  for (const yaml of [PRODUCT, MEETING, NOTE, ODD]) {
    const key = yaml.includes("\nstatus:") ? "status" : "context";
    const after = setProperty(yaml, key, "Blocked");
    assert.equal(after.split("\n").length, yaml.split("\n").length, yaml);
    const diff = changed(yaml, after);
    assert.equal(diff.added.length, 1, after);
    assert.equal(diff.added[0], `${key}: Blocked`);
  }
});

test("comments, quoting and untouched keys survive an edit elsewhere", () => {
  const after = setProperty(ODD, "done", true);
  assert.equal(after, ODD.replace("done: no", "done: true"));
});

test("a wikilink is written double-quoted, a new key goes at the end", () => {
  assert.equal(setProperty(NOTE, "about", "[[Northwind Portal]]"), NOTE + '\nabout: "[[Northwind Portal]]"');
  assert.equal(setProperty(NOTE, "context", "[[Antenna]]"), NOTE.replace('"[[Personal]]"', '"[[Antenna]]"'));
});

test("lists and empty values", () => {
  const list = setProperty(NOTE, "aliases", ["Relay", "Relay app"]);
  assert.match(list, /aliases:\n {2}- Relay\n {2}- Relay app\narchive: false/);
  assert.equal(setProperty(NOTE, "product-status", null), NOTE.replace("product-status: Active", "product-status:"));
  assert.equal(setProperty(NOTE, "aliases", []), NOTE.replace(/aliases:\n.*\n.*"vault-app"/, "aliases:"));
});

test("remove and move take a key's whole block and nothing else", () => {
  assert.equal(removeProperty(NOTE, "aliases"), NOTE.replace(/aliases:\n.*\n.*"vault-app"\n/, ""));
  const moved = moveProperty(NOTE, "aliases", "type");
  assert.ok(moved.startsWith('aliases:\n  - "Relay"\n  - "vault-app"\ntype: Product'));
  assert.equal(moved.length, NOTE.length);
  assert.ok(moveProperty(NOTE, "type", null).endsWith("created: 2026-10-01\ntype: Product"));
  // a comment above a key stays in place when the key moves
  assert.ok(moveProperty(ODD, "meta", "title").includes("# above meta\ndone: no"));
});

test("reading: kinds per value, unparseable YAML is not editable", () => {
  const rows = readProperties(NOTE)!;
  assert.deepEqual(
    rows.map(r => [r.key, r.kind]),
    [
      ["type", "text"],
      ["context", "link"],
      ["parent", "text"],
      ["product-status", "text"],
      ["aliases", "list"],
      ["archive", "check"],
      ["created", "date"],
    ],
  );
  assert.deepEqual(rows[4].value, ["Relay", "vault-app"]);
  assert.equal(readProperties(ODD)!.find(r => r.key === "meta")!.kind, "raw");
  // a hand-written line YAML refuses is that key's text; the other keys stay editable, and an edit quotes it
  const loose = "type: Document\ndescription: bills a client: monthly\nstatus: Active";
  assert.deepEqual(readProperties(loose)![1], { key: "description", value: "bills a client: monthly", kind: "text" });
  assert.equal(setProperty(loose, "status", "Blocked"), loose.replace("Active", "Blocked"));
  assert.equal(setProperty(loose, "description", "a: b"), loose.replace("bills a client: monthly", '"a: b"'));
  // something that is no key at all: not editable
  assert.equal(readProperties("  indented: first"), null);
  assert.equal(setProperty("  indented: first", "a", "x"), "  indented: first");
});

test("frontmatter in a head: read, replace, add when missing", () => {
  const head = `---\n${NOTE}\n---\n# Relay\n`;
  assert.equal(frontmatterOf(head), NOTE);
  assert.equal(withFrontmatter(head, "type: X"), "---\ntype: X\n---\n# Relay\n");
  assert.equal(withFrontmatter("# Relay\n", "type: X"), "---\ntype: X\n---\n# Relay\n");
  assert.equal(frontmatterOf("# Relay\n"), null);
});
