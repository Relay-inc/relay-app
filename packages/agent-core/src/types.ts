// The agent contract on the webview side. The Rust side (src/lib.rs, pending.rs, usage.rs) is the source of
// these shapes; the backend sends them as JSON.
import type { Locales } from "./i18n";

/** What a provider can do; the app hides what is false. See `Caps` in src/lib.rs. */
export type Caps = {
  persistent: boolean; images: boolean; thinking: boolean; permissions: boolean; questions: boolean; subagents: boolean;
  fork: boolean; terminal: boolean; background: boolean; effort: boolean; limits: boolean; title: boolean;
};
export type Choice = { id: string; label: string };
export type Detect = { installed: boolean; bin: string; version?: string | null; loggedIn?: boolean | null; note?: string | null };
/** One provider as `agents_status` reports it: switched on in the settings, detected, its picks. */
export type AgentStatus = { id: string; name: string; on: boolean; caps: Caps; detect: Detect; models: Choice[]; efforts: Choice[]; bin: string; defaultBin: string };

export type Image = { media_type: string; data: string };
export type TurnUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost?: number | null };
/** A permission request or question in the pending folder (pending/<id>.json). */
export type PermissionRequest = { id: string; project: string; provider?: string; kind?: "tool" | "question" | ""; tool_name: string; input: any; tool_use_id?: string; relay?: boolean; at: number };
/** The answer the app writes (pending/<id>.answer.json). A question: allow with `updatedInput.answers`. */
export type Decision = { behavior: "allow"; updatedInput: any } | { behavior: "deny"; message: string };

/** The normalised events, the Tauri event `agent` as `{project, provider, event}`, and history items. */
export type AgentEvent =
  | { type: "session"; id: string }
  | { type: "user"; text: string; images: (Image | null)[] }
  | { type: "text"; text: string; delta: boolean }
  | { type: "thinking"; text: string; delta: boolean }
  | { type: "tool_call"; id: string; name: string; input: any }
  | { type: "tool_result"; id: string; error: boolean }
  | { type: "permission"; request: PermissionRequest }
  | { type: "turn_end"; ok: boolean; error?: string | null; usage?: TurnUsage | null; duration_ms?: number | null }
  | { type: "time"; at: string }       // history only: when the transcript line after it was written
  | { type: "error"; text: string }
  | { type: "stderr"; text: string }   // added by the app: the process's stderr
  | { type: "draft_saved"; folder: string; to: string[]; cc?: string[]; bcc?: string[] } // added by the app: a relay-mail draft (Claude Code only)
  | { type: "commands"; commands: { name: string; description: string; argumentHint?: string }[] } // added by the app: Claude Code's slash commands and skills
  | { type: "exit" };                  // added by the app: the process ended

/** A limit window; `label` is a key in the provider's strings, `name` fills its {name}. */
export type LimitWindow = { id: string; label: string; name?: string | null; pct: number; resets: string | null };
/** `reason` is a key `off.<reason>` in the provider's strings. */
export type Limits = { ok: true; plan?: string | null; windows: LimitWindow[] } | { ok: false; reason: string };
export type Tally = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; cost: number; unpriced: number };
export type Tokens = { today: Tally; week: Tally; vaultToday: Tally; vaultWeek: Tally;
  models: { model: string; today: Tally; week: Tally }[]; sessions: { sid: string; key?: string; today: Tally; week: Tally; last: number }[] };

/** The webview half of a provider: a default export of packages/agent-<id>/src/index.ts, registered in
 * src/agents/index.ts. Everything that runs is on the Rust side; this is how the app shows it. */
export interface AgentProvider<K extends string = string> {
  id: string;
  name: string;
  /** 16×16 SVG body. */
  glyph: string;
  /** Its UI strings in en/nl/fr/de. Keys the app looks up: `limits.loading`, `off.<reason>`, the `label` of each
   * limit window, `tokens.reading` and `set.help` (the settings pane's hint). */
  strings: Locales<K>;
  /** A model id as the usage view names it. */
  modelName?(id: string): string;
  /** Extra settings for Settings › Agents, stored next to `on` and `bin` in `settings.agents.providers.<id>` and
   * given to the backend as `env.opts`. `label` and each choice's `label` are keys in `strings`; the first choice
   * is the default. */
  options?: AgentOption<K>[];
}
export type AgentOption<K extends string = string> = { id: string; label: K; choices: { id: string; label: K }[] };
