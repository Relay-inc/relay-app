import { t } from "../../shared/i18n";
import { setNoteCheck, noteOf } from "../../shared/markdown";
import type { Project } from "../../domain/workspace/types";
import {
  findProjects as findIn,
  contexts as contextsOf,
  projectLabel as labelOf,
  noteKnown as knownIn,
  notesIndex,
  needsFavicon,
  EMPTY_NOTES,
} from "../../domain/workspace/rules";
import * as backend from "../../infrastructure/backend";
import { saveMainSettings, setSettingsState, settings } from "../settings/settings";
import { useWorkspaceStore } from "./store";
import { iconFromDataUrl } from "../../infrastructure/images";
import { loadIcons, setIcon } from "./icons";

// The vault as snapshot.rs reads it, the notes that exist, the project icons and their favicons.
const ws = () => useWorkspaceStore.getState();

// ---------- reading
export const project = (name: string | null) => (name ? ws().snap.projects.find(x => x.name === name) : undefined);
/** How a project is shown: its own icon and name from the settings, else the note name; "Algemeen" for none. */
export const projectLabel = (name: string | null) => labelOf(name, settings(), ws().icons, t("general"));
/** Vault projects by their label, for a picker. */
export const projectsByLabel = (locale: string) =>
  ws()
    .snap.projects.map(x => ({ name: x.name, label: projectLabel(x.name) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
export const contexts = () => contextsOf(ws().snap.projects);
/** The projects a text names (names and aliases). */
export const findProjects = (text: string) => findIn(ws().snap.projects, text);

// ---------- notes: only notes that exist link
export const noteKnown = (target: string) => knownIn(ws().notes, settings().vault, target);
/** A path from a tool call that names an existing note, or "". */
export const notePath = (path?: string) => (path && /\.md$/i.test(noteOf(path)) && noteKnown(noteOf(path)) ? path : "");
// what the notes index was made from: an unchanged list keeps the parsed markdown (every 30 s and every turn end)
let notesRead: string | null = null;
async function loadNotes() {
  let notes = EMPTY_NOTES;
  let read = "";
  try {
    const answer = await backend.vaultNotes();
    notes = notesIndex(answer.root, answer.notes);
    read = `${answer.root}\n${answer.notes.join("\n")}`;
  } catch {
    /* none */
  }
  if (read === notesRead) return;
  notesRead = read;
  // the markdown cache goes first, so what redraws for the new version parses again
  setNoteCheck(target => knownIn(notes, settings().vault, target));
  useWorkspaceStore.setState(draft => {
    draft.notes = notes;
    draft.notesVersion++;
  });
}

/** The vault read again: projects, reminders, sessions, and which notes exist. */
export async function loadSnapshot() {
  try {
    const [snap] = await Promise.all([backend.snapshot(), loadNotes()]);
    useWorkspaceStore.setState(draft => {
      draft.snap = snap;
      draft.snapErr = "";
    });
  } catch (e) {
    const err = String(e);
    if (err !== ws().snapErr) console.error(err);
    useWorkspaceStore.setState(draft => {
      draft.snapErr = err;
    });
  }
}

// ---------- favicons: projects without an icon entry in the vault get one. the favicon run guesses the site from the
// notes (a website set as the icon wins) and fetches its icon; the icon goes into the vault as a file, a project
// without a site gets "" (none, not guessed again). `tried` (this Mac) keeps a site that had no favicon from being
// fetched again and again.
let favBusy = false;
let favAgain = false;
type Found = Record<string, { site: string; data: string | null }>;
// store what the favicon run found: an icon file per project, "none" for a project without one, and the sites tried
async function storeFound(found: Found, tried: Record<string, string>) {
  for (const [name, result] of Object.entries(found)) {
    tried[name] = result.site;
    const img = result.data ? await iconFromDataUrl(result.data) : null;
    if (img) await setIcon(name, "img", img);
    else if (!(name in ws().icons)) await setIcon(name, "none");
  }
}
export async function checkFavicons() {
  const favicons = settings().favicons;
  // a change while a run is busy (Find icons during the first run) is not lost: one more run right after
  if (favBusy) {
    favAgain = true;
    return;
  }
  if (!favicons?.on || !ws().snap?.projects) return;
  const todo = ws().snap.projects.filter((candidate: Project) => needsFavicon(candidate, ws().icons, favicons.tried));
  if (!todo.length) return;
  favBusy = true;
  try {
    const found = await backend.favicons(todo.map(x => ({ name: x.name, aliases: x.aliases || [] })));
    const tried = { ...favicons.tried };
    await storeFound(found, tried);
    await saveMainSettings({ ...settings(), favicons: { ...favicons, tried } });
  } catch (e) {
    console.error(e);
  }
  favBusy = false;
  if (favAgain) {
    favAgain = false;
    checkFavicons();
  }
}
/** At the start: the icons, and the settings as they are after the first load moved icons into the vault. */
export async function refreshIcons() {
  const icons = await loadIcons();
  useWorkspaceStore.setState(draft => {
    draft.icons = icons;
  });
  try {
    setSettingsState(await backend.getSettings());
  } catch {
    /* keep */
  }
  checkFavicons();
}
/** The backend said the icons changed. */
export async function reloadIcons() {
  const icons = await loadIcons();
  useWorkspaceStore.setState(draft => {
    draft.icons = icons;
  });
  checkFavicons();
}
