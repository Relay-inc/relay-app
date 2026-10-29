// The sidebar's Pages tab: a workspace's notes as a tree. Its contexts with their projects first (a project is the
// folder its note sits in, named like it), then every folder at the top of the workspace, then what the search finds.

/** A folder of notes: its subfolders and its notes (paths relative to the workspace), `count` every note below it. */
export type PageFolder = { name: string; path: string; folders: PageFolder[]; notes: string[]; count: number };
/** A project in the tree: its note, and the folder named like it that holds that note, if there is one. */
export type PageProject = { key: string; label: string; note: string; folder: PageFolder | null; count: number };
/** `index`: the context's place among all of them, which picks its colour as in the Chats tab; `folder` the folder of
 *  its note (`<folder>/<name>.md`), "" when it has none. */
export type PageContext = { name: string; index: number; folder: string; projects: PageProject[] };
export type PagesModel = { contexts: PageContext[]; top: PageFolder };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
export const noteName = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

/** The folder tree of these note paths, folders and notes by name. */
export function pageTree(paths: string[]): PageFolder {
  const root: PageFolder = { name: "", path: "", folders: [], notes: [], count: 0 };
  const folders = new Map<string, PageFolder>([["", root]]);
  const folderAt = (path: string): PageFolder => {
    const known = folders.get(path);
    if (known) return known;
    const folder: PageFolder = { name: path.split("/").pop()!, path, folders: [], notes: [], count: 0 };
    folders.set(path, folder);
    folderAt(parentOf(path)).folders.push(folder);
    return folder;
  };
  for (const path of paths) {
    folderAt(parentOf(path)).notes.push(path);
    for (let at = parentOf(path); ; at = parentOf(at)) {
      folderAt(at).count++;
      if (!at) break;
    }
  }
  for (const folder of folders.values()) {
    folder.folders.sort((a, b) => byName(a.name, b.name));
    folder.notes.sort((a, b) => byName(noteName(a), noteName(b)));
  }
  return root;
}
const find = (root: PageFolder, path: string) => {
  let folder: PageFolder | undefined = root;
  for (const part of path ? path.split("/") : []) folder = folder?.folders.find(sub => sub.name === part);
  return folder;
};

/** A project's place in the tree: its note named like it, preferably the one in a folder of that name. */
export function projectPage(root: PageFolder, paths: string[], name: string) {
  const notes = paths.filter(path => noteName(path) === name);
  const home = notes.find(path => parentOf(path).split("/").pop() === name);
  const folder = home ? find(root, parentOf(home)) : undefined;
  return { note: home ?? notes[0] ?? "", folder: folder ?? null };
}

/** The tree of a workspace: per context its projects (`name` is the note's name, `key` the project's), and the top.
 *  `listed`: the workspace's own contexts, shown also without a project (after the ordered ones). */
export function pagesModel(
  paths: string[],
  projects: { key: string; name: string; label: string; context: string }[],
  contextOrder: string[],
  listed: string[] = [],
): PagesModel {
  const top = pageTree(paths);
  const contexts = [...contextOrder, ...listed.filter(name => !contextOrder.includes(name))]
    .map((name, index) => ({
      name,
      index,
      folder: parentOf(paths.find(path => path === `${name}/${name}.md` || path.endsWith(`/${name}/${name}.md`)) ?? ""),
      projects: projects
        .filter(project => project.context === name)
        .map(project => {
          const page = projectPage(top, paths, project.name);
          return { key: project.key, label: project.label, ...page, count: page.folder?.count ?? (page.note ? 1 : 0) };
        })
        .filter(project => project.note)
        .sort((a, b) => byName(a.label, b.label)),
    }))
    .filter(context => context.projects.length || listed.includes(context.name));
  return { contexts, top };
}

// the notes the vault runs on rather than ones people write in: an agent's instructions, its rules, hooks and scripts,
// the templates. ponytail: one list for every vault, a `system` key in .relay/config.json when a vault lays them out apart
const SYSTEM_FILES = ["CLAUDE.md", "AGENTS.md"];
const SYSTEM_FOLDERS = ["System/", "scripts/", "Resources/Meta/", "Resources/Templates/"];
/** A note the vault runs on (a path relative to the workspace): in the Pages tab only an admin sees it, apart. */
export const isSystemPage = (path: string) =>
  SYSTEM_FILES.includes(path) || SYSTEM_FOLDERS.some(folder => path.startsWith(folder));

/** The notes whose name holds the search text, by name, at most `max`. */
export const findPages = (paths: string[], query: string, max = 50) =>
  paths
    .filter(path => noteName(path).toLowerCase().includes(query))
    .sort((a, b) => byName(noteName(a), noteName(b)))
    .slice(0, max);

/** The notes conversations touched last in this workspace (`root`), newest first, each once, only ones that exist. */
export function recentPages(
  touches: { root: string; path: string; at: number }[],
  root: string,
  exists: (path: string) => boolean,
  max = 5,
) {
  const seen = new Set<string>();
  return [...touches]
    .filter(touch => touch.root === root && exists(touch.path))
    .sort((a, b) => b.at - a.at)
    .map(touch => touch.path)
    .filter(path => !seen.has(path) && seen.add(path))
    .slice(0, max);
}
