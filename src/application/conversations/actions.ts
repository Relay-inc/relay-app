import { t, tn } from "../../shared/i18n";
import type { Img, Pending, CardChoice } from "../../domain/conversations/types";
import { NEW, decisionOf } from "../../domain/conversations/rules";
import { push } from "../../domain/conversations/events";
import { outgoing, planSend, refusesImages } from "../../domain/conversations/send";
import { fileName, withFiles } from "../../domain/conversations/files";
import { WAIT } from "../../domain/navigation/views";
import { isTerminal, termSid } from "../../domain/navigation/keys";
import type { Settings } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { useNavigationStore } from "../navigation/store";
import { select, toast, hideToast, closeProjectPanel } from "../navigation/navigation";
import { request } from "../navigation/requests";
import { chatAgent, picks } from "../agents/agents";
import { saveMainSettings, settings } from "../settings/settings";
import { useWorkspaceStore } from "../workspace/store";
import { findProjects, project as vaultProject } from "../workspace/vault";
import { setIcon } from "../workspace/icons";
import { useConversationsStore } from "./store";
import { useDraftsStore } from "./drafts";
import {
  chatsOf,
  displayTitle,
  label,
  machineChoice,
  projectOf,
  selectedProject,
  terminalOf,
  terminalSessions,
} from "./selectors";
import { newChat, saveChats } from "./chats";
import { prepImages, releaseImages } from "./images";
import { fromPaths, pickedPaths } from "./attachments";
import { flush } from "./events";
import { pollAgents } from "./polls";

// What the user does with a conversation: typing, images, sending and stopping, the cards and questions, routing it
// to a project, closing and reopening, and Cmd-K. Most act on the open conversation.
const cs = () => useConversationsStore.getState();
const set = useConversationsStore.setState;
const drafts = () => useDraftsStore.getState();
const setDrafts = useDraftsStore.setState;
const selected = () => useNavigationStore.getState().selected;
const note = (key: string, text: string) => {
  flush();
  set(draft => {
    push(draft, key, { kind: "note", text });
  });
};

// ---------- the composer: what is typed per conversation, images waiting for the next send
/** What is typed in the open conversation; kept per conversation across switching and restarts. */
export function setTyped(value: string) {
  const key = selected();
  setDrafts(draft => {
    if (value) draft.typed[key] = value;
    else delete draft.typed[key];
  });
  storage.set("typed", drafts().typed);
  // a draft is named after what is typed until it is sent: only then does typing change the conversations
  const conversation = cs().chats[key];
  if (!conversation?.draft) return;
  if (!conversation.mail)
    set(draft => {
      draft.chats[key].title = value.trim().slice(0, 48) || NEW;
    });
  storage.set("sel", value ? key : WAIT);
  saveChats();
}
/** Text into a conversation's composer from elsewhere (a card's "Start conversation"): the draft keeps its title. */
export function typeInto(key: string, value: string) {
  setDrafts(draft => {
    draft.typed[key] = value;
  });
  storage.set("typed", drafts().typed);
  if (cs().chats[key]?.draft) {
    storage.set("sel", key);
    saveChats();
  }
}
/** Images pasted or dropped into the composer. Cmd-K keeps its own list: it uses `prepImages` itself. */
export async function attach(files: File[]) {
  const images = await prepImages(files);
  if (!images.length) return;
  setDrafts(draft => {
    draft.attached.push(...images);
  });
}
/** Files by their path (dropped, picked, pasted after a Finder copy): pictures join the images, the rest wait as paths. */
export async function attachPaths(paths: string[]) {
  const { images, files } = await fromPaths(paths);
  setDrafts(draft => {
    draft.attached.push(...images);
    draft.files.push(...files.filter(path => !draft.files.includes(path)));
  });
}
/** The + in the composer: the open dialog, its files attached by path. */
export const pickAndAttach = async () => attachPaths(await pickedPaths());
export function unattachFile(i: number) {
  setDrafts(draft => {
    draft.files.splice(i, 1);
  });
}
export function unattach(i: number) {
  const gone = drafts().attached[i];
  if (!gone) return;
  releaseImages([gone]);
  setDrafts(draft => {
    draft.attached.splice(i, 1);
  });
}

