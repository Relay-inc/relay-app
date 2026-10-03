import type { Reminder } from "../../../domain/reminders/types";
import type { Section } from "../../../domain/navigation/sidebar";
import { raw } from "../../../shared/i18n";
import { esc } from "../../../shared/html";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { useT } from "../../hooks/useT";
import { ReminderCalendar } from "./ReminderCalendar";
import { tintText } from "../../../shared/tints";

/** red when overdue, orange today and in the next 2 days, grey after that (decided 29/9) */
const DUE = { late: "due-late", soon: "due-soon", "": "" };
// some translations get markup around their numbers, so those go in raw; the values are escaped first
const tabNumber = (value: string | number) => raw(`<span class="tabular-nums">${esc(value)}</span>`);
const monoNumber = (value: string | number) => raw(`<span class="font-mono tabular-nums">${esc(value)}</span>`);

// small outline buttons 26px high, icon buttons 28px with a grey glyph
const BUTTON =
  "btn h-6.5! px-2.25! rounded-[7px]! text-xs! font-medium whitespace-nowrap cursor-pointer disabled:opacity-50";
const ICON_BUTTON = `btn-icon group relative cursor-pointer disabled:opacity-50 after:content-[attr(data-tip)] after:absolute after:bottom-full after:mb-1.5 after:left-1/2 after:-translate-x-1/2 after:z-10 after:px-2 after:py-1 after:rounded-sm after:bg-black/90 after:text-white after:text-xs after:whitespace-nowrap after:pointer-events-none after:opacity-0 after:transition-opacity after:duration-100 after:ease-out hover:after:opacity-100 hover:after:delay-300`;
const GLYPH = "glyph size-3.75 stroke-current!";
const TITLE =
  "text-[14px] leading-[1.4] line-clamp-2 [&_code]:font-mono [&_code]:text-sm [&_code]:bg-fill [&_code]:px-1 [&_code]:py-px [&_code]:rounded-sm [&_a]:text-accent [&_a]:underline [&_.vlink]:text-accent [&_.vlink]:no-underline [&_.vlink:hover]:underline";

/** One reminder: title, project, due date, repeat and the actions. `urgency` is the domain's "late" | "soon" | "". */
export function ReminderRow({
  reminder,
  label,
  tint,
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
  tint: Section["tint"]; // its context's colour
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
      return <Html className={DUE[urgency]} html={th("due.overdue", { n: tabNumber(-reminder.days) })} />;
    if (reminder.days === 0) return <span className={DUE[urgency]}>{t("rem.today")}</span>;
    if (reminder.days === 1) return <span className={DUE[urgency]}>{t("rem.tomorrow")}</span>;
    const [year, month, day] = reminder.date.split("-").map(Number);
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, day)),
    );
    // day/month without zero padding, whatever the locale pads or orders
    return (
      <span className={`${DUE[urgency]} tabular-nums`}>
        {weekday} {day}/{month}
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

  // the round button in front of the title: hover shows the tick
  const ring = urgency === "late" ? "border-late" : "border-separator-strong";
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-separator">
      <button
        className={`group size-5 flex-none grid place-items-center rounded-full border-[1.5px] ${ring} bg-transparent p-0 text-transparent cursor-pointer hover:bg-add-bg hover:border-ok hover:text-ok disabled:opacity-50`}
        disabled={busy}
        onClick={onDone}
        title={t("rem.done")}
        aria-label={t("rem.done")}
      >
        <Icon name="check" className="glyph size-3 stroke-current! stroke-[2.5]" />
      </button>
      <div className="min-w-0 flex-1">
        <Markdown text={reminder.title} className={`${TITLE} ${reminder.days < 0 ? "font-semibold" : ""}`} />
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-secondary mt-0.5">
          {reminder.project && (
            <span className="inline-flex items-center gap-1">
              <Icon name="folder" className={`glyph size-3 ${tintText(tint)}`} />
              {label}
            </span>
          )}
          {due()}
          {reminder.repeat && (
            <span className="inline-flex items-center gap-1">
              <Icon name="refresh" className="glyph size-2.75" />
              <Html html={th("rem.every", { n: monoNumber(reminder.repeat) })} />
            </span>
          )}
        </div>
      </div>
      <div className="relative flex items-center gap-1">
        {iconButton("chat", t("rem.chat"), onChat)}
        {pushButton("morgen", t("rem.tomorrow"))}
        {pushButton("+1w", t("rem.plusWeek"))}
        {iconButton("cal", t("rem.pick"), onCalendar, true)}
        {cal && <ReminderCalendar onPick={onPush} onClose={onCloseCalendar} />}
      </div>
    </div>
  );
}
