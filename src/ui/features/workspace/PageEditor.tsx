import { useEffect, useRef, useState } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, drawSelection, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  adoptPage,
  followPageLink,
  loadPage,
  pageTextIs,
  savePage,
  watchPage,
  workspacePaths,
} from "../../../application/navigation/pages";
import { headAfter, lineChanges, merge3, oneChange } from "../../../domain/workspace/merge";
import { LOCAL, openSharedPage, type Peer, type SharedPage } from "../../../application/workspace/coedit";
import { useT } from "../../hooks/useT";
import { livePreview } from "./livePreview";
import { blockEditing, type BlockWords } from "./blocks";
import "../../styles/page-editor.css";

const SAVE_AFTER = 1000; // ms after the last keystroke

/** Writes a new head (the page's properties edited) with what is typed in the body: one save, the same hash check. */
export type HeadWriter = { current: ((head: string) => Promise<void>) | null };
/** A page's file split into what comes before the body and the body, the way the page shows it. */
export type PageSplit = (text: string) => { head: string; body: string };

const MARK_FOR = 3000; // ms the lines changed outside stay marked
// a change the shared document made (another member, a file change taken in, an undo): not sent back to it
const fromDoc = Annotation.define<boolean>();
// the other members' cursors and selections on a shared document's page
const setPeers = StateEffect.define<DecorationSet>();
const peerMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (marks, tr) => tr.effects.find(e => e.is(setPeers))?.value ?? marks.map(tr.changes),
  provide: field => EditorView.decorations.from(field),
});
class PeerCaret extends WidgetType {
  constructor(
    readonly name: string,
    readonly color: string,
  ) {
    super();
  }
  override eq(other: PeerCaret) {
    return other.name === this.name && other.color === this.color;
  }
  toDOM() {
    const caret = document.createElement("span");
    caret.className = "cm-peer";
    caret.style.borderColor = this.color;
    const label = document.createElement("span");
    label.className = "cm-peer-name";
    label.style.backgroundColor = this.color;
    label.textContent = this.name;
    caret.append(label);
    return caret;
  }
  override ignoreEvent() {
    return true;
  }
}
// the lines a change made outside Relay touched, marked for a moment with who made it
const markOutside = StateEffect.define<DecorationSet>();
const outsideMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (marks, tr) => tr.effects.find(e => e.is(markOutside))?.value ?? marks.map(tr.changes),
  provide: field => EditorView.decorations.from(field),
});

/** A page's body as an editor: markdown with a live preview, saved a second after typing stops, on blur and with ⌘S.
 *  `head` is what comes before the body in the file (frontmatter, the title's heading) and goes back unchanged, unless
 *  the properties above set a new one through `headRef`. When the file changed on disk since it was read, nothing is
 *  written and a bar offers Reload or Keep mine. */
export function PageEditor({
  page,
  head,
  body,
  headRef,
  split,
  onPeers,
}: {
  page: string;
  head: string;
  body: string;
  headRef: HeadWriter;
  split: PageSplit;
  onPeers?: (peers: Peer[]) => void; // who else is on the page, when it is a shared document
}) {
  const { t } = useT();
  const [changed, setChanged] = useState(false);
  const [failed, setFailed] = useState("");
  const [generation, setGeneration] = useState(0); // a Reload makes a fresh editor from the file
  const save = useRef<(force?: boolean) => Promise<void>>(async () => {});
  return (
    <div className="flex flex-col gap-3">
      {changed ? (
        <div role="alert" className="flex items-center gap-3 px-3 py-2 rounded-lg bg-fill-2 text-[13px]">
          <span className="flex-1 text-label">{t("page.changedOnDisk")}</span>
          <button
            className="h-7 px-2.5 rounded-md border border-separator hover:bg-fill"
            onClick={() => {
              setChanged(false);
              void loadPage(page).then(() => setGeneration(g => g + 1));
            }}
          >
            {t("page.reload")}
          </button>
          <button
            className="h-7 px-2.5 rounded-md bg-accent text-on-accent hover:opacity-90"
            onClick={() => void save.current(true)}
          >
            {t("page.keepMine")}
          </button>
        </div>
      ) : null}
      {failed ? <div className="err-box">{failed}</div> : null}
      <Editor
        key={generation}
        page={page}
        head={head}
        body={body}
        split={split}
        onPeers={onPeers}
        onReady={(write, setHead) => {
          save.current = write;
          headRef.current = setHead;
        }}
        onChanged={setChanged}
        onFailed={setFailed}
      />
    </div>
  );
}

