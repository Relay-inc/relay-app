import type { Settings } from "../settings/types";
import type { Project, ProjectIcon } from "./types";

// ---------- which project a text is about: names plus aliases from the note frontmatter
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namesText = (name: string, text: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
export function findProjects(projects: Project[], text: string): string[] {
  const hits = new Set<string>();
  for (const candidate of projects)
    for (const name of [candidate.name, ...(candidate.aliases || [])]) {
      if (name.length < 3) continue;
      if (namesText(name, text)) hits.add(candidate.name);
    }
  return [...hits];
}
// contexts come from the vault index, in its order
export const contexts = (projects: Project[]): string[] => [...new Set<string>(projects.map(x => x.context))];

/** How a project is shown: its own icon and name from the settings, else the note name. `general` names no project. */
export function projectLabel(
  name: string | null,
  settings: Settings,
  icons: Record<string, ProjectIcon>,
  general: string,
) {
  if (!name) return general;
  const own = settings.projects[name] || {};
  const emoji = icons[name]?.icon;
  return `${emoji ? emoji + " " : ""}${own.label || name}`;
}
/** A website value: the favicon run fetches it and replaces it with the file. */
export const isSite = (value: string) => value.includes(".") && !/\s/.test(value) && !value.startsWith("icons/");

// ---------- vault notes named in a conversation open in the right panel. Only notes that exist link: the vault's
// paths (vault_notes, refreshed with the snapshot) and their names for [[wikilinks]].
export type NotesIndex = { root: string; paths: Set<string>; names: Set<string> };
export const EMPTY_NOTES: NotesIndex = { root: "", paths: new Set(), names: new Set() };
export const notesIndex = (root: string, notes: string[]): NotesIndex => ({
  root,
  paths: new Set(notes),
  names: new Set(notes.map(path => path.split("/").pop()!)),
});
// the target relative to the vault folder, with its .md
function relativeNote(target: string, roots: string[]) {
  let path = target;
  for (const root of roots) {
    const prefix = root.replace(/\/$/, "") + "/";
    if (root && path.startsWith(prefix)) path = path.slice(prefix.length);
  }
  return /\.md$/i.test(path) ? path : path + ".md";
}
/** Whether a link target names an existing note; `vault` is the vault folder from the settings. */
export function noteKnown(index: NotesIndex, vault: string, target: string) {
  const path = relativeNote(target, [index.root, vault]);
  return index.paths.has(path) || (!path.includes("/") && index.names.has(path));
}

// ---------- favicons: a project without an icon entry, or a site without its icon that was not tried yet (or changed since)
export const needsFavicon = (
  project: Project,
  icons: Record<string, ProjectIcon>,
  tried: Record<string, string> | undefined,
) => {
  const icon = icons[project.name];
  return !icon || (isSite(icon.value) && !icon.img && tried?.[project.name] !== icon.value);
};
