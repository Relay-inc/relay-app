import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { tw } from "../../core/styles";

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
  const out: unknown[] = [];
  let at = 0;
  for (const m of text.matchAll(PROSE)) {
    out.push(text.slice(at, m.index));
    out.push(m[1] ? html`<a class="text-accent no-underline" href=${m[1]}>${m[1]}</a>` : html`<span class="text-secondary text-xs">[${m[2]}]</span>`);
    at = m.index! + m[0].length;
  }
  out.push(text.slice(at));
  return out;
}
// no whitespace inside: the text is pre-wrap. Inside a quote the gap above is smaller
const block = (text: string, quoted: boolean) => html`<div class="whitespace-pre-wrap wrap-anywhere text-sm leading-normal ${quoted ? "mt-1.5" : "mt-3"}">${prose(text)}</div>`;
const fold = (label: unknown, quote: unknown, open = false) => html`<details class="mt-3.5" ?open=${open}><summary class="text-xs text-secondary cursor-default py-1 list-outside ml-3.5 hover:text-label">${label}</summary><blockquote class="mt-1.5 pl-3 border-l-2 border-separator text-secondary">${quote}</blockquote></details>`;

/** A mail text: the new part, then the quoted mail as a fold whose label is its "On … wrote:" line, recursively per level. */
function body(text: string, depth = 0): TemplateResult {
  const lines = text.replace(/\r/g, "").split("\n"), nested = depth > 0;
  let q = lines.findIndex(l => QUOTED.test(l));
  // Outlook: the earlier mail starts at its From/Van header, it is not quoted line by line
  const o = lines.findIndex((l, i) => OUTLOOK.test(l) && lines.slice(i + 1, i + 5).some(n => /^(Sent|Verzonden|Date|Datum|Envoyé|Gesendet)\s*:/i.test(n)));
  if (q < 0 && o < 0) return block(tidy(lines), nested);
  if (q < 0 || (o >= 0 && o < q)) return html`${block(tidy(lines.slice(0, o)), nested)}${fold(th("mail.earlier"), block(tidy(lines.slice(o)), true))}`;
  // the attribution: the few non-empty lines above the first quote (a blank line may sit between), when they end in "wrote:"
  let b = q; while (b > 0 && !lines[b - 1].trim()) b--;
  let a = b; for (let i = b - 1; i >= Math.max(0, b - 4) && lines[i].trim(); i--) a = i;
  const label = lines.slice(a, b).join(" ").replace(/\s+/g, " ").trim(), hasLabel = ATTRIB.test(label);
  const end = lines.length - [...lines].reverse().findIndex(l => QUOTED.test(l)); // just past the last quoted line
  const inner = lines.slice(q, end).map(l => l.replace(QUOTED, "").replace(/^ /, ""));
  const head = tidy(lines.slice(0, hasLabel ? a : q)), after = tidy(lines.slice(end));
  // ponytail: nesting stops at 6 levels, deeper threads show flat inside the last fold
  const quoted = depth < 6 ? body(inner.join("\n"), depth + 1) : block(tidy(inner), true);
  return html`${head ? block(head, nested) : nothing}${fold(hasLabel ? label : th("mail.earlier"), quoted, !head)}${after ? block(after, nested) : nothing}`;
}

/** The text of a plain-text mail. */
@customElement("relay-mail-text")
export class MailText extends LitElement {
  static styles = [tw, css`:host { display: block; }`];
  @property() text = "";
  render() { return body(this.text); }
}
