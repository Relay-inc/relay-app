import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Tables in the page editor (tables.ts) in a DOM that jsdom gives CodeMirror: the tests click into cells, type, press
// keys and paste, and read back the document and the selection, as the harness does in a browser.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const win = dom.window as unknown as Record<string, unknown> & Window;
for (const name of [
  "window",
  "document",
  "navigator",
  "Window",
  "Node",
  "Element",
  "HTMLElement",
  "KeyboardEvent",
  "MouseEvent",
  "Event",
  "MutationObserver",
  "getComputedStyle",
  "DOMParser",
  "requestAnimationFrame",
  "cancelAnimationFrame",
])
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? win : win[name],
    configurable: true,
    writable: true,
  });
const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
win.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
win.Range.prototype.getBoundingClientRect = () => rect as DOMRect;

// the editor's modules read the DOM when they load, so they come after the DOM above: dynamic on purpose
/* eslint-disable no-restricted-syntax */
const { EditorState, Compartment } = await import("@codemirror/state");
const { EditorView, keymap, runScopeHandlers } = await import("@codemirror/view");
const { defaultKeymap, history, historyKeymap } = await import("@codemirror/commands");
const { markdown, markdownLanguage } = await import("@codemirror/lang-markdown");
const { livePreview, showMarkdown } = await import("./livePreview.ts");
const { tableEditing } = await import("./tables.ts");
const { splitRow } = await import("../../../domain/workspace/tables.ts");
const { undo } = await import("@codemirror/commands");
/* eslint-enable no-restricted-syntax */

const tw = Object.fromEntries(
  "rowGrip columnGrip rowAbove rowBelow moveUp moveDown deleteRow columnLeft columnRight moveLeft moveRight alignLeft alignCenter alignRight deleteColumn"
    .split(" ")
    .map(k => [k, k]),
) as never;
const mode = new Compartment();
function editor(doc: string) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdown({ base: markdownLanguage }),
        livePreview(() => {}),
        tableEditing(tw),
        mode.of(showMarkdown.of(false)),
        keymap.of([...defaultKeymap, ...historyKeymap]),
      ],
    }),
  });
  Object.defineProperty(view, "hasFocus", { get: () => true });
  return view;
}
type V = InstanceType<typeof EditorView>;
function type(view: V, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection.main;
    const insert = () =>
      view.state.update({
        changes: { from, to, insert: ch },
        selection: { anchor: from + ch.length },
        userEvent: "input.type",
      });
    if (!view.state.facet(EditorView.inputHandler).some(h => h(view, from, to, ch, insert))) view.dispatch(insert());
  }
}
const press = (view: V, key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) =>
  runScopeHandlers(view, new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }), "editor");
const doc = (view: V) => view.state.doc.toString();
const head = (view: V) => view.state.selection.main.head;
/** The caret in the cell whose text starts at `word`'s first occurrence at or after the cursor, `n` characters in. */
function inCell(view: V, word: string, n = 0) {
  const pos = doc(view).indexOf(word);
  view.dispatch({ selection: { anchor: pos + n } });
}
function paste(view: V, text: string) {
  const event = new win.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (t: string) => (t === "text/plain" ? text : "") },
  });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

const TABLE = [
  "| Vendor   | Contact | Cost |",
  "| -------- | ------- | ---- |",
  "| Atlas    | Sofie   | 10   |",
  "| Bluebird | Tom     | 20   |",
].join("\n");
const PAGE = `Intro\n\n${TABLE}\n\nAfter`;
const at = (view: V, pos: number) => view.dispatch({ selection: { anchor: pos } });

test("a table is a grid: no pipes, no delimiter row, a header, cells", () => {
  const view = editor(PAGE);
  // what shows: the text without the marks that are not displayed
  const shown = () => {
    const clone = view.contentDOM.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".cm-thide, .cm-tdelim").forEach(e => e.remove());
    return clone.textContent ?? "";
  };
  assert.ok(!shown().includes("|") && !shown().includes("---"), shown());
  assert.equal(view.contentDOM.querySelectorAll(".cm-trow").length, 3);
  assert.equal(view.contentDOM.querySelectorAll(".cm-thead").length, 1);
  assert.equal(view.contentDOM.querySelectorAll(".cm-tcell").length, 9);
  for (let pos = 0; pos <= PAGE.length; pos++) {
    at(view, pos);
    assert.ok(!shown().includes("|"), `pipe shows with the caret at ${pos}`);
  }
  view.destroy();
});

