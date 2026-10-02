import { markdownHtml } from "../../shared/markdown";
import { useWorkspaceStore } from "../../application/workspace/store";
import { useT } from "../hooks/useT";

/** Markdown from an agent, a PR or a note (shared/markdown.ts: raw HTML escaped, web and mail links, vault notes as
 *  links). Parsed again only when the text, the notes that exist or the language change. `className`: `md-chat` or `md-panel`. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const notesVersion = useWorkspaceStore(s => s.notesVersion);
  const { lang } = useT();
  // the version and the language are arguments only so the compiler's memo parses again when they change
  return <div className={className} dangerouslySetInnerHTML={{ __html: markdownHtml(text, notesVersion, lang) }} />;
}