/** The CodeMirror view, made once from the text it was given: later reads of the same page (after a save) must not
 *  reset what is being typed, a Reload gives it a new key. */
function Editor(props: {
  page: string;
  head: string;
  body: string;
  split: PageSplit;
  onPeers?: (peers: Peer[]) => void;
  onReady: (write: (force?: boolean) => Promise<void>, setHead: (head: string) => Promise<void>) => void; // Keep mine, properties
  onChanged: (changed: boolean) => void;
  onFailed: (error: string) => void;
}) {
  const { t } = useT();
  const host = useRef<HTMLDivElement>(null);
  const [first] = useState(props); // what the editor was made from
  const label = t("page.editor");
  const [by] = useState(() => ({
    relay: t("page.updatedLinks"),
    claude: t("page.updatedByClaude"),
    disk: t("page.updatedOnDisk"),
  }));
  const [words] = useState<BlockWords>(() => ({
    kind: kind => t(`block.${kind}`),
    turnInto: t("block.turnInto"),
    duplicate: t("block.duplicate"),
    remove: t("block.delete"),
    addRow: t("block.addRow"),
    addColumn: t("block.addColumn"),
    handle: t("block.handle"),
  }));
  useEffect(() => {
    const { page, body, split, onReady, onChanged, onFailed, onPeers } = first;
    // a shared document's page (ticket 9): typed into its text after the head, not saved as a file
    let shared: SharedPage | null = null;
    let headLen = 0; // where the body starts in the document's text
    let closed = false;
    const undoHistory = new Compartment();
    let head = first.head; // a property edited above replaces it
    let headRead = head; // the head as the file last had it
    let saved = body;
    let timer = 0;
    let blocked = false; // changed on disk: no autosave until Reload or Keep mine
    // `dirty`: the head changed, write even when the body did not
    const write = async (force = false, dirty = false) => {
      window.clearTimeout(timer);
      if (shared) return; // the Mac's documents write its file
      const text = view.state.doc.toString();
      if ((blocked || (text === saved && !dirty)) && !force) return;
      try {
        if ((await savePage(page, head + text, force)) === "changed") {
          blocked = true;
          onChanged(true);
          return;
        }
        saved = text;
        headRead = head;
        blocked = false;
        onChanged(false);
        onFailed("");
      } catch (e) {
        onFailed(String(e));
      }
    };
    onReady(write, next => {
      if (shared) {
        const { text } = shared;
        const c = oneChange(text.toString().slice(0, headLen), next);
        text.doc!.transact(() => {
          if (c.to > c.from) text.delete(c.from, c.to - c.from);
          if (c.insert) text.insert(c.from, c.insert);
        }, LOCAL);
        headLen = next.length;
        head = headRead = next;
        pageTextIs(page, text.toString());
        return Promise.resolve();
      }
      head = next;
      return write(false, true);
    });
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: body,
        extensions: [
          undoHistory.of(history()),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          livePreview((link, drawer) => void followPageLink(link, drawer)),
          blockEditing(words, () => workspacePaths()), // before the keymap below: Tab in a table moves between cells
          keymap.of([
            // on a shared document ⌘Z undoes only what was typed here (Y.UndoManager with this Mac's origin)
            { key: "Mod-z", run: () => !!shared && (shared.undo.undo(), true) },
            { key: "Mod-Shift-z", run: () => !!shared && (shared.undo.redo(), true) },
            { key: "Mod-y", run: () => !!shared && (shared.undo.redo(), true) },
            {
              key: "Mod-s",
              run: () => {
                void write();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          outsideMarks,
          peerMarks,
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "true" }),
          EditorView.updateListener.of(u => {
            const fromShared = u.transactions.some(tr => tr.annotation(fromDoc));
            if (shared && u.docChanged && !fromShared) {
              // typed here: into the document's text, each change from the end so the positions before it hold
              const { text } = shared;
              const changes: [number, number, string][] = [];
              u.changes.iterChanges((from, to, _f, _t, insert) => changes.push([from, to, insert.toString()]));
              text.doc!.transact(() => {
                for (const [from, to, insert] of changes.reverse()) {
                  if (to > from) text.delete(headLen + from, to - from);
                  if (insert) text.insert(headLen + from, insert);
                }
              }, LOCAL);
            }
            if (shared && (u.selectionSet || (u.docChanged && !fromShared))) {
              const { anchor, head: at } = u.state.selection.main;
              shared.cursor(headLen + anchor, headLen + at);
            }
            if (u.docChanged) {
              window.clearTimeout(timer);
              timer = window.setTimeout(() => void write(), SAVE_AFTER);
            }
            if (u.focusChanged && !u.view.hasFocus) void write();
          }),
        ],
      }),
    });
    // the file changed outside Relay (Claude, Obsidian, a shared round): merged into what is typed when the two did not
    // change the same lines, else the bar. Not undoable with ⌘Z: it is not the user's edit.
    let unmark = 0;
    const stopWatching = watchPage(page, ({ text: disk, hash, by: who }) => {
      if (blocked) return; // the bar is up: Reload or Keep mine decides
      const theirs = split(disk);
      const typed = view.state.doc.toString();
      const nextHead = theirs.head === headRead ? head : head === headRead || theirs.head === head ? theirs.head : null;
      const merged = nextHead === null ? null : merge3(saved, typed, theirs.body);
      if (nextHead === null || merged === null) {
        blocked = true;
        onChanged(true);
        return;
      }
      const changes = lineChanges(typed, merged);
      // where each change lands in the new text: its first line gets the mark
      const starts: number[] = [];
      let shift = 0;
      for (const c of changes) {
        if (c.insert.trim()) starts.push(c.from + shift); // a removal leaves nothing to mark
        shift += c.insert.length - (c.to - c.from);
      }
      saved = theirs.body;
      head = nextHead;
      headRead = theirs.head;
      adoptPage(page, disk, hash);
      view.dispatch({ changes, annotations: Transaction.addToHistory.of(false) });
      const mark = Decoration.line({ class: "cm-outside", attributes: { "data-by": by[who] } });
      const doc = view.state.doc;
      const marks: Range<Decoration>[] = starts.map(at => mark.range(doc.lineAt(Math.min(at, doc.length)).from));
      view.dispatch({ effects: markOutside.of(Decoration.set(marks, true)) });
      window.clearTimeout(unmark);
      unmark = window.setTimeout(() => view.dispatch({ effects: markOutside.of(Decoration.none) }), MARK_FOR);
      if (head !== theirs.head) void write(false, true); // a property edited here that the file does not have yet
    });
    // a shared document's page: bound to its text, the others' cursors shown
    const fromDocChange = (c: { from: number; to: number; insert: string }) => {
      if (c.from !== c.to || c.insert)
        view.dispatch({ changes: c, annotations: [fromDoc.of(true), Transaction.addToHistory.of(false)] });
    };
    if (page.startsWith("/"))
      void openSharedPage(page).then(sp => {
        if (!sp) return;
        if (closed) return sp.close();
        shared = sp;
        stopWatching(); // the Mac's documents take a change of the file in; it comes here as an update
        view.dispatch({ effects: undoHistory.reconfigure([]) });
        const full = sp.text.toString();
        const parts = split(full);
        headLen = parts.head.length;
        fromDocChange(oneChange(view.state.doc.toString(), parts.body)); // the document may be ahead of the file
        if (parts.head !== head) {
          head = headRead = parts.head;
          pageTextIs(page, full);
        }
        sp.text.observe(e => {
          if (e.transaction.origin === LOCAL) return;
          headLen = headAfter(e.changes.delta as { retain?: number; insert?: unknown; delete?: number }[], headLen);
          const now = sp.text.toString();
          fromDocChange(oneChange(view.state.doc.toString(), now.slice(headLen)));
          if (now.slice(0, headLen) !== head) {
            head = headRead = now.slice(0, headLen);
            pageTextIs(page, now);
          }
        });
        sp.peers(peers => {
          onPeers?.(peers);
          const end = view.state.doc.length;
          const marks = peers.flatMap(p => {
            const [anchor, at] = [p.anchor - headLen, p.head - headLen];
            if (at < 0 || at > end) return [];
            const out: Range<Decoration>[] = [
              Decoration.widget({ widget: new PeerCaret(p.name, p.color), side: 1 }).range(at),
            ];
            const [from, to] = [Math.max(0, Math.min(anchor, at)), Math.min(end, Math.max(anchor, at))];
            if (to > from)
              out.push(Decoration.mark({ attributes: { style: `background-color: ${p.color}33` } }).range(from, to));
            return out;
          });
          view.dispatch({ effects: setPeers.of(Decoration.set(marks, true)) });
        });
      });
    return () => {
      closed = true;
      shared?.close();
      onPeers?.([]);
      stopWatching();
      window.clearTimeout(unmark);
      void write(); // leaving the page saves what was typed
      view.destroy();
    };
  }, [first, label, words, by]);
  return <div ref={host} className="page-editor" />;
}
