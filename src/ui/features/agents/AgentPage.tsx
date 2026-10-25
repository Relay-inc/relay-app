import { useEffect, useRef, useState } from "react";
import type { Item, Sub } from "../../../domain/conversations/types";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { readAgent } from "../../../application/conversations/history";
import { WorkerAvatar } from "../orchestrator/parts";
import { groupSteps } from "../conversations/ConversationView";
import { ConversationItem } from "../conversations/ConversationItem";
import { ToolGroup } from "../conversations/ToolGroup";
import { Working } from "../conversations/Working";
import { NoteLine } from "../conversations/NoteLine";
import { subMeta } from "../../../domain/conversations/rules";
import { useT } from "../../hooks/useT";
import { useElapsed } from "./useElapsed";

const NONE: Sub[] = [];

/** A subagent of the open conversation as a read-only page: what it was asked, the tools it ran and what it said, from
 *  its own transcript, followed every 2 seconds while it runs. Keyed by its id, so another agent starts over. Claude Code takes no messages for it, so no composer. */
export function AgentPage({ id }: { id: string }) {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const agent = useConversationsStore(s => (s.subs[selected] ?? NONE).find(sub => sub.id === id));
  const running = !!agent?.running;
  const [items, setItems] = useState<Item[] | null>(null);

  // where the next read starts, and a read still on its way (an interval tick does not start a second one)
  const next = useRef(0);
  const reading = useRef(false);

  useEffect(() => {
    let stopped = false;
    const read = async () => {
      if (reading.current) return;
      reading.current = true;
      const part = await readAgent(selected, id, next.current).catch(() => null);
      reading.current = false;
      if (stopped || !part) return;
      next.current = part.next;
      setItems(have => (have ? (part.items.length ? [...have, ...part.items] : have) : part.items));
    };
    read();
    // ponytail: polls the file every 2 s while the agent runs; a file watcher if many pages are followed at once
    const timer = running ? window.setInterval(read, 2000) : 0;
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [selected, id, running]);

  if (!agent) return <NoteLine text={t("agents.gone")} />;
  return (
    <div className="flex flex-col gap-5">
      <AgentHeader agent={agent} />
      {items === null ? null : items.length ? (
        groupSteps(items).map(entry =>
          entry.steps ? (
            <ToolGroup key={entry.at} steps={entry.steps} />
          ) : (
            <ConversationItem key={entry.item.id ?? entry.at} item={entry.item} />
          ),
        )
      ) : (
        <NoteLine text={t("agents.nothing")} />
      )}
      {running ? <Working text={t("agents.working")} /> : null}
    </div>
  );
}

function AgentHeader({ agent }: { agent: Sub }) {
  const { t } = useT();
  const elapsed = useElapsed(agent);
  const meta = subMeta(agent, t);
  return (
    <div className="flex items-center gap-3 pb-4 border-b border-separator">
      <WorkerAvatar worker={{ state: agent.running ? "running" : "done", model: agent.model }} size={36} />
      <div className="flex-1 min-w-0 flex flex-col leading-snug">
        <span className="text-[15px] font-semibold">{agent.description}</span>
        <span className="text-xs text-secondary">
          {meta ? `${meta} · ` : ""}
          <span className={agent.running ? "text-accent" : "text-ok"}>
            {t(agent.running ? "agents.state.running" : "agents.state.done")}
          </span>
          {` · ${elapsed}`}
          {agent.cut ? <span className="text-late">{` · ${t("agents.cut")}`}</span> : null}
        </span>
      </div>
    </div>
  );
}
