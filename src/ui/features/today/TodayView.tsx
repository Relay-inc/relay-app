import { useEffect, useRef, useState } from "react";
import type { Board } from "../../../domain/board/rules";
import { newBoard } from "../../../domain/board/rules";
import { useTodayStore } from "../../../application/today/store";
import { setPop, useDetailsStore } from "../../../application/today/details";
import { closeCompose } from "../../../application/today/mail";
import { ContextFilter } from "./ContextFilter";
import { useNavigationStore } from "../../../application/navigation/store";
import { cardOf } from "../../../application/navigation/panel";
import {
  loadTodayCards,
  noteSeen,
  openMeeting,
  putOff,
  selectEntry,
  todayModel,
} from "../../../application/today/today";
import { actionsOf, openTodayCard, setStatus } from "../../../application/today/actions";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { BoardTicket } from "../board/BoardTicket";
import { Toast } from "../conversations/Toast";
import { TodayQueue } from "./TodayQueue";
import { TodayDetail } from "./TodayDetail";
import { Icon } from "../../components/Icon";
import { timeOf } from "../../../application/calendar/calendar";
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
export function TodayView({ className = "" }: { className?: string }) {
  const { t, locale } = useT();
  // a clock, for the plan and the timeline: the stores do not change when only time passes
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const model = useDerived(() => todayModel(clock));
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
    // P in progress; for a mail R A F reply, reply all, forward, U read, # trash. Esc closes a menu or the composer.
    const onKey = (e: KeyboardEvent) => {
      const { panel, zoom, quickAsk, selected } = useNavigationStore.getState();
      if (selected !== "__wait" || panel.modal || zoom || quickAsk || e.defaultPrevented || e.isComposing) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || inControl(e)) return;
      const details = useDetailsStore.getState();
      if (e.key === "Escape" && (details.pop || details.compose)) {
        e.preventDefault();
        return details.pop ? setPop("") : closeCompose();
      }
      const now = todayModel();
      const entry = now.selected;
      const step = (by: number) => {
        const at = now.queue.findIndex(x => x.id === entry?.id);
        const next = now.queue[Math.min(now.queue.length - 1, Math.max(0, at + by))];
        if (next) selectEntry(next.id);
      };
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const actions = entry ? actionsOf(entry) : null;
      const byKey = (k: string) => actions?.acts.find(action => action.key?.toLowerCase() === k);
      const mail = entry?.subject.type === "mail";
      if (key === "ArrowDown" || key === "j") step(1);
      else if (key === "ArrowUp" || key === "k") step(-1);
      else if (!entry || !actions) return;
      else if (key === "l") putOff(entry.id);
      else if (key === "s" && entry.subject.type !== "meeting") setPop("snooze");
      else if (key === "e" && actions.done) actions.done.run();
      else if (key === "p" && entry.kind !== "ask")
        setStatus(entry, entry.status === "doing" ? "todo" : "doing").catch(console.error);
      else if (mail && key === "r") actions.primary?.run();
      else if (mail && ["a", "f", "t", "u", "#"].includes(key) && byKey(key)) byKey(key)!.run();
      // an agent's question or permission takes Enter itself (its card)
      else if (key === "Enter" && entry.kind !== "ask" && !(e.target instanceof HTMLButtonElement))
        actions.primary?.run();
      else if (key === "Backspace" && actions.secondary) actions.secondary.run();
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

  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(clock);
  // the next two meetings, named once here: the queue has them at their time
  const ahead = model.meetings.filter(meeting => Date.parse(meeting.start) > clock);
  const nextIn = ahead[0] ? Math.round((Date.parse(ahead[0].start) - clock) / 60_000) : 0;
  return (
    <div className={`${className} relative flex flex-col min-h-0`}>
      <div className="flex-none h-12 flex items-center gap-3 px-5 border-b border-separator min-w-0">
        <span className="text-[15px] font-semibold capitalize whitespace-nowrap">{date}</span>
        {ahead[0] ? (
          <button
            onClick={() => openMeeting(ahead[0].id)}
            className="ml-2 inline-flex items-center gap-2 min-w-0 text-[13px] text-secondary cursor-pointer hover:text-label"
          >
            <Icon name="cal" className="glyph size-3.5 flex-none text-soon" />
            <span className="truncate">
              {ahead[0].title || t("wait.meetingUntitled")}{" "}
              {nextIn < 60 ? t("today.inMin", { n: nextIn }) : timeOf(ahead[0].start)}
              {ahead[1]
                ? ` · ${t("today.thenAt", { title: ahead[1].title || t("wait.meetingUntitled"), time: timeOf(ahead[1].start) })}`
                : ""}
            </span>
          </button>
        ) : null}
        <span className="flex-1" />
        {errors.length ? (
          <span className="text-xs text-late truncate max-w-80" title={errors.join("\n")}>
            {t("today.boardsDown", { n: errors.length })}
          </span>
        ) : null}
        <span className="text-[13px] text-tertiary tabular-nums whitespace-nowrap">
          {t("today.doneOf", { done: model.cleared, total: model.total })}
        </span>
        <ContextFilter model={model} />
      </div>
      <div className="relative flex-1 min-h-0 grid grid-cols-[var(--today-w)_minmax(0,1fr)]">
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
