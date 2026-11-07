import { useEffect, useRef, useState } from "react";
import { Compartment, EditorSelection, EditorState, Prec, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  keymap,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { openNoteLink } from "../../../application/navigation/pages";
import {
  LINE,
  MARKER_OF,
  QUOTE,
  hhmm,
  isEmptyStamp,
  isNotesLine,
  markLine,
  quoteLine,
  stamp,
  type Marker,
} from "../../../domain/calendar/meeting-view";
import { GLYPHS } from "./markers";
import { livePreview, showMarkdown } from "../workspace/livePreview";
import { formatting } from "../workspace/formatting";
import { useT } from "../../hooks/useT";
import { useEditorStore } from "../../../application/navigation/editor";
import "../../styles/page-editor.css";

const SAVE_AFTER = 800; // ms after the last keystroke

/** What the notes editor offers the transcript next to it. */
export type NotesApi = {
  quote: (who: string, text: string) => void;
  discard: () => void;
  text: () => string;
  focus: () => void;
};

// Each notes line shows its time and marker in two fixed columns and hides the `- [09:38] ! ` it is written as (and the
// `> ` of a quote), also on the line the cursor is on: the widget replaces the prefix, which the cursor skips whole.
const SVG = "http://www.w3.org/2000/svg";
class Prefix extends WidgetType {
  constructor(
    readonly time: string,
    readonly kind: Marker | null,
  ) {
    super();
  }
  override eq(other: Prefix) {
    return other.time === this.time && other.kind === this.kind;
  }
  toDOM() {
    const cell = document.createElement("span");
    cell.className = "cm-note-prefix";
    const time = document.createElement("span");
    time.className = "cm-note-time";
    time.textContent = this.time;
    const mark = document.createElement("span");
    mark.className = `cm-note-mark ${this.kind ? `cm-marker-${this.kind}` : ""}`;
    if (this.kind) {
      const { paths, fill } = GLYPHS[this.kind];
      if (!paths.length) mark.textContent = "?";
      else {
        const svg = document.createElementNS(SVG, "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("class", fill ? "cm-marker-fill" : "glyph");
        for (const d of paths) {
          const path = document.createElementNS(SVG, "path");
          path.setAttribute("d", d);
          svg.append(path);
        }
        mark.append(svg);
      }
    }
    cell.append(time, mark);
    return cell;
  }
}
const row = Decoration.line({ class: "cm-note" });
const quoteWho = Decoration.mark({ class: "cm-quote-who" });
const quoteText = Decoration.mark({ class: "cm-quote-text" });
/** How much of a line the prefix widget hides (the dash, time, marker and the `> ` of a quote); 0 for a line without a time. */
function prefixEnd(text: string) {
  const m = LINE.exec(text);
  if (!m) return 0;
  const sign = m[1].length;
  const end = sign + (m[3] ? (text[sign + 1] === " " ? 2 : 1) : 0);
  return QUOTE.test(text.slice(end)) ? end + 2 : end;
}
// the cursor never stays inside a hidden prefix (Home, a click in the gutter): it goes to where the text starts
const outOfPrefix = EditorState.transactionFilter.of(tr => {
  if (!tr.selection || tr.docChanged) return tr;
  let moved = false;
  const ranges = tr.selection.ranges.map(range => {
    if (!range.empty) return range;
    const line = tr.newDoc.lineAt(range.head);
    const end = prefixEnd(line.text);
    if (!end || range.head - line.from >= end) return range;
    moved = true;
    return EditorSelection.cursor(line.from + end);
  });
  return moved ? [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex) }] : tr;
});
function decorate(view: EditorView) {
  const marks: Range<Decoration>[] = [];
  const glyphs: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const m = LINE.exec(line.text);
      if (m) {
        const end = prefixEnd(line.text);
        const quote = QUOTE.exec(line.text.slice(end - 2)); // a quote: the prefix reaches past its "> ";
        marks.push(row.range(line.from));
        glyphs.push(
          Decoration.replace({ widget: new Prefix(m[2], m[3] ? MARKER_OF[m[3]] : null) }).range(
            line.from,
            line.from + end,
          ),
        );
        if (quote) {
          const who = quote[1] ? quote[1].length + 1 : 0; // the name and its colon
          if (who) marks.push(quoteWho.range(line.from + end, line.from + end + who));
          if (line.from + end + who + (who ? 1 : 0) < line.to)
            marks.push(quoteText.range(line.from + end + who + (who ? 1 : 0), line.to));
        }
      }
      pos = line.to + 1;
    }
  }
  return { all: Decoration.set([...marks, ...glyphs], true), glyphs: Decoration.set(glyphs, true) };
}
const lines = ViewPlugin.fromClass(
  class {
    all: DecorationSet;
    glyphs: DecorationSet; // the replaced prefixes: the cursor skips them whole
    constructor(view: EditorView) {
      ({ all: this.all, glyphs: this.glyphs } = decorate(view));
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) ({ all: this.all, glyphs: this.glyphs } = decorate(u.view));
    }
  },
  { decorations: v => v.all },
);