// ---------- sending
// typing in a terminal conversation: fork it into an app conversation under the same project
async function forkTerminalAndSend(text: string): Promise<void> {
  const from = selected();
  const session = terminalOf(from);
  if (!session) return;
  const key = newChat(session.project);
  set(draft => {
    // terminal sessions are Claude Code's
    Object.assign(draft.chats[key], { title: session.title, fork: session.sid, draft: false, provider: "claude" });
    draft.forked.push(session.sid);
    draft.messages[key] = [...(draft.messages[from] || []), { kind: "note", text: t("note.forked") }];
  });
  storage.set("forkedTerms", cs().forked);
  await select(key);
  return sendMsg(text);
}
// first message typed in a general conversation: if it names one project, it goes under that project
// (Cmd-K and the resend after the route question pass `forced`: they never move or ask here).
// True when several projects match and the user is asked instead.
function routeFirstMessage(key: string, text: string, forced?: string): boolean {
  const conversation = cs().chats[key];
  const first = !forced && !conversation.project && !(cs().messages[key] || []).length;
  if (!first) return false;
  const hits = findProjects(text);
  if (hits.length === 1)
    set(draft => {
      draft.chats[key].project = hits[0];
      push(draft, key, { kind: "note", text: t("note.moved", { name: hits[0] }) });
    });
  else if (hits.length > 1) {
    set(draft => {
      draft.routeChoice = { key, text, hits };
    });
    return true;
  }
  return false;
}
// the conversation's own state at its first send: no longer a draft, a title, an agent
function startConversation(key: string, text: string, files: string[]) {
  const provider = chatAgent(key);
  set(draft => {
    const conversation = draft.chats[key];
    if (conversation.title === NEW)
      conversation.title = (text || (files[0] ? fileName(files[0]) : t("chat.image"))).slice(0, 48);
    conversation.draft = false;
    conversation.at = Date.now();
    conversation.provider ||= provider;
  });
  saveChats();
}
// first message: a short generated title replaces the typed start, unless the user renamed it meanwhile
function generateTitle(key: string, typedTitle: string, text: string) {
  backend
    .aiTitle(text, chatAgent(key))
    .then(title => {
      if (cs().chats[key]?.title !== typedTitle) return;
      set(draft => {
        draft.chats[key].title = title;
      });
      saveChats();
    })
    .catch(() => {});
}
// the message shows up and the conversation is busy until its turn ends
function queueMessage(key: string, text: string, images: Img[], files: string[]) {
  flush();
  set(draft => {
    push(draft, key, {
      kind: "me",
      text,
      ...(images.length ? { imgs: images.map(image => image.url) } : {}),
      ...(files.length ? { files } : {}),
    });
    draft.status[key] = "busy";
    draft.queued[key] = (draft.queued[key] || 0) + 1;
  });
  if (key === selected()) request("scroll-bottom");
}
async function deliver(key: string, text: string, images: Img[], files: string[]) {
  const conversation = cs().chats[key];
  const name = `${conversation?.project || t("general")}: ${displayTitle(conversation?.title || key)}`;
  // the agent only hears the project through the message: with the first one, and again after a move
  const { sent, told, context, tookMail } = outgoing(conversation, text, project => vaultProject(project)?.context);
  if (tookMail) {
    set(draft => {
      delete draft.chats[key].mail;
    });
    saveChats();
  }
  try {
    if ((images.length || files.length) && refusesImages(chatAgent(key), text))
      throw new Error("This command does not accept attachments.");
    // ponytail: a machine cannot read this Mac's paths; upload the files over the connection when that is needed
    if (files.length && machineChoice(key).value) throw new Error(t("file.remote"));
    await backend.send({
      project: key,
      // attached files go as their paths after the message: the agent reads them where they are
      text: withFiles(sent, files),
      images: images.map(image => ({ media_type: image.mt, data: image.data })),
      name,
      fork: conversation?.fork ?? null,
      mail: !!conversation?.fromMail,
      model: picks("model", key).value,
      effort: picks("effort", key).value,
      provider: chatAgent(key),
      // where it runs, as the composer shows it; the backend only reads it at the first spawn
      machine: machineChoice(key).value,
      told: told || null,
      context: context || null,
    });
    if (told && cs().chats[key]) {
      set(draft => {
        draft.chats[key].told = told;
      });
      saveChats();
    }
  } catch (error) {
    set(draft => {
      push(draft, key, { kind: "err", text: String(error) });
      draft.queued[key] = Math.max(0, (draft.queued[key] || 1) - 1);
      draft.status[key] = draft.queued[key] ? "busy" : "idle";
    });
  }
}
// what is typed in the open conversation leaves the composer
function takeTyped() {
  const key = selected();
  setDrafts(draft => {
    delete draft.typed[key];
  });
  storage.set("typed", drafts().typed);
}
/** Send `forced`, or what is typed in the open conversation with its images and files. `to` sends to a conversation
 *  that is not open (Cmd-K) with its own: the composer, its attachments and the view stay as they are. */
