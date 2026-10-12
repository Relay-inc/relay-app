import { KEYS, type MapKey, type VaultMap, type VaultStatus } from "../../domain/workspace/types";
import * as backend from "../../infrastructure/backend";
import { t } from "../../shared/i18n";
import { select } from "../navigation/navigation";
import { startChat } from "../conversations/chats";
import { sendMsg } from "../conversations/actions";
import { useWorkspaceStore } from "./store";

// The vault and its mapping, shared by the first-launch screen and the settings window. The backend detects, checks and saves.
/** Pick a folder and detect its mapping (stored overrides on top). Null when cancelled. */
export async function pickVault(): Promise<VaultStatus | null> {
  const folder = await backend.pickFolder();
  return folder ? backend.detectVault(folder) : null;
}
export const checkMapping = (vault: string, map: VaultMap) => backend.checkVault(vault, map);
/** Pick one mapped path, stored relative when it lies in the vault. Returns the new status. */
export async function pickMapped(status: VaultStatus, key: MapKey, map: VaultMap): Promise<VaultStatus> {
  const folder = KEYS.find(([mapKey]) => mapKey === key)![1];
  const picked = await backend.pickPath(folder, status.vault);
  if (!picked) return status;
  const relative = picked.startsWith(status.vault + "/") ? picked.slice(status.vault.length + 1) : picked;
  return checkMapping(status.vault, { ...map, [key]: relative });
}

let setupAsked = false;
/** The welcome screen's Start: the starter vault created in ~/Relay and saved like a picked one. `setup`: the setup
 *  interview starts once the app has loaded (takeSetup), Skip leaves it out. */
export async function startDefaultVault(setup: boolean) {
  const status = await backend.createDefaultVault();
  setupAsked = setup;
  await saveOnboardingVault(status.vault, status.map);
}
/** Whether Start asked for the setup interview; asked once. */
export function takeSetup(): boolean {
  const asked = setupAsked;
  setupAsked = false;
  return asked;
}
/** A general conversation that runs the vault's setup skill (System/skills/setup): the interview that fills in the
 *  profile, contexts, people and projects. From Start, and from Conversation › Set Up Vault. */
export async function runSetup() {
  const key = startChat(null, { provider: "claude", title: t("setup.title"), note: t("setup.note") });
  await select(key);
  return sendMsg(t("setup.prompt"));
}

// ---------- first launch, or a vault that is gone: a welcome screen over the main window until a vault is saved
let saved: (() => void) | null = null;
/** Shows the welcome screen (ui/features/workspace/WorkspaceView.tsx); resolves once a vault is saved. */
export function onboard(start: VaultStatus): Promise<void> {
  useWorkspaceStore.setState(draft => {
    draft.onboarding = start;
  });
  return new Promise(resolve => (saved = resolve));
}
/** The welcome screen's Use button: the vault and its mapping saved, the screen gone. Throws what the backend said. */
export async function saveOnboardingVault(vault: string, map: VaultMap) {
  const current = await backend.getSettings();
  await backend.setSettings({ ...current, vault, vaults: { ...current.vaults, [vault]: map } });
  useWorkspaceStore.setState(draft => {
    draft.onboarding = null;
  });
  saved?.();
  saved = null;
}
