import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasMark,
  label,
  linkOf,
  linkSelection,
  retarget,
  todoRule,
  toggleMark,
  withTarget,
  type Edit,
} from "./format.ts";

// an edit applied to the text: the changes are in the old text's offsets
const run = (text: string, edit: Edit) => {
  let out = text;
  for (const c of [...edit.changes].reverse()) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return { text: out, selected: out.slice(edit.from, edit.to) };
};

test("a mark wraps the selection and unwraps it again", () => {
  const wrapped = run("a text b", toggleMark("a text b", 2, 6, "**"));
  assert.deepEqual(wrapped, { text: "a **text** b", selected: "text" });
  assert.equal(run(wrapped.text, toggleMark(wrapped.text, 4, 8, "**")).text, "a text b");
  assert.equal(run("a text b", toggleMark("a text b", 2, 6, "~~")).text, "a ~~text~~ b");
  assert.equal(run("a text b", toggleMark("a text b", 2, 6, "`")).text, "a `text` b");
});

test("a selection that includes the spaces around it is wrapped without them", () => {
  assert.equal(run("a text b", toggleMark("a text b", 1, 7, "**")).text, "a **text** b");
});

test("italic next to a bold's asterisks is not taken for it", () => {
  assert.equal(hasMark("**x**", 2, 3, "*"), false);
  assert.equal(hasMark("**x**", 2, 3, "**"), true);
  assert.equal(run("**x**", toggleMark("**x**", 2, 3, "*")).text, "***x***");
  assert.equal(run("***x***", toggleMark("***x***", 3, 4, "*")).text, "**x**");
  assert.equal(run("***x***", toggleMark("***x***", 3, 4, "**")).text, "*x*");
});

test("a selection over lines marks each line, not the break between them", () => {
  const text = "one\ntwo\n\nthree";
  const bold = run(text, toggleMark(text, 0, text.length, "**"));
  assert.equal(bold.text, "**one**\n**two**\n\n**three**");
  assert.equal(hasMark(bold.text, bold.text.indexOf("one"), bold.text.indexOf("one") + 3, "**"), true);
});

test("a caret gets the pair, with the caret between", () => {
  assert.deepEqual(run("ab", toggleMark("ab", 1, 1, "**")), { text: "a****b", selected: "" });
  assert.equal(toggleMark("ab", 1, 1, "**").from, 3);
});

test("a selection becomes a link, an address with a space or a parenthesis between < >", () => {
  assert.equal(
    run("go there now", linkSelection(3, 8, "https://example.com")).text,
    "go [there](https://example.com) now",
  );
  assert.equal(
    run("go there now", linkSelection(3, 8, "https://example.com/a b")).text,
    "go [there](<https://example.com/a b>) now",
  );
});

test("a link's address, or a wikilink's note, is found and changed without touching its text", () => {
  assert.deepEqual(linkOf("[a](https://old.example.com)"), {
    kind: "link",
    target: "https://old.example.com",
    from: 4,
    to: 27,
  });
  assert.equal(withTarget("[a](https://old.example.com)", "https://new.example.com"), "[a](https://new.example.com)");
  assert.equal(withTarget('[a](https://old.example.com "Title")', "/x"), '[a](/x "Title")');
  assert.equal(withTarget("[a](<my file.md>)", "other file.md"), "[a](<other file.md>)");
  assert.equal(withTarget("[[Old note|the note]]", "New note"), "[[New note|the note]]");
  assert.equal(withTarget("[[Old note#Heading]]", "New note"), "[[New note]]");
  assert.equal(label("[[Old note|the note]]"), "the note");
  assert.equal(label("[[Old note]]"), "Old note");
});

test("an emptied address takes the link away and keeps what it showed", () => {
  assert.equal(withTarget("[a *b*](https://x.example.com)", ""), "a *b*");
  assert.equal(withTarget("[[Old note|the note]]", "  "), "the note");
  assert.deepEqual(retarget("[a](u)", "v"), { from: 4, to: 5, insert: "v" });
  assert.equal(linkOf("not a link"), null);
});

test("[] and a space at the start of a line is a to-do", () => {
  assert.deepEqual(todoRule("[]", 2), { from: 0, to: 2, insert: "- [ ] " });
  assert.deepEqual(todoRule("  [ ]", 5), { from: 2, to: 5, insert: "- [ ] " });
  assert.equal(todoRule("a []", 4), null);
  assert.equal(todoRule("a[]", 3), null);
});
