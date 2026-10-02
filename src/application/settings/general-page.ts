import { t } from "../../shared/i18n";
import type { Theme } from "../../domain/settings/types";
import type { MapKey, VaultMap, VaultStatus } from "../../domain/workspace/types";
import { applyTheme } from "../../infrastructure/window";
import { pickVault, pickMapped, checkMapping } from "../workspace/vault-setup";
import { initLanguage } from "./settings";
import { save, showTitle } from "./window";
import { useSettingsStore } from "./store";

// Settings › General: the vault folder with its mapping, and the interface (language, colour scheme, favicons).
const st = () => useSettingsStore.getState();
const set = useSettingsStore.setState;
const current = () => st().settings;
const setStatus = (vaultStatus: VaultStatus) =>
  set(draft => {
    draft.vaultStatus = vaultStatus;
  });

export async function pickVaultFolder() {
  const status = st().vaultStatus!;
  const picked = await pickVault();
  set(draft => {
    draft.vaultStatus = { ...(picked ?? status) };
    draft.message = null;
  });
}
export async function pickMappedFile(key: MapKey, map: VaultMap) {
  setStatus(await pickMapped(st().vaultStatus!, key, map));
}
export async function checkMap(map: VaultMap) {
  setStatus(await checkMapping(st().vaultStatus!.vault, map));
}
export function saveFolders(map: VaultMap) {
  const vault = st().vaultStatus!.vault;
  return save({ ...current(), vault, vaults: { ...current().vaults, [vault]: map } }, t("set.saved"));
}
export function saveFavicons(on: boolean) {
  const favicons = { last: "", tried: {}, ...current().favicons, on };
  return save({ ...current(), favicons });
}
export async function changeLanguage(language: string) {
  await save({ ...current(), language });
  await initLanguage();
  showTitle();
}
export async function changeTheme(theme: Theme) {
  applyTheme(theme);
  await save({ ...current(), theme });
}
