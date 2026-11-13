import {
  EditorSelection,
  EditorState,
  Facet,
  Prec,
  RangeSetBuilder,
  findClusterBreak,
  type Range,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { modKey } from "../../../shared/platform.ts";

// A live preview over the markdown text, set like a document (Notion): headings, emphasis, code, links, [[wikilinks]],
// lists, to-dos, quotes and callouts show formatted and their markdown is never shown, not even on the line the cursor
// is on. The text itself never changes: marks are hidden with replace decorations, which are also atomic ranges (the
// cursor, a selection and Backspace step over them), so what is saved is what was typed. Syntax that is not complete
// (`**bol`) is not a node yet and stays visible. "Show markdown" (the `showMarkdown` facet) draws the marks again.

/** Whether the markdown marks show (the page menu's Show markdown). */
export const showMarkdown = Facet.define<boolean, boolean>({ combine: values => values.some(Boolean) });

const hide = Decoration.replace({});
const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string, attributes?: Record<string, string>) => Decoration.mark({ class: cls, attributes });

class Check extends WidgetType {
  readonly done: boolean;
  constructor(done: boolean) {
    super();
    this.done = done;
  }
  override eq(other: Check) {
    return other.done === this.done;
  }
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.done;
    box.className = "cm-task";
    return box;
  }
  override ignoreEvent() {
    return false; // the click reaches the editor's handler, which toggles the text
  }
}
/** A list's marker: the dot of a bullet, the number of an item as it is written. */
class Bullet extends WidgetType {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  override eq(other: Bullet) {
    return other.text === this.text;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = this.text;
    return dot;
  }
}
class Rule extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-rule";
    return rule;
  }
}

const HEADINGS: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
};
const WIKILINK = /\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g;
const CALLOUT = /^>\s*\[!(\w+)\]/;
// the nodes whose marks hide in pairs: Backspace takes one away whole when nothing is left of it
const INLINE = new Set(["StrongEmphasis", "Emphasis", "InlineCode", "Strikethrough", "Link"]);

type Span = { from: number; to: number };
// @lezer/common's types, through the tree CodeMirror hands out
type Tree = ReturnType<typeof syntaxTree>;
type SyntaxNode = Tree["topNode"];
type SyntaxNodeRef = Parameters<NonNullable<Parameters<Tree["iterate"]>[0]["enter"]>>[0];

// a [bracketed word] is a Link to Lezer too (a reference without its definition): a link has an address, or a label to one
const isLink = (node: SyntaxNode) => !!(node.getChild("URL") ?? node.getChild("LinkLabel"));

/** Where the hidden mark of a block (a heading's #s, a quote's >, a list's marker, a to-do's box) ends, with the space
 *  after it: null when it is not one or not complete (`#` without the space is still text). */
function blockEnd(state: EditorState, node: SyntaxNodeRef): number | null {
  const l = state.doc.lineAt(node.from);
  const space = (at: number) => (at < l.to && /[ \t]/.test(state.sliceDoc(at, at + 1)) ? at + 1 : null);
  switch (node.name) {
    case "HeaderMark":
      return node.node.parent?.name.startsWith("ATX") && !state.sliceDoc(l.from, node.from).trim()
        ? space(node.to)
        : null;
    case "QuoteMark":
      return space(node.to);
    case "ListMark": {
      const marker = node.node.parent?.getChild("Task")?.getChild("TaskMarker");
      return space(marker ? marker.to : node.to);
    }
  }
  return null;
}
/** A callout's `[!note] ` on the first line of its quote. */
function calloutOf(state: EditorState, node: SyntaxNodeRef) {
  const first = state.doc.lineAt(node.from);
  const head = CALLOUT.exec(first.text);
  if (!head) return null;
  const from = first.from + first.text.indexOf("[!");
  const end = Math.min(first.from + head[0].length + 1, first.to);
  return { first, from, end, type: head[1].toLowerCase() };
}

