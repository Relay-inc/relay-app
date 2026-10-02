import type { Item } from "../../../domain/conversations/types";
import { noteKey } from "../../../domain/navigation/keys";
import { notePath } from "../../../application/workspace/vault";
import { openDetail } from "../../../application/navigation/panel";
import { useDerived } from "../../hooks/useDerived";
import { ToolLine } from "../../components/ToolLine";

// the arrow before the line; a running step has a spinner instead, a failed one an arrow in the late colour
const LEAD = {
  run: "before:size-2 before:rounded-full before:border-2 before:border-separator before:border-t-secondary before:animate-spin",
  done: "before:w-0 before:h-0 before:border-l-5 before:border-l-current before:border-y-4 before:border-y-transparent before:opacity-60",
  err: "before:w-0 before:h-0 before:border-l-5 before:border-l-late before:border-y-4 before:border-y-transparent",
};

/** One tool call, a quiet line between the messages. A Read or Edit on a note that exists opens it in the right panel. */
export function ToolStep({ item }: { item: Item }) {
  // re-read when the notes index changes, so a note written later links
  const note = useDerived(() => notePath(item.path));
  const lead = item.state === "run" ? LEAD.run : item.state === "err" ? LEAD.err : LEAD.done;
  const cls = `-my-1.5 flex items-center gap-2 text-sm [&_code]:font-mono [&_code]:text-xs ${lead} ${item.state === "err" ? "text-label" : "text-secondary"}`;
  const line = item.tool ? <ToolLine name={item.tool.name} input={item.tool.input} /> : item.text;
  if (!note) return <div className={cls}>{line}</div>;
  return (
    <button
      className={`${cls} w-full text-left cursor-pointer hover:underline`}
      onClick={() => openDetail(noteKey(note))}
    >
      {line}
    </button>
  );
}
