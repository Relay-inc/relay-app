import type { Key } from "../../shared/i18n";
import type { SlashCommand } from "./commands";
import type { AgentSession, Chat, Img, Item, Pending, RouteChoice, SessionOf, Sub } from "./types";

/** A translation, handed to the rules that write text into the state (notes, titles). */
export type Translate = (key: Key, params?: Record<string, string | number>) => string;

/** Everything the app knows about its conversations and the sessions next to them. */
export type ConversationsState = {
  chats: Record<string, Chat>;
  messages: Record<string, Item[]>; // per conversation, from the transcript and the live events
  status: Record<string, "idle" | "busy">;
  queued: Record<string, number>; // messages sent but not answered yet: one turn end each
  unseen: Set<string>;
  dismissed: Set<string>; // "is this about project X?" answered no
  routeChoice: RouteChoice | null;
  pendingList: Pending[];
  pendingPolled: boolean; // the cards already waiting at start get no banner
  agentsList: AgentSession[]; // the providers' sessions (`agents`), terminal and background
  hidden: string[];
  forked: string[]; // terminal sessions continued in the app, no longer listed
  appSids: string[];
  sidOf: SessionOf; // app conversation key: its provider and session id
  // app conversations whose turn runs in a process this page gets no events from (it outlived an app restart):
  // the transcript offset read so far. The page follows the transcript until the provider's sessions say the turn ended
  outside: Record<string, number>;
  // when that turn's prompt came in and the last line after it, from the transcript timestamps, for "Klaar · duur"
  outsideAt: Record<string, { from: number; to: number }>;
  termOffset: Record<string, number>;
  subs: Record<string, Sub[]>; // per conversation key, polled every 2 s
  subsOpen: Set<string>; // conversations whose finished agents are unfolded
  subLog: Record<string, string[]>; // agent id: its last messages, while unfolded
  // Claude Code's slash commands and skills, from its last start: kept, so the composer completes before one runs
  commands: SlashCommand[];
};

/** The state on a fresh start, with what was stored. */
export const initialConversations = (stored: {
  chats: Record<string, Chat>;
  hidden: string[];
  forked: string[];
  commands: SlashCommand[];
}): ConversationsState => ({
  ...stored,
  messages: {},
  status: {},
  queued: {},
  unseen: new Set(),
  dismissed: new Set(),
  routeChoice: null,
  pendingList: [],
  pendingPolled: false,
  agentsList: [],
  appSids: [],
  sidOf: {},
  outside: {},
  outsideAt: {},
  termOffset: {},
  subs: {},
  subsOpen: new Set(),
  subLog: {},
});

/** The composer's drafts, kept apart from the conversations so a keystroke only changes this small state: what is
 *  typed but not sent per conversation (survives switching and closing the app), and the images waiting for the
 *  next send. */
export type DraftsState = { typed: Record<string, string>; attached: Img[] };
