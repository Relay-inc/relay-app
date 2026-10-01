import { invoke } from "@tauri-apps/api/core";
import { t, tn } from "../../core/i18n";
import { changed, ls, request } from "../../core/store";
import { ui, WAIT, isTerminal } from "../ui";
import { config, saveSettings, type Settings } from "../config";
import { setIcon } from "../icons";
import { vault, findProjects } from "../vault";
import { chatAgent, picks } from "../agents";
import { select, toast, hideToast } from "../navigation";
import {
  chat,
  NEW,
  terminalOf,
  projectOf,
  selectedProject,
  label,
  chatsOf,
  newChat,
  saveChats,
  displayTitle,
  isQuestion,
  type Chat,
  type Img,
  type Pending,
} from "./state";
import { push, IMG_OK, toImg } from "./events";
import { termSid } from "../keys";
import type { Decision } from "@relay/agent-core";

// What the user does with a conversation: typing, images, sending and stopping, the cards and questions, routing it
// to a project, closing and reopening, and Cmd-K.

// ---------- the composer: what is typed per conversation, images waiting for the next send
export function setTyped(value: string) {
  const conversation = chat.chats[ui.selected];
  if (value) chat.typed[ui.selected] = value;
  else delete chat.typed[ui.selected];
  ls.set("typed", chat.typed);
  if (conversation?.draft) {
    ls.set("sel", value ? ui.selected : WAIT);
    saveChats();
  }
  // a draft is named after what is typed until it is sent
  if (conversation?.draft && !conversation.mail) conversation.title = value.trim().slice(0, 48) || NEW;
  changed();
}

const MAX_SIDE = 2000;
const MAX_BYTES = 4e6;
const readUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
// the picture redrawn on a canvas: long side at most 2000 px, png stays png unless it is still too big
function redrawImage(img: HTMLImageElement, file: File): string {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  let redrawn = file.type === "image/png" || !IMG_OK.includes(file.type) ? canvas.toDataURL("image/png") : "";
  if (!redrawn || redrawn.length > (MAX_BYTES * 4) / 3) {
    // jpeg has no transparency: white behind it
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    redrawn = canvas.toDataURL("image/jpeg", 0.85);
  }
  return redrawn;
}
// small enough as is, or redrawn
async function prepImage(file: File): Promise<Img | null> {
  const source = await readUrl(file);
  const img = new Image();
  img.src = source;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const tooBig = Math.max(img.naturalWidth, img.naturalHeight) > MAX_SIDE || file.size > MAX_BYTES;
  const dataUrl = !IMG_OK.includes(file.type) || tooBig ? redrawImage(img, file) : source;
  const parts = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  return parts && IMG_OK.includes(parts[1]) ? toImg(parts[1], parts[2]) : null;
}
/** Images pasted or dropped: into the composer's list, or the Cmd-K field's. */
export async function attach(files: File[], list: Img[] = chat.attached) {
  const images = (
    await Promise.all(
      files.filter(file => file.type.startsWith("image/")).map(file => prepImage(file).catch(() => null)),
    )
  ).filter((image): image is Img => !!image);
  if (!images.length) return;
  list.push(...images);
  changed();
}
export function unattach(i: number, list: Img[] = chat.attached) {
  const [gone] = list.splice(i, 1);
  if (gone) URL.revokeObjectURL(gone.url);
  changed();
}

