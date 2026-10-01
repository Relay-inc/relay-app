import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "../../core/i18n";
import { changed } from "../../core/store";
import type { AgentEvent } from "../agents";
import { ui, WAIT, isTerm } from "../ui";
import { loadSnapshot } from "../vault";
import { chat, NEW, label, lastAi, saveChats, dur, type Item, type Img } from "./state";

// The agent processes' events (normalised by their provider, packages/agent-core) and the transcripts behind a conversation.

// ---------- images from a transcript, shown via blob URLs (short strings, so redrawing the log does not re-parse megabytes of base64)
export const IMG_OK = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const toImg = (mt: string, data: string): Img =>
  ({ mt, data, url: URL.createObjectURL(new Blob([Uint8Array.from(atob(data), ch => ch.charCodeAt(0))], { type: mt })) });

// ---------- incoming events from the agent processes, normalised by their provider (packages/agent-core)
export function push(k: string, it: Item) { (chat.convo[k] ||= []).push(it); }
// assistant text: a whole block, or a delta appended to the block before it
function pushText(items: Item[], text: string, delta: boolean) {
  const last = items[items.length - 1];
  if (delta && last?.kind === "ai") last.text += text; else items.push({ kind: "ai", text });
}
const toolItem = (id: string, name: string, input: any, state: Item["state"]): Item => ({ kind: "tool", id, text: name, tool: { name, input }, state, path: input?.file_path });

