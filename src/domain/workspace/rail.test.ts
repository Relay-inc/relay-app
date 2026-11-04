import test from "node:test";
import assert from "node:assert/strict";
import { aboutOf, headingAt, linkMention, outlineOf, touchedBy } from "./rail.ts";

test("outline: headings with their file line, no frontmatter, no code, the title left out", () => {
  const text =
    "---\ntitle: x\n# not a heading\n---\n# Title\n\n## Briefing\n```\n## in code\n```\n### Notes ##\ntext\n## Summary\n# Second h1";
  assert.deepEqual(outlineOf(text), [
    { level: 2, title: "Briefing", line: 7 },
    { level: 3, title: "Notes", line: 11 },
    { level: 2, title: "Summary", line: 13 },
    { level: 1, title: "Second h1", line: 14 },
  ]);
  assert.deepEqual(outlineOf("no headings"), []);
});

test("the heading a line is under", () => {
  const outline = outlineOf("# T\n## A\ntext\n## B\ntext");
  assert.equal(headingAt(outline, 1), -1);
  assert.equal(headingAt(outline, 3), 0);
  assert.equal(headingAt(outline, 4), 1);
  assert.equal(headingAt(outline, 5), 1);
});

test("about: a wikilink, a plain value, a list", () => {
  assert.equal(aboutOf('type: Meeting\nabout: "[[Beacon|the beacon]]"\nwith: x'), "Beacon");
  assert.equal(aboutOf("about: Beacon\nwith: x"), "Beacon");
  assert.equal(aboutOf('about:\n  - "[[Beacon]]"\n  - "[[Other]]"\nwith: x'), "Beacon");
  assert.equal(aboutOf("about: [Beacon, Other]"), "Beacon");
  assert.equal(aboutOf("type: Meeting"), "");
});

test("linking a mention wraps the text, keeping what was written", () => {
  const text = "a\n09:30 Beacon sync with Sam, see [[Beacon sync]] too\nc";
  assert.equal(
    linkMention(text, 2, "Beacon sync", "Beacon sync"),
    "a\n09:30 [[Beacon sync]] with Sam, see [[Beacon sync]] too\nc",
  );
  assert.equal(linkMention("the beacon SYNC", 1, "beacon SYNC", "Beacon sync"), "the [[Beacon sync|beacon SYNC]]");
  // only the plain one, and only when it is still there
  assert.equal(linkMention("see [[Beacon sync]]", 1, "Beacon sync", "Beacon sync"), null);
  assert.equal(linkMention("changed", 1, "Beacon sync", "Beacon sync"), null);
  assert.equal(linkMention("one line", 3, "one", "x"), null);
});

test("conversations that touched a note: each once, newest first, this note and workspace only", () => {
  const t = (key: string, path: string, at: number, kind: "read" | "write" = "read", root = "/v") => ({
    key,
    root,
    path,
    at,
    kind,
  });
  const got = touchedBy(
    [
      t("a", "n.md", 1),
      t("a", "n.md", 5, "write"),
      t("b", "n.md", 3),
      t("c", "other.md", 9),
      t("d", "n.md", 8, "read", "/w"),
    ],
    "/v",
    "n.md",
  );
  assert.deepEqual(
    got.map(x => [x.key, x.at, x.kind]),
    [
      ["a", 5, "write"],
      ["b", 3, "read"],
    ],
  );
});