export async function sendMsg(forced?: string, to?: string, toImgs: Img[] = [], toFiles: string[] = []): Promise<void> {
  const plan = planSend({ ...drafts(), outside: cs().outside }, selected(), forced, to, toImgs.length + toFiles.length);
  if (plan.kind === "nothing") return;
  if (plan.kind === "wait-outside") return note(plan.key, t("work.waitOutside"));
  if (plan.take) takeTyped();
  if (plan.kind === "fork") return forkTerminalAndSend(plan.text);
  const { key, text } = plan;
  if (cs().chats[key] && routeFirstMessage(key, text, forced)) return;
  const isFirst = !(cs().messages[key] || []).length;
  const images = to ? toImgs : drafts().attached;
  const files = to ? toFiles : drafts().files;
  if (cs().chats[key]) startConversation(key, text, files);
  if (cs().chats[key] && text && isFirst) generateTitle(key, cs().chats[key].title, text);
  if (!to)
    setDrafts(draft => {
      draft.attached = [];
      draft.files = [];
    });
  queueMessage(key, text, images, files);
  await deliver(key, text, images, files);
}
/** Stop the open conversation's running turn. */
const stopChat = () => {
  const key = selected();
  backend.stop(key);
  flush();
  set(draft => {
    draft.queued[key] = 0;
    draft.status[key] = "idle";
    push(draft, key, { kind: "note", text: t("note.stopped") });
  });
};
/** The send button: send, or stop the running turn. */
export const sendOrStop = () => (cs().status[selected()] === "busy" ? stopChat() : sendMsg());
/** The agent of the open conversation, before it starts. */
export function setAgent(id: string) {
  const key = selected();
  if (!cs().chats[key]) return;
  set(draft => {
    draft.chats[key].provider = id;
  });
  saveChats();
}
/** Moves the open conversation, between two turns, to another place: "" this Mac, or a machine id. Its next message
 *  goes on there; a note says where it went, or the error why it did not. */
export async function moveConversation(to: string) {
  const key = selected();
  const conversation = cs().chats[key];
  if (!conversation) return;
  const place = to ? (cs().machineList.find(machine => machine.id === to)?.name ?? to) : t("composer.thisMac");
  try {
    await backend.moveConversation(key, to, !!conversation.fromMail);
    note(key, t("note.movedTo", { name: place }));
  } catch (error) {
    set(draft => {
      push(draft, key, { kind: "err", text: String(error) });
    });
  }
  await pollAgents();
}
/** Where the open conversation is to run, before it starts: "" this Mac, or a machine id. */
export function setMachine(id: string) {
  const key = selected();
  setDrafts(draft => {
    draft.machine[key] = id;
  });
}
/** The open conversation's title, edited in place. Empty keeps the old one. */
export function rename(title: string) {
  const key = selected();
  if (!cs().chats[key] || !title.trim()) return;
  set(draft => {
    draft.chats[key].title = title.trim();
  });
  saveChats();
}

// ---------- a general conversation that names several projects: the user picks one, or keeps it general
export function routeTo(name: string) {
  const choice = cs().routeChoice;
  if (!choice) return;
  set(draft => {
    draft.routeChoice = null;
    if (name) {
      draft.chats[choice.key].project = name;
      push(draft, choice.key, { kind: "note", text: t("note.moved", { name }) });
    }
  });
  sendMsg(choice.text);
}
/** The bar that asks whether a general conversation is about a project: yes moves it, no hides the question. */
export function moveTo(project: string | null) {
  const key = selected();
  set(draft => {
    if (project) {
      draft.chats[key].project = project;
      push(draft, key, { kind: "note", text: t("note.moved", { name: project }) });
    } else draft.dismissed.add(key);
  });
  if (project) saveChats();
}
/** The Cmd-K question's project offer, answered once: move the open conversation there, or keep it general (""). */
export function answerAsk(project: string) {
  set(draft => {
    delete draft.chats[selected()].ask;
  });
  moveTo(project || null);
  saveChats();
}

