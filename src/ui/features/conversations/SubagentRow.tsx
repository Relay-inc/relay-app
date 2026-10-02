import type { Sub } from "../../../domain/conversations/types";
import { useConversationsStore } from "../../../application/conversations/store";
import { toggleSubLog } from "../../../application/conversations/actions";
import { useT } from "../../hooks/useT";
import { Markdown } from "../../components/Markdown";
import { ToolLine } from "../../components/ToolLine";

/** One agent: a line (description, what it is, the step it is on, how long), and its last messages while unfolded
 *  (a click on the line). Both sit in the list's column. */
export function SubagentRow({ agent, duration }: { agent: Sub; duration: string }) {
  const { t } = useT();
  const log = useConversationsStore(s => s.subLog[agent.id]);
  const running = agent.running;
  const meta = [agent.agentType, agent.model].filter(Boolean).join(" · ");
  // the step a running agent is on: a tool call, else what it said
  const step = !running ? "" : agent.tool ? <ToolLine name={agent.tool} input={agent.input} /> : (agent.text ?? "");
  return (
    <>
      <button
        className="w-full text-left flex items-center gap-2 min-h-6 px-1.5 rounded-md text-sm text-secondary cursor-default select-none hover:bg-fill"
        title={t("subs.show")}
        onClick={() => toggleSubLog(agent.id)}
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
      {log ? (
        <div className="mt-0.5 mb-1.5 ml-5 px-3 py-2 border-l border-separator grid gap-2">
          {log.length ? (
            log.map((message, i) => (
              <Markdown
                key={i}
                className="md-chat [&_a:not(.vlink)]:underline [&_strong]:font-bold! text-sm! leading-normal!"
                text={message}
              />
            ))
          ) : (
            <div className="text-xs text-secondary">{t("subs.nothing")}</div>
          )}
        </div>
      ) : null}
    </>
  );
}
