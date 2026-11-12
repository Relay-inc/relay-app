import type { SharedRole, TeamOverview, TeamServer } from "./types.ts";

// Servers and organisations, the page in the main window: what it shows about a team server, worked out from what the
// server already gives (`team_me`, `team_overview`). Nothing here is a guess about what the server does not say.

/** The name an organisation shows. The server only knows its host today: when `team.json` gets a name, it comes in
 *  here and nowhere else. */
export const orgDisplayName = (team: Pick<TeamServer, "host">) => team.host;

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

/** The item the page shows: the one picked while it is still there, else the first organisation, else Add a server. */
export function resolveItem(item: string, teams: Pick<TeamServer, "fp">[]) {
  if (item === "add" || teams.some(team => `org:${team.fp}` === item)) return item;
  return teams.length ? `org:${teams[0].fp}` : "add";
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
