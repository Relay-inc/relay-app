import { memo } from "react";
import type { Item } from "../../../domain/conversations/types";
import { Icon } from "../../components/Icon";
import { UserMessage } from "./UserMessage";
import { Answer } from "./Answer";
import { ToolStep } from "./ToolStep";
import { NoteLine } from "./NoteLine";

/** One line of the conversation. Memoised on the item: Immer keeps untouched items identical, so a stream delta
 *  redraws only the item it changed (the compiler does not skip a list child whose props did not change). */
export const ConversationItem = memo(function ConversationItem({ item }: { item: Item }) {
  switch (item.kind) {
    case "me":
      return <UserMessage text={item.text} imgs={item.imgs} />;
    case "ai":
      return <Answer text={item.text} />;
    case "tool":
      return <ToolStep item={item} />;
    case "err":
      return <div className="err-box">{item.text}</div>;
    case "done":
      // the end of a turn: a quiet line under the answer, so it is clear the agent stopped
      return (
        <div className="flex items-center gap-1.5 text-secondary text-xs pt-0.5 pb-1.5">
          <Icon name="check" className="glyph size-3 stroke-2" />
          {item.text}
        </div>
      );
    default:
      return <NoteLine text={item.text} />;
  }
});
