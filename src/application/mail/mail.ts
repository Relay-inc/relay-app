import { t } from "../../shared/i18n";
import { urlOk } from "../../shared/markdown";
import { mailKey, isMailKey } from "../../domain/navigation/keys";
import type { Mail, MailBox, MailFilter } from "../../domain/mail/types";
import {
  PAGE_SIZE,
  sender,
  unread as unreadOf,
  projectText,
  withFirstPage,
  filtered as filterMails,
  mailReference,
  mailChatTitle,
  draftPrompt,
  mailBox,
  toggleSelection,
  allSelected,
  nextOpen,
} from "../../domain/mail/rules";
import { newestFirst, visible } from "../../domain/mail/merge";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { mailExperimental, mailOn, settings } from "../settings/settings";
import { findProjects, projectLabel } from "../workspace/vault";
import { useWorkspaceStore } from "../workspace/store";
import { useNavigationStore } from "../navigation/store";
import { select } from "../navigation/navigation";
import { closeMail, forgetDetails, openMail } from "../navigation/panel";
import { startChat } from "../conversations/chats";
import { sendMsg } from "../conversations/actions";
import { useMailStore } from "./store";

// The inbox (domain/mail), every account merged. Refreshed every 5 minutes and on opening the view. Nothing here sends
// a mail; archive and delete only run on the user's click or key, with the experimental mail flag on.
const ms = () => useMailStore.getState();
const set = useMailStore.setState;
// the mail shown next to the list (Lit read panel.open here, which no longer holds a mail: its text toggle and link bar were dead)
const openKey = () => useNavigationStore.getState().panel.mailOpen;

const accountList = () => (settings().mail.accounts ?? []).map(account => account.email);
// per account: ended once a page came back short. One never loaded (it failed) counts as ended: a reload retries it
const hasMore = (account: string) => ms().pages[account] > 0 && !ms().end[account];
/** Whether every account has shown its oldest mail. */
export const mailEnded = () => !accountList().some(hasMore);
// the merged list as shown: complete down to the edge of the accounts that still have older pages
const visibleMails = (list: Mail[]) =>
  visible(list, Object.fromEntries(accountList().map(account => [account, hasMore(account)])));
// "account: error" per failed account, one line each
const errorLines = (accounts: string[], results: PromiseSettledResult<unknown>[]) =>
  results.flatMap((result, i) => (result.status === "rejected" ? [`${accounts[i]}: ${result.reason}`] : [])).join("\n");

/** Once Mail is switched on in the settings: the newest page of every account. */
export async function loadMails() {
  const accounts = accountList();
  if (!mailOn() || ms().busy || !accounts.length) return;
  set(draft => {
    draft.busy = true;
  });
  const generation = ms().gen;
  const moves = ms().moves;
  const results = await Promise.allSettled(accounts.map(account => backend.mailList(account, 1)));
  if (generation !== ms().gen || moves !== ms().moves) {
    set(draft => {
      draft.busy = false;
    });
    loadMails();
    return;
  }
  set(draft => {
    results.forEach((result, i) => {
      if (result.status !== "fulfilled") return;
      const account = accounts[i];
      draft.list = withFirstPage(draft.list, account, result.value);
      if (!draft.pages[account]) {
        draft.pages[account] = 1;
        draft.end[account] = result.value.length < PAGE_SIZE;
      }
    });
    draft.err = errorLines(accounts, results);
    draft.busy = false;
  });
  pruneSelection();
}
// the next 50 of every account that has more, merged in. ponytail: a mail archived meanwhile shifts the pages, so one at
// the border can be skipped until a reload
export async function moreMails() {
  const accounts = accountList().filter(hasMore);
  if (ms().more || !accounts.length || !ms().list) return;
  set(draft => {
    draft.more = true;
  });
  const generation = ms().gen;
  const moves = ms().moves;
  const results = await Promise.allSettled(accounts.map(account => backend.mailList(account, ms().pages[account] + 1)));
  set(draft => {
    if (generation === draft.gen && moves === draft.moves && draft.list) {
      const known = new Set(draft.list.map(mailKey));
      const added: Mail[] = [];
      results.forEach((result, i) => {
        if (result.status !== "fulfilled") return;
        draft.pages[accounts[i]]++;
        draft.end[accounts[i]] = result.value.length < PAGE_SIZE;
        added.push(...result.value.filter(message => !known.has(mailKey(message))));
      });
      draft.list = newestFirst([...draft.list, ...added]);
      draft.err = errorLines(accounts, results);
    }
    draft.more = false;
  });
}
/** The mail state from before a settings change is dropped: answers still on their way are ignored. */
export function resetMail() {
  set(draft => {
    draft.gen++;
    draft.textView.clear();
    draft.selected.clear();
    draft.link = "";
    draft.list = null;
    draft.err = "";
    draft.pages = {};
    draft.end = {};
  });
  forgetDetails(isMailKey);
}
export const setMailFilter = (patch: Partial<MailFilter>) => {
  set(draft => {
    draft.filter = { ...draft.filter, ...patch };
  });
  storage.set("mailFilter", { state: ms().filter.state, project: ms().filter.project, box: ms().filter.box });
  pruneSelection();
};
// the guess per mail, for the projects it was made against: the inbox asks it for every mail on every store change
let guessedFor: unknown = null;
let guesses = new WeakMap<Mail, string | null>();
/** The project a mail is about: one project named in the subject, the sender or the sender's domain, else none. */
const mailProject = (message: Mail) => {
  const projects = useWorkspaceStore.getState().snap.projects;
  if (projects !== guessedFor) {
    guessedFor = projects;
    guesses = new WeakMap();
  }
  let name = guesses.get(message);
  if (name === undefined) {
    const hits = findProjects(projectText(message));
    name = hits.length === 1 ? hits[0] : null;
    guesses.set(message, name);
  }
  return name;
};
/** The mails that pass the search, read state and project filter, and with the experimental flag the box. */
const filtered = (list: Mail[], filter: MailFilter) => filterMails(list, filter, mailProject, mailExperimental());
/** The inbox as the view shows it: the mails that pass the filters with their project's label and, with more than one
 *  account, their account ("" for none), how many are shown and unread, whether every account showed its oldest mail,
 *  and the projects to filter on (those of the mails, plus the one filtered on even when no mail has it). */
