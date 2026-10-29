import { autocompletion, startCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";
import {
  SLASH,
  TURN_INTO,
  cellStarts,
  moveBlock,
  nextCell,
  pasteLink,
  prevCell,
  tableAddColumn,
  tableRow,
  turnInto,
  type BlockKind,
} from "../../../domain/workspace/blocks";
import { noteName } from "../../../domain/navigation/pages";

// Notion-like editing in a page's editor (PageEditor.tsx): the / menu, [[ completion, a block's handle (drag to move,
// click for its menu), Tab between a table's cells and a pasted URL over a selection as a link. The text stays markdown:
// the block operations themselves are domain/workspace/blocks.ts.

export type BlockWords = {
  kind: (kind: BlockKind) => string;
  turnInto: string;
  duplicate: string;
  remove: string;
  addRow: string;
  addColumn: string;
  handle: string;
};

/** A block: whole lines, from a top-level markdown node; a heading takes its section along, a list item its own lines
 *  (nested items included). */
type Block = { from: number; to: number; name: string };
const LEVEL = /^ATXHeading(\d)$/;

function blockAt(state: EditorState, pos: number): Block | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  const line = state.doc.lineAt(pos);
  let node = tree.topNode.firstChild;
  while (node && node.to < line.from) node = node.nextSibling;
  if (!node || node.from > line.to) return null; // a blank line between blocks
  let { from, to, name } = node;
  const level = LEVEL.exec(name);
  if (level) {
    for (let next = node.nextSibling; next; next = next.nextSibling) {
      const own = LEVEL.exec(next.name);
      if (own && +own[1] <= +level[1]) break;
      to = next.to;
    }
  } else if (name === "BulletList" || name === "OrderedList") {
    for (let item = node.firstChild; item; item = item.nextSibling)
      if (item.name === "ListItem" && item.from <= line.to && item.to >= line.from) {
        ({ from, to } = item);
        name = "ListItem";
        break;
      }
  }
  // a node can end at the start of the next line: the block ends on the line before
  return { from: state.doc.lineAt(from).from, to: state.doc.lineAt(Math.max(from, to - 1)).to, name };
}

/** One replace for the part that differs: a move does not rewrite the whole page (undo and, later, collaboration
 *  stay small). */
function replaceAll(view: EditorView, next: string) {
  const old = view.state.doc.toString();
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start++;
  let end = 0;
  while (
    end < old.length - start &&
    end < next.length - start &&
    old[old.length - 1 - end] === next[next.length - 1 - end]
  )
    end++;
  view.dispatch({
    changes: { from: start, to: old.length - end, insert: next.slice(start, next.length - end) },
    userEvent: "move",
  });
}

function tableOf(state: EditorState, pos: number) {
  const inner = syntaxTree(state).resolveInner(pos, -1);
  for (let node: typeof inner | null = inner; node; node = node.parent) if (node.name === "Table") return node;
  return null;
}
const DELIMITER = /^\s*\|?\s*:?-{3,}/;

/** Tab and Shift-Tab in a table: the next or previous cell, the delimiter row skipped; Tab in the last cell adds a row. */
function tab(back: boolean) {
  return (view: EditorView) => {
    const { state } = view;
    const pos = state.selection.main.head;
    const table = tableOf(state, pos);
    if (!table) return false;
    let line = state.doc.lineAt(pos);
    const col = back ? prevCell(line.text, pos - line.from) : nextCell(line.text, pos - line.from);
    if (col !== null) {
      view.dispatch({ selection: { anchor: line.from + col } });
      return true;
    }
    const first = state.doc.lineAt(table.from).number;
    const last = state.doc.lineAt(Math.max(table.from, table.to - 1)).number;
    let n = line.number + (back ? -1 : 1);
    if (n >= first && n <= last && DELIMITER.test(state.doc.line(n).text)) n += back ? -1 : 1;
    if (back) {
      if (n < first) return true;
      line = state.doc.line(n);
      const starts = cellStarts(line.text);
      view.dispatch({ selection: { anchor: line.from + (starts[starts.length - 1] ?? 0) } });
      return true;
    }
    if (n > last) {
      const row = tableRow(state.doc.line(first).text);
      view.dispatch({ changes: { from: line.to, insert: "\n" + row }, selection: { anchor: line.to + 3 } });
      return true;
    }
    line = state.doc.line(n);
    view.dispatch({ selection: { anchor: line.from + (cellStarts(line.text)[0] ?? 0) } });
    return true;
  };
}

