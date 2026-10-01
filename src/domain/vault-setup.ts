import { invoke } from "@tauri-apps/api/core";

// The vault and its mapping: which file or folder the app reads for each piece, relative to the vault.
// Shared by the first-launch screen (src/ui/onboard.ts) and the settings window. The backend detects, checks and saves.
export type VaultMap = Record<MapKey, string>;
export type VaultStatus = { vault: string; map: VaultMap; found: Record<MapKey, boolean>; ok: boolean };
export type MapKey = "workState" | "reminders" | "notes";
// key, is a folder, required: the same list as KEYS in src-tauri/src/vault.rs
export const KEYS: [MapKey, boolean, boolean][] = [
  ["workState", false, true],
  ["reminders", false, false],
  ["notes", true, false],
];

/** Pick a folder and detect its mapping (stored overrides on top). Null when cancelled. */
export async function pickVault(): Promise<VaultStatus | null> {
  const folder = await invoke<string | null>("pick_folder");
  return folder ? invoke<VaultStatus>("detect_vault", { path: folder }) : null;
}

/** Pick one mapped path, stored relative when it lies in the vault. Returns the new status. */
export async function pickMapped(status: VaultStatus, key: MapKey, map: VaultMap): Promise<VaultStatus> {
  const folder = KEYS.find(([mapKey]) => mapKey === key)![1];
  const picked = await invoke<string | null>("pick_path", { folder, start: status.vault });
  if (!picked) return status;
  const relative = picked.startsWith(status.vault + "/") ? picked.slice(status.vault.length + 1) : picked;
  return checkMapping(status.vault, { ...map, [key]: relative });
}
export const checkMapping = (vault: string, map: VaultMap) => invoke<VaultStatus>("check_vault", { path: vault, map });
