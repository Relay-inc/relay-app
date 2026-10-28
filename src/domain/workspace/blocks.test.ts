import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { SLASH, moveBlock, nextCell, pasteLink, prevCell, tableAddColumn, tableRow, turnInto } from "./blocks.ts";

const gfm = markdownLanguage.parser; // the editor's own parser: GFM tables and to-dos
const top = (text: string) => {
  const names: string[] = [];
  const cursor = gfm.parse(text).cursor();
  if (cursor.firstChild())
    do names.push(cursor.name);
    while (cursor.nextSibling());
  return names;
};

test("every / block is the markdown expected and parses as its kind", () => {
  const typed = (kind: string, text: string) => {
    const item = SLASH.find(s => s.kind === kind)!;
    return item.insert.slice(0, item.caret) + text + item.insert.slice(item.caret);
  };
  const page = [
    typed("h1", "Title"),
    typed("h2", "Part"),
    typed("h3", "Sub"),
    typed("todo", "Call Jeppe"),
    typed("bullet", "One"),
    typed("number", "First"),
    typed("quote", "Said"),
    typed("callout", "Mind this"),
    typed("code", "let a = 1"),
    typed("table", "a"),
    typed("divider", ""),
    typed("link", "Northwind Portal]]"),
  ].join("\n\n");
  assert.equal(
    page,
    [
      "# Title",
      "## Part",
      "### Sub",
      "- [ ] Call Jeppe",
      "- One",
      "1. First",
      "> Said",
      "> [!note]\n> Mind this",
      "```\nlet a = 1\n```",
      "| Column | Column |\n| --- | --- |\n| a |  |",
      "---\n",
      "[[Northwind Portal]]",
    ].join("\n\n"),
  );
  assert.deepEqual(top(page), [
    "ATXHeading1",
    "ATXHeading2",
    "ATXHeading3",
    "BulletList", // the to-do and the bullet: one list in markdown, both start with -
    "OrderedList",
    "Blockquote",
    "Blockquote",
    "FencedCode",
    "Table",
    "HorizontalRule",
    "Paragraph",
  ]);
});

test("turn into swaps each line's marker", () => {
  assert.equal(turnInto("- [ ] a\n- [x] b", "number"), "1. a\n2. b");
  assert.equal(turnInto("## Head", "todo"), "- [ ] Head");
  assert.equal(turnInto("1. a\n  2. b", "bullet"), "- a\n  - b");
  assert.equal(turnInto("> [!note] Mind\n> more", "text"), "Mind\nmore");
  assert.equal(turnInto("plain", "h2"), "## plain");
});

test("a block moves before or after another, a blank line kept between blocks", () => {
  const text = "# A\na\n\n# B\nb\n\nc";
  // B's section ("# B\nb", 7 to 12) before A
  assert.equal(moveBlock(text, 7, 12, 0), "# B\nb\n\n# A\na\n\nc");
  // A's section to the end
  assert.equal(moveBlock(text, 0, 5, text.length), "# B\nb\n\nc\n\n# A\na");
  // the last block up, before B
  assert.equal(moveBlock(text, 14, 15, 7), "# A\na\n\nc\n\n# B\nb");
  // after A: dropped on the blank line under it
  assert.equal(moveBlock(text, 14, 15, 6), "# A\na\n\nc\n\n# B\nb");
  // two paragraphs never merge: a blank line goes between them
  assert.equal(moveBlock("p\nq\n\nr", 5, 6, 2), "p\n\nr\n\nq");
  // onto itself: nothing
  assert.equal(moveBlock(text, 7, 12, 9), text);
});

test("a list item moves between items without a blank line", () => {
  const list = "- a\n- b\n- c";
  assert.equal(moveBlock(list, 8, 11, 0, false), "- c\n- a\n- b");
  assert.equal(moveBlock(list, 0, 3, list.length, false), "- b\n- c\n- a");
  assert.equal(moveBlock(list, 0, 3, 8, false), "- b\n- a\n- c");
});

test("tables: a row, a column, Tab and Shift-Tab between cells", () => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  assert.equal(tableRow("| A | B |"), "|  |  |");
  assert.equal(tableAddColumn(table), "| A | B | Column |\n| --- | --- | --- |\n| 1 | 2 |  |");
  assert.equal(nextCell("| 1 | 2 |", 2), 6);
  assert.equal(nextCell("| 1 | 2 |", 6), null);
  assert.equal(prevCell("| 1 | 2 |", 6), 2);
  assert.equal(prevCell("| 1 | 2 |", 2), null);
});

test("a pasted URL over a selection makes a link", () => {
  assert.equal(pasteLink("the spec", "https://example.com/a "), "[the spec](https://example.com/a)");
  assert.equal(pasteLink("", "https://example.com"), null);
  assert.equal(pasteLink("x", "not a url"), null);
});
