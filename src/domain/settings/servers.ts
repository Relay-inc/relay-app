import type { Machine, SharedRole, SharedVault, TeamOverview, TeamServer } from "./types.ts";
import { DEPLOY_BASE } from "./machines.ts";

// Servers and organisations, the page in the main window: what it shows about a team server, worked out from what the
// server already gives (`team_me`, `team_overview`). Nothing here is a guess about what the server does not say.

/** The most characters an organisation's name has (relay-server's team.rs NAME_MAX). */
const NAME_MAX = 60;
/** A name a server gave, as it may show: without control and format characters (bidi controls that turn text around,
 *  zero-width ones and the BOM that make two names look alike), trimmed, at most NAME_MAX characters. The server
 *  refuses such names, this is for a server that does not. */
export const cleanOrgName = (name: string | undefined) =>
  [...(name ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").trim()].slice(0, NAME_MAX).join("").trim();
/** The name an organisation shows: the one its server keeps (`team.json`, set by an organisation admin), else its host
 *  (no name yet, or an older server). */
export const orgDisplayName = (team: Pick<TeamServer, "host" | "name">) => cleanOrgName(team.name) || team.host;
/** Another organisation this Mac is in that shows the same name as `name` from the server `fp`: a server can call
 *  itself anything, so a name that copies one you know is said, with that one's host. */
export const nameClash = (teams: TeamServer[] | undefined, fp: string, name: string | undefined) => {
  const shown = cleanOrgName(name).toLowerCase();
  return shown ? teams?.find(team => team.fp !== fp && orgDisplayName(team).toLowerCase() === shown) : undefined;
};
/** The letters of an organisation's square: the first of its first two words ("Bluebird Studio" BS), "" without a
 *  name (the square shows a building). */
export const orgInitials = (name: string | undefined) =>
  cleanOrgName(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => [...word][0].toUpperCase())
    .join("");
/** The team server a workspace of the organisation is on, by its fingerprint: its name comes from there. */
export const teamOf = (teams: TeamServer[] | undefined, vault: { fp: string; host: string }) =>
  teams?.find(team => team.fp === vault.fp) ?? { host: vault.host, name: "" };
/** A group of the footer's workspace menu: where its workspaces live, which says who can read them. `name` is the
 *  machine's, the server's host or the organisation's ("" for this Mac). */
export type Place = { key: string; kind: "mac" | "machine" | "host" | "org"; name: string };
const PLACE_ORDER: Record<Place["kind"], number> = { mac: 0, machine: 1, host: 2, org: 3 };
/** The workspace folders by place, in the menu's order (and ⌃1 to ⌃9's): On this Mac (the main vault and the folders
 *  added), each machine of your own with the encrypted workspaces it keeps, the encrypted workspaces on someone else's
 *  server under its host, then each organisation under its name. Within a place the folders keep their order. */
export function workspacePlaces(
  folders: string[],
  s: { sharedVaults?: SharedVault[]; machines?: Machine[]; teams?: TeamServer[] },
) {
  const placeOf = (folder: string): Place => {
    const vault = s.sharedVaults?.find(v => v.folder === folder);
    if (!vault) return { key: "mac", kind: "mac", name: "" };
    if (vault.team) return { key: `org:${vault.fp}`, kind: "org", name: orgDisplayName(teamOf(s.teams, vault)) };
    const fp = vault.fp.toLowerCase();
    const machine = s.machines?.find(m => m.fp?.toLowerCase() === fp);
    if (machine) return { key: `machine:${machine.id}`, kind: "machine", name: machine.name };
    return { key: `host:${fp}`, kind: "host", name: vault.host };
  };
  const places: (Place & { folders: string[] })[] = [];
  for (const folder of folders) {
    const place = placeOf(folder);
    const there = places.find(p => p.key === place.key);
    if (there) there.folders.push(folder);
    else places.push({ ...place, folders: [folder] });
  }
  // a stable sort: places of one kind stay in the order their first workspace had
  return places.sort((a, b) => PLACE_ORDER[a.kind] - PLACE_ORDER[b.kind]);
}

/** A first name for an organisation from its sign-in's email domain: "example.com" Example. */
export function nameFromDomain(domain: string) {
  const first = domain.trim().toLowerCase().split(".")[0] ?? "";
  return first ? first[0].toUpperCase() + first.slice(1) : "";
}

/** What the Overview's setup list says is done or still open, only what follows from the overview:
 *  `admins` a second organisation admin, `signin` a provider besides invite links, `alone` the workspaces with one admin
 *  (only an organisation admin can stand in), `invite` an invite nobody used yet. */
export type SetupItem =
  | { kind: "admins"; done: boolean; admins: string[] }
  | { kind: "signin"; done: boolean }
  | { kind: "alone"; done: false; workspaces: { id: string; name: string; admin: string }[] }
  | { kind: "invite"; done: false; id: string; email: string; expires: number };

export function setupChecklist(o: TeamOverview): SetupItem[] {
  const on = new Set(o.accounts.filter(a => !a.off).map(a => a.email));
  const admins = o.accounts.filter(a => a.admin && !a.off).map(a => a.email);
  const items: SetupItem[] = [
    { kind: "admins", done: admins.length > 1, admins },
    { kind: "signin", done: !!o.sso },
  ];
  const alone = o.workspaces.flatMap(w => {
    const admins = Object.entries(w.members).filter(([email, role]) => role === "admin" && on.has(email));
    return admins.length === 1 ? [{ id: w.id, name: w.name, admin: admins[0][0] }] : [];
  });
  if (alone.length) items.push({ kind: "alone", done: false, workspaces: alone });
  for (const i of o.invites) items.push({ kind: "invite", done: false, id: i.id, email: i.email, expires: i.expires });
  return items;
}

/** An account's workspaces with its role in each, in the overview's order. */
export const workspacesOf = (o: TeamOverview, email: string) =>
  o.workspaces.flatMap(w => (w.members[email] ? [{ id: w.id, name: w.name, role: w.members[email] }] : []));

/** A workspace's admins, by address. */
export const adminsOf = (members: Record<string, SharedRole>) =>
  Object.entries(members)
    .filter(([, role]) => role === "admin")
    .map(([email]) => email);

/** Addresses typed or pasted into one field: split on commas, semicolons, spaces and lines, trimmed, lower case, each
 *  once. `bad` holds what the server would refuse as an address (relay-server team.rs `email`). */
export function parseEmails(text: string) {
  const good: string[] = [];
  const bad: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const e = part.trim().replace(/^<|>$/g, "").toLowerCase();
    if (!e) continue;
    const at = e.split("@");
    const ok = e.length <= 254 && at.length === 2 && !!at[0] && !!at[1];
    const list = ok ? good : bad;
    if (!list.includes(e)) list.push(e);
  }
  return { good, bad };
}

/** One step of inviting `emails` with an organisation role and a role per workspace, in the order to run them, with
 *  the ops the server has: a new address gets an account and its link (`team_invite`), an existing one is only made an
 *  organisation admin when asked (`team_account`); then each picked workspace adds the address with its role
 *  (`team_member`, which needs the account to exist), unless the address is in it already. An existing account never
 *  gets a link: it logs in on its own devices, a link would let whoever has it in as that person. */
export type InviteStep =
  | { op: "invite"; email: string; admin: boolean }
  | { op: "admin"; email: string }
  | { op: "member"; email: string; vault: string; role: SharedRole };
export function invitePlan(
  o: TeamOverview,
  emails: string[],
  admin: boolean,
  roles: Record<string, SharedRole>,
): InviteStep[] {
  const steps: InviteStep[] = [];
  for (const email of emails) {
    const account = o.accounts.find(a => a.email === email);
    if (!account) steps.push({ op: "invite", email, admin });
    else if (admin && !account.admin) steps.push({ op: "admin", email });
    // already in a workspace: the role stays as it is (inviting never demotes someone, nor the last admin)
    for (const [vault, role] of Object.entries(roles))
      if (!o.workspaces.find(w => w.id === vault)?.members[email]) steps.push({ op: "member", email, vault, role });
  }
  return steps;
}

/** The item the page shows: "mac", "machine:<id>", "org:<fp>", "setup" (an organisation server being set up) or
 *  "add". The one picked while it is still there, else the first organisation, else the first machine, else Add a
 *  server. */
export function resolveItem(
  item: string,
  teams: Pick<TeamServer, "fp">[],
  machines: { id: string }[] = [],
  setup = false,
) {
  const there =
    item === "add" ||
    item === "mac" ||
    (item === "setup" && setup) ||
    teams.some(team => `org:${team.fp}` === item) ||
    machines.some(machine => `machine:${machine.id}` === item);
  if (there) return item;
  return teams.length ? `org:${teams[0].fp}` : machines.length ? `machine:${machines[0].id}` : "add";
}
/** An organisation's tabs: an organisation admin has all five, a member Overview and Workspaces. */
export const ORG_TABS = ["overview", "people", "workspaces", "signin", "server"] as const;
export const orgTabs = (admin: boolean): readonly (typeof ORG_TABS)[number][] =>
  admin ? ORG_TABS : ORG_TABS.filter(tab => tab === "overview" || tab === "workspaces");

/** The folder docs/relay-server.md puts an organisation server in. */
export const ORG_FOLDER = "/opt/relay-server";
/** What whoever runs an organisation server types on the box, as docs/relay-server.md has it (compose, backup.sh):
 *  `image` and `version` are this Relay's (`server_setup`), so the server stays on the apps' version. */
export function orgServerCommands(image: string, version: string, folder = ORG_FOLDER) {
  const dir = folder.trim().replace(/\/+$/, "") || ORG_FOLDER;
  return {
    env: `RELAY_SERVER_IMAGE=${image}:${version}`, // the line in .env
    update: "docker compose pull && docker compose up -d --wait",
    backup: "./backup.sh backup",
    cron: `30 3 * * * cd ${dir} && ./backup.sh backup /mnt/backup/relay-$(date +\\%u).tar.gz`,
    restore: "./backup.sh restore /mnt/backup/relay-3.tar.gz\ndocker compose up -d --wait",
  };
}

/** What a line pasted under Join is, by its form alone (the same checks as relay-remote's `team::Link::parse` and
 *  `proto::PairLine::parse`): an organisation's invite (`#team`, an invite and its code), an organisation's sign-in
 *  link (`#team` without an invite: the organisation's Google or Entra sign-in), an invite to an encrypted workspace
 *  (`vault`, `invite`, `secret`), or a pairing line for a machine of your own (`code` only). Anything else is null. */
export type PastedLine = {
  kind: "team-invite" | "team-signin" | "workspace" | "pairing";
  host: string;
  port: number;
  fp: string; // the server's certificate fingerprint, lower case
} | null;
/** A port a team link may name, as relay-remote's `team::port_ok`: 443 or 1024 and up, never 0 or another privileged
 *  one. */
export const teamPortOk = (port: number) => port === 443 || (port >= 1024 && port <= 65535);
export function recogniseLine(text: string): PastedLine {
  const m = /^relay:\/\/(\[[^\]]+\]|[^:/#]+):(\d{1,5})#(.+)$/.exec(text.trim());
  if (!m) return null;
  const host = m[1].replace(/^\[|\]$/g, "");
  const port = Number(m[2]);
  if (!host || host.length > 253 || !/^[A-Za-z0-9.:-]+$/.test(host) || port > 65535) return null;
  const hex = (v: string | undefined, n: number) => !!v && v.length === n && /^[0-9a-f]+$/i.test(v);
  const flags = new Set<string>();
  const kv: Record<string, string> = {};
  for (const part of m[3].split("&")) {
    const i = part.indexOf("=");
    if (i < 0) flags.add(part);
    else kv[part.slice(0, i)] = part.slice(i + 1);
  }
  if (!hex(kv.fp, 64)) return null;
  const at = { host, port, fp: kv.fp.toLowerCase() };
  if (flags.has("team"))
    return !teamPortOk(port)
      ? null
      : hex(kv.invite, 16) && hex(kv.code, 64)
        ? { kind: "team-invite", ...at }
        : kv.invite || kv.code
          ? null
          : { kind: "team-signin", ...at };
  if (!hex(kv.code, 32)) return null;
  if (hex(kv.vault, 16) && hex(kv.invite, 16) && hex(kv.secret, 64)) return { kind: "workspace", ...at };
  // a phone's line (its mirror key and link secret) is not for a Mac
  if (kv.key || kv.link || kv.vault || kv.invite) return null;
  return { kind: "pairing", ...at };
}

/** A path or value for the shell: as it is when it is plain, else double quoted. */
const shellWord = (v: string): string => (/^[\w./:@~-]+$/.test(v) ? v : `"${v.replace(/(["$`\\])/g, "\\$1")}"`);
/** Setting up an organisation server, as docs/relay-server.md has it (compose, backup.sh), filled in with what the
 *  admin typed: the address the Macs use, the first organisation admin, the folder on the box and where the Macs are. */
