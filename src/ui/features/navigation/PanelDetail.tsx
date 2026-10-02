import { panelItem } from "../../../domain/navigation/keys";
import { useNavigationStore } from "../../../application/navigation/store";
import { PullRequestDetail } from "../pull-requests/PullRequestDetail";
import { MailDetail } from "../mail/MailDetail";
import { NoteDetail } from "../workspace/NoteDetail";
import { CardDetail } from "../board/CardDetail";

/** The detail open in the panel, by the kind of its key. Keyed by it, so nothing typed on one (a comment on a card)
 *  carries over to the next. */
export function PanelDetail() {
  const open = useNavigationStore(s => s.panel.open);
  const item = panelItem(open);
  if (item?.kind === "pr") return <PullRequestDetail key={open} panelKey={open} />;
  if (item?.kind === "mail") return <MailDetail key={open} panelKey={open} />;
  if (item?.kind === "note") return <NoteDetail key={open} panelKey={open} />;
  if (item?.kind === "card") return <CardDetail key={open} panelKey={open} />;
  return null;
}
