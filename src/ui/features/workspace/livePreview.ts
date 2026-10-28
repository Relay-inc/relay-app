import { RangeSetBuilder, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

// An Obsidian-style live preview over the markdown text: headings, emphasis, code, links, [[wikilinks]], lists, to-dos,
// quotes and callouts show formatted, and the lines the cursor is on show their markdown. The text itself never changes:
// marks are hidden with replace decorations, so what is saved is what was typed.

const hide = Decoration.replace({});
const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string, attributes?: Record<string, string>) => Decoration.mark({ class: cls, attributes });

class Check extends WidgetType {
  constructor(readonly done: boolean) {
    super();
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
class Bullet extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = "•";
    return dot;
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

/** The lines the selection touches: shown raw. */
function rawLines(state: EditorState) {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) lines.add(n);
  }
  return lines;
}

function decorate(view: EditorView): DecorationSet {
  const { state } = view;
  const raw = rawLines(state);
  const isRaw = (pos: number) => raw.has(state.doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: node => {
        const name = node.name;
        // an Obsidian callout's [!type] is not a link: the Blockquote below shows it as the callout's title
        if (name === "Link" && state.sliceDoc(node.from, node.from + 2) === "[!") return false;
        if (HEADINGS[name]) {
          out.push(line(`cm-h cm-h${HEADINGS[name]}`).range(state.doc.lineAt(node.from).from));
        } else if (name === "HeaderMark" && !isRaw(node.from)) {
          // the #s and the space after them
          const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
          if (end > node.from) out.push(hide.range(node.from, end));
        } else if ((name === "EmphasisMark" || name === "CodeMark" || name === "LinkMark") && !isRaw(node.from)) {
          // a fenced block's ``` stay: only inline marks hide
          if (name !== "CodeMark" || node.node.parent?.name === "InlineCode") out.push(hide.range(node.from, node.to));
        } else if (name === "URL" && node.node.parent?.name === "Link" && !isRaw(node.from)) {
          out.push(hide.range(node.from, node.to));
        } else if (name === "Emphasis") out.push(mark("cm-em").range(node.from, node.to));
        else if (name === "StrongEmphasis") out.push(mark("cm-strong").range(node.from, node.to));
        else if (name === "InlineCode") out.push(mark("cm-code").range(node.from, node.to));
        else if (name === "Link") out.push(mark("cm-link").range(node.from, node.to));
        else if (name === "FencedCode") {
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            out.push(line("cm-codeblock").range(l.from));
            pos = l.to + 1;
          }
        } else if (name === "Blockquote") {
          const first = state.doc.lineAt(node.from);
          const head = CALLOUT.exec(first.text);
          const callout = head?.[1]?.toLowerCase();
          if (head && !isRaw(first.from)) {
            // "> [!note] Title": the marker hides, the rest is the title in the type's colour
            const marker = first.from + first.text.indexOf("[!");
            const end = Math.min(marker + head[0].length - head[0].indexOf("[!") + 1, first.to);
            out.push(hide.range(marker, end));
            if (first.to > end) out.push(mark("cm-callout-title").range(end, first.to));
          }
          for (let pos = node.from; pos <= node.to;) {
            const l = state.doc.lineAt(pos);
            out.push(
              Decoration.line({
                class: callout ? "cm-callout" : "cm-quote",
                attributes: callout ? { "data-callout": callout } : undefined,
              }).range(l.from),
            );
            pos = l.to + 1;
          }
        } else if (name === "QuoteMark" && !isRaw(node.from)) {
          const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
          out.push(hide.range(node.from, end));
        } else if (name === "TaskMarker" && !isRaw(node.from)) {
          const done = /x/i.test(state.sliceDoc(node.from, node.to));
          out.push(Decoration.replace({ widget: new Check(done) }).range(node.from, node.to));
          if (done) out.push(mark("cm-done").range(node.to, state.doc.lineAt(node.to).to));
        } else if (name === "ListMark" && !isRaw(node.from)) {
          // a to-do's - hides behind its checkbox; a bullet's becomes a dot; a number stays
          const item = node.node.parent;
          const task = item?.getChild("Task");
          if (task) out.push(hide.range(node.from, Math.min(node.to + 1, task.from)));
          else if (/^[-*+]$/.test(state.sliceDoc(node.from, node.to)))
            out.push(Decoration.replace({ widget: new Bullet() }).range(node.from, node.to));
        } else if (name === "HorizontalRule") out.push(line("cm-hr").range(state.doc.lineAt(node.from).from));
        return undefined; // into its children
      },
    });
    // [[wikilinks]]: Lezer's markdown has no node for them
    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index;
      const end = start + m[0].length;
      const target = m[1].replace(/#.*$/, "").trim();
      const labelFrom = m[2] ? start + 2 + m[1].length + 1 : start + 2;
      const labelTo = end - 2;
      if (isRaw(start)) {
        out.push(mark("cm-wikilink", { "data-link": target }).range(start, end));
      } else {
        out.push(hide.range(start, labelFrom));
        if (labelTo > labelFrom) out.push(mark("cm-wikilink", { "data-link": target }).range(labelFrom, labelTo));
        out.push(hide.range(labelTo, end));
      }
    }
  }
  // line decorations first at a position, then by start: what RangeSetBuilder needs
  out.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of out) builder.add(r.from, r.to, r.value);
  return builder.finish();
}

/** The live preview; `follow` opens a [[link]] (as a page, or in the drawer with ⌘). */
export function livePreview(follow: (link: string, drawer: boolean) => void) {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorate(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged)
            this.decorations = decorate(u.view);
        }
      },
      { decorations: v => v.decorations },
    ),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        const el = e.target as HTMLElement;
        // a to-do's checkbox toggles its [ ] / [x] in the text
        if (el.classList.contains("cm-task")) {
          const pos = view.posAtDOM(el);
          const marker = view.state.sliceDoc(pos, pos + 3);
          if (/^\[[ xX]\]$/.test(marker)) {
            view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: marker[1] === " " ? "x" : " " } });
          }
          e.preventDefault();
          return true;
        }
        const link = el.closest<HTMLElement>("[data-link]");
        if (link && !isRawAt(view, link)) {
          e.preventDefault();
          follow(link.dataset.link!, e.metaKey);
          return true;
        }
        return false;
      },
    }),
  ];
}
// a link on a line shown raw is text being edited: a click puts the cursor in it
const isRawAt = (view: EditorView, el: HTMLElement) =>
  rawLines(view.state).has(view.state.doc.lineAt(view.posAtDOM(el)).number);
