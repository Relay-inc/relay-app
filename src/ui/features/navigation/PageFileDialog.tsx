import { useEffect, useRef, useState } from "react";
import {
  countLinks,
  createPage,
  freePageName,
  movePage,
  pageFolders,
  pagesIn,
  sharedWorkspace,
  trashPage,
} from "../../../application/navigation/pages";
import { useT } from "../../hooks/useT";

/** What the dialog does: a new page or folder in `folder`, a rename of `path`, a move of `path` (to `into` when it
 *  was dropped on a folder, else picked here), or a delete of `path` once confirmed. */
export type PageFileAsk =
  | { kind: "page" | "folder"; folder: string }
  | { kind: "rename"; path: string }
  | { kind: "move"; path: string; into?: string }
  | { kind: "delete"; path: string };

const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const leaf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
const FIELD = "w-full px-2 py-1.5 rounded-md border border-separator bg-bg text-label";

/** The small window for the Pages tab's file operations: a name (new page, new folder, rename) or a folder (move), then,
 *  when links to it would change, "Update N links in M notes": the button waits for that count. A delete asks first,
 *  and in a shared workspace says it deletes for every member. */
export function PageFileDialog({ ask, onClose }: { ask: PageFileAsk; onClose: () => void }) {
  const { t, tn } = useT();
  const from = ask.kind === "rename" || ask.kind === "move" ? ask.path : "";
  const isPage = ask.kind === "page" || /\.md$/i.test(from);
  const start =
    ask.kind === "rename" ? leaf(ask.path).replace(/\.md$/i, "") : ask.kind === "folder" ? t("pages.untitled") : "";
  const [name, setName] = useState(start);
  const field = useRef<HTMLInputElement>(null);
  // a new page offers a name no page in that folder has yet: Untitled, Untitled 1…
  const newIn = ask.kind === "page" ? ask.folder : null;
  useEffect(() => {
    if (newIn === null) return;
    let live = true;
    void freePageName(newIn).then(free => {
      if (!live) return;
      setName(free);
      requestAnimationFrame(() => field.current?.select());
    });
    return () => {
      live = false;
    };
  }, [newIn]);
  const [into, setInto] = useState(ask.kind === "move" ? (ask.into ?? parent(ask.path)) : "");
  const [links, setLinks] = useState<{ to: string; n: number; notes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const to =
    ask.kind === "rename"
      ? join(parent(ask.path), isPage ? `${name.trim()}.md` : name.trim())
      : ask.kind === "move"
        ? join(into, leaf(ask.path))
        : "";
  // a move or rename shows how many links follow it, counted again when the target changes
  useEffect(() => {
    if (!from || !to || to === from) return;
    let live = true;
    countLinks(from, to)
      .then(r => live && setLinks({ to, n: r.links, notes: r.notes }))
      .catch(() => live && setLinks(null));
    return () => {
      live = false;
    };
  }, [from, to]);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    if (ask.kind === "page" || ask.kind === "folder") await createPage(ask.folder, name.trim(), ask.kind === "folder");
    else if (ask.kind === "delete") await trashPage(ask.path);
    else if (to && to !== from) await movePage(from, to);
    onClose();
  };
  const shared = sharedWorkspace();
  const gone = ask.kind === "delete" ? leaf(ask.path).replace(/\.md$/i, "") : "";
  const inside = ask.kind === "delete" && !/\.md$/i.test(ask.path) ? pagesIn(ask.path) : 0;
  const title =
    ask.kind === "page"
      ? t("pages.newPageTitle")
      : ask.kind === "folder"
        ? t("pages.newFolderTitle")
        : ask.kind === "delete"
          ? /\.md$/i.test(ask.path)
            ? t("pages.deleteTitle", { name: gone })
            : tn("pages.deleteFolderTitle", inside, { name: gone })
          : t(ask.kind === "rename" ? "pages.renameTitle" : "pages.moveTitle", {
              name: leaf(from).replace(/\.md$/i, ""),
            });
  const action = {
    rename: "pages.doRename",
    move: "pages.doMove",
    delete: "pages.doDelete",
    page: "pages.create",
    folder: "pages.create",
  }[ask.kind] as "pages.doRename";
  // a rename or move goes only once the links it changes are counted for the target shown
  const counted = !from || links?.to === to;
  const blocked =
    busy ||
    (ask.kind === "delete"
      ? false
      : ask.kind === "move"
        ? to === from || !counted
        : !name.trim() || (!!from && (to === from || !counted)));
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-label={title}
        className="w-100 grid gap-3 p-5 bg-bg border border-separator rounded-xl shadow-lg text-sm text-label"
        onSubmit={e => {
          e.preventDefault();
          if (!blocked) void go();
        }}
        onKeyDown={e => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {ask.kind === "move" ? (
          <label className="grid gap-1 text-secondary">
            {t("pages.into")}
            <select className={FIELD} value={into} onChange={e => setInto(e.target.value)} autoFocus>
              <option value="">{t("pages.top")}</option>
              {pageFolders()
                .filter(folder => folder !== from && !folder.startsWith(`${from}/`))
                .map(folder => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
            </select>
          </label>
        ) : ask.kind === "delete" ? (
          <p className="text-secondary">
            {shared ? t("pages.deleteShared", { workspace: shared }) : t("pages.deleteHere")}
          </p>
        ) : (
          <label className="grid gap-1 text-secondary">
            {t("pages.name")}
            <input
              ref={field}
              className={FIELD}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              onFocus={e => e.target.select()}
            />
          </label>
        )}
        {from && to !== from ? (
          <p className="text-secondary">
            {!counted
              ? t("pages.counting")
              : links?.n
                ? tn("pages.links", links.n, { notes: links.notes })
                : t("pages.noLinks")}
          </p>
        ) : null}
        {from ? <p className="text-xs text-tertiary">{t("pages.openChats")}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn cursor-pointer" onClick={onClose}>
            {t("pages.cancel")}
          </button>
          <button
            type="submit"
            className={`btn cursor-pointer disabled:opacity-50 ${ask.kind === "delete" ? "bg-late border-late text-on-accent hover:opacity-90" : "btn-primary"}`}
            disabled={blocked}
            autoFocus={ask.kind === "delete"}
          >
            {t(action)}
          </button>
        </div>
      </form>
    </div>
  );
}
