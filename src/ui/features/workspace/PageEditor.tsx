import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { followPageLink, loadPage, savePage, workspacePaths } from "../../../application/navigation/pages";
import { useT } from "../../hooks/useT";
import { livePreview } from "./livePreview";
import { blockEditing, type BlockWords } from "./blocks";
import "../../styles/page-editor.css";

const SAVE_AFTER = 1000; // ms after the last keystroke

/** Writes a new head (the page's properties edited) with what is typed in the body: one save, the same hash check. */
export type HeadWriter = { current: ((head: string) => Promise<void>) | null };

/** A page's body as an editor: markdown with a live preview, saved a second after typing stops, on blur and with ⌘S.
 *  `head` is what comes before the body in the file (frontmatter, the title's heading) and goes back unchanged, unless
 *  the properties above set a new one through `headRef`. When the file changed on disk since it was read, nothing is
 *  written and a bar offers Reload or Keep mine. */
export function PageEditor({
  page,
  head,
  body,
  headRef,
}: {
  page: string;
  head: string;
  body: string;
  headRef: HeadWriter;
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
  onReady: (write: (force?: boolean) => Promise<void>, setHead: (head: string) => Promise<void>) => void; // Keep mine, properties
  onChanged: (changed: boolean) => void;
  onFailed: (error: string) => void;
}) {
  const { t } = useT();
  const host = useRef<HTMLDivElement>(null);
  const [first] = useState(props); // what the editor was made from
  const label = t("page.editor");
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
    const { page, body, onReady, onChanged, onFailed } = first;
    let head = first.head; // a property edited above replaces it
    let saved = body;
    let timer = 0;
    let blocked = false; // changed on disk: no autosave until Reload or Keep mine
    // `dirty`: the head changed, write even when the body did not
    const write = async (force = false, dirty = false) => {
      window.clearTimeout(timer);
      const text = view.state.doc.toString();
      if ((blocked || (text === saved && !dirty)) && !force) return;
      try {
        if ((await savePage(page, head + text, force)) === "changed") {
          blocked = true;
          onChanged(true);
          return;
        }
        saved = text;
        blocked = false;
        onChanged(false);
        onFailed("");
      } catch (e) {
        onFailed(String(e));
      }
    };
    onReady(write, next => {
      head = next;
      return write(false, true);
    });
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: body,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          livePreview((link, drawer) => void followPageLink(link, drawer)),
          blockEditing(words, () => workspacePaths()), // before the keymap below: Tab in a table moves between cells
          keymap.of([
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
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "true" }),
          EditorView.updateListener.of(u => {
            if (u.docChanged) {
              window.clearTimeout(timer);
              timer = window.setTimeout(() => void write(), SAVE_AFTER);
            }
            if (u.focusChanged && !u.view.hasFocus) void write();
          }),
        ],
      }),
    });
    return () => {
      void write(); // leaving the page saves what was typed
      view.destroy();
    };
  }, [first, label, words]);
  return <div ref={host} className="page-editor" />;
}
