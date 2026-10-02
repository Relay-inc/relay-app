import { WAIT, REM, PRS, MAIL, USAGE } from "../../domain/navigation/views";
import { boardOf } from "../../application/navigation/navigation";
import { useNavigationStore } from "../../application/navigation/store";
import { BoardView } from "../features/board/BoardView";
import { PullRequestsView } from "../features/pull-requests/PullRequestsView";
import { UsageView } from "../features/usage/UsageView";
import { MailView } from "../features/mail/MailView";
import { RemindersView } from "../features/reminders/RemindersView";
import { WaitingView } from "../features/conversations/WaitingView";
import { ConversationView } from "../features/conversations/ConversationView";

/** What the middle column shows for the selection: a board, a view, or the open conversation (relay-chat's renderView).
 *  A board is keyed by its provider, so switching boards starts its view fresh. */
export function SelectedView() {
  const selected = useNavigationStore(s => s.selected);
  const board = boardOf(selected);
  if (board) return <BoardView key={board.id} provider={board} />;
  if (selected === PRS) return <PullRequestsView />;
  if (selected === USAGE) return <UsageView />;
  if (selected === MAIL) return <MailView />;
  if (selected === REM) return <RemindersView />;
  if (selected === WAIT) return <WaitingView />;
  return <ConversationView />;
}