export type OrgSetup = { host: string; admin: string; folder: string; network: string };
export const ORG_SETUP_DEFAULTS: OrgSetup = { host: "", admin: "", folder: ORG_FOLDER, network: "" };
/** An organisation server being set up, kept on this Mac while it takes days (waiting on whoever runs the box): what
 *  was typed and the step (2 requirements, 3 install, 4 connect). */
export type OrgDraft = OrgSetup & { step: 2 | 3 | 4 };
export function orgInstallCommands(s: OrgSetup) {
  const dir = shellWord(s.folder.trim().replace(/\/+$/, "") || ORG_FOLDER);
  const host = shellWord(s.host.trim() || "relay.example.com");
  return {
    check: "docker compose version",
    login: "docker login ghcr.io -u <your GitHub user>",
    install: [
      `sudo mkdir -p ${dir} && sudo chown "$USER" ${dir} && cd ${dir}`,
      `base=${DEPLOY_BASE}`,
      'curl -fsSLO "$base/compose.yml" -O "$base/backup.sh" -o .env "$base/.env.example"',
      "chmod +x backup.sh",
      "docker compose up -d --wait",
    ].join("\n"),
    port: `ufw allow from ${shellWord(s.network.trim() || "192.168.1.0/24")} to any port 47800 proto tcp`,
    team: `docker compose exec relay-server relay-server team ${shellWord(s.admin.trim() || "you@example.com")} --host ${host}`,
    cron: orgServerCommands("", "", s.folder).cron,
  };
}
