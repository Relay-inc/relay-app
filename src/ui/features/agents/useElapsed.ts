import { useEffect, useState } from "react";
import type { Sub } from "../../../domain/conversations/types";
import { formatDuration } from "../../../domain/conversations/rules";

/** How long an agent ran: counting up every second while it runs, stopped at its last message once it ended. */
export function useElapsed(agent: Sub) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!agent.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [agent.running]);
  const end = agent.running ? now : Date.parse(agent.last_at);
  return formatDuration((end - Date.parse(agent.started_at)) / 1000);
}
