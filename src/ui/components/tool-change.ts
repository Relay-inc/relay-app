import type { ToolInput } from "../../domain/conversations/types";

/** What an edit removed and added, as lines, when the call carries the old and new text (Edit, MultiEdit) or the
 *  content (Write). */
export function changeOf(name: string, input: ToolInput | undefined) {
  const args = input || {};
  const split = (text: unknown) => (typeof text === "string" && text ? text.split("\n") : []);
  if (name === "Write") return args.content === undefined ? null : { del: [], add: split(args.content) };
  if (name !== "Edit" && name !== "MultiEdit") return null;
  const edits: ToolInput[] = name === "MultiEdit" && Array.isArray(args.edits) ? args.edits : [args];
  const pairs = edits.filter(edit => typeof edit?.old_string === "string" && typeof edit?.new_string === "string");
  if (!pairs.length) return null;
  return { del: pairs.flatMap(edit => split(edit.old_string)), add: pairs.flatMap(edit => split(edit.new_string)) };
}
