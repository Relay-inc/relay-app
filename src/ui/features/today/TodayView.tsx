import { useEffect, useRef, useState } from "react";
import type { Board } from "../../../domain/board/rules";
import { newBoard } from "../../../domain/board/rules";
import { useTodayStore } from "../../../application/today/store";
import { setPop, useDetailsStore } from "../../../application/today/details";
import { closeCompose } from "../../../application/today/mail";
import { ContextFilter } from "./ContextFilter";
import { useNavigationStore } from "../../../application/navigation/store";
import { isKey } from "../../../application/settings/settings";
import type { CommandId } from "../../../domain/settings/shortcuts";
import { cardOf } from "../../../application/navigation/panel";
import { loadTodayCards, noteSeen, putOff, selectEntry, todayModel } from "../../../application/today/today";
import { actionsOf, openTodayCard, setStatus } from "../../../application/today/actions";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { BoardTicket } from "../board/BoardTicket";
import { Toast } from "../conversations/Toast";
import { TodayQueue } from "./TodayQueue";
import { TodayDetail } from "./TodayDetail";
import { DayStrip } from "./DayStrip";
import { NowCard } from "./NowCard";
import { dayInputs } from "../../../application/today/day";
import { freeTime, lengthOf, nowCard, timed } from "../../../domain/today/day";
import { loadDayNotes } from "../../../application/calendar/calendar";
import { openMeetingView } from "../../../application/calendar/meeting-view";
import { ColumnResize } from "../navigation/ColumnResize";

// keys that belong to a field, a button or a link, not to Today
const inControl = (e: KeyboardEvent) =>
  e
    .composedPath()
    .some(node => node instanceof HTMLElement && node.matches("input, textarea, select, [contenteditable]"));

/** Today: one queue of everything that needs the user, planned into the free time between today's meetings. On top
 *  one quiet line: the day, the next meeting, how far the day got and the project filter; below, the queue per slot
 *  (the meetings in it at their time) and the open item with its actions. Design "Today Calm", 6a / 6c.
 *  Enter and Backspace run the open item's actions, L puts it off, the arrows walk the queue. */
// a mail's actions by their command, with the letter the action knows itself by (domain/today/kinds/mail.ts)
const MAIL_KEYS = [
  ["replyAll", "A"],
  ["forward", "F"],
  ["ticket", "T"],
  ["read", "U"],
  ["trash", "#"],
] as const;

