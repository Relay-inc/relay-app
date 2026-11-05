import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  escapeCell,
  fillCells,
  formatTable,
  isTidy,
  moveColumn,
  moveRow,
  parseDelimiter,
  parseTable,
  parseTsv,
  rowCells,
  setAlign,
  splitRow,
  tsvToTable,
} from "./tables.ts";

const SRC = [
  "| Vendor | Contact | Cost |",
  "| :-- | :-: | --: |",
  "| Atlas | Sofie Claes | 1,5 |",
  "| Bluebird |  | 20 |",
];
const table = () => parseTable(SRC)!;
const text = (t: ReturnType<typeof table>) => formatTable(t).join("\n");

test("cells of a line, escaped pipes stay inside a cell", () => {
  assert.deepEqual(splitRow("| a \\| b | c |"), ["a \\| b", "c"]);
  assert.deepEqual(splitRow("|a|b"), ["a", "b"]);
  assert.deepEqual(splitRow("| a |  |"), ["a", ""]);
  assert.equal(splitRow("no pipes"), null);
  const [first] = rowCells("| ab | c |")!;
  assert.deepEqual(first, { pipe: 0, start: 2, end: 4, close: 5 });
});

test("the delimiter row gives the alignment", () => {
  assert.deepEqual(parseDelimiter("|:--|:-:|--:|---|"), ["left", "center", "right", null]);
  assert.equal(parseDelimiter("| a | b |"), null);
});

test("re-padding aligns every column and keeps the alignment", () => {
  assert.equal(
    text(table()),
    [
      "| Vendor   | Contact     | Cost |",
      "| :------- | :---------: | ---: |",
      "| Atlas    | Sofie Claes | 1,5  |",
      "| Bluebird |             | 20   |",
    ].join("\n"),
  );
  assert.deepEqual(parseTable(formatTable(table()))!.rows, table().rows);
  assert.ok(isTidy(formatTable(table())));
});

test("escaping a pipe typed in a cell", () => {
  assert.equal(escapeCell("a|b"), "a\\|b");
  assert.equal(escapeCell("a\\|b"), "a\\|b");
  assert.equal(escapeCell("a\nb"), "a b");
});

test("rows: add, delete, move", () => {
  const added = addRow(table(), 2);
  assert.deepEqual(added.rows[2], ["", "", ""]);
  assert.equal(added.rows.length, 4);
  assert.deepEqual(addRow(table(), 0).rows[0], ["Vendor", "Contact", "Cost"], "never above the header");
  assert.equal(deleteRow(table(), 1).rows.length, 2);
  assert.equal(deleteRow(table(), 0).rows.length, 3, "the header stays");
  assert.equal(moveRow(table(), 1, 1).rows[2][0], "Atlas");
  assert.deepEqual(moveRow(table(), 1, -1), table(), "the first row does not move into the header");
});

test("columns: add, delete, move carry their alignment", () => {
  const added = addColumn(table(), 1);
  assert.deepEqual(added.align, ["left", null, "center", "right"]);
  assert.deepEqual(added.rows[0], ["Vendor", "", "Contact", "Cost"]);
  const gone = deleteColumn(table(), 0);
  assert.deepEqual(gone.rows[0], ["Contact", "Cost"]);
  assert.deepEqual(gone.align, ["center", "right"]);
  const moved = moveColumn(table(), 0, 1);
  assert.deepEqual(moved.rows[1], ["Sofie Claes", "Atlas", "1,5"]);
  assert.deepEqual(moved.align, ["center", "left", "right"]);
  assert.deepEqual(moveColumn(table(), 2, 1), table());
  assert.equal(deleteColumn(parseTable(["| a |", "| - |"])!, 0).rows[0].length, 1, "the last column stays");
});

test("alignment change", () => {
  assert.equal(
    formatTable(setAlign(table(), 0, "right"))[1]
      .split("|")[1]
      .trim(),
    "-------:",
  );
  assert.equal(
    formatTable(setAlign(table(), 2, null))[1]
      .split("|")[3]
      .trim(),
    "----",
  );
});

test("tab-separated data is a table, the first row its header", () => {
  const grid = parseTsv("Vendor\tCost\r\nAtlas\t1|2\r\n")!;
  assert.deepEqual(grid, [
    ["Vendor", "Cost"],
    ["Atlas", "1\\|2"],
  ]);
  assert.equal(text(tsvToTable(grid)), ["| Vendor | Cost |", "| ------ | ---- |", "| Atlas  | 1\\|2 |"].join("\n"));
  assert.equal(parseTsv("plain text\nwithout tabs"), null);
  assert.equal(parseTsv("a\tb\nno tab"), null);
});

test("pasted cells fill from the caret and add rows and columns", () => {
  const filled = fillCells(table(), 2, 1, [
    ["x", "y"],
    ["z", "w"],
  ]);
  assert.equal(filled.align.length, 3);
  assert.deepEqual(filled.rows[2], ["Bluebird", "x", "y"]);
  assert.deepEqual(filled.rows[3], ["", "z", "w"]);
  const wider = fillCells(table(), 1, 2, [["x", "y"]]);
  assert.deepEqual(wider.rows[1], ["Atlas", "Sofie Claes", "x", "y"]);
  assert.deepEqual(wider.align, ["left", "center", "right", null]);
  assert.deepEqual(wider.rows[0], ["Vendor", "Contact", "Cost", ""]);
});
