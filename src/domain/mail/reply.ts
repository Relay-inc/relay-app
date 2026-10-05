// A reply, reply all or forward as a draft, the way Keel builds one (mail-client src/Mail.tsx replyDraft/forwardDraft):
// who it goes to, its subject, the quoted mail, and the RFC 5322 message saved in Drafts. Relay never sends it.

export type Addr = { name: string | null; email: string };
/** What a reply needs of the mail it answers (the backend's read tool, with the Reply-To and References headers). */
export type Original = {
  from: Addr[];
  to: Addr[];
  cc: Addr[];
  replyTo: Addr[];
  subject: string;
  messageId: string | null;
  references: string; // the raw References header, "" when there is none
  date: string;
  text: string;
};
export type How = "reply" | "all" | "fwd";

const lower = (a: Addr) => a.email.toLowerCase();
const unique = (list: Addr[]) => list.filter((a, i) => list.findIndex(b => lower(b) === lower(a)) === i);

/** To and Cc: a reply goes to Reply-To, else the sender; to your own mail, back to whom you wrote. Reply all adds the
 *  mail's To and Cc as Cc, without your own addresses and without who is in To already. A forward starts empty. */
export function recipients(mail: Original, how: How, mine: string[]): { to: Addr[]; cc: Addr[] } {
  if (how === "fwd") return { to: [], cc: [] };
  const own = new Set(mine.map(email => email.toLowerCase()));
  const fromMe = mail.from.some(a => own.has(lower(a)));
  const to = unique(fromMe ? mail.to.filter(a => !own.has(lower(a))) : mail.replyTo.length ? mail.replyTo : mail.from);
  const cc =
    how === "all"
      ? unique([...mail.to, ...mail.cc]).filter(a => !own.has(lower(a)) && !to.some(b => lower(b) === lower(a)))
      : [];
  return { to, cc };
}

/** "Re: …" or "Fwd: …", once. */
export const replySubject = (subject: string, how: How) =>
  how === "fwd"
    ? /^\s*(fwd?|doorgestuurd|tr|wg):/i.test(subject)
      ? subject
      : `Fwd: ${subject}`
    : /^\s*(re|antw|aw|réf):/i.test(subject)
      ? subject
      : `Re: ${subject}`;

const who = (list: Addr[]) => list.map(a => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
/** The mail below the reply: quoted with "> ", or a forward's header block and the mail as it was. */
export function quoted(mail: Original, how: How) {
  if (how === "fwd")
    return [
      "---------- Forwarded message ----------",
      `From: ${who(mail.from)}`,
      `Date: ${mail.date}`,
      `Subject: ${mail.subject}`,
      `To: ${who(mail.to)}`,
      "",
      mail.text,
    ].join("\n");
  const lines = mail.text.split(/\r?\n/).map(line => (line ? `> ${line}` : ">"));
  return [`On ${mail.date}, ${who(mail.from)} wrote:`, ...lines].join("\n");
}

// a header value: never a line break (no header injection), non-ASCII as an RFC 2047 encoded word
const clean = (s: string) => s.replace(/[\r\n\0]+/g, " ").trim();
const base64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(s)}?=`);
const address = (a: Addr) => {
  const email = clean(a.email);
  if (!a.name) return email;
  const name = clean(a.name);
  return /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}" <${email}>` : `${word(name)} <${email}>`;
};
const angle = (id: string) => (id.startsWith("<") ? id : `<${id}>`);

/** The draft as an RFC 5322 message: from the account, to and cc, the subject, the threading headers when it answers
 *  a mail, and the text (UTF-8, 8 bit). Lines end in CRLF. */
export function draftMessage(draft: {
  from: string;
  to: Addr[];
  cc: Addr[];
  subject: string;
  inReplyTo: string | null;
  references: string;
  body: string;
}) {
  const refs = clean([draft.references, draft.inReplyTo ? angle(draft.inReplyTo) : ""].filter(Boolean).join(" "));
  const headers = [
    `From: ${clean(draft.from)}`,
    draft.to.length ? `To: ${draft.to.map(address).join(", ")}` : "",
    draft.cc.length ? `Cc: ${draft.cc.map(address).join(", ")}` : "",
    `Subject: ${word(clean(draft.subject))}`,
    draft.inReplyTo ? `In-Reply-To: ${angle(clean(draft.inReplyTo))}` : "",
    refs ? `References: ${refs}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r\n\r\n${draft.body.replace(/\r?\n/g, "\r\n")}`;
}