export function inbox() {
  const { list: all, filter } = ms();
  const list = all && visibleMails(all);
  const split = mailExperimental();
  const several = accountList().length > 1;
  const projectOf = (message: Mail) => {
    const name = mailProject(message);
    return name ? projectLabel(name) : "";
  };
  const shown = list
    ? filtered(list, filter).map(message => ({
        mail: message,
        project: projectOf(message),
        account: several ? message.account : "",
      }))
    : [];
  const names = new Set((list || []).map(mailProject).filter((name): name is string => !!name));
  const projects = [...names].sort();
  if (filter.project && filter.project !== "-" && !names.has(filter.project)) projects.push(filter.project);
  const unreadIn = (box: MailBox) => (list || []).filter(x => mailBox(x, true) === box && unreadOf(x)).length;
  return {
    shown,
    split,
    boxUnread: split ? { inbox: unreadIn("inbox"), other: unreadIn("other") } : { inbox: 0, other: 0 },
    total: list?.length ?? 0,
    unread: (list || []).filter(unreadOf).length,
    ended: mailEnded(),
    projects: projects.map((name): [string, string] => [name, projectLabel(name)]),
  };
}
// read or unread on the user's click: the list follows at once, a failure puts it back and shows why
export async function mailSeen(key: string, seen: boolean) {
  const target = ms().list?.find(x => mailKey(x) === key);
  if (!target) return;
  const flag = (unread: boolean) =>
    set(draft => {
      draft.list = draft.list!.map(x => (mailKey(x) === key ? { ...x, unread } : x));
    });
  flag(!seen);
  // the read filter can hide the mail now: a ticked one leaves the selection, E and # never act on what is hidden
  pruneSelection();
  try {
    await backend.mailSeen(target.account, target.id, seen);
    set(draft => {
      draft.err = "";
    });
  } catch (e) {
    flag(seen);
    pruneSelection();
    set(draft => {
      draft.err = String(e);
    });
  }
}

// ---------- experimental: the selection, archive and delete
/** The keys of the mails on screen, in order: what a range, select all and "the next mail" go by. */
const shownMailKeys = () => {
  const all = ms().list;
  return all ? filtered(visibleMails(all), ms().filter).map(mailKey) : [];
};
/** A selection never reaches mails you cannot see: another box, a filter or a reload hid them. */
function pruneSelection() {
  const shown = new Set(shownMailKeys());
  if ([...ms().selected].every(k => shown.has(k))) return;
  set(draft => {
    for (const k of draft.selected) if (!shown.has(k)) draft.selected.delete(k);
  });
}
/** Tick or untick a mail; `range` (shift) ticks everything between the last one ticked and this one. */
export function toggleMailSelect(key: string, range: boolean) {
  const selected = toggleSelection(ms().selected, ms().anchor, key, range, shownMailKeys());
  set(draft => {
    draft.selected = selected;
    draft.anchor = key;
  });
}
/** All mails on screen ticked, or none when they already all are. */
export function toggleMailSelectAll() {
  const shown = shownMailKeys();
  const all = allSelected(ms().selected, shown);
  set(draft => {
    draft.selected = new Set(all ? [] : shown);
  });
}
/** Whether every mail on screen is ticked. */
export const allMailsSelected = () => allSelected(ms().selected, shownMailKeys());
export function clearMailSelection() {
  if (!ms().selected.size) return;
  set(draft => {
    draft.selected = new Set();
  });
}
/** Read or unread for every ticked mail, one after the other (the backend takes one mail per call). */
export async function mailSeenSelected(seen: boolean) {
  for (const key of [...ms().selected]) await mailSeen(key, seen);
}
/** What a key acts on: the ticked mails, else the open one. */
export const mailTargets = () => {
  const { selected } = ms();
  if (selected.size) return [...selected];
  return openKey() ? [openKey()] : [];
};
/** Archive (Gmail drops the Inbox label, other servers move to Archive) or delete (to Trash) the given mails. The list
 *  follows at once and the open mail makes way for the next one on screen; a failure puts the mails back.
 *  ponytail: no undo toast, the server's Archive/Trash hold them if one was wrong. */
