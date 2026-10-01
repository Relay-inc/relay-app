// The inbox, fetched by the backend over IMAP (Gmail): the newest mails. A row opens the mail in the right panel,
// and from there a button starts a conversation about it. Opening leaves a mail unread, read/unread only changes
// on the user's click. Nothing here sends or moves a mail: a reply only becomes a draft, from a conversation (decided 29/9).
import { html, nothing, type TemplateResult } from "lit";
import { th, currentLocale } from "./i18n";

export type Mail = { id: string; account: string; subject: string; date: string; unread: boolean;
  from: { name: string | null; email: string }[]; to: { name: string | null; email: string }[]; attachments: boolean };
export type MailBody = { text: string; html: string | null; attachments: { index: number; name: string; size: number; mime: string }[] };
export type MailFilter = { q: string; state: "all" | "unread" | "read"; project: string };
export const mailKey = (m: { account: string; id: string }) => `mail:${m.account}:${m.id}`;
/** The account and id back out of a key (an email has no colon). */
export const mailRef = (key: string) => { const i = key.lastIndexOf(":"); return { account: key.slice(5, i), id: key.slice(i + 1) }; };
export const unread = (m: Mail) => m.unread;
export const sender = (m: Mail) => m.from[0]?.name || m.from[0]?.email || "";
/** Flip the seen flag in the local copy, so the list follows before the backend answers. */
export const setSeen = (m: Mail, seen: boolean) => { m.unread = !seen; };

// today a time, this year a day and month, before that with the year
export function when(iso: string) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(currentLocale(), { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

// ---------- the text of a plain-text mail: what is new on top, the earlier mails of the thread folded away below it
const QUOTED = /^ ?>/;
// the line Gmail, Outlook and Apple Mail put above a quote ("On … wrote:", "Op … schreef:", "Le … a écrit :", "Am … schrieb:")
const ATTRIB = /(wrote|schreef|a écrit|schrieb)\s*:\s*$/i;
// Outlook without ">": a header block that starts the earlier mail
const OUTLOOK = /^(-{2,}\s*(Original Message|Oorspronkelijk bericht|Forwarded message|Doorgestuurd bericht)|(From|Van|De|Von)\s*:\s*\S)/i;
const tidy = (l: string[]) => l.join("\n").replace(/\n{3,}/g, "\n\n").trim();
// links in the text and the "[image: …]" placeholders. A link ends before a ">" or at the end of a word, so "<https://x>" and "(see https://x)." lose their brackets
const PROSE = /(https?:\/\/[^\s<>"']+?)(?=>|[\s),.]*(?:\s|$))|\[image: ([^\]]*)\]/g;
function prose(text: string) {
  const out: unknown[] = []; let at = 0;
  for (const m of text.matchAll(PROSE)) {
    out.push(text.slice(at, m.index));
    out.push(m[1] ? html`<a href=${m[1]}>${m[1]}</a>` : html`<span class="mail-dim">[${m[2]}]</span>`);
    at = m.index! + m[0].length;
  }
  out.push(text.slice(at));
  return out;
}
// no whitespace inside: the text is pre-wrap
const block = (text: string) => html`<div class="mail-body">${prose(text)}</div>`;
/** A mail text: the new part, then the quoted mail as a fold whose label is its "On … wrote:" line, recursively per level. */
export function renderBody(body: string, depth = 0): TemplateResult {
  const lines = body.replace(/\r/g, "").split("\n");
  let q = lines.findIndex(l => QUOTED.test(l));
  // Outlook: the earlier mail starts at its From/Van header, it is not quoted line by line
  const o = lines.findIndex((l, i) => OUTLOOK.test(l) && lines.slice(i + 1, i + 5).some(n => /^(Sent|Verzonden|Date|Datum|Envoyé|Gesendet)\s*:/i.test(n)));
  if (q < 0 && o < 0) return block(tidy(lines));
  if (q < 0 || (o >= 0 && o < q)) {
    return html`${block(tidy(lines.slice(0, o)))}<details class="mail-quote"><summary>${th("mail.earlier")}</summary><blockquote>${block(tidy(lines.slice(o)))}</blockquote></details>`;
  }
  // the attribution: the few non-empty lines above the first quote (a blank line may sit between), when they end in "wrote:"
  let b = q; while (b > 0 && !lines[b - 1].trim()) b--;
  let a = b; for (let i = b - 1; i >= Math.max(0, b - 4) && lines[i].trim(); i--) a = i;
  const label = lines.slice(a, b).join(" ").replace(/\s+/g, " ").trim(), hasLabel = ATTRIB.test(label);
  const end = lines.length - [...lines].reverse().findIndex(l => QUOTED.test(l)); // just past the last quoted line
  const inner = lines.slice(q, end).map(l => l.replace(QUOTED, "").replace(/^ /, ""));
  const head = tidy(lines.slice(0, hasLabel ? a : q)), after = tidy(lines.slice(end));
  // ponytail: nesting stops at 6 levels, deeper threads show flat inside the last fold
  const quoted = depth < 6 ? renderBody(inner.join("\n"), depth + 1) : block(tidy(inner));
  return html`${head ? block(head) : nothing}<details class="mail-quote" ?open=${!head}><summary>${hasLabel ? label : th("mail.earlier")}</summary><blockquote>${quoted}</blockquote></details>${after ? block(after) : nothing}`;
}
