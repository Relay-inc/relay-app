import type { Reminder } from "../../../domain/reminders/types";
import { raw } from "../../../shared/i18n";
import { esc } from "../../../shared/html";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { useT } from "../../hooks/useT";
import { ReminderCalendar } from "./ReminderCalendar";

/** red when overdue, orange today and in the next 2 days, grey after that (decided 29/9) */
const DUE = { late: "due-late", soon: "due-soon", "": "" };
// some translations get markup around their numbers, so those go in raw; the values are escaped first
const monoNumber = (value: string | number) => raw(`<span class="font-mono tabular-nums">${esc(value)}</span>`);

// the buttons override the generic .btn: 26px high, icons 15px in the secondary colour (accent on hover)
const BUTTON = "btn h-6! px-2! text-sm whitespace-nowrap disabled:opacity-50";
const ICON_BUTTON = `${BUTTON} group relative grid place-items-center w-6! px-0! after:content-[attr(data-tip)] after:absolute after:bottom-full after:mb-1.5 after:left-1/2 after:-translate-x-1/2 after:z-10 after:px-2 after:py-1 after:rounded-sm after:bg-black/90 after:text-white after:text-xs after:whitespace-nowrap after:pointer-events-none after:opacity-0 after:transition-opacity after:duration-100 after:ease-out hover:after:opacity-100 hover:after:delay-300`;
const GLYPH = "glyph w-4! h-4! stroke-secondary! group-hover:stroke-accent!";
const TITLE =
  "text-base leading-normal line-clamp-2 [&_code]:font-mono [&_code]:text-sm [&_code]:bg-fill [&_code]:px-1 [&_code]:py-px [&_code]:rounded-sm [&_a]:text-accent [&_a]:underline [&_.vlink]:text-accent [&_.vlink]:no-underline [&_.vlink:hover]:underline";

/** One reminder: title, project, due date, repeat and the actions. `urgency` is the domain's "late" | "soon" | "". */
export function ReminderRow({
  reminder,
  label,
  urgency,
  busy,
  cal,
  onChat,
  onDone,
  onPush,
  onCalendar,
  onCloseCalendar,
}: {
  reminder: Reminder;
  label: string; // the project as it is shown
  urgency: "late" | "soon" | "";
  busy: boolean; // an action of this row is running
  cal: boolean; // its date picker is open
  onChat: () => void;
  onDone: () => void;
  onPush: (date: string) => void;
  onCalendar: () => void;
  onCloseCalendar: () => void;
}) {
  const { t, th, locale } = useT();

  const due = () => {
    if (reminder.days < 0)
      return <Html className={DUE[urgency]} html={th("due.overdue", { n: monoNumber(-reminder.days) })} />;
    if (reminder.days === 0) return <span className={DUE[urgency]}>{t("due.today")}</span>;
    const [year, month, day] = reminder.date.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const format = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
    return (
      <span className={DUE[urgency]}>
        {format({ weekday: "short" })}{" "}
        <span className="font-mono tabular-nums">{format({ day: "numeric", month: "numeric" })}</span>
      </span>
    );
  };

  // an icon button with a tooltip
  const iconButton = (icon: string, tip: string, onClick: () => void, calendarToggle = false) => (
    <button
      className={ICON_BUTTON}
      data-rem-cal={calendarToggle ? "" : undefined}
      disabled={busy}
      onClick={onClick}
      data-tip={tip}
      aria-label={tip}
    >
      <Icon name={icon} className={GLYPH} />
    </button>
  );
  const pushButton = (date: string, text: string) => (
    <button className={BUTTON} disabled={busy} onClick={() => onPush(date)}>
      {text}
    </button>
  );

  return (
    <div className="list-row">
      <div className="min-w-0">
        <Markdown text={reminder.title} className={`${TITLE} ${reminder.days < 0 ? "font-semibold" : ""}`} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5">
          {reminder.project && <span>{label}</span>}
          {due()}
          {reminder.repeat && <Html html={th("rem.every", { n: monoNumber(reminder.repeat) })} />}
        </div>
      </div>
      <div className="relative flex items-center gap-1.5">
        {iconButton("chat", t("rem.chat"), onChat)}
        {iconButton("check", t("rem.done"), onDone)}
        {pushButton("morgen", t("rem.tomorrow"))}
        {pushButton("+1w", t("rem.plusWeek"))}
        {iconButton("cal", t("rem.pick"), onCalendar, true)}
        {cal && <ReminderCalendar onPick={onPush} onClose={onCloseCalendar} />}
      </div>
    </div>
  );
}
