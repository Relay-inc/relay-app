import { t } from "../../shared/i18n";
import { urlOk } from "../../shared/markdown";
import { mailKey, isMailKey } from "../../domain/navigation/keys";
import type { Mail, MailFilter } from "../../domain/mail/types";
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
} from "../../domain/mail/rules";
import { newestFirst, visible } from "../../domain/mail/merge";
import * as backend from "../../infrastructure/backend";
import { storage } from "../../infrastructure/storage";
import { mailOn, settings } from "../settings/settings";
import { findProjects, projectLabel } from "../workspace/vault";
import { useWorkspaceStore } from "../workspace/store";
import { useNavigationStore } from "../navigation/store";
import { select } from "../navigation/navigation";
import { forgetDetails } from "../navigation/panel";
import { startChat } from "../conversations/chats";
import { sendMsg } from "../conversations/actions";
import { useMailStore } from "./store";

// The inbox (domain/mail), every account merged. Refreshed every 5 minutes and on opening the view. Nothing here sends
// or moves a mail.
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
  const results = await Promise.allSettled(accounts.map(account => backend.mailList(account, 1)));
  if (generation !== ms().gen) {
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
  const results = await Promise.allSettled(accounts.map(account => backend.mailList(account, ms().pages[account] + 1)));
  set(draft => {
    if (generation === draft.gen && draft.list) {
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
  storage.set("mailFilter", { state: ms().filter.state, project: ms().filter.project });
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
/** The mails that pass the search, read state and project filter. */
const filtered = (list: Mail[], filter: MailFilter) => filterMails(list, filter, mailProject);
/** The inbox as the view shows it: the mails that pass the filters with their project's label and, with more than one
 *  account, their account ("" for none), how many are shown and unread, whether every account showed its oldest mail,
 *  and the projects to filter on (those of the mails, plus the one filtered on even when no mail has it). */
export function inbox() {
  const { list: all, filter } = ms();
  const list = all && visibleMails(all);
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
  return {
    shown,
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
  try {
    await backend.mailSeen(target.account, target.id, seen);
    set(draft => {
      draft.err = "";
    });
  } catch (e) {
    flag(seen);
    set(draft => {
      draft.err = String(e);
    });
  }
}
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
// the settings window opens on Integrations › Mail (it reads its pane from the shared localStorage)
export function openMailSetup() {
  storage.setRaw("prefsTab", "integrations");
  storage.setRaw("prefsAcct", "mail");
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
