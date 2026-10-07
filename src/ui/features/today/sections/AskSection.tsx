import { lastAi } from "../../../../application/conversations/selectors";
import { useDerived } from "../../../hooks/useDerived";
import { useT } from "../../../hooks/useT";
import { Markdown } from "../../../components/Markdown";
import { PendingRequest } from "../../conversations/PendingRequest";
import type { SectionProps } from "./types";

/** An agent's permission or question: what it last said, then its card (Enter allows). */
export function AskSection({ entry }: SectionProps<"ask">) {
  const { t } = useT();
  const s = entry.subject;
  // what the agent last said; lastAi's own fallback ("Done") when it said nothing is no context
  const said = useDerived(() => (lastAi(s.chat) !== t("work.done") ? lastAi(s.chat) : ""));
  return (
    <div className="flex flex-col gap-3 max-w-170">
      {said ? <Markdown text={said} className="md-panel text-sm leading-relaxed text-secondary line-clamp-6" /> : null}
      <PendingRequest request={s.request} keys />
    </div>
  );
}