// ---------- sending
// the text to send: forced, or what is typed (which is then taken out of the composer)
function takeText(forced?: string): string {
  const text = forced ?? (chat.typed[ui.selected] ?? "").trim();
  if (forced === undefined && text) {
    delete chat.typed[ui.selected];
    ls.set("typed", chat.typed);
  }
  return text;
}
// typing in a terminal conversation: fork it into an app conversation under the same project
async function forkTerminalAndSend(text: string): Promise<void> {
  const session = terminalOf(ui.selected);
  if (!session) return;
  const key = newChat(session.project);
  Object.assign(chat.chats[key], { title: session.title, fork: session.sid, draft: false, provider: "claude" }); // terminal sessions are Claude Code's
  chat.forked.push(session.sid);
  ls.set("forkedTerms", chat.forked);
  chat.messages[key] = [...(chat.messages[ui.selected] || []), { kind: "note", text: t("note.forked") }];
  await select(key);
  return sendMsg(text);
}
// first message of a general conversation: if it names one project, it goes under that project
// (also from Cmd-K, which passes `to`; the resend after the route question passes neither and must not ask again).
// True when several projects match and the user is asked instead.
function routeFirstMessage(key: string, conversation: Chat, text: string, forced?: string, to?: string): boolean {
  const first = !conversation.project && (!forced || to) && !(chat.messages[key] || []).length;
  if (!first) return false;
  const hits = findProjects(text);
  if (hits.length === 1) {
    conversation.project = hits[0];
    push(key, { kind: "note", text: t("note.moved", { name: hits[0] }) });
  } else if (hits.length > 1) {
    chat.routeChoice = { key, text, hits };
    changed();
    return true;
  }
  return false;
}
// the conversation's own state at its first send: no longer a draft, a title, an agent
function startConversation(key: string, conversation: Chat, text: string) {
  if (conversation.title === NEW) conversation.title = (text || t("chat.image")).slice(0, 48);
  conversation.draft = false;
  conversation.at = Date.now();
  conversation.provider ||= chatAgent(key);
  saveChats();
}
// first message: a short generated title replaces the typed start, unless the user renamed it meanwhile
function generateTitle(key: string, typedTitle: string, text: string) {
  invoke<string>("ai_title", { text, provider: chatAgent(key) })
    .then(title => {
      if (chat.chats[key]?.title !== typedTitle) return;
      chat.chats[key].title = title;
      saveChats();
      changed();
    })
    .catch(() => {});
}
// the message shows up and the conversation is busy until its turn ends
function queueMessage(key: string, text: string, images: Img[]) {
  push(key, { kind: "me", text, ...(images.length ? { imgs: images.map(image => image.url) } : {}) });
  chat.status[key] = "busy";
  chat.queued[key] = (chat.queued[key] || 0) + 1;
  changed();
  if (key === ui.selected) request("scroll-bottom");
}
async function deliver(key: string, conversation: Chat | undefined, text: string, images: Img[]) {
  const name = `${conversation?.project || t("general")}: ${displayTitle(conversation?.title || key)}`;
  const sent = conversation?.mail ? `${conversation.mail}\n\n${text}` : text;
  if (conversation?.mail) {
    delete conversation.mail;
    saveChats();
  }
  try {
    await invoke("send", {
      project: key,
      text: sent,
      images: images.map(image => ({ media_type: image.mt, data: image.data })),
      name,
      fork: conversation?.fork ?? null,
      mail: !!conversation?.fromMail,
      model: picks("model").value,
      effort: picks("effort").value,
      provider: chatAgent(key),
    });
  } catch (error) {
    push(key, { kind: "err", text: String(error) });
    chat.queued[key] = Math.max(0, (chat.queued[key] || 1) - 1);
    chat.status[key] = chat.queued[key] ? "busy" : "idle";
    changed();
  }
}
// `to` sends to a conversation that is not open (Cmd-K) with its own images: the composer, its images and the view stay as they are
export async function sendMsg(forced?: string, to?: string, toImgs: Img[] = []): Promise<void> {
  const text = takeText(forced);
  if ((!text && !(to ? toImgs : chat.attached).length) || (!to && ui.selected === WAIT)) return;
  if (!to && isTerminal(ui.selected)) return forkTerminalAndSend(text);
  const key = to ?? ui.selected;
  const conversation = chat.chats[key];
  // a second process on the same session while the first still writes it would fork the transcript
  if (key in chat.outside) {
    push(key, { kind: "note", text: t("work.waitOutside") });
    changed();
    return;
  }
  if (conversation && routeFirstMessage(key, conversation, text, forced, to)) return;
  if (conversation) startConversation(key, conversation, text);
  if (conversation && text && !(chat.messages[key] || []).length) generateTitle(key, conversation.title, text);
  const images = to ? toImgs : chat.attached;
  if (!to) chat.attached = [];
  queueMessage(key, text, images);
  await deliver(key, conversation, text, images);
}
export const stopChat = () => {
  invoke("stop", { project: ui.selected });
  chat.queued[ui.selected] = 0;
  chat.status[ui.selected] = "idle";
  push(ui.selected, { kind: "note", text: t("note.stopped") });
  changed();
};
/** The send button: send, or stop the running turn. */
export const sendOrStop = () => (chat.status[ui.selected] === "busy" ? stopChat() : sendMsg());
/** The agent of a conversation that has not started yet. */
export function setAgent(id: string) {
  const conversation = chat.chats[ui.selected];
  if (!conversation) return;
  conversation.provider = id;
  saveChats();
  changed();
}
/** The conversation's title, edited in place. Empty keeps the old one. */
export function rename(title: string) {
  const conversation = chat.chats[ui.selected];
  if (!conversation || !title.trim()) {
    changed();
    return;
  }
  conversation.title = title.trim();
  saveChats();
  changed();
}

