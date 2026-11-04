import { joinable, meetingLanguage } from "../../../domain/calendar/rules";
import { STEPS, type Step } from "../../../domain/calendar/meeting-view";
import type { Meeting } from "../../../domain/calendar/types";
import { joinMeeting, meetingProjectOf, timeOf } from "../../../application/calendar/calendar";
import { backToToday, saveLanguage } from "../../../application/calendar/meeting-view";
import { projectChip } from "../../../application/today/today";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { initials } from "../today/parts";

// the languages a meeting is transcribed in: the app's own, and whatever the note already says
const LANGUAGES = ["nl", "en", "fr", "de"];
/** The meeting's header: back to Today, title, the stage stepper, then when, project, people, the transcription's
 *  language (written into the note's `language:`) and Join. `step` is the one shown, `reached` how far the meeting is. */
export function MeetingHeader({
  meeting,
  noteText,
  step,
  reached,
  onStep,
}: {
  meeting: Meeting;
  noteText: string | null;
  step: Step;
  reached: Step;
  onStep: (step: Step) => void;
}) {
  const { t, locale } = useT();
  const project = projectChip(meetingProjectOf(meeting));
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(
    new Date(meeting.start),
  );
  const names = new Intl.DisplayNames([locale], { type: "language" });
  const language = meetingLanguage(noteText, "auto") ?? "";
  const codes = language && !LANGUAGES.includes(language) ? [...LANGUAGES, language] : LANGUAGES;
  const at = STEPS.indexOf(step);
  const upto = STEPS.indexOf(reached);
  return (
    <div className="flex-none px-7 pt-4 pb-3.5 border-b border-separator">
      <div className="flex items-center gap-4">
        <button
          className="flex-none inline-flex items-center gap-1 h-7 pl-1 pr-2 -ml-1 rounded-lg text-[13px] text-secondary cursor-pointer hover:bg-fill hover:text-label"
          onClick={backToToday}
        >
          <Icon name="left" className="glyph size-3.5" />
          {t("nav.today")}
        </button>
        <h1 className="flex-1 min-w-0 m-0 text-xl font-bold tracking-tight truncate select-text">
          {meeting.title || t("wait.meetingUntitled")}
        </h1>
        <ol aria-label={t("meet.stage")} className="flex-none flex items-center gap-1.5 m-0 p-0 list-none">
          {STEPS.map((id, i) => {
            const current = i === at;
            const done = i < upto && !current;
            // Briefing and Live can be looked at any time; Wrap-up once the meeting got there
            const open = id !== "wrapup" || i <= upto;
            return (
              <li key={id} className="flex items-center gap-1.5">
                {i ? <span className="w-4 h-px bg-separator-strong" /> : null}
                <button
                  aria-current={current ? "step" : undefined}
                  disabled={!open}
                  onClick={() => onStep(id)}
                  className={`inline-flex items-center gap-1.5 h-6.5 px-2.5 rounded-full text-[12.5px] ${
                    current
                      ? "bg-accent-soft text-accent-text font-semibold cursor-pointer"
                      : `border border-separator-strong ${done ? "text-label" : "text-secondary"} font-medium ${open ? "cursor-pointer hover:bg-fill" : ""}`
                  }`}
                >
                  {done ? <Icon name="check" className="glyph size-3" /> : null}
                  {id === "live" && reached === "live" ? <span className="size-1.75 rounded-full bg-late" /> : null}
                  {t(`meet.step.${id}`)}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex items-center flex-wrap gap-2 mt-2 text-secondary">
        <span>
          {day} · {timeOf(meeting.start)} – {timeOf(meeting.end)}
        </span>
        {project ? (
          <span className="inline-flex items-center h-6 px-2 rounded-md border border-separator-strong text-xs text-label">
            {project.label}
          </span>
        ) : null}
        {meeting.people.map(person => (
          <span
            key={person.email}
            className="inline-flex items-center gap-1.5 h-6 pl-0.75 pr-2.25 rounded-full bg-fill-2 text-xs text-label"
            title={person.email}
          >
            <span className="grid place-items-center size-4.5 rounded-full bg-fill-2 text-secondary text-[9px] font-semibold">
              {initials(person.name || person.email)}
            </span>
            {person.name || person.email}
          </span>
        ))}
        <Select
          aria-label={t("meet.language")}
          className="h-6 px-1.5 rounded-md border border-separator-strong bg-transparent text-xs font-semibold text-label cursor-pointer"
          options={[
            { id: "", name: t("meet.auto") },
            ...codes.map(code => ({ id: code, name: names.of(code) ?? code })),
          ]}
          value={language}
          onChange={code => void saveLanguage(meeting, code)}
        />
        <span className="flex-1" />
        {joinable(meeting.join) ? (
          <button
            className="inline-flex items-center gap-1.5 btn cursor-pointer"
            onClick={() => joinMeeting(meeting.join)}
          >
            <Icon name="video" className="glyph size-3.5" />
            {t("wait.meetingJoin")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
