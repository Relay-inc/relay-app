import { joinable, meetingLanguage } from "../../../domain/calendar/rules";
import { STEPS, serviceOf, type Step } from "../../../domain/calendar/meeting-view";
import type { Meeting } from "../../../domain/calendar/types";
import { joinMeeting, meetingProjectOf, timeOf } from "../../../application/calendar/calendar";
import { saveLanguage } from "../../../application/calendar/meeting-view";
import { projectChip } from "../../../application/today/today";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { initials } from "../today/parts";
import { Menu } from "./Menu";

// the languages a meeting is transcribed in: the app's own, and whatever the note already says
const LANGUAGES = ["nl", "en", "fr", "de"];
// literal classes, so Tailwind finds them: a context's tile
export const TILE = {
  "": "bg-fill-2 text-secondary",
  "ctx-a": "bg-ctx-a/10 text-ctx-a",
  "ctx-m": "bg-ctx-m/10 text-ctx-m",
  "ctx-p": "bg-ctx-p/10 text-ctx-p",
} as const;
const AVATAR = "grid place-items-center size-4.5 rounded-full bg-fill-2 text-secondary text-[9px] font-semibold";
const CHIP = "inline-flex items-center gap-1.5 h-6 pl-0.75 pr-2.25 rounded-full bg-fill-2 text-xs text-label";

/** The meeting's header: its title with the stage stepper, then when, project, people, the transcription's language
 *  (written into the note's `language:`) and Join. `step` is the one shown, `reached` how far the meeting is. */
export function MeetingHeader({
  meeting,
  noteText,
  step,
  reached,
  wrapReady,
  showJoin,
  onStep,
}: {
  meeting: Meeting;
  noteText: string | null;
  step: Step;
  reached: Step;
  wrapReady: boolean; // Wrap-up can be opened: the meeting is over, or there are notes to summarise
  showJoin: boolean; // once on the screen: the Briefing step has it in its own row
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
  const pick = (code: string, close: () => void) => {
    close();
    void saveLanguage(meeting, code);
  };
  return (
    <div className="flex-none px-7 pt-4 pb-3.5 border-b border-separator">
      <div className="flex items-center gap-4">
        <h1 className="flex-1 min-w-0 m-0 text-xl font-bold tracking-tight truncate select-text">
          {meeting.title || t("wait.meetingUntitled")}
        </h1>
        <ol aria-label={t("meet.stage")} className="flex-none flex items-center gap-1.5 m-0 p-0 list-none">
          {STEPS.map((id, i) => {
            const current = i === at;
            const done = i < upto && !current;
            // Briefing and Live can be looked at any time; Wrap-up once there is something to wrap up
            const open = id !== "wrapup" || wrapReady;
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
          <>
            <span className="text-tertiary">·</span>
            <span className="inline-flex items-center gap-1.5 h-6 pl-1 pr-2 rounded-md border border-separator-strong text-xs text-label">
              <span
                className={`grid place-items-center size-4 rounded-sm text-[9px] font-bold ${TILE[project.tint as keyof typeof TILE]}`}
              >
                {project.label.slice(0, 1).toUpperCase()}
              </span>
              {project.label}
            </span>
          </>
        ) : null}
        {meeting.people.map(person => (
          <span key={person.email} className={CHIP} title={person.email}>
            <span className={AVATAR}>{initials(person.name || person.email)}</span>
            {person.name || person.email}
          </span>
        ))}
        <span className={CHIP}>
          <span className={AVATAR}>{t("rec.me").slice(0, 1)}</span>
          {t("rec.me")}
        </span>
        <Menu
          label={t("meet.languageIs", { language: language ? (names.of(language) ?? language) : t("meet.auto") })}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-separator-strong text-xs font-semibold text-label cursor-pointer hover:bg-fill"
          trigger={
            <>
              {language ? language.toUpperCase() : t("meet.auto")}
              <Icon name="down" className="glyph size-2.5 text-secondary" />
            </>
          }
        >
          {close =>
            ["", ...codes].map(code => (
              <button
                key={code}
                className="flex items-center gap-2 w-full h-7 px-2.5 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill"
                onClick={() => pick(code, close)}
              >
                <span className="w-6 text-xs font-semibold">{code ? code.toUpperCase() : t("meet.auto")}</span>
                <span className="flex-1 text-secondary">{code ? (names.of(code) ?? code) : ""}</span>
                {code === language ? <Icon name="check" className="glyph size-3" /> : null}
              </button>
            ))
          }
        </Menu>
        <span className="flex-1" />
        {showJoin && joinable(meeting.join) ? (
          <button
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg border border-separator-strong text-[13px] font-medium text-label cursor-pointer hover:bg-fill"
            onClick={() => joinMeeting(meeting.join)}
          >
            <Icon name="video" className="glyph size-3.5" />
            {reached === "live" ? t("meet.backTo", { service: serviceOf(meeting.join) }) : t("wait.meetingJoin")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
