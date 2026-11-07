import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { clock, findEmbeds, section, withWidth, withoutProperties, type Embed } from "../../../domain/workspace/embeds";
import {
  embedOf,
  embedUrl,
  openEmbed,
  pasteAttachments,
  pickAttachments,
  type EmbedInfo,
} from "../../../application/navigation/embeds";
import { followPageLink } from "../../../application/navigation/pages";
import { currentLang, currentLocale, t, tn } from "../../../shared/i18n";
import { fileSize } from "../../../shared/format";
import { markdownHtml } from "../../../shared/markdown";
import { mountBase } from "./BaseView";

// Files inside a page: `![[image.png]]`, `![alt|300](path)`, `![[doc.pdf]]`, `![[talk.m4a]]` and `![[Note#Heading]]` drawn
// in the live preview as the picture, a PDF card, an audio player and a read-only block of the note. The text never
// changes by drawing: an embed is a replace decoration over its markdown, one atom for the cursor. Adding files (paste,
// drop, / → File) is in this file's `attachEditing` and PageEditor's drop target.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const nameOf = (path: string) => path.split("/").pop() ?? path;
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
const MIN_WIDTH = 40;
/** The React roots inside embeds (a base's view), taken down with their widget. */
const unmounts = new WeakMap<HTMLElement, () => void>();

