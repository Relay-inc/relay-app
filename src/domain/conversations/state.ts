import type { Key } from "../../shared/i18n";
import type { MachineChoice } from "../settings/types";
import type { RepoWork } from "../settings/machines";
import type { SlashCommand } from "./commands";
import type { AgentSession, Chat, ContextUse, Img, Item, Pending, Retry, RouteChoice, SessionOf, Sub } from "./types";

/** A translation, handed to the rules that write text into the state (notes, titles). */
export type Translate = (key: Key, params?: Record<string, string | number>) => string;

/** Everything the app knows about its conversations and the sessions next to them. */
export type ConversationsState = {
  chats: Record<string, Chat>;
  messages: Record<string, Item[]>; // per conversation, from the transcript and the live events
  context: Record<string, ContextUse>; // Claude Code's: what the latest message filled of the model's window
  status: Record<string, "idle" | "busy">;
  queued: Record<string, number>; // messages sent but not answered yet: one turn end each, or one for all a turn took up
  // Claude Code's: messages sent that it has not taken up yet, shown below the conversation until it does
  waiting: Record<string, Item[]>;
  taken: Record<string, number>; // the messages the running turn took up, its turn end answers them all
  unseen: Set<string>;
  dismissed: Set<string>; // "is this about project X?" answered no
  closing: Set<string>; // conversations being closed: the process stops and its worktrees go, which can take a while
  routeChoice: RouteChoice | null;
  pendingList: Pending[];
  pendingAt: Record<string, number>; // when this page first saw a pending request (the backend gives no time), by id
  pendingPolled: boolean; // the cards already waiting at start get no banner
  agentsList: AgentSession[]; // the providers' sessions (`agents`), terminal and background
  hidden: string[];
  forked: string[]; // terminal sessions continued in the app, no longer listed
  appSids: string[];
  sidOf: SessionOf; // app conversation key: its provider and session id
  machines: Record<string, { machine: string; id: string; cwd: string }>; // conversation key: the machine it runs on (`chat_machines`)
  machineList: MachineChoice[]; // the composer's machine pick, `machines_list`
  // a move back to this Mac that would leave repo work on the machine: where it was going, asked under the log
  repoWork: Record<string, RepoWork & { to: string; busy?: boolean }>;
  // app conversations whose turn runs in a process this page gets no events from (it outlived an app restart):
  // the transcript offset read so far. The page follows the transcript until the provider's sessions say the turn ended
  outside: Record<string, number>;
  // when that turn's prompt came in and the last line after it, from the transcript timestamps, for "Klaar · duur"
  outsideAt: Record<string, { from: number; to: number }>;
  termOffset: Record<string, number>;
  subs: Record<string, Sub[]>; // per conversation key, polled every 2 s
  subsOpen: Set<string>; // conversations whose finished agents are unfolded
  // the slash commands and skills per provider, for the current vault: asked at the start, updated when an agent starts
  commands: Record<string, SlashCommand[]>;
  retries: Record<string, Retry>; // conversations waiting for a limit to reset, by key (retry.rs)
};

/** The state on a fresh start, with what was stored. */
export const initialConversations = (stored: {
  chats: Record<string, Chat>;
  hidden: string[];
  forked: string[];
}): ConversationsState => ({
  ...stored,
  messages: {},
  context: {},
  status: {},
  queued: {},
  waiting: {},
  taken: {},
  unseen: new Set(),
  dismissed: new Set(),
  closing: new Set(),
  commands: {},
  routeChoice: null,
  pendingList: [],
  pendingAt: {},
  pendingPolled: false,
  agentsList: [],
  appSids: [],
  sidOf: {},
  machines: {},
  machineList: [],
  repoWork: {},
  outside: {},
  outsideAt: {},
  termOffset: {},
  subs: {},
  subsOpen: new Set(),
  retries: {},
});

/** The composer's drafts, kept apart from the conversations so a keystroke only changes this small state: what is
 *  typed but not sent per conversation (survives switching and closing the app), and the images waiting for the
 *  next send with the files attached by their path (`files`), and where a conversation without a session yet is to
 *  run (`machinePick`). */
export type DraftsState = {
  typed: Record<string, string>;
  attached: Img[];
  files: string[];
  machine: Record<string, string>;
};
