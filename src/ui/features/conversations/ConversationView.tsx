import type { Item } from "../../../domain/conversations/types";
import { agent } from "../../../shared/plugins";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { chatBar } from "../../../application/conversations/selectors";
import { answerAsk, routeTo } from "../../../application/conversations/actions";
import { chatAgent } from "../../../application/agents/agents";
import { project } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { ConversationItem } from "./ConversationItem";
import { NoteLine } from "./NoteLine";
import { PendingRequest } from "./PendingRequest";
import { RouteChoice } from "./RouteChoice";
import { UserMessage } from "./UserMessage";
import { ToolGroup } from "./ToolGroup";
import { Working } from "./Working";

// the tool calls between two messages fold into one group, keyed by the index of its first step
export function groupSteps(items: Item[]) {
  const out: { at: number; item: Item; steps?: Item[] }[] = [];
  items.forEach((item, at) => {
    const last = out[out.length - 1];
    if (item.kind !== "tool") out.push({ at, item });
    else if (last?.steps) last.steps.push(item);
    else out.push({ at, item, steps: [item] });
  });
  return out;
}

/** The open conversation: what was said and done, a question about the project, the cards waiting, the working
 *  indicator and the messages the agent has not read yet. A stream delta changes one item; the others keep their identity and do not redraw.
 *  `cards`: false where the container shows the cards itself (the phone docks them under the conversation); `empty`:
 *  the line of a conversation with nothing in it yet, where the desktop's (about projects) does not fit. */
export function ConversationView({ cards = true, empty }: { cards?: boolean; empty?: string }) {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const items = useConversationsStore(s => s.messages[selected]);
  const busy = useConversationsStore(s => s.status[selected] === "busy");
  const outside = useConversationsStore(s => selected in s.outside);
  const pendingList = useConversationsStore(s => s.pendingList);
  const unread = useConversationsStore(s => s.waiting[selected]);
  const routeHits = useConversationsStore(s => (s.routeChoice?.key === selected ? s.routeChoice.hits : null));
  const askHits = useConversationsStore(s => s.chats[selected]?.ask);
  // the project it is under (for the empty line), whether a terminal session is writing, and the agent's name
  const where = useDerived(() => {
    const { session, projectName, coordinator } = chatBar(selected);
    const id = chatAgent(selected);
    return {
      name: project(projectName) ? projectName : null,
      coordinator,
      writing: !!session?.busy,
      agent: agent(id)?.name ?? id,
    };
  });
  const waiting = pendingList.filter(request => request.project === selected);
  const working = t("work.working", { agent: where.agent });
  // the running turn started with the user's last message, unless a turn ended after it (Claude started this one itself)
  // ponytail: a transcript has no turn ends, so a turn Claude starts itself after a reload counts from the last message
  const last = busy ? [...(items || [])].reverse().find(item => item.kind === "me" || item.kind === "done") : undefined;
  const since = last?.kind === "me" ? last.at : undefined;
  return (
    <div className="flex flex-col gap-5">
      {/* the rest is append-only, so an index is stable; a tool line keeps its call id */}
      {items?.length ? (
        groupSteps(items).map(entry =>
          entry.steps ? (
            <ToolGroup key={entry.at} steps={entry.steps} />
          ) : (
            <ConversationItem key={entry.item.id ?? entry.at} item={entry.item} />
          ),
        )
      ) : (
        <NoteLine
          text={
            empty ??
            (where.coordinator
              ? t("chat.emptyOrch")
              : where.name
                ? t("chat.emptyProject", { name: where.name })
                : t("chat.emptyGeneral"))
          }
        />
      )}
      {routeHits ? <RouteChoice hits={routeHits} onRoute={routeTo} /> : null}
      {askHits ? <RouteChoice hits={askHits} onRoute={answerAsk} /> : null}
      {cards ? waiting.map(request => <PendingRequest key={request.id} request={request} />) : null}
      {/* every provider shares the same indicator; permission cards take its place while waiting */}
      {busy && !waiting.length ? (
        <Working label={working} text={outside ? t("work.outside") : working} since={since} />
      ) : null}
      {where.writing ? <Working text={t("term.writing")} /> : null}
      {/* sent, not read by the agent yet: it moves up into the conversation where the agent takes it up */}
      {unread?.length ? (
        <div className="flex flex-col gap-5 opacity-55">
          {unread.map((item, i) => (
            <UserMessage key={i} text={item.text} imgs={item.imgs} files={item.files} at={item.at} />
          ))}
          <div className="self-end -mt-3.5 text-xs text-tertiary">{t("work.waiting", { agent: where.agent })}</div>
        </div>
      ) : null}
    </div>
  );
}