export function TodayView({ className = "" }: { className?: string }) {
  const { t, tn, locale } = useT();
  // a clock, for the plan and the timeline: the stores do not change when only time passes
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const model = useDerived(() => todayModel(clock));
  const day = useDerived(() => dayInputs(clock));
  // the notes of today's meetings, for the strip's glyphs, when Today opens (and with the 5-minute refresh)
  useEffect(() => void loadDayNotes(), []);
  const cards = useTodayStore(s => s.cards);
  const errors = useTodayStore(s => s.errors);
  const toast = useNavigationStore(s => s.toast);

  // what is in the queue now counts as cleared once it leaves it
  const seen = model.queue.map(({ id, title, kind, project }) => ({ id, title, kind, project }));
  useEffect(() => noteSeen(seen), [seen]);

  // the ticket window over Today; a status or assignee changed there shows once it closes
  const modal = useNavigationStore(s => s.panel.modal);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !modal) loadTodayCards();
    wasOpen.current = !!modal;
  }, [modal]);

  useEffect(() => {
    // the keys of Keel and the design: J K walk, Enter and Backspace the two actions, E done, S snooze, L later,
    // P in progress; for a mail R A F reply, reply all, forward, T ticket, U read, # trash. Each as Settings ›
    // Shortcuts has it (an action knows its default letter, `key`). Esc closes a menu or the composer.
    const onKey = (e: KeyboardEvent) => {
      const { panel, zoom, quickAsk, selected } = useNavigationStore.getState();
      if (selected !== "__wait" || panel.modal || zoom || quickAsk || e.defaultPrevented || e.isComposing) return;
      if (e.repeat || inControl(e)) return;
      const details = useDetailsStore.getState();
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && (details.pop || details.compose)) {
        e.preventDefault();
        return details.pop ? setPop("") : closeCompose();
      }
      // M: the next meeting, or the one being recorded
      if (isKey(e, "today.meeting")) {
        const inputs = dayInputs(Date.now());
        const card = nowCard(inputs.meetings, inputs.stages, Date.now());
        if (card.kind !== "none") {
          e.preventDefault();
          void openMeetingView(card.meeting);
          return;
        }
      }
      const now = todayModel();
      const entry = now.selected;
      const step = (by: number) => {
        const at = now.queue.findIndex(x => x.id === entry?.id);
        const next = now.queue[Math.min(now.queue.length - 1, Math.max(0, at + by))];
        if (next) selectEntry(next.id);
      };
      const is = (id: string) => isKey(e, `today.${id}` as CommandId);
      const actions = entry ? actionsOf(entry) : null;
      const mailAction = MAIL_KEYS.find(([id]) => is(id));
      const byKey = mailAction && actions?.acts.find(action => action.key === mailAction[1]);
      const mail = entry?.subject.type === "mail";
      if (is("next")) step(1);
      else if (is("prev")) step(-1);
      else if (!entry || !actions) return;
      else if (is("later")) putOff(entry.id);
      else if (is("snooze") && entry.subject.type !== "meeting") setPop("snooze");
      else if (is("done") && actions.done) actions.done.run();
      else if (is("doing") && entry.kind !== "ask")
        setStatus(entry, entry.status === "doing" ? "todo" : "doing").catch(console.error);
      else if (mail && is("reply")) actions.primary?.run();
      else if (mail && byKey) byKey.run();
      // an agent's question or permission takes Enter itself (its card)
      else if (is("primary") && entry.kind !== "ask" && !(e.target instanceof HTMLButtonElement))
        actions.primary?.run();
      else if (is("secondary") && actions.secondary) actions.secondary.run();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ticket = () => {
    const open = modal ? cardOf(modal) : undefined;
    // a card under Today, or another card of a linked board (a PR's ticket)
    const boards = useTodayStore.getState().boards;
    const item =
      open &&
      (cards.find(x => x.provider === open.provider.id && x.card.id === open.id) ??
        Object.entries(boards).flatMap(([project, b]) =>
          b.provider === open.provider.id
            ? b.cards.filter(c => c.id === open.id).map(card => ({ provider: b.provider, ref: b.ref, project, card }))
            : [],
        )[0]);
    if (!open || !item) return null;
    const own = cards.some(x => x === item) ? cards.filter(x => x.provider === item.provider) : [item];
    // the provider's cards under Today as one column, so previous and next step through them
    const board: Board = {
      ...newBoard(open.provider, { project: "", board: "", group: "", view: "" }),
      columns: [{ id: "today", name: "", placement: 0 }],
      cards: own.map(x => ({ ...x.card, column: "today" })),
    };
    const step = (id: string) => {
      const next = own.find(x => x.card.id === id);
      if (next) openTodayCard(next);
    };
    return <BoardTicket provider={open.provider} board={board} step={step} project={item.project} />;
  };

  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(clock);
  // the day in one muted line: how many meetings, how much of the working day is free, what is left to do
  const free = freeTime(day.meetings.map(timed), clock).minutes;
  const card = nowCard(day.meetings, day.stages, clock);
  const line = [
    day.meetings.length ? tn("today.d.meetings", day.meetings.length) : t("today.d.noMeetings"),
    t("today.d.free", { time: lengthOf(free) }),
    t("today.d.todo", { n: model.rows }),
  ].join(" · ");
  return (
    <div className={`${className} relative flex flex-col min-h-0`}>
      <div className="flex-none px-7 pt-5">
        <div className="flex items-end gap-4 min-w-0">
          <div className="flex-1 min-w-0">
            <h1 className="m-0 text-[22px] leading-7 font-bold tracking-tight capitalize truncate">{date}</h1>
            <div className="mt-0.5 text-secondary truncate">{line}</div>
          </div>
          {errors.length ? (
            <span className="text-xs text-late truncate max-w-80" title={errors.join("\n")}>
              {t("today.boardsDown", { n: errors.length })}
            </span>
          ) : null}
          <ContextFilter model={model} />
        </div>
        <DayStrip
          meetings={day.meetings}
          stages={day.stages}
          followed={day.followed}
          now={clock}
          focus={card.kind === "soon" ? card.meeting.id : null}
        />
        <NowCard meetings={day.meetings} stages={day.stages} now={clock} />
      </div>
      <div className="relative flex-1 min-h-0 mt-3.5 border-t border-separator grid grid-cols-[var(--today-w)_minmax(0,1fr)]">
        <TodayQueue model={model} />
        <ColumnResize column="today" />
        <TodayDetail model={model} />
      </div>

      {toast ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toast toast={toast} />
        </div>
      ) : null}
      {ticket()}
    </div>
  );
}
