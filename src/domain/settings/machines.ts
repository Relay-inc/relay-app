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

/** An excluded vault folder as it is saved: trimmed, slashes at the ends dropped. Null when it is empty, absolute or
 *  climbs out of the vault with "..". */
export function excludePath(input: string): string | null {
  const path = input.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!path || path.startsWith("/") || path.split("/").some(part => part === ".." || part === "")) return null;
  return path;
}

/** How long ago a round was, as a number and an Intl unit; null for a round that never ran (`at` 0). */
export function agoParts(
  at: number,
  now = Date.now(),
): { value: number; unit: "second" | "minute" | "hour" | "day" } | null {
  if (!at) return null;
  const seconds = Math.max(0, Math.round(now / 1000 - at));
  if (seconds < 60) return { value: -seconds, unit: "second" };
  if (seconds < 3600) return { value: -Math.round(seconds / 60), unit: "minute" };
  if (seconds < 86400) return { value: -Math.round(seconds / 3600), unit: "hour" };
  return { value: -Math.round(seconds / 86400), unit: "day" };
}

/** A conflict as the backend names it, "vault/<path>", without its "vault/" prefix. */
export const conflictPath = (conflict: string) => conflict.replace(/^vault\//, "");
