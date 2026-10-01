import { invoke } from "@tauri-apps/api/core";
import type { BoardRef } from "./providers";

// The app's settings as the backend keeps them (settings.json): the main window reads them, the settings window edits them.
export type Settings = { vault: string; projects: Record<string, { icon?: string; img?: string; label?: string }>; overrides: Record<string, string | null>;
  integrations: Record<string, any>; boards: Record<string, BoardRef>; github: { on: boolean; owners: string }; mail: { on: boolean; account: string; accounts: { email: string; keychain_service: string; keychain_account: string }[] }; language?: string;
  favicons?: { on: boolean; last?: string; tried: Record<string, string> } };

export const config = {
  value: { vault: "", projects: {}, overrides: {}, integrations: {}, boards: {}, github: { on: false, owners: "" }, mail: { on: false, account: "", accounts: [] } } as Settings,
  msg: "", // why the last save failed
};
export const ghOn = () => !!config.value.github?.on;
export const mailOn = () => !!config.value.mail?.on;

export async function saveSettings(next: Settings) {
  try { config.value = await invoke<Settings>("set_settings", { settings: next }); config.msg = ""; return true; }
  catch (e) { config.msg = String(e); return false; }
}
