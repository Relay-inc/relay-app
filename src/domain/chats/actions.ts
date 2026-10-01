import { invoke } from "@tauri-apps/api/core";
import { t } from "../../core/i18n";
import { changed, ls, request } from "../../core/store";
import { ui, WAIT, isTerm } from "../ui";
import { config, saveSettings } from "../config";
import { setIcon } from "../icons";
import { vault, findProjects } from "../vault";
import { chatAgent, picks } from "../agents";
import { select, toast, hideToast } from "../navigation";
import {
  chat,
  NEW,
  termOf,
  projOf,
  label,
  chatsOf,
  newChat,
  saveChats,
  shownTitle,
  isQuestion,
  type Img,
  type Pending,
} from "./state";
import { push, IMG_OK, toImg } from "./events";

// What the user does with a conversation: typing, images, sending and stopping, the cards and questions, routing it
// to a project, closing and reopening, and Cmd-K.

// ---------- the composer: what is typed per conversation, images waiting for the next send
export function setTyped(v: string) {
  const c = chat.chats[ui.sel];
  if (v) chat.typed[ui.sel] = v;
  else delete chat.typed[ui.sel];
  ls.set("typed", chat.typed);
  if (c?.draft) {
    ls.set("sel", v ? ui.sel : WAIT);
    saveChats();
  }
  // a draft is named after what is typed until it is sent
  if (c?.draft && !c.mail) c.title = v.trim().slice(0, 48) || NEW;
  changed();
}

const MAX_SIDE = 2000,
  MAX_BYTES = 4e6;
const readUrl = (f: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(f);
  });
// small enough as is, or redrawn on a canvas: long side at most 2000 px, png stays png unless it is still too big
async function prepImage(f: File): Promise<Img | null> {
  const src = await readUrl(f),
    img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const w = img.naturalWidth,
    h = img.naturalHeight,
    long = Math.max(w, h);
  let out = src;
  if (!IMG_OK.includes(f.type) || long > MAX_SIDE || f.size > MAX_BYTES) {
    const s = Math.min(1, MAX_SIDE / long),
      cv = document.createElement("canvas"),
      cx = cv.getContext("2d")!;
    cv.width = Math.round(w * s);
    cv.height = Math.round(h * s);
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    out = f.type === "image/png" || !IMG_OK.includes(f.type) ? cv.toDataURL("image/png") : "";
    if (!out || out.length > (MAX_BYTES * 4) / 3) {
      // jpeg has no transparency: white behind it
      cx.globalCompositeOperation = "destination-over";
      cx.fillStyle = "#fff";
      cx.fillRect(0, 0, cv.width, cv.height);
      out = cv.toDataURL("image/jpeg", 0.85);
    }
  }
  const m = out.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  return m && IMG_OK.includes(m[1]) ? toImg(m[1], m[2]) : null;
}
/** Images pasted or dropped: into the composer's list, or the Cmd-K field's. */
export async function attach(files: File[], list: Img[] = chat.attached) {
  const imgs = (
    await Promise.all(files.filter(f => f.type.startsWith("image/")).map(f => prepImage(f).catch(() => null)))
  ).filter((x): x is Img => !!x);
  if (!imgs.length) return;
  list.push(...imgs);
  changed();
}
export function unattach(i: number, list: Img[] = chat.attached) {
  const [gone] = list.splice(i, 1);
  if (gone) URL.revokeObjectURL(gone.url);
  changed();
}

