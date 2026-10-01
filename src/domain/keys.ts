// Every key the app builds from a string, in one place. Keys stay strings in the state (they go to localStorage and the
// backend), but nothing outside this module parses them: it asks `opened()` or `panelItem()` what a key is.

// ---------- what the middle column shows: a view, a provider's board, a terminal session, or an app conversation
export const VIEW = {
  wait: "__wait",
  reminders: "__rem",
  prs: "__prs",
  mail: "__mail",
  brain: "__brain",
  usage: "__usage",
} as const;
export type ViewKey = (typeof VIEW)[keyof typeof VIEW];
const VIEWS: readonly string[] = Object.values(VIEW);
/** The one board before the providers: an old selection is read as Productive's board. */
export const LEGACY_BOARD = "__board";
const BOARD_PREFIX = "__board:";
const TERM_PREFIX = "t:";

/** A provider's board: `__board:<provider id>`. */
export const boardKey = (provider: string) => `${BOARD_PREFIX}${provider}`;
/** A session open in the terminal, not started by the app: `t:<session id>`. */
export const termKey = (sid: string) => `${TERM_PREFIX}${sid}`;
/** A new app conversation: `c:<time in base 36>`. Older ones are `general:<id>` or a project's name. */
export const newChatKey = () => `c:${Date.now().toString(36)}`;
/** When an app conversation was made, from its key; 0 when the key does not say. */
export function chatTime(key: string) {
  const i = key.indexOf(":");
  return i < 0 ? 0 : parseInt(key.slice(i + 1), 36) || 0;
}
export const isLegacyGeneral = (key: string) => key.startsWith("general:");

export type Opened =
  | { kind: "view"; view: ViewKey }
  | { kind: "board"; provider: string }
  | { kind: "term"; sid: string }
  | { kind: "chat"; key: string };
/** What a selection key opens. */
export function opened(key: string): Opened {
  if (VIEWS.includes(key)) return { kind: "view", view: key as ViewKey };
  if (key.startsWith(BOARD_PREFIX)) return { kind: "board", provider: key.slice(BOARD_PREFIX.length) };
  if (key.startsWith(TERM_PREFIX)) return { kind: "term", sid: key.slice(TERM_PREFIX.length) };
  return { kind: "chat", key };
}
export const isTerminal = (key: string) => key.startsWith(TERM_PREFIX);
/** The session id of a terminal key, "" for any other key. */
export const termSid = (key: string) => (isTerminal(key) ? key.slice(TERM_PREFIX.length) : "");

// ---------- what the right panel shows in detail: a PR, a mail, a vault note or a tracker card
export type PanelItem =
  | { kind: "pr"; repo: string; number: number }
  | { kind: "mail"; account: string; id: string }
  | { kind: "note"; target: string }
  | { kind: "card"; provider: string; id: string };
/** A PR: `owner/repo#12`. */
export const prKey = (repo: string, number: number | string) => `${repo}#${number}`;
/** A mail: `mail:<account>:<id>` (an email address has no colon, so the last one splits). */
export const mailKey = (m: { account: string; id: string }) => `mail:${m.account}:${m.id}`;
/** A vault note: `note:<path or name>`. */
export const noteKey = (target: string) => `note:${target}`;
/** A card in a provider's tracker: `card:<provider>:<id>`. */
export const cardKey = (provider: string, id: string) => `card:${provider}:${id}`;

/** What a panel key shows; null for "" (the panel's tabs). */
export function panelItem(key: string): PanelItem | null {
  if (!key) return null;
  if (key.startsWith("mail:")) {
    const i = key.lastIndexOf(":");
    return { kind: "mail", account: key.slice("mail:".length, i), id: key.slice(i + 1) };
  }
  if (key.startsWith("note:")) return { kind: "note", target: key.slice("note:".length) };
  const card = /^card:([^:]+):(.+)$/.exec(key);
  if (card) return { kind: "card", provider: card[1], id: card[2] };
  const i = key.lastIndexOf("#");
  return { kind: "pr", repo: key.slice(0, i), number: Number(key.slice(i + 1)) };
}
export const isMailKey = (key: string) => panelItem(key)?.kind === "mail";
