import { html, nothing } from "lit";
import { t, th, raw } from "../i18n";
import { changed } from "../lib/store";
import { S, base } from "../app/state";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** One tool call as a short line ("read x.md", a command, "searched for ..."). */
export function toolLine(name: string, input: any) {
  const i = input || {};
  switch (name) {
    case "Read": return th("tool.read", { file: base(i.file_path) });
    case "Write": return th("tool.write", { file: base(i.file_path) });
    case "Edit": case "MultiEdit": return th("tool.edit", { file: base(i.file_path) });
    case "Bash": return html`<code>${String(i.command || "").slice(0, 90)}</code>`;
    case "Grep": return th("tool.grep", { p: raw(`<code>${esc(i.pattern)}</code>`) });
    case "Glob": return th("tool.glob", { p: raw(`<code>${esc(i.pattern)}</code>`) });
    case "WebSearch": return th("tool.webSearch", { q: i.query ?? "" });
    case "WebFetch": try { return th("tool.webFetchHost", { host: new URL(i.url).host }); } catch { return th("tool.webFetch"); }
    case "Agent": case "Task": return th("tool.agent", { d: i.description || i.subagent_type || "" });
    case "Skill": return th("tool.skill", { s: i.skill ?? "" });
    case "TodoWrite": return th("tool.todo");
  }
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? `${m[1].replace(/^claude_ai_|^plugin_/g, "")}: ${m[2]}` : name;
}

/** Thumbnails; an empty url is an image the transcript did not hold inline. A click opens one larger, `remove` adds the × button. */
export const thumbs = (urls: string[], remove?: (i: number) => void) => urls.map((u, i) => u
  ? html`<span class="att"><img src=${u} alt="" @click=${() => { S.zoom = u; changed(); }}>${remove
      ? html`<button class="rm" title=${t("img.remove")} aria-label=${t("img.removeLabel")} @click=${(e: Event) => { e.stopPropagation(); remove(i); }}>×</button>` : nothing}</span>`
  : html`<span class="imgph">${t("img.placeholder")}</span>`);

// an image on the clipboard becomes a thumbnail. Copied text that also carries an image rendering
// (Numbers, Word) pastes as text the way it always did, only a bare file name (a Finder copy) gives way.
export function pastedImages(e: ClipboardEvent): File[] {
  const cd = e.clipboardData, text = cd?.getData("text/plain").trim() || "";
  if (!cd || (text && !/^[^\n/]+\.(png|jpe?g|gif|webp|heic|tiff?)$/i.test(text))) return [];
  const files = [...cd.items].filter(i => i.kind === "file" && i.type.startsWith("image/")).map(i => i.getAsFile()).filter((f): f is File => !!f);
  if (files.length) e.preventDefault();
  return files;
}
export const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
