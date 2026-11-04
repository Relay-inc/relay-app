import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clock,
  dropText,
  findEmbeds,
  headingAt,
  parseOptions,
  pastedName,
  section,
  withWidth,
  withoutProperties,
} from "./embeds.ts";

test("embeds: wiki and markdown forms with their caption, width and heading", () => {
  const text =
    "a ![[shot.png|a chart|300]] b ![[Plan#Rate limits]] c ![alt|120](Attachments/x%20y.png) d ![web](https://x.test/a.png) e [[link]]";
  const found = findEmbeds(text);
  assert.deepEqual(
    found.map(({ form, target, heading, alt, width }) => ({ form, target, heading, alt, width })),
    [
      { form: "wiki", target: "shot.png", heading: "", alt: "a chart", width: 300 },
      { form: "wiki", target: "Plan", heading: "Rate limits", alt: "", width: null },
      { form: "md", target: "Attachments/x y.png", heading: "", alt: "alt", width: 120 },
    ],
  );
  assert.equal(text.slice(found[0].from, found[0].to), "![[shot.png|a chart|300]]");
  assert.deepEqual(parseOptions("300"), { alt: "", width: 300 });
  assert.deepEqual(parseOptions("a caption"), { alt: "a caption", width: null });
});

test("a width written by the handle: added, replaced, after a caption, on a markdown image", () => {
  assert.equal(withWidth("![[x.png]]", 560), "![[x.png|560]]");
  assert.equal(withWidth("![[x.png|300]]", 560.4), "![[x.png|560]]");
  assert.equal(withWidth("![[x.png|a chart|300]]", 200), "![[x.png|a chart|200]]");
  assert.equal(withWidth("![[x.png|a chart]]", 200), "![[x.png|a chart|200]]");
  assert.equal(withWidth("![a chart](x.png)", 200), "![a chart|200](x.png)");
  assert.equal(withWidth("![](x.png)", 200), "![200](x.png)");
});

const NOTE =
  "---\ntype: Document\n---\n# Findings\nintro\n\n## Rate limits\n- 60 per minute\n- cache 24 h\n\n### Detail\nmore\n\n## Other\nx\n";
test("a note's section: from its heading to the next of the same or a higher level", () => {
  const s = section(NOTE, "Rate limits")!;
  assert.equal(s.title, "Rate limits");
  assert.equal(s.body, "- 60 per minute\n- cache 24 h\n\n### Detail\nmore");
  assert.equal(NOTE.slice(s.at, s.at + 12), "## Rate limi");
  assert.equal(section(NOTE, "rate LIMITS")?.body, s.body);
  assert.equal(section(NOTE, "Other")?.body, "x");
  assert.equal(section(NOTE, "Missing"), null);
  assert.equal(headingAt(NOTE, "Other"), NOTE.indexOf("## Other"));
  assert.equal(withoutProperties(NOTE).startsWith("# Findings"), true);
  // a # inside a code fence is not a heading
  assert.equal(section("## A\n```\n# B\n```\nz\n## C", "A")?.body, "```\n# B\n```\nz");
});

test("a pasted picture is named Pasted image <stamp>.<ext>, any other file keeps its name", () => {
  const at = new Date(2026, 10, 4, 9, 5, 7);
  assert.equal(pastedName({ name: "image.png", type: "image/png" }, at), "Pasted image 20261104090507.png");
  assert.equal(pastedName({ name: "x", type: "image/jpeg" }, at), "Pasted image 20261104090507.jpg");
  assert.equal(pastedName({ name: "Quote.pdf", type: "application/pdf" }, at), "Quote.pdf");
  assert.equal(pastedName({ name: "", type: "application/zip" }, at), "Pasted file 20261104090507");
});

test("the audio clock and the drop text", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(1934.6), "32:14");
  assert.equal(clock(3723), "1:02:03");
  assert.deepEqual(dropText("one\ntwo\n", 4, ["a.png", "b.pdf"]), { from: 4, insert: "![[a.png]]\n![[b.pdf]]\n" });
  assert.deepEqual(dropText("one", 3, ["a.png"]), { from: 3, insert: "\n![[a.png]]\n" });
  assert.deepEqual(dropText("", 0, ["a.png"]), { from: 0, insert: "![[a.png]]\n" });
});
