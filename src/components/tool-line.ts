import { html } from "lit";
import { th, raw } from "../core/i18n";
import type { ToolInput } from "../domain/chats/state";

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => escapes[char]);
const fileName = (path = "") => path.split("/").pop() || path;

/** One tool call as a short line ("read x.md", a command, "searched for ..."). Its `<code>` is styled by the line that holds it. */
export function toolLine(name: string, input: ToolInput | undefined) {
  const args = input || {};
  switch (name) {
    case "Read":
      return th("tool.read", { file: fileName(args.file_path) });
    case "Write":
      return th("tool.write", { file: fileName(args.file_path) });
    case "Edit":
    case "MultiEdit":
      return th("tool.edit", { file: fileName(args.file_path) });
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
