import { html } from "lit";
import { th, raw } from "../core/i18n";
import type { ToolInput } from "../domain/chats/state";

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const fileName = (path = "") => path.split("/").pop() || path;

/** One tool call as a short line ("read x.md", a command, "searched for ..."). Its `<code>` is styled by the line that holds it. */
export function toolLine(name: string, input: ToolInput | undefined) {
  const i = input || {};
  switch (name) {
    case "Read":
      return th("tool.read", { file: fileName(i.file_path) });
    case "Write":
      return th("tool.write", { file: fileName(i.file_path) });
    case "Edit":
    case "MultiEdit":
      return th("tool.edit", { file: fileName(i.file_path) });
    case "Bash":
      return html`<code>${String(i.command || "").slice(0, 90)}</code>`;
    case "Grep":
      return th("tool.grep", { p: raw(`<code>${esc(i.pattern)}</code>`) });
    case "Glob":
      return th("tool.glob", { p: raw(`<code>${esc(i.pattern)}</code>`) });
    case "WebSearch":
      return th("tool.webSearch", { q: i.query ?? "" });
    case "WebFetch":
      try {
        return th("tool.webFetchHost", { host: new URL(i.url ?? "").host }); // no or a bad url: the line without the host
      } catch {
        return th("tool.webFetch");
      }
    case "Agent":
    case "Task":
      return th("tool.agent", { d: i.description || i.subagent_type || "" });
    case "Skill":
      return th("tool.skill", { s: i.skill ?? "" });
    case "TodoWrite":
      return th("tool.todo");
  }
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? `${m[1].replace(/^claude_ai_|^plugin_/g, "")}: ${m[2]}` : name;
}
