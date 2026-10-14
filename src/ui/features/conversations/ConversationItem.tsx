import { memo } from "react";
import type { Item } from "../../../domain/conversations/types";
import { esc } from "../../../shared/html";
import { sentAt } from "../../../shared/format";
import { raw } from "../../../shared/i18n";
import { isRelayTurn, reportKey } from "../../../domain/orchestrator/rules";
import { useT } from "../../hooks/useT";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { UserMessage } from "./UserMessage";
import { Answer } from "./Answer";
import { Thinking } from "./Thinking";
import { ToolStep } from "./ToolStep";
import { NoteLine } from "./NoteLine";
import { RelayTurn } from "./RelayTurn";
import { ReportCard } from "../orchestrator/ReportCard";

/** One line of the conversation. Memoised on the item: Immer keeps untouched items identical, so a stream delta
 *  redraws only the item it changed (the compiler does not skip a list child whose props did not change). */
export const ConversationItem = memo(function ConversationItem({ item }: { item: Item }) {
  const { th, locale } = useT();
  switch (item.kind) {
    case "me":
      // a worker's report into the coordinator shows as that worker
      if (isRelayTurn(item.text))
        return reportKey(item.text) ? <ReportCard item={item} /> : <RelayTurn text={item.text} />;
      return <UserMessage text={item.text} imgs={item.imgs} files={item.files} at={item.at} />;
    case "ai":
      return <Answer text={item.text} />;
    case "thinking":
      return <Thinking text={item.text} />;
    case "tool":
      return <ToolStep item={item} />;
    case "allowed":
    case "denied": {
      // what was answered on a permission card, where the card stood
      const ok = item.kind === "allowed";
      return (
        <div className="flex items-center gap-2 text-[13px] text-secondary -my-1 [&_code]:font-mono [&_code]:text-xs [&_code]:bg-fill-2 [&_code]:text-label [&_code]:px-1.25 [&_code]:py-px [&_code]:rounded-sm [&_code]:truncate">
          <Icon
            name={ok ? "check" : "close"}
            className={`glyph size-3.5 flex-none stroke-2 ${ok ? "text-ok" : "text-late"}`}
          />
          {/* the text and the command are flex items, as in the line itself, so a long command truncates */}
          <Html
            className="flex items-center gap-2 min-w-0"
            html={th(ok ? "card.allowed" : "card.denied", { c: raw(`<code>${esc(item.text)}</code>`) })}
          />
        </div>
      );
    }
    case "err":
      return <div className="err-box">{item.text}</div>;
    case "done":
      // the end of a turn: a centred label between two lines under the answer, so it is clear the agent stopped
      return (
        <div className="flex items-center gap-2.5 text-tertiary text-xs">
          <span className="flex-1 h-px bg-separator"></span>
          {item.at ? `${item.text} · ${sentAt(item.at, locale)}` : item.text}
          <span className="flex-1 h-px bg-separator"></span>
        </div>
      );
    case "compact":
      // like the end of a turn, a label between two lines; it pulses while the summary is written
      return (
        <div className="flex items-center gap-2.5 text-tertiary text-xs">
          <span className="flex-1 h-px bg-separator"></span>
          <span className={item.state === "run" ? "animate-pulse" : ""}>{item.text}</span>
          <span className="flex-1 h-px bg-separator"></span>
        </div>
      );
    default:
      return <NoteLine text={item.text} />;
  }
});
