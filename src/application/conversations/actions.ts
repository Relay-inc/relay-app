import { t, tn } from "../../shared/i18n";
import type { Img, Item, Pending, CardChoice } from "../../domain/conversations/types";
import {
  NEW,
  changesVault,
  decisionOf,
  hasStarted,
  pickedVault,
  sameVaultProjects,
  waitsForPickup,
} from "../../domain/conversations/rules";
import { push, releaseWaiting } from "../../domain/conversations/events";
import { outgoing, planSend, refusesImages } from "../../domain/conversations/send";
import { fileName, withFiles } from "../../domain/conversations/files";
import { WAIT } from "../../domain/navigation/views";
import { isTerminal, termSid } from "../../domain/navigation/keys";
import { ORCH } from "../../domain/orchestrator/rules";
import type { Settings } from "../../domain/settings/types";
import { repoWorkOf } from "../../domain/settings/machines";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { useNavigationStore } from "../navigation/store";
import { addTerminal } from "../terminals/terminals";
import { select, toast, hideToast, closeProjectPanel } from "../navigation/navigation";
import { request } from "../navigation/requests";
import { chatAgent, chatCaps, chatTextOnly, picks } from "../agents/agents";
import { saveMainSettings, settings } from "../settings/settings";
import { useWorkspaceStore } from "../workspace/store";
import { findProjects, project as vaultProject, projectName } from "../workspace/vault";
import { setIcon } from "../workspace/icons";
import { useConversationsStore } from "./store";
import { useDraftsStore } from "./drafts";
import {
  chatsOf,
  displayTitle,
  label,
  machineChoice,
  machineRepo,
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
import { phoneCommand, setPhoneShare } from "./phoneShare";
import { captureOnClose } from "../today/capture";

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
// (Cmd-K and the resend after the route question pass `forced`: they never move or ask here, nor does the orchestrator).
// True when several projects match and the user is asked instead.
function routeFirstMessage(key: string, text: string, forced?: string): boolean {
  const conversation = cs().chats[key];
  const first = !forced && key !== ORCH && !conversation.project && !(cs().messages[key] || []).length;
  if (!first) return false;
  // only a project of the vault it runs in: the vault picked for it stays the one it runs in
  const here = sameVaultProjects(useWorkspaceStore.getState().snap, conversation.vault).map(project => project.name);
  const hits = findProjects(text).filter(name => here.includes(name));
  if (hits.length === 1)
    set(draft => {
      draft.chats[key].project = hits[0];
      push(draft, key, { kind: "note", text: t("note.moved", { name: projectName(hits[0]) }) });
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
    // chatAgent's pick, also over one made before the draft moved into a vault that runs Claude Code only
    conversation.provider = provider;
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
// the message shows up and the conversation is busy until its turn ends. Claude Code says when it takes a message
// up (a message sent during a turn often joins it): until then the message waits below the conversation
function queueMessage(key: string, text: string, images: Img[], files: string[]) {
  flush();
  set(draft => {
    const item: Item = {
      kind: "me",
      text,
      at: Date.now(),
      ...(images.length ? { imgs: images.map(image => image.url) } : {}),
      ...(files.length ? { files } : {}),
    };
    if (waitsForPickup(chatCaps(key))) (draft.waiting[key] ||= []).push(item);
    else push(draft, key, item);
    draft.status[key] = "busy";
    draft.queued[key] = (draft.queued[key] || 0) + 1;
  });
  if (key === selected()) request("scroll-bottom");
}
async function deliver(key: string, text: string, images: Img[], files: string[]) {
  // a message sent before the limit reset replaces the retry waiting for it
  if (cs().retries[key]) backend.retryCancel(key);
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
    if ((images.length || files.length) && refusesImages(chatTextOnly(key), text))
      throw new Error("This command does not accept attachments.");
    // ponytail: a machine cannot read this Mac's paths; upload the files over the connection when that is needed
    if (files.length && machineChoice(key).value) throw new Error(t("file.remote"));
    await readyRepo(key);
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
      about: conversation?.project ?? null,
      context: context || null,
      // the vault picked for a general conversation, a project's runs in its project's vault
      vault: (!conversation?.project && conversation?.vault) || null,
    });
    if (told && cs().chats[key]) {
      set(draft => {
        draft.chats[key].told = told;
      });
      saveChats();
    }
  } catch (error) {
    set(draft => {
      // it never reached the agent: it shows where it was sent, with why
      const item = draft.waiting[key]?.pop();
      if (item) push(draft, key, item);
      push(draft, key, { kind: "err", text: String(error) });
      draft.queued[key] = Math.max(0, (draft.queued[key] || 1) - 1);
      draft.status[key] = draft.queued[key] ? "busy" : "idle";
    });
  }
}
// The first start on a machine of a conversation whose project has a repo: that repo is cloned there, or fetched, before
// the message goes (a clone may take minutes), and its start gives the agent the folder. Once per conversation and run,
// a message sent meanwhile waits for the same. A failure only leaves a note: the conversation starts without the repo.
const readied = new Map<string, Promise<void>>();
function readyRepo(key: string) {
  const work = machineRepo(key);
  if (!work || work.started || cs().chats[key]?.fork) return readied.get(key);
  if (!readied.has(key))
    readied.set(
      key,
      backend.machineRepoEnsure(work.id, key, work.slug).then(
        () => {},
        error => note(key, t("note.repoNotReady", { repo: work.repo, machine: work.machine, error: String(error) })),
      ),
    );
  return readied.get(key);
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
  // Relay's own commands, typed in the open conversation: handled here, the agent never hears them
  const share = forced === undefined && !to ? phoneCommand(drafts().typed[selected()] ?? "") : null;
  if (share !== null) {
    const key = selected();
    const conversation = cs().chats[key];
    takeTyped();
    return note(
      key,
      await setPhoneShare(key, share, displayTitle(conversation?.title || ""), !!conversation?.fromMail),
    );
  }
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
  if (cs().chats[key] && text && isFirst && key !== ORCH) generateTitle(key, cs().chats[key].title, text);
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
    releaseWaiting(draft, key);
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
 *  goes on there; a note says where it went, or the error why it did not. Back to this Mac with repo work left on the
 *  machine, a bar asks first (`answerRepoWork`); `choice` is that answer. */
export async function moveConversation(to: string, choice: "push" | "move" | null = null) {
  const key = selected();
  const conversation = cs().chats[key];
  if (!conversation) return;
  const place = to ? (cs().machineList.find(machine => machine.id === to)?.name ?? to) : t("composer.thisMac");
  try {
    await backend.moveConversation(key, to, !!conversation.fromMail, conversation.project, choice);
    note(key, t("note.movedTo", { name: place }));
  } catch (error) {
    const work = repoWorkOf(error);
    set(draft => {
      if (work) draft.repoWork[key] = { ...work, to };
      else push(draft, key, { kind: "err", text: String(error) });
    });
  }
  await pollAgents();
}
/** The bar's answer for the open conversation: push the repo work to its branch and move, move anyway, or (null) stay. */
export async function answerRepoWork(choice: "push" | "move" | null) {
  const key = selected();
  const work = cs().repoWork[key];
  if (!work || !choice)
    return set(draft => {
      delete draft.repoWork[key];
    });
  // the bar waits while the work is pushed and the conversation moves
  set(draft => {
    draft.repoWork[key].busy = true;
  });
  await moveConversation(work.to, choice);
  // moved, or failed with the error under the log: the bar goes, unless the move was refused again (a new bar)
  set(draft => {
    if (draft.repoWork[key]?.busy) delete draft.repoWork[key];
  });
}
/** The vault the open general conversation is to run in, before it starts (a vault folder). A project's conversation
 *  runs in its project's vault: the pick is fixed there. */
export function setVault(folder: string) {
  const key = selected();
  const conversation = cs().chats[key];
  if (!conversation || conversation.project || hasStarted(cs(), key)) return;
  set(draft => {
    const vault = pickedVault(folder, useWorkspaceStore.getState().snap.vault?.vault ?? "");
    if (vault) draft.chats[key].vault = vault;
    else delete draft.chats[key].vault;
  });
  saveChats();
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
      push(draft, choice.key, { kind: "note", text: t("note.moved", { name: projectName(name) }) });
    }
  });
  sendMsg(choice.text);
}
/** Whether moving conversation `key` to project `to` takes it into another vault after it started: refused, it keeps
 *  running in the vault it started in (src-tauri `fence`). */
