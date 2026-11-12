import { t, type Key } from "../../shared/i18n";
import { SERVERS } from "../../domain/navigation/views";
import {
  invitePlan,
  ORG_SETUP_DEFAULTS,
  orgDisplayName,
  resolveItem,
  type OrgDraft,
} from "../../domain/settings/servers";
import type { SharedRole } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { select } from "../navigation/navigation";
import { pairMachine, pollMachineGit, pollMirrors, showMachinesPage } from "./machines-page";
import { editForm, joinSharedVault, openWorkspace, run, takeInvite, watchSharedVaults } from "./shared-vaults";
import { useSettingsStore, type AddKind, type OrgTab, type SettingsState, type SettingsTab } from "./store";
import { editTeamLink, loadTeam, loginTeam, setTeamName } from "./teams";

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

/** A workspace or an organisation in "New workspace from template…": the first organisation's Workspaces with New
 *  workspace… open, else the first machine (New workspace on this machine…), else Add a server. */
export function openNewWorkspace() {
  const team = st().settings.teams?.[0];
  const machine = st().settings.machines?.find(m => !m.auto);
  if (team) {
    openServers(`org:${team.fp}`, "workspaces");
    useSettingsStore.setState(draft => {
      draft.shared.form = { ...draft.shared.form, mode: "new", machine: `team:${team.fp}` };
    });
  } else if (machine) openServers(`machine:${machine.id}`);
  else openAdd();
}

/** Add a server, on what it is for (`kind`, "" to choose). An organisation server being set up opens where it was. */
export function openAdd(kind: AddKind = "") {
  if (kind === "org" && st().serversPage.draft) return openServers("setup");
  change(draft => {
    draft.add = kind;
    draft.step = kind === "own" ? 2 : 1;
  });
  openServers("add");
}
/** An invite link that opened Relay (the backend keeps it until taken): Add a server › Join with it pasted. */
export async function openInvite() {
  if (await takeInvite()) openAdd("join");
}

let watching = false;
/** When the page shows: every team server's account (and overview) read again, the machines checked once, the
 *  organisation server being set up read from this Mac, and the shared vaults' rounds followed from here on, so a
 *  workspace's page has its last round. */
export function showServers() {
  for (const team of st().settings.teams ?? []) void loadTeam(team.fp);
  showMachinesPage();
  if (watching) return;
  watching = true;
  const saved = storage.get<OrgDraft | null>(DRAFT, null);
  if (saved) change(draft => void (draft.draft = saved));
  void watchSharedVaults();
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
  const { item, tab, workspace, draft } = st().serversPage;
  const teams = st().settings.teams ?? [];
  const machines = st().settings.machines ?? [];
  const picked = resolveItem(item, teams, machines, !!draft);
  if (picked === "add") return t("srv.add");
  if (picked === "setup") return [t("srv.add"), t("srv.kindOrgServer")].join(" › ");
  if (picked === "mac") return t("srv.thisMac");
  if (picked.startsWith("machine:")) return machines.find(m => `machine:${m.id}` === picked)?.name ?? "";
  const team = teams.find(x => `org:${x.fp}` === picked)!;
  const open = workspace || st().shared.open;
  const name =
    tab === "workspaces" && open
      ? (st().team.overview[team.fp]?.workspaces.find(w => w.id === open)?.name ??
        st().team.me[team.fp]?.workspaces.find(w => w.id === open)?.name)
      : "";
  return [orgDisplayName(team), orgTabName(tab), name].filter(Boolean).join(" › ");
}

export function pickServer(item: string) {
  change(draft => {
    draft.item = item;
    draft.tab = "overview";
    draft.workspace = "";
    draft.inviting = false;
  });
  openWorkspace("");
}
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
/** A page of the settings window. */
export const openSettingsPage = (tab: SettingsTab) => void backend.openSettingsWindow(tab);

/** The mirror of every machine every second while a machine's page shows (its progress bar), GitHub and the repos
 *  there every 10 seconds. Returns the stop. */
export function watchMachines() {
  pollMirrors();
  const fast = setInterval(pollMirrors, 1000);
  const slow = setInterval(pollMachineGit, 10_000);
  return () => {
    clearInterval(fast);
    clearInterval(slow);
  };
}

// ---------- Add a server
const DRAFT = "orgSetup";
/** Add a server: what it is for. An organisation server starts its setup, kept on this Mac until it is connected. */
export function chooseAdd(kind: AddKind) {
  if (kind === "org") {
    saveDraft(st().serversPage.draft ?? { ...ORG_SETUP_DEFAULTS, admin: "", step: 2 });
    return openServers("setup");
  }
  change(draft => {
    draft.add = kind;
    draft.step = kind === "own" ? 2 : 1;
  });
}
export const setAddStep = (step: number) => change(draft => void (draft.step = step));
function saveDraft(next: OrgDraft | null) {
  change(draft => void (draft.draft = next));
  storage.set(DRAFT, next);
}
/** The organisation server being set up: what is typed, or its step. */
export const editDraft = (patch: Partial<OrgDraft>) => {
  const now = st().serversPage.draft;
  if (now) saveDraft({ ...now, ...patch });
};
/** Stops setting up the organisation server: this Mac forgets what was typed. */
export function dropDraft() {
  saveDraft(null);
  openAdd();
}
/** Pairs a machine of your own with the line its relay-server printed: its page opens. True when it worked. */
export async function pairOwnMachine(line: string, name: string, sharedOnly: boolean) {
  const before = new Set((st().settings.machines ?? []).map(m => m.id));
  if (!(await pairMachine(line, name, sharedOnly))) return false;
  const made = (st().settings.machines ?? []).find(m => !before.has(m.id));
  openServers(made ? `machine:${made.id}` : "");
  return true;
}
/** Logs in to an organisation's server with `line` (its invite, or its sign-in link and the provider in the browser),
 *  and names the organisation `name` when given: the organisation's page opens, and a setup of that server on this Mac
 *  is done. */
export async function connectOrg(line: string, name = "") {
  editTeamLink(line);
  const fp = await loginTeam();
  if (!fp) return;
  // the name typed at Connect, when it is not the one the server has: an organisation admin sets it there
  const team = st().settings.teams?.find(x => x.fp === fp);
  if (team?.admin && name.trim() && name.trim() !== (team.name ?? "")) await setTeamName(fp, name);
  if (st().serversPage.item === "setup") saveDraft(null);
  openServers(`org:${fp}`, "overview");
}
/** Joins an encrypted workspace with the invite pasted under Join, into the folder picked: its page opens. */
export async function joinWorkspace(line: string) {
  const before = new Set((st().settings.sharedVaults ?? []).map(v => v.id));
  editForm({ link: line });
  await joinSharedVault();
  const made = (st().settings.sharedVaults ?? []).find(v => !before.has(v.id));
  if (!made) return;
  openServers("mac");
  openWorkspace(made.id);
}
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
