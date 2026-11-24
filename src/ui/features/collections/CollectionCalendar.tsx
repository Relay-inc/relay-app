import { useState } from "react";
import { byDay, localDate, monthWeeks, shift, weekOf } from "../../../domain/collections/calendar";
import { stageOf, type Row } from "../../../domain/collections/rules";
import { openPage } from "../../../application/navigation/pages";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { StageGlyph } from "../today/StageGlyph";

type Mode = "month" | "week";
const STEP =
  "grid place-items-center size-6 rounded-md cursor-pointer hover:bg-fill focus-visible:outline-2 focus-visible:outline-accent/45";
const GLYPH = "size-4 fill-none stroke-secondary glyph";
// a meeting's name starts with its date, which its day says already
const name = (row: Row) => row.t.replace(/^\d{4}-\d{2}-\d{2}\s+/, "") || row.t;

/** The calendar (issue 423): the view's rows on the day of their `date:`, a month Monday first or a week Monday to
 *  Sunday, the rows without a date under it. A click opens the note. The month shown is not part of the view. */
export function CollectionCalendar({ rows, today }: { rows: Row[]; today: string }) {
  const { t, locale } = useT();
  const [mode, setMode] = useState<Mode>("month");
  const [shown, setShown] = useState(today);
  const { days, undated } = byDay(rows);
  const date = localDate(shown);
  const format = (options: Intl.DateTimeFormatOptions, iso: string) =>
    new Intl.DateTimeFormat(locale, options).format(localDate(iso));
  const week = weekOf(shown);
  const title =
    mode === "month"
      ? format({ month: "long", year: "numeric" }, shown)
      : `${format({ day: "numeric", month: "short" }, week[0])} – ${format({ day: "numeric", month: "short", year: "numeric" }, week[6])}`;
  return (
    <div className="flex-1 min-h-0 overflow-auto pt-3.5 pb-4">
      <div className="flex items-center gap-2 mb-3">
        <div role="tablist" aria-label={t("coll.calendar")} className="flex p-0.5 rounded-lg bg-fill-2 text-xs">
          {(["month", "week"] as const).map(m => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`h-5 px-2.5 rounded-md font-medium cursor-pointer ${mode === m ? "bg-raised shadow-sm" : "text-secondary"}`}
              onClick={() => setMode(m)}
            >
              {t(`coll.${m}`)}
            </button>
          ))}
        </div>
        <h2 className="flex-1 ml-1 text-base font-semibold capitalize">{title}</h2>
        <button className="btn h-6 px-2.5 text-xs cursor-pointer" onClick={() => setShown(today)}>
          {t("coll.today")}
        </button>
        <button
          className={STEP}
          aria-label={t(mode === "month" ? "cal.prev" : "coll.prevWeek")}
          onClick={() => setShown(shift(shown, mode, -1))}
        >
          <Icon name="left" className={GLYPH} />
        </button>
        <button
          className={STEP}
          aria-label={t(mode === "month" ? "cal.next" : "coll.nextWeek")}
          onClick={() => setShown(shift(shown, mode, 1))}
        >
          <Icon name="right" className={GLYPH} />
        </button>
      </div>
      {mode === "month" ? (
        <div className="rounded-xl border border-separator overflow-hidden">
          <div className="grid grid-cols-7 bg-well text-xs font-medium text-secondary">
            {week.map(day => (
              <div key={day} className="px-2 py-1.5">
                {format({ weekday: "short" }, day)}
              </div>
            ))}
          </div>
          {monthWeeks(date.getFullYear(), date.getMonth()).map(days7 => (
            <div key={days7[0]} className="grid grid-cols-7 border-t border-separator">
              {days7.map(day => {
                const other = day.slice(0, 7) !== shown.slice(0, 7);
                return (
                  <div
                    key={day}
                    data-day={day}
                    className={`min-w-0 min-h-24 p-1 flex flex-col gap-0.5 border-l border-separator first:border-l-0 ${other ? "bg-well" : ""}`}
                  >
                    <DayNumber day={day} today={today} faint={other} />
                    {(days.get(day) ?? []).map(row => (
                      <Entry key={row.p} row={row} today={today} />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {week.map(day => (
            <section key={day} data-day={day} className="min-w-0 rounded-xl bg-well p-2 flex flex-col gap-2 min-h-48">
              <div className="flex items-center gap-1.5 px-1 text-xs">
                <span className="font-medium text-secondary capitalize">{format({ weekday: "short" }, day)}</span>
                <DayNumber day={day} today={today} />
              </div>
              {(days.get(day) ?? []).map(row => (
                <Entry key={row.p} row={row} today={today} card />
              ))}
            </section>
          ))}
        </div>
      )}
      {undated.length ? (
        <section className="mt-4">
          <h3 className="mb-2 text-xs font-semibold text-secondary">{t("coll.noDate", { n: undated.length })}</h3>
          <div className="grid grid-cols-4 gap-2">
            {undated.map(row => (
              <Entry key={row.p} row={row} today={today} card full />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DayNumber({ day, today, faint = false }: { day: string; today: string; faint?: boolean }) {
  return (
    <span
      className={`grid place-items-center size-6 rounded-full text-xs tabular-nums ${day === today ? "bg-accent text-on-accent font-semibold" : faint ? "text-tertiary" : ""}`}
    >
      {Number(day.slice(8))}
    </span>
  );
}

/** A note on its day: the stage of a meeting (dashed when it is over and not wrapped) and its name; opens it. */
function Entry({
  row,
  today,
  card = false,
  full = false,
}: {
  row: Row;
  today: string;
  card?: boolean;
  full?: boolean;
}) {
  const stage = stageOf(row, today);
  const unwrapped = stage === "unwrapped";
  return (
    <button
      data-card={row.p}
      title={row.t}
      className={`w-full min-w-0 flex items-center gap-1.5 text-left text-xs cursor-pointer ${card ? "px-2.5 py-2 rounded-lg bg-raised border border-separator-strong shadow-card hover:border-accent" : "h-6 px-1.5 rounded-md hover:bg-fill"}`}
      onClick={() => openPage(row.p)}
    >
      {stage ? (
        <StageGlyph
          className={unwrapped ? "text-soon" : stage === "wrapped" ? "" : "text-secondary"}
          glyph={{ stage: (unwrapped ? row.stage : stage) as "planned", followed: false, dashed: unwrapped }}
        />
      ) : null}
      <span className={card ? "min-w-0 font-medium leading-snug break-words" : "truncate"}>
        {full ? row.t : name(row)}
      </span>
    </button>
  );
}
