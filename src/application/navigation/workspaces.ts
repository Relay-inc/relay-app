import { activeWorkspace, vaultChoices } from "../../domain/conversations/rules";
import * as backend from "../../infrastructure/backend";
import { saveMainSettings, settings } from "../settings/settings";
import { useWorkspaceStore } from "../workspace/store";
import { loadSnapshot, vaultName } from "../workspace/vault";
import { pickVault } from "../workspace/vault-setup";
import { setSidebar } from "./sidebar";
import { toast } from "./navigation";

// The workspaces: every vault here (the main one, the folders added, the shared ones), one of them shown in the sidebar.
/** A workspace in the footer's menu: `notes` counted from the notes index, `team` for one shared on a relay-server. */
export type Workspace = {
  folder: string;
  name: string;
  initials: string;
  notes: number;
  team: boolean;
  active: boolean;
};

export const activeFolder = () => activeWorkspace(settings());
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
  return vaultChoices(settings()).map(choice => {
    const name = vaultName(choice.folder);
    return {
      folder: choice.folder,
      name,
      initials: initials(name),
      notes: notesIn(choice.folder, choice.main),
      team: shared.some(vault => vault.folder === choice.folder),
      active: choice.folder === active,
    };
  });
}
/** The sidebar shows another workspace; the main vault is stored as none. */
export const switchWorkspace = (folder: string) =>
  setSidebar({ workspace: folder === settings().vault ? undefined : folder });
/** ⌃1 to ⌃9: the workspace at that place, if there is one. */
export function switchToNth(n: number) {
  const folder = vaultChoices(settings())[n - 1]?.folder;
  if (folder) switchWorkspace(folder);
}
/** Open a folder as workspace…: a picked vault folder is added to the other vault folders and shown. */
export async function openFolderAsWorkspace() {
  const picked = await pickVault();
  if (!picked) return;
  const current = settings();
  if (!vaultChoices(current).some(choice => choice.folder === picked.vault)) {
    const err = await saveMainSettings({ ...current, extraVaults: [...(current.extraVaults ?? []), picked.vault] });
    if (err) return toast(err);
  }
  // the backend keeps a folder by its real path: the one it just added is the last
  const saved = settings();
  switchWorkspace(
    vaultChoices(saved).some(choice => choice.folder === picked.vault)
      ? picked.vault
      : (saved.extraVaults?.slice(-1)[0] ?? saved.vault),
  );
  await loadSnapshot();
}
/** New workspace from template… and Workspace settings: the settings window, where workspaces are made and kept. A
 *  shared one is under Machines, the main vault and the folders added under General. */
export const openWorkspaceSettings = (page: "general" | "machines") => backend.openSettingsWindow(page);
