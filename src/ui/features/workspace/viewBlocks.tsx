import { createRoot, type Root } from "react-dom/client";
import { useEffect } from "react";
import { EditorState, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { evaluate, type View } from "../../../domain/collections/rules";
import { VIEW_LANG, parseViewSpec, viewOf } from "../../../domain/workspace/views";
import { noteName } from "../../../domain/navigation/pages";
import { loadRows, openCollection, useCollectionsStore } from "../../../application/collections/collections";
import { activeFolder } from "../../../application/navigation/workspaces";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { CollectionBoard } from "../collections/CollectionBoard";
import { CollectionTable } from "../collections/CollectionTable";
import { showMarkdown } from "./livePreview";

// Views inside a page: a ```relay-view block (domain/workspace/views.ts) drawn as the table or board of Collections.
// Like a table of the page the text never changes by drawing: the block is one replace decoration over its lines, so
// the cursor, a selection and Backspace treat it as one atom (and comments and co-editing keep anchoring on the text).
// A cell edited or a card moved writes that note's frontmatter, not the block. "Show markdown" draws the block as text.

const CAP = 8; // rows shown before "Open as collection"
const NONE: never[] = [];

function PageView({ view }: { view: View }) {
  const { t, tn } = useT();
  const folder = useDerived(() => activeFolder());
  const rows = useCollectionsStore(s => s.rows[folder]) ?? NONE;
  useEffect(() => {
    void loadRows(folder);
  }, [folder]);
  const today = new Date().toISOString().slice(0, 10);
  const shown = evaluate(rows, view);
  const part = shown.slice(0, CAP);
  return (
    <div className="my-2 px-3 pt-1 pb-2 rounded-xl border border-separator bg-bg text-[13px]">
      <div className="flex items-center gap-2 h-8 text-secondary">
        <span className="font-semibold text-label">{t(`coll.title.${view.collection}`)}</span>
        <span className="text-xs">{tn("coll.notes", shown.length)}</span>
        <button
          className="ml-auto text-xs cursor-pointer text-accent-text hover:underline"
          onClick={() => void openCollection(view.collection, view.context, view.filters)}
        >
          {t("view.open")}
        </button>
      </div>
      {view.layout === "table" ? (
        <CollectionTable rows={part} all={rows} view={view} today={today} />
      ) : (
        <CollectionBoard rows={part} view={view} today={today} />
      )}
      {shown.length > CAP ? (
        <p className="mt-1 text-xs text-secondary">{t("view.capped", { shown: CAP, n: shown.length })}</p>
      ) : null}
    </div>
  );
}

class ViewWidget extends WidgetType {
  private root: Root | null = null;
  constructor(
    readonly source: string,
    readonly page: string,
  ) {
    super();
  }
  override eq(other: ViewWidget) {
    return other.source === this.source && other.page === this.page;
  }
  override ignoreEvent() {
    return true; // clicks and keys inside are the view's own
  }
  toDOM() {
    const dom = document.createElement("div");
    dom.className = "cm-view-block";
    const spec = parseViewSpec(this.source);
    if (spec) {
      this.root = createRoot(dom);
      this.root.render(<PageView view={viewOf(spec, noteName(this.page))} />);
    }
    return dom;
  }
  override destroy() {
    const root = this.root;
    this.root = null;
    if (root) queueMicrotask(() => root.unmount()); // not while React is rendering
  }
}

/** The closed ```relay-view blocks of the document, as block widgets over their whole lines. */
function build(state: EditorState, page: string): DecorationSet {
  if (state.facet(showMarkdown)) return Decoration.none;
  const out: Range<Decoration>[] = [];
  (ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)).iterate({
    enter: node => {
      if (node.name !== "FencedCode") return undefined;
      const marks = node.node.getChildren("CodeMark").length;
      const info = node.node.getChild("CodeInfo");
      if (marks === 2 && info && state.sliceDoc(info.from, info.to).trim() === VIEW_LANG) {
        const body = node.node.getChild("CodeText");
        const source = body ? state.sliceDoc(body.from, body.to) : "";
        if (parseViewSpec(source))
          out.push(Decoration.replace({ widget: new ViewWidget(source, page), block: true }).range(node.from, node.to));
      }
      return false;
    },
  });
  return Decoration.set(out);
}

/** The view blocks of the page `page` drawn in its editor. */
export function viewBlocks(page: string) {
  return StateField.define<DecorationSet>({
    create: state => build(state, page),
    update: (set, tr) =>
      tr.docChanged || tr.startState.facet(showMarkdown) !== tr.state.facet(showMarkdown) ? build(tr.state, page) : set,
    provide: field => [EditorView.decorations.from(field), EditorView.atomicRanges.of(view => view.state.field(field))],
  });
}