/** The / menu on an empty line: the kinds of block, filtered as you type; Enter puts the block's markdown there. */
function slashSource(words: BlockWords) {
  return (ctx: CompletionContext) => {
    const typed = ctx.matchBefore(/^\s*\/[\w-]*$/);
    if (!typed) return null;
    const slash = typed.from + typed.text.indexOf("/");
    const options: Completion[] = SLASH.map((item, i) => ({
      label: words.kind(item.kind),
      boost: 99 - i, // the menu's own order (headings first), not the alphabet
      detail: item.insert.split("\n")[0].trim(),
      apply: (view: EditorView, _c: Completion, _from: number, to: number) => {
        view.dispatch({
          changes: { from: slash, to, insert: item.insert },
          selection: { anchor: slash + item.caret },
        });
        if (item.kind === "link") startCompletion(view);
      },
    }));
    return { from: slash + 1, options, validFor: /^[\w-]*$/ };
  };
}

/** [[ completes the workspace's note names; the closing ]] comes along unless it is already there. */
function wikiSource(notes: () => string[]) {
  return (ctx: CompletionContext) => {
    const typed = ctx.matchBefore(/\[\[[^\]\n|]*$/);
    if (!typed) return null;
    const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "]]";
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const path of notes()) {
      const name = noteName(path);
      if (seen.has(name)) continue; // the same name in two folders: Obsidian links it by name too
      seen.add(name);
      options.push({ label: name, detail: path.split("/").slice(0, -1).join("/"), apply: closed ? name : name + "]]" });
    }
    return { from: typed.from + 2, options, validFor: /^[^\]\n|]*$/ };
  };
}

/** The handle left of the block under the pointer: drag it to move the block, click it for Turn into, Duplicate,
 *  Delete and, on a table, Add row and Add column. */
