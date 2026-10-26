import { t } from "../../shared/i18n";
import { PROVIDERS } from "../../shared/plugins";
import type { Accent, SidebarCfg, TerminalApp, Theme } from "../../domain/settings/types";
import type { MapKey, VaultMap, VaultStatus } from "../../domain/workspace/types";
import { arranged, isHidden, withHidden } from "../../domain/navigation/sidebar-order";
import { viewItems } from "../../domain/navigation/sidebar-views";
import { shownPlugins } from "../../domain/plugins/rules";
import { applyTheme } from "../../infrastructure/window";
import { pickVault, pickMapped, checkMapping } from "../workspace/vault-setup";
import { initLanguage } from "./settings";
import { save, showTitle } from "./window";
import { useSettingsStore } from "./store";

// Settings › General: the vault folder with its mapping, and the interface (language, colour scheme, accent, favicons,
// terminal), and the views on top of the sidebar.
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
/** Add a shared vault (a folder with its own work-state): its projects show in the sidebar next to the main vault's. */
export async function addExtraVault() {
  const picked = await pickVault();
  if (picked)
    await save({ ...current(), extraVaults: [...(current().extraVaults ?? []), picked.vault] }, t("set.saved"));
}
export const removeExtraVault = (vault: string) =>
  save({ ...current(), extraVaults: (current().extraVaults ?? []).filter(v => v !== vault) });
/** A shared vault syncing with the team, or not; switched on, the backend runs a round right away. */
export function syncVault(vault: string, on: boolean) {
  const others = (current().syncVaults ?? []).filter(v => v !== vault);
  return save({ ...current(), syncVaults: on ? [...others, vault] : others });
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
  await applyTheme(theme, current().accent);
  await save({ ...current(), theme });
}
export async function changeAccent(accent: Accent) {
  await applyTheme(current().theme, accent);
  await save({ ...current(), accent });
}
export const saveTerminal = (terminal: TerminalApp) => save({ ...current(), terminal });
export const saveKeepAwake = (keepAwake: boolean) => save({ ...current(), keepAwake });
export const saveAutoRetry = (autoRetry: boolean) => save({ ...current(), autoRetry });
export const saveTimeFromSessions = (timeFromSessions: boolean) => save({ ...current(), timeFromSessions });
export const saveGitDrawer = (gitDrawer: boolean) => save({ ...current(), gitDrawer });
export const saveWorkerCrabs = (workerCrabs: boolean) => save({ ...current(), workerCrabs });
export const saveCaptureOnClose = (captureOnClose: boolean) => save({ ...current(), captureOnClose });
/** The sidebar's views: the layout, the order, the ones switched off (each patch keeps the rest). */
export const saveSidebar = (patch: SidebarCfg) => save({ ...current(), sidebar: { ...current().sidebar, ...patch } });
/** One view on top of the sidebar switched on or off. */
export const showView = (key: string, on: boolean) => saveSidebar({ hidden: withHidden(key, !on, current().sidebar) });
/** The sidebar's views in the order of the sidebar, each with whether it shows: the boards switched on, pull
 *  requests and mail when they are on. */
export function sidebarViews() {
  const settings = current();
  const cfg = settings.sidebar ?? {};
  const boards = PROVIDERS.filter(board => settings.integrations[board.id]?.on);
  const plugins = shownPlugins(settings.plugins);
  return arranged(viewItems(boards, !!settings.github?.on, !!settings.mail?.on, t, plugins), cfg).map(item => ({
    ...item,
    shown: !isHidden(item.key, cfg),
  }));
}