// ---------- a general conversation that names several projects: the user picks one, or keeps it general
export function routeTo(name: string) {
  const choice = chat.routeChoice;
  if (!choice) return;
  chat.routeChoice = null;
  if (name) {
    chat.chats[choice.key].project = name;
    push(choice.key, { kind: "note", text: t("note.moved", { name }) });
  }
  sendMsg(choice.text);
}
/** The bar that asks whether a general conversation is about a project: yes moves it, no hides the question. */
export function moveTo(project: string | null) {
  if (project) {
    chat.chats[ui.selected].project = project;
    push(ui.selected, { kind: "note", text: t("note.moved", { name: project }) });
    saveChats();
  } else chat.dismissed.add(ui.selected);
  changed();
}

// ---------- permission and question cards
type CardChoice = "allow" | "deny" | { picked: string[][]; other: string[] };
const SKIPPED_QUESTION = "Laurent sloeg de vraag over en antwoordt zelf in het gesprek. Wacht op zijn bericht.";
// a question skipped is answered in the conversation itself
function denial(request: Pending): Decision {
  return { behavior: "deny", message: isQuestion(request) ? SKIPPED_QUESTION : "Geweigerd in de app." };
}
// the picked labels and the typed "other" per question; null when nothing is answered
function questionAnswers(request: Pending, choice: { picked: string[][]; other: string[] }): Decision | null {
  const answers: Record<string, string> = {};
  (request.input.questions || []).forEach((question, i) => {
    const labels = [...(choice.picked[i] || [])];
    const other = (choice.other[i] || "").trim();
    if (other) labels.push(other);
    if (labels.length) answers[question.question] = labels.join(", ");
  });
  if (!Object.keys(answers).length) return null;
  return { behavior: "allow", updatedInput: { ...request.input, answers } };
}
/** A card's answer. `choice`: "allow" or "deny" for a permission; for a question, the picked labels and the typed "other" per question. */
export async function answer(request: Pending, choice: CardChoice) {
  let decision: Decision | null;
  if (choice === "allow") decision = { behavior: "allow", updatedInput: request.input };
  else if (choice === "deny") decision = denial(request);
  else decision = questionAnswers(request, choice);
  if (!decision) return false;
  await invoke("answer", { id: request.id, decision });
  if (choice === "allow" || choice === "deny") {
    const { command, file_path } = request.input;
    push(request.project, {
      kind: choice === "allow" ? "allowed" : "denied",
      text: String(command ?? file_path ?? request.tool_name),
    });
  }
  chat.pendingList = chat.pendingList.filter(x => x.id !== request.id);
  changed();
  return true;
}
/** A waiting background session: hide it here, stop it, or open it in the terminal. */
export async function bg(action: "hide" | "stop" | "attach", id: string) {
  if (action === "hide") {
    chat.hidden.push(id);
    ls.set("hiddenAgents", chat.hidden);
    changed();
    return;
  }
  await invoke("bg", { action, id });
  if (action === "stop") {
    chat.agentsList = chat.agentsList.filter(agent => agent.id !== id);
    changed();
  }
}
/** The terminal button: a terminal session opens in iTerm, an app conversation resumes there. */
export function openTerminal() {
  if (ui.selected === WAIT || chat.chats[ui.selected]?.fromMail) return;
  if (isTerminal(ui.selected)) {
    const session = terminalOf(ui.selected);
    if (session) invoke("bg", { action: "attach", id: session.id });
    return;
  }
  invoke("open_terminal", {
    project: ui.selected,
    session: null,
    name: `${projectOf(ui.selected) || t("general")}: ${label(ui.selected)}`,
  });
  chat.queued[ui.selected] = 0;
  chat.status[ui.selected] = "idle";
  changed();
}

