import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { Worker } from "../../../domain/orchestrator/types";
import { needOf } from "../../../domain/orchestrator/rules";
import { columnOf, isPlan, prsOf, ticketOf } from "../../../domain/pipeline/rules";
import type { BouncedTicket } from "../../../application/pipeline/store";
import {
  answerTicket,
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
import { Markdown } from "../../components/Markdown";
import { modKey } from "../../../shared/platform";
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
              <TicketRow
                key={worker.key}
                project={project}
                worker={worker}
                toPick={panel.toPick.includes(worker.key)}
              />
            ))}
          </div>
        ) : (
          <p className="p-3.5 rounded-[10px] border border-dashed border-separator-strong text-xs leading-normal text-tertiary">
            {t("pp.empty")}
          </p>
        )}
      </section>

      {panel.bounced.length ? (
        <section className="flex flex-col gap-1.5">
          <span className={LABEL}>{t("pp.bouncedH")}</span>
          <div className="flex flex-col border border-separator rounded-[10px]">
            {panel.bounced.map(x => (
              <BouncedRow key={x.id} project={project} ticket={x} />
            ))}
          </div>
        </section>
      ) : null}

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
function TicketRow({ project, worker, toPick }: { project: string; worker: Worker; toPick: boolean }) {
  const { t } = useT();
  const ago = useAgo();
  const state = useStateText(worker);
  const ticket = ticketOf(worker)!;
  const question = needOf(worker);
  const running = worker.state === "running";
  const plan = isPlan(worker.report?.questions);
  // what the agent waits on in the input column: an answer to its question, the plan approved, or a new try
  const kind =
    running || toPick || columnOf(worker) !== "input"
      ? null
      : plan
        ? "approve"
        : question?.kind === "ask"
          ? "answer"
          : "retry";
  // taking over stops the agent: asked first, in the row
  const [confirm, setConfirm] = useState(false);
  // a done worker without its PR is not "done with a PR": the state says it needs a person
  const nopr = worker.state === "done" && !prsOf(worker).length;
  const short = nopr ? t("pp.noPr") : state.short;
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
          {toPick ? t("pp.waiting") : t(COLUMN[columnOf(worker)])} ·{" "}
          <span className={nopr ? "text-soon" : state.color}>{short}</span>{" "}
          <span className="text-tertiary">{ago(running ? worker.at : (worker.ended ?? worker.at))}</span>
        </span>
        {worker.branch ? <code className="font-mono text-[11px] text-tertiary truncate">{worker.branch}</code> : null}
        {question?.kind === "ask" && plan ? <PlanText text={question.question} /> : null}
        {question?.kind === "ask" && !plan ? (
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
        {kind ? (
          <AnswerBox
            required={kind === "answer"}
            placeholder={t(kind === "answer" ? "pp.answerPh" : kind === "approve" ? "pp.notePh" : "pp.retryPh")}
            button={t(kind === "answer" ? "pp.answer" : kind === "approve" ? "pp.approve" : "pp.retry")}
            options={kind === "answer" && question?.kind === "ask" ? question.options : []}
            onSend={text => answerTicket(project, { worker }, kind, text)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A ticket the pipeline sent back before an agent started on it: why (the pre-flight's questions, nothing to build
 *  from, or the error), open ticket, and the answer that sends it to the pick column again. */
function BouncedRow({ project, ticket }: { project: string; ticket: BouncedTicket }) {
  const { t } = useT();
  const ago = useAgo();
  return (
    <div className="flex flex-col gap-1 px-3 py-2.5 border-t border-separator first:border-t-0">
      <span className="text-[13px] font-medium truncate" title={ticket.title}>
        {ticket.number ? <span className="text-tertiary">#{ticket.number} </span> : null}
        {ticket.title}
      </span>
      <span className="text-xs text-secondary truncate">
        {t("pl.col.input")} · <span className="text-tertiary">{ago(ticket.at)}</span>
      </span>
      {ticket.why === "unclear" ? (
        <ul className="m-0 pl-4 text-[13px] leading-snug text-accent-text list-disc">
          {ticket.questions.map(q => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] leading-snug text-accent-text line-clamp-3">
          {ticket.why === "bare" ? t("pp.bare") : ticket.reason}
        </p>
      )}
      {ticket.url ? (
        <span className="text-xs">
          <button className={LINK} onClick={() => openPipelineLink(ticket.url)}>
            {t("pp.openTicket")}
          </button>
        </span>
      ) : null}
      <AnswerBox
        required={ticket.why !== "failed"}
        placeholder={t(ticket.why === "failed" ? "pp.retryPh" : "pp.answerPh")}
        button={t("pp.answerStart")}
        options={[]}
        onSend={text => answerTicket(project, { card: ticket }, ticket.why === "failed" ? "retry" : "answer", text)}
      />
    </div>
  );
}

/** A plan sent for approval: clamped, the whole of it a click away. */
function PlanText({ text }: { text: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1 items-start">
      <div className={`w-full ${open ? "" : "max-h-32 overflow-hidden"}`}>
        <Markdown className="md-chat text-[13px]! leading-snug!" text={text} />
      </div>
      <button className={`${LINK} text-xs`} onClick={() => setOpen(!open)}>
        {t(open ? "pp.hidePlan" : "pp.showPlan")}
      </button>
    </div>
  );
}

/** The answer in a row: the options the agent offered as buttons, a field that grows with its text, and the send
 *  button (Cmd-Enter or Ctrl-Enter sends). What was typed stays when sending fails. */
function AnswerBox({
  required,
  placeholder,
  button,
  options,
  onSend,
}: {
  required: boolean;
  placeholder: string;
  button: string;
  options: string[];
  onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async (value: string) => {
    if (sending || (required && !value.trim())) return;
    setSending(true);
    const ok = await onSend(value);
    setSending(false);
    if (ok) setText("");
  };
  const grow = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && modKey(e.nativeEvent) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(text);
    }
  };
  return (
    <div className="flex flex-col gap-2 mt-1">
      {options.length ? (
        <div className="flex flex-wrap gap-2">
          {options.map(option => (
            <button
              key={option}
              className="h-7.5 px-3 rounded-lg border border-separator-strong bg-transparent text-[13px] font-medium text-label hover:bg-fill disabled:opacity-50 cursor-default"
              disabled={sending}
              onClick={() => send(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        className="min-h-8.5 max-h-60 px-3 py-1.5 rounded-lg border border-separator-strong bg-transparent text-[13px] leading-normal text-label outline-0 resize-none focus:border-accent placeholder:text-tertiary"
        rows={1}
        placeholder={placeholder}
        value={text}
        disabled={sending}
        onChange={grow}
        onKeyDown={onKey}
      />
      <div>
        <button
          className="h-7.5 px-3 rounded-lg border-0 bg-accent text-on-accent text-[13px] font-medium hover:bg-accent-hover disabled:opacity-50 cursor-default"
          disabled={sending || (required && !text.trim())}
          onClick={() => send(text)}
        >
          {button}
        </button>
      </div>
    </div>
  );
}