// ---------- sending
// `to` sends to a conversation that is not open (Cmd-K) with its own images: the composer, its images and the view stay as they are
export async function sendMsg(forced?: string, to?: string, toImgs: Img[] = []) {
  const text = forced ?? (chat.typed[ui.sel] ?? "").trim();
  if (forced === undefined && text) {
    delete chat.typed[ui.sel];
    ls.set("typed", chat.typed);
  }
  if ((!text && !(to ? toImgs : chat.attached).length) || (!to && ui.sel === WAIT)) return;
  if (!to && isTerm(ui.sel)) {
    // typing in a terminal conversation: fork it into an app conversation under the same project
    const tm = termOf(ui.sel);
    if (!tm) return;
    const k = newChat(tm.project);
    Object.assign(chat.chats[k], { title: tm.title, fork: tm.sid, draft: false, provider: "claude" }); // terminal sessions are Claude Code's
    chat.forked.push(tm.sid);
    ls.set("forkedTerms", chat.forked);
    chat.convo[k] = [...(chat.convo[ui.sel] || []), { kind: "note", text: t("note.forked") }];
    await select(k);
    return sendMsg(text);
  }
  const k = to ?? ui.sel,
    c = chat.chats[k];
  // a second process on the same session while the first still writes it would fork the transcript
  if (k in chat.outside) {
    push(k, { kind: "note", text: t("work.waitOutside") });
    changed();
    return;
  }
  // first message of a general conversation: if it names one project, it goes under that project
  // (also from Cmd-K, which passes `to`; the resend after the route question passes neither and must not ask again)
  if (c && !c.project && (!forced || to) && !(chat.convo[k] || []).length) {
    const hits = findProjects(text);
    if (hits.length === 1) {
      c.project = hits[0];
      push(k, { kind: "note", text: t("note.moved", { name: hits[0] }) });
    } else if (hits.length > 1) {
      chat.routeChoice = { key: k, text, hits };
      changed();
      return;
    }
  }
  if (c) {
    if (c.title === NEW) c.title = (text || t("chat.image")).slice(0, 48);
    c.draft = false;
    c.at = Date.now();
    c.provider ||= chatAgent(k);
    saveChats();
  }
  // first message: a short generated title replaces the typed start, unless the user renamed it meanwhile
  if (c && text && !(chat.convo[k] || []).length) {
    const auto = c.title;
    invoke<string>("ai_title", { text, provider: chatAgent(k) })
      .then(title => {
        if (chat.chats[k]?.title === auto) {
          chat.chats[k].title = title;
          saveChats();
          changed();
        }
      })
      .catch(() => {});
  }
  const imgs = to ? toImgs : chat.attached;
  if (!to) chat.attached = [];
  push(k, { kind: "me", text, ...(imgs.length ? { imgs: imgs.map(i => i.url) } : {}) });
  chat.status[k] = "busy";
  chat.queued[k] = (chat.queued[k] || 0) + 1;
  changed();
  if (k === ui.sel) request("scroll-bottom");
  const name = `${c?.project || t("general")}: ${shownTitle(c?.title || k)}`;
  const sent = c?.mail ? `${c.mail}\n\n${text}` : text;
  if (c?.mail) {
    delete c.mail;
    saveChats();
  }
  try {
    await invoke("send", {
      project: k,
      text: sent,
      images: imgs.map(i => ({ media_type: i.mt, data: i.data })),
      name,
      fork: c?.fork ?? null,
      mail: !!c?.fromMail,
      model: picks("model").value,
      effort: picks("effort").value,
      provider: chatAgent(k),
    });
  } catch (e) {
    push(k, { kind: "err", text: String(e) });
    chat.queued[k] = Math.max(0, (chat.queued[k] || 1) - 1);
    chat.status[k] = chat.queued[k] ? "busy" : "idle";
    changed();
  }
}
export const stopChat = () => {
  invoke("stop", { project: ui.sel });
  chat.queued[ui.sel] = 0;
  chat.status[ui.sel] = "idle";
  push(ui.sel, { kind: "note", text: t("note.stopped") });
  changed();
};
/** The send button: send, or stop the running turn. */
export const sendOrStop = () => (chat.status[ui.sel] === "busy" ? stopChat() : sendMsg());
/** The agent of a conversation that has not started yet. */
export function setAgent(id: string) {
  const c = chat.chats[ui.sel];
  if (!c) return;
  c.provider = id;
  saveChats();
  changed();
}
/** The conversation's title, edited in place. Empty keeps the old one. */
export function rename(v: string) {
  const c = chat.chats[ui.sel];
  if (!c || !v.trim()) {
    changed();
    return;
  }
  c.title = v.trim();
  saveChats();
  changed();
}

