import { html } from "lit";
import { th, raw } from "../core/i18n";
import type { ToolInput } from "../domain/chats/state";

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => escapes[char]);
const fileName = (path = "") => path.split("/").pop() || path;

/** What an edit removed and added, as lines, when the call carries the old and new text (Edit, MultiEdit) or the content (Write). */
export function changeOf(name: string, input: ToolInput | undefined) {
  const args = input || {};
  const split = (text: unknown) => (typeof text === "string" && text ? text.split("\n") : []);
  if (name === "Write") return args.content === undefined ? null : { del: [], add: split(args.content) };
  const edits = name === "MultiEdit" && Array.isArray(args.edits) ? args.edits : [args];
  const pairs = edits.filter(edit => typeof edit?.old_string === "string" && typeof edit?.new_string === "string");
  if (!pairs.length || (name !== "Edit" && name !== "MultiEdit")) return null;
  return {
    del: pairs.flatMap(edit => split(edit.old_string)),
    add: pairs.flatMap(edit => split(edit.new_string)),
  };
}

/** One tool call as a short line ("read x.md", a command, "searched for ..."). Its `<code>` is styled by the line that holds it.
 *  `linked`: the file is a note that opens, so its name is drawn as a link. */
export function toolLine(name: string, input: ToolInput | undefined, linked = false) {
  const args = input || {};
  const file = () =>
    linked
      ? raw(`<span class="text-accent-text">${escapeHtml(fileName(args.file_path))}</span>`)
      : fileName(args.file_path);
  switch (name) {
    case "Read":
      return th("tool.read", { file: file() });
    case "Write":
      return th("tool.write", { file: file() });
    case "Edit":
    case "MultiEdit":
      return th("tool.edit", { file: file() });
    case "Bash":
      return html`<code>${String(args.command || "").slice(0, 90)}</code>`;
    case "Grep":
      return th("tool.grep", { p: raw(`<code>${escapeHtml(args.pattern)}</code>`) });
    case "Glob":
      return th("tool.glob", { p: raw(`<code>${escapeHtml(args.pattern)}</code>`) });
    case "WebSearch":
      return th("tool.webSearch", { q: args.query ?? "" });
    case "WebFetch":
      try {
        return th("tool.webFetchHost", { host: new URL(args.url ?? "").host }); // no or a bad url: the line without the host
      } catch {
        return th("tool.webFetch");
      }
    case "Agent":
    case "Task":
      return th("tool.agent", { d: args.description || args.subagent_type || "" });
    case "Skill":
      return th("tool.skill", { s: args.skill ?? "" });
    case "TodoWrite":
      return th("tool.todo");
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  return mcp ? `${mcp[1].replace(/^claude_ai_|^plugin_/g, "")}: ${mcp[2]}` : name;
}
