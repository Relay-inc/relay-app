import { useState } from "react";
import type { Worker } from "../../../domain/orchestrator/types";
import { needOf } from "../../../domain/orchestrator/rules";
import { columnOf, prsOf, ticketOf } from "../../../domain/pipeline/rules";
import {
  openPipelineLink,
  pauseAllPipelines,
  pausePipeline,
  pipelinePanel,
  takeOver,
} from "../../../application/pipeline/runner";
import { openWorker } from "../../../application/navigation/navigation";
import { projectName } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Switch } from "../settings/Switch";
import { WorkerAvatar, useAgo, useStateText } from "../orchestrator/parts";
import { prLinks } from "../orchestrator/WorkerDetail";

const LABEL = "text-[11px] font-semibold tracking-[.06em] uppercase text-tertiary";
const BUTTON = "btn inline-flex items-center h-8 px-3 text-[13px] gap-1.5";
const GHOST =
  "h-8 px-3 rounded-lg border-0 bg-transparent text-[13px] font-medium text-secondary hover:bg-fill-2 cursor-default";
const LINK = "text-accent-text bg-transparent border-0 p-0 cursor-default hover:underline";
const COLUMN = { busy: "pl.col.busy", review: "pl.col.review", input: "pl.col.input" } as const;

/** A project's board pipeline in the right drawer: whether it runs or is paused (and why it holds), its agents against
 *  its maximum, pause and go on, the switch that pauses every pipeline, each ticket it works on with its worker, then
 *  the tickets waiting in its pick column as the runner last read them. */
