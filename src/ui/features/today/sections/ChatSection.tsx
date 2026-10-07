import { lastAi } from "../../../../application/conversations/selectors";
import { useDerived } from "../../../hooks/useDerived";
import { Markdown } from "../../../components/Markdown";
import type { SectionProps } from "./types";

/** A finished conversation: what it last said. */
export function ChatSection({ entry }: SectionProps<"chat">) {
  const chat = entry.subject.key;
  const text = useDerived(() => lastAi(chat));
  return <Markdown text={text} className="md-panel text-sm leading-relaxed text-secondary max-w-170" />;
}