/** Where the hidden start of a line ends (a heading's `## `, `> `, `- [ ] `): the cursor never rests before it. */
export function prefixEnd(state: EditorState, l: { from: number; to: number; number: number }) {
  if (state.facet(showMarkdown)) return 0;
  let end = 0;
  const tree = ensureSyntaxTree(state, l.to, 20) ?? syntaxTree(state);
  tree.iterate({
    from: l.from,
    to: l.to,
    enter: node => {
      if (node.from < l.from && node.name !== "Blockquote") return undefined;
      const e = blockEnd(state, node);
      if (e !== null && e <= l.to) end = Math.max(end, e);
      if (node.name === "Blockquote" && state.doc.lineAt(node.from).number === l.number) {
        const callout = calloutOf(state, node);
        if (callout) end = Math.max(end, callout.end);
      }
      return undefined;
    },
  });
  return end;
}

type Built = { all: DecorationSet; atomic: DecorationSet; inline: Span[]; openers: Map<number, number> };

function decorate(view: EditorView): Built {
  const { state } = view;
  const raw = state.facet(showMarkdown);
  const out: Range<Decoration>[] = [];
  const blocks: Span[] = []; // the hidden marks that start a line
  const inline: Span[] = []; // the hidden marks inside a line's text
  const opens: Span[] = []; // the ones of them where what they mark starts
  const widgets: Range<Decoration>[] = [];
  const hideInline = (from: number, to: number, opener: boolean) => {
    if (raw || to <= from) return;
    inline.push({ from, to });
    if (opener) opens.push({ from, to });
  };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: node => {
        const name = node.name;
        // an Obsidian callout's [!type] is not a link: the Blockquote below shows it as the callout's title
        if (name === "Link" && state.sliceDoc(node.from, node.from + 2) === "[!") return false;
        // a picture from a file of the workspace is an embed (embeds.ts draws it); a web picture stays the text it is
        if (name === "Image" && !/^!\[[^\]]*\]\(<?[a-z][\w+.-]*:/i.test(state.sliceDoc(node.from, node.to)))
          return false;
        if (HEADINGS[name]) {
          out.push(line(`cm-h cm-h${HEADINGS[name]}`).range(state.doc.lineAt(node.from).from));
        } else if (name === "HeaderMark" || name === "QuoteMark") {
          const end = blockEnd(state, node);
          if (end !== null && !raw) blocks.push({ from: node.from, to: end });
        } else if (name === "EmphasisMark" || name === "StrikethroughMark" || name === "LinkMark") {
          const parent = node.node.parent;
          if (name !== "LinkMark" || parent?.name !== "Link" || isLink(parent))
            hideInline(node.from, node.to, node.from === parent?.from);
        } else if (name === "CodeMark") {
          // a fenced block's ``` stay: only inline marks hide
          const parent = node.node.parent;
          if (parent?.name === "InlineCode") hideInline(node.from, node.to, node.from === parent.from);
        } else if (name === "URL" && node.node.parent?.name === "Link") {
          hideInline(node.from, node.to, false);
        } else if (name === "Emphasis") out.push(mark("cm-em").range(node.from, node.to));
        else if (name === "StrongEmphasis") out.push(mark("cm-strong").range(node.from, node.to));
        else if (name === "Strikethrough") out.push(mark("cm-strike").range(node.from, node.to));
        else if (name === "InlineCode") out.push(mark("cm-code").range(node.from, node.to));
        else if (name === "Link") {
          if (isLink(node.node)) out.push(mark("cm-link").range(node.from, node.to));
        } else if (name === "FencedCode") {
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            out.push(line("cm-codeblock").range(l.from));
            pos = l.to + 1;
          }
        } else if (name === "Blockquote") {
          const callout = calloutOf(state, node);
          if (callout && !raw) {
            // "> [!note] Title": the marker hides, the rest is the title in the type's colour
            blocks.push({ from: callout.from, to: callout.end });
            if (callout.first.to > callout.end) out.push(mark("cm-callout-title").range(callout.end, callout.first.to));
          }
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            out.push(
              Decoration.line({
                class: callout ? "cm-callout" : "cm-quote",
                attributes: callout ? { "data-callout": callout.type } : undefined,
              }).range(l.from),
            );
            pos = l.to + 1;
          }
        } else if (name === "ListMark") {
          const end = blockEnd(state, node);
          const task = node.node.parent?.getChild("Task")?.getChild("TaskMarker");
          const done = !!task && /x/i.test(state.sliceDoc(task.from, task.to));
          if (end !== null && !raw) {
            // a to-do's - and [ ] are its checkbox; a bullet's - becomes a dot; a number stays as written
            const text = state.sliceDoc(node.from, node.to);
            const widget = task ? new Check(done) : new Bullet(/^[-*+]$/.test(text) ? "•" : text);
            widgets.push(Decoration.replace({ widget }).range(node.from, end));
          }
          if (done) out.push(mark("cm-done").range(Math.max(end ?? 0, task!.to), state.doc.lineAt(node.to).to));
        } else if (name === "HorizontalRule") {
          out.push(line("cm-hr").range(state.doc.lineAt(node.from).from));
          if (!raw && node.to > node.from)
            widgets.push(Decoration.replace({ widget: new Rule() }).range(node.from, node.to));
        }
        return undefined; // into its children
      },
    });
    // [[wikilinks]]: Lezer's markdown has no node for them
    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (text[m.index - 1] === "!") continue; // ![[embed]]: embeds.ts
      const target = m[1].replace(/#.*$/, "").trim();
      const labelFrom = m[2] ? start + 2 + m[1].length + 1 : start + 2;
      const labelTo = end - 2;
      if (labelTo > labelFrom) out.push(mark("cm-wikilink", { "data-link": target }).range(labelFrom, labelTo));
      hideInline(start, labelFrom, true);
      hideInline(labelTo, end, false);
    }
  }
  // next to each other, hidden ranges are one: the cursor has no place between them
  const merged = (spans: Span[]) => {
    const result: Span[] = [];
    for (const s of [...spans].sort((a, b) => a.from - b.from || a.to - b.to)) {
      const last = result[result.length - 1];
      if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
      else result.push({ ...s });
    }
    return result;
  };
  const inlineHidden = merged(inline);
  const atomic = [...merged(blocks), ...inlineHidden].map(s => hide.range(s.from, s.to)).concat(widgets);
  const openers = new Map<number, number>();
  for (const o of opens) {
    const group = inlineHidden.find(g => g.from <= o.from && o.to <= g.to);
    if (group && group.to === o.to) openers.set(group.to, group.from);
  }
  out.push(...atomic);
  // line decorations first at a position, then by start: what RangeSetBuilder needs
  out.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of out) builder.add(r.from, r.to, r.value);
  return { all: builder.finish(), atomic: Decoration.set(atomic, true), inline: inlineHidden, openers };
}

