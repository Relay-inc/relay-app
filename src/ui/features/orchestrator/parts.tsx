import { useEffect, useState } from "react";
import type { Key } from "../../../shared/i18n";
import type { Worker, WorkerState } from "../../../domain/orchestrator/types";
import { costumeOf } from "../../../domain/orchestrator/rules";
import { agoParts } from "../../../domain/settings/machines";
import { relativeFormat } from "../../../shared/format";
import { useSettingsStore } from "../../../application/settings/store";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Crab } from "./Crab";

// What the workers column, a report in the thread and a worker's page share: its avatar, its state in words and
// colour, and "5 min ago".

const STATE: Record<WorkerState, { short: Key; long: Key; color: string }> = {
  running: { short: "orch.state.running", long: "orch.state.running", color: "text-accent" },
  done: { short: "orch.state.done", long: "orch.long.done", color: "text-ok" },
  blocked: { short: "orch.state.blocked", long: "orch.long.blocked", color: "text-accent-text" },
  failed: { short: "orch.state.failed", long: "orch.state.failed", color: "text-late" },
  stopped: { short: "orch.state.stopped", long: "orch.state.stopped", color: "text-tertiary" },
  silent: { short: "orch.state.noReport", long: "orch.state.silent", color: "text-soon" },
};
/** A worker's state: the short word for a row, the longer one for its page, the colour; a pipeline's check or review
 *  while it validates; "looks stuck" while the backend marks it stalled. */
export function useStateText(worker: Worker) {
  const { t } = useT();
  const state = STATE[worker.state] ?? STATE.stopped;
  const phase = worker.phase ? t(worker.phase === "review" ? "orch.reviewing" : "orch.checking") : "";
  if (worker.state === "running" && worker.stalled)
    return { short: t("orch.stuck"), long: t("orch.stuck"), color: "text-soon" };
  return { short: phase || t(state.short), long: phase || t(state.long), color: state.color };
}

/** The sidebar's language: a spinner while it works, the accent dot when it waits on you, a tick or a cross when it
 *  ended. */
export function StateMark({ state }: { state: WorkerState }) {
  if (state === "running") return <span className="spinner" />;
  if (state === "done") return <Icon name="check" className="glyph size-3 stroke-[2.5] text-ok" />;
  if (state === "failed") return <Icon name="close" className="glyph size-3 stroke-[2.5] text-late" />;
  const dot = state === "blocked" ? "bg-accent" : state === "silent" ? "bg-soon" : "bg-separator-strong";
  return <span className={`size-1.5 rounded-full ${dot}`} />;
}

/** A worker (or a conversation's subagent) as its crab, with its state as a ringed badge once it ended; with the crabs
 *  switched off (Settings › General) the plain state mark. */
export function WorkerAvatar({
  worker,
  size = 28,
}: {
  worker: Pick<Worker, "state" | "model" | "ticket">;
  size?: number;
}) {
  const crabs = useSettingsStore(s => s.settings.workerCrabs !== false);
  if (!crabs)
    return (
      <span className="grid place-items-center flex-none self-start" style={{ width: size, height: size }}>
        <StateMark state={worker.state} />
      </span>
    );
  return (
    <span className="relative inline-flex flex-none self-start">
      <Crab
        costume={costumeOf(worker.model, !!worker.ticket)}
        running={worker.state === "running"}
        dim={worker.state === "stopped" || worker.state === "silent"}
        size={size}
      />
      {worker.state === "running" ? null : (
        <span className="absolute -right-1.5 -bottom-0.75 size-3.5 rounded-full bg-raised ring-1 ring-separator grid place-items-center">
          <StateMark state={worker.state} />
        </span>
      )}
    </span>
  );
}

/** "5 min ago" for a moment, kept fresh by a clock that ticks every 30 seconds. */
export function useAgo() {
  const { locale } = useT();
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (at: number) => {
    const ago = agoParts(at / 1000, clock);
    return ago ? relativeFormat(locale, { numeric: "auto", style: "short" }).format(ago.value, ago.unit) : "";
  };
}
