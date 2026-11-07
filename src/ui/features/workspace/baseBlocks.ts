import { StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { findBaseBlocks } from "../../../domain/collections/bases";
import { showMarkdown } from "./livePreview";
import { mountBase } from "./BaseView";

// A fenced `base` block in a page (issue 421) drawn as the view it describes, one atomic block over its lines: the
// text stays exactly what Obsidian reads, and Show markdown draws it as the YAML it is (that is where it is edited).
// A state field, not a view plugin: a decoration that replaces line breaks has to come from one.

class BaseBlock extends WidgetType {
  constructor(
    readonly page: string,
    readonly source: string,
  ) {
    super();
  }
  override eq(other: BaseBlock) {
    return other.page === this.page && other.source === this.source;
  }
  override ignoreEvent() {
    return true; // the clicks inside are the view's own
  }
  toDOM() {
    const dom = document.createElement("div");
    dom.className = "cm-embed cm-base-block";
    dom.dataset.kind = "base";
    unmounts.set(
      dom,
      mountBase(dom.appendChild(document.createElement("div")), { page: this.page, source: this.source, viewName: "" }),
    );
    return dom;
  }
  override destroy(dom: HTMLElement) {
    unmounts.get(dom)?.();
  }
}
const unmounts = new WeakMap<HTMLElement, () => void>();

function build(state: EditorState, page: string): DecorationSet {
  if (state.facet(showMarkdown)) return Decoration.none;
  return Decoration.set(
    findBaseBlocks(state.doc.toString()).map(b =>
      Decoration.replace({ widget: new BaseBlock(page, b.source), block: true }).range(b.from, b.to),
    ),
  );
}

/** The fenced `base` blocks of a page drawn as their views. */
export const baseBlocks = (page: string) =>
  StateField.define<DecorationSet>({
    create: state => build(state, page),
    update: (value, tr) =>
      tr.docChanged || tr.startState.facet(showMarkdown) !== tr.state.facet(showMarkdown)
        ? build(tr.state, page)
        : value,
    provide: field => [EditorView.decorations.from(field), EditorView.atomicRanges.of(view => view.state.field(field))],
  });
