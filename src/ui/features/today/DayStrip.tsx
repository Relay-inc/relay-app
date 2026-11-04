import type { MeetingStage } from "../../../domain/calendar/rules";
import type { Meeting } from "../../../domain/calendar/types";
import { freeTime, glyphOf, lanes, lengthOf, pct, scale, timed } from "../../../domain/today/day";
import { meetingProjectOf, timeOf } from "../../../application/calendar/calendar";
import { openMeetingView } from "../../../application/calendar/meeting-view";
import { projectChip } from "../../../application/today/today";
import { useT } from "../../hooks/useT";
import { StageGlyph } from "./StageGlyph";

const HOUR = 3_600_000;
// literal classes, so Tailwind finds them: a meeting's block in its context's tint, and what has run of it
const BLOCK = {
  "": "bg-fill-2 border-separator-strong text-label",
  "ctx-a": "bg-ctx-a/10 border-ctx-a/30 text-ctx-a",
  "ctx-m": "bg-ctx-m/10 border-ctx-m/30 text-ctx-m",
  "ctx-p": "bg-ctx-p/10 border-ctx-p/30 text-ctx-p",
} as const;
const ELAPSED = { "": "bg-fill-2", "ctx-a": "bg-ctx-a/20", "ctx-m": "bg-ctx-m/20", "ctx-p": "bg-ctx-p/20" } as const;

/** The day on an hour scale (08:00 to 18:00, wider when a meeting falls outside): each meeting a block in its context's
 *  colour with the glyph of its stage, side by side in lanes when they overlap, the free time between them with the
 *  largest gap named, and a line for now. A click opens the meeting. */
export function DayStrip({
  meetings,
  stages,
  followed,
  now,
  focus = null,
}: {
  focus?: string | null; // the meeting the card above is about: a ring around its block
  meetings: Meeting[];
  stages: Record<string, MeetingStage>;
  followed: Record<string, boolean>;
  now: number;
}) {
  const { t } = useT();
  const blocks = meetings.map(timed);
  const hours = scale(blocks, now);
  const { lane, lanes: count } = lanes(blocks);
  const { largest } = freeTime(blocks, now);
  const at = (ms: number) => pct(ms, hours, now);
  const day = new Date(now).setHours(0, 0, 0, 0);
  const step = hours.to - hours.from > 12 ? 2 : 1;
  const marks = Array.from({ length: hours.to - hours.from + 1 }, (_, i) => hours.from + i).filter(
    (h, i, all) => (h - hours.from) % step === 0 || i === all.length - 1,
  );
  const single = count === 1;
  const laneH = single ? 44 : 26;
  const height = single ? 52 : 8 + count * (laneH + 4);
  const nowAt = at(now);
  const inside = now >= day + hours.from * HOUR && now <= day + hours.to * HOUR;
  const iso = (ms: number) => new Date(ms).toISOString();
  return (
    <section aria-label={t("today.d.day")} className="relative mt-4 flex-none pt-4.5" style={{ height: height + 18 }}>
      <div className="absolute top-0 inset-x-0 h-3.5">
        {marks.map(h => (
          <span
            key={h}
            className="absolute top-0 text-[11px] text-secondary tabular-nums"
            style={{
              left: `${at(day + h * HOUR)}%`,
              transform: `translateX(${h === hours.from ? "0" : h === hours.to ? "-100%" : "-50%"})`,
            }}
          >
            {String(h).padStart(2, "0")}:00
          </span>
        ))}
      </div>
      <div className="absolute top-4.5 inset-x-0 overflow-hidden rounded-[10px] bg-sidebar" style={{ height }}>
        {marks.map(h => (
          <span key={h} className="absolute inset-y-0 w-px bg-separator" style={{ left: `${at(day + h * HOUR)}%` }} />
        ))}
        {inside ? <span className="absolute inset-y-0 left-0 bg-fill" style={{ width: `${nowAt}%` }} /> : null}
        {largest && at(largest.end) - at(largest.start) >= 9 ? (
          <span
            className="absolute inset-y-0 flex items-center justify-center text-xs text-secondary"
            style={{ left: `${at(largest.start)}%`, width: `${at(largest.end) - at(largest.start)}%` }}
          >
            {t("today.d.freeGap", { time: lengthOf(Math.round((largest.end - largest.start) / 60_000)) })}
          </span>
        ) : null}
      </div>
      {meetings.map(meeting => {
        const [start, end] = [Date.parse(meeting.start), Date.parse(meeting.end)];
        const stage = stages[meeting.id] ?? "planned";
        const glyph = glyphOf(stage, !!followed[meeting.id], end <= now);
        const tint = (projectChip(meetingProjectOf(meeting))?.tint ?? "") as keyof typeof BLOCK;
        const left = at(start);
        const width = Math.max(1.5, at(end) - left);
        const people = meeting.people.map(person => person.name || person.email).join(", ");
        const elapsed = stage === "live" && end > start ? Math.min(100, ((now - start) / (end - start)) * 100) : 0;
        return (
          <div
            key={meeting.id}
            className="absolute px-0.5"
            style={{ top: 22 + lane[meeting.id] * (laneH + 4), height: laneH, left: `${left}%`, width: `${width}%` }}
          >
            <button
              title={[meeting.title, `${timeOf(iso(start))}–${timeOf(iso(end))}`, people].filter(Boolean).join(" · ")}
              onClick={() => void openMeetingView(meeting)}
              className={`relative flex h-full w-full overflow-hidden rounded-lg border px-2 text-left cursor-pointer ${single ? "flex-col justify-center gap-px" : "items-center gap-1.5"} ${BLOCK[tint]} ${glyph.dashed ? "border-dashed bg-bg" : ""} ${stage === "live" ? "ring-[1.5px] ring-late" : meeting.id === focus ? "ring-2 ring-accent" : ""} ${end <= now && stage !== "live" && !glyph.dashed ? "opacity-75" : ""}`}
            >
              {elapsed ? (
                <span className={`absolute inset-y-0 left-0 ${ELAPSED[tint]}`} style={{ width: `${elapsed}%` }} />
              ) : null}
              <span className="relative flex items-center gap-1.25 text-[11px] tabular-nums whitespace-nowrap">
                <StageGlyph glyph={glyph} />
                {single ? timeOf(iso(start)) : null}
              </span>
              <span className="relative min-w-0 truncate text-xs font-semibold">
                {meeting.title || t("wait.meetingUntitled")}
              </span>
            </button>
          </div>
        );
      })}
      {inside ? (
        <div
          aria-label={t("today.d.now", { time: timeOf(iso(now)) })}
          className="absolute top-3 bottom-0 w-0.5 -ml-px bg-accent"
          style={{ left: `${nowAt}%` }}
        >
          <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-4 px-1.25 rounded-lg bg-accent text-on-accent text-[10.5px] font-semibold leading-4 tabular-nums">
            {timeOf(iso(now))}
          </span>
        </div>
      ) : null}
    </section>
  );
}
