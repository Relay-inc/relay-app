import type { MachineChoice } from "./types";

/** Where a new conversation runs, as the composer's pick shows it: "" this Mac, else a machine id. The user's pick
 *  while that machine is still paired, else the default machine, else this Mac; always this Mac when only this Mac
 *  can run it (another agent, a mail). Null when there is nothing to pick (no machines, or not known yet): the backend
 *  then applies the default itself. */
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

/** `a` is a later version than `b` ("0.0.10" after "0.0.9"). */
export function newerVersion(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/** The kinds of machine the setup section has commands for, in the order the page shows them. */
export const SETUP_PLATFORMS = ["mac", "linux", "unraid"] as const;
export type SetupPlatform = (typeof SETUP_PLATFORMS)[number];
/** Where each kind of machine keeps relay-server's folders unless the page says otherwise. */
export const SETUP_FOLDERS: Record<SetupPlatform, string> = {
  mac: "~/relay-server",
  linux: "/srv/relay-server",
  unraid: "/mnt/user/appdata/relay-server",
};
// the machine's own LAN address in the pairing line, so it can be copied as is: on a Mac the first network port with
// one (en0 is Ethernet on a desktop Mac, Wi-Fi on a laptop), on Linux the address of the default route
const LAN_ADDRESS: Record<SetupPlatform, string> = {
  mac: "$(ipconfig getifaddr en0 || ipconfig getifaddr en1)",
  linux: "$(ip route get 1 | sed -n 's/.*src \\([0-9.]*\\).*/\\1/p')",
  unraid: "$(ip route get 1 | sed -n 's/.*src \\([0-9.]*\\).*/\\1/p')",
};
/** The commands that set up relay-server in Docker on a machine of `platform`, to run there in this order. `folder`
 *  keeps the pairing, Claude's login, Claude Code itself and the repos. The image of this Relay's `version` speaks its
 *  protocol. `update` replaces a running one with that version, the folders stay. */
export function setupCommands(image: string, version: string, folder: string, platform: SetupPlatform) {
  const dir = folder.trim().replace(/\/+$/, "") || SETUP_FOLDERS[platform];
  // a leading ~/ stays outside the quotes, or the shell would not expand it
  const q = (path: string): string =>
    path.startsWith("~/")
      ? `~/${q(path.slice(2))}`
      : /^[\w./:~-]+$/.test(path)
        ? path
        : `"${path.replace(/(["$`\\])/g, "\\$1")}"`;
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
  // the container runs as uid 1000: Linux needs the folders to be its own (sudo for a folder like /srv, Unraid's
  // terminal is root already), Docker Desktop on a Mac lets the container write a shared folder as it is
  const folderSetup = {
    mac: `mkdir -p ${folders}`,
    linux: `sudo mkdir -p ${folders}\nsudo chown -R 1000:1000 ${q(dir)}`,
    unraid: `mkdir -p ${folders}\nchown -R 1000:1000 ${q(dir)}`,
  }[platform];
  return {
    login: "docker login ghcr.io -u <your GitHub user>",
    install: `${folderSetup}\n${run}`,
    claude: "docker exec -it relay-server claude",
    pair: `docker exec relay-server relay-server pair --host "${LAN_ADDRESS[platform]}"`,
    update: `docker pull ${image}:${version}\ndocker rm -f relay-server\n${run}`,
  };
}