// a new line gets its time; Enter on a line that holds nothing else leaves the list; ⌘1/2/3 mark the line
const lineAt = (view: EditorView, pos = view.state.selection.main.head) => view.state.doc.lineAt(pos);
function enter(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const line = lineAt(view, from);
  if (!isNotesLine(line.text)) return false;
  if (from === to && isEmptyStamp(line.text)) {
    view.dispatch({ changes: { from: line.from, to: line.to }, selection: { anchor: line.from }, userEvent: "delete" });
    return true;
  }
  const insert = `\n${stamp(hhmm(new Date()))}`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input" });
  return true;
}
const mark = (kind: Marker) => (view: EditorView) => {
  const line = lineAt(view);
  const change = markLine(line.text, kind, hhmm(new Date()));
  view.dispatch({
    changes: { from: line.from + change.from, to: line.from + change.to, insert: change.insert },
    userEvent: "input",
  });
  return true;
};
// the first character typed on an empty line brings its time
const stampFirst = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || !text || text === "\n" || lineAt(view, from).length) return false;
  const insert = `${stamp(hhmm(new Date()))}${text}`;
  view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length }, userEvent: "input.type" });
  return true;
});
// a quoted line of the transcript goes in at the cursor: on its own line after the one the cursor is on
function quote(view: EditorView, who: string, text: string) {
  const line = lineAt(view);
  const insert = quoteLine(hhmm(new Date()), who, text);
  const empty = !line.text.trim() || isEmptyStamp(line.text);
  const at = empty ? { from: line.from, to: line.to } : { from: line.to, to: line.to };
  const put = empty ? insert : `\n${insert}`;
  view.dispatch({ changes: { ...at, insert: put }, selection: { anchor: at.from + put.length }, userEvent: "input" });
  view.focus();
}

/** The meeting's notes as an editor: markdown with the Pages live preview, a time at the start of every line, ⌘1, ⌘2 and
 *  ⌘3 for an action, a decision and a question. `onSave` gets the text a moment after typing stops, on blur and when
 *  the editor goes away. Made once from `initial`: a Reload gives it a new key. */
export function NotesEditor({
  initial,
  onSave,
  apiRef,
}: {
  initial: string;
  onSave: (text: string) => void;
  apiRef: { current: NotesApi | null };
}) {
  const { t } = useT();
  const host = useRef<HTMLDivElement>(null);
  const [first] = useState(initial);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  });
  const hint = t("meet.notesHint");
  const label = t("meet.notesLabel");
  const [format] = useState(() => ({
    toolbar: t("fmt.toolbar"),
    bold: t("fmt.bold"),
    italic: t("fmt.italic"),
    strike: t("fmt.strike"),
    code: t("fmt.code"),
    link: t("fmt.link"),
    target: t("fmt.target"),
    removeLink: t("fmt.removeLink"),
  }));
  const raw = useEditorStore(s => s.showMarkdown);
  const mode = useRef(new Compartment()); // Show markdown, changed while the editor lives
  const rawNow = useRef(raw);
  const apply = useRef<(on: boolean) => void>(() => {});
  useEffect(() => {
    rawNow.current = raw;
    apply.current(raw);
  }, [raw]);
  useEffect(() => {
    let timer = 0;
    let saved = first;
    const write = () => {
      window.clearTimeout(timer);
      const text = view.state.doc.toString();
      if (text === saved) return;
      saved = text;
      save.current(text);
    };
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: first,
        selection: { anchor: first.length }, // typing goes on at the end
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          mode.current.of(showMarkdown.of(rawNow.current)),
          livePreview(link => void openNoteLink(link)),
          formatting(format), // the lines' time and marker are not for Turn into: no such button
          Prec.high(lines),
          EditorView.atomicRanges.of(v => v.plugin(lines)?.glyphs ?? Decoration.none),
          stampFirst,
          outOfPrefix,
          placeholder(hint),
          Prec.high(
            keymap.of([
              { key: "Enter", run: enter },
              { key: "Mod-1", run: mark("action") },
              { key: "Mod-2", run: mark("decision") },
              { key: "Mod-3", run: mark("question") },
              { key: "Mod-s", run: () => (write(), true) },
            ]),
          ),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "true" }),
          EditorView.updateListener.of(u => {
            if (u.docChanged) {
              window.clearTimeout(timer);
              timer = window.setTimeout(write, SAVE_AFTER);
            }
            if (u.focusChanged && !u.view.hasFocus) write();
          }),
        ],
      }),
    });
    apply.current = on => view.dispatch({ effects: mode.current.reconfigure(showMarkdown.of(on)) });
    apiRef.current = {
      quote: (who, text) => quote(view, who, text),
      discard: () => (saved = view.state.doc.toString()), // a Reload: what is typed is not written
      text: () => view.state.doc.toString(),
      focus: () => view.focus(),
    };
    return () => {
      apiRef.current = null;
      write(); // leaving the view saves what was typed
      view.destroy();
    };
  }, [first, hint, label, apiRef, format]);
  return <div ref={host} className="page-editor notes-editor" />;
}
