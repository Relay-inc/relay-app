import type { AgentEvent } from "../agents/types";
import type { ConversationsState, Translate } from "./state";
import type { ContextUse, Item, ToolInput } from "./types";
import { formatDuration, ktokens, lastAi } from "./rules.ts";
import { FILE_TOOLS } from "./changes.ts";
import { cleanCommands } from "./commands.ts";
import { splitFiles } from "./files.ts";
import { isRelayTurn } from "../orchestrator/rules.ts";

// The agent processes' events (normalised by their provider, packages/agent-core) as a reducer over the conversations
// state, and the transcripts behind a conversation as items. Pure: what needs the outside (a banner, saving, a vault
// read) comes back as an effect for application/conversations to run.

type EventOf<Type extends AgentEvent["type"]> = Extract<AgentEvent, { type: Type }>;

export const IMG_OK = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** What the reducer reads from outside the state. */
export type EventEnv = {
  t: Translate;
  selected: string;
  now: number;
  /** an image a tool returned as something to show (a blob url) */
  imageUrl: (mediaType: string, data: string) => string;
};
/** What the reducer asks for after an event. */
export type Effect = { kind: "save-chats" } | { kind: "notify"; key: string; body: string } | { kind: "snapshot" };

export function push(state: Pick<ConversationsState, "messages">, key: string, item: Item) {
  (state.messages[key] ||= []).push(item);
}
// assistant text or thinking: a whole block, or a delta appended to the block before it
function pushText(items: Item[], text: string, delta: boolean, kind: "ai" | "thinking" = "ai") {
  const last = items[items.length - 1];
  if (delta && last?.kind === kind) last.text += text;
  else items.push({ kind, text });
}
const toolItem = (id: string, name: string, input: ToolInput, state: Item["state"], at: number): Item => ({
  kind: "tool",
  id,
  text: name,
  tool: { name, input },
  state,
  path: input?.file_path,
  ...(at ? { at } : {}),
});
// "Klaar" with the turn's duration when it is known
export const doneText = (seconds: number, t: Translate) =>
  seconds ? t("work.doneIn", { d: formatDuration(seconds) }) : t("work.done");

/** Claude Code's window until a turn's result names the model's (the 1M models say so there). */
export const DEFAULT_WINDOW = 200_000;
/** The window of the 1M models: the only one larger than the default. */
export const LARGE_WINDOW = 1_000_000;
/** The context after an event: tokens in use and window as they come, a compaction leaves what it kept, a reset none. */
export function applyContext(context: ContextUse | undefined, event: AgentEvent): ContextUse | undefined {
  const window = context?.window ?? DEFAULT_WINDOW;
  if (event.type === "context") return { used: event.used ?? context?.used ?? 0, window: event.window ?? window };
  if (event.type === "compacted") return event.post_tokens == null ? undefined : { used: event.post_tokens, window };
  return event.type === "reset" ? undefined : context;
}
const compactedText = (e: EventOf<"compacted">, t: Translate) =>
  t(e.trigger === "auto" ? "compact.auto" : "compact.done") +
  (e.pre_tokens != null && e.post_tokens != null ? ` · ${ktokens(e.pre_tokens)} → ${ktokens(e.post_tokens)}` : "");
// the "compacting" line ends with the boundary; a turn that ends without one (it failed) leaves it as failed
function endCompaction(items: Item[] | undefined, state: "ok" | "err", text?: string) {
  const item = [...(items || [])].reverse().find(x => x.kind === "compact" && x.state === "run");
  if (item) Object.assign(item, { state, ...(text ? { text } : {}) });
  return !!item;
}

const ACTIVITY: AgentEvent["type"][] = ["working", "text", "thinking", "tool_call"];

/** One event of `provider`'s agent process applied to `state` (an Immer draft, changed in place). Returns the effects
 *  to run; an event the app does not show changes nothing and returns []. */
