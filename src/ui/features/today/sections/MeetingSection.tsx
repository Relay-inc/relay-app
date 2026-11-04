import { timeOf } from "../../../../application/calendar/calendar";
import { openMeetingView } from "../../../../application/calendar/meeting-view";
import { useT } from "../../../hooks/useT";
import { Caps, initials } from "../parts";
import type { SectionDef, SectionProps } from "./types";

// the invite's text as agenda lines: what is left after links and dial-in noise, at most ten lines
const agendaOf = (text = "") =>
  text
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n|\\n/)
    .map(line => line.replace(/^[\s\-*•–]+/, "").trim())
    .filter(
      line => line && !/https?:\/\/|meet\.google|zoom\.us|teams\.microsoft|^-{3,}|join|dial|pin:|^\W+$/i.test(line),
    )
    .slice(0, 10);

/** A meeting under Today: who is in it and the agenda from the invite, with the way into its Meeting view, where the
 *  briefing, the notes and the transcript are. The invite is the sender's text: shown, never followed. */
export function MeetingSection({ entry }: SectionProps<"meeting">) {
  const { t } = useT();
  const { meeting } = entry.subject;
  const agenda = agendaOf(meeting.description);
  return (
    <div className="flex flex-col gap-4 max-w-170">
      <div className="text-[13px] text-secondary">
        {timeOf(meeting.start)}–{timeOf(meeting.end)}
        {meeting.location ? ` · ${meeting.location}` : ""}
        {meeting.organizer ? ` · ${t("today.organizer", { name: meeting.organizer })}` : ""}
      </div>
      {meeting.people.length ? (
        <div className="flex flex-wrap gap-1.5">
          {meeting.people.map(person => (
            <span
              key={person.email}
              className="inline-flex items-center gap-1.5 h-6.5 pl-0.75 pr-2.25 rounded-full bg-raised shadow-[0_0_0_.5px_var(--color-separator-strong)] text-xs"
              title={person.email}
            >
              <span className="grid place-items-center size-5 rounded-full bg-fill-2 text-secondary text-[9px] font-semibold">
                {initials(person.name || person.email)}
              </span>
              {person.name || person.email}
            </span>
          ))}
        </div>
      ) : null}
      {agenda.length ? (
        <section className="flex flex-col gap-1.5">
          <Caps>{t("today.agenda")}</Caps>
          {agenda.map((line, i) => (
            <div key={i} className="flex gap-2 text-sm select-text">
              <span className="text-tertiary">–</span>
              {line}
            </div>
          ))}
        </section>
      ) : null}
      <div>
        <button className="btn btn-primary cursor-pointer" onClick={() => openMeetingView(meeting)}>
          {t("meet.open")}
        </button>
      </div>
    </div>
  );
}
export const meetingFacts: SectionDef<"meeting">["facts"] = (entry, _day, t) => [
  [t("today.fact.organizer"), entry.subject.meeting.organizer],
  [t("today.fact.people"), String(entry.subject.meeting.people.length || "")],
];
