import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// The page editor with its markdown hidden (livePreview.ts, formatting.ts), in a DOM that jsdom gives CodeMirror: the
// tests type, press keys and read back the document and the selection, as the harness does in a browser.
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
const { formatting } = await import("./formatting.ts");
/* eslint-enable no-restricted-syntax */

const words = {
  toolbar: "Formatting",
  bold: "Bold",
  italic: "Italic",
  strike: "Strikethrough",
  code: "Code",
  link: "Link",
  target: "Address",
  removeLink: "Remove link",
  turn: { label: "Turn into", kind: (k: string) => k },
};
const mode = new Compartment();
function editor(doc = "") {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdown({ base: markdownLanguage }),
        livePreview(() => {}),
        formatting(words),
        mode.of(showMarkdown.of(false)),
        keymap.of([...defaultKeymap, ...historyKeymap]),
      ],
    }),
  });
  // jsdom has no focus: the toolbar and the popover are shown for an editor that has it
  Object.defineProperty(view, "hasFocus", { get: () => true });
  return view;
}
type V = InstanceType<typeof EditorView>;
// what CodeMirror does with typed text: the input handlers first, else the text goes in
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
const press = (view: V, key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}) =>
  runScopeHandlers(view, new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }), "editor");
const at = (view: V, anchor: number, head = anchor) => view.dispatch({ selection: { anchor, head } });
const head = (view: V) => view.state.selection.main.head;
const text = (view: V) => view.contentDOM.textContent ?? "";
const doc = (view: V) => view.state.doc.toString();

const PAGE = [
  "# Title",
  "## Part",
  "Some **bold**, *it*, ~~gone~~, `code`, a [link](https://example.com/a) and [[Northwind Portal|the portal]].",
  "- item",
  "- [ ] task",
  "- [x] done",
  "1. first",
  "> quote",
  "",
  "> [!note] Heads up",
  "> body",
  "---",
].join("\n");

test("no markdown shows with the cursor anywhere in a page", () => {
  const view = editor(PAGE);
  for (let pos = 0; pos <= PAGE.length; pos++) {
    at(view, pos);
    const shown = text(view);
    for (const syntax of ["#", "**", "~~", "`", "](", "[[", "]]", "[!", "https://", "- ", "> ", "[ ]", "[x]", "---"])
      assert.ok(!shown.includes(syntax), `"${syntax}" shows with the cursor at ${pos}: ${shown}`);
  }
  for (const cls of [
    ".cm-h1",
    ".cm-strong",
    ".cm-em",
    ".cm-strike",
    ".cm-code",
    ".cm-link",
    ".cm-wikilink",
    ".cm-bullet",
    ".cm-task",
    ".cm-quote",
    ".cm-callout",
    ".cm-rule",
  ])
    assert.ok(view.contentDOM.querySelector(cls), `${cls} is drawn`);
  view.destroy();
});

test("typing ## Title, **bold**, - item and [] task renders as the syntax completes and saves that markdown", () => {
  const view = editor();
  type(view, "## Title");
  assert.equal(doc(view), "## Title");
  assert.ok(view.contentDOM.querySelector(".cm-h2"));
  assert.equal(text(view), "Title");
  type(view, "\n**bol");
  assert.ok(text(view).includes("**bol"), "unclosed syntax stays visible");
  type(view, "d*");
  type(view, "*");
  assert.equal(doc(view), "## Title\n**bold**");
  assert.ok(view.contentDOM.querySelector(".cm-strong"));
  assert.ok(!text(view).includes("*"));
  type(view, "\n- item");
  assert.ok(view.contentDOM.querySelector(".cm-bullet"));
  type(view, "\n[] task");
  assert.equal(doc(view), "## Title\n**bold**\n- item\n- [ ] task");
  assert.ok(view.contentDOM.querySelector(".cm-task"));
  assert.ok(!text(view).includes("[]"));
  view.destroy();
});