// ---------- closing hides a conversation from the sidebar. An app conversation stops but keeps its session, a
// terminal session keeps running in iTerm. Both come back via the undo bar or right-click > Heropen.
export async function closeChat(key: string) {
  const title = isTerminal(key) ? terminalOf(key)?.title : label(key);
  let text = t("toast.closed", { title: title ?? "" });
  if (isTerminal(key)) {
    chat.forked.push(termSid(key));
    ls.set("forkedTerms", chat.forked);
  } else if (chat.chats[key]) {
    await invoke("stop", { project: key });
    // the git worktrees this conversation made go with it, the ones with work git would lose stay
    const wt = await invoke<{ removed: number; kept: number }>("drop_worktrees", { project: key }).catch(() => null);
    if (wt?.removed) text += ` · ${tn("toast.worktreesRemoved", wt.removed)}`;
    if (wt?.kept) text += ` · ${tn("toast.worktreesKept", wt.kept)}`;
    chat.chats[key].closed = Date.now();
    delete chat.status[key];
    delete chat.queued[key];
    saveChats();
  }
  toast(text, () => reopen(key));
  if (ui.selected !== key) {
    changed();
    return;
  }
  const project = isTerminal(key) ? null : projectOf(key);
  const neighbour = project ? chatsOf(project)[0] : undefined;
  await select(neighbour ? neighbour.key : WAIT);
}
export async function reopen(key: string) {
  if (isTerminal(key)) {
    chat.forked = chat.forked.filter(sid => sid !== termSid(key));
    ls.set("forkedTerms", chat.forked);
  } else if (chat.chats[key]) {
    delete chat.chats[key].closed;
    saveChats();
  }
  ui.toast = null;
  await select(key);
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
export const ctrlC = () => (chat.status[ui.selected] === "busy" ? stopChat() : setTyped(""));

// ---------- Cmd-K: a question that becomes a new general conversation in the background, the open screen stays
export function quickSend(text: string, imgs: Img[]) {
  const key = newChat(null);
  sendMsg(text, key, imgs);
  toast(
    t("toast.started", { text: (text || t("chat.image")).slice(0, 60) }),
    () => {
      hideToast();
      select(key);
    },
    t("toast.open"),
  );
}

// ---------- the panel under the title: the conversation's project, and that project's icon and name
type ProjectFields = { img?: string; emoji: string; label: string };
// the conversation moves to the project: a terminal session through the settings' overrides, an app conversation directly
function assignProject(next: Settings, project: string | null) {
  if (isTerminal(ui.selected)) next.overrides[termSid(ui.selected)] = project;
  else if (chat.chats[ui.selected]) {
    chat.chats[ui.selected].project = project;
    saveChats();
  }
}
// the label stays in the app's settings, the icon goes to the vault; cleared, the favicon run guesses again
async function saveProjectFields(next: Settings, project: string, fields: ProjectFields) {
  if (fields.label) next.projects[project] = { label: fields.label };
  else delete next.projects[project];
  const was = vault.icons[project];
  if (fields.img && fields.img !== was?.img) await setIcon(project, "img", fields.img);
  else if (!fields.img && fields.emoji && fields.emoji !== was?.icon) await setIcon(project, "emoji", fields.emoji);
  else if (!fields.img && !fields.emoji && (was?.img || was?.icon)) await setIcon(project, "reset");
}
/** `img` an image data url, else `emoji`; empty both resets the icon so the favicon run guesses again. Resolves with an error to show, or "". */
export async function savePop(project: string | null, fields?: ProjectFields): Promise<string> {
  const next = structuredClone(config.value);
  const iconProject = selectedProject(); // the project the icon fields belong to
  assignProject(next, project);
  if (iconProject && fields) {
    try {
      await saveProjectFields(next, iconProject, fields);
    } catch (error) {
      return String(error);
    }
  }
  if (!(await saveSettings(next))) return config.msg;
  ui.projectPanel = false;
  changed();
  return "";
}

// ---------- the agents of the open conversation, above the composer
/** A click on an agent unfolds its last messages, a second click folds them. */
export async function toggleSubLog(id: string) {
  if (chat.subLog[id]) delete chat.subLog[id];
  else chat.subLog[id] = await invoke<string[]>("agent_log", { key: ui.selected, id });
  changed();
}
/** The finished agents of the open conversation, folded away or shown. */
export function toggleSubsDone() {
  if (chat.subsOpen.has(ui.selected)) chat.subsOpen.delete(ui.selected);
  else chat.subsOpen.add(ui.selected);
  changed();
}
