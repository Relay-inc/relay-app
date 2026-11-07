// A page's icon and cover (issue 424): two frontmatter keys, `icon:` (one emoji) and `cover:` (a [[link]] to an image in
// the workspace). Read here; written with setProperty / removeProperty like any other key.
import { readProperties } from "./properties.ts";
import type { ProjectIcon } from "./types.ts";

/** The keys the page header draws itself, so its Properties list leaves them out. */
export const DECOR_KEYS = ["icon", "cover"];

/** `text` as an icon: exactly one grapheme (a flag or a ZWJ family is one), trimmed; null for anything else ("ab", ""). */
export function emojiOf(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)];
  return graphemes.length === 1 ? trimmed : null;
}

const valueOf = (yaml: string, key: string) => readProperties(yaml)?.find(row => row.key === key)?.value;

/** Which icon a page shows (its header here, its row in the Pages tree in #427): the note's own `icon:` when it is one
 *  emoji, else its project's icon from config (an emoji or a picture), else null (the caller's file glyph). */
export function pageIcon(yaml: string, project?: ProjectIcon): { emoji: string } | { project: ProjectIcon } | null {
  const emoji = emojiOf(valueOf(yaml, "icon"));
  if (emoji) return { emoji };
  return project && (project.img || project.icon) ? { project } : null;
}

/** The file `cover:` names ("Kickoff banner.png" for `"[[Kickoff banner.png]]"`, a bare name as it is), or "". */
export function coverOf(yaml: string): string {
  const value = valueOf(yaml, "cover");
  return typeof value === "string"
    ? value
        .replace(/^\[\[|\]\]$/g, "")
        .split("|")[0]
        .trim()
    : "";
}
