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

/** Where a machine keeps relay-server's folders unless the page says otherwise: an Unraid appdata folder. */
export const SETUP_FOLDER = "/mnt/user/appdata/relay-server";
/** The commands that set up relay-server in Docker on a machine (a home server, a NAS), to run there in this order.
 *  `folder` keeps the pairing, Claude's login, Claude Code itself and the repos. The image of this Relay's `version`
 *  speaks its protocol. `update` replaces a running one with that version, the folders stay. */
export function setupCommands(image: string, version: string, folder: string) {
  const dir = folder.trim().replace(/\/+$/, "") || SETUP_FOLDER;
  const q = (path: string) => (/^[\w./:-]+$/.test(path) ? path : `"${path.replace(/(["$`\\])/g, "\\$1")}"`);
  const volumes = [
    "data:/home/relay/data",
    "claude:/home/relay/.claude",
    "repos:/home/relay/repos",
    "local:/home/relay/.local",
  ];
  const run = [
    'docker run -d --name relay-server --hostname "$(hostname)" --restart unless-stopped -p 47800:47800 \\',
    "  --tmpfs /home/relay/work:uid=1000,gid=1000,mode=0700,size=2g \\",
    ...volumes.map(volume => `  -v ${q(`${dir}/${volume}`)} \\`),
    `  ${image}:${version}`,
  ].join("\n");
  const folders = ["data", "claude", "repos", "local"].map(name => q(`${dir}/${name}`)).join(" ");
  return {
    login: "docker login ghcr.io -u <your GitHub user>",
    install: `mkdir -p ${folders}\nchown -R 1000:1000 ${q(dir)}\n${run}`,
    claude: "docker exec -it relay-server claude",
    pair: "docker exec relay-server relay-server pair --host <this machine's LAN address>",
    update: `docker pull ${image}:${version}\ndocker rm -f relay-server\n${run}`,
  };
}
