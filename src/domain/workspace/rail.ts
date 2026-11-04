// A page's right rail (K2): the outline of its headings, who links to it, where its name stands without a link, what
// is near it and which conversations used it. The backend finds the links and mentions (related.rs `rail`); this is
// the text work around it, pure.
import type { Touch } from "../graph/types.ts";

/** A note with the line that brings it here: `line` counts from 1 in its file, `hit` is the matched text as written
 *  (`[[Link]]` for a backlink, the plain words for a mention), with the text around it. */
export type RailNote = { p: string; t: string; k: string; line: number; before: string; hit: string; after: string };
export type RailData = { backlinks: RailNote[]; mentions: RailNote[]; related: { p: string; t: string; k: string }[] };
/** A heading of a page: its level, its text and its line in the file (from 1). */
export type Heading = { level: number; title: string; line: number };

/** The headings of a note's text, in order. The frontmatter and code fences are not read; a first level-1 heading is the
 *  page's title, which the page shows on its own. */
export function outlineOf(text: string): Heading[] {
  const lines = text.split("\n");
  let i = 0;
  if (lines[0]?.trimEnd() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && l.trimEnd() === "---");
    if (end > 0) i = end + 1;
  }
  const out: Heading[] = [];
  let fence = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(l);
    if (!m) continue;
    if (m[1].length === 1 && !out.length) continue;
    out.push({ level: m[1].length, title: m[2].trim(), line: i + 1 });
  }
  return out;
}

/** The heading the text at `line` is under: its index in `outline`, -1 before the first. */
export function headingAt(outline: Heading[], line: number) {
  let at = -1;
  outline.forEach((h, i) => h.line <= line && (at = i));
  return at;
}

/** The note a page's `about:` names, "" when none: the first [[link]] in its value (a string, an inline or a block
 *  list), else the plain text. */
export function aboutOf(yaml: string): string {
  const m = /^about:[ \t]*(.*(?:\n(?:[ \t]+|-[ \t]).*)*)/m.exec(yaml);
  if (!m) return "";
  const link = /\[\[([^\]|#\n]+)/.exec(m[1]);
  if (link) return link[1].trim();
  return m[1]
    .replace(/^[ \t]*-[ \t]+/gm, "")
    .split(/[\n,]/)[0]
    .replace(/^["'[\s]+|["'\]\s]+$/g, "");
}

/** `text` with the plain `hit` on `line` (from 1) made a link to the note `name`: `[[name]]`, or `[[name|hit]]` when
 *  the words differ. Null when the line no longer holds it outside a link (the note changed since the rail read it). */
export function linkMention(text: string, line: number, hit: string, name: string): string | null {
  const lines = text.split("\n");
  const l = lines[line - 1];
  if (l === undefined || !hit) return null;
  const links = [...l.matchAll(/\[\[.*?\]\]/g)].map(m => [m.index, m.index + m[0].length]);
  for (let at = l.indexOf(hit); at >= 0; at = l.indexOf(hit, at + 1)) {
    if (links.some(([from, to]) => at < to && at + hit.length > from)) continue;
    lines[line - 1] = `${l.slice(0, at)}[[${hit === name ? name : `${name}|${hit}`}]]${l.slice(at + hit.length)}`;
    return lines.join("\n");
  }
  return null;
}

/** The conversations that read or wrote the note `path` of workspace `root`, newest first, each once with its last
 *  touch. `touches` are what Recent reads, a week of them. */
export function touchedBy(touches: Touch[], root: string, path: string) {
  const last = new Map<string, Touch>();
  for (const t of touches)
    if (t.root === root && t.path === path && (last.get(t.key)?.at ?? 0) < t.at) last.set(t.key, t);
  return [...last.values()].sort((a, b) => b.at - a.at);
}
