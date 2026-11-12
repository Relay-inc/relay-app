import type { SharedRole, TeamOverview, TeamSso } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { reload, run } from "./shared-vaults";
import { useSettingsStore, type SettingsState } from "./store";

// Team servers, on Servers and organisations (servers.ts), (src-tauri/src/team.rs, docs/workspaces.md, Teams): log in,
// an account's workspaces with Sync here…, members and invites by email, and for an organisation admin the accounts,
// workspaces and sign-in of the server. Busy and messages go under "team:<fp>" (shared-vaults.ts `run`).
type Team = SettingsState["team"];
const change = (recipe: (draft: Team) => void) => useSettingsStore.setState(draft => recipe(draft.team));
const key = (fp: string) => `team:${fp}`;

export const editTeamLink = (link: string) => change(draft => void (draft.link = link));

/** Log in with the typed link: an invite in it, or the server's provider in the browser. The server's fingerprint
 *  when it worked, else "" (the error shows under "team"). */
export async function loginTeam() {
  const link = useSettingsStore.getState().team.link.trim();
  const ok = await run("team", async () => {
    await backend.teamLogin(link);
    await reload();
  });
  if (ok) change(draft => void (draft.link = ""));
  for (const t of useSettingsStore.getState().settings.teams ?? []) void loadTeam(t.fp);
  // the link names the server's fingerprint
  return ok ? (useSettingsStore.getState().settings.teams?.find(x => link.includes(`fp=${x.fp}`))?.fp ?? "") : "";
}
export const cancelSignIn = () => void backend.ssoCancel();

/** Team server `fp`'s account and workspaces read again (and for an organisation admin the overview). */
export async function loadTeam(fp: string) {
  await run(key(fp), async () => {
    const me = await backend.teamMe(fp);
    change(draft => void (draft.me[fp] = me));
    // the organisation's name as the server says it now: every Mac shows the same one (an older server sends none)
    if (me.name !== undefined) keepName(fp, me.name);
    if (me.admin) await loadOverview(fp);
  });
}
async function loadOverview(fp: string) {
  const overview = await backend.teamCall<TeamOverview>(fp, { op: "team_overview" });
  change(draft => void (draft.overview[fp] = overview));
}

/** The name of team server `fp` in this window's copy of the settings, as the backend keeps it there too. */
const keepName = (fp: string, name: string) =>
  useSettingsStore.setState(draft => {
    const team = draft.settings.teams?.find(x => x.fp === fp);
    if (team) team.name = name;
  });

/** An organisation admin names the organisation, or renames it ("" takes the name away: the host shows). */
export const setTeamName = (fp: string, name: string) =>
  run(key(fp), async () => {
    const out = await backend.teamCall<{ name: string }>(fp, { op: "team_name", name: name.trim() });
    keepName(fp, out.name);
  });

/** What the server of a pasted team link says before logging in: its name and the first domain of its sign-in, for
 *  Join and the connect step. A server out of reach or closed to this Mac says nothing, the host shows. */
export async function peekTeam(link: string) {
  if (useSettingsStore.getState().team.peek?.link === link) return;
  change(draft => void (draft.peek = { link, name: "", domain: "" }));
  const info = await backend.teamPeek(link).catch(() => null);
  change(draft => {
    if (draft.peek?.link !== link || !info) return;
    draft.peek = { link, name: info.name ?? "", domain: info.sso?.domains[0] ?? "" };
  });
}

/** Sync team workspace `id` into a folder picked now (an empty one). */
export async function syncTeamWorkspace(fp: string, id: string) {
  const folder = await backend.pickFolder();
  if (!folder) return;
  await run(key(fp), async () => {
    await backend.teamOpen(fp, id, folder);
    await reload();
  });
  await loadTeam(fp);
}

/** An invite link for `email`'s next device; with `vault` and `role` also a member there, with `admin` an organisation
 *  admin. The link comes back to show, null when it failed. */
export async function inviteTeam(fp: string, email: string, vault = "", role: SharedRole = "member", admin = false) {
  let link = "";
  const ok = await run(vault || key(fp), async () => {
    link = (await backend.teamCall<{ link?: string }>(fp, { op: "team_invite", email, vault, role, admin })).link ?? "";
    if (useSettingsStore.getState().team.overview[fp]) await loadOverview(fp);
  });
  // "" when the account was there: added to the workspace, it logs in on its own devices
  return ok ? link : null;
}
/** `email`'s role in workspace `vault` ("" takes it out). */
export const setTeamMember = (fp: string, vault: string, email: string, role: SharedRole | "") =>
  run(vault, () => backend.teamCall(fp, { op: "team_member", vault, email, role }));
/** An organisation admin turns an account off or on, or makes it an organisation admin or not. */
export const setTeamAccount = (fp: string, email: string, patch: { admin?: boolean; off?: boolean }) =>
  run(key(fp), async () => {
    await backend.teamCall(fp, { op: "team_account", email, ...patch });
    await loadOverview(fp);
  });
/** New link for an open invite: a new invite for the same address, then the old one withdrawn. The organisation role
 *  and the workspace roles are the account's, not the invite's, so they carry over. The new link shows on its row. */
export const renewTeamInvite = (fp: string, invite: { id: string; email: string }) =>
  run(key(fp), async () => {
    const made = await backend.teamCall<{ invite?: string; link?: string }>(fp, {
      op: "team_invite",
      email: invite.email,
    });
    if (made.invite && made.link) change(draft => void (draft.links[made.invite!] = made.link!));
    await backend.teamCall(fp, { op: "team_invite_revoke", invite: invite.id });
    await loadOverview(fp);
  });
export const withdrawTeamInvite = (fp: string, invite: string) =>
  run(key(fp), async () => {
    await backend.teamCall(fp, { op: "team_invite_revoke", invite });
    await loadOverview(fp);
  });
/** The server's sign-in besides invite links: Google or one Entra tenant, or none. */
export const setTeamSso = (fp: string, sso: TeamSso | null) =>
  run(key(fp), async () => {
    await backend.teamCall(fp, { op: "team_sso", sso });
    await loadOverview(fp);
  });
/** The link that names the server, for who logs in with the provider. */
export const teamLink = (fp: string) => backend.teamLink(fp);

/** Log out: the server ends this Mac's session, its workspaces stop syncing here. */
export async function logoutTeam(fp: string) {
  await run(key(fp), async () => {
    await backend.teamLogout(fp);
    change(draft => {
      delete draft.me[fp];
      delete draft.overview[fp];
    });
    await reload();
  });
}
