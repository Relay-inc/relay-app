import { useState } from "react";
import type { Key } from "../../../shared/i18n";
import type { Worker, WorkerState } from "../../../domain/orchestrator/types";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";

const STATE: Record<WorkerState, Key> = {
  running: "orch.state.running",
  done: "orch.state.done",
  blocked: "orch.state.blocked",
  failed: "orch.state.failed",
  stopped: "orch.state.stopped",
  silent: "orch.state.silent",
};

// the sidebar's language: a spinner while it works, the accent dot when it waits on you, a tick or a cross when it ended
function StateMark({ state }: { state: WorkerState }) {
  if (state === "running") return <span className="spinner" />;
  if (state === "done") return <Icon name="check" className="glyph size-3.5 stroke-2 text-ok" />;
  if (state === "failed") return <Icon name="close" className="glyph size-3.5 stroke-2 text-late" />;
  const dot = state === "blocked" ? "bg-accent" : state === "silent" ? "bg-soon" : "bg-separator-strong";
  return <span className={`size-2 rounded-full ${dot}`} />;
}

/** One worker on the board: its state, title, project and since when, the report's summary with its questions, diff and
 *  flags folded under it, and Open and (while it runs) Stop. */
export function WorkerRow({
  worker,
  project,
  when,
  onOpen,
  onStop,
}: {
  worker: Worker;
  project: string; // the project's label as the sidebar shows it, or Algemeen
  when: string; // "5 min ago": since it ended, or since it started while it runs
  onOpen: () => void;
  onStop: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const report = worker.report;
  const more = !!report && (!!report.questions || !!report.diff || report.flags.length > 0);
  return (
    <li className="flex items-start gap-2.5 py-3 border-b border-separator last:border-b-0">
      <span className="h-5 w-3.5 flex-none grid place-items-center">
        <StateMark state={worker.state} />
      </span>
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <div className="flex items-baseline gap-2 text-[13px]">
          <span className="flex-1 min-w-0 truncate font-medium" title={worker.task}>
            {worker.title}
          </span>
          <span className="flex-none text-xs text-tertiary tabular-nums">{when}</span>
        </div>
        <span className="text-xs text-secondary truncate">
          {project} · {t(STATE[worker.state])}
        </span>
        {report ? <Markdown className="md-panel line-clamp-4 select-text" text={report.summary} /> : null}
        {more ? (
          <div>
            <button
              className="inline-flex items-center gap-1.5 h-6 px-1.5 -ml-1.5 border-0 rounded-md bg-transparent text-xs text-secondary cursor-default hover:bg-fill hover:text-label"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <Icon
                name="right"
                className={`glyph size-3 stroke-2 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
              />
              {t("orch.details")}
            </button>
            {open ? (
              <div className="mt-1 ml-1.25 pl-3 border-l border-separator-strong flex flex-col gap-2.5 select-text">
                {report.questions ? (
                  <section>
                    <h3 className="text-xs font-semibold mb-0.5">{t("orch.questions")}</h3>
                    <Markdown className="md-panel [&_ul]:list-disc" text={report.questions} />
                  </section>
                ) : null}
                {report.diff ? (
                  <section>
                    <h3 className="text-xs font-semibold mb-1">{t("orch.diff")}</h3>
                    <pre className="font-mono text-xs leading-normal whitespace-pre overflow-x-auto bg-well border border-separator rounded-lg px-2.5 py-2">
                      {report.diff}
                    </pre>
                  </section>
                ) : null}
                {report.flags.length ? (
                  <section>
                    <h3 className="text-xs font-semibold mb-1">{t("orch.flags")}</h3>
                    <ul className="flex flex-col gap-0.5 text-xs text-late">
                      {report.flags.map(flag => (
                        <li key={flag}>{flag}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-1.5 mt-1">
          <button className="btn h-6.5 px-2.5 text-xs" onClick={onOpen}>
            {t("orch.open")}
          </button>
          {worker.state === "running" ? (
            <button className="btn h-6.5 px-2.5 text-xs" onClick={onStop}>
              {t("orch.stop")}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