const leavesVault = (key: string, to: string | null) =>
  !isTerminal(key) &&
  hasStarted(cs(), key) &&
  changesVault(useWorkspaceStore.getState().snap, cs().chats[key]?.project ?? null, to, cs().chats[key]?.vault);
const refuseMove = () => toast(t("toast.otherVault"), undefined, undefined, 6000);
/** The bar that asks whether a general conversation is about a project: yes moves it, no hides the question. */
export function moveTo(project: string | null) {
  const key = selected();
  if (leavesVault(key, project)) return refuseMove();
  set(draft => {
    if (project) {
      draft.chats[key].project = project;
      push(draft, key, { kind: "note", text: t("note.moved", { name: projectName(project) }) });
    } else draft.dismissed.add(key);
  });
  if (project) saveChats();
}
/** A conversation dragged in the sidebar to a project (null for Algemeen) and a folder there ("" for none). Under
 *  another project it gets the note the project panel gives, and its next message tells the agent. A terminal session
 *  moves through the settings' overrides and sits in no folder. False when it was refused. */
export async function moveChat(key: string, project: string | null, folder: string) {
  if (isTerminal(key)) {
    if (terminalOf(key)?.project === project) return true;
    const next = structuredClone(settings());
    next.overrides[termSid(key)] = project;
    await saveMainSettings(next);
    return true;
  }
  const conversation = cs().chats[key];
  if (!conversation || (conversation.project === project && (conversation.folder ?? "") === folder)) return true;
  if (leavesVault(key, project)) {
    refuseMove();
    return false;
  }
  set(draft => {
    const moved = draft.chats[key];
    if (moved.project !== project)
      push(draft, key, { kind: "note", text: t("note.moved", { name: projectName(project) }) });
    moved.project = project;
    if (folder) moved.folder = folder;
    else delete moved.folder;
  });
  saveChats();
  return true;
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
    if (typeof choice === "string") {
      const { command, file_path } = request.input;
      push(draft, request.project, {
        kind: choice === "deny" ? "denied" : "allowed",
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
/** The terminal button: a terminal session opens in iTerm. An app conversation resumes in the project's terminal
 *  drawer, or in iTerm with `external` (Option-click) or without a project (the drawer belongs to a project). */
export function openTerminal(external = false) {
  const key = selected();
  if (key === WAIT || cs().chats[key]?.fromMail) return;
  if (isTerminal(key)) {
    const session = terminalOf(key);
    if (session) backend.backgroundSession("attach", session.id);
    return;
  }
  const project = projectOf(key);
  const name = `${projectName(project)}: ${label(key)}`;
  if (external || !project)
    backend.openTerminal(key, null, name, project, (!project && cs().chats[key]?.vault) || null);
  else {
    useNavigationStore.setState(draft => {
      draft.drawer = "terminal";
    });
    addTerminal(project, { key, name, title: label(key) }).catch(e => toast(String(e)));
  }
  set(draft => {
    releaseWaiting(draft, key);
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
    delete draft.waiting[key];
    delete draft.taken[key];
  });
  saveChats();
  // what it leaves for the vault, written straight in (application/today/capture)
  captureOnClose(key);
  return worktrees;
}
const worktreeNote = (removed: number, kept: number) =>
  (removed ? ` · ${tn("toast.worktreesRemoved", removed)}` : "") +
  (kept ? ` · ${tn("toast.worktreesKept", kept)}` : "");
export async function closeChat(key: string) {
  if (cs().closing.has(key) || key === ORCH) return; // the coordinator is permanent
  const title = isTerminal(key) ? terminalOf(key)?.title : label(key);
  if (cs().retries[key]) backend.retryCancel(key);
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
/** Cmd-Shift-T: the conversation closed last comes back, like a browser tab. */
export async function reopenLast() {
  const closed = Object.values(cs().chats).filter(conversation => conversation.closed);
  const last = closed.sort((newer, older) => older.closed! - newer.closed!)[0];
  if (last) await reopen(last.key);
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
  if (leavesVault(selected(), project)) return t("toast.otherVault");
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
/** The finished agents of the open conversation, folded away or shown. */
export function toggleSubsDone() {
  const key = selected();
  set(draft => {
    if (draft.subsOpen.has(key)) draft.subsOpen.delete(key);
    else draft.subsOpen.add(key);
  });
}