const preview = ViewPlugin.fromClass(
  class {
    decorations!: DecorationSet;
    atomic!: DecorationSet;
    inline!: Span[];
    openers!: Map<number, number>;
    constructor(view: EditorView) {
      this.build(view);
    }
    build(view: EditorView) {
      const built = decorate(view);
      this.decorations = built.all;
      this.atomic = built.atomic;
      this.inline = built.inline;
      this.openers = built.openers;
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.startState.facet(showMarkdown) !== u.state.facet(showMarkdown)
      )
        this.build(u.view);
    }
  },
  { decorations: v => v.decorations },
);

/** The link a position is in: a markdown link or a [[wikilink]], with its text. */
export function linkAt(state: EditorState, pos: number): { from: number; to: number; src: string } | null {
  const l = state.doc.lineAt(pos);
  for (const m of l.text.matchAll(WIKILINK)) {
    const from = l.from + m.index;
    if (l.text[m.index - 1] === "!") continue;
    if (pos >= from && pos <= from + m[0].length) return { from, to: from + m[0].length, src: m[0] };
  }
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent)
    if (n.name === "Link" && isLink(n) && state.sliceDoc(n.from, n.from + 2) !== "[!")
      return { from: n.from, to: n.to, src: state.sliceDoc(n.from, n.to) };
  return null;
}

// the cursor never rests before a line's hidden start (Home, a click left of a heading): it goes after it
const outOfPrefix = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.selection && !tr.docChanged) return tr;
  const sel = tr.newSelection;
  let moved = false;
  const ranges = sel.ranges.map(range => {
    if (!range.empty) return range;
    const end = prefixEnd(tr.state, tr.newDoc.lineAt(range.head));
    if (!end || range.head >= end) return range;
    moved = true;
    return EditorSelection.cursor(end);
  });
  return moved ? [tr, { selection: EditorSelection.create(ranges, sel.mainIndex), sequential: true }] : tr;
});
// ← from the start of a line's text goes to the end of the line above, as it does from any line's start
const leftOfPrefix = (view: EditorView) => {
  const { state } = view;
  const { empty, head } = state.selection.main;
  const l = state.doc.lineAt(head);
  if (!empty || l.from === 0 || head !== prefixEnd(state, l)) return false;
  view.dispatch({ selection: { anchor: l.from - 1 }, scrollIntoView: true, userEvent: "select" });
  return true;
};

