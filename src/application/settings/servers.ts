import { t, type Key } from "../../shared/i18n";
import { SERVERS } from "../../domain/navigation/views";
import { invitePlan, orgDisplayName, resolveItem } from "../../domain/settings/servers";
import type { SharedRole } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { select } from "../navigation/navigation";
import { showMachinesPage } from "./machines-page";
import { openWorkspace, run } from "./shared-vaults";
import { useSettingsStore, type OrgTab, type SettingsState, type SettingsTab } from "./store";
import { loadTeam } from "./teams";

// Servers and organisations: a page in the main window's middle column (not the settings window) with this Mac, the
// machines and the team servers in a list on the left and the picked one on the right. An organisation has the tabs
// Overview, People, Workspaces, Sign-in and Server; its use cases are the team ones (teams.ts). The settings window
// opens the page here through `open-servers`.
type Page = SettingsState["serversPage"];
const st = () => useSettingsStore.getState();
const change = (recipe: (draft: Page) => void) => useSettingsStore.setState(draft => recipe(draft.serversPage));

/** The page with `item` picked ("org:<fp>", "add"; empty keeps what was picked), on `tab`, with team workspace
 *  `workspace` open on its Workspaces tab. */
export function openServers(item = "", tab?: OrgTab, workspace = "") {
  change(draft => {
    if (item) draft.item = item;
    if (tab) draft.tab = tab;
    draft.workspace = "";
    draft.inviting = false;
  });
  openWorkspace("");
  if (workspace) openOrgWorkspace(workspace);
  void select(SERVERS);
}

/** A team workspace's settings (the footer menu's Workspace settings): its page on its organisation's Workspaces. */
export function openTeamWorkspace(folder: string) {
  const vault = (st().settings.sharedVaults ?? []).find(v => v.folder === folder && v.team);
  if (vault) openServers(`org:${vault.fp}`, "workspaces", vault.id);
  else openServers();
}

let watching = false;
/** When the page shows: every team server's account (and overview) read again, the machines checked once, and the
 *  shared vaults' rounds followed from here on, so a synced workspace's page has its last round. */
export function showServers() {
  for (const team of st().settings.teams ?? []) void loadTeam(team.fp);
  showMachinesPage();
  if (watching) return;
  watching = true;
  void backend.onSharedVaults(status => useSettingsStore.setState(draft => void (draft.shared.status = status)));
  backend
    .sharedVaultsStatus()
    .then(status => useSettingsStore.setState(draft => void (draft.shared.status = status)))
    .catch(() => {});
}

const TAB_NAMES: Record<OrgTab, Key> = {
  overview: "srv.tabOverview",
  people: "srv.tabPeople",
  workspaces: "srv.tabWorkspaces",
  signin: "srv.tabSignin",
  server: "srv.tabServer",
};
export const orgTabName = (tab: OrgTab) => t(TAB_NAMES[tab]);
/** The title bar's crumbs after the page's name: the organisation, its tab and the workspace open there. */
export function serversCrumb() {
  const { item, tab, workspace } = st().serversPage;
  const teams = st().settings.teams ?? [];
  const picked = resolveItem(item, teams);
  if (picked === "add") return t("srv.add");
  const team = teams.find(x => `org:${x.fp}` === picked)!;
  const open = workspace || st().shared.open;
  const name =
    tab === "workspaces" && open
      ? (st().team.overview[team.fp]?.workspaces.find(w => w.id === open)?.name ??
        st().team.me[team.fp]?.workspaces.find(w => w.id === open)?.name)
      : "";
  return [orgDisplayName(team), orgTabName(tab), name].filter(Boolean).join(" › ");
}

export const pickServer = (item: string) =>
  change(draft => {
    draft.item = item;
    draft.tab = "overview";
    draft.workspace = "";
    draft.inviting = false;
  });
export function pickOrgTab(tab: OrgTab) {
  change(draft => {
    draft.tab = tab;
    draft.workspace = "";
    draft.inviting = false;
  });
  openWorkspace("");
}
/** A workspace on the Workspaces tab: one synced here opens its page (the one Settings had), any other its members. */
export function openOrgWorkspace(id: string) {
  const synced = (st().settings.sharedVaults ?? []).some(v => v.id === id);
  change(draft => {
    draft.tab = "workspaces";
    draft.workspace = synced ? "" : id;
  });
  openWorkspace(synced ? id : "");
}
export const closeOrgWorkspace = () => {
  change(draft => void (draft.workspace = ""));
  openWorkspace("");
};
/** A page of the settings window (what is set up there, not here). */
export const openSettingsPage = (tab: SettingsTab) => void backend.openSettingsWindow(tab);
export const showInvite = (on: boolean) => change(draft => void (draft.inviting = on));

/** What inviting one address came to: its link and when it ends (a new account), or added (an account that was there),
 *  or why not. */
export type Invited = { email: string; link: string; expires: number; added: boolean; error: string };

/** Invites `emails` to team server `fp` as organisation admins or members, each into the workspaces of `roles` with
 *  that role, with the ops the server has (domain `invitePlan`). An address that fails stops there, the others go on. */
export async function inviteMany(fp: string, emails: string[], admin: boolean, roles: Record<string, SharedRole>) {
  const overview = st().team.overview[fp];
  if (!overview) return [];
  const out = new Map<string, Invited>(
    emails.map(email => [email, { email, link: "", expires: 0, added: true, error: "" }]),
  );
  await run(`team:${fp}`, async () => {
    for (const step of invitePlan(overview, emails, admin, roles)) {
      const result = out.get(step.email)!;
      if (result.error) continue;
      try {
        if (step.op === "invite") {
          const made = await backend.teamCall<{ link?: string; expires?: number }>(fp, {
            op: "team_invite",
            email: step.email,
            vault: "",
            role: "member",
            admin: step.admin,
          });
          result.link = made.link ?? "";
          result.expires = made.expires ?? 0;
          result.added = false;
        } else if (step.op === "admin")
          await backend.teamCall(fp, { op: "team_account", email: step.email, admin: true });
        else await backend.teamCall(fp, { op: "team_member", vault: step.vault, email: step.email, role: step.role });
      } catch (error) {
        result.error = String(error);
      }
    }
  });
  await loadTeam(fp);
  return [...out.values()];
}
