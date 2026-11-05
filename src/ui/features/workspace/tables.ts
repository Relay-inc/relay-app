import {
  Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  Prec,
  type ChangeSpec,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
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
  parseTable,
  parseTsv,
  pipes,
  rowCells,
  setAlign,
  tsvToTable,
  type Align,
  type CellSpan,
  type Table,
} from "../../../domain/workspace/tables.ts";
import { showMarkdown } from "./livePreview.ts";

// Tables in a page's editor, drawn as a grid whether or not the cursor is in them (Notion, Google Docs). The text stays
// a GFM table and the editor stays CodeMirror: the pipes and the delimiter row are hidden (atomic, like the marks of
// livePreview.ts), each row is a line laid out as a CSS grid, each cell a mark in it. So the caret, selection, IME and
// undo are CodeMirror's; every edit is a text change of the page, and the columns are re-padded in the same change as
// the typing. "Show markdown" draws the table as the text it is.

export type TableWords = {
  rowGrip: string;
  columnGrip: string;
  rowAbove: string;
  rowBelow: string;
  moveUp: string;
  moveDown: string;
  deleteRow: string;
  columnLeft: string;
  columnRight: string;
  moveLeft: string;
  moveRight: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  deleteColumn: string;
};

/** A table of the page: its whole lines, from the header to the last row. */
type Info = { from: number; to: number; first: number; lines: string[] };
/** A position in a table: the logical row (0 = header), the column and the cells of that line. */
type Loc = { info: Info; row: number; col: number; cells: CellSpan[]; lineFrom: number };

/** Everything a table command dispatches carries this: the filters below leave it alone. */
const own = Annotation.define<boolean>();

const lineOf = (row: number) => (row === 0 ? 0 : row + 1); // the delimiter row sits between the header and row 1
const rowOf = (li: number) => (li === 0 ? 0 : li - 1);

function infoOf(state: EditorState, from: number, to: number): Info | null {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(Math.max(from, to - 1)).number;
  const lines: string[] = [];
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n).text);
  // a grid only when every line is made of cells (a table in a quote or list item stays text)
  if (!parseTable(lines) || !lines.every(l => rowCells(l))) return null;
  return { from: state.doc.line(first).from, to: state.doc.line(last).to, first, lines };
}

function tableAt(state: EditorState, pos: number): Info | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  for (const side of [-1, 1] as const)
    for (let n: { name: string; from: number; to: number; parent: unknown } | null = tree.resolveInner(pos, side); n;) {
      if (n.name === "Table") return infoOf(state, n.from, n.to);
      n = n.parent as typeof n;
    }
  return null;
}

/** The tables overlapping [from, to]. */
function tablesIn(state: EditorState, from: number, to: number): Info[] {
  const out: Info[] = [];
  (ensureSyntaxTree(state, Math.min(state.doc.length, to + 1), 50) ?? syntaxTree(state)).iterate({
    from,
    to,
    enter: node => {
      if (node.name !== "Table") return undefined;
      const info = infoOf(state, node.from, node.to);
      if (info) out.push(info);
      return false;
    },
  });
  return out;
}

const caretOf = (state: EditorState) => {
  const { empty, head } = state.selection.main;
  return empty ? head : -1;
};

function locate(state: EditorState, pos: number): Loc | null {
  const info = tableAt(state, pos);
  if (!info) return null;
  const line = state.doc.lineAt(pos);
  const li = line.number - info.first;
  if (li === 1) return null; // the delimiter row is not a place to be
  const cells = rowCells(line.text, caretOf(state) - line.from)!;
  const off = pos - line.from;
  let col = 0;
  cells.forEach((c, k) => {
    if (c.pipe <= off) col = k;
  });
  return { info, row: rowOf(li), col, cells, lineFrom: line.from };
}

/** The position in the table's (new) lines of a cell: its text's start or end, or `at` characters into it. */
function posIn(info: Info, lines: string[], row: number, col: number, at: "start" | "end" | number) {
  let from = info.from;
  for (let i = 0; i < lineOf(row); i++) from += lines[i].length + 1;
  const cells = rowCells(lines[lineOf(row)])!;
  const c = cells[Math.min(col, cells.length - 1)];
  return from + (at === "end" ? c.end : at === "start" ? c.start : Math.min(c.start + at, c.end));
}

