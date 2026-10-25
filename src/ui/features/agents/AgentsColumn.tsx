import type { Sub } from "../../../domain/conversations/types";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { closeAgent, openAgent } from "../../../application/navigation/navigation";
import { WorkerAvatar } from "../orchestrator/parts";
import { ToolLine } from "../../components/ToolLine";
import { subMeta } from "../../../domain/conversations/rules";
import { useT } from "../../hooks/useT";
import { useElapsed } from "./useElapsed";

const NONE: Sub[] = [];

/** The agents Claude Code spawned in the open conversation, as the orchestrator lists its workers: the conversation
 *  first, then the running agents and the finished ones. A row opens the agent's page. */
export function AgentsColumn() {
  const { t } = useT();
  const selected = useNavigationStore(s => s.selected);
  const page = useNavigationStore(s => s.agentPage);
  const agents = useConversationsStore(s => s.subs[selected] ?? NONE);
  const title = useConversationsStore(s => s.chats[selected]?.title ?? "");
  const running = agents.filter(agent => agent.running);
  const finished = agents.filter(agent => !agent.running).reverse();
  const rows = (list: Sub[]) =>
    list.map(agent => (
      <AgentRow key={agent.id} agent={agent} selected={page === agent.id} onOpen={() => openAgent(agent.id)} />
    ));
  return (
    <div className="flex flex-col gap-0.5 -mx-1.5">
      <button
        className={`flex w-full items-center min-h-11 px-2.5 rounded-[10px] border-0 text-left cursor-default ${page ? "bg-transparent hover:bg-fill" : "bg-accent-soft"}`}
        onClick={closeAgent}
      >
        <span className={`flex-1 min-w-0 text-sm truncate ${page ? "font-medium" : "font-semibold"}`}>
          {title || t("agents.conversation")}
        </span>
      </button>
      {running.length ? (
        <>
          <div className="px-2.5 pt-4 pb-1.5 text-xs font-semibold text-secondary">{t("agents.running")}</div>
          {rows(running)}
        </>
      ) : null}
      {finished.length ? (
        <>
          <div className="px-2.5 pt-4 pb-1.5 text-xs font-semibold text-secondary">{t("agents.done")}</div>
          {rows(finished)}
        </>
      ) : null}
      {agents.length ? null : (
        <p className="mx-2.5 mt-4 p-3.5 rounded-[10px] border border-dashed border-separator-strong text-xs leading-normal text-tertiary">
          {t("agents.none")}
        </p>
      )}
    </div>
  );
}

/** One agent: its crab, what it was asked, its type and model, the step it is on (or how long it took). */
function AgentRow({ agent, selected, onOpen }: { agent: Sub; selected: boolean; onOpen: () => void }) {
  const { t } = useT();
  const elapsed = useElapsed(agent);
  const meta = subMeta(agent, t);
  return (
    <button
      className={`flex w-full items-center gap-3 min-h-13 px-2.5 rounded-[10px] border-0 text-left cursor-default ${selected ? "bg-accent-soft" : "bg-transparent hover:bg-fill"}`}
      title={agent.description}
      onClick={onOpen}
    >
      <span className="flex self-center">
        <WorkerAvatar worker={{ state: agent.running ? "running" : "done", model: agent.model }} />
      </span>
      <span className="flex-1 min-w-0 flex flex-col leading-snug">
        <span className={`text-sm truncate ${selected ? "font-semibold" : "font-medium"}`}>{agent.description}</span>
        <span className="text-xs text-secondary truncate [&_code]:font-mono [&_code]:text-xs">
          {agent.running && agent.tool ? <ToolLine name={agent.tool} input={agent.input} /> : meta}
          {agent.cut ? <span className="text-late">{` · ${t("agents.cut")}`}</span> : null}
        </span>
      </span>
      <span className="flex-none text-xs text-secondary tabular-nums">{elapsed}</span>
    </button>
  );
}
