import type { Machine, MachineChoice } from "./types";

/** A project folder row on Settings › Machines while it is edited: the vault project and its path on the machine. */
export type FolderRow = { project: string; path: string };

/** The saved folders of a machine as rows. */
export const folderRows = (machine: Machine): FolderRow[] =>
  Object.entries(machine.folders ?? {}).map(([project, path]) => ({ project, path }));

/** The rows to save: empty rows drop out, the others need a project and an absolute path; null when one does not. */
export function foldersOf(rows: FolderRow[]): Record<string, string> | null {
  const folders: Record<string, string> = {};
  for (const { project, path } of rows.filter(row => row.project || row.path.trim())) {
    if (!project || !path.trim().startsWith("/")) return null;
    folders[project] = path.trim();
  }
  return folders;
}

/** The projects a row can pick: the row's own, and every one not linked elsewhere in the list. */
export const projectChoices = (projects: string[], rows: FolderRow[], row: FolderRow) => {
  const taken = new Set(rows.map(other => other.project));
  return projects.filter(name => name === row.project || !taken.has(name));
};

/** Where a new conversation runs, as the composer's pick shows it: "" this Mac, else a machine id. The user's pick
 *  while that machine is still paired, else the project's machine, else this Mac; always this Mac when only this Mac
 *  can run it (another agent, a mail). Null when there is nothing to pick (no machines, or not known yet): the backend
 *  then applies the project's machine itself. */
export function machinePick(list: MachineChoice[] | undefined, picked: string | undefined, remote: boolean) {
  if (!list?.length) return null;
  if (!remote) return "";
  if (picked === "" || list.some(machine => machine.id === picked)) return picked!;
  return list.find(machine => machine.default)?.id ?? "";
}
