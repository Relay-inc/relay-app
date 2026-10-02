import type { Reminder } from "../reminders/types";

// The vault as snapshot.py reads it (projects with their open items and status, reminders, the terminal sessions),
// the project icons from its .relay/config.json, and the vault mapping.
/** A project from the vault index (work-state), with what snapshot.py read from its note. */
export type Project = {
  name: string;
  context: string;
  state: string;
  last: string; // when the work-state row was last touched
  summary: string;
  open: number | null; // the number of open items, null without an Open section
  open_items: string[];
  stand: string | null; // the note's status section, markdown
  aliases: string[];
};
/** A Claude Code session in the transcripts, with the project snapshot.py guessed from what was asked in it. */
export type SessionItem = { sessionId: string; project: string | null; last_user: string; last_at: string };
/** One read of the vault (snapshot.py, plus the reminders and the vault mapping from lib.rs). */
export type Snapshot = {
  today?: string;
  projects: Project[];
  sessions: { error?: string | null; items: SessionItem[] };
  reminders: Reminder[];
  vault?: VaultStatus;
};
export const EMPTY_SNAPSHOT: Snapshot = { projects: [], reminders: [], sessions: { items: [] } };

// Project icons live in the vault's .relay/config.json (src-tauri/src/relay_config.rs, `icons`): an image file in
// .relay/icons/, an emoji, a website whose favicon the app fetches, or "" for none. Shared by both windows.
/** One project's icon: the raw value from the config, and what to show (`img` a data url, or `icon` an emoji). */
export type ProjectIcon = { value: string; img?: string | null; icon?: string };
export type IconKind = "img" | "emoji" | "site" | "none" | "reset";

// The vault and its mapping: which file or folder the app reads for each piece, relative to the vault.
// Shared by the first-launch screen and the settings window. The backend detects, checks and saves.
export type MapKey = "workState" | "reminders" | "notes";
export type VaultMap = Record<MapKey, string>;
export type VaultStatus = { vault: string; map: VaultMap; found: Record<MapKey, boolean>; ok: boolean };
// key, is a folder, required: the same list as KEYS in src-tauri/src/vault.rs
export const KEYS: [MapKey, boolean, boolean][] = [
  ["workState", false, true],
  ["reminders", false, false],
  ["notes", true, false],
];
/** The vault's notes as vault_notes lists them: the vault folder and every note path in it. */
export type VaultNotes = { root: string; notes: string[] };
