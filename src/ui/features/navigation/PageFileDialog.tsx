import { useEffect, useState } from "react";
import { countLinks, createPage, movePage, pageFolders } from "../../../application/navigation/pages";
import { useT } from "../../hooks/useT";

/** What the dialog does: a new page or folder in `folder`, a rename of `path`, or a move of `path` (to `into` when it
 *  was dropped on a folder, else picked here). */
export type PageFileAsk =
  | { kind: "page" | "folder"; folder: string }
  | { kind: "rename"; path: string }
  | { kind: "move"; path: string; into?: string };

const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const leaf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
const FIELD = "w-full px-2 py-1.5 rounded-md border border-separator bg-bg text-label";

/** The small window for the Pages tab's file operations: a name (new page, new folder, rename) or a folder (move), then,
 *  when links to it would change, "Update N links in M notes" before it goes. */
export function PageFileDialog({ ask, onClose }: { ask: PageFileAsk; onClose: () => void }) {
  const { t, tn } = useT();
  const from = ask.kind === "rename" || ask.kind === "move" ? ask.path : "";
  const isPage = ask.kind === "page" || /\.md$/i.test(from);
  const start = ask.kind === "rename" ? leaf(ask.path).replace(/\.md$/i, "") : ask.kind === "move" ? "" : "Untitled";
  const [name, setName] = useState(start);
  const [into, setInto] = useState(ask.kind === "move" ? (ask.into ?? parent(ask.path)) : "");
  const [links, setLinks] = useState<{ n: number; notes: number } | null>(null);
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
      .then(r => live && setLinks({ n: r.links, notes: r.notes }))
      .catch(() => live && setLinks(null));
    return () => {
      live = false;
    };
  }, [from, to]);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    if (ask.kind === "page" || ask.kind === "folder") await createPage(ask.folder, name.trim(), ask.kind === "folder");
    else if (to && to !== from) await movePage(from, to);
    onClose();
  };
  const title =
    ask.kind === "page"
      ? t("pages.newPageTitle")
      : ask.kind === "folder"
        ? t("pages.newFolderTitle")
        : t(ask.kind === "rename" ? "pages.renameTitle" : "pages.moveTitle", {
            name: leaf(from).replace(/\.md$/i, ""),
          });
  const action = ask.kind === "rename" ? "pages.doRename" : ask.kind === "move" ? "pages.doMove" : "pages.create";
  const blocked = busy || (ask.kind === "move" ? to === from : !name.trim() || (!!from && to === from));
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
        ) : (
          <label className="grid gap-1 text-secondary">
            {t("pages.name")}
            <input
              className={FIELD}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              onFocus={e => e.target.select()}
            />
          </label>
        )}
        {from && to !== from && links?.n ? (
          <p className="text-secondary">{tn("pages.links", links.n, { notes: links.notes })}</p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn cursor-pointer" onClick={onClose}>
            {t("pages.cancel")}
          </button>
          <button type="submit" className="btn btn-primary cursor-pointer disabled:opacity-50" disabled={blocked}>
            {t(action)}
          </button>
        </div>
      </form>
    </div>
  );
}
