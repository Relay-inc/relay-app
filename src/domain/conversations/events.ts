import type { AgentEvent } from "../agents/types";
import type { ConversationsState, Translate } from "./state";
import type { Item, ToolInput } from "./types";
import { formatDuration, lastAi } from "./rules.ts";
import { cleanCommands } from "./commands.ts";
import { splitFiles } from "./files.ts";

// The agent processes' events (normalised by their provider, packages/agent-core) as a reducer over the conversations
// state, and the transcripts behind a conversation as items. Pure: what needs the outside (a banner, saving, a vault
// read) comes back as an effect for application/conversations to run.

type EventOf<Type extends AgentEvent["type"]> = Extract<AgentEvent, { type: Type }>;

export const IMG_OK = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** Around the project line the app puts in front of a message; the transcript keeps it, the conversation hides it. */
export const CTX_OPEN = "<relay-project>";
export const CTX_CLOSE = "</relay-project>";
const CTX_RE = new RegExp(`^${CTX_OPEN}[\\s\\S]*?${CTX_CLOSE}\\s*`);

/** What the reducer reads from outside the state. */
export type EventEnv = { t: Translate; selected: string; now: number };
/** What the reducer asks for after an event. */
export type Effect = { kind: "save-chats" } | { kind: "notify"; key: string; body: string } | { kind: "snapshot" };

export function push(state: Pick<ConversationsState, "messages">, key: string, item: Item) {
  (state.messages[key] ||= []).push(item);
}
// assistant text: a whole block, or a delta appended to the block before it
function pushText(items: Item[], text: string, delta: boolean) {
  const last = items[items.length - 1];
  if (delta && last?.kind === "ai") last.text += text;
  else items.push({ kind: "ai", text });
}
const toolItem = (id: string, name: string, input: ToolInput, state: Item["state"]): Item => ({
  kind: "tool",
  id,
  text: name,
  tool: { name, input },
  state,
  path: input?.file_path,
});
// "Klaar" with the turn's duration when it is known
export const doneText = (seconds: number, t: Translate) =>
  seconds ? t("work.doneIn", { d: formatDuration(seconds) }) : t("work.done");

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
  }
  switch (event.type) {
    case "commands":
      state.commands[provider] = cleanCommands(event.commands);
      return [];
    case "draft_saved":
      push(state, key, { kind: "note", text: draftNote(event, env.t) });
      return [];
    case "reset":
      state.messages[key] = [];
      return [];
    case "text":
      pushText((state.messages[key] ||= []), event.text, event.delta);
      return [];
    case "tool_call":
      return onToolCall(state, key, event);
    case "tool_result": {
      const item = state.messages[key]?.find(x => x.id === event.id);
      if (item) item.state = event.error ? "err" : "ok";
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

// the real recipients, independent of what the agent writes about it
function draftNote(saved: EventOf<"draft_saved">, t: Translate) {
  const cc = saved.cc || [];
  const bcc = saved.bcc || [];
  let text = t("note.draftSaved", { folder: saved.folder, to: (saved.to || []).join(", ") });
  if (cc.length) text += t("note.draftCc", { cc: cc.join(", ") });
  if (bcc.length) text += t("note.draftBcc", { bcc: bcc.join(", ") });
  return text;
}

function onToolCall(state: ConversationsState, key: string, call: EventOf<"tool_call">): Effect[] {
  push(state, key, toolItem(call.id, call.name, call.input, "run"));
  // a chat that touched mail stays restricted: every later spawn of it starts with the mail limits
  const conversation = state.chats[key];
  if (call.name.startsWith("mcp__relay-mail__") && conversation && !conversation.fromMail) {
    conversation.fromMail = true;
    return [{ kind: "save-chats" }];
  }
  return [];
}

function finishTurnInQueue(state: ConversationsState, key: string) {
  state.queued[key] = Math.max(0, (state.queued[key] || 1) - 1);
  state.status[key] = state.queued[key] ? "busy" : "idle";
}

function onTurnEnd(state: ConversationsState, key: string, end: EventOf<"turn_end">, env: EventEnv): Effect[] {
  const { t } = env;
  const effects: Effect[] = [];
  finishTurnInQueue(state, key);
  if (!end.ok) push(state, key, { kind: "err", text: end.error || t("err.unknown") });
  else if (!state.queued[key])
    push(state, key, { kind: "done", text: doneText(end.duration_ms ? end.duration_ms / 1000 : 0, t) });
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
  // the process stopped while a turn ran: say so, the dots alone would just disappear
  if (state.status[key] === "busy") {
    push(state, key, { kind: "err", text: env.t("work.interrupted") });
    effects.push({ kind: "notify", key, body: env.t("work.interrupted") });
  }
  state.queued[key] = 0;
  state.status[key] = "idle";
  return effects;
}

// ---------- history from the transcript, when a conversation opens for the first time
/** A transcript's events as items. `imageUrl` turns an inline image into something to show (a blob url). */
export function toItems(history: AgentEvent[], imageUrl: (mediaType: string, data: string) => string): Item[] {
  const items: Item[] = [];
  for (const entry of history) {
    if (entry.type === "user") {
      // an image from the transcript as a thumbnail, or "" (a placeholder) when it is not inline
      const imgs = entry.images.map(image =>
        image && IMG_OK.includes(image.media_type) ? imageUrl(image.media_type, image.data) : "",
      );
      const { text, files } = splitFiles(entry.text.replace(CTX_RE, ""));
      items.push({ kind: "me", text, ...(imgs.length ? { imgs } : {}), ...(files.length ? { files } : {}) });
    } else if (entry.type === "text") pushText(items, entry.text, entry.delta);
    else if (entry.type === "tool_call") items.push(toolItem(entry.id, entry.name, entry.input, "ok"));
  }
  return items;
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
