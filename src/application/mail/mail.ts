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

// The inbox (domain/mail). Refreshed every 5 minutes and on opening the view. Nothing here sends or moves a mail.
const ms = () => useMailStore.getState();
const set = useMailStore.setState;
const openKey = () => useNavigationStore.getState().panel.open;

/** Once Mail is switched on in the settings: the newest page. */
export async function loadMails() {
  if (!mailOn() || ms().busy || !settings().mail.accounts?.length) return;
  set(draft => {
    draft.busy = true;
  });
  const generation = ms().gen;
  try {
    const fresh = await backend.mailList(1);
    if (generation !== ms().gen) {
      set(draft => {
        draft.busy = false;
      });
      loadMails();
      return;
    }
    set(draft => {
      draft.list = withFirstPage(draft.list, fresh);
      if (!draft.pages) {
        draft.pages = 1;
        draft.end = fresh.length < PAGE_SIZE;
      }
      draft.err = "";
    });
  } catch (e) {
    if (generation === ms().gen)
      set(draft => {
        draft.err = String(e);
      });
  }
  set(draft => {
    draft.busy = false;
  });
  if (generation !== ms().gen) loadMails();
}
// the next 50, appended under the list. ponytail: a mail archived meanwhile shifts the pages, so one at the border can be skipped until a reload
export async function moreMails() {
  if (ms().more || ms().end || !ms().list) return;
  set(draft => {
    draft.more = true;
  });
  const generation = ms().gen;
  try {
    const next = await backend.mailList(ms().pages + 1);
    if (generation === ms().gen && ms().list)
      set(draft => {
        const known = draft.list!;
        draft.list = [...known, ...next.filter(message => !known.some(x => x.id === message.id))];
        draft.pages++;
        draft.end = next.length < PAGE_SIZE;
        draft.err = "";
      });
  } catch (e) {
    if (generation === ms().gen)
      set(draft => {
        draft.err = String(e);
      });
  }
  set(draft => {
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
    draft.pages = 0;
    draft.end = false;
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
/** The inbox as the view shows it: the mails that pass the filters with their project's label ("" for none), the
 *  unread count, and the projects to filter on (those of the mails, plus the one filtered on even when no mail has it). */
export function inbox() {
  const { list, filter } = ms();
  const projectOf = (message: Mail) => {
    const name = mailProject(message);
    return name ? projectLabel(name) : "";
  };
  const shown = list ? filtered(list, filter).map(message => ({ mail: message, project: projectOf(message) })) : [];
  const names = new Set((list || []).map(mailProject).filter((name): name is string => !!name));
  const projects = [...names].sort();
  if (filter.project && filter.project !== "-" && !names.has(filter.project)) projects.push(filter.project);
  return {
    shown,
    unread: (list || []).filter(unreadOf).length,
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
// the settings window opens on Integrations (it reads its page from the shared localStorage)
export function openMailSetup() {
  storage.setRaw("prefsTab", "integrations");
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
