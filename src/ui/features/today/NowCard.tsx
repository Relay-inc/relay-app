import { useEffect } from "react";
import type { MeetingStage } from "../../../domain/calendar/rules";
import { briefingIn, joinable } from "../../../domain/calendar/rules";
import { parseBriefing } from "../../../domain/calendar/briefing";
import { serviceOf } from "../../../domain/calendar/meeting-view";
import type { Meeting } from "../../../domain/calendar/types";
import { glyphOf, nowCard } from "../../../domain/today/day";
import { joinMeeting, meetingChat, meetingProjectOf, timeOf } from "../../../application/calendar/calendar";
import { loadMeetingNote, openMeetingView, toggleBriefingTask } from "../../../application/calendar/meeting-view";
import { startRecording, stopRecording, useRecordingStore } from "../../../application/calendar/recording";
import { useCalendarStore } from "../../../application/calendar/store";
import { projectChip } from "../../../application/today/today";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { initials } from "./parts";
import { StageGlyph } from "./StageGlyph";

const iso = (ms: number) => new Date(ms).toISOString();
const BTN = "inline-flex items-center gap-1.5 h-7.5 px-3 rounded-lg text-[13px] font-medium cursor-pointer";
const PRIMARY = `${BTN} bg-accent text-on-accent hover:bg-accent-hover`;
const OUTLINE = `${BTN} border border-separator-strong text-label hover:bg-fill disabled:opacity-50 disabled:cursor-default`;
const CAPS = "text-[11px] font-semibold tracking-[0.06em] uppercase text-secondary";
const PROFILE = [0.3, 0.5, 0.8, 1, 0.65, 0.35, 0.8, 0.5, 0.3];

const People = ({ meeting }: { meeting: Meeting }) => (
  <div className="flex flex-wrap gap-1.5">
    {meeting.people.slice(0, 4).map(person => (
      <span
        key={person.email}
        title={person.email}
        className="inline-flex items-center gap-1.5 h-6 pl-0.75 pr-2.25 rounded-full bg-fill-2 text-xs"
      >
        <span className="grid place-items-center size-4.5 rounded-full bg-fill-2 text-secondary text-[9px] font-bold">
          {initials(person.name || person.email)}
        </span>
        {person.name || person.email}
      </span>
    ))}
    {meeting.people.length > 4 ? (
      <span className="inline-flex items-center h-6 px-2 text-xs text-secondary">+{meeting.people.length - 4}</span>
    ) : null}
  </div>
);

/** The briefing of the next meeting, compact: its goal, what is left from last time and my points, ticks written back
 *  into the note; a meeting without one offers Prep with Claude instead. */
