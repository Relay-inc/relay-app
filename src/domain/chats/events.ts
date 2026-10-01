import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "../../core/i18n";
import { changed } from "../../core/store";
import { setCommands, type AgentEvent } from "../agents";
import { ui, WAIT, isTerminal } from "../ui";
import { loadSnapshot } from "../vault";
import { termSid } from "../keys";
import { chat, NEW, label, lastAi, saveChats, formatDuration, type Item, type Img, type ToolInput } from "./state";

// The agent processes' events (normalised by their provider, packages/agent-core) and the transcripts behind a conversation.

// ---------- images from a transcript, shown via blob URLs (short strings, so redrawing the log does not re-parse megabytes of base64)
export const IMG_OK = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const toImg = (mediaType: string, data: string): Img => ({
  mt: mediaType,
  data,
  url: URL.createObjectURL(new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type: mediaType })),
});

type EventOf<Type extends AgentEvent["type"]> = Extract<AgentEvent, { type: Type }>;

// ---------- incoming events from the agent processes, normalised by their provider (packages/agent-core)
export function push(key: string, item: Item) {
  (chat.messages[key] ||= []).push(item);
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

// a banner while the window is in the background, a click opens that conversation (src-tauri/src/notify.rs)
export async function notify(key: string, body: string) {
  if (
    await getCurrentWindow()
      .isFocused()
      .catch(() => false)
  )
    return;
  invoke("notify", {
    key,
    title: key === WAIT ? t("nav.waiting") : label(key),
    body: body
      .replace(/[#*`>_]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160),
  });
}

export function onEvent(key: string, agentEvent: AgentEvent) {
  switch (agentEvent.type) {
    case "commands":
      setCommands(agentEvent.commands);
      break;
    case "draft_saved":
      onDraftSaved(key, agentEvent);
      break;
    case "reset":
      chat.messages[key] = [];
      break;
    case "text":
      pushText((chat.messages[key] ||= []), agentEvent.text, agentEvent.delta);
      break;
    case "tool_call":
      onToolCall(key, agentEvent);
      break;
    case "tool_result":
      onToolResult(key, agentEvent);
      break;
    case "turn_end":
      onTurnEnd(key, agentEvent);
      break;
    case "error":
    case "stderr":
      if (agentEvent.text.trim()) push(key, { kind: "err", text: agentEvent.text.slice(0, 2000) });
      break;
    case "exit":
      onProcessExit(key);
      break;
    default:
      return;
  }
  changed();
}

function onDraftSaved(key: string, saved: EventOf<"draft_saved">) {
  // the real recipients, independent of what Claude writes about it
  const cc = saved.cc || [];
  const bcc = saved.bcc || [];
  let text = t("note.draftSaved", { folder: saved.folder, to: (saved.to || []).join(", ") });
  if (cc.length) text += t("note.draftCc", { cc: cc.join(", ") });
  if (bcc.length) text += t("note.draftBcc", { bcc: bcc.join(", ") });
  push(key, { kind: "note", text });
}

function onToolCall(key: string, call: EventOf<"tool_call">) {
  // a chat that touched mail stays restricted: every later spawn of it starts with the mail limits
  const conversation = chat.chats[key];
  if (call.name.startsWith("mcp__relay-mail__") && conversation && !conversation.fromMail) {
    conversation.fromMail = true;
    saveChats();
  }
  push(key, toolItem(call.id, call.name, call.input, "run"));
}

function onToolResult(key: string, result: EventOf<"tool_result">) {
  const item = chat.messages[key]?.find(x => x.id === result.id);
  if (item) item.state = result.error ? "err" : "ok";
}

function finishTurnInQueue(key: string) {
  chat.queued[key] = Math.max(0, (chat.queued[key] || 1) - 1);
  chat.status[key] = chat.queued[key] ? "busy" : "idle";
}

function onTurnEnd(key: string, end: EventOf<"turn_end">) {
  finishTurnInQueue(key);
  if (!end.ok) push(key, { kind: "err", text: end.error || t("err.unknown") });
  else if (!chat.queued[key]) push(key, { kind: "done", text: doneText(end.duration_ms ? end.duration_ms / 1000 : 0) });
  if (!chat.queued[key]) notify(key, end.ok ? lastAi(key) : end.error || t("err.unknown"));
  if (key !== ui.selected) chat.unseen.add(key);
  if (chat.chats[key]) {
    chat.chats[key].at = Date.now();
    saveChats();
  }
  loadSnapshot();
}

// "Klaar" with the turn's duration when it is known
const doneText = (seconds: number) => (seconds ? t("work.doneIn", { d: formatDuration(seconds) }) : t("work.done"));

function onProcessExit(key: string) {
  // the process stopped while a turn ran: say so, the dots alone would just disappear
  if (chat.status[key] === "busy") {
    push(key, { kind: "err", text: t("work.interrupted") });
    notify(key, t("work.interrupted"));
  }
  chat.queued[key] = 0;
  chat.status[key] = "idle";
}

// ---------- history from the transcript, when a conversation opens for the first time
export function toItems(history: AgentEvent[]): Item[] {
  const items: Item[] = [];
  for (const entry of history) {
    if (entry.type === "user") {
      // an image from the transcript as a thumbnail, or "" (a placeholder) when it is not inline
      const imgs = entry.images.map(image =>
        image && IMG_OK.includes(image.media_type) ? toImg(image.media_type, image.data).url : "",
      );
      items.push({ kind: "me", text: entry.text, ...(imgs.length ? { imgs } : {}) });
    } else if (entry.type === "text") pushText(items, entry.text, entry.delta);
    else if (entry.type === "tool_call") items.push(toolItem(entry.id, entry.name, entry.input, "ok"));
  }
  return items;
}
// a terminal conversation: first the whole transcript, then only what was added since the last read
export async function tailTerm(key: string): Promise<boolean> {
  const transcript = await invoke<{ items: AgentEvent[]; next: number }>("history_sid", {
    sid: termSid(key),
    from: chat.termOffset[key] ?? 0,
  });
  const fresh = chat.termOffset[key] === undefined;
  chat.termOffset[key] = transcript.next;
  const added = toItems(transcript.items);
  if (fresh) chat.messages[key] = added;
  else if (added.length) chat.messages[key].push(...added);
  return fresh || added.length > 0;
}
export async function ensureHistory(key: string, fresh = false) {
  if (isTerminal(key)) {
    if (!chat.messages[key] || fresh) await tailTerm(key);
    return;
  }
  if (chat.messages[key] && !fresh) return;
  const items = toItems(await invoke<AgentEvent[]>("history", { project: key }));
  chat.messages[key] = items;
  const firstMessage = items.find(item => item.kind === "me");
  const conversation = chat.chats[key];
  if (conversation && [NEW, "Gesprek", "Algemeen gesprek"].includes(conversation.title) && firstMessage) {
    conversation.title = (firstMessage.text || t("chat.image")).slice(0, 48);
    saveChats();
  }
}

// ---------- a turn this page did not start: after a reload of the page (the app's process still sends its events, only
// the dots are missing) or after an app restart (the process lives on without the app, the transcript is followed).
// Only for a conversation the page knows nothing about yet, so a late "busy" never brings back the dots of a finished turn.
// history gives a "time" event before each transcript line's events: a user message is a new prompt, any later line moves the end
function trackTimes(key: string, rows: AgentEvent[]) {
  let at = 0;
  for (const row of rows) {
    if (row.type === "time") {
      at = Date.parse(row.at) || 0;
      if (at && chat.outsideAt[key]) chat.outsideAt[key].to = at;
    } else if (row.type === "user" && at) chat.outsideAt[key] = { from: at, to: at };
  }
}
export async function syncBusy() {
  const liveAgents = new Map(chat.agentsList.map(agent => [`${agent.provider}:${agent.sessionId}`, agent]));
  const ownedKeys = new Set(await invoke<string[]>("running").catch(() => []));
  for (const [key, { provider, sid }] of Object.entries(chat.sidOf)) {
    const conversation = chat.chats[key];
    if (!conversation || conversation.closed) continue;
    const busy = liveAgents.get(`${provider}:${sid}`)?.status === "busy";
    if (busy && chat.status[key] === undefined) await adoptRunningTurn(key, provider, sid, ownedKeys.has(key));
    else if (!busy && key in chat.outside) await finishOutsideTurn(key);
  }
}
async function adoptRunningTurn(key: string, provider: string, sid: string, ownedByApp: boolean) {
  chat.status[key] = "busy";
  if (ownedByApp) {
    // the events that follow land on top of the transcript
    if (!chat.messages[key]) await ensureHistory(key);
    return;
  }
  const transcript = await invoke<{ items: AgentEvent[]; next: number }>("history_sid", { sid, from: 0, provider });
  chat.messages[key] = toItems(transcript.items);
  chat.outside[key] = transcript.next;
  trackTimes(key, transcript.items);
}
async function finishOutsideTurn(key: string) {
  await tailOutside(key);
  delete chat.outside[key];
  chat.status[key] = "idle";
  const span = chat.outsideAt[key];
  delete chat.outsideAt[key];
  push(key, { kind: "done", text: doneText(span && span.to > span.from ? (span.to - span.from) / 1000 : 0) });
  notify(key, lastAi(key));
  if (key !== ui.selected) chat.unseen.add(key);
}
export async function tailOutside(key: string) {
  const transcript = await invoke<{ items: AgentEvent[]; next: number }>("history_sid", {
    sid: chat.sidOf[key].sid,
    from: chat.outside[key],
    provider: chat.sidOf[key].provider,
  });
  chat.outside[key] = transcript.next;
  trackTimes(key, transcript.items);
  const added = toItems(transcript.items);
  if (added.length) {
    chat.messages[key].push(...added);
    changed();
  }
}