// ---------- permission and question cards
/** A card's answer. Resolves false when a question had nothing answered (the card stays). */
export async function answer(request: Pending, choice: CardChoice) {
  const decision = decisionOf(request, choice);
  if (!decision) return false;
  await backend.answer(request.id, decision);
  set(draft => {
    if (choice === "allow" || choice === "deny") {
      const { command, file_path } = request.input;
      push(draft, request.project, {
        kind: choice === "allow" ? "allowed" : "denied",
        text: String(command ?? file_path ?? request.tool_name),
      });
    }
    draft.pendingList = draft.pendingList.filter(x => x.id !== request.id);
  });
  return true;
}
/** A waiting background session: hide it here, stop it, or open it in the terminal. */
export async function backgroundAction(action: "hide" | "stop" | "attach", id: string) {
  if (action === "hide") {
    set(draft => {
      draft.hidden.push(id);
    });
    storage.set("hiddenAgents", cs().hidden);
    return;
  }
  await backend.backgroundSession(action, id);
  if (action === "stop")
    set(draft => {
      draft.agentsList = draft.agentsList.filter(agent => agent.id !== id);
    });
}
/** The terminal button: a terminal session opens in iTerm, an app conversation resumes there. */
export function openTerminal() {
  const key = selected();
  if (key === WAIT || cs().chats[key]?.fromMail) return;
  if (isTerminal(key)) {
    const session = terminalOf(key);
    if (session) backend.backgroundSession("attach", session.id);
    return;
  }
  backend.openTerminal(key, null, `${projectOf(key) || t("general")}: ${label(key)}`);
  set(draft => {
    draft.queued[key] = 0;
    draft.status[key] = "idle";
  });
}

// ---------- closing hides a conversation from the sidebar. An app conversation stops but keeps its session, a
// terminal session keeps running in the terminal. Both come back via the undo bar or right-click > Heropen.
async function hide(key: string) {
  if (isTerminal(key)) {
    set(draft => {
      draft.forked.push(termSid(key));
    });
    storage.set("forkedTerms", cs().forked);
    return null;
  }
  if (!cs().chats[key]) return null;
  // the sidebar greys the row out while this runs
  set(draft => {
    draft.closing.add(key);
  });
  let worktrees;
  try {
    await backend.stop(key);
    // the git worktrees this conversation made go with it, the ones with work git would lose stay
    worktrees = await backend.dropWorktrees(key).catch(() => null);
  } finally {
    set(draft => {
      draft.closing.delete(key);
    });
  }
  set(draft => {
    draft.chats[key].closed = Date.now();
    delete draft.status[key];
    delete draft.queued[key];
  });
  saveChats();
  return worktrees;
}
const worktreeNote = (removed: number, kept: number) =>
  (removed ? ` · ${tn("toast.worktreesRemoved", removed)}` : "") +
  (kept ? ` · ${tn("toast.worktreesKept", kept)}` : "");