test("an auto-conversion is one undo step with the typing", () => {
  const view = editor();
  type(view, "[] task");
  assert.equal(doc(view), "- [ ] task");
  press(view, "z", { ctrlKey: true });
  assert.equal(doc(view), "", "one undo takes back the typing and the conversion together");
  type(view, "## Title");
  press(view, "z", { ctrlKey: true });
  assert.equal(doc(view), "");
  view.destroy();
});

test("⌘B and the toolbar's B wrap the selection in ** and unwrap it again", () => {
  const view = editor("a text b");
  at(view, 2, 6);
  assert.ok(press(view, "b", { ctrlKey: true }));
  assert.equal(doc(view), "a **text** b");
  assert.deepEqual([view.state.selection.main.from, view.state.selection.main.to], [4, 8]);
  assert.ok(view.contentDOM.querySelector(".cm-strong"));
  press(view, "b", { ctrlKey: true });
  assert.equal(doc(view), "a text b");
  at(view, 2, 6);
  (view.dom.querySelector(".cm-format-bold") as HTMLElement).click();
  assert.equal(doc(view), "a **text** b");
  assert.equal((view.dom.querySelector(".cm-format-bold") as HTMLElement).getAttribute("aria-pressed"), "true");
  press(view, "i", { ctrlKey: true });
  assert.equal(doc(view), "a ***text*** b");
  press(view, "x", { ctrlKey: true, shiftKey: true });
  assert.equal(doc(view), "a ***~~text~~*** b");
  press(view, "e", { ctrlKey: true });
  assert.equal(doc(view), "a ***~~`text`~~*** b");
  view.destroy();
});

