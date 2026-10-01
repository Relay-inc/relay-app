import type { BoardRef } from "../../domain/providers";
import type { VaultMap } from "../../domain/vault-setup";

// the shapes the backend's settings take (src-tauri settings)
export type MailAcct = { email: string; keychain_service: string; keychain_account: string };
export type MailCfg = { on: boolean; account: string; accounts: MailAcct[] };
export type Settings = { vault: string; vaults?: Record<string, VaultMap>; projects: Record<string, { icon?: string; img?: string; label?: string }>; overrides: Record<string, string | null>;
  integrations: Record<string, Record<string, any>>; boards: Record<string, BoardRef>; github: { on: boolean; owners: string }; mail: MailCfg; language?: string;
  favicons?: { on: boolean; last: string; tried: Record<string, string> };
  agents: { default: string; providers: Record<string, { on: boolean; bin: string; [opt: string]: unknown }> } };
/** A template to render, or text. */
export type Tpl = unknown;
export type Msg = { text: string; ok: boolean };
/** What a page asks its container to save: the settings, and the message to show when it worked. */
export type SaveSettings = { settings: Settings; done: string };
