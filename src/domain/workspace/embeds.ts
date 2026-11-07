// Files inside a page (ui/features/workspace/embeds.ts): which `![[…]]` and `![](…)` of a page's text are embeds, what
// they say (the target, a note's heading, a caption, a width), the text that sets a width, the section of a note under a
// heading, and the name a pasted file gets. Pure text in, text out: the markdown stays what Obsidian reads.

/** The most one file added to a page may weigh (bytes, Finder's MB): attach.rs refuses more, and a pasted file over it is
 *  not even read. */
export const MAX_ATTACHMENT = 25_000_000;

/** An embed in a page's text: `![[target#heading|alt|300]]` or `![alt|300](path)`, at [from, to). */
export type Embed = {
  from: number;
  to: number;
  form: "wiki" | "md";
  target: string;
  heading: string;
  alt: string;
  width: number | null;
};

const WIKI = /!\[\[([^\]\n|#]+)(?:#([^\]\n|]*))?((?:\|[^\]\n]*)?)\]\]/g;
const MD = /!\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))\)/g;
const WIDTH = /^\d+(?:x\d+)?$/;

/** `alt|300` as its caption and width: the last part, when it is a number, is the width. */
export function parseOptions(options: string): { alt: string; width: number | null } {
  const parts = options.split("|");
  const last = parts[parts.length - 1]?.trim() ?? "";
  if (WIDTH.test(last)) return { alt: parts.slice(0, -1).join("|").trim(), width: parseInt(last, 10) };
  return { alt: options.trim(), width: null };
}
const options = (alt: string, width: number | null) =>
  [alt, width === null ? "" : String(width)].filter(Boolean).join("|");
const local = (path: string) => !/^[a-z][\w+.-]*:|^#/i.test(path);

/** The embeds in `text`, in order: a wiki embed of a note or file, or a markdown image with a local path (a web
 *  image is left as the text it is). */
export function findEmbeds(text: string): Embed[] {
  const found: Embed[] = [];
  for (const m of text.matchAll(WIKI)) {
    const { alt, width } = parseOptions(m[3].slice(1));
    found.push({
      from: m.index,
      to: m.index + m[0].length,
      form: "wiki",
      target: m[1].trim(),
      heading: (m[2] ?? "").trim(),
      alt,
      width,
    });
  }
  for (const m of text.matchAll(MD)) {
    const path = (m[2] ?? m[3]).replace(/%20/g, " ").split("#")[0];
    if (!path || !local(path)) continue;
    const { alt, width } = parseOptions(m[1]);
    found.push({ from: m.index, to: m.index + m[0].length, form: "md", target: path, heading: "", alt, width });
  }
  return found.sort((a, b) => a.from - b.from);
}

/** The embed's text with another width (the handle's drop): `![[x.png|300]]`, `![[x.png|a chart|300]]`, `![a chart|300](x.png)`. */
export function withWidth(source: string, width: number): string {
  const w = Math.max(1, Math.round(width));
  const wiki = /^!\[\[([^\]\n|]+)((?:\|[^\]\n]*)?)\]\]$/.exec(source);
  if (wiki) return `![[${wiki[1]}${"|" + options(parseOptions(wiki[2].slice(1)).alt, w)}]]`;
  const md = /^!\[([^\]\n]*)\](\([^)\n]*\))$/.exec(source);
  if (md) return `![${options(parseOptions(md[1]).alt, w)}]${md[2]}`;
  return source;
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const clean = (s: string) =>
  s
    .replace(/[*_`[\]]/g, "")
    .trim()
    .toLowerCase();
/** A note's text without its frontmatter. */
export const withoutProperties = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");

/** The part of a note under `heading` (any level, found by its text), down to the next heading of the same or a higher
 *  level: its title and body, and where the heading is in `text`. Null when the note has no such heading. */
export function section(text: string, heading: string): { title: string; body: string; at: number } | null {
  const wanted = clean(heading);
  const lines = text.split("\n");
  let at = 0;
  let from = -1;
  let level = 0;
  let title = "";
  let fence = false;
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : HEADING.exec(line);
    if (from < 0 && h && clean(h[2]) === wanted) {
      from = at;
      level = h[1].length;
      title = h[2];
    } else if (from >= 0) {
      if (h && h[1].length <= level) break;
      kept.push(line);
    }
    at += line.length + 1;
  }
  return from < 0 ? null : { title, body: kept.join("\n").trim(), at: from };
}
/** Where the heading starts in `text` (for Open at the heading), null when there is none. */
export const headingAt = (text: string, heading: string) => section(text, heading)?.at ?? null;

const stamp = (d: Date) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, "0"))
    .join("");
const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
};
/** The name a pasted file is saved under: a picture `Pasted image <yyyyMMddHHmmss>.png` (what Obsidian calls it), any
 *  other file its own name. */
export function pastedName(file: { name: string; type: string }, now: Date): string {
  if (file.type.startsWith("image/")) {
    const ext = EXTENSION[file.type] ?? file.type.slice(6).replace(/[^a-z0-9].*$/i, "");
    return `Pasted image ${stamp(now)}.${ext || "png"}`;
  }
  return file.name.trim() || `Pasted file ${stamp(now)}`;
}

/** Seconds as the audio card's clock: 0:00, 32:14, 1:02:03. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** The text `![[a]]` lines for dropped files, to go before the line at `at` (a drop between lines). */
export function dropText(doc: string, at: number, links: string[]): { from: number; insert: string } {
  const lines = links.map(l => `![[${l}]]`).join("\n");
  // at the end of a page whose last line has no break: the break comes first
  return at >= doc.length && doc.length > 0 && !doc.endsWith("\n")
    ? { from: doc.length, insert: "\n" + lines + "\n" }
    : { from: at, insert: lines + "\n" };
}