export function applyAgentEvent(
  state: ConversationsState,
  key: string,
  event: AgentEvent,
  env: EventEnv,
  provider = "claude",
): Effect[] {
  // activity can arrive after a reload before the first status poll: it shows the turn, without counting another one
  if (ACTIVITY.includes(event.type)) {
    state.status[key] = "busy";
    state.queued[key] = Math.max(1, state.queued[key] || 0);
    // a turn at work that echoed nothing yet answers the oldest waiting message (a slash command never echoes), or
    // something Claude started itself (a background task done): a message sent from now on waits for its echo
    // ponytail: a turn Claude starts itself while a message waits takes that message too early
    if (!state.taken[key]) {
      takeWaiting(state, key);
      state.taken[key] ||= 1;
    }
  }
  switch (event.type) {
    case "picked":
      // a turn Relay wrote itself (orchestrator) is in the conversation already
      if (!isRelayTurn(event.text)) takeWaiting(state, key);
      else state.taken[key] = (state.taken[key] || 0) + 1;
      return [];
    case "commands":
      state.commands[provider] = cleanCommands(event.commands);
      return [];
    case "draft_saved":
      push(state, key, { kind: "note", text: draftNote(event, env.t) });
      return [];
    case "reset":
      state.messages[key] = [];
      delete state.context[key];
      return [];
    case "compacting":
      push(state, key, { kind: "compact", text: env.t("compact.running"), state: "run" });
      return [];
    case "compacted": {
      const text = compactedText(event, env.t);
      if (!endCompaction(state.messages[key], "ok", text)) push(state, key, { kind: "compact", text, state: "ok" });
      return setContext(state, key, event);
    }
    case "context":
      return setContext(state, key, event);
    case "text":
      pushText((state.messages[key] ||= []), event.text, event.delta);
      return [];
    case "thinking":
      pushText((state.messages[key] ||= []), event.text, event.delta, "thinking");
      return [];
    case "tool_call":
      return onToolCall(state, key, event, env.now);
    case "tool_result": {
      const item = state.messages[key]?.find(x => x.id === event.id);
      if (item) {
        item.state = event.error ? "err" : "ok";
        if (item.at) item.end = env.now;
      }
      return [];
    }
    case "patch": {
      const item = state.messages[key]?.find(x => x.id === event.id);
      if (item) item.hunks = event.hunks;
      return [];
    }
    case "tool_images": {
      const item = state.messages[key]?.find(x => x.id === event.id);
      if (item) item.imgs = toolImgs(event, env.imageUrl);
      return [];
    }
    case "turn_end":
      return onTurnEnd(state, key, event, env);
    case "error":
    case "stderr":
      if (event.text.trim()) push(state, key, { kind: "err", text: event.text.slice(0, 2000) });
      return [];
    case "exit":
      return onProcessExit(state, key, env);
    default:
      return [];
  }
}

function setContext(state: ConversationsState, key: string, event: AgentEvent): Effect[] {
  const next = applyContext(state.context[key], event);
  if (next) state.context[key] = next;
  else delete state.context[key];
  // the window a turn reported stays with the conversation, for when its transcript is read again
  const chat = state.chats[key];
  if (event.type !== "context" || !event.window || !chat || chat.window === event.window) return [];
  chat.window = event.window;
  return [{ kind: "save-chats" }];
}

// the real recipients, independent of what the agent writes about it
function draftNote(saved: EventOf<"draft_saved">, t: Translate) {
  const cc = saved.cc || [];
  const bcc = saved.bcc || [];
  let text = t("note.draftSaved", { folder: saved.folder, to: (saved.to || []).join(", ") });
  if (cc.length) text += t("note.draftCc", { cc: cc.join(", ") });
  if (bcc.length) text += t("note.draftBcc", { bcc: bcc.join(", ") });
  return text;
}

