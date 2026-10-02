import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { chatBar } from "../../../application/conversations/selectors";
import { routeTo } from "../../../application/conversations/actions";
import { project } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { ConversationItem } from "./ConversationItem";
import { NoteLine } from "./NoteLine";
import { PendingRequest } from "./PendingRequest";
import { RouteChoice } from "./RouteChoice";
import { Working } from "./Working";

/** The open conversation: what was said and done, a question about the project, the cards waiting, and the working
 *  indicator. A stream delta changes one item; the others keep their identity and do not redraw. */
export function ConversationView() {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const items = useConversationsStore(s => s.messages[selected]);
  const busy = useConversationsStore(s => s.status[selected] === "busy");
  const outside = useConversationsStore(s => selected in s.outside);
  const pendingList = useConversationsStore(s => s.pendingList);
  const routeHits = useConversationsStore(s => (s.routeChoice?.key === selected ? s.routeChoice.hits : null));
  // the project it is under (for the empty line) and whether a terminal session is writing
  const where = useDerived(() => {
    const { session, projectName } = chatBar(selected);
    return { name: project(projectName) ? projectName : null, writing: !!session?.busy };
  });
  const waiting = pendingList.filter(request => request.project === selected);
  return (
    <div className="flex flex-col gap-[18px]">
      {/* a tool line by its call id; the rest is append-only, so its index is stable */}
      {items?.length ? (
        items.map((item, i) => <ConversationItem key={item.id ?? i} item={item} />)
      ) : (
        <NoteLine text={where.name ? t("chat.emptyProject", { name: where.name }) : t("chat.emptyGeneral")} />
      )}
      {routeHits ? <RouteChoice hits={routeHits} onRoute={routeTo} /> : null}
      {waiting.map(request => (
        <PendingRequest key={request.id} request={request} />
      ))}
      {/* while the agent works: only the pulsing dots, the running step has its own line */}
      {busy && !waiting.length ? <Working label={t("work.working")} text={outside ? t("work.outside") : ""} /> : null}
      {where.writing ? <Working text={t("term.writing")} /> : null}
    </div>
  );
}