export function PipelinePanel({ project }: { project: string }) {
  const { t } = useT();
  const ago = useAgo();
  const panel = useDerived(() => pipelinePanel(project));
  const name = useDerived(() => projectName(project));
  // stopping the running agents asks first, in place
  const [confirm, setConfirm] = useState(false);
  if (!panel.linked) return <p className="px-1 text-[13px] text-secondary">{t("pp.none")}</p>;

  const paused = panel.paused || panel.all;
  const status = !panel.on
    ? { text: t("pp.off"), color: "text-tertiary" }
    : panel.all
      ? { text: t("pp.pausedAll"), color: "text-soon" }
      : panel.paused
        ? { text: t("pp.paused"), color: "text-soon" }
        : { text: t("pp.running"), color: "text-ok" };
  return (
    <div className="flex flex-col gap-5 select-text">
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-[13px]">
          <span className={`flex items-center gap-2 font-medium ${status.color}`}>
            <span className="size-2 rounded-full bg-current" />
            {status.text}
          </span>
          <span className="flex-1" />
          <span className="text-secondary tabular-nums">
            {t("pp.agents", { n: panel.running, max: panel.parallel })}
          </span>
        </div>
        {panel.on && !paused && panel.holding ? (
          <span className="flex items-start gap-2 text-[13px] text-soon">
            <Icon name="alert" className="glyph size-3.5 mt-0.5 flex-none" />
            {t(panel.holding, { project: name })}
          </span>
        ) : null}
        {panel.on ? (
          confirm ? (
            <Confirm
              text={t("pp.stopAsk")}
              yes={t("pp.stopYes")}
              onYes={() => {
                setConfirm(false);
                void pausePipeline(project, true, true);
              }}
              onCancel={() => setConfirm(false)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {panel.all ? (
                <button className={BUTTON} onClick={() => pauseAllPipelines(false)}>
                  {t("pp.resumeAll")}
                </button>
              ) : panel.paused ? (
                <button className={BUTTON} onClick={() => pausePipeline(project, false)}>
                  {t("pp.resume")}
                </button>
              ) : (
                <button className={BUTTON} onClick={() => pausePipeline(project, true)}>
                  {t("pp.pause")}
                </button>
              )}
              {/* paused already, the running agents can still be stopped */}
              {panel.running ? (
                <button className={GHOST} onClick={() => setConfirm(true)}>
                  {t(paused ? "pp.stopAgents" : "pp.pauseStop")}
                </button>
              ) : null}
            </div>
          )
        ) : null}
        <p className="text-xs leading-normal text-tertiary">{t(panel.on ? "pp.pauseHelp" : "pp.offHelp")}</p>
        <label className="flex items-center gap-3 pt-1 text-[13px]">
          <span className="flex-1">{t("pp.all")}</span>
          <Switch id="pl-paused-all" on={panel.all} onToggle={pauseAllPipelines} />
        </label>
      </section>

      <section className="flex flex-col gap-1.5">
        <span className={LABEL}>{t("pp.tickets")}</span>
        {panel.tickets.length ? (
          <div className="flex flex-col border border-separator rounded-[10px]">
            {panel.tickets.map(worker => (
              <TicketRow key={worker.key} worker={worker} />
            ))}
          </div>
        ) : (
          <p className="p-3.5 rounded-[10px] border border-dashed border-separator-strong text-xs leading-normal text-tertiary">
            {t("pp.empty")}
          </p>
        )}
      </section>

      {panel.waiting?.tickets.length ? (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className={LABEL}>{t(paused ? "pp.waitingPaused" : "pp.waiting")}</span>
            <span className="flex-1" />
            <span className="text-[11px] text-tertiary">{t("pp.read", { ago: ago(panel.waiting.at) })}</span>
          </div>
          <div className="flex flex-col border border-separator rounded-[10px]">
            {panel.waiting.tickets.map(x => (
              <div
                key={x.id}
                className="flex items-center gap-2.5 h-9 px-3 border-t border-separator first:border-t-0 text-[13px]"
              >
                <span className="flex-1 min-w-0 truncate">
                  {x.number ? <span className="text-tertiary">#{x.number} </span> : null}
                  {x.title}
                </span>
                {x.url ? (
                  <button className={`${LINK} flex-none text-xs`} onClick={() => openPipelineLink(x.url)}>
                    {t("pp.openTicket")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** An in-place question before something that stops an agent: what happens, the red button and Cancel. */
function Confirm({
  text,
  yes,
  onYes,
  onCancel,
}: {
  text: string;
  yes: string;
  onYes: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-separator px-3.5 py-3 text-[13px]">
      <span>{text}</span>
      <div className="flex gap-2">
        <button
          className="h-7.5 px-3 rounded-lg border-0 bg-late text-white font-medium cursor-default"
          onClick={onYes}
        >
          {yes}
        </button>
        <button className={GHOST} onClick={onCancel}>
          {t("pp.cancel")}
        </button>
      </div>
    </div>
  );
}

/** One ticket of the pipeline: its number and title (a click opens the worker's page), where it is on the board, its
 *  worker's state and for how long, the branch, what the agent asks, and open ticket, open PR and take over. */
function TicketRow({ worker }: { worker: Worker }) {
  const { t } = useT();
  const ago = useAgo();
  const state = useStateText(worker);
  const ticket = ticketOf(worker)!;
  const question = needOf(worker);
  const running = worker.state === "running";
  // taking over stops the agent: asked first, in the row
  const [confirm, setConfirm] = useState(false);
  // a done worker without its PR is not "done with a PR": the state says it needs a person
  const short = worker.state === "done" && !prsOf(worker).length ? t("pp.noPr") : state.short;
  return (
    <div className="flex gap-2.5 px-3 py-2.5 border-t border-separator first:border-t-0">
      <WorkerAvatar worker={worker} size={24} />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <button
          className="text-left bg-transparent border-0 p-0 cursor-default text-[13px] font-medium truncate hover:underline"
          title={worker.title}
          onClick={() => openWorker(worker.key)}
        >
          {ticket.number ? <span className="text-tertiary">#{ticket.number} </span> : null}
          {ticket.title || worker.title}
        </button>
        <span className="text-xs text-secondary truncate">
          {t(COLUMN[columnOf(worker)])} · <span className={state.color}>{short}</span>{" "}
          <span className="text-tertiary">{ago(running ? worker.at : (worker.ended ?? worker.at))}</span>
        </span>
        {worker.branch ? <code className="font-mono text-[11px] text-tertiary truncate">{worker.branch}</code> : null}
        {question?.kind === "ask" ? (
          <p className="text-[13px] leading-snug text-accent-text line-clamp-3 whitespace-pre-line">
            {question.question}
          </p>
        ) : null}
        <span className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs">
          {ticket.url ? (
            <button className={LINK} onClick={() => openPipelineLink(ticket.url)}>
              {t("pp.openTicket")}
            </button>
          ) : null}
          {prLinks(worker).map(l => (
            <button key={l.url} className={LINK} onClick={() => openPipelineLink(l.url)}>
              {l.repo ? t("orch.prIn", { repo: l.repo }) : t("pp.openPr")}
            </button>
          ))}
          {running && !confirm ? (
            <button className={LINK} title={t("pp.takeOverHelp")} onClick={() => setConfirm(true)}>
              {t("pp.takeOver")}
            </button>
          ) : null}
        </span>
        {running && confirm ? (
          <Confirm
            text={t("pp.takeOverAsk")}
            yes={t("pp.takeOverYes")}
            onYes={() => {
              setConfirm(false);
              void takeOver(worker);
            }}
            onCancel={() => setConfirm(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
