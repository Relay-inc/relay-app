import { useRef } from "react";
import type { Meeting } from "../../../domain/calendar/types";
import {
  addDecision,
  editStep,
  retryStep,
  savedSteps,
  ticketBoard,
  type StepState,
  type Wrap,
} from "../../../application/calendar/wrapup";
import { meetingProjectOf } from "../../../application/calendar/calendar";
import { useT } from "../../hooks/useT";
import { MarkerIcon } from "./MarkerIcon";

const chip = (on: boolean, disabled = false) =>
  `inline-flex items-center h-5.5 px-2 rounded-full text-xs border ${
    on
      ? "border-transparent bg-accent-soft text-accent-text font-semibold"
      : `border-separator-strong text-secondary ${disabled ? "opacity-50" : "cursor-pointer hover:bg-fill"}`
  }`;

/** One next step: whether it goes in, its text, and where it goes (one chip on), with the date a reminder is for. */
function StepCard({
  meeting,
  id,
  i,
  step,
  locked,
}: {
  meeting: Meeting;
  id: string;
  i: number;
  step: StepState;
  locked: boolean;
}) {
  const { t, locale } = useT();
  const date = useRef<HTMLInputElement>(null);
  const board = ticketBoard(meeting);
  const on = (patch: Parameters<typeof editStep>[2]) => editStep(id, i, patch);
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${step.due}T12:00:00`),
  );
  return (
    <div className="px-3 py-2.5 rounded-[10px] border border-separator">
      <label className="flex items-start gap-2.25 text-sm leading-snug">
        <input
          type="checkbox"
          checked={step.on}
          disabled={locked}
          onChange={e => on({ on: e.target.checked })}
          className="size-3.75 mt-0.75 accent-accent"
        />
        <textarea
          value={step.text}
          disabled={locked}
          rows={Math.max(1, Math.ceil(step.text.length / 62))}
          aria-label={t("meet.wrap.stepText")}
          onChange={e => on({ text: e.target.value.replace(/\n/g, " ") })}
          className={`flex-1 min-w-0 resize-none bg-transparent outline-0 leading-snug ${step.on ? "" : "text-secondary line-through"}`}
        />
        {step.status === "done" ? <span className="text-add-fg text-xs">✓</span> : null}
        {step.status === "busy" ? <span className="spinner mt-1" /> : null}
      </label>
      <div className="flex flex-wrap gap-1.25 mt-2 ml-6">
        <span className="relative">
          <button
            disabled={locked}
            className={chip(step.route === "reminder", locked)}
            onClick={() => (step.route === "reminder" ? date.current?.showPicker?.() : on({ route: "reminder" }))}
          >
            {step.route === "reminder" ? t("meet.wrap.reminderOn", { date: day }) : t("meet.wrap.reminder")}
          </button>
          <input
            ref={date}
            type="date"
            tabIndex={-1}
            aria-label={t("rem.pick")}
            value={step.due}
            onChange={e => e.target.value && on({ due: e.target.value, route: "reminder" })}
            className="absolute left-0 top-full w-0 h-0 opacity-0 pointer-events-none"
          />
        </span>
        <button
          disabled={locked || !board}
          title={board ? undefined : t("meet.wrap.noBoard")}
          className={chip(step.route === "ticket", locked || !board)}
          onClick={() => on({ route: "ticket" })}
        >
          {step.route === "ticket" && board
            ? t("meet.wrap.ticketOn", { board: board.tracker.name })
            : t("meet.wrap.ticket")}
        </button>
        <button disabled={locked} className={chip(step.route === "text", locked)} onClick={() => on({ route: "text" })}>
          {t("meet.wrap.text")}
        </button>
      </div>
      {step.status === "failed" ? (
        <div className="flex items-center gap-2 mt-2 ml-6 text-xs text-late">
          <span className="flex-1 wrap-anywhere">{step.err}</span>
          <button
            className="font-medium text-accent-text cursor-pointer hover:underline"
            onClick={() => void retryStep(meeting, i)}
          >
            {t("rec.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The right side of Wrap-up: my next steps with their routes, the decisions with "Add to the project's note". Once the
 *  summary is saved the steps are the note's, as plain bullets. */
export function WrapSteps({ meeting, wrap, noteText }: { meeting: Meeting; wrap: Wrap | undefined; noteText: string }) {
  const { t } = useT();
  const project = meetingProjectOf(meeting);
  const locked = !wrap || wrap.phase === "saving" || wrap.phase === "saved";
  return (
    <section
      aria-label={t("meet.wrap.steps")}
      className="min-w-0 min-h-0 overflow-y-auto border-l border-separator px-6 pt-5 pb-8"
    >
      <div className="flex items-center gap-2">
        <h2 className="flex-1 m-0 text-[15px] font-semibold">
          {t("meet.wrap.steps")} <span className="font-normal text-xs text-secondary">· {t("meet.wrap.mine")}</span>
        </h2>
        {wrap?.phase === "ready" ? <span className="text-xs text-secondary">{t("meet.wrap.route")}</span> : null}
      </div>
      {wrap?.phase === "generating" ? (
        <div className="flex flex-col gap-2.5 mt-2.5 animate-skel">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-17 rounded-[10px] bg-fill-2" />
          ))}
        </div>
      ) : wrap?.phase === "error" ? null : wrap ? (
        <div className="flex flex-col gap-2.5 mt-2.5">
          {wrap.steps.length ? (
            wrap.steps.map((step, i) => (
              <StepCard key={i} meeting={meeting} id={meeting.id} i={i} step={step} locked={locked} />
            ))
          ) : (
            <span className="text-[13px] text-secondary">{t("meet.wrap.noSteps")}</span>
          )}
        </div>
      ) : (
        <ul className="m-0 mt-2.5 pl-5 list-disc text-sm leading-snug flex flex-col gap-1.5">
          {savedSteps(noteText).map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      )}
      {wrap && wrap.phase !== "generating" && wrap.phase !== "error" && wrap.decisions.length ? (
        <>
          <h2 className="mt-4.5 mb-2 text-[15px] font-semibold">
            {t("meet.wrap.decisions")}{" "}
            <span className="font-normal text-xs text-secondary">· {wrap.decisions.length}</span>
          </h2>
          <div className="flex flex-col gap-1.5">
            {wrap.decisions.map((decision, i) => (
              <div key={i} className="flex items-start gap-2.25 text-sm leading-snug">
                <span className="mt-1.25">
                  <MarkerIcon kind="decision" />
                </span>
                <span className="flex-1 min-w-0">{decision.text}</span>
                {decision.status === "done" ? (
                  <span className="text-xs text-add-fg whitespace-nowrap">{t("meet.wrap.added")}</span>
                ) : (
                  <button
                    disabled={!project || !wrap.canDecide || decision.status === "busy"}
                    title={
                      !project
                        ? t("meet.wrap.noProject")
                        : !wrap.canDecide
                          ? t("meet.wrap.noDecisions", { project })
                          : undefined
                    }
                    className="text-xs text-accent-text whitespace-nowrap cursor-pointer enabled:hover:underline disabled:text-tertiary disabled:cursor-default"
                    onClick={() => void addDecision(meeting, i)}
                  >
                    {t("meet.wrap.addDecision", { project: project ?? "" })}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