// a banner while the window is in the background, a click opens that conversation (src-tauri/src/notify.rs)
export async function notify(k: string, body: string) {
  if (await getCurrentWindow().isFocused().catch(() => false)) return;
  invoke("notify", { key: k, title: k === WAIT ? t("nav.waiting") : label(k), body: body.replace(/[#*`>_]+/g, "").replace(/\s+/g, " ").trim().slice(0, 160) });
}

export function onEvent(k: string, ev: AgentEvent) {
  if (ev.type === "draft_saved") { // the real recipients, independent of what Claude writes about it
    const cc: string[] = ev.cc || [], bcc: string[] = ev.bcc || [];
    push(k, { kind: "note", text: t("note.draftSaved", { folder: ev.folder, to: (ev.to || []).join(", ") }) + (cc.length ? t("note.draftCc", { cc: cc.join(", ") }) : "")
      + (bcc.length ? t("note.draftBcc", { bcc: bcc.join(", ") }) : "") });
    changed(); return;
  }
  if (ev.type === "text") pushText(chat.convo[k] ||= [], ev.text, ev.delta);
  else if (ev.type === "tool_call") {
    // a chat that touched mail stays restricted: every later spawn of it starts with the mail limits
    if (ev.name.startsWith("mcp__relay-mail__") && chat.chats[k] && !chat.chats[k].fromMail) { chat.chats[k].fromMail = true; saveChats(); }
    push(k, toolItem(ev.id, ev.name, ev.input, "run"));
  } else if (ev.type === "tool_result") {
    const it = chat.convo[k]?.find(x => x.id === ev.id);
    if (it) it.state = ev.error ? "err" : "ok";
  } else if (ev.type === "turn_end") {
    chat.queued[k] = Math.max(0, (chat.queued[k] || 1) - 1);
    chat.status[k] = chat.queued[k] ? "busy" : "idle";
    if (!ev.ok) push(k, { kind: "err", text: ev.error || t("err.unknown") });
    else if (!chat.queued[k]) push(k, { kind: "done", text: ev.duration_ms ? t("work.doneIn", { d: dur(ev.duration_ms / 1000) }) : t("work.done") });
    if (!chat.queued[k]) notify(k, ev.ok ? lastAi(k) : ev.error || t("err.unknown"));
    if (k !== ui.sel) chat.unseen.add(k);
    if (chat.chats[k]) { chat.chats[k].at = Date.now(); saveChats(); }
    loadSnapshot();
  } else if (ev.type === "error" || ev.type === "stderr") {
    if (ev.text.trim()) push(k, { kind: "err", text: ev.text.slice(0, 2000) });
  } else if (ev.type === "exit") {
    // the process stopped while a turn ran: say so, the dots alone would just disappear
    if (chat.status[k] === "busy") { push(k, { kind: "err", text: t("work.interrupted") }); notify(k, t("work.interrupted")); }
    chat.queued[k] = 0; chat.status[k] = "idle";
  } else return;
  changed();
}

// ---------- history from the transcript, when a conversation opens for the first time
export function toItems(hist: AgentEvent[]): Item[] {
  const items: Item[] = [];
  for (const e of hist) {
    if (e.type === "user") {
      // an image from the transcript as a thumbnail, or "" (a placeholder) when it is not inline
      const imgs = e.images.map(i => i && IMG_OK.includes(i.media_type) ? toImg(i.media_type, i.data).url : "");
      items.push({ kind: "me", text: e.text, ...(imgs.length ? { imgs } : {}) });
    } else if (e.type === "text") pushText(items, e.text, e.delta);
    else if (e.type === "tool_call") items.push(toolItem(e.id, e.name, e.input, "ok"));
  }
  return items;
}
// a terminal conversation: first the whole transcript, then only what was added since the last read
export async function tailTerm(k: string): Promise<boolean> {
  const r = await invoke<{ items: AgentEvent[]; next: number }>("history_sid", { sid: k.slice(2), from: chat.termOffset[k] ?? 0 });
  const fresh = chat.termOffset[k] === undefined;
  chat.termOffset[k] = r.next;
  const add = toItems(r.items);
  if (fresh) chat.convo[k] = add; else if (add.length) chat.convo[k].push(...add);
  return fresh || add.length > 0;
}
export async function ensureHistory(k: string, fresh = false) {
  if (isTerm(k)) { if (!chat.convo[k] || fresh) await tailTerm(k); return; }
  if (chat.convo[k] && !fresh) return;
  const items = toItems(await invoke<AgentEvent[]>("history", { project: k }));
  chat.convo[k] = items;
  const first = items.find(i => i.kind === "me"), c = chat.chats[k];
  if (c && [NEW, "Gesprek", "Algemeen gesprek"].includes(c.title) && first) { c.title = (first.text || t("chat.image")).slice(0, 48); saveChats(); }
}

// ---------- a turn this page did not start: after a reload of the page (the app's process still sends its events, only
// the dots are missing) or after an app restart (the process lives on without the app, the transcript is followed).
// Only for a conversation the page knows nothing about yet, so a late "busy" never brings back the dots of a finished turn.
// history gives a "time" event before each transcript line's events: a user message is a new prompt, any later line moves the end
function trackTimes(k: string, rows: AgentEvent[]) {
  let at = 0;
  for (const e of rows) {
    if (e.type === "time") { at = Date.parse(e.at) || 0; if (at && chat.outsideAt[k]) chat.outsideAt[k].to = at; }
    else if (e.type === "user" && at) chat.outsideAt[k] = { from: at, to: at };
  }
}
export async function syncBusy() {
  const live = new Map(chat.agentsList.map(a => [`${a.provider}:${a.sessionId}`, a]));
  const owned = new Set(await invoke<string[]>("running").catch(() => []));
  for (const [k, { provider, sid }] of Object.entries(chat.sidOf)) {
    if (!chat.chats[k] || chat.chats[k].closed) continue;
    const busy = live.get(`${provider}:${sid}`)?.status === "busy";
    if (busy && chat.status[k] === undefined) {
      chat.status[k] = "busy";
      if (owned.has(k)) { if (!chat.convo[k]) await ensureHistory(k); } // the events that follow land on top of the transcript
      else { const r = await invoke<{ items: AgentEvent[]; next: number }>("history_sid", { sid, from: 0, provider }); chat.convo[k] = toItems(r.items); chat.outside[k] = r.next; trackTimes(k, r.items); }
    } else if (!busy && k in chat.outside) {
      await tailOutside(k); delete chat.outside[k]; chat.status[k] = "idle";
      const span = chat.outsideAt[k]; delete chat.outsideAt[k];
      push(k, { kind: "done", text: span && span.to > span.from ? t("work.doneIn", { d: dur((span.to - span.from) / 1000) }) : t("work.done") });
      notify(k, lastAi(k));
      if (k !== ui.sel) chat.unseen.add(k);
    }
  }
}
export async function tailOutside(k: string) {
  const r = await invoke<{ items: AgentEvent[]; next: number }>("history_sid", { sid: chat.sidOf[k].sid, from: chat.outside[k], provider: chat.sidOf[k].provider });
  chat.outside[k] = r.next; trackTimes(k, r.items);
  const add = toItems(r.items);
  if (add.length) { chat.convo[k].push(...add); changed(); }
}