// ---------- a general conversation that names several projects: the user picks one, or keeps it general
export function routeTo(name: string) {
  const r = chat.routeChoice;
  if (!r) return;
  chat.routeChoice = null;
  if (name) {
    chat.chats[r.key].project = name;
    push(r.key, { kind: "note", text: t("note.moved", { name }) });
  }
  sendMsg(r.text);
}
/** The bar that asks whether a general conversation is about a project: yes moves it, no hides the question. */
export function moveTo(p: string | null) {
  if (p) {
    chat.chats[ui.sel].project = p;
    push(ui.sel, { kind: "note", text: t("note.moved", { name: p }) });
    saveChats();
  } else chat.dismissed.add(ui.sel);
  changed();
}

// ---------- permission and question cards
/** "Laurent sloeg de vraag over": a question skipped is answered in the conversation itself. */
/** A card's answer. `choice`: "allow" or "deny" for a permission; for a question, the picked labels and the typed "other" per question. */
export async function answer(r: Pending, choice: "allow" | "deny" | { picked: string[][]; other: string[] }) {
  let decision: any;
  if (choice === "allow") decision = { behavior: "allow", updatedInput: r.input };
  else if (choice === "deny")
    decision = {
      behavior: "deny",
      message: isQuestion(r)
        ? "Laurent sloeg de vraag over en antwoordt zelf in het gesprek. Wacht op zijn bericht."
        : "Geweigerd in de app.",
    };
  else {
    const answers: Record<string, string> = {};
    (r.input.questions || []).forEach((q: any, i: number) => {
      const on = [...(choice.picked[i] || [])],
        other = (choice.other[i] || "").trim();
      if (other) on.push(other);
      if (on.length) answers[q.question] = on.join(", ");
    });
    if (!Object.keys(answers).length) return false;
    decision = { behavior: "allow", updatedInput: { ...r.input, answers } };
  }
  await invoke("answer", { id: r.id, decision });
  chat.pendingList = chat.pendingList.filter(x => x.id !== r.id);
  changed();
  return true;
}
/** A waiting background session: hide it here, stop it, or open it in the terminal. */
export async function bg(act: "hide" | "stop" | "attach", id: string) {
  if (act === "hide") {
    chat.hidden.push(id);
    ls.set("hiddenAgents", chat.hidden);
    changed();
    return;
  }
  await invoke("bg", { action: act, id });
  if (act === "stop") {
    chat.agentsList = chat.agentsList.filter(a => a.id !== id);
    changed();
  }
}
/** The terminal button: a terminal session opens in iTerm, an app conversation resumes there. */
export function openTerminal() {
  if (ui.sel === WAIT || chat.chats[ui.sel]?.fromMail) return;
  if (isTerm(ui.sel)) {
    const tm = termOf(ui.sel);
    if (tm) invoke("bg", { action: "attach", id: tm.id });
    return;
  }
  invoke("open_terminal", {
    project: ui.sel,
    session: null,
    name: `${projOf(ui.sel) || t("general")}: ${label(ui.sel)}`,
  });
  chat.queued[ui.sel] = 0;
  chat.status[ui.sel] = "idle";
  changed();
}