/** Where an embed is now in the document: its widget's DOM leads to its start, the text there gives its end. */
function embedAt(view: EditorView, dom: HTMLElement): { from: number; to: number; source: string } | null {
  const from = view.posAtDOM(dom);
  const line = view.state.doc.lineAt(from);
  const found = findEmbeds(line.text).find(e => e.from === from - line.from);
  return found ? { from, to: line.from + found.to, source: view.state.sliceDoc(from, line.from + found.to) } : null;
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly page: string,
    readonly embed: Embed,
    readonly source: string,
    readonly selected: boolean,
  ) {
    super();
  }
  override eq(other: EmbedWidget) {
    return other.page === this.page && other.source === this.source && other.selected === this.selected;
  }
  override updateDOM(dom: HTMLElement) {
    if (dom.dataset.source !== this.source || dom.dataset.page !== this.page) return false;
    dom.classList.toggle("cm-embed-selected", this.selected);
    return true;
  }
  override ignoreEvent() {
    return true; // the clicks inside are the widget's own
  }
  override destroy(dom: HTMLElement) {
    unmounts.get(dom)?.();
  }
  toDOM(view: EditorView) {
    const dom = el("div", "cm-embed");
    dom.dataset.source = this.source;
    dom.dataset.page = this.page;
    dom.classList.toggle("cm-embed-selected", this.selected);
    // a click on the embed selects it (the ring and handles of an image), like a click on a block
    dom.addEventListener("mousedown", e => {
      if ((e.target as HTMLElement).closest("button,a,audio,[data-grip],.cm-base")) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(dom) } });
      view.focus();
    });
    void embedOf(this.page, this.embed.target).then(info => {
      this.fill(dom, info, view);
      view.requestMeasure();
    });
    return dom;
  }

  fill(dom: HTMLElement, info: EmbedInfo, view: EditorView) {
    const { embed } = this;
    if (info.missing || !info.path) {
      dom.append(el("div", "cm-embed-missing", t("embed.missing", { name: embed.target })));
      return;
    }
    dom.dataset.kind = info.kind;
    const { path, rel = "" } = info;
    if (info.kind === "image") dom.append(this.image(dom, path, rel, view));
    else if (info.kind === "audio") dom.append(this.audio(path, info));
    else if (info.kind === "note") dom.append(this.note(info));
    else if (info.kind === "base") {
      // a base's view (issue 421): `this` is this page, `#View` picks the view; it follows the collections store
      const host = dom.appendChild(el("div", ""));
      unmounts.set(dom, mountBase(host, { page: this.page, source: info.text ?? "", viewName: embed.heading }));
    } else dom.append(this.card(path, rel, info));
  }

  // a picture: its width from `|300`, a ring and two handles when selected, its caption (the alt text) under it
  image(dom: HTMLElement, path: string, rel: string, view: EditorView) {
    const { embed } = this;
    const figure = el("figure", "cm-embed-figure");
    const frame = el("div", "cm-embed-frame");
    if (embed.width) frame.style.width = `${embed.width}px`;
    const img = el("img", "cm-embed-image");
    img.alt = embed.alt || nameOf(embed.target);
    img.draggable = false;
    img.addEventListener("load", () => view.requestMeasure());
    img.src = embedUrl(path);
    frame.append(img);
    const caption = el("figcaption", "cm-embed-caption");
    const text = el("span", "", embed.alt);
    const meta = el("span", "cm-embed-meta");
    const width = el("span", "", "");
    const showWidth = (px: number) => (width.textContent = t("embed.width", { n: Math.round(px) }));
    meta.append(el("span", "cm-embed-path", rel), width);
    caption.append(text, meta);
    img.addEventListener("load", () => !embed.width && showWidth(frame.clientWidth), { once: true });
    if (embed.width) showWidth(embed.width);
    for (const side of ["left", "right"] as const) {
      const grip = el("span", `cm-embed-grip cm-embed-grip-${side}`);
      grip.dataset.grip = side;
      grip.setAttribute("role", "separator");
      grip.setAttribute("aria-label", t("embed.resize"));
      grip.addEventListener("pointerdown", e => this.resize(e, grip, side, dom, frame, showWidth, view));
      figure.append(grip);
    }
    figure.append(frame, caption);
    return figure;
  }
  // the handle's drag: the picture follows, and the new width is written as `|<width>` when the pointer is released
  resize(
    e: PointerEvent,
    grip: HTMLElement,
    side: "left" | "right",
    dom: HTMLElement,
    frame: HTMLElement,
    show: (px: number) => void,
    view: EditorView,
  ) {
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, width: frame.getBoundingClientRect().width };
    const max = view.contentDOM.clientWidth;
    let width = start.width;
    const move = (m: PointerEvent) => {
      width = Math.min(max, Math.max(MIN_WIDTH, start.width + (m.clientX - start.x) * (side === "right" ? 1 : -1)));
      frame.style.width = `${width}px`;
      show(width);
    };
    const end = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      const at = embedAt(view, dom);
      if (at && Math.round(width) !== Math.round(start.width))
        view.dispatch({
          changes: { from: at.from, to: at.to, insert: withWidth(at.source, width) },
          userEvent: "input.resize",
        });
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
  }

  // a PDF (its first page, name, pages, size) or any other file: a card with Open
  card(path: string, rel: string, info: EmbedInfo) {
    const pdf = info.kind === "pdf";
    const card = el("div", "cm-embed-card");
    card.setAttribute("role", "group");
    const thumb = el("span", "cm-embed-thumb");
    thumb.setAttribute("aria-hidden", "true");
    if (info.thumb) thumb.append(Object.assign(el("img", ""), { src: info.thumb, alt: "", draggable: false }));
    else thumb.textContent = (nameOf(rel).split(".").pop() ?? "").slice(0, 4).toUpperCase();
    const text = el("span", "cm-embed-text");
    const parts = [
      pdf ? "PDF" : "",
      pdf && info.pages ? tn("embed.pages", info.pages) : "",
      fileSize(info.size ?? 0, currentLocale()),
      folderOf(rel),
    ].filter(Boolean);
    text.append(el("span", "cm-embed-name", nameOf(rel)), el("span", "cm-embed-sub", parts.join(" · ")));
    const open = el("button", "cm-embed-open", t("embed.open"));
    open.type = "button";
    const go = () => void openEmbed(path);
    open.addEventListener("click", go);
    card.addEventListener("dblclick", go);
    card.append(thumb, text, open);
    return card;
  }

  // an audio file: play and pause, the clock, a bar of what is played; the file itself is the webview's audio element
  audio(path: string, info: EmbedInfo) {
    const name = nameOf(info.rel ?? path);
    const player = el("div", "cm-embed-audio");
    player.setAttribute("role", "group");
    player.setAttribute("aria-label", t("embed.audio", { name }));
    const audio = el("audio", "");
    audio.preload = "metadata";
    audio.src = embedUrl(path);
    const play = el("button", "cm-embed-play");
    play.type = "button";
    play.setAttribute("aria-label", t("embed.play"));
    play.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"></path></svg>';
    const pause =
      '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor"></path></svg>';
    const playing = play.innerHTML;
    const label = el("span", "cm-embed-text");
    const time = el("span", "cm-embed-sub", "0:00 / 0:00");
    label.append(el("span", "cm-embed-name", name), time);
    // the bars are a picture of the progress, not of the sound
    const bars = el("span", "cm-embed-wave");
    bars.setAttribute("aria-hidden", "true");
    const heights = Array.from({ length: 40 }, (_, i) => 20 + ((i * 37 + name.length * 11) % 70));
    const cells = heights.map(h =>
      bars.appendChild(Object.assign(el("span", "cm-embed-bar"), { style: `height:${h}%` })),
    );
    const paint = () => {
      const done = audio.duration ? audio.currentTime / audio.duration : 0;
      cells.forEach((c, i) => c.classList.toggle("cm-embed-bar-done", i < done * cells.length));
      time.textContent = `${clock(audio.currentTime)} / ${clock(audio.duration)}`;
    };
    play.addEventListener("click", () => void (audio.paused ? audio.play() : audio.pause()));
    audio.addEventListener("play", () => ((play.innerHTML = pause), play.setAttribute("aria-label", t("embed.pause"))));
    for (const done of ["pause", "ended"])
      audio.addEventListener(
        done,
        () => ((play.innerHTML = playing), play.setAttribute("aria-label", t("embed.play"))),
      );
    for (const tick of ["timeupdate", "loadedmetadata", "durationchange"]) audio.addEventListener(tick, paint);
    bars.addEventListener("click", e => {
      const box = bars.getBoundingClientRect();
      if (audio.duration) audio.currentTime = (audio.duration * (e.clientX - box.left)) / box.width;
    });
    player.append(play, label, bars, audio);
    return player;
  }

  // another note, or a section of it, read-only: a rule on its left, Open at the right. One level: an embed inside it
  // stays out.
  note(info: EmbedInfo) {
    const { embed } = this;
    const name = nameOf(info.rel ?? embed.target).replace(/\.md$/i, "");
    const text = withoutProperties(info.text ?? "");
    const found = embed.heading ? section(text, embed.heading) : null;
    const block = el("div", "cm-embed-note");
    block.setAttribute("role", "group");
    block.setAttribute("aria-label", t("embed.note", { name }));
    const head = el("div", "cm-embed-note-head");
    head.append(el("span", "cm-embed-sub", name), el("span", "cm-embed-spacer"));
    const open = el("button", "cm-embed-link", t("embed.open"));
    open.type = "button";
    open.addEventListener("click", () => followPageLink(embed.target, false, found ? embed.heading : ""));
    head.append(open);
    block.append(head);
    if (embed.heading && !found) {
      block.append(el("div", "cm-embed-missing", t("embed.section", { heading: embed.heading })));
      return block;
    }
    if (found) block.append(el("div", "cm-embed-note-title", found.title));
    const body = el("div", "cm-embed-note-body md-note");
    body.innerHTML = markdownHtml((found ? found.body : text).replace(/!\[\[[^\]\n]*\]\]/g, ""), 0, currentLang());
    block.append(body);
    return block;
  }
}

