// The inbox, fetched by the backend over IMAP (Gmail or any server), every account merged: the newest mails. A row opens
// the mail next to the list, and from there a button starts a conversation about it. Opening leaves a mail unread,
// read/unread only changes on the user's click. Nothing here sends a mail: a reply only becomes a draft, from a conversation (decided 29/9).
// Behind the experimental mail flag the user can also archive and delete (to Trash), one mail or a selection, and the
// list splits into Inbox and Other the way Keel does it. Claude has no tool for either.
export type Mail = {
  id: string;
  account: string;
  subject: string;
  date: string;
  unread: boolean;
  from: { name: string | null; email: string }[];
  to: { name: string | null; email: string }[];
  attachments: boolean;
  other?: boolean; // machine-sent and from someone you never wrote to, only with the experimental flag
};
export type MailBody = {
  text: string;
  html: string | null;
  attachments: { index: number; name: string; size: number; mime: string }[];
};
export type MailBox = "inbox" | "other";
export type MailFilter = { q: string; state: "all" | "unread" | "read"; project: string; box: MailBox };