test("arrow keys never stop inside hidden syntax", () => {
  const doc0 = "# Head\na **bold** and [a link](https://example.com) and [[Note|alias]] and `code`\n- [ ] task";
  const view = editor(doc0);
  const hidden: [number, number][] = [];
  const re = /(^# )|(\*\*)|(\]\(https:\/\/example\.com\))|(\[\[Note\|)|(\]\])|(^- \[ \] )|(`)|(\[)/gm;
  for (const m of doc0.matchAll(re)) hidden.push([m.index, m.index + m[0].length]);
  const inside = (pos: number) => hidden.some(([from, to]) => pos > from && pos < to);
  at(view, 0);
  const seen = new Set<number>();
  for (let i = 0; i < 80 && head(view) < doc0.length; i++) {
    press(view, "ArrowRight");
    assert.ok(!inside(head(view)), `→ stopped inside hidden syntax at ${head(view)}`);
    seen.add(head(view));
  }
  assert.equal(head(view), doc0.length, "→ gets to the end");
  for (let i = 0; i < 80 && head(view) > 0; i++) {
    press(view, "ArrowLeft");
    assert.ok(!inside(head(view)), `← stopped inside hidden syntax at ${head(view)}`);
  }
  assert.equal(head(view), 2, "← stops after the heading's hidden #, the cursor never rests before it");
  press(view, "ArrowLeft");
  assert.equal(head(view), 2, "and the first line has no line above");
  view.destroy();
});

test("← at the start of a line goes to the end of the line above, Home goes after the hidden mark", () => {
  const view = editor("first\n## Title\n- item");
  at(view, 8); // after "## "
  press(view, "Home");
  assert.equal(head(view), 9, "Home on a heading goes to the start of its text");
  press(view, "ArrowLeft");
  assert.equal(head(view), 5, "← leaves for the line above");
  at(view, 15);
  assert.equal(head(view), 17, "a cursor put before a bullet's mark goes after it");
  view.destroy();
});

test("Backspace at the start of a heading, list item, to-do or quote turns it into plain text", () => {
  for (const [before, after] of [
    ["## Title", "Title"],
    ["- item", "item"],
    ["- [ ] task", "task"],
    ["- [x] done", "done"],
    ["> quote", "quote"],
    ["1. first", "first"],
  ]) {
    const view = editor(before);
    at(view, 0);
    assert.equal(head(view), before.indexOf(after), `the cursor starts after the mark of "${before}"`);
    press(view, "Backspace");
    assert.equal(doc(view), after, before);
    assert.equal(head(view), 0);
    view.destroy();
  }
});

test("Backspace and Delete next to hidden marks take the visible character, and the marks with the last one", () => {
  const view = editor("a **bold** b");
  at(view, 10); // after the closing **
  press(view, "Backspace");
  assert.equal(doc(view), "a **bol** b");
  assert.equal(head(view), 7);
  at(view, 2); // before the opening **
  press(view, "Delete");
  assert.equal(doc(view), "a **ol** b", "Delete before a bold takes the first character after the mark");
  view.destroy();
  const one = editor("x **y** z");
  at(one, 7);
  press(one, "Backspace");
  assert.equal(doc(one), "x  z", "the last character takes its marks along");
  one.destroy();
  const link = editor("see [a](https://example.com) now");
  at(link, 28);
  press(link, "Backspace");
  assert.equal(doc(link), "see  now");
  link.destroy();
});

test("typing before a bold goes before its hidden mark, after it continues the bold, after its end leaves it", () => {
  const view = editor("a **b** c");
  at(view, 4); // between the opening ** and b
  type(view, "X");
  assert.equal(doc(view), "a X**b** c");
  at(view, doc(view).lastIndexOf("**")); // inside, before the closing **
  type(view, "Y");
  assert.equal(doc(view), "a X**bY** c");
  at(view, doc(view).lastIndexOf("**") + 2); // after the closing **
  type(view, "Z");
  assert.equal(doc(view), "a X**bY**Z c");
  view.destroy();
});

test("⌘K links the selected text, or changes the address of a link, and is the palette's otherwise", () => {
  const view = editor("go to Northwind now and [there](https://old.example.com)");
  at(view, 3);
  assert.equal(press(view, "k", { ctrlKey: true }), false, "no selection: the key is the palette's");
  at(view, 6, 15);
  assert.ok(press(view, "k", { ctrlKey: true }));
  const pop = view.dom.querySelector(".cm-link-pop") as HTMLElement;
  const input = pop.querySelector("input") as HTMLInputElement;
  assert.ok(!pop.hidden);
  input.value = "https://northwind.example.com";
  input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(doc(view), "go to [Northwind](https://northwind.example.com) now and [there](https://old.example.com)");
  // an existing link: its address, edited without seeing its markdown
  const from = doc(view).indexOf("[there]");
  at(view, from + 2, from + 4);
  assert.ok(press(view, "k", { ctrlKey: true }));
  assert.equal(input.value, "https://old.example.com");
  input.value = "https://new.example.com";
  input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.ok(doc(view).endsWith("[there](https://new.example.com)"));
  // a wikilink's note
  const wiki = editor("see [[Old note|the note]] here");
  at(wiki, 16, 18);
  assert.ok(press(wiki, "k", { ctrlKey: true }));
  const wikiInput = wiki.dom.querySelector(".cm-link-input") as HTMLInputElement;
  assert.equal(wikiInput.value, "Old note");
  wikiInput.value = "New note";
  wikiInput.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(doc(wiki), "see [[New note|the note]] here");
  wiki.destroy();
  view.destroy();
});

test("Show markdown draws the marks again, and switching back hides them", () => {
  const view = editor("## Title\nsome **bold** and [a](https://example.com)");
  assert.ok(!text(view).includes("#") && !text(view).includes("**"));
  view.dispatch({ effects: mode.reconfigure(showMarkdown.of(true)) });
  assert.ok(
    text(view).includes("## Title") && text(view).includes("**bold**") && text(view).includes("](https://example.com)"),
  );
  at(view, 0);
  assert.equal(head(view), 0, "the cursor may rest anywhere");
  view.dispatch({ effects: mode.reconfigure(showMarkdown.of(false)) });
  assert.ok(!text(view).includes("#") && !text(view).includes("**"));
  view.destroy();
});
