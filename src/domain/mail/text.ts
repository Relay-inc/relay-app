// ---------- the text of a plain-text mail: what is new on top, the earlier mails of the thread folded away below it
/** A paragraph run of the mail, or a fold with an earlier mail. A fold without label is "earlier mail". */
export type MailPart =
  | { kind: "block"; text: string; quoted: boolean }
  | { kind: "fold"; label: string | null; open: boolean; quote: MailPart[] };
/** A piece of a block: plain text, a link, or an "[image: …]" placeholder. */
type ProsePiece = { kind: "text" | "link" | "image"; text: string };

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
export function prose(text: string): ProsePiece[] {
  const pieces: ProsePiece[] = [];
  let position = 0;
  for (const match of text.matchAll(PROSE)) {
    const [whole, link, imageLabel] = match;
    pieces.push({ kind: "text", text: text.slice(position, match.index) });
    pieces.push(link ? { kind: "link", text: link } : { kind: "image", text: imageLabel });
    position = match.index + whole.length;
  }
  pieces.push({ kind: "text", text: text.slice(position) });
  return pieces;
}
const block = (text: string, quoted: boolean): MailPart => ({ kind: "block", text, quoted });
const fold = (label: string | null, quote: MailPart[], open = false): MailPart => ({
  kind: "fold",
  label,
  open,
  quote,
});

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
const foldFromOutlookHeader = (lines: string[], headerLine: number, nested: boolean) => [
  block(tidy(lines.slice(0, headerLine)), nested),
  fold(null, [block(tidy(lines.slice(headerLine)), true)]),
];

// ">" style: what is new, the quoted lines as a fold (their ">" taken off), and what was written below them
function foldQuotedLines(lines: string[], quoteStart: number, depth: number): MailPart[] {
  const nested = depth > 0;
  const attribution = attributionAbove(lines, quoteStart);
  const end = quotesEnd(lines);
  const quotedLines = lines.slice(quoteStart, end).map(line => line.replace(QUOTED, "").replace(/^ /, ""));
  const head = tidy(lines.slice(0, attribution ? attribution.start : quoteStart));
  const after = tidy(lines.slice(end));
  // ponytail: nesting stops at 6 levels, deeper threads show flat inside the last fold
  const quote = depth < 6 ? mailParts(quotedLines.join("\n"), depth + 1) : [block(tidy(quotedLines), true)];
  return [
    ...(head ? [block(head, nested)] : []),
    fold(attribution?.label ?? null, quote, !head),
    ...(after ? [block(after, nested)] : []),
  ];
}

/** A mail text: the new part, then the quoted mail as a fold whose label is its "On … wrote:" line, recursively per level. */
export function mailParts(text: string, depth = 0): MailPart[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const quoteStart = firstQuotedLine(lines);
  const outlookStart = outlookHeaderLine(lines);
  if (quoteStart < 0 && outlookStart < 0) return [block(tidy(lines), depth > 0)];
  if (quoteStart < 0 || (outlookStart >= 0 && outlookStart < quoteStart))
    return foldFromOutlookHeader(lines, outlookStart, depth > 0);
  return foldQuotedLines(lines, quoteStart, depth);
}
