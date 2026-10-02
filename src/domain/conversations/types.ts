// The conversations: the app's own (with their messages, state and drafts), the terminal sessions next to them, and
// what is waiting for the user (permission cards, questions, background sessions that block).

// A conversation has its own key and hangs under a project (or under Algemeen when project is null).
// The key never changes, so moving a conversation to a project is only a label: the running
// process and its session are untouched. Metadata is kept locally, the session lives in the agent's CLI.
/** What a tool call carries, as far as the app reads it (the tool line, the permission card, the project guess). */
export type ToolInput = {
  file_path?: string;
  content?: string;
  command?: string;
  pattern?: string;
  query?: string;
  url?: string;
  description?: string;
  subagent_type?: string;
  skill?: string;
  questions?: Question[];
  [other: string]: unknown;
};
/** A question an agent asks, with its options (AskUserQuestion). */
export type Question = { question: string; multiSelect?: boolean; options?: { label: string; description?: string }[] };
/** A session as the agent providers report it (`agents`): in the terminal or in the background. */
export type AgentSession = {
  id: string;
  sessionId: string;
  provider: string;
  kind: string; // "interactive" | "background"
  status: string; // "busy" | "idle"
  state?: string; // a background session: "blocked" | "done" | …
  name?: string;
  startedAt?: string;
};
/** One line of a conversation. A tool line keeps the call, so it is drawn (and translated) when shown. */
export type Item = {
  kind: "me" | "ai" | "tool" | "err" | "note" | "done" | "allowed" | "denied";
  text: string;
  id?: string;
  state?: "run" | "ok" | "err";
  path?: string;
  imgs?: string[];
  tool?: { name: string; input: ToolInput };
  /** a tool call: when it started and when its result came (ms), for the duration of a group of steps */
  at?: number;
  end?: number;
};
export type Chat = {
  key: string;
  project: string | null;
  title: string;
  at: number;
  draft?: boolean;
  fork?: string;
  closed?: number;
  mail?: string; // what goes in front of the first message: a mail or a card to read
  provider?: string; // its agent, set at the first message
  fromMail?: boolean; /* about a mail or has read mail */
  told?: string; // the project the agent was last told this conversation is about
};
/** An image waiting to be sent: its media type, base64 data, and a blob url to show it. */
export type Img = { mt: string; data: string; url: string };
/** A subagent a session spawned (Agent tool, background agents). */
export type Sub = {
  id: string;
  description: string;
  agentType?: string;
  model?: string;
  running: boolean;
  started_at: string;
  last_at: string;
  tool?: string;
  input?: ToolInput;
  text?: string;
};
/** A session open in the terminal (not started by the app), with the project snapshot.rs read from its transcript. */
export type TerminalSession = {
  key: string;
  sid: string;
  id: string;
  project: string | null;
  title: string;
  kind: string;
  status: string;
  state?: string;
  mtime: number;
};
/** A permission request or question waiting in pending/ (packages/agent-core PermissionRequest). */
export type Pending = { id: string; project: string; kind?: string; tool_name: string; input: ToolInput };
/** A transcript read from an offset: its events and where the next read starts. */
export type Transcript<E> = { items: E[]; next: number };
/** The app conversation key's provider and session id (app_sessions). */
export type SessionOf = Record<string, { provider: string; sid: string }>;
/** The answer a card gives: allow or deny a permission, or a question's picked labels and typed "other" per question. */
export type CardChoice = "allow" | "deny" | { picked: string[][]; other: string[] };
export type RouteChoice = { key: string; text: string; hits: string[] };
