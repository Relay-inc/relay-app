import { useState, type ReactNode } from "react";
import { costumeOf } from "../../../domain/orchestrator/rules";
import { ticketOf, type AnswerKind } from "../../../domain/pipeline/rules";
import { stripOf, type Need } from "../../../domain/pipeline/strip";
import {
  answerTicket,
  buildTicket,
  ignoreTicket,
  openPipelineLink,
  pipelinePanel,
} from "../../../application/pipeline/runner";
import type { BouncedTicket } from "../../../application/pipeline/store";
import { toast } from "../../../application/navigation/navigation";
import { settings } from "../../../application/settings/settings";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { Crab } from "../orchestrator/Crab";
import { StateMark } from "../orchestrator/parts";

const PRIMARY = "h-7.5 px-3 rounded-lg border-0 bg-accent text-on-accent font-medium hover:bg-accent-hover";
const SECONDARY = "h-7.5 px-3 rounded-lg border border-separator-strong bg-transparent font-medium hover:bg-fill";

/** What waits on you in a pipeline, as compact cards at the end of its conversation. Built from the pipeline's live
 *  data, not from the coordinator's text: a question with its options and a free answer, a plan to approve or send
 *  back, a failed run to try again, a ticket a person moved on to build with an agent. One primary button each, and
 *  the only place the actions are: the strip above only lists them and scrolls here. */
export function PipeCards({ project }: { project: string }) {
  const needs = useDerived(() => stripOf(pipelinePanel(project)).need);
  if (!needs.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {needs.map(n => (
        <NeedCard key={n.id} project={project} need={n} />
      ))}
    </div>
  );
}

function NeedCard({ project, need }: { project: string; need: Need<BouncedTicket> }) {
  const { t } = useT();
  const [own, setOwn] = useState("");
  const [sending, setSending] = useState(false);
  const worker = need.worker;
  const to = worker ? { worker } : { card: need.card! };
  const send = async (kind: AnswerKind, text: string) => {
    if (sending) return;
    setSending(true);
    const ok = await answerTicket(project, to, kind, text, say => toast(say));
    setSending(false);
    if (ok) setOwn("");
  };
  const ignore = async () => {
    if (sending) return;
    setSending(true);
    await ignoreTicket(project, to).catch(e => toast(String((e as Error)?.message ?? e)));
    setSending(false);
  };
  const build = () => {
    const ref = settings().boards?.[project];
    const ticket = worker && ticketOf(worker);
    if (ref && ticket) void buildTicket(ref, { id: ticket.card, title: ticket.title, number: ticket.number });
  };
  const family = costumeOf(worker?.model, false);
  const model = family === "plain" ? t("ps.agent") : family[0].toUpperCase() + family.slice(1);
  const who =
    need.kind === "moved"
      ? t("ps.who.held")
      : t(need.kind === "plan" ? "ps.who.plan" : need.kind === "failed" ? "ps.who.failed" : "ps.who.asks", { model });
  const column = need.column;
  const plan = need.kind === "plan";
  // the plan's text without its label, which the card says in its own words
  const body = plan ? need.question.replace(/^Plan for approval:\s*/, "") : need.question;
  const failure = worker ? worker.report?.summary || worker.pr_error || "" : (need.card?.reason ?? "");
  const text =
    need.kind === "moved"
      ? t(column ? "ps.movedText" : "ps.movedTextAny", { column })
      : need.kind === "failed"
        ? failure
        : need.card && !need.question
          ? t("ps.bare")
          : need.kind === "plan"
            ? t("ps.planLabel")
            : "";
  return (
    <div
      id={`pipe-need-${need.id}`}
      className="flex flex-col gap-2 px-3.5 py-3 rounded-xl border border-accent bg-raised"
    >
      <div className="flex items-center gap-2 text-xs text-secondary">
        <CardMark need={need} />
        {need.ref ? (
          <button
            className="tabular-nums cursor-default hover:underline"
            onClick={() => need.url && openPipelineLink(need.url)}
          >
            #{need.ref}
          </button>
        ) : null}
        <button
          className="font-semibold text-label cursor-default hover:underline truncate"
          onClick={() => need.url && openPipelineLink(need.url)}
        >
          {need.title}
        </button>
        <span className="whitespace-nowrap">· {who}</span>
        <span className="flex-1" />
        <button
          className="flex-none h-6 px-2 -mr-1.5 rounded-md text-xs text-secondary cursor-default hover:bg-fill hover:text-label disabled:opacity-50"
          disabled={sending}
          title={t("ps.ignoreHelp")}
          onClick={() => void ignore()}
        >
          {t("ps.ignore")}
        </button>
      </div>
      {need.kind === "moved" ? (
        <span className="self-start h-5 inline-flex items-center gap-1.25 px-2 rounded-full border border-separator-strong text-xs text-secondary">
          <Icon name="right" className="glyph size-2.75" />
          {t(column ? "ps.movedIn" : "ps.moved", { column })}
        </span>
      ) : null}
      {text ? <div className="text-sm leading-normal">{text}</div> : null}
      {body ? <Markdown className="md-chat text-sm! leading-normal!" text={body} /> : null}
      {need.kind === "ask" ? (
        <Answer
          options={need.options}
          sending={sending}
          own={own}
          setOwn={setOwn}
          placeholder={t("orch.ownAnswer")}
          onSend={answer => send("answer", answer)}
          sendLabel={need.options.length ? "" : t("ps.send")}
        />
      ) : null}
      {plan ? (
        <>
          <input
            className="h-7.5 px-2.5 rounded-lg border border-separator-strong bg-transparent text-[13px] outline-0 focus:border-accent placeholder:text-tertiary"
            aria-label={t("ps.planNote")}
            placeholder={t("ps.planNote")}
            value={own}
            disabled={sending}
            onChange={e => setOwn(e.target.value)}
          />
          <div className="flex gap-1.5">
            <button className={PRIMARY} disabled={sending} onClick={() => send("approve", own)}>
              {t("ps.approve")}
            </button>
            <button className={SECONDARY} disabled={sending || !own.trim()} onClick={() => send("changes", own)}>
              {t("ps.askChanges")}
            </button>
          </div>
        </>
      ) : null}
      {need.kind === "failed" ? (
        <button className={`${PRIMARY} self-start`} disabled={sending} onClick={() => send("retry", "")}>
          {t("ps.retry")}
        </button>
      ) : null}
      {need.kind === "moved" ? (
        <button className={`${PRIMARY} self-start`} onClick={build}>
          {t("ps.buildAgent")}
        </button>
      ) : null}
    </div>
  );
}

