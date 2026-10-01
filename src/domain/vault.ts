import { invoke } from "@tauri-apps/api/core";
import { t } from "../core/i18n";
import { changed } from "../core/store";
import { loadIcons, setIcon, iconFrom, isSite, type ProjectIcon } from "./icons";
import { config, saveSettings, type Settings } from "./config";
import { loadNotes } from "./notes";
import type { Reminder } from "./reminders";
import type { VaultStatus } from "./vault-setup";

// The vault as snapshot.py reads it (projects with their open items and status, reminders, the terminal sessions),
// and the project icons from its .relay/config.json.
/** A project from the vault index (work-state), with what snapshot.py read from its note. */
export type Project = {
  name: string;
  context: string;
  state: string;
  last: string; // when the work-state row was last touched
  summary: string;
  open: number | null; // the number of open items, null without an Open section
  open_items: string[];
  stand: string | null; // the note's status section, markdown
  aliases: string[];
};
/** A Claude Code session in the transcripts, with the project snapshot.py guessed from what was asked in it. */
export type SessionItem = { sessionId: string; project: string | null; last_user: string; last_at: string };
/** One read of the vault (snapshot.py, plus the reminders and the vault mapping from lib.rs). */
export type Snapshot = {
  today?: string;
  projects: Project[];
  sessions: { error?: string | null; items: SessionItem[] };
  reminders: Reminder[];
  vault?: VaultStatus;
};

export const vault = {
  snap: { projects: [], reminders: [], sessions: { items: [] } } as Snapshot,
  snapErr: "", // shown once in a bar at the top, gone when a later snapshot works again
  icons: {} as Record<string, ProjectIcon>,
};

export const project = (name: string | null) => (name ? vault.snap.projects.find(x => x.name === name) : undefined);
// how a project is shown: its own icon and name from the settings, else the note name
export const projectLabel = (name: string | null) => {
  if (!name) return t("general");
  const settings = config.value.projects[name] || {};
  const emoji = vault.icons[name]?.icon;
  return `${emoji ? emoji + " " : ""}${settings.label || name}`;
};
/** Vault projects by their label, for a picker. */
export const projectsByLabel = (locale: string) =>
  vault.snap.projects
    .map(x => ({ name: x.name, label: projectLabel(x.name) }))
    .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, locale)) as {
    name: string;
    label: string;
  }[];
// contexts come from the vault index, in its order
export const contexts = (): string[] => [...new Set<string>(vault.snap.projects.map(x => x.context))];

// ---------- which project a text is about: names plus aliases from the note frontmatter
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namesText = (name: string, text: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
export function findProjects(text: string): string[] {
  const hits = new Set<string>();
  for (const candidate of vault.snap.projects)
    for (const name of [candidate.name, ...(candidate.aliases || [])]) {
      if (name.length < 3) continue;
      if (namesText(name, text)) hits.add(candidate.name);
    }
  return [...hits];
}

export async function loadSnapshot() {
  try {
    [vault.snap] = await Promise.all([invoke<Snapshot>("snapshot"), loadNotes()]);
    vault.snapErr = "";
  } catch (e) {
    const err = String(e);
    if (err !== vault.snapErr) console.error(err);
    vault.snapErr = err;
  }
  changed();
}

// ---------- favicons: projects without an icon entry in the vault get one. favicon.py guesses the site from the
// notes (a website set as the icon wins) and fetches its icon; the icon goes into the vault as a file, a project
// without a site gets "" (none, not guessed again). `tried` (this Mac) keeps a site that had no favicon from being
// fetched again and again.
let favBusy = false;
let favAgain = false;
// a project without an icon entry, or whose site was not tried yet (or changed since)
const needsFavicon = (candidate: Project, tried: Record<string, string> | undefined) => {
  const icon = vault.icons[candidate.name];
  return !icon || (isSite(icon.value) && tried?.[candidate.name] !== icon.value);
};
type Found = Record<string, { site: string; data: string | null }>;
// store what favicon.py found: an icon file per project, "none" for a project without one, and the sites tried
async function storeFound(found: Found, tried: Record<string, string>) {
  for (const [name, result] of Object.entries(found)) {
    tried[name] = result.site;
    const img = result.data ? await iconFrom(await (await fetch(result.data)).blob()) : null;
    if (img) await setIcon(name, "img", img);
    else if (!(name in vault.icons)) await setIcon(name, "none");
  }
}
export async function checkFavicons() {
  const favicons = config.value.favicons;
  // a change while a run is busy (Find icons during the first run) is not lost: one more run right after
  if (favBusy) {
    favAgain = true;
    return;
  }
  if (!favicons?.on || !vault.snap?.projects) return;
  const todo = vault.snap.projects.filter((candidate: Project) => needsFavicon(candidate, favicons.tried));
  if (!todo.length) return;
  favBusy = true;
  try {
    const found: Found = await invoke("favicons", {
      projects: todo.map(x => ({ name: x.name, aliases: x.aliases || [] })),
    });
    const tried = { ...favicons.tried };
    await storeFound(found, tried);
    await saveSettings({ ...config.value, favicons: { ...favicons, tried } });
  } catch (e) {
    console.error(e);
  }
  favBusy = false;
  if (favAgain) {
    favAgain = false;
    checkFavicons();
  }
}
export async function refreshIcons() {
  vault.icons = await loadIcons();
  // the first load moves icons out of settings.json into the vault: take the settings as they are now
  try {
    config.value = { ...config.value, ...(await invoke<Settings>("get_settings")) };
  } catch {
    /* keep */
  }
  changed();
  checkFavicons();
}
export async function reloadIcons() {
  vault.icons = await loadIcons();
  changed();
  checkFavicons();
}