test("the caret is always in a cell, never on a pipe or in the padding", () => {
  const view = editor(PAGE);
  for (let pos = PAGE.indexOf("| Vendor"); pos <= PAGE.indexOf("\n\nAfter"); pos++) {
    at(view, pos);
    const line = view.state.doc.lineAt(head(view));
    const off = head(view) - line.from;
    const before = line.text.slice(0, off);
    const after = line.text.slice(off);
    if (line.text.startsWith("| --")) assert.fail(`the caret rests on the delimiter row at ${pos}`);
    assert.ok(/[^|\s]$/.test(before) || /(\| )$/.test(before), `caret not in a cell at ${pos}: ${before}^${after}`);
  }
  view.destroy();
});

test("typing changes only that cell and the columns are re-padded in the same undo step", () => {
  const view = editor(PAGE);
  inCell(view, "Atlas", 5);
  type(view, " Logistics");
  assert.equal(
    doc(view),
    PAGE.replace(
      TABLE,
      [
        "| Vendor          | Contact | Cost |",
        "| --------------- | ------- | ---- |",
        "| Atlas Logistics | Sofie   | 10   |",
        "| Bluebird        | Tom     | 20   |",
      ].join("\n"),
    ),
  );
  assert.equal(doc(view).slice(head(view) - 10, head(view)), " Logistics", "the caret stays after what was typed");
  undo(view);
  assert.equal(doc(view), PAGE, "one undo takes back all of the typing and the re-padding");
  view.destroy();
});

test("a space typed at the end of a cell stays while the caret is there", () => {
  const view = editor(PAGE);
  inCell(view, "Sofie", 5);
  type(view, " Claes");
  assert.ok(doc(view).includes("| Sofie Claes |"), doc(view));
  view.destroy();
});

test("a | typed in a cell is stored as \\|", () => {
  const view = editor(PAGE);
  inCell(view, "Tom", 3);
  type(view, "|x");
  assert.ok(doc(view).includes("| Tom\\|x "), doc(view));
  assert.equal(splitRow(view.state.doc.lineAt(head(view)).text)!.length, 3, "still three columns");
  view.destroy();
});

test("Tab and Shift-Tab move between cells, Tab in the last cell adds a row", () => {
  const view = editor(PAGE);
  inCell(view, "Vendor");
  press(view, "Tab");
  assert.equal(doc(view).slice(head(view), head(view) + 7), "Contact");
  press(view, "Tab");
  press(view, "Tab"); // the next row's first cell: the delimiter row is skipped
  assert.equal(doc(view).slice(head(view), head(view) + 5), "Atlas");
  press(view, "Tab", { shiftKey: true });
  assert.equal(doc(view).slice(head(view), head(view) + 4), "Cost");
  inCell(view, "20");
  const before = doc(view).length;
  press(view, "Tab");
  assert.equal(
    doc(view)
      .split("\n")
      .filter(l => l.startsWith("|")).length,
    5,
    "a row was added",
  );
  assert.ok(doc(view).length > before);
  assert.equal(view.state.doc.lineAt(head(view)).number, 7);
  view.destroy();
});

test("Enter moves to the cell below and adds a row at the end", () => {
  const view = editor(PAGE);
  inCell(view, "Contact");
  press(view, "Enter");
  assert.equal(doc(view).slice(head(view), head(view) + 5), "Sofie");
  press(view, "Enter");
  assert.equal(doc(view).slice(head(view), head(view) + 3), "Tom");
  press(view, "Enter");
  assert.equal(
    doc(view)
      .split("\n")
      .filter(l => l.startsWith("|")).length,
    5,
  );
  const line = view.state.doc.lineAt(head(view));
  assert.equal(line.number, 7);
  assert.equal(head(view) - line.from, 13, "the new row's second cell");
  view.destroy();
});

test("arrows cross cell boundaries and move between rows in the same column", () => {
  const view = editor(PAGE);
  inCell(view, "Vendor", 6);
  press(view, "ArrowRight");
  assert.equal(doc(view).slice(head(view), head(view) + 7), "Contact", "→ at the end of a cell");
  press(view, "ArrowLeft");
  assert.equal(doc(view).slice(head(view) - 6, head(view)), "Vendor", "← at the start of a cell");
  inCell(view, "Contact", 2);
  press(view, "ArrowDown");
  assert.equal(doc(view).slice(head(view) - 2, head(view) + 3), "Sofie".slice(0, 2) + "fie");
  press(view, "ArrowDown");
  assert.equal(doc(view).slice(head(view) - 2, head(view) + 1), "So".length ? "To" + "m" : "");
  press(view, "ArrowUp");
  press(view, "ArrowUp");
  assert.equal(doc(view).slice(head(view) - 2, head(view) + 5), "Contact".slice(0, 2) + "ntact");
  view.destroy();
});

