import { panelItem } from "../../../domain/navigation/keys";
import { useNavigationStore } from "../../../application/navigation/store";
import { NoteDetail } from "../workspace/NoteDetail";

/** The detail open in the panel: a vault note (PRs and mail open next to their lists, cards in the ticket window).
 *  Keyed by it, so nothing of one carries over to the next. */
export function PanelDetail() {
  const open = useNavigationStore(s => s.panel.open);
  return panelItem(open)?.kind === "note" ? <NoteDetail key={open} panelKey={open} /> : null;
}