function Briefing({ meeting }: { meeting: Meeting }) {
  const { t, locale } = useT();
  const text = useCalendarStore(s => (s.note?.id === meeting.id ? s.note.text : null));
  useEffect(() => void loadMeetingNote(meeting, true), [meeting]);
  const briefing = text ? briefingIn(text) : null;
  const shaped = briefing ? parseBriefing(briefing) : null;
  const claude = (
    <div className="flex flex-col items-start gap-2 text-[13px] text-secondary">
      <span className="max-w-120">
        {t("meet.brief.hintAlone", { about: meetingProjectOf(meeting) ?? meeting.title })}
      </span>
      <button className={PRIMARY} onClick={() => void meetingChat(meeting.id, "prep", meeting)}>
        {t("meet.prep")}
      </button>
    </div>
  );
  if (!briefing) return claude;
  if (!shaped)
    return (
      <p className="m-0 text-sm leading-snug line-clamp-4 whitespace-pre-line">{briefing.replace(/[#*`]/g, "")}</p>
    );
  const day = (d: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00`));
  const list = (steps: typeof shaped.points) => (
    <div className="mt-1.5 flex flex-col gap-1.25">
      {steps.map(step => (
        <label key={step.n} className={`flex items-start gap-2 ${step.done ? "text-secondary" : ""}`}>
          <input
            type="checkbox"
            checked={step.done}
            className="size-3.5 mt-px accent-accent"
            onChange={() => void toggleBriefingTask(meeting, step.n)}
          />
          <span>
            <span className={step.done ? "line-through" : ""}>{step.text}</span>
            {step.doneOn ? ` · ${t("meet.brief.done", { date: day(step.doneOn) })}` : ""}
          </span>
        </label>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-2.5">
      {shaped.goal ? (
        <div>
          <span className={CAPS}>{t("meet.brief.goal")}</span>
          <div className="mt-0.75 text-sm">{shaped.goal}</div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-6">
        {shaped.since.steps.length ? (
          <div>
            <span className={CAPS}>{t("meet.brief.since")}</span>
            {list(shaped.since.steps)}
          </div>
        ) : null}
        <div>
          <span className={CAPS}>{t("meet.brief.points")}</span>
          {shaped.points.length ? list(shaped.points) : <div className="mt-1.5 text-secondary">—</div>}
        </div>
      </div>
    </div>
  );
}

/** Above the queue, from the clock (design T1, T2, T3): a line about the next meeting; within 30 minutes (or while it
 *  runs) the meeting with Join, Record, Open meeting and its briefing; while one is recorded, the recording. */
export function NowCard({
  meetings,
  stages,
  now,
}: {
  meetings: Meeting[];
  stages: Record<string, MeetingStage>;
  now: number;
}) {
  const { t } = useT();
  const { secs, me, others, phase } = useRecordingStore();
  const card = nowCard(meetings, stages, now);
  if (card.kind === "none") return null;
  const { meeting } = card;
  const start = Date.parse(meeting.start);
  const end = Date.parse(meeting.end);
  const project = projectChip(meetingProjectOf(meeting));
  const when = `${timeOf(iso(start))} – ${timeOf(iso(end))}`;
  const open = () => void openMeetingView(meeting);

  if (card.kind === "live") {
    const loud = Math.min(1, Math.sqrt(Math.max(me, others)));
    return (
      <div className="mt-3.5 flex-none flex items-center gap-3 h-14 pl-4 pr-2.5 rounded-xl border border-late/35 bg-raised shadow-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-late">
          <span className="size-2 rounded-full bg-late" />
          {t("today.d.live", { n: Math.floor(secs / 60) })}
        </span>
        <span className="font-semibold text-sm truncate">{meeting.title || t("wait.meetingUntitled")}</span>
        <span className="text-secondary truncate">
          {when}
          {meeting.people.length
            ? ` · ${meeting.people
                .slice(0, 3)
                .map(p => (p.name || p.email).split(" ")[0])
                .join(", ")}${meeting.people.length > 3 ? ` +${meeting.people.length - 3}` : ""}`
            : ""}
        </span>
        <span className="flex-1" />
        <span
          role="img"
          aria-label={t("today.d.recording")}
          className="flex items-center gap-0.5 h-5 px-2 rounded-md bg-fill"
        >
          {PROFILE.map((p, i) => (
            <span key={i} className="w-0.75 rounded-xs bg-secondary" style={{ height: `${3 + p * loud * 13}px` }} />
          ))}
          <span className="ml-1.5 text-xs text-secondary">{t("today.d.recording")}</span>
        </span>
        <button className={PRIMARY} onClick={open}>
          {t("today.d.openMeeting")}
        </button>
        <button className={OUTLINE} disabled={phase !== "recording"} onClick={() => void stopRecording()}>
          <span className="size-2 rounded-xs bg-label" />
          {t("rec.stop")}
        </button>
      </div>
    );
  }

  const glyph = glyphOf(card.stage, false, false);
  const stageName = t(`meet.stageName.${card.stage}`);
  if (card.kind === "next")
    return (
      <div className="mt-3.5 flex-none flex items-center gap-2.5 h-11.5 pl-3.5 pr-2 rounded-xl border border-separator-strong bg-raised">
        <StageGlyph glyph={glyph} className="text-ctx-a" />
        <span className="text-secondary">{t("today.d.next")}</span>
        <span className="font-semibold truncate">{meeting.title || t("wait.meetingUntitled")}</span>
        <span className="text-secondary whitespace-nowrap">
          {t("today.d.nextLine", { time: timeOf(iso(start)), n: card.minutes })}
        </span>
        <span className="inline-flex items-center h-5 px-2 rounded-[10px] bg-fill-2 text-xs">{stageName}</span>
        <span className="flex-1" />
        <button className={OUTLINE} onClick={open}>
          {card.stage === "planned" ? t("today.d.openMeeting") : t("today.d.openBriefing")}
        </button>
      </div>
    );

  const join = joinable(meeting.join);
  return (
    <div className="mt-3.5 flex-none flex gap-7 px-4.5 py-4 rounded-xl border border-separator-strong bg-raised shadow-sm">
      <div className="w-82 flex-none flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-accent-text">
          <StageGlyph glyph={glyph} />
          {card.running
            ? t("today.d.running", { n: Math.max(1, Math.floor((now - start) / 60_000)), stage: stageName })
            : t("today.d.soon", { n: card.minutes, stage: stageName })}
        </div>
        <div className="text-lg font-semibold leading-tight">{meeting.title || t("wait.meetingUntitled")}</div>
        <div className="text-secondary">
          {[when, join ? serviceOf(meeting.join) : "", project?.label].filter(Boolean).join(" · ")}
        </div>
        <People meeting={meeting} />
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {join ? (
            <button className={PRIMARY} onClick={() => joinMeeting(meeting.join)}>
              <Icon name="video" className="glyph size-3.5" />
              {t("today.d.join", { service: serviceOf(meeting.join) })}
            </button>
          ) : null}
          <button
            className={OUTLINE}
            disabled={phase !== "idle"}
            onClick={() => void startRecording(meeting.id, meeting)}
          >
            <span className="size-2 rounded-full bg-late" />
            {t("rec.record")}
          </button>
          <button className={join ? OUTLINE : PRIMARY} onClick={open}>
            {t("today.d.openMeeting")}
          </button>
        </div>
      </div>
      <div className="flex-1 min-w-0 border-l border-separator pl-6">
        <Briefing meeting={meeting} />
      </div>
    </div>
  );
}
