import type { Mail, MailBox, MailFilter } from "./types";
import { newestFirst } from "./merge.ts";
import { fill, prompts } from "../../shared/prompts.ts";

export const PAGE_SIZE = 50;
export const unread = (message: Mail) => message.unread;
export const sender = (message: Mail) => message.from[0]?.name || message.from[0]?.email || "";
/** What a project guess reads of a mail: its subject, the sender and the sender's domain. */
export const projectText = (message: Mail) => {
  const domain = message.from[0]?.email.split("@")[1]?.split(".")[0] ?? "";
  return `${message.subject} ${sender(message)} ${domain}`;
};
/** Which box a mail sits in, Inbox when the split is off. */
export const mailBox = (message: Mail, split: boolean): MailBox => (split && message.other ? "other" : "inbox");
/** The mails that pass the search, read state and project filter, and with `split` the box. `projectOf` is the project
 *  a mail is about, or null. */
export function filtered(list: Mail[], filter: MailFilter, projectOf: (message: Mail) => string | null, split = false) {
  const query = filter.q.trim().toLowerCase();
  const matchesState = (message: Mail) => filter.state === "all" || unread(message) === (filter.state === "unread");
  const matchesProject = (message: Mail) => {
    if (!filter.project) return true;
    return filter.project === "-" ? !projectOf(message) : projectOf(message) === filter.project;
  };
  const matchesText = (message: Mail) =>
    !query || `${message.subject} ${sender(message)} ${message.from[0]?.email ?? ""}`.toLowerCase().includes(query);
  return list.filter(
    message =>
      (!split || mailBox(message, split) === filter.box) &&
      matchesState(message) &&
      matchesProject(message) &&
      matchesText(message),
  );
}
/** The selection after a click on `key`: ticked or unticked, or with `range` (shift) everything between `anchor` (the
 *  last one ticked) and `key` in `shown` ticked. */
export function toggleSelection(selected: Set<string>, anchor: string, key: string, range: boolean, shown: string[]) {
  const next = new Set(selected);
  const from = shown.indexOf(anchor);
  const to = shown.indexOf(key);
  if (range && from >= 0 && to >= 0) {
    for (const k of shown.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(k);
  } else if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
/** Whether every mail in `shown` is ticked (none shown: no). */
export const allSelected = (selected: Set<string>, shown: string[]) =>
  shown.length > 0 && shown.every(k => selected.has(k));
/** The mail that opens when the open one leaves the list: the next one in `shown` that does not leave, else the one
 *  above it; "" for none. */
export function nextOpen(shown: string[], open: string, gone: Set<string>) {
  const at = shown.indexOf(open);
  if (at < 0) return "";
  return [...shown.slice(at + 1), ...shown.slice(0, at).reverse()].find(k => !gone.has(k)) ?? "";
}
/** One account's newest page replaces what it covers, its older pages loaded with "more" stay below it, other
 *  accounts' rows stay. Newest first. */
export function withFirstPage(list: Mail[] | null, account: string, fresh: Mail[]): Mail[] {
  const all = list || [];
  // an empty page means an empty inbox: with no edge nothing old is kept
  const edge = fresh.length ? Math.min(...fresh.map(message => Date.parse(message.date) || 0)) : -Infinity;
  const older = all.filter(
    message =>
      message.account === account && (Date.parse(message.date) || 0) < edge && !fresh.some(x => x.id === message.id),
  );
  return newestFirst([...all.filter(message => message.account !== account), ...fresh, ...older]);
}
// what the agent is told about the mail: where to read it, and not to trust it. The prompt holds no subject or sender:
// that is third-party text.
export const mailReference = (message: Mail) =>
  fill(prompts.mail.reference, { account: message.account, id: message.id });
export const mailChatTitle = (message: Mail, how: "talk" | "draft" | "draftAll" | "ticket", noSubject: string) =>
  `${{ talk: "", draft: "Antwoord: ", draftAll: "Antwoord: ", ticket: "Ticket: " }[how]}${message.subject || noSubject}`.slice(
    0,
    48,
  );
/** A reply as a draft; `all`: to everyone the mail went to (From, To and Cc, without the user), as reply all does. */
export const draftPrompt = (reference: string, all = false) =>
  fill(prompts.mail.draft, { reference, all: all ? ` ${prompts.mail.draftReplyAll}` : "" });

/** The board a ticket goes to: a vault project's linked board (settings.boards), told to the agent as is. */
export type TicketBoard = { provider: string; project: string; board: string };
// per provider: how the agent finds its board, the action that makes the task, and where the mail goes (Linear has no
// comment action, so the mail goes in the description)
const TICKET_TRACKERS: Record<string, { find: string; create: string; mail: string }> = {
  productive: {
    find: "relay productive.projects en productive.task_lists",
    create: "productive.create_task (description als HTML)",
    mail: "productive.comment (HTML)",
  },
  trello: {
    find: "relay trello.boards en trello.lists",
    create: "trello.create_card",
    mail: "trello.comment",
  },
  linear: {
    find: "relay linear.teams",
    create: "linear.create_issue",
    mail: "",
  },
};
/** The mail as a ticket on the board of its project, the whole mail as a comment on it. Writes ask the user first
 *  (the ask policy), so nothing is created before the go. */
export const ticketPrompt = (reference: string, board?: TicketBoard) => {
  const tracker = board && TICKET_TRACKERS[board.provider];
  const where = tracker
    ? fill(prompts.mail.ticketBoard, { provider: board.provider, project: board.project, board: board.board })
    : fill(prompts.mail.ticketNoBoard, {
        finders: Object.values(TICKET_TRACKERS)
          .map(x => x.find)
          .join(" of "),
      });
  const create = tracker
    ? tracker.create
    : "de create-actie van die tracker (productive.create_task, trello.create_card of linear.create_issue)";
  const mail = tracker ? tracker.mail : "productive.comment of trello.comment";
  return fill(prompts.mail.ticket, {
    reference,
    where,
    create,
    mail: mail ? fill(prompts.mail.ticketComment, { mail }) : prompts.mail.ticketDescription,
  });
};
