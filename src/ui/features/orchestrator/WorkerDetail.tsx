import type { Worker } from "../../../domain/orchestrator/types";
import { needOf, workerName } from "../../../domain/orchestrator/rules";
import { useOrchestratorStore } from "../../../application/orchestrator/store";
import { stopWorker } from "../../../application/orchestrator/orchestrator";
import { openPipelineLink } from "../../../application/pipeline/runner";
import { select } from "../../../application/navigation/navigation";
import { projectName } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { NeedBox } from "./NeedBox";
import { WorkerAvatar, useAgo, useStateText } from "./parts";

const LABEL = "text-[11px] font-semibold tracking-[.06em] uppercase text-tertiary";

/** A worker as a page next to the orchestrator's column: who and where, its state and step, what it asks, its report,
 *  what it changed, what moved, and its conversation. */
export function WorkerDetail({ workerKey }: { workerKey: string }) {
  const worker = useOrchestratorStore(s => s.workers[workerKey]);
  if (!worker) return null;
  return <Page worker={worker} />;
}

function Page({ worker }: { worker: Worker }) {
  const { t } = useT();
  const ago = useAgo();
  const state = useStateText(worker);
  const project = useDerived(() => projectName(worker.project));
  const need = needOf(worker);
  const report = worker.report;
  const ticket = worker.ticket as { number?: string; url?: string } | undefined;
  const step = worker.state === "running" && worker.step?.total ? worker.step : null;
  const files = report?.files ?? [];
  const plus = files.reduce((sum, [, added]) => sum + added, 0);
  const minus = files.reduce((sum, [, , removed]) => sum + removed, 0);
  const model = worker.ticket
    ? t("orch.model.pipeline")
    : worker.model
      ? worker.model.charAt(0).toUpperCase() + worker.model.slice(1)
      : t("orch.model.default");
  const when =
    worker.state === "running"
      ? t("orch.started", { ago: ago(worker.at) })
      : t("orch.ended", { ago: ago(worker.ended ?? worker.at) });
  return (
    <div className="flex flex-col gap-5 max-w-155 select-text">
      <div className="flex items-center gap-2 text-xs text-secondary">
        <span>{project}</span>
        {worker.branch ? (
          <>
            <span className="text-tertiary">·</span>
            <code className="font-mono text-[11px]">{worker.branch}</code>
          </>
        ) : null}
        <span className="flex-1" />
        <span className="text-tertiary">{when}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="mb-1">
          <WorkerAvatar worker={worker} size={40} />
        </span>
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-.01em]">{worker.title}</h2>
        <span className={`flex items-center gap-2 text-[13px] ${state.color}`}>
          <span className="size-2 rounded-full bg-current" />
          {state.long}
          <span className="text-tertiary">
            · {workerName(worker.key)} · {model}
          </span>
        </span>
        {worker.state === "running" && worker.stalled ? (
          <span className="text-[13px] text-soon">{worker.stalled}</span>
        ) : null}
        {step ? (
          <span className="flex items-center gap-2.5 mt-1 text-[13px] text-secondary">
            <span className="h-1 w-30 flex-none rounded-full bg-fill-2 overflow-hidden">
              <span className="block h-full bg-accent" style={{ width: `${(100 * step.done) / step.total}%` }} />
            </span>
            {t("orch.step", { done: step.done, total: step.total })}
            {step.note ? ` · ${step.note}` : ""}
          </span>
        ) : null}
        {ticket ? (
          <span className="flex gap-3.5 mt-1 text-[13px]">
            <button
              className="text-accent-text bg-transparent border-0 p-0 cursor-default hover:underline"
              onClick={() => ticket.url && openPipelineLink(ticket.url)}
            >
              {t("orch.ticket", { number: ticket.number ?? "" })}
            </button>
            {worker.pr ? (
              <button
                className="text-accent-text bg-transparent border-0 p-0 cursor-default hover:underline"
                onClick={() => openPipelineLink(worker.pr!)}
              >
                {worker.base_branch ? t("orch.prInto", { base: worker.base_branch }) : t("orch.pr")}
              </button>
            ) : null}
            {worker.pr_error ? <span className="text-late">{worker.pr_error}</span> : null}
          </span>
        ) : null}
      </div>

      {need ? <NeedBox worker={worker} need={need} large /> : null}
      {worker.answer ? (
        <div className="flex items-center gap-2 text-[13px] text-ok">
          <Icon name="check" className="glyph size-3.5 stroke-[2.5]" />
          {t("orch.answered", { answer: worker.answer })}
        </div>
      ) : null}

      {report?.summary ? (
        <section className="flex flex-col gap-1.5">
          <span className={LABEL}>{t("orch.reportH")}</span>
          <Markdown className="md-chat text-[15px]! leading-relaxed!" text={report.summary} />
        </section>
      ) : null}
      {files.length ? (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className={LABEL}>{t("orch.diff")}</span>
            <span className="font-mono text-[11px]">
              <span className="text-add-fg">+{plus}</span> <span className="text-del-fg">−{minus}</span>
            </span>
            <span className="text-[11px] text-tertiary">{t("orch.fromGit")}</span>
          </div>
          <div className="flex flex-col border border-separator rounded-[10px]">
            {files.map(([path, added, removed]) => (
              <div
                key={path}
                className="flex items-center gap-2.5 h-9 px-3 border-t border-separator first:border-t-0 font-mono text-xs"
              >
                <Icon name="file" className="glyph size-3.25 text-tertiary" />
                <span className="flex-1 min-w-0 truncate">{path}</span>
                <span className="text-add-fg">+{added}</span>
                <span className="text-del-fg">−{removed}</span>
              </div>
            ))}
          </div>
        </section>
      ) : report?.diff ? (
        // a report from before Relay counted per file: the stat as git wrote it
        <section className="flex flex-col gap-1.5">
          <span className={LABEL}>{t("orch.diff")}</span>
          <pre className="font-mono text-xs leading-normal whitespace-pre overflow-x-auto bg-well border border-separator rounded-lg px-2.5 py-2">
            {report.diff}
          </pre>
        </section>
      ) : null}
      {report?.flags.length ? (
        <section className="flex flex-col gap-1.5">
          <span className={LABEL}>{t("orch.flags")}</span>
          {report.flags.map(flag => (
            <span key={flag} className="flex items-center gap-2 text-[13px] text-late">
              <Icon name="alert" className="glyph size-3.5" />
              {flag}
            </span>
          ))}
        </section>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <button
          className="btn inline-flex items-center h-8 px-3 text-[13px] gap-1.5"
          onClick={() => select(worker.key)}
        >
          <Icon name="chat" className="glyph size-3.5" />
          {t("orch.openConversation")}
        </button>
        {worker.state === "running" ? (
          <button
            className="h-8 px-3 rounded-lg border-0 bg-transparent text-[13px] font-medium text-secondary hover:bg-fill-2"
            onClick={() => stopWorker(worker.key)}
          >
            {t("orch.stop")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
