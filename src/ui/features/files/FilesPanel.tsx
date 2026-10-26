import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { FileEntry, FileRoot } from "../../../domain/files/files";
import { useNavigationStore } from "../../../application/navigation/store";
import { useConversationsStore } from "../../../application/conversations/store";
import { selectedProject } from "../../../application/conversations/selectors";
import { useFilesStore } from "../../../application/files/store";
import { closeView, loadFiles, openEntry, reveal, toggleDir } from "../../../application/files/files";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { ModalHeader } from "../../components/ModalHeader";

// git's letter as PhpStorm colours a file: changed blue, added green, not tracked red
const LETTER: Record<string, string> = { M: "text-accent", R: "text-accent", A: "text-add-fg", "?": "text-del-fg" };
const MAX_LINES = 5000;
const home = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");

/** The project's folders as a tree, as PhpStorm shows a project: its code folders and its folder in the vault, a
 *  folder opens on a click, a file opens (a note in the right drawer, a document in its app, text in a window over the
 *  app), a right-click shows it in Finder. */
export function FilesPanel() {
  const { t } = useT();
  const key = useNavigationStore(s => s.selected);
  const project = useDerived(() => selectedProject()) ?? "";
  // a turn that ends may have changed files: read again then
  const busy = useConversationsStore(s => s.status[key] === "busy");
  const { roots, err, view } = useFilesStore();

  useEffect(() => {
    if (!busy) void loadFiles(project, key);
  }, [project, key, busy]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-1.5 select-none">
      <div className="flex items-center">
        <span className="flex-1" />
        <button
          className="btn-icon"
          title={t("files.refresh")}
          aria-label={t("files.refresh")}
          onClick={() => loadFiles(project, key)}
        >
          <Icon name="refresh" className="glyph size-4" />
        </button>
      </div>
      {err ? <div className="err-box select-text">{err}</div> : null}
      {!roots && !err ? <div className="text-sm text-secondary">{t("kb.loading")}</div> : null}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" role="tree">
        {roots?.map(root => (
          <Root key={root.path} root={root} />
        ))}
      </div>
      {view ? createPortal(<FileView view={view} />, document.body) : null}
    </div>
  );
}

function Root({ root }: { root: FileRoot }) {
  const open = useFilesStore(s => s.expanded[root.path] ?? true);
  return (
    <div className="flex flex-col">
      <button
        role="treeitem"
        aria-expanded={open}
        className="flex items-center gap-1.5 h-7 px-1 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill"
        title={root.path}
        onClick={() => toggleDir(root.path, true)}
        onContextMenu={e => {
          e.preventDefault();
          void reveal(root.path);
        }}
      >
        <Icon name="chevron" className={`glyph size-3 flex-none text-tertiary ${open ? "" : "-rotate-90"}`} />
        <Icon name="folder" className="glyph size-4 flex-none text-secondary" />
        <span className="flex-none font-semibold">{root.label}</span>
        <span className="min-w-0 truncate text-xs text-tertiary">{home(root.path)}</span>
      </button>
      {open ? <Folder path={root.path} depth={1} /> : null}
    </div>
  );
}

function Folder({ path, depth }: { path: string; depth: number }) {
  const { t } = useT();
  const entries = useFilesStore(s => s.children[path]);
  const err = useFilesStore(s => s.errs[path]);
  const pad = { paddingLeft: 4 + depth * 14 };
  if (err)
    return (
      <div className="text-xs text-del-fg truncate select-text" style={pad}>
        {err}
      </div>
    );
  if (entries === undefined || entries === null)
    return (
      <div className="h-6 text-xs text-tertiary" style={pad}>
        {t("kb.loading")}
      </div>
    );
  if (!entries.length)
    return (
      <div className="h-6 text-xs text-tertiary" style={pad}>
        {t("files.empty")}
      </div>
    );
  return entries.map(entry => <Entry key={entry.path} entry={entry} depth={depth} />);
}

function Entry({ entry, depth }: { entry: FileEntry; depth: number }) {
  const open = useFilesStore(s => !!s.expanded[entry.path]) && entry.dir;
  const letter = useFilesStore(s => s.letters[entry.path]);
  const colour = entry.ignored ? "text-tertiary" : (LETTER[letter ?? ""] ?? "");
  return (
    <>
      <button
        role="treeitem"
        aria-expanded={entry.dir ? open : undefined}
        className="w-full flex items-center gap-1.5 h-6.5 pr-1 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill"
        style={{ paddingLeft: 4 + depth * 14 }}
        title={entry.path}
        onClick={() => (entry.dir ? toggleDir(entry.path) : openEntry(entry))}
        onContextMenu={e => {
          e.preventDefault();
          void reveal(entry.path);
        }}
      >
        {entry.dir ? (
          <Icon name="chevron" className={`glyph size-3 flex-none text-tertiary ${open ? "" : "-rotate-90"}`} />
        ) : (
          <span className="size-3 flex-none" />
        )}
        <Icon
          name={entry.dir ? "folder" : "file"}
          className={`glyph size-3.5 flex-none ${entry.ignored ? "text-tertiary" : "text-secondary"}`}
        />
        <span className={`min-w-0 truncate ${colour}`}>{entry.name}</span>
      </button>
      {open ? <Folder path={entry.path} depth={depth + 1} /> : null}
    </>
  );
}

/** A text file over the app, read only, with its line numbers. */
function FileView({ view }: { view: { path: string; text: string | null; err: string } }) {
  const { t } = useT();
  const lines = useMemo(() => (view.text ?? "").split("\n"), [view.text]);
  const shown = lines.slice(0, MAX_LINES);
  return (
    <Modal onClose={closeView}>
      <ModalHeader
        left={<span className="min-w-0 truncate font-mono text-xs font-semibold">{home(view.path)}</span>}
        position=""
        first
        last
        onStep={() => {}}
        onClose={closeView}
      />
      <div className="flex-1 min-h-0 overflow-auto px-5 pt-4 pb-6">
        {view.err ? <div className="err-box select-text">{view.err}</div> : null}
        {view.text === null && !view.err ? <div className="text-sm text-secondary">{t("kb.loading")}</div> : null}
        {view.text !== null ? (
          <div className="w-max min-w-full grid grid-cols-[auto_1fr] font-mono text-xs leading-5.5 select-text">
            {shown.map((line, i) => (
              <div key={i} className="contents">
                <span className="pr-4 text-right text-tertiary select-none">{i + 1}</span>
                <span className="whitespace-pre">{line}</span>
              </div>
            ))}
          </div>
        ) : null}
        {lines.length > MAX_LINES ? (
          <div className="mt-2 text-xs text-tertiary">{t("files.cut", { n: MAX_LINES })}</div>
        ) : null}
      </div>
    </Modal>
  );
}