/** The smallest text change from `a` to `b`. */
function diff(a: string, b: string, base: number): ChangeSpec[] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return s === a.length && s === b.length
    ? []
    : [{ from: base + s, to: base + a.length - e, insert: b.slice(s, b.length - e) }];
}
/** The changes that turn the lines `a` into `b`: cell by cell when the lines have the same cells, so a re-pad touches
 *  only the spaces that move and anchors in the other cells of the row (a comment, a collaborator's caret) hold. */
function diffLines(a: string[], b: string[], base: number): ChangeSpec[] {
  if (a.length !== b.length) return diff(a.join("\n"), b.join("\n"), base);
  const out: ChangeSpec[] = [];
  let at = base;
  a.forEach((line, i) => {
    const p = pipes(line);
    const q = pipes(b[i]);
    if (p.length !== q.length) out.push(...diff(line, b[i], at));
    else {
      // the text before the first pipe, between each two, and after the last
      const cut = (s: string, m: number[], k: number) =>
        s.slice(k === 0 ? 0 : m[k - 1], k === m.length ? s.length : m[k]);
      for (let k = 0; k <= p.length; k++)
        out.push(...diff(cut(line, p, k), cut(b[i], q, k), at + (k === 0 ? 0 : p[k - 1])));
    }
    at += line.length + 1;
  });
  return out;
}

/** The table as a model; the caret's cell keeps the spaces typed at its end. */
function modelOf(info: Info, caret: number): Table {
  const t = parseTable(info.lines)!;
  let at = info.from;
  info.lines.forEach((line, li) => {
    if (li === 1) {
      at += line.length + 1;
      return;
    }
    const cells = rowCells(line, caret - at)!;
    const r = rowOf(li);
    cells.forEach((c, k) => {
      if (k < t.rows[r].length) t.rows[r][k] = line.slice(c.start, c.end);
    });
    at += line.length + 1;
  });
  return t;
}

/** One undo step: the table replaced by `next` (its lines padded) and the caret put in a cell of it. */
function apply(view: EditorView, info: Info, next: Table, row: number, col: number, at: "start" | "end" | number) {
  const lines = formatTable(next);
  view.dispatch({
    changes: diffLines(info.lines, lines, info.from),
    selection: { anchor: posIn(info, lines, row, col, at) },
    annotations: own.of(true),
    userEvent: "input.table",
    scrollIntoView: true,
  });
}

// ---------- the grid