test("Backspace never deletes a pipe or merges cells", () => {
  const view = editor(PAGE);
  for (const word of ["Contact", "Sofie", "Cost", "10"]) {
    inCell(view, word);
    press(view, "Backspace");
    assert.equal(doc(view), PAGE, `Backspace at the start of ${word}`);
  }
  inCell(view, "Atlas", 5);
  press(view, "Delete");
  assert.equal(doc(view), PAGE, "Delete at the end of a cell");
  inCell(view, "Atlas", 5);
  press(view, "Backspace");
  assert.ok(doc(view).includes("| Atla     |"), "inside a cell it deletes a character");
  view.destroy();
});

test("Backspace in the first cell of an empty row removes the row, in one undo step", () => {
  const view = editor(PAGE);
  inCell(view, "Bluebird");
  press(view, "Tab");
  press(view, "Tab");
  press(view, "Tab"); // adds a row, the caret in its first cell
  const rows = () =>
    doc(view)
      .split("\n")
      .filter(l => l.startsWith("|")).length;
  assert.equal(rows(), 5);
  const added = doc(view);
  press(view, "Backspace");
  assert.equal(rows(), 4);
  assert.equal(
    doc(view),
    added.replace(/\n\|[ |]+$/m, "").replace(/\n\| +\| +\| +\|(?=\n|$)/, ""),
    "only the row went",
  );
  undo(view);
  assert.equal(doc(view), added, "one undo brings the row back");
  view.destroy();
});

test("deleting a selection across cells keeps the pipes", () => {
  const view = editor(PAGE);
  const a = doc(view).indexOf("Sofie");
  const b = doc(view).indexOf("Tom") + 3;
  view.dispatch({ selection: { anchor: a, head: b } });
  press(view, "Backspace");
  const rows = doc(view)
    .split("\n")
    .filter(l => l.startsWith("|"));
  assert.equal(rows.length, 4, "no row merged");
  for (const row of rows) assert.equal(row.split("|").length, 5, row);
  assert.ok(doc(view).includes("| Atlas "), doc(view));
  view.destroy();
});

test("select all in a cell selects the cell first", () => {
  const view = editor(PAGE);
  inCell(view, "Bluebird", 3);
  press(view, "a", { ctrlKey: true });
  const s = view.state.selection.main;
  assert.equal(doc(view).slice(s.from, s.to), "Bluebird");
  press(view, "a", { ctrlKey: true });
  assert.equal(view.state.selection.main.to - view.state.selection.main.from > 8, true, "then the page");
  view.destroy();
});

test("a pasted tab-separated grid fills cells from the caret, adding rows and columns", () => {
  const view = editor(PAGE);
  inCell(view, "Tom");
  assert.ok(paste(view, "Tom Willems\t30\tNew\nSofie Claes\t40\tx"));
  const rows = doc(view)
    .split("\n")
    .filter(l => l.startsWith("|"));
  assert.equal(rows.length, 5);
  assert.ok(rows[3].startsWith("| Bluebird "), rows[3]);
  assert.ok(/^\| Bluebird +\| Tom Willems +\| 30 +\| New +\|$/.test(rows[2]) === false);
  view.destroy();
});

test("pasted tab-separated data on an empty line makes a table, the first row its header", () => {
  const view = editor("Intro\n\n");
  at(view, view.state.doc.length);
  assert.ok(paste(view, "Vendor\tCost\nAtlas\t10\n"));
  assert.equal(doc(view), "Intro\n\n| Vendor | Cost |\n| ------ | ---- |\n| Atlas  | 10   |");
  assert.equal(doc(view).slice(head(view), head(view) + 6), "Vendor", "the caret is in the first header cell");
  view.destroy();
  const plain = editor("Intro\n\n");
  at(plain, plain.state.doc.length);
  paste(plain, "no tabs here");
  assert.ok(!doc(plain).includes("|"), "other text is not made a table");
  plain.destroy();
});

test("Show markdown shows the table's text unchanged", () => {
  const view = editor(PAGE);
  view.dispatch({ effects: mode.reconfigure(showMarkdown.of(true)) });
  assert.ok((view.contentDOM.textContent ?? "").includes("| Vendor   | Contact | Cost |"));
  assert.ok((view.contentDOM.textContent ?? "").includes("| -------- |"));
  assert.equal(doc(view), PAGE);
  view.destroy();
});

test("text outside tables types as before, and a table in a quote stays text", () => {
  const view = editor("a | b\n\n> | x | y |\n> | - | - |");
  at(view, 1);
  type(view, "z");
  assert.equal(doc(view).split("\n")[0], "az | b");
  assert.equal(view.contentDOM.querySelectorAll(".cm-trow").length, 0);
  view.destroy();
});