function handle(words: BlockWords) {
  return ViewPlugin.fromClass(
    class {
      dom = document.createElement("button");
      line = document.createElement("div"); // where a dragged block lands
      menu: HTMLElement | null = null;
      block: Block | null = null;
      dragging: Block | null = null;
      constructor(readonly view: EditorView) {
        this.dom.className = "cm-block-handle";
        this.dom.textContent = "⋮⋮";
        this.dom.draggable = true;
        this.dom.title = words.handle;
        this.dom.setAttribute("aria-label", words.handle);
        this.line.className = "cm-drop-line";
        view.dom.append(this.dom, this.line);
        this.dom.addEventListener("mousedown", e => e.stopPropagation());
        this.dom.addEventListener("click", () => this.open());
        this.dom.addEventListener("dragstart", e => {
          if (!this.block) return;
          this.dragging = this.block;
          e.dataTransfer?.setData("text/plain", view.state.sliceDoc(this.block.from, this.block.to));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        });
        this.dom.addEventListener("dragend", () => this.end());
      }
      place(block: Block | null) {
        this.block = block;
        const at = block ? this.view.coordsAtPos(block.from) : null;
        if (!at) {
          this.dom.style.display = "none";
          return;
        }
        const top = this.view.dom.getBoundingClientRect().top;
        this.dom.style.display = "";
        this.dom.style.top = `${at.top - top}px`;
      }
      // where a drop at height y goes: before the block there, or after it in its lower half; past the text, the end
      target(y: number) {
        const { view } = this;
        const pos = view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 4, y }, false);
        const block = blockAt(view.state, pos);
        if (!block) return pos >= view.state.doc.length ? view.state.doc.length : null;
        const from = view.coordsAtPos(block.from);
        const to = view.coordsAtPos(block.to);
        if (!from || !to) return null;
        if (y < (from.top + to.bottom) / 2) return block.from;
        return block.to >= view.state.doc.length ? view.state.doc.length : block.to + 1;
      }
      end() {
        this.dragging = null;
        this.line.style.display = "none";
      }
      open() {
        const { view, block } = this;
        if (!block) return;
        this.close();
        const menu = document.createElement("div");
        menu.className = "cm-block-menu";
        menu.setAttribute("role", "menu");
        const item = (label: string, run: () => void) => {
          const b = document.createElement("button");
          b.setAttribute("role", "menuitem");
          b.textContent = label;
          b.addEventListener("mousedown", e => e.preventDefault());
          b.addEventListener("click", () => {
            this.close();
            run();
            view.focus();
          });
          menu.append(b);
        };
        const head = document.createElement("div");
        head.className = "cm-block-menu-head";
        head.textContent = words.turnInto;
        menu.append(head);
        // a heading or a list item turns its own line, not its section or nested items
        const one = LEVEL.test(block.name) || block.name === "ListItem";
        const to = one ? view.state.doc.lineAt(block.from).to : block.to;
        for (const kind of TURN_INTO)
          item(words.kind(kind), () =>
            view.dispatch({
              changes: { from: block.from, to, insert: turnInto(view.state.sliceDoc(block.from, to), kind) },
            }),
          );
        menu.append(Object.assign(document.createElement("hr"), { className: "cm-block-menu-sep" }));
        if (block.name === "Table") {
          item(words.addRow, () => {
            const header = view.state.doc.lineAt(block.from).text;
            view.dispatch({ changes: { from: block.to, insert: "\n" + tableRow(header) } });
          });
          item(words.addColumn, () =>
            view.dispatch({
              changes: {
                from: block.from,
                to: block.to,
                insert: tableAddColumn(view.state.sliceDoc(block.from, block.to)),
              },
            }),
          );
        }
        item(words.duplicate, () =>
          view.dispatch({ changes: { from: block.to, insert: "\n" + view.state.sliceDoc(block.from, block.to) } }),
        );
        item(words.remove, () => {
          const doc = view.state.doc;
          // the block and the line break after it (or before it, at the end)
          const from = block.to < doc.length ? block.from : Math.max(0, block.from - 1);
          const to = block.to < doc.length ? block.to + 1 : block.to;
          view.dispatch({ changes: { from, to } });
        });
        menu.style.top = this.dom.style.top;
        view.dom.append(menu);
        // no room under the handle: the menu opens above it
        if (menu.getBoundingClientRect().bottom > window.innerHeight - 8) menu.classList.add("cm-block-menu-up");
        this.menu = menu;
        const away = (e: Event) => {
          if (e instanceof KeyboardEvent ? e.key === "Escape" : !menu.contains(e.target as Node)) this.close();
        };
        document.addEventListener("mousedown", away, true);
        document.addEventListener("keydown", away, true);
        menu.addEventListener("close", () => {
          document.removeEventListener("mousedown", away, true);
          document.removeEventListener("keydown", away, true);
        });
      }
      close() {
        this.menu?.dispatchEvent(new Event("close"));
        this.menu?.remove();
        this.menu = null;
      }
      update() {
        if (this.block && this.block.to > this.view.state.doc.length) this.place(null);
      }
      destroy() {
        this.close();
        this.dom.remove();
        this.line.remove();
      }
    },
    {
      eventHandlers: {
        mousemove(e) {
          if (this.menu || this.dragging) return;
          const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos !== null && e.target !== this.dom) this.place(blockAt(this.view.state, pos));
        },
        dragover(e) {
          if (!this.dragging) return false;
          e.preventDefault();
          const at = this.target(e.clientY);
          const coords = at === null ? null : this.view.coordsAtPos(Math.min(at, this.view.state.doc.length));
          if (coords) {
            const top = this.view.dom.getBoundingClientRect().top;
            const below = at === this.view.state.doc.length && at > 0;
            this.line.style.display = "";
            this.line.style.top = `${(below ? coords.bottom : coords.top) - top}px`;
          }
          return true;
        },
        drop(e) {
          const block = this.dragging;
          if (!block) return false;
          e.preventDefault();
          const at = this.target(e.clientY);
          this.end();
          if (at === null) return true;
          const text = this.view.state.doc.toString();
          const next = moveBlock(text, block.from, block.to, at, block.name !== "ListItem");
          if (next !== text) replaceAll(this.view, next);
          return true;
        },
      },
    },
  );
}

/** Everything above, for a page's editor; `notes` lists the workspace's note paths for [[ completion. */
export function blockEditing(words: BlockWords, notes: () => string[]) {
  return [
    autocompletion({ override: [slashSource(words), wikiSource(notes)], icons: false }),
    keymap.of([
      { key: "Tab", run: tab(false) },
      { key: "Shift-Tab", run: tab(true) },
    ]),
    handle(words),
    EditorView.domEventHandlers({
      paste(e, view) {
        const { from, to } = view.state.selection.main;
        const link = pasteLink(view.state.sliceDoc(from, to), e.clipboardData?.getData("text/plain") ?? "");
        if (!link) return false;
        e.preventDefault();
        view.dispatch(view.state.replaceSelection(link));
        return true;
      },
    }),
  ];
}