// ---------- closing hides a conversation from the sidebar. An app conversation stops but keeps its session, a
// terminal session keeps running in iTerm. Both come back via the undo bar or right-click > Heropen.
export async function closeChat(k: string) {
  const title = isTerm(k) ? termOf(k)?.title : label(k);
  if (isTerm(k)) {
    chat.forked.push(k.slice(2));
    ls.set("forkedTerms", chat.forked);
  } else if (chat.chats[k]) {
    await invoke("stop", { project: k });
    chat.chats[k].closed = Date.now();
    delete chat.status[k];
    delete chat.queued[k];
    saveChats();
  }
  toast(t("toast.closed", { title: title ?? "" }), () => reopen(k));
  if (ui.sel === k) {
    const p = isTerm(k) ? null : projOf(k);
    await select(p && chatsOf(p)[0] ? chatsOf(p)[0].key : WAIT);
  } else changed();
}
export async function reopen(k: string) {
  if (isTerm(k)) {
    chat.forked = chat.forked.filter(x => x !== k.slice(2));
    ls.set("forkedTerms", chat.forked);
  } else if (chat.chats[k]) {
    delete chat.chats[k].closed;
    saveChats();
  }
  ui.toast = null;
  await select(k);
}
// Escape on a running turn: the first press warns, a second within 2s stops it like the stop button
let escAt = 0;
export function escStop() {
  if (Date.now() - escAt < 2000) {
    escAt = 0;
    hideToast();
    stopChat();
    return;
  }
  escAt = Date.now();
  toast(t("toast.escStop"), undefined, undefined, 2000);
}
/** Ctrl-C like in the terminal: stops a running turn, otherwise clears what is typed. */
export const ctrlC = () => (chat.status[ui.sel] === "busy" ? stopChat() : setTyped(""));

// ---------- Cmd-K: a question that becomes a new general conversation in the background, the open screen stays
export function quickSend(text: string, imgs: Img[]) {
  const k = newChat(null);
  sendMsg(text, k, imgs);
  toast(
    t("toast.started", { text: (text || t("chat.image")).slice(0, 60) }),
    () => {
      hideToast();
      select(k);
    },
    t("toast.open"),
  );
}

// ---------- the panel under the title: the conversation's project, and that project's icon and name
/** `img` an image data url, else `emoji`; empty both resets the icon so the favicon run guesses again. Resolves with an error to show, or "". */
export async function savePop(
  proj: string | null,
  f?: { img?: string; emoji: string; label: string },
): Promise<string> {
  const next = structuredClone(config.value);
  const T0 = isTerm(ui.sel) ? termOf(ui.sel) : undefined,
    cur = T0 ? T0.project : projOf(ui.sel); // the project the icon fields belong to
  if (isTerm(ui.sel)) next.overrides[ui.sel.slice(2)] = proj;
  else if (chat.chats[ui.sel]) {
    chat.chats[ui.sel].project = proj;
    saveChats();
  }
  if (cur && f) {
    // the label stays in the app's settings, the icon goes to the vault; cleared, the favicon run guesses again
    if (f.label) next.projects[cur] = { label: f.label };
    else delete next.projects[cur];
    const was = vault.icons[cur];
    try {
      if (f.img && f.img !== was?.img) await setIcon(cur, "img", f.img);
      else if (!f.img && f.emoji && f.emoji !== was?.icon) await setIcon(cur, "emoji", f.emoji);
      else if (!f.img && !f.emoji && (was?.img || was?.icon)) await setIcon(cur, "reset");
    } catch (x) {
      return String(x);
    }
  }
  if (!(await saveSettings(next))) return config.msg;
  ui.pop = false;
  changed();
  return "";
}

// ---------- the agents of the open conversation, above the composer
/** A click on an agent unfolds its last messages, a second click folds them. */
export async function toggleSubLog(id: string) {
  if (chat.subLog[id]) delete chat.subLog[id];
  else chat.subLog[id] = await invoke<string[]>("agent_log", { key: ui.sel, id });
  changed();
}
/** The finished agents of the open conversation, folded away or shown. */
export function toggleSubsDone() {
  if (chat.subsOpen.has(ui.sel)) chat.subsOpen.delete(ui.sel);
  else chat.subsOpen.add(ui.sel);
  changed();
}
