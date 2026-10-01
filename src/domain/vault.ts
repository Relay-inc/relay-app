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

export const project = (n: string | null) => (n ? vault.snap.projects.find(p => p.name === n) : undefined);
// how a project is shown: its own icon and name from the settings, else the note name
export const pLabel = (n: string | null) => {
  if (!n) return t("general");
  const c = config.value.projects[n] || {},
    e = vault.icons[n]?.icon;
  return `${e ? e + " " : ""}${c.label || n}`;
};
/** Vault projects by their label, for a picker. */
export const projectsByLabel = (locale: string) =>
  vault.snap.projects
    .map(p => ({ name: p.name, label: pLabel(p.name) }))
    .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, locale)) as {
    name: string;
    label: string;
  }[];
// contexts come from the vault index, in its order
export const contexts = (): string[] => [...new Set<string>(vault.snap.projects.map(p => p.context))];

// ---------- which project a text is about: names plus aliases from the note frontmatter
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function findProjects(text: string): string[] {
  const hits = new Set<string>();
  for (const p of vault.snap.projects)
    for (const n of [p.name, ...(p.aliases || [])]) {
      if (n.length < 3) continue;
      if (new RegExp(`(^|[^\\p{L}\\p{N}])${reEsc(n)}([^\\p{L}\\p{N}]|$)`, "iu").test(text)) hits.add(p.name);
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
let favBusy = false,
  favAgain = false;
export async function checkFavicons() {
  const f = config.value.favicons;
  // a change while a run is busy (Find icons during the first run) is not lost: one more run right after
  if (favBusy) {
    favAgain = true;
    return;
  }
  if (!f?.on || !vault.snap?.projects) return;
  const todo = vault.snap.projects.filter(
    (p: Project) =>
      !(p.name in vault.icons) ||
      (isSite(vault.icons[p.name].value) && f.tried?.[p.name] !== vault.icons[p.name].value),
  );
  if (!todo.length) return;
  favBusy = true;
  try {
    const found: Record<string, { site: string; data: string | null }> = await invoke("favicons", {
      projects: todo.map(p => ({ name: p.name, aliases: p.aliases || [] })),
    });
    const tried = { ...f.tried };
    for (const [n, r] of Object.entries(found)) {
      tried[n] = r.site;
      const img = r.data ? await iconFrom(await (await fetch(r.data)).blob()) : null;
      if (img) await setIcon(n, "img", img);
      else if (!(n in vault.icons)) await setIcon(n, "none");
    }
    await saveSettings({ ...config.value, favicons: { ...f, tried } });
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
