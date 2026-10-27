import type { Settings } from "../settings/types";
import type { Project, ProjectIcon } from "./types";

// ---------- which project a text is about: names plus aliases from the note frontmatter
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namesText = (name: string, text: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
export function findProjects(projects: Project[], text: string): string[] {
  const hits = new Set<string>();
  for (const candidate of projects)
    // the label too: another vault's project has an opaque key as its name
    for (const name of [candidate.name, candidate.label ?? "", ...(candidate.aliases || [])]) {
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
  shown = name, // the snapshot's label
) {
  if (!name) return general;
  const own = settings.projects[name] || {};
  const emoji = icons[name]?.icon;
  return `${emoji ? emoji + " " : ""}${own.label || shown || name}`;
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
// a note a shared vault has at this path: the index holds those as absolute paths, so a link inside one finds it
const inShared = (index: NotesIndex, path: string) =>
  [...index.paths].find(p => p.startsWith("/") && p.endsWith("/" + path));
/** Whether a link target names an existing note; `vault` is the vault folder from the settings. */
export function noteKnown(index: NotesIndex, vault: string, target: string) {
  const path = relativeNote(target, [index.root, vault]);
  return index.paths.has(path) || (path.includes("/") ? !!inShared(index, path) : index.names.has(path));
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

// ---------- a note's frontmatter as properties, the way Obsidian lists them: one row per key that has a value
const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");
/** The frontmatter's keys with their values: `key: value`, a `- item` list under it or an inline `[a, b]`. Keys
 *  without a value are left out, nested maps read as plain text. */
export function noteProperties(yaml: string): [string, string[]][] {
  const rows: [string, string[]][] = [];
  for (const line of yaml.split("\n")) {
    const pair = /^([^\s:#-][^:]*):(?:\s+(.*))?$/.exec(line);
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (pair) {
      const value = (pair[2] ?? "").trim();
      const list = /^\[(.*)\]$/.exec(value);
      rows.push([pair[1].trim(), list ? list[1].split(",").map(unquote) : [unquote(value)]]);
    } else if (item && rows.length) rows[rows.length - 1][1].push(unquote(item[1]));
  }
  return rows.map(([key, values]): [string, string[]] => [key, values.filter(Boolean)]).filter(([, v]) => v.length);
}

// ---------- a note read in the drawer: its title, and the notes it links to
/** The note's title and the body under it: a leading `# heading` is the title, else the file name made readable
 *  (`route-middleware-sees-rendered-refusals` → "Route middleware sees rendered refusals"). */
export function noteTitle(path: string, body: string): { title: string; body: string } {
  const heading = /^\s*# (.+)\n?/.exec(body);
  if (heading) return { title: heading[1].trim(), body: body.slice(heading[0].length) };
  const name = path.split("/").pop()!.replace(/\.md$/i, "");
  const words = /^[a-z0-9_-]+$/.test(name) ? name.replace(/[-_]+/g, " ") : name;
  return { title: words.charAt(0).toUpperCase() + words.slice(1), body };
}
/** The existing notes a note's [[wikilinks]] name, once each and without itself, with the folder each is in. */
export function noteLinks(index: NotesIndex, vault: string, self: string, text: string) {
  const links = new Map<string, { target: string; label: string; folder: string }>();
  for (const [, inner] of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const target = inner.replace(/[#|].*$/, "").trim();
    const md = relativeNote(target, [index.root, vault]);
    const path = index.paths.has(md)
      ? md
      : md.includes("/")
        ? inShared(index, md)
        : [...index.paths].find(p => p.endsWith("/" + md));
    if (!path || path === self || links.has(path)) continue;
    links.set(path, { target, label: inner.split("|").pop()!.trim(), folder: path.split("/").slice(-2, -1)[0] ?? "" });
  }
  return [...links.values()];
}