/** The options an agent offered, the first one the primary, and a field for the person's own words: Enter sends it,
 *  or the send button when there are no options. */
function Answer({
  options,
  sending,
  own,
  setOwn,
  placeholder,
  sendLabel,
  onSend,
}: {
  options: string[];
  sending: boolean;
  own: string;
  setOwn: (text: string) => void;
  placeholder: string;
  sendLabel: string;
  onSend: (text: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      {options.length ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option, i) => (
            <button
              key={option}
              className={i === 0 ? PRIMARY : SECONDARY}
              disabled={sending}
              onClick={() => onSend(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <input
        className="h-7.5 px-2.5 rounded-lg border border-separator-strong bg-transparent text-[13px] outline-0 focus:border-accent placeholder:text-tertiary"
        aria-label={placeholder}
        placeholder={placeholder}
        value={own}
        disabled={sending}
        onChange={e => setOwn(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && own.trim()) onSend(own);
        }}
      />
      {sendLabel ? (
        <button className={`${PRIMARY} self-start`} disabled={sending || !own.trim()} onClick={() => onSend(own)}>
          {sendLabel}
        </button>
      ) : null}
    </div>
  );
}

/** The agent's crab with the card's mark: a cross when its run failed, the accent dot when it waits on you. */
function CardMark({ need }: { need: Need<BouncedTicket> }) {
  const failed = need.kind === "failed";
  if (!need.worker)
    return failed ? <StateMark state="failed" /> : <span className="size-1.5 rounded-full bg-accent flex-none" />;
  return (
    <span className="relative flex-none">
      <Crab costume="pipeline" running={false} size={24} />
      <span className="absolute -right-1 -bottom-0.75 size-2.75 grid place-items-center rounded-full bg-raised ring-1 ring-separator">
        {failed ? <StateMark state="failed" /> : <span className="size-1.25 rounded-full bg-accent" />}
      </span>
    </span>
  );
}