/** The node a hidden group of marks belongs to. */
function ownerOf(state: EditorState, group: Span): Span | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(group.from, 1); n; n = n.parent)
    if (INLINE.has(n.name) && n.from <= group.from && n.to >= group.to) return { from: n.from, to: n.to };
  const l = state.doc.lineAt(group.from);
  for (const m of l.text.matchAll(WIKILINK)) {
    const from = l.from + m.index;
    if (from <= group.from && from + m[0].length >= group.to) return { from, to: from + m[0].length };
  }
  return null;
}

/** Backspace and Delete next to hidden marks: the visible character on the other side goes, not the marks (a bold's
 *  closing ** is not a character of the text), and the marks go with the last character of what they were around. */
const hiddenDelete = (forward: boolean) => (view: EditorView) => {
  const { state } = view;
  const { empty, head } = state.selection.main;
  const inline = view.plugin(preview)?.inline;
  if (!empty || !inline || state.facet(showMarkdown)) return false;
  const group = inline.find(g => (forward ? g.from === head : g.to === head));
  if (!group) return false;
  const l = state.doc.lineAt(forward ? group.to : group.from);
  let from: number;
  let to: number;
  if (forward) {
    from = group.to;
    to = from === l.to ? Math.min(from + 1, state.doc.length) : l.from + findClusterBreak(l.text, from - l.from, true);
  } else {
    to = group.from;
    from = to === l.from ? Math.max(to - 1, 0) : l.from + findClusterBreak(l.text, to - l.from, false);
  }
  if (to <= from) return true;
  const owner = ownerOf(state, group);
  let hidden = 0;
  if (owner) for (const g of inline) hidden += Math.max(0, Math.min(g.to, owner.to) - Math.max(g.from, owner.from));
  if (owner && from >= owner.from && to <= owner.to && owner.to - owner.from - hidden <= to - from) {
    view.dispatch({ changes: owner, selection: { anchor: owner.from }, userEvent: "delete" });
    return true;
  }
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: "delete" });
  return true;
};

/** The live preview; `follow` opens a [[link]] as a page. */
export function livePreview(follow: (link: string) => void) {
  return [
    preview,
    EditorView.atomicRanges.of(view => view.plugin(preview)?.atomic ?? Decoration.none),
    outOfPrefix,
    Prec.highest(
      keymap.of([
        { key: "ArrowLeft", run: leftOfPrefix },
        { key: "Backspace", run: hiddenDelete(false) },
        { key: "Delete", run: hiddenDelete(true) },
      ]),
    ),
    // typing where a bold, a link or a code starts goes before its hidden mark: the text before it decides the style
    EditorView.inputHandler.of((view, from, to, text) => {
      const start = from === to && text ? view.plugin(preview)?.openers.get(from) : undefined;
      if (start === undefined) return false;
      view.dispatch({
        changes: { from: start, insert: text },
        selection: { anchor: start + text.length },
        userEvent: "input.type",
      });
      return true;
    }),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        const el = e.target as HTMLElement;
        // a to-do's checkbox toggles its [ ] / [x] in the text
        if (el.classList.contains("cm-task")) {
          const pos = view.posAtDOM(el);
          const at = /^[-*+]\s+\[([ xX])\]/.exec(view.state.sliceDoc(pos, pos + 12));
          if (at) {
            const x = pos + at[0].length - 2;
            view.dispatch({ changes: { from: x, to: x + 1, insert: at[1] === " " ? "x" : " " } });
          }
          e.preventDefault();
          return true;
        }
        const link = el.closest<HTMLElement>("[data-link]");
        // with the markdown shown a link is text being edited: a click puts the cursor in it, ⌘-click (Ctrl on Windows) follows
        if (link && (!view.state.facet(showMarkdown) || modKey(e))) {
          e.preventDefault();
          follow(link.dataset.link!);
          return true;
        }
        return false;
      },
    }),
  ];
}
