// Folders in the sidebar: a project's (or Algemeen's) own grouping of its conversations, kept by the app only. A
// conversation names its folder (Chat.folder); a folder that is gone, or one of another project, leaves it loose.

/** One folder, under the project it belongs to ("" for Algemeen) in the sidebar's `folders`. */
export type Folder = { id: string; name: string };

/** A new folder's id: `f:<time>`, never a section or project name. */
export const newFolderId = (now: number) => `f:${now.toString(36)}`;

/** The rows split over the folders, in their order: what sits in each folder, and the loose rest. */
export function byFolder<T>(rows: T[], folderOf: (row: T) => string | undefined, folders: Folder[] = []) {
  const inside = new Map<string, T[]>(folders.map(folder => [folder.id, []]));
  const loose: T[] = [];
  for (const row of rows) {
    const folder = folderOf(row);
    const list = folder ? inside.get(folder) : undefined;
    if (list) list.push(row);
    else loose.push(row);
  }
  return { inside, loose };
}
