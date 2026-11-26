import type { Artifact } from "../agents/types";
import type { Item } from "../conversations/types";

// Claude's Artifacts: pages Claude Code publishes to claude.ai with its `Artifact` tool (a page, a dashboard, a design
// canvas, slides), shown in a conversation as a card and opened in the Artifact drawer. Claude Code's own wording
// (its tool's contract): "After publishing, the person's app shows a card with the page's title and link."

export { isArtifactUrl } from "../../shared/artifact-link.ts";

/** The Artifact a link opens, when nothing more than its link is known (a link in a message). */
export const fromLink = (url: string): Artifact => ({ url });

/** How the drawer shows an Artifact: the local file it was published from (instant, offline, no sign-in), or the live
 *  page on claude.ai (as others see it, with its comments, data and type). */
export type ArtifactView = "local" | "live";
/** A page Relay can show from its file: an HTML page Claude Code published (a Markdown page shows as text). */
export const hasLocal = (artifact: Artifact) => !!artifact.path && /\.(html?|md|svg)$/i.test(artifact.path);
/** The view an Artifact opens in: one made from a type gets its page from the type on claude.ai, so only live shows it;
 *  a page of Claude's own opens from its file. */
export const firstView = (artifact: Artifact): ArtifactView =>
  !artifact.fromType && hasLocal(artifact) ? "local" : "live";

/** Its name: the title it got, else its file's name without the extension, else "Artifact". */
export const artifactName = (artifact: Artifact) =>
  artifact.title?.trim() ||
  artifact.path
    ?.split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "") ||
  "";

/** The Artifacts a conversation published, newest first, one per link (its latest version). */
export function artifactsIn(items: Item[] | undefined): Artifact[] {
  const seen = new Map<string, Artifact>();
  for (const item of items ?? [])
    if (item.artifact) {
      // a republish moves it to its new place
      seen.delete(item.artifact.url);
      seen.set(item.artifact.url, item.artifact);
    }
  return [...seen.values()].reverse();
}

/** The icon of an Artifact's card: its icon word as Claude gave it ("chart", "calendar", "slides"…) to one of the
 *  app's glyphs, by what it is about. */
export function glyphOf(artifact: Artifact): "chart" | "slides" | "palette" | "page" {
  const word = `${artifact.icon ?? ""} ${artifact.title ?? ""}`.toLowerCase();
  if (/chart|dashboard|graph|metric|data|stats|analytics|report/.test(word)) return "chart";
  if (/slide|deck|presentation|pitch/.test(word)) return "slides";
  if (artifact.fromType || /design|palette|logo|brand|canvas|mockup|ui\b/.test(word)) return "palette";
  return "page";
}

/** The theme the frame gets, as Claude's frame shell reads its own (`data-mode` on its root, frame-shell.js `il`):
 *  light or dark when the app has one set, else "system", which leaves the page to follow the Mac. */
export const frameTheme = (mode: string | undefined): "light" | "dark" | "system" =>
  mode === "light" || mode === "dark" ? mode : "system";

/** The local frame's sandbox. Claude's frame shell (frame-shell.js, the iframe's `sandbox`) always gives scripts,
 *  forms and the page's own origin, pointer lock on current desktop builds unless the page takes pastes (`QS`/`eC`/
 *  `$S`), and pop-ups when outside links are allowed. Relay serves every page from one scheme, so it leaves out the
 *  shared origin (pages may not read each other's storage, nor reach Relay): the contract has pages survive that. */
export const FRAME_SANDBOX = "allow-scripts allow-forms allow-pointer-lock allow-popups allow-modals allow-downloads";
