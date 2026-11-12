import type { Machine, MachineChoice, MachineRepo, SharedVault } from "./types";

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

/** Settings › Workspaces: the shared vaults each machine keeps (the vault's server pinned by that machine's fingerprint),
 *  and the rest, on a server that is not one of this Mac's machines: a vault this Mac joined with a link. */
export function vaultsByMachine(machines: Machine[], vaults: SharedVault[]) {
  const on: Record<string, SharedVault[]> = Object.fromEntries(machines.map(machine => [machine.id, []]));
  const elsewhere: SharedVault[] = [];
  for (const vault of vaults) {
    const fp = vault.fp.toLowerCase();
    const machine = fp ? machines.find(machine => machine.fp?.toLowerCase() === fp) : undefined;
    if (machine) on[machine.id].push(vault);
    else elsewhere.push(vault);
  }
  return { on, elsewhere };
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
/** Where each kind of machine keeps relay-server's compose folder unless the page says otherwise (Linux as
 *  docs/relay-server.md has it for an organisation server). */
export const SETUP_FOLDERS: Record<SetupPlatform, string> = {
  mac: "~/relay-server",
  linux: "/opt/relay-server",
  unraid: "/mnt/user/appdata/relay-server",
};
// the machine's own LAN address in the pairing line, so it can be copied as is: on a Mac the first network port with
// one (en0 is Ethernet on a desktop Mac, Wi-Fi on a laptop), on Linux the address of the default route
const LAN_ADDRESS: Record<SetupPlatform, string> = {
  mac: "$(ipconfig getifaddr en0 || ipconfig getifaddr en1)",
  linux: "$(ip route get 1 | sed -n 's/.*src \\([0-9.]*\\).*/\\1/p')",
  unraid: "$(ip route get 1 | sed -n 's/.*src \\([0-9.]*\\).*/\\1/p')",
};
/** Where deploy/relay-server's files are downloaded from, as docs/relay-server.md has it. */
export const DEPLOY_BASE = "https://raw.githubusercontent.com/Relay-inc/relay-app/main/deploy/relay-server";
/** The commands that set up relay-server with Docker Compose on a machine of `platform` (docs/relay-server.md), to run
 *  there in this order. `folder` holds compose.yml, .env and backup.sh: the pairing, Claude's login and the repos live
 *  in the compose volume. `.env` pins the image of this Relay's `version`, which speaks its protocol. `update` moves a
 *  running one to that version, the volume stays. */
export function setupCommands(image: string, version: string, folder: string, platform: SetupPlatform) {
  const dir = folder.trim().replace(/\/+$/, "") || SETUP_FOLDERS[platform];
  // a leading ~/ stays outside the quotes, or the shell would not expand it
  const q = (path: string): string =>
    path.startsWith("~/")
      ? `~/${q(path.slice(2))}`
      : /^[\w./:~-]+$/.test(path)
        ? path
        : `"${path.replace(/(["$`\\])/g, "\\$1")}"`;
  const at = q(dir);
  const pin = `RELAY_SERVER_IMAGE=${image}:${version}`;
  // a folder like /opt needs sudo on Linux, then belongs to the user so the rest runs without it. Unraid's terminal is
  // root already, a Mac's home is the user's
  const make = platform === "linux" ? `sudo mkdir -p ${at} && sudo chown "$USER" ${at}` : `mkdir -p ${at}`;
  return {
    login: "docker login ghcr.io -u <your GitHub user>",
    install: [
      `${make} && cd ${at}`,
      `base=${DEPLOY_BASE}`,
      'curl -fsSLO "$base/compose.yml" -O "$base/backup.sh"',
      "chmod +x backup.sh",
      `echo "${pin}" > .env`,
      'echo "RELAY_HOST=$(hostname)" >> .env',
      "docker compose up -d --wait",
    ].join("\n"),
    claude: "docker compose exec -it relay-server claude",
    pair: `docker compose exec relay-server relay-server pair --host "${LAN_ADDRESS[platform]}"`,
    update: [
      `cd ${at}`,
      `sed -i.bak '/^RELAY_SERVER_IMAGE=/d' .env && echo "${pin}" >> .env`,
      "docker compose pull && docker compose up -d --wait",
    ].join("\n"),
  };
}

/** What a repo on a machine holds that is not on GitHub, as the parts of its label: the commits not pushed (`n`) and
 *  work not committed, or clean. */
export function repoState({ dirty, unpushed }: Pick<MachineRepo, "dirty" | "unpushed">) {
  const parts: ({ key: "mc.repoUnpushed"; n: number } | { key: "mc.repoDirty" | "mc.repoClean" })[] = [];
  if (unpushed > 0) parts.push({ key: "mc.repoUnpushed", n: unpushed });
  if (dirty) parts.push({ key: "mc.repoDirty" });
  return parts.length ? parts : [{ key: "mc.repoClean" as const }];
}

/** The branch a machine's work goes to on GitHub, as the backend makes it: `relay/` and the machine's name in lowercase,
 *  every run of other characters one "-". A name without a letter or digit uses the machine's id. */
export function snapshotBranch(name: string, id: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `relay/${slug || id}`;
}

/** Repo work on a machine that a move back to this Mac would leave behind: the folder there, its owner/repo, the
 *  machine's name and the branch Push and move puts it on. */
export type RepoWork = { repo: string; name: string; branch: string; machine: string };
/** The repo work a refused move names (the backend's "repo-work:" error), or null for any other error. */
export function repoWorkOf(error: unknown): RepoWork | null {
  const text = String(error);
  if (!text.startsWith("repo-work:")) return null;
  try {
    const work = JSON.parse(text.slice("repo-work:".length)) as RepoWork;
    return typeof work.repo === "string" && typeof work.branch === "string" ? work : null;
  } catch {
    return null;
  }
}
