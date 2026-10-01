import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { th } from "../../core/i18n";
import { tw } from "../../core/styles";

// ---------- the text of a plain-text mail: what is new on top, the earlier mails of the thread folded away below it
const QUOTED = /^ ?>/;
// the line Gmail, Outlook and Apple Mail put above a quote ("On … wrote:", "Op … schreef:", "Le … a écrit :", "Am … schrieb:")
const ATTRIB = /(wrote|schreef|a écrit|schrieb)\s*:\s*$/i;
// Outlook without ">": a header block that starts the earlier mail
const OUTLOOK =
  /^(-{2,}\s*(Original Message|Oorspronkelijk bericht|Forwarded message|Doorgestuurd bericht)|(From|Van|De|Von)\s*:\s*\S)/i;
const tidy = (lines: string[]) =>
  lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
// links in the text and the "[image: …]" placeholders. A link ends before a ">" or at the end of a word, so "<https://x>" and "(see https://x)." lose their brackets
const PROSE = /(https?:\/\/[^\s<>"']+?)(?=>|[\s),.]*(?:\s|$))|\[image: ([^\]]*)\]/g;
function prose(text: string) {
  const parts: unknown[] = [];
  let position = 0;
  for (const match of text.matchAll(PROSE)) {
    const [whole, link, imageLabel] = match;
    parts.push(text.slice(position, match.index));
    parts.push(
      link
        ? html`<a class="text-accent no-underline" href=${link}>${link}</a>`
        : html`<span class="text-secondary text-xs">[${imageLabel}]</span>`,
    );
    position = match.index! + whole.length;
  }
  parts.push(text.slice(position));
  return parts;
}
// no whitespace inside: the text is pre-wrap. Inside a quote the gap above is smaller
const block = (text: string, quoted: boolean) =>
  html`<div class="whitespace-pre-wrap wrap-anywhere text-sm leading-normal ${quoted ? "mt-1.5" : "mt-3"}">
    ${prose(text)}
  </div>`;
const fold = (label: unknown, quote: unknown, open = false) =>
  html`<details class="mt-3.5" ?open=${open}>
    <summary class="text-xs text-secondary cursor-default py-1 list-outside ml-3.5 hover:text-label">${label}</summary>
    <blockquote class="mt-1.5 pl-3 border-l-2 border-separator text-secondary">${quote}</blockquote>
  </details>`;

const firstQuotedLine = (lines: string[]) => lines.findIndex(line => QUOTED.test(line));
// just past the last quoted line
const quotesEnd = (lines: string[]) => lines.length - [...lines].reverse().findIndex(line => QUOTED.test(line));
// Outlook: the earlier mail starts at its From/Van header, it is not quoted line by line
const outlookHeaderLine = (lines: string[]) =>
  lines.findIndex(
    (line, i) =>
      OUTLOOK.test(line) &&
      lines.slice(i + 1, i + 5).some(next => /^(Sent|Verzonden|Date|Datum|Envoyé|Gesendet)\s*:/i.test(next)),
  );

// the attribution: the few non-empty lines above the first quote (a blank line may sit between), when they end in "wrote:"
function attributionAbove(lines: string[], quoteStart: number) {
  let end = quoteStart;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let start = end;
  for (let i = end - 1; i >= Math.max(0, end - 4) && lines[i].trim(); i--) start = i;
  const label = lines.slice(start, end).join(" ").replace(/\s+/g, " ").trim();
  return ATTRIB.test(label) ? { start, label } : null;
}

// Outlook style: what is new, then everything from the header block on as one fold
function foldFromOutlookHeader(lines: string[], headerLine: number, nested: boolean) {
  return html`${block(tidy(lines.slice(0, headerLine)), nested)}${fold(th("mail.earlier"), block(tidy(lines.slice(headerLine)), true))}`;
}

// ">" style: what is new, the quoted lines as a fold (their ">" taken off), and what was written below them
function foldQuotedLines(lines: string[], quoteStart: number, depth: number) {
  const nested = depth > 0;
  const attribution = attributionAbove(lines, quoteStart);
  const end = quotesEnd(lines);
  const quotedLines = lines.slice(quoteStart, end).map(line => line.replace(QUOTED, "").replace(/^ /, ""));
  const head = tidy(lines.slice(0, attribution ? attribution.start : quoteStart));
  const after = tidy(lines.slice(end));
  // ponytail: nesting stops at 6 levels, deeper threads show flat inside the last fold
  const quote = depth < 6 ? body(quotedLines.join("\n"), depth + 1) : block(tidy(quotedLines), true);
  return html`${head ? block(head, nested) : nothing}${fold(attribution?.label ?? th("mail.earlier"), quote, !head)}${after ? block(after, nested) : nothing}`;
}

/** A mail text: the new part, then the quoted mail as a fold whose label is its "On … wrote:" line, recursively per level. */
function body(text: string, depth = 0): TemplateResult {
  const lines = text.replace(/\r/g, "").split("\n");
  const quoteStart = firstQuotedLine(lines);
  const outlookStart = outlookHeaderLine(lines);
  if (quoteStart < 0 && outlookStart < 0) return block(tidy(lines), depth > 0);
  if (quoteStart < 0 || (outlookStart >= 0 && outlookStart < quoteStart))
    return foldFromOutlookHeader(lines, outlookStart, depth > 0);
  return foldQuotedLines(lines, quoteStart, depth);
}

/** The text of a plain-text mail. */
@customElement("relay-mail-text")
export class MailText extends LitElement {
  static override styles = [
    tw,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property() text = "";
  override render() {
    return body(this.text);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-mail-text": MailText;
  }
}