const inCode = (state: EditorState, pos: number) => {
  for (
    let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent as typeof node
  )
    if (node.name === "InlineCode" || node.name === "FencedCode" || node.name === "CodeBlock") return true;
  return false;
};

function decorate(view: EditorView, page: string): DecorationSet {
  const { state } = view;
  const sel = state.selection.main;
  const builder = new RangeSetBuilder<Decoration>();
  let touching = false;
  for (const { from, to } of view.visibleRanges) {
    // whole lines: an embed is never cut by the edge of what is visible
    const start = state.doc.lineAt(from).from;
    const end = state.doc.lineAt(to).to;
    for (const embed of findEmbeds(state.sliceDoc(start, end))) {
      const [a, b] = [start + embed.from, start + embed.to];
      if (a < from && b <= from) continue;
      if (inCode(state, a)) continue;
      const selected = sel.from <= b && sel.to >= a;
      touching ||= selected;
      builder.add(a, b, Decoration.replace({ widget: new EmbedWidget(page, embed, state.sliceDoc(a, b), selected) }));
    }
  }
  view.dom.classList.toggle("cm-on-embed", touching);
  return builder.finish();
}

/** The embeds of a page drawn in its editor. */
export function embeds(page: string) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view, page);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = decorate(u.view, page);
      }
    },
    {
      decorations: v => v.decorations,
      provide: p => EditorView.atomicRanges.of(view => view.plugin(p)?.decorations ?? Decoration.none),
    },
  );
  return plugin;
}

/** A paste's text is a Finder copy's: the names of its files, one per line (its files are then at paths, not in it). */
export const isFinderPaste = (text: string) =>
  !!text.trim() &&
  text
    .trim()
    .split(/[\r\n]+/)
    .every(line => /^[^/\t]+\.[A-Za-z0-9]{1,8}$/.test(line.trim()));

/** What goes into the page for files added: one `![[name]]` per file. */
export const embedText = (links: string[]) => links.map(l => `![[${l}]]`).join("\n");

/** Files added to a page by paste (a screenshot, files copied in Finder) and by / → File. The names come back from
 *  the backend once the files are in the attachments folder; the embeds are inserted where the cursor was. */
export function attachEditing(page: string) {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const board = e.clipboardData;
      if (!board?.types.includes("Files")) return false;
      const text = board.getData("text/plain").trim();
      // any other text with a file (cells copied from a sheet) pastes as the text it is
      const finder = isFinderPaste(text);
      if (text && !finder) return false;
      e.preventDefault();
      const { from, to } = view.state.selection.main;
      const files = [...board.files];
      void pasteAttachments(page, files, finder).then(links => insertAt(view, from, to, links));
      return true;
    },
  });
}
/** `![[…]]` for `links` over [from, to) (clamped to the page as it is by now). */
export function insertAt(view: EditorView, from: number, to: number, links: string[]) {
  if (!links.length) return;
  const end = view.state.doc.length;
  const insert = embedText(links);
  view.dispatch({
    changes: { from: Math.min(from, end), to: Math.min(to, end), insert },
    selection: { anchor: Math.min(from, end) + insert.length },
    userEvent: "input.paste",
  });
}
/** / → File: pick files, copy them in, embed them at `at`. */
export const pickAndEmbed = (page: string, view: EditorView, at: number) =>
  void pickAttachments(page).then(links => insertAt(view, at, at, links));
