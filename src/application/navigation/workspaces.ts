import { activeWorkspace, chatVault, vaultChoices } from "../../domain/conversations/rules";
import { opened, panelItem } from "../../domain/navigation/keys";
import { WAIT } from "../../domain/navigation/views";
import { isOrchKey } from "../../domain/orchestrator/rules";
import { useConversationsStore } from "../conversations/store";
import { terminalOf } from "../conversations/selectors";
import * as backend from "../../infrastructure/backend";
import { saveMainSettings, settings } from "../settings/settings";
import { useWorkspaceStore } from "../workspace/store";
import { loadSnapshot, vaultName } from "../workspace/vault";
import { pickVault } from "../workspace/vault-setup";
import { useNavigationStore } from "./store";
import { storage } from "../../infrastructure/storage";
import { select, toast } from "./navigation";
import { projectVault, shownUnder } from "./migrate";

// The workspaces: every vault here (the main one, the folders added, the shared ones), one of them shown in the sidebar.
/** A workspace in the footer's menu: `notes` counted from the notes index, `team` for one shared on a relay-server,
 *  `live` when that one's live channel is connected (else it syncs every 10 s). */
export type Workspace = {
  folder: string;
  name: string;
  initials: string;
  notes: number;
  team: boolean;
  live: boolean;
  active: boolean;
};

export const activeFolder = () => activeWorkspace(settings(), useNavigationStore.getState().sidebar.workspace);
const initials = (name: string) => {
  const letters = name.replace(/[^\p{L}\p{N}]/gu, "");
  return letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase();
};
// the main vault's notes are relative to it, another vault's absolute (lib.rs `vault_notes`)
const notesIn = (folder: string, main: boolean) =>
  [...useWorkspaceStore.getState().notes.paths].filter(path =>
    main ? !path.startsWith("/") : path.startsWith(folder + "/"),
  ).length;

/** Every workspace, the main one first, in the order ⌃1 to ⌃9 pick them. */
export function workspaces(): Workspace[] {
  const active = activeFolder();
  const shared = settings().sharedVaults ?? [];
  const live = useWorkspaceStore.getState().live;
  return vaultChoices(settings()).map(choice => {
    const name = vaultName(choice.folder);
    const team = shared.find(vault => vault.folder === choice.folder);
    return {
      folder: choice.folder,
      name,
      initials: initials(name),
      notes: notesIn(choice.folder, choice.main),
      team: !!team,
      live: !!team && !!live[team.id],
      active: choice.folder === active,
    };
  });
}
/** The shared vaults' live channels, as the backend reports them: now and on every change. */
export function watchLive() {
  const set = (status: Record<string, { live?: boolean }>) =>
    useWorkspaceStore.setState(draft => {
      draft.live = Object.fromEntries(Object.entries(status).map(([id, s]) => [id, !!s.live]));
    });
  void backend.sharedVaultsStatus().then(set);
  void backend.onSharedVaults(set);
}
/** The sidebar shows another workspace; the main vault is stored as none. */
export function switchWorkspace(folder: string) {
  const workspace = folder === settings().vault ? "" : folder;
  useNavigationStore.setState(draft => {
    draft.sidebar.workspace = workspace;
  });
  storage.set("workspace", workspace);
}

// The workspace a note path is in: the main vault's are relative, another's absolute ("" for a folder no longer one).
const noteFolder = (path: string) =>
  path.startsWith("/")
    ? (vaultChoices(settings()).find(choice => path.startsWith(choice.folder + "/"))?.folder ?? "")
    : settings().vault;
/** The workspace a selection belongs to: a page's, a conversation's or a terminal session's (by its project); "" for
 *  what every workspace shares (Today, the views, boards, plugins, the orchestrator). */
export function workspaceOf(key: string): string {
  const target = opened(key);
  if (target.kind === "page") return noteFolder(target.target);
  if (target.kind === "chat" && !isOrchKey(key))
    return shownUnder(chatVault(useConversationsStore.getState().chats[key], useWorkspaceStore.getState().snap));
  if (target.kind === "term") {
    const project = terminalOf(key)?.project;
    return project ? shownUnder(projectVault(project)) : settings().vault;
  }
  return "";
}
// what was open in each workspace when the sidebar left it, to come back to; not kept over a restart
const lastOpen: Record<string, string> = {};
// The workspaces stay apart: what is open (a page, a conversation, a project's board, a note in the drawer) belongs to
// the workspace it was opened in. Leaving that workspace puts it away; coming to one opens what was open there, else
// Today when what is open belongs to another. What every workspace shares stays when the new one had nothing open.
function leave(from: string, to: string) {
  const { selected, tool, drawer, panel } = useNavigationStore.getState();
  const owner = tool ? shownUnder(projectVault(tool.project)) : workspaceOf(selected);
  if (owner === from) lastOpen[from] = selected;
  const back = lastOpen[to] ?? "";
  delete lastOpen[to];
  if (owner !== to && back && workspaceOf(back) === to) return void select(back);
  if (owner && owner !== to) return void select(WAIT);
  const note = drawer === "detail" ? panelItem(panel.open) : null;
  if (note?.kind === "note" && noteFolder(note.target) !== to)
    useNavigationStore.setState(draft => {
      draft.drawer = "";
      draft.panel.open = "";
    });
}
/** Keep the workspaces apart whichever way the sidebar changes workspace: the menu, ⌃1 to ⌃9, another Relay window. */
export function keepWorkspacesApart() {
  let shown = activeFolder();
  useNavigationStore.subscribe(() => {
    const now = activeFolder();
    if (now === shown) return;
    const from = shown;
    shown = now;
    leave(from, now);
  });
}
/** ⌃1 to ⌃9: the workspace at that place, if there is one. */
export function switchToNth(n: number) {
  const folder = vaultChoices(settings())[n - 1]?.folder;
  if (folder) switchWorkspace(folder);
}
/** Open a folder as workspace…: a picked vault folder is added to the other vault folders and shown. The backend keeps a
 *  folder by its real path and drops one already here, so the folder shown is the one the save added, else the picked
 *  one when it is a workspace already. */
export async function openFolderAsWorkspace() {
  const picked = await pickVault();
  if (!picked) return;
  const current = settings();
  const before = vaultChoices(current).map(choice => choice.folder);
  if (!before.includes(picked.vault)) {
    const err = await saveMainSettings({ ...current, extraVaults: [...(current.extraVaults ?? []), picked.vault] });
    if (err) return toast(err);
  }
  const added = vaultChoices(settings()).find(choice => !before.includes(choice.folder))?.folder;
  if (added || before.includes(picked.vault)) switchWorkspace(added ?? picked.vault);
  await loadSnapshot();
}
/** New workspace from template… and Workspace settings: the settings window, where workspaces are made and kept. A
 *  shared one is under Machines, the main vault and the folders added under General. */
export const openWorkspaceSettings = (page: "general" | "machines") => backend.openSettingsWindow(page);