function onToolCall(state: ConversationsState, key: string, call: EventOf<"tool_call">, now: number): Effect[] {
  push(state, key, toolItem(call.id, call.name, call.input, "run", now));
  // a chat that touched mail stays marked: every later spawn of it stays on this Mac
  const conversation = state.chats[key];
  if (call.name.startsWith("mcp__relay-mail__") && conversation && !conversation.fromMail) {
    conversation.fromMail = true;
    return [{ kind: "save-chats" }];
  }
  return [];
}

/** The oldest message waiting for Claude moves into the conversation, where Claude took it up. */
export function takeWaiting(state: Pick<ConversationsState, "messages" | "waiting" | "taken">, key: string) {
  const item = state.waiting[key]?.shift();
  if (!item) return;
  push(state, key, item);
  state.taken[key] = (state.taken[key] || 0) + 1;
}
/** Every waiting message into the conversation: the process that would take them up is gone. */
export function releaseWaiting(state: Pick<ConversationsState, "messages" | "waiting" | "taken">, key: string) {
  for (const item of state.waiting[key] || []) push(state, key, item);
  delete state.waiting[key];
  delete state.taken[key];
}

// a turn end answers every message its turn took up, at least the one that started it
function finishTurnInQueue(state: ConversationsState, key: string) {
  if (!state.taken[key]) takeWaiting(state, key);
  state.queued[key] = Math.max(0, (state.queued[key] || 1) - Math.max(1, state.taken[key] || 0));
  delete state.taken[key];
  state.status[key] = state.queued[key] ? "busy" : "idle";
}

/** What a turn did: its file edits, failed tools and agents, counted from the items since the last end of a turn. */
// ponytail: a failed turn pushes no "done", so the next receipt counts it too
export function receiptOf(items: Item[] | undefined, cost?: number | null): Item["receipt"] {
  const all = items || [];
  let from = all.length;
  while (from > 0 && all[from - 1].kind !== "done") from--;
  const receipt = { edits: 0, errors: 0, agents: 0, ...(cost ? { cost } : {}) };
  for (const x of all.slice(from)) {
    if (x.kind !== "tool" || !x.tool) continue;
    if (x.state === "err") receipt.errors++;
    else if (FILE_TOOLS.has(x.tool.name)) receipt.edits++;
    if (x.tool.name === "Agent" || x.tool.name === "Task") receipt.agents++;
  }
  return receipt;
}

function onTurnEnd(state: ConversationsState, key: string, end: EventOf<"turn_end">, env: EventEnv): Effect[] {
  const { t } = env;
  const effects: Effect[] = [];
  endCompaction(state.messages[key], "err");
  finishTurnInQueue(state, key);
  if (!end.ok) push(state, key, { kind: "err", text: end.error || t("err.unknown") });
  else if (!state.queued[key])
    push(state, key, {
      kind: "done",
      text: doneText(end.duration_ms ? end.duration_ms / 1000 : 0, t),
      at: env.now,
      receipt: receiptOf(state.messages[key], end.usage?.cost),
    });
  if (!state.queued[key])
    effects.push({
      kind: "notify",
      key,
      body: end.ok ? lastAi(state.messages[key], t) : end.error || t("err.unknown"),
    });
  if (key !== env.selected) state.unseen.add(key);
  if (state.chats[key]) {
    state.chats[key].at = env.now;
    effects.push({ kind: "save-chats" });
  }
  effects.push({ kind: "snapshot" });
  return effects;
}

function onProcessExit(state: ConversationsState, key: string, env: EventEnv): Effect[] {
  const effects: Effect[] = [];
  endCompaction(state.messages[key], "err");
  releaseWaiting(state, key);
  // the process stopped while a turn ran: say so, the dots alone would just disappear
  if (state.status[key] === "busy") {
    push(state, key, { kind: "err", text: env.t("work.interrupted") });
    effects.push({ kind: "notify", key, body: env.t("work.interrupted") });
  }
  state.queued[key] = 0;
  state.status[key] = "idle";
  return effects;
}

const toolImgs = (event: EventOf<"tool_images">, imageUrl: EventEnv["imageUrl"]) =>
  event.images.map(image => imageUrl(image.media_type, image.data));

