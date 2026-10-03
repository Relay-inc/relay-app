import { esc } from "../../shared/html";
import { raw } from "../../shared/i18n";
import type { ToolInput } from "../../domain/conversations/types";
import { useT } from "../hooks/useT";
import { Html } from "./Html";

const fileName = (path = "") => path.split("/").pop() || path;
/** The host of a fetched url, null when there is no or a bad url. */
const hostOf = (url: string | undefined) => {
  try {
    return new URL(url ?? "").host;
  } catch {
    return null;
  }
};

/** One tool call as a short line ("Read x.md", a command, "Searched for ..."). Its `<code>` is styled by the line that
 *  holds it (`[&_code]:…`). `linked`: the file is a note that opens, so its name is drawn as a link. */
export function ToolLine({
  name,
  input,
  linked = false,
}: {
  name: string;
  input: ToolInput | undefined;
  linked?: boolean;
}) {
  const { th } = useT();
  const args = input || {};
  const file = linked
    ? raw(`<span class="text-accent-text">${esc(fileName(args.file_path))}</span>`)
    : fileName(args.file_path);
  // a line without markup stays text, one with markup renders it
  const line = (html: string) => (/[<&]/.test(html) ? <Html html={html} /> : <>{html}</>);
  switch (name) {
    case "Read":
      return line(th("tool.read", { file }));
    case "Write":
      return line(th("tool.write", { file }));
    case "Edit":
    case "MultiEdit":
      return line(th("tool.edit", { file }));
    case "Bash":
      return <code>{String(args.command || "").slice(0, 90)}</code>;
    case "Grep":
      return line(th("tool.grep", { p: raw(`<code>${esc(args.pattern)}</code>`) }));
    case "Glob":
      return line(th("tool.glob", { p: raw(`<code>${esc(args.pattern)}</code>`) }));
    case "WebSearch":
      return line(th("tool.webSearch", { q: args.query ?? "" }));
    case "WebFetch": {
      // no or a bad url: the line without the host
      const host = hostOf(args.url);
      return line(host !== null ? th("tool.webFetchHost", { host }) : th("tool.webFetch"));
    }
    case "Agent":
    case "Task":
      return line(th("tool.agent", { d: args.description || args.subagent_type || "" }));
    case "Skill":
      return line(th("tool.skill", { s: args.skill ?? "" }));
    case "TodoWrite":
      return line(th("tool.todo"));
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  return <>{mcp ? `${mcp[1].replace(/^claude_ai_|^plugin_/g, "")}: ${mcp[2]}` : name}</>;
}
