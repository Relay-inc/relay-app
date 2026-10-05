import type { TodayModel } from "../../../application/today/today";
import { selectEntry } from "../../../application/today/today";
import { timeOf } from "../../../application/calendar/calendar";
import { useT } from "../../hooks/useT";

const H = 3_600_000;

/** The day as one track: the hours, today's meetings, the time already gone, now, and per free slot a marker with how
 *  much is planned in it (a click opens its first item). From 8:00 to 18:00, wider when a meeting or now is outside. */
export function TodayTimeline({ model }: { model: TodayModel }) {
  const { t } = useT();
  const { now, meetings, slots, used, queue, placed, selected } = model;
  const day = new Date(now).setHours(0, 0, 0, 0);
  const starts = meetings.map(meeting => Date.parse(meeting.start));
  const ends = meetings.map(meeting => Date.parse(meeting.end));
  const from = Math.min(8, ...starts.map(at => Math.floor((at - day) / H)), Math.floor((now - day) / H));
  const to = Math.max(18, ...ends.map(at => Math.ceil((at - day) / H)), Math.ceil((now - day) / H));
  const a0 = day + from * H;
  const span = (to - from) * H;
  const x = (at: number) => `${(((Math.min(Math.max(at, a0), a0 + span) - a0) / span) * 100).toFixed(2)}%`;
  const w = (a: number, b: number) => `${(((Math.min(b, a0 + span) - Math.max(a, a0)) / span) * 100).toFixed(2)}%`;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <div className="flex-none px-5 pt-2.5 pb-2 border-b border-separator bg-sidebar">
      <div className="relative h-13">
        {hours.map(hour => (
          <div key={hour} className="absolute inset-y-0 flex flex-col" style={{ left: x(day + hour * H) }}>
            <span className="w-px flex-1 bg-separator" />
            <span className="text-[10px] text-tertiary -translate-x-1/2 tabular-nums">
              {String(hour).padStart(2, "0")}:00
            </span>
          </div>
        ))}
        <div className="absolute left-0 top-0 h-9 bg-fill rounded-[5px]" style={{ width: x(now) }} />
        {meetings.map(meeting => {
          const start = Date.parse(meeting.start);
          const end = Date.parse(meeting.end);
          return (
            <div
              key={meeting.id}
              title={`${timeOf(meeting.start)}–${timeOf(meeting.end)} ${meeting.title}`}
              className={`absolute top-1 h-7 box-border px-1.5 rounded-md text-[10px] leading-7 font-semibold truncate shadow-[inset_0_-2px_0_var(--color-tertiary)] ${end <= now ? "opacity-50 bg-fill-2" : meeting.join ? "bg-accent-soft" : "bg-fill-2"}`}
              style={{ left: x(start), width: w(start, end) }}
            >
              {meeting.title || t("wait.meetingUntitled")}
            </div>
          );
        })}
        {slots.map(slot => {
          const items = queue.filter(entry => placed[entry.id]?.slot === slot.key);
          if (!items.length) return null;
          const late = items.some(entry => entry.tone === "late");
          const on = !!selected && items.includes(selected);
          return (
            <button
              key={slot.key}
              title={items.map(entry => entry.title).join(", ")}
              onClick={() => selectEntry(items[0].id)}
              className={`absolute top-1 h-7 box-border rounded-md border-[1.5px] border-dashed bg-raised grid place-items-center text-[10px] font-semibold overflow-hidden cursor-pointer ${late ? "border-late text-late" : "border-soon text-soon"} ${on ? "ring-2 ring-accent" : ""}`}
              style={{
                left: x(slot.start),
                width: `calc(${w(slot.start, slot.start + Math.max(used[slot.key], 8 * 60_000))} - 2px)`,
              }}
            >
              {items.length}
            </button>
          );
        })}
        <div className="absolute -top-0.5 h-10 w-0.5 bg-late" style={{ left: x(now) }} />
        <span
          className="absolute -top-1.5 -translate-x-1/2 h-3.5 px-1 rounded bg-late text-white text-[9px] leading-3.5 font-semibold tabular-nums"
          style={{ left: x(now) }}
        >
          {timeOf(new Date(now).toISOString())}
        </span>
      </div>
    </div>
  );
}