// ---------- history from the transcript, when a conversation opens for the first time
/** A transcript's events as items. `imageUrl` turns an inline image into something to show (a blob url). */
export function toItems(
  history: AgentEvent[],
  imageUrl: (mediaType: string, data: string) => string,
  t: Translate,
): Item[] {
  const items: Item[] = [];
  // the transcript's line times: a tool call starts at its line, and its result line (which gives no event of its
  // own) is the time before the next one. A user's message is a new prompt, not a result
  let at = 0;
  let line = 0;
  const settle = () => {
    const last = items[items.length - 1];
    if (line && last?.kind === "tool" && last.at) last.end = line;
  };
  for (const entry of history) {
    if (entry.type === "time") {
      settle();
      at = line = Date.parse(entry.at) || 0;
    } else if (entry.type === "user") {
      line = 0;
      // an image from the transcript as a thumbnail, or "" (a placeholder) when it is not inline
      const imgs = entry.images.map(image =>
        image && IMG_OK.includes(image.media_type) ? imageUrl(image.media_type, image.data) : "",
      );
      const { text, files } = splitFiles(entry.text);
      items.push({
        kind: "me",
        text,
        ...(at ? { at } : {}),
        ...(imgs.length ? { imgs } : {}),
        ...(files.length ? { files } : {}),
      });
    } else if (entry.type === "compacted") items.push({ kind: "compact", text: compactedText(entry, t), state: "ok" });
    else if (entry.type === "text") pushText(items, entry.text, entry.delta);
    else if (entry.type === "tool_call") items.push(toolItem(entry.id, entry.name, entry.input, "ok", at));
    else if (entry.type === "patch") {
      // ponytail: a followed transcript read in pieces loses the patch whose call was in an earlier piece (it shows without line numbers)
      const tool = items.find(x => x.id === entry.id);
      if (tool) tool.hunks = entry.hunks;
    } else if (entry.type === "tool_images") {
      const tool = items.find(x => x.id === entry.id);
      if (tool) tool.imgs = toolImgs(entry, imageUrl);
    }
  }
  settle();
  return items;
}

/** How full the context was at the end of a transcript. */
export function contextOf(history: AgentEvent[], window?: number) {
  let context: ContextUse | undefined;
  for (const event of history) context = applyContext(context, event);
  if (!context) return context;
  // a transcript names no window: the one the conversation last reported, else more than the default can only be 1M
  return { ...context, window: window ?? (context.used > DEFAULT_WINDOW ? LARGE_WINDOW : context.window) };
}

/** history gives a "time" event before each transcript line's events: a user message is a new prompt, any later line
 *  moves the end. Kept for the "Klaar · duur" of a turn that ran outside the app. */
export function trackTimes(state: Pick<ConversationsState, "outsideAt">, key: string, rows: AgentEvent[]) {
  let at = 0;
  for (const row of rows) {
    if (row.type === "time") {
      at = Date.parse(row.at) || 0;
      if (at && state.outsideAt[key]) state.outsideAt[key].to = at;
    } else if (row.type === "user" && at) state.outsideAt[key] = { from: at, to: at };
  }
}

/** The turns the app's own processes have in flight after a reload (`running`: per key, 0 when idle but alive), for the
 *  conversations the page knows nothing about yet: a late poll never revives a turn that already ended. `owned`: the
 *  keys the backend runs, which the providers' session lists must not override; `adopted`: the ones now busy. */
export function adoptOwnedTurns(state: ConversationsState, running: Record<string, number>) {
  const owned = new Set<string>();
  const adopted: string[] = [];
  for (const [key, conversation] of Object.entries(state.chats)) {
    if (conversation.closed || !(key in running)) continue;
    owned.add(key);
    if (running[key] > 0 && state.status[key] === undefined) {
      state.status[key] = "busy";
      state.queued[key] = running[key];
      adopted.push(key);
    }
  }
  return { owned, adopted };
}
