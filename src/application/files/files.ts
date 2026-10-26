import { gitLetters, opensOutside, vaultNote, type FileEntry } from "../../domain/files/files";
import { noteKey } from "../../domain/navigation/keys";
import * as backend from "../../infrastructure/backend";
import { openDetail } from "../navigation/panel";
import { useFilesStore } from "./store";

// The Files drawer (domain/files/files.ts): the project's roots, the folders opened in them, and a file opened from
// them: a vault note in the right drawer, a document in its own app, text in a window over the app.
const st = () => useFilesStore.getState();
const set = useFilesStore.setState;

async function loadDir(path: string) {
  set(draft => void (draft.children[path] ??= null));
  try {
    const entries = await backend.listDir(st().project, path);
    set(draft => {
      draft.children[path] = entries;
      delete draft.errs[path];
    });
  } catch (err) {
    set(draft => {
      draft.children[path] = [];
      draft.errs[path] = String(err);
    });
  }
}
/** A folder is open unless closed; a root opens by default. */
export const isOpen = (path: string, root = false) => st().expanded[path] ?? root;

/** The project's roots and every open folder read again, with git's colours: when the drawer opens on a project and
 *  whenever a turn ends (files may have changed). `key` is the conversation, for its worktrees' git status. */
export async function loadFiles(project: string, key: string) {
  if (st().project !== project)
    set(draft => {
      Object.assign(draft, { project, roots: null, err: "", children: {}, errs: {}, expanded: {}, letters: {} });
    });
  try {
    const { vault, roots } = await backend.fileRoots(project);
    if (st().project !== project) return;
    set(draft => {
      draft.vault = vault;
      draft.roots = roots;
      draft.err = "";
    });
    const open = [
      ...roots.filter(r => isOpen(r.path, true)).map(r => r.path),
      ...Object.keys(st().expanded).filter(p => st().expanded[p] && !roots.some(r => r.path === p)),
    ];
    await Promise.all(open.map(loadDir));
  } catch (err) {
    set(draft => void (draft.err = String(err)));
  }
  const letters = await backend.gitRepos(key, project).then(gitLetters, () => ({}));
  if (st().project === project) set(draft => void (draft.letters = letters));
}

export function toggleDir(path: string, root = false) {
  const open = !isOpen(path, root);
  set(draft => void (draft.expanded[path] = open));
  if (open) void loadDir(path);
}

/** A click on a file: a vault note in the right drawer, a document or picture in its own app, anything else as text in
 *  a window over the app (a file that turns out binary still goes to its app). */
export async function openEntry(entry: FileEntry) {
  const note = vaultNote(entry.path, st().vault);
  if (note) {
    await openDetail(noteKey(note));
    return;
  }
  if (opensOutside(entry.name)) {
    await backend.openFile(entry.path, false).catch(e => console.error(e));
    return;
  }
  set(draft => void (draft.view = { path: entry.path, text: null, err: "" }));
  try {
    const text = await backend.readFileText(st().project, entry.path);
    if (st().view?.path === entry.path) set(draft => void (draft.view!.text = text));
  } catch (err) {
    if (st().view?.path !== entry.path) return;
    if (String(err) === "binary") {
      closeView();
      await backend.openFile(entry.path, false).catch(e => console.error(e));
    } else set(draft => void (draft.view!.err = String(err)));
  }
}
/** Right-click: the file or folder shown in Finder. */
export const reveal = (path: string) => backend.openFile(path, true).catch(e => console.error(e));
export const closeView = () => set(draft => void (draft.view = null));
