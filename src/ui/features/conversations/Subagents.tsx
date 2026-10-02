import { useEffect, useState } from "react";
import type { Sub } from "../../../domain/conversations/types";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { formatDuration } from "../../../domain/conversations/rules";
import { toggleSubsDone } from "../../../application/conversations/actions";
import { useT } from "../../hooks/useT";
import { SubagentRow } from "./SubagentRow";

const NONE: Sub[] = [];

/** The agents of the open conversation above the composer, like the terminal lists them under the prompt: the
 *  running ones, and the finished ones folded away. */
export function Subagents({ className }: { className: string }) {
  const { tn } = useT();
  const selected = useNavigationStore(s => s.selected);
  const agents = useConversationsStore(s => s.subs[selected] ?? NONE);
  const unfolded = useConversationsStore(s => s.subsOpen.has(selected));
  const running = agents.filter(agent => agent.running);
  const finished = agents.filter(agent => !agent.running);
  // a running agent's time counts up every second; a finished one stopped at its last message
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const row = (agent: Sub) => (
    <SubagentRow
      key={agent.id}
      agent={agent}
      duration={formatDuration(
        ((agent.running ? now : Date.parse(agent.last_at)) - Date.parse(agent.started_at)) / 1000,
      )}
    />
  );
  return (
    <div className={`${className} max-h-[40vh] overflow-y-auto`}>
      {running.map(row)}
      {finished.length ? (
        <>
          <button
            className="self-start px-1.5 py-0.5 rounded-md text-xs text-secondary hover:bg-fill hover:text-label"
            onClick={toggleSubsDone}
          >
            {tn("subs.done", finished.length)}
          </button>
          {unfolded ? finished.map(row) : null}
        </>
      ) : null}
    </div>
  );
}