export async function closeChat(key: string) {
  if (cs().closing.has(key)) return;
  const title = isTerminal(key) ? terminalOf(key)?.title : label(key);
  const worktrees = await hide(key);
  toast(t("toast.closed", { title: title ?? "" }) + worktreeNote(worktrees?.removed ?? 0, worktrees?.kept ?? 0), () =>
    reopen(key),
  );
  if (selected() !== key) return;
  const project = isTerminal(key) ? null : projectOf(key);
  const neighbour = project ? chatsOf(project)[0] : undefined;
  await select(neighbour ? neighbour.key : WAIT);
}
/** Right-click on Algemeen or a project > close all: every open conversation and terminal session under it, one undo. */
export async function closeAll(project: string | null) {
  const keys = [
    ...chatsOf(project).map(conversation => conversation.key),
    ...terminalSessions()
      .filter(session => session.project === project)
      .map(session => session.key),
  ];
  let removed = 0;
  let kept = 0;
  // all of them grey out at once, each goes when its turn is done
  set(draft => {
    for (const key of keys) if (draft.chats[key]) draft.closing.add(key);
  });
  for (const key of keys) {
    const worktrees = await hide(key);
    removed += worktrees?.removed ?? 0;
    kept += worktrees?.kept ?? 0;
  }
  toast(tn("toast.closedAll", keys.length) + worktreeNote(removed, kept), () => {
    const sids = keys.filter(isTerminal).map(termSid);
    set(draft => {
      draft.forked = draft.forked.filter(sid => !sids.includes(sid));
      for (const key of keys) if (draft.chats[key]) delete draft.chats[key].closed;
    });
    storage.set("forkedTerms", cs().forked);
    saveChats();
    hideToast();
  });
  if (keys.includes(selected())) await select(WAIT);
}
export async function reopen(key: string) {
  if (isTerminal(key)) {
    set(draft => {
      draft.forked = draft.forked.filter(sid => sid !== termSid(key));
    });
    storage.set("forkedTerms", cs().forked);
  } else if (cs().chats[key]) {
    set(draft => {
      delete draft.chats[key].closed;
    });
    saveChats();
  }
  hideToast();
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
export const ctrlC = () => (cs().status[selected()] === "busy" ? stopChat() : setTyped(""));

// ---------- Cmd-K: a question that becomes a new general conversation in the background, the open screen stays.
// It always starts general; the projects it names are offered once in the conversation afterwards.
export function quickSend(text: string, imgs: Img[], files: string[] = []) {
  const key = newChat(null);
  const hits = findProjects(text);
  if (hits.length)
    set(draft => {
      draft.chats[key].ask = hits;
    });
  sendMsg(text, key, imgs, files);
  toast(
    t("toast.started", { text: (text || (files[0] ? fileName(files[0]) : t("chat.image"))).slice(0, 60) }),
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
  const key = selected();
  if (isTerminal(key)) next.overrides[termSid(key)] = project;
  else if (cs().chats[key]) {
    set(draft => {
      draft.chats[key].project = project;
    });
    saveChats();
  }
}
// the label stays in the app's settings, the icon goes to the vault; cleared, the favicon run guesses again
async function saveProjectFields(next: Settings, project: string, fields: ProjectFields) {
  if (fields.label) next.projects[project] = { label: fields.label };
  else delete next.projects[project];
  const was = useWorkspaceStore.getState().icons[project];
  if (fields.img && fields.img !== was?.img) await setIcon(project, "img", fields.img);
  else if (!fields.img && fields.emoji && fields.emoji !== was?.icon) await setIcon(project, "emoji", fields.emoji);
  else if (!fields.img && !fields.emoji && (was?.img || was?.icon)) await setIcon(project, "reset");
}
/** The open conversation to `project`, and the icon and name of the project it was under. `img` an image data url,
 *  else `emoji`; empty both resets the icon so the favicon run guesses again. Resolves with an error to show, or "". */
export async function saveProjectPanel(project: string | null, fields?: ProjectFields): Promise<string> {
  const next = structuredClone(settings());
  const iconProject = selectedProject(); // the project the icon fields belong to
  assignProject(next, project);
  if (iconProject && fields) {
    try {
      await saveProjectFields(next, iconProject, fields);
    } catch (error) {
      return String(error);
    }
  }
  const failed = await saveMainSettings(next);
  if (failed) return failed;
  closeProjectPanel();
  return "";
}

// ---------- the agents of the open conversation, above the composer
/** A click on an agent unfolds its last messages, a second click folds them. */
export async function toggleSubLog(id: string) {
  if (cs().subLog[id]) {
    set(draft => {
      delete draft.subLog[id];
    });
    return;
  }
  const log = await backend.agentLog(selected(), id);
  set(draft => {
    draft.subLog[id] = log;
  });
}
/** The finished agents of the open conversation, folded away or shown. */
export function toggleSubsDone() {
  const key = selected();
  set(draft => {
    if (draft.subsOpen.has(key)) draft.subsOpen.delete(key);
    else draft.subsOpen.add(key);
  });
}
