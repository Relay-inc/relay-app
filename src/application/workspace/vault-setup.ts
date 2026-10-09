import { KEYS, type MapKey, type VaultMap, type VaultStatus } from "../../domain/workspace/types";
import * as backend from "../../infrastructure/backend";
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

/** The welcome screen's Start: the starter vault created in ~/Relay and saved like a picked one. */
export async function startDefaultVault() {
  const status = await backend.createDefaultVault();
  await saveOnboardingVault(status.vault, status.map);
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