export async function mailMove(keys: string[], trash: boolean) {
  const gone = new Set(keys);
  const moving = (ms().list || []).filter(x => gone.has(mailKey(x)));
  if (!moving.length || !mailExperimental()) return;
  const open = openKey();
  if (gone.has(open)) {
    const next = nextOpen(shownMailKeys(), open, gone);
    if (next) openMail(next);
    else closeMail();
  }
  set(draft => {
    draft.moves++;
    draft.list = draft.list!.filter(x => !gone.has(mailKey(x)));
    for (const k of keys) draft.selected.delete(k);
  });
  // per account, at most MOVE_MAX mails per call (the backend's limit): Cmd-A over several pages can tick more
  const byAccount = new Map<string, Mail[]>();
  for (const x of moving) byAccount.set(x.account, [...(byAccount.get(x.account) ?? []), x]);
  const chunks = [...byAccount.values()].flatMap(mails =>
    Array.from({ length: Math.ceil(mails.length / MOVE_MAX) }, (_, i) => mails.slice(i * MOVE_MAX, (i + 1) * MOVE_MAX)),
  );
  const results = await Promise.allSettled(
    chunks.map(mails =>
      backend.mailMove(
        mails[0].account,
        mails.map(x => x.id),
        trash,
      ),
    ),
  );
  const back = chunks.filter((_, i) => results[i].status === "rejected").flat();
  const error = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  const failure = error ? String(error.reason) : "";
  set(draft => {
    if (failure && draft.list) {
      const known = new Set(draft.list.map(mailKey));
      draft.list = newestFirst([...draft.list, ...back.filter(x => !known.has(mailKey(x)))]);
      draft.err = failure;
    } else if (draft.err && draft.err === moveError) draft.err = ""; // only our own last failure, not a load error
  });
  if (failure) moveError = failure;
}
const MOVE_MAX = 500;
// the error the last failed move showed, which a move that works clears again
let moveError = "";
// the last click was in the list, not the mail: Cmd-A ticks mails instead of selecting text
let inList = true;
export const setMailPane = (list: boolean) => {
  inList = list;
};
export const mailListActive = () => inList;

/** The open mail as text (what the agent reads) or as its html. */
export function toggleMailText() {
  const key = openKey();
  set(draft => {
    if (draft.textView.has(key)) draft.textView.delete(key);
    else draft.textView.add(key);
  });
}
/** The link waiting for the user's go is dropped (another detail opened). */
export const clearMailLink = () =>
  set(draft => {
    draft.link = "";
  });
/** A link clicked inside a mail (the sandboxed frame reports it through the backend) waits for the user's go. */
export function mailLinkClicked(url: string) {
  if (!isMailKey(openKey()) || !urlOk(url)) return;
  set(draft => {
    draft.link = url;
  });
}
export function mailLinkGo(open: boolean) {
  const url = ms().link;
  set(draft => {
    draft.link = "";
  });
  if (open && urlOk(url)) backend.openUrl(url);
}
// the settings window opens on Integrations › Mail (it reads its pane from the shared UI state when it starts)
export async function openMailSetup() {
  await storage.setRaw("prefsTab", "integrations");
  await storage.setRaw("prefsAcct", "mail");
  backend.openSettingsWindow();
}
/** A conversation about the open mail, under its project. The agent reads the mail itself through the relay-mail
 *  tools, so the whole thread and its attachments are there. "talk" waits for the user's question, "draft" asks for a
 *  reply as a draft right away. Sending stays with the user (decided 29/9). */
export async function mailChat(key: string, how: "talk" | "draft") {
  const target = ms().list?.find(x => mailKey(x) === key);
  if (!target) return;
  const reference = mailReference(target);
  const chatKey = startChat(mailProject(target), {
    title: mailChatTitle(target, how, t("mail.noSubject")),
    note: t("note.mailStarted", { from: sender(target), subject: target.subject }),
    fromMail: true,
    // goes in front of the first message the user sends
    ...(how === "talk" ? { mail: reference } : {}),
  });
  await select(chatKey);
  if (how === "draft") sendMsg(draftPrompt(reference));
}
