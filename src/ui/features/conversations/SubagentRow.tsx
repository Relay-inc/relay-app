import type { Sub } from "../../../domain/conversations/types";
import { openAgent } from "../../../application/navigation/navigation";
import { useT } from "../../hooks/useT";
import { ToolLine } from "../../components/ToolLine";

/** One agent: a line (description, what it is, the step it is on, how long). A click opens its page. */
export function SubagentRow({ agent, duration }: { agent: Sub; duration: string }) {
  const { t } = useT();
  const running = agent.running;
  const meta = [agent.agentType, agent.model].filter(Boolean).join(" · ");
  // the step a running agent is on: a tool call, else what it said
  const step = !running ? "" : agent.tool ? <ToolLine name={agent.tool} input={agent.input} /> : (agent.text ?? "");
  return (
    <button
      className="w-full text-left flex items-center gap-2 min-h-6 px-1.5 rounded-md text-sm text-secondary cursor-default select-none hover:bg-fill"
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
      <span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-xs [&_code]:font-mono [&_code]:text-xs">
        {step}
      </span>
      <span className={running ? "flex-none tabular-nums" : "flex-none text-xs whitespace-nowrap"}>{duration}</span>
    </button>
  );
}
