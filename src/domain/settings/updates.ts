import { newerVersion } from "./machines.ts";

// Settings › Updates: Relay's own releases (src-tauri/src/updater.rs) and the agent CLIs.

export type Release = { version: string; notes: string; date: string | null };
/** The last check: this Relay's version, when it ran (ms, null before the first), the newer version it found, the
 *  releases on GitHub newest first and why the check failed. */
export type UpdatesStatus = {
  version: string;
  checked: number | null;
  latest: string | null;
  releases: Release[];
  error: string | null;
};
/** The download of an update, in bytes; `total` null when the server does not say. */
export type UpdateProgress = { done: number; total: number | null };
/** An agent CLI: installed version (null: not installed, "": it does not say), npm's latest (null: unknown) and the
 *  command Relay updates it with (null: Relay cannot tell how it was installed). */
export type AgentUpdate = {
  id: string;
  name: string;
  on: boolean;
  installed: string | null;
  latest: string | null;
  command: string | null;
};

/** The releases after this version, newest first: what installing the update brings. */
export const releasesSince = (status: UpdatesStatus) =>
  status.releases.filter(r => newerVersion(r.version, status.version));

/** An installed agent npm has a newer version of. */
export const agentBehind = (a: AgentUpdate) => !!a.installed && !!a.latest && newerVersion(a.latest, a.installed);

/** Where each agent says what changed. */
export const AGENT_CHANGELOG: Record<string, string> = {
  claude: "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md",
  codex: "https://github.com/openai/codex/releases",
  opencode: "https://github.com/sst/opencode/releases",
  pi: "https://github.com/earendil-works/pi/releases",
};
