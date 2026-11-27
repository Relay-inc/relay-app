import type { Sub } from "../../../domain/conversations/types";
import { openAgent } from "../../../application/navigation/navigation";
import { stopTask } from "../../../application/conversations/actions";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { Icon } from "../../components/Icon";
import { subMeta } from "../../../domain/conversations/rules";
import { useT } from "../../hooks/useT";
import { ToolLine } from "../../components/ToolLine";

/** One agent: a line (description, what it is, the step it is on, how long). A click opens its page. While Claude Code
 *  still lists it as a running background task (its task id is the agent id), a hover icon stops it. */
export function SubagentRow({ agent, duration }: { agent: Sub; duration: string }) {
  const { t } = useT();
  const running = agent.running;
  const meta = subMeta(agent, t);
  // the step a running agent is on: a tool call, else what it said
  const step = !running ? "" : agent.tool ? <ToolLine name={agent.tool} input={agent.input} /> : (agent.text ?? "");
  const selected = useNavigationStore(s => s.selected);
  const stoppable = useConversationsStore(
    s => !!s.tasks[selected]?.some(task => task.id === agent.id && task.status === "running"),
  );
  return (
    <div className="group flex items-center min-h-6 rounded-md hover:bg-fill">
      <button
        className="flex-1 min-w-0 text-left flex items-center gap-2 min-h-6 px-1.5 text-sm text-secondary cursor-default select-none"
        title={t("subs.show")}
        onClick={() => openAgent(agent.id)}
      >
        <span
          // Lit 338405d dropped the pulse-dot animation and still names it here: the dot stays still, as there
          className={running ? "size-2 flex-none rounded-full bg-accent" : "size-2 flex-none rounded-full bg-separator"}
        ></span>
        <span
          className={
            running
              ? "text-label flex-initial min-w-0 whitespace-nowrap overflow-hidden text-ellipsis"
              : "flex-initial min-w-0 whitespace-nowrap overflow-hidden text-ellipsis"
          }
        >
          {agent.description}
        </span>
        <span className="flex-none text-xs whitespace-nowrap">{meta}</span>
        {agent.cut ? <span className="flex-none text-xs whitespace-nowrap text-late">{t("agents.cut")}</span> : null}
        <span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-xs [&_code]:font-mono [&_code]:text-xs">
          {step}
        </span>
        <span className={running ? "flex-none tabular-nums" : "flex-none text-xs whitespace-nowrap"}>{duration}</span>
      </button>
      {stoppable ? (
        <button
          className="btn-icon flex-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          title={t("subs.stop")}
          aria-label={t("subs.stop")}
          onClick={() => stopTask(agent.id)}
        >
          <Icon name="close" className="glyph size-3" />
        </button>
      ) : null}
    </div>
  );
}
