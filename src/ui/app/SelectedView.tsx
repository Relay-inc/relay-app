import { WAIT, REM, USAGE } from "../../domain/navigation/views";
import { boardOf } from "../../application/navigation/navigation";
import { useNavigationStore } from "../../application/navigation/store";
import { BoardView } from "../features/board/BoardView";
import { UsageView } from "../features/usage/UsageView";
import { RemindersView } from "../features/reminders/RemindersView";
import { TodayView } from "../features/today/TodayView";
import { ConversationView } from "../features/conversations/ConversationView";

/** What the middle column's log shows for the selection: a board, a view, or the open conversation (relay-chat's
 *  renderView). PRs and mail scroll themselves, ConversationsView mounts them outside the log. A board is keyed by its
 *  provider, so switching boards starts its view fresh. */
export function SelectedView() {
  const selected = useNavigationStore(s => s.selected);
  const board = boardOf(selected);
  if (board) return <BoardView key={board.id} provider={board} />;
  if (selected === USAGE) return <UsageView />;
  if (selected === REM) return <RemindersView />;
  if (selected === WAIT) return <TodayView />;
  return <ConversationView />;
}
