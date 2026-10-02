import { useLayoutEffect, useRef, useState } from "react";
import { isoDate } from "../../../domain/reminders/rules";
import { Icon } from "../../components/Icon";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../hooks/useT";

const GLYPH = "w-4 h-4 fill-none stroke-secondary glyph";
const MONTH_BUTTON =
  "grid place-items-center rounded-md cursor-default w-6 h-6 enabled:hover:bg-fill disabled:*:opacity-35 focus-visible:outline-2 focus-visible:outline-accent/45";
const DAY_BUTTON =
  "grid place-items-center rounded-md cursor-default h-8 text-sm font-mono tabular-nums focus-visible:outline-2 focus-visible:outline-accent/45 disabled:text-secondary disabled:opacity-45 enabled:hover:bg-accent enabled:hover:text-on-accent";
const TODAY_DAY = "text-accent font-semibold ring-1 ring-inset ring-accent";

function scrollingAncestor(start: HTMLElement): HTMLElement | null {
  for (let node = start.parentElement; node; node = node.parentElement)
    if (getComputedStyle(node).overflowY === "auto") return node;
  return null;
}

/** A month grid under its button, past days off, Monday first. Opens upwards near the bottom of the view; a click
 *  outside or Escape closes it (the toggle button, marked data-rem-cal, handles itself). */
export function ReminderCalendar({ onPick, onClose }: { onPick: (date: string) => void; onClose: () => void }) {
  const { t, locale } = useT();
  const [shown, setShown] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() }));
  const popup = useRef<HTMLDivElement>(null);

  // the toggle button (data-rem-cal) handles itself
  useDismiss(popup, true, onClose, { on: "pointerdown", inside: target => !!target.closest("[data-rem-cal]") });

  // near the bottom of the view the picker opens upwards (a five or six week month changes its height)
  useLayoutEffect(() => {
    const element = popup.current;
    if (!element) return;
    const viewBottom = scrollingAncestor(element)?.getBoundingClientRect().bottom ?? innerHeight;
    element.removeAttribute("data-up");
    if (element.getBoundingClientRect().bottom > viewBottom) element.setAttribute("data-up", "");
  });

  const { year, month } = shown;
  const goToMonth = (step: number) => {
    const date = new Date(year, month + step);
    setShown({ year: date.getFullYear(), month: date.getMonth() });
  };
  const format = (options: Intl.DateTimeFormatOptions, date: Date) =>
    new Intl.DateTimeFormat(locale, options).format(date);
  const now = new Date();
  const today = isoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const blanks = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
  const dayCount = new Date(year, month + 1, 0).getDate();

  return (
    <div
      ref={popup}
      data-pop
      className="absolute z-10 right-0 top-full mt-1.5 data-[up]:top-auto data-[up]:bottom-full mb-1.5 w-60 p-2.5 bg-bg border border-separator rounded-xl shadow-xl"
      role="dialog"
      aria-label={t("rem.pick")}
    >
      <div className="flex items-center gap-0.5 mb-2 ml-1">
        <span className="flex-1 text-sm font-semibold capitalize">
          {format({ month: "long", year: "numeric" }, new Date(year, month, 1))}
        </span>
        <button
          className={MONTH_BUTTON}
          disabled={isCurrentMonth}
          onClick={() => goToMonth(-1)}
          aria-label={t("cal.prev")}
        >
          <Icon name="left" className={GLYPH} />
        </button>
        <button className={MONTH_BUTTON} onClick={() => goToMonth(1)} aria-label={t("cal.next")}>
          <Icon name="right" className={GLYPH} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {/* 2024-01-01 was a Monday */}
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="text-xs font-semibold text-secondary uppercase pb-1">
            {format({ weekday: "narrow" }, new Date(2024, 0, 1 + i))}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`blank${i}`}></span>
        ))}
        {Array.from({ length: dayCount }, (_, i) => {
          const date = isoDate(year, month, i + 1);
          return (
            <button
              key={date}
              disabled={date < today}
              className={`${DAY_BUTTON} ${date === today ? TODAY_DAY : "text-label"}`}
              onClick={() => onPick(date)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