// the text a cell shows, to size its column: its marks are hidden
const visible = (s: string) =>
  s
    .replace(/\\\|/g, "|")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/[*_`~]/g, "");
const ALIGN = { left: "cm-ta-left", center: "cm-ta-center", right: "cm-ta-right" } as const;
// pipes and padding are text that is not shown: a mark that is not displayed (a replace widget would put the browser's
// typing on the wrong side of it), and atomic so the caret never rests in it
const hide = Decoration.mark({ class: "cm-thide" });

type Built = { decorations: DecorationSet; atomic: DecorationSet };

function build(view: EditorView): Built {
  const { state } = view;
  if (state.facet(showMarkdown)) return { decorations: Decoration.none, atomic: Decoration.none };
  const deco: { from: number; to: number; value: Decoration }[] = [];
  const atomic: { from: number; to: number; value: Decoration }[] = [];
  const caret = caretOf(state);
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges)
    for (const info of tablesIn(state, from, to)) {
      if (seen.has(info.from)) continue;
      seen.add(info.from);
      const t = parseTable(info.lines)!;
      const widths = t.rows[0].map((_, c) => Math.min(36, Math.max(6, ...t.rows.map(r => visible(r[c]).length))));
      const columns = widths.map((w, c) => `calc(${w + (c === 0 ? 1 : 0)}ch + ${c === 0 ? 28 : 16}px)`).join(" ");
      let at = info.from;
      info.lines.forEach((text, li) => {
        const last = li === info.lines.length - 1;
        if (li === 1) {
          deco.push({ from: at, to: at, value: Decoration.line({ class: "cm-tdelim" }) });
          if (text) atomic.push({ from: at, to: at + text.length, value: hide });
        } else {
          const cls = `cm-trow ${li === 0 ? "cm-thead" : "cm-tbody"}${last ? " cm-tlast" : ""}`;
          deco.push({
            from: at,
            to: at,
            value: Decoration.line({ class: cls, attributes: { style: `grid-template-columns: ${columns}` } }),
          });
          const cells = rowCells(text, caret - at)!;
          cells.forEach((c, k) => {
            const end = k === cells.length - 1 && c.close < text.length ? c.close + 1 : c.close;
            const align = t.align[k] ? ALIGN[t.align[k] as keyof typeof ALIGN] : "";
            deco.push({
              from: at + c.pipe,
              to: at + Math.max(end, c.pipe + 1),
              value: Decoration.mark({ class: `cm-tcell ${align}`, inclusive: true }),
            });
            const hides: [number, number][] = [
              [c.pipe, c.start],
              [c.end, end],
            ];
            // a `\|` shows as the pipe it is
            for (let i = c.start; i < c.end; i++) if (text[i] === "\\" && text[i + 1] === "|") hides.push([i, i + 1]);
            for (const [a, b] of hides) if (b > a) atomic.push({ from: at + a, to: at + b, value: hide });
          });
        }
        at += text.length + 1;
      });
    }
  const sorted = (r: typeof deco) => r.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const atomicSet = Decoration.set(
    sorted(atomic).map(r => r.value.range(r.from, r.to)),
    true,
  );
  return {
    decorations: Decoration.set(
      sorted([...deco, ...atomic]).map(r => r.value.range(r.from, r.to)),
      true,
    ),
    atomic: atomicSet,
  };
}

const grid = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    scrolled: (e: Event) => void;
    host: HTMLElement;
    constructor(view: EditorView) {
      ({ decorations: this.decorations, atomic: this.atomic } = build(view));
      // a wide table scrolls inside itself: every row of it scrolls together (scroll does not bubble: captured)
      this.host = view.contentDOM;
      this.scrolled = e => {
        const row = e.target as HTMLElement;
        if (!row.classList?.contains("cm-trow")) return;
        for (const dir of ["previousElementSibling", "nextElementSibling"] as const)
          for (
            let n = row[dir] as HTMLElement | null;
            n?.classList.contains("cm-trow") || n?.classList.contains("cm-tdelim");
            n = n[dir] as HTMLElement | null
          )
            if (n.scrollLeft !== row.scrollLeft) n.scrollLeft = row.scrollLeft;
      };
      this.host.addEventListener("scroll", this.scrolled, true);
    }
    destroy() {
      this.host.removeEventListener("scroll", this.scrolled, true);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.startState.facet(showMarkdown) !== u.state.facet(showMarkdown)
      )
        ({ decorations: this.decorations, atomic: this.atomic } = build(u.view));
    }
  },
  {
    decorations: v => v.decorations,
  },
);

// ---------- the caret stays in a cell

/** The nearest place in a cell for `pos`: the pipes and the padding are not places. */
function clamp(state: EditorState, pos: number, typing: boolean): number {
  if (!state.doc.lineAt(pos).text.includes("|")) return pos;
  const info = tableAt(state, pos);
  if (!info) return pos;
  const line = state.doc.lineAt(pos);
  const li = line.number - info.first;
  if (li === 1) {
    const to =
      info.first + 2 <= info.first + info.lines.length - 1
        ? state.doc.line(info.first + 2)
        : state.doc.line(info.first);
    return to.from + rowCells(to.text)![0].start;
  }
  const off = pos - line.from;
  const cells = rowCells(line.text, typing ? off : -1)!;
  let c = cells[0];
  for (const x of cells) if (x.pipe <= off) c = x;
  return line.from + Math.min(Math.max(off, c.start), c.end);
}

const stayInCell = EditorState.transactionFilter.of((tr: Transaction) => {
  if ((!tr.selection && !tr.docChanged) || tr.startState.facet(showMarkdown)) return tr;
  const typing = tr.docChanged && tr.isUserEvent("input");
  let moved = false;
  const ranges = tr.newSelection.ranges.map(r => {
    const anchor = clamp(tr.state, r.anchor, typing);
    const head = clamp(tr.state, r.head, typing);
    if (anchor === r.anchor && head === r.head) return r;
    moved = true;
    return EditorSelection.range(anchor, head);
  });
  return moved ? [tr, { selection: EditorSelection.create(ranges, tr.newSelection.mainIndex), sequential: true }] : tr;
});

// ---------- a change never breaks a table, and the columns stay aligned

const USER = ["input", "delete"];
const structural = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged || tr.annotation(own) || tr.startState.facet(showMarkdown)) return tr;
  if (!USER.some(e => tr.isUserEvent(e))) return tr;
  const old = tr.startState;
  // A: what a change would take of the table's own text (a pipe, a line break, the delimiter row) stays: only the
  // text of cells goes, and text put in a cell has its pipes escaped
  const edits: { from: number; to: number; insert: string }[] = [];
  let rewritten = false;
  let caret = -1;
  tr.changes.iterChanges((fa, ta, _fb, _tb, ins) => {
    const tables = tablesIn(old, fa, ta);
    const here = tableAt(old, fa);
    if (here && !tables.some(t => t.from === here.from)) tables.push(here);
    if (!tables.length) {
      edits.push({ from: fa, to: ta, insert: ins.toString() });
      return;
    }
    // the text of the tables that is not a cell's: pipes, padding, the delimiter row
    const spans: [number, number][] = [];
    const inner: [number, number][] = []; // a cell between its pipes: spaces can be typed at the end of its text
    const blocked: [number, number][] = [];
    for (const t of tables) {
      let at = t.from;
      let edge = t.from;
      t.lines.forEach((line, li) => {
        if (li !== 1)
          for (const c of rowCells(line)!) {
            spans.push([at + c.start, at + c.end]);
            inner.push([at + c.pipe + 1, at + c.close]);
            blocked.push([edge, at + c.start]);
            edge = at + c.end;
          }
        at += line.length + 1;
      });
      blocked.push([edge, t.to]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    const inside = (fa === ta ? inner : spans).find(([x, y]) => fa >= x && fa <= y);
    let insert = ins.toString();
    let pos = fa;
    if (!inside && blocked.some(([x, y]) => fa >= x && fa <= y)) {
      const next = spans.find(([x]) => x >= fa) ?? spans[spans.length - 1];
      pos = Math.min(Math.max(fa, next[0]), next[1]);
      rewritten = true;
    }
    const escaped = escapeCell(insert);
    if (escaped !== insert) {
      insert = escaped;
      rewritten = true;
    }
    // the deleted range without the blocked text: [fa, ta] cut by the pieces of `blocked`
    let pieces: [number, number][] = [[fa, ta]];
    for (const [x, y] of blocked)
      pieces = pieces.flatMap(([p, q]) =>
        y <= p || x >= q
          ? [[p, q]]
          : [
              [p, Math.max(p, x)],
              [Math.min(q, y), q],
            ],
      ) as [number, number][];
    pieces = pieces.filter(([p, q]) => q > p);
    const kept = pieces.reduce((n, [p, q]) => n + q - p, 0);
    if (kept !== ta - fa) {
      rewritten = true;
      caret = pos;
    }
    if (kept === ta - fa) edits.push({ from: pos, to: Math.max(pos, ta), insert });
    else {
      edits.push({ from: pos, to: pos, insert });
      for (const [p, q] of pieces) edits.push({ from: p, to: q, insert: "" });
    }
  });
  let t: Transaction = tr;
  const spec: TransactionSpec[] = [];
  if (rewritten) {
    const cs = ChangeSet.of(edits, old.doc.length);
    const sel = caret >= 0 ? EditorSelection.cursor(cs.mapPos(caret, 1)) : undefined;
    t = old.update({ changes: cs, selection: sel, filter: false, userEvent: "input", scrollIntoView: true });
  }
  // B: the tables the change touched are padded again, in the same step
  const fixes: ChangeSpec[] = [];
  const done = new Set<number>();
  const head = t.newSelection.main.empty ? t.newSelection.main.head : -1;
  const touch = (from: number, to: number) => {
    for (const info of tablesIn(t.state, from, to)) {
      if (done.has(info.from) || !isTidy(info.lines)) continue;
      done.add(info.from);
      const next = formatTable(modelOf(info, head));
      fixes.push(...diffLines(info.lines, next, info.from));
    }
  };
  t.changes.iterChangedRanges((_fa, _ta, fb, tb) => touch(fb, tb));
  if (!rewritten && !fixes.length) return tr;
  spec.push(t as unknown as TransactionSpec);
  if (fixes.length) {
    // the caret stays before what the padding adds at it
    const selection = t.newSelection.map(ChangeSet.of(fixes, t.newDoc.length), -1);
    spec.push({ changes: fixes, selection, sequential: true });
  }
  return spec;
});

// ---------- keys

type Spot = { loc: Loc; head: number };
function spot(view: EditorView): Spot | null {
  const { state } = view;
  const { empty, head } = state.selection.main;
  const loc = locate(state, head);
  return loc ? { loc, head: empty ? head : -1 } : null;
}
const cellAt = (s: Spot) => s.loc.cells[s.loc.col];
const rowCount = (loc: Loc) => loc.info.lines.length - 2; // the last row's index
const colCount = (loc: Loc) => loc.cells.length;

function go(view: EditorView, loc: Loc, row: number, col: number, at: "start" | "end" | number = "start") {
  const lines = loc.info.lines;
  view.dispatch({
    selection: { anchor: posIn(loc.info, lines, row, col, at) },
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

/** Tab, Shift-Tab: the next or previous cell; Tab in the last cell adds a row. */
const tab = (back: boolean) => (view: EditorView) => {
  const s = spot(view);
  if (!s) return false;
  const { loc } = s;
  const model = () => modelOf(loc.info, caretOf(view.state));
  if (back) {
    if (loc.col > 0) return go(view, loc, loc.row, loc.col - 1);
    if (loc.row > 0) return go(view, loc, loc.row - 1, colCount(loc) - 1);
    return true;
  }
  if (loc.col < colCount(loc) - 1) return go(view, loc, loc.row, loc.col + 1);
  if (loc.row < rowCount(loc)) return go(view, loc, loc.row + 1, 0);
  apply(view, loc.info, addRow(model(), loc.row + 1), loc.row + 1, 0, "start");
  return true;
};

/** Enter: the cell below; in the last row it adds one. */
const enter = (view: EditorView) => {
  const s = spot(view);
  if (!s || view.state.facet(showMarkdown)) return false;
  const { loc } = s;
  if (loc.row < rowCount(loc)) return go(view, loc, loc.row + 1, loc.col);
  apply(view, loc.info, addRow(modelOf(loc.info, caretOf(view.state)), loc.row + 1), loc.row + 1, loc.col, "start");
  return true;
};

/** ↑ and ↓: the same column of the row above or below; a cell that wraps first moves within itself. */
const vertical = (forward: boolean) => (view: EditorView) => {
  const s = spot(view);
  if (!s || s.head < 0 || view.state.facet(showMarkdown)) return false;
  const { loc } = s;
  const c = cellAt(s);
  const moved = view.moveVertically(view.state.selection.main, forward);
  const start = loc.lineFrom + c.start;
  const end = loc.lineFrom + c.end;
  if (moved.head >= start && moved.head <= end && moved.head !== s.head) {
    view.dispatch({ selection: { anchor: moved.head }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  const row = loc.row + (forward ? 1 : -1);
  if (row < 0 || row > rowCount(loc)) return false;
  return go(view, loc, row, loc.col, Math.min(s.head - start, c.end - c.start));
};

/** ← and → at the edge of a cell cross into the next one; the rest is the editor's. */
const horizontal = (forward: boolean) => (view: EditorView) => {
  const s = spot(view);
  if (!s || s.head < 0 || view.state.facet(showMarkdown)) return false;
  const { loc } = s;
  const c = cellAt(s);
  const off = s.head - loc.lineFrom;
  const doc = view.state.doc;
  if (forward) {
    if (off < c.end) return false;
    if (loc.col < colCount(loc) - 1) return go(view, loc, loc.row, loc.col + 1);
    if (loc.row < rowCount(loc)) return go(view, loc, loc.row + 1, 0);
    const next = doc.lineAt(loc.info.to).number + 1;
    if (next > doc.lines) return true;
    view.dispatch({ selection: { anchor: doc.line(next).from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  if (off > c.start) return false;
  if (loc.col > 0) return go(view, loc, loc.row, loc.col - 1, "end");
  if (loc.row > 0) return go(view, loc, loc.row - 1, colCount(loc) - 1, "end");
  if (loc.info.from === 0) return true;
  view.dispatch({ selection: { anchor: loc.info.from - 1 }, scrollIntoView: true, userEvent: "select" });
  return true;
};

/** Home and End: the start and the end of the cell's text, not of the row. */
const edge = (end: boolean) => (view: EditorView) => {
  const s = spot(view);
  if (!s || view.state.facet(showMarkdown)) return false;
  const c = cellAt(s);
  const to = s.loc.lineFrom + (end ? c.end : c.start);
  const { anchor } = view.state.selection.main;
  view.dispatch({
    selection: { anchor: view.state.selection.main.empty ? to : anchor, head: to },
    userEvent: "select",
  });
  return true;
};

/** Backspace and Delete never take a pipe: at a cell's edge they do nothing, except Backspace in the first cell of an
 *  empty row, which removes the row. */
const erase = (forward: boolean) => (view: EditorView) => {
  const s = spot(view);
  if (!s || view.state.facet(showMarkdown)) return false;
  if (s.head < 0) return false; // a selection: the filter keeps the table's structure
  const { loc } = s;
  const c = cellAt(s);
  const off = s.head - loc.lineFrom;
  if (forward ? off < c.end : off > c.start) return false;
  if (!forward && loc.col === 0 && loc.row > 0 && loc.cells.every(x => x.start === x.end) && rowCount(loc) > 1) {
    const model = modelOf(loc.info, -1);
    const row = Math.min(loc.row - 1, model.rows.length - 2) || 0;
    apply(view, loc.info, deleteRow(model, loc.row), Math.max(row, 0), 0, "end");
  }
  return true;
};

/** ⌘A in a cell selects the cell first. */
const selectCell = (view: EditorView) => {
  const s = spot(view);
  if (!s || view.state.facet(showMarkdown)) return false;
  const c = cellAt(s);
  const a = s.loc.lineFrom + c.start;
  const b = s.loc.lineFrom + c.end;
  const { from, to } = view.state.selection.main;
  if (b === a || (from === a && to === b)) return false;
  if (from >= a && to <= b) view.dispatch({ selection: { anchor: a, head: b }, userEvent: "select" });
  else return false;
  return true;
};

/** Alt-arrows: move the row or column the caret is in. */
const shift = (dir: "row" | "col", by: -1 | 1) => (view: EditorView) => {
  const s = spot(view);
  if (!s || view.state.facet(showMarkdown)) return false;
  const { loc } = s;
  const model = modelOf(loc.info, caretOf(view.state));
  const off = Math.max(0, s.head - loc.lineFrom - cellAt(s).start);
  if (dir === "row") {
    const next = moveRow(model, loc.row, by);
    if (next !== model) apply(view, loc.info, next, loc.row + by, loc.col, off);
  } else {
    const next = moveColumn(model, loc.col, by);
    if (next !== model) apply(view, loc.info, next, loc.row, loc.col + by, off);
  }
  return true;
};

// ---------- typing and pasting

/** A `|` typed in a cell is stored as `\|`. */
const pipeTyped = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "|" || view.state.facet(showMarkdown) || !locate(view.state, from)) return false;
  view.dispatch({
    changes: { from, to, insert: "\\|" },
    selection: { anchor: from + 2 },
    userEvent: "input.type",
  });
  return true;
});

const pasted = EditorView.domEventHandlers({
  paste(e, view) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const { state } = view;
    if (state.facet(showMarkdown)) return false;
    const sel = state.selection.main;
    const grid = parseTsv(text);
    const loc = locate(state, sel.head);
    if (loc && grid) {
      e.preventDefault();
      const next = fillCells(modelOf(loc.info, -1), loc.row, loc.col, grid);
      apply(view, loc.info, next, Math.min(loc.row + grid.length - 1, next.rows.length - 1), loc.col, "end");
      return true;
    }
    if (loc) {
      // text pasted into a cell: one line, its pipes escaped
      e.preventDefault();
      const one = escapeCell(text.trim());
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: one },
        selection: { anchor: sel.from + one.length },
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      return true;
    }
    const line = state.doc.lineAt(sel.head);
    if (grid && sel.empty && !line.text.trim()) {
      e.preventDefault();
      const info = { from: line.from, to: line.to, first: line.number, lines: [] };
      const lines = formatTable(tsvToTable(grid));
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: lines.join("\n") },
        selection: { anchor: posIn(info, lines, 0, 0, "start") },
        annotations: own.of(true),
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      return true;
    }
    return false;
  },
});

// ---------- the row and column controls

type Entry = [string, () => void];

/** The commands of a table's row and column, for the grips and the block menu. `at` is a position in the table. */
export function tableCommands(view: EditorView, at: number, words: TableWords, pick?: { row: number; col: number }) {
  const loc =
    locate(view.state, at) ??
    (() => {
      const info = tableAt(view.state, at);
      return info ? { info, row: 0, col: 0, cells: rowCells(info.lines[0])!, lineFrom: info.from } : null;
    })();
  if (!loc) return null;
  const row = pick?.row ?? loc.row;
  const col = pick?.col ?? loc.col;
  const model = () => modelOf(loc.info, caretOf(view.state));
  const doRow = (fn: (t: Table) => Table, to: number) => () => apply(view, loc.info, fn(model()), to, col, "start");
  const doCol = (fn: (t: Table) => Table, to: number) => () => apply(view, loc.info, fn(model()), row, to, "start");
  const align = (a: Align) => () => apply(view, loc.info, setAlign(model(), col, a), row, col, "start");
  const rows: Entry[] = [
    ...(row > 0 ? ([[words.rowAbove, doRow(t => addRow(t, row), row)]] as Entry[]) : []),
    [words.rowBelow, doRow(t => addRow(t, row + 1), row + 1)],
    ...(row > 1 ? ([[words.moveUp, doRow(t => moveRow(t, row, -1), row - 1)]] as Entry[]) : []),
    ...(row > 0 && row < rowCount(loc) ? ([[words.moveDown, doRow(t => moveRow(t, row, 1), row + 1)]] as Entry[]) : []),
    ...(row > 0 && rowCount(loc) > 1
      ? ([[words.deleteRow, doRow(t => deleteRow(t, row), Math.max(0, row - 1))]] as Entry[])
      : []),
  ];
  const cols: Entry[] = [
    [words.columnLeft, doCol(t => addColumn(t, col), col)],
    [words.columnRight, doCol(t => addColumn(t, col + 1), col + 1)],
    ...(col > 0 ? ([[words.moveLeft, doCol(t => moveColumn(t, col, -1), col - 1)]] as Entry[]) : []),
    ...(col < colCount(loc) - 1 ? ([[words.moveRight, doCol(t => moveColumn(t, col, 1), col + 1)]] as Entry[]) : []),
    [words.alignLeft, align("left")],
    [words.alignCenter, align("center")],
    [words.alignRight, align("right")],
    ...(colCount(loc) > 1
      ? ([[words.deleteColumn, doCol(t => deleteColumn(t, col), Math.max(0, col - 1))]] as Entry[])
      : []),
  ];
  return { rows, cols };
}

/** The grips over the table under the pointer: a row's at its left edge, a column's above the header. Each opens a menu
 *  in the style of the block menu. */
function grips(words: TableWords) {
  return ViewPlugin.fromClass(
    class {
      rowGrip = document.createElement("button");
      colGrip = document.createElement("button");
      menu: HTMLElement | null = null;
      at = -1; // a position in the hovered table
      pick = { row: 0, col: 0 };
      view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        for (const [grip, cls, label, kind] of [
          [this.rowGrip, "cm-table-grip cm-table-row-grip", words.rowGrip, "rows"],
          [this.colGrip, "cm-table-grip cm-table-col-grip", words.columnGrip, "cols"],
        ] as const) {
          grip.className = cls;
          grip.title = label;
          grip.setAttribute("aria-label", label);
          grip.style.display = "none";
          grip.addEventListener("mousedown", e => {
            e.preventDefault();
            e.stopPropagation();
          });
          grip.addEventListener("click", () => this.open(kind, grip));
        }
        view.dom.append(this.rowGrip, this.colGrip);
      }
      hide() {
        this.rowGrip.style.display = "none";
        this.colGrip.style.display = "none";
      }
      show(cell: HTMLElement) {
        const { view } = this;
        const line = cell.parentElement as HTMLElement;
        const pos = view.posAtDOM(cell, 0);
        const doc = view.state.doc;
        const info = tableAt(view.state, pos);
        if (!info) return this.hide();
        const li = doc.lineAt(pos).number - info.first;
        const col = [...line.children].filter(c => c.classList.contains("cm-tcell")).indexOf(cell);
        this.at = pos;
        this.pick = { row: rowOf(li), col };
        let head = line;
        while (
          head.previousElementSibling?.classList.contains("cm-trow") ||
          head.previousElementSibling?.classList.contains("cm-tdelim")
        )
          head = head.previousElementSibling as HTMLElement;
        const box = view.dom.getBoundingClientRect();
        const r = line.getBoundingClientRect();
        const h = head.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        this.rowGrip.style.display = "";
        this.rowGrip.style.top = `${r.top - box.top}px`;
        this.rowGrip.style.height = `${r.height}px`;
        this.colGrip.style.display = "";
        this.colGrip.style.top = `${h.top - box.top - 10}px`;
        this.colGrip.style.left = `${Math.min(Math.max(c.left, r.left), r.right - 28) + Math.min(c.width, 120) / 2 - 12 - box.left}px`;
      }
      open(kind: "rows" | "cols", grip: HTMLElement) {
        const cmds = tableCommands(this.view, this.at, words, this.pick);
        if (!cmds) return;
        this.close();
        const menu = document.createElement("div");
        menu.className = "cm-block-menu cm-table-menu";
        menu.setAttribute("role", "menu");
        for (const [label, run] of cmds[kind]) {
          const b = document.createElement("button");
          b.setAttribute("role", "menuitem");
          b.textContent = label;
          b.addEventListener("mousedown", e => e.preventDefault());
          b.addEventListener("click", () => {
            this.close();
            run();
            this.view.focus();
          });
          menu.append(b);
        }
        const box = this.view.dom.getBoundingClientRect();
        const g = grip.getBoundingClientRect();
        menu.style.left = `${g.left - box.left + (kind === "rows" ? 14 : 0)}px`;
        menu.style.top = `${g.bottom - box.top + 4}px`;
        this.view.dom.append(menu);
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
      update(u: ViewUpdate) {
        if (u.docChanged || u.geometryChanged) this.hide();
      }
      destroy() {
        this.close();
        this.rowGrip.remove();
        this.colGrip.remove();
      }
    },
    {
      eventHandlers: {
        mousemove(e) {
          if (this.menu) return;
          const el = e.target as HTMLElement;
          const cell = el.closest?.(".cm-tcell") as HTMLElement | null;
          if (cell) this.show(cell);
          else if (!el.closest?.(".cm-table-grip")) this.hide();
        },
        mouseleave(e) {
          if (!this.menu && !(e.relatedTarget as HTMLElement | null)?.closest?.(".cm-table-grip")) this.hide();
        },
      },
    },
  );
}

/** Tables for a page's editor (before the keymap with Tab in it). */
export function tableEditing(words: TableWords) {
  return [
    grid,
    EditorView.atomicRanges.of(view => view.plugin(grid)?.atomic ?? Decoration.none),
    stayInCell,
    structural,
    pipeTyped,
    pasted,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: tab(false) },
        { key: "Shift-Tab", run: tab(true) },
        { key: "Enter", run: enter },
        { key: "ArrowUp", run: vertical(false) },
        { key: "ArrowDown", run: vertical(true) },
        { key: "ArrowLeft", run: horizontal(false) },
        { key: "ArrowRight", run: horizontal(true) },
        { key: "Home", run: edge(false) },
        { key: "End", run: edge(true) },
        { key: "Backspace", run: erase(false) },
        { key: "Delete", run: erase(true) },
        { key: "Mod-a", run: selectCell },
        { key: "Alt-ArrowUp", run: shift("row", -1) },
        { key: "Alt-ArrowDown", run: shift("row", 1) },
        { key: "Alt-ArrowLeft", run: shift("col", -1) },
        { key: "Alt-ArrowRight", run: shift("col", 1) },
      ]),
    ),
    grips(words),
  ];
}
