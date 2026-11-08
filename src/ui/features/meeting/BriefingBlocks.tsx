import { useEffect, useRef } from "react";
import { addPoint, editPoint, removePoint, type Shaped, type Step } from "../../../domain/calendar/briefing";
import type { Meeting } from "../../../domain/calendar/types";
import { meetingProjectOf } from "../../../application/calendar/calendar";
import { changeBriefing, toggleBriefingTask } from "../../../application/calendar/meeting-view";
import { openMailThread } from "../../../application/mail/mail";
import { openNoteLink } from "../../../application/navigation/pages";
import { projectChip } from "../../../application/today/today";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { initials } from "../today/parts";
import { TILE } from "./MeetingHeader";

const H2 = "m-0 mt-5 mb-1.5 text-[15px] font-semibold leading-snug";
const MUTED = "font-normal text-xs text-secondary";

/** The briefing in its fixed shape as the design draws it: the goal, the people with when they were last met, what is
 *  left from last time (ticked ones struck through), the threads in the mail, and My points that can be typed in. Every
 *  tick and edit is written into the briefing section of the note. */
export function BriefingBlocks({ meeting, shaped }: { meeting: Meeting; shaped: Shaped }) {
  const { t, locale } = useT();
  const tint = projectChip(meetingProjectOf(meeting))?.tint ?? "";
  const when = (day: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00`));
  const names = meeting.people.map(person => person.name || person.email).join(", ");
  // the point to put the cursor in once the note has been written again
  const pending = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pending.current === null) return;
    const input = root.current?.querySelector<HTMLInputElement>(`input[data-point="${pending.current}"]`);
    if (input) {
      input.focus();
      pending.current = null;
    }
  });

  const steps = (list: Step[]) => (
    <div className="flex flex-col gap-1.5 text-sm">
      {list.map(step => (
        <label
          key={step.n}
          className={`flex items-center gap-2.25 cursor-pointer ${step.done ? "text-secondary" : ""}`}
        >
          <input
            type="checkbox"
            checked={step.done}
            className="size-3.75 accent-accent"
            onChange={() => void toggleBriefingTask(meeting, step.n)}
          />
          <span>
            <span className={step.done ? "line-through" : ""}>{step.text}</span>
            {step.doneOn ? <span> · {t("meet.brief.done", { date: when(step.doneOn) })}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
  return (
    <div ref={root} className="select-text">
      {shaped.goal ? (
        <>
          <h2 className={`${H2} mt-0`}>{t("meet.brief.goal")}</h2>
          <p className="m-0 text-[15px] leading-[1.55]">{shaped.goal}</p>
        </>
      ) : null}
      {shaped.people.length ? (
        <>
          <h2 className={H2}>{t("meet.brief.people")}</h2>
          <div className="flex flex-col gap-2.5">
            {shaped.people.map(person => (
              <div key={person.name} className="flex items-center gap-2.5">
                <span
                  className={`grid place-items-center size-7.5 flex-none rounded-full text-[11px] font-bold ${TILE[tint as keyof typeof TILE]}`}
                >
                  {initials(person.name)}
                </span>
                <span className="flex flex-col leading-snug">
                  {person.link ? (
                    <button
                      className="text-left font-medium text-accent-text cursor-pointer hover:underline"
                      onClick={() => void openNoteLink(person.name)}
                    >
                      {person.name}
                    </button>
                  ) : (
                    <span className="font-medium">{person.name}</span>
                  )}
                  {person.role || person.lastMet ? (
                    <span className="text-xs text-secondary">
                      {[person.role, person.lastMet ? t("meet.brief.lastMet", { date: when(person.lastMet) }) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {shaped.since.steps.length ? (
        <>
          <h2 className={H2}>
            {t("meet.brief.since")}
            {shaped.since.from ? (
              <span className={MUTED}>
                {" · "}
                {t("meet.brief.from")}{" "}
                <button
                  className="text-accent-text cursor-pointer hover:underline"
                  onClick={() => void openNoteLink(shaped.since.from)}
                >
                  {shaped.since.from}
                </button>
              </span>
            ) : null}
          </h2>
          {steps(shaped.since.steps)}
        </>
      ) : null}
      {shaped.threads.length ? (
        <>
          <h2 className={H2}>
            {t("meet.brief.threads")} <span className={MUTED}>· {t("meet.brief.threadsHint", { names })}</span>
          </h2>
          <div className="overflow-hidden rounded-[10px] border border-separator">
            {shaped.threads.map((thread, i) => (
              <button
                key={`${thread.key}${i}`}
                disabled={!thread.key}
                className="flex items-center gap-2.5 w-full h-9.5 px-3 border-b border-separator last:border-0 text-left text-sm enabled:cursor-pointer enabled:hover:bg-fill"
                onClick={() => void openMailThread(thread.key)}
              >
                <Icon name="mail" className="glyph size-3.5 flex-none text-secondary" />
                <span className="flex-1 min-w-0 truncate">{thread.subject}</span>
                <span className="text-xs text-secondary">{when(thread.date)}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <h2 className={H2}>{t("meet.brief.points")}</h2>
      <div className="flex flex-col gap-1.5 text-sm">
        {shaped.points.map((point, i) => (
          <label key={point.n} className="flex items-center gap-2.25">
            <input
              type="checkbox"
              checked={point.done}
              className="size-3.75 accent-accent"
              onChange={() => void toggleBriefingTask(meeting, point.n)}
            />
            <input
              data-point={point.n}
              defaultValue={point.text}
              aria-label={t("meet.brief.point")}
              className={`flex-1 min-w-0 bg-transparent outline-0 ${point.done ? "text-secondary line-through" : ""}`}
              onBlur={e => {
                if (e.currentTarget.value !== point.text)
                  void changeBriefing(meeting, b => editPoint(b, point.n, e.currentTarget.value));
              }}
              onKeyDown={e => {
                const text = e.currentTarget.value;
                if (e.key === "Enter") {
                  e.preventDefault();
                  pending.current = point.n + 1;
                  void changeBriefing(meeting, b => addPoint(editPoint(b, point.n, text), "", point.n));
                } else if (e.key === "Backspace" && !text) {
                  e.preventDefault();
                  pending.current = i > 0 ? shaped.points[i - 1].n : null;
                  void changeBriefing(meeting, b => removePoint(b, point.n));
                }
              }}
            />
          </label>
        ))}
        <button
          className="flex items-center gap-2.25 text-secondary cursor-pointer hover:text-label"
          onClick={() => {
            const last = shaped.points[shaped.points.length - 1];
            pending.current = last ? last.n + 1 : null;
            void changeBriefing(meeting, b => addPoint(b, "", null));
          }}
        >
          <Icon name="plus" className="glyph size-3.75" />
          {t("meet.brief.addPoint")}
        </button>
      </div>
    </div>
  );
}
