import { useEffect, useRef, useState } from "react";
import { EditorState, Prec, type Range } from "@codemirror/state";
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
import { followPageLink } from "../../../application/navigation/pages";
import {
  LINE,
  MARKER_OF,
  hhmm,
  isEmptyStamp,
  isNotesLine,
  markLine,
  quoteLine,
  stamp,
  type Marker,
} from "../../../domain/calendar/meeting-view";
import { livePreview } from "../workspace/livePreview";
import { useT } from "../../hooks/useT";
import "../../styles/page-editor.css";

const SAVE_AFTER = 800; // ms after the last keystroke

/** What the notes editor offers the transcript next to it. */
export type NotesApi = { quote: (text: string) => void; discard: () => void; text: () => string; focus: () => void };

// The marker after a line's time, drawn as the design's glyph; the file keeps `!`, `=` or `?`.
const SVG = "http://www.w3.org/2000/svg";
const GLYPHS: Record<Marker, { paths: string[]; fill: boolean }> = {
  action: {
    paths: [
      "M2.5 4.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z",
      "M8 7.5h6.5M12 5l2.5 2.5L12 10",
    ],
    fill: false,
  },
  decision: { paths: ["M8 1.5 14.5 8 8 14.5 1.5 8z"], fill: true },
  question: { paths: [], fill: false },
};
class MarkerGlyph extends WidgetType {
  constructor(readonly kind: Marker) {
    super();
  }
  override eq(other: MarkerGlyph) {
    return other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-marker cm-marker-${this.kind}`;
    const { paths, fill } = GLYPHS[this.kind];
    if (!paths.length) {
      el.textContent = "?";
      return el;
    }
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", fill ? "cm-marker-fill" : "glyph");
    for (const d of paths) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    el.append(svg);
    return el;
  }
}
const timeMark = Decoration.mark({ class: "cm-note-time" });
function decorate(view: EditorView) {
  const marks: Range<Decoration>[] = [];
  const glyphs: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const m = LINE.exec(line.text);
      if (m) {
        const open = line.from + m[1].indexOf("[");
        marks.push(timeMark.range(open, open + 7));
        if (m[3]) {
          const at = line.from + m[1].length;
          glyphs.push(Decoration.replace({ widget: new MarkerGlyph(MARKER_OF[m[3]]) }).range(at, at + 1));
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
    glyphs: DecorationSet; // the replaced marks: the cursor skips them whole
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
function quote(view: EditorView, text: string) {
  const line = lineAt(view);
  const insert = quoteLine(hhmm(new Date()), text);
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
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          livePreview((link, drawer) => void followPageLink(link, drawer)),
          lines,
          EditorView.atomicRanges.of(v => v.plugin(lines)?.glyphs ?? Decoration.none),
          stampFirst,
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
    apiRef.current = {
      quote: text => quote(view, text),
      discard: () => (saved = view.state.doc.toString()), // a Reload: what is typed is not written
      text: () => view.state.doc.toString(),
      focus: () => view.focus(),
    };
    return () => {
      apiRef.current = null;
      write(); // leaving the view saves what was typed
      view.destroy();
    };
  }, [first, hint, label, apiRef]);
  return <div ref={host} className="page-editor notes-editor" />;
}
