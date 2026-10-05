import { useEffect, useRef, useState } from "react";
import type { Board } from "../../../domain/board/rules";
import { newBoard } from "../../../domain/board/rules";
import { useTodayStore } from "../../../application/today/store";
import { setPop, useDetailsStore } from "../../../application/today/details";
import { closeCompose } from "../../../application/today/mail";
import { closeReview, useReviewStore } from "../../../application/today/review";
import { ReviewScreen } from "./ReviewScreen";
import { useNavigationStore } from "../../../application/navigation/store";
import { cardOf } from "../../../application/navigation/panel";
import {
  actionsOf,
  loadTodayCards,
  noteSeen,
  openTodayCard,
  putOff,
  selectEntry,
  setStatus,
  todayModel,
} from "../../../application/today/today";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { BoardTicket } from "../board/BoardTicket";
import { Toast } from "../conversations/Toast";
import { TodayTimeline } from "./TodayTimeline";
import { TodayQueue } from "./TodayQueue";
import { TodayDetail } from "./TodayDetail";
import { minutes } from "./parts";

// keys that belong to a field, a button or a link, not to Today
const inControl = (e: KeyboardEvent) =>
  e
    .composedPath()
    .some(node => node instanceof HTMLElement && node.matches("input, textarea, select, [contenteditable]"));

/** Today: one queue of everything that needs the user, planned into the free time between today's meetings. On top
 *  how far the day got and the day as a track; below, the queue per slot and the open item with its actions.
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
  const work = useReviewStore(s => s.work);

  // what is in the queue now counts as cleared once it leaves it
  const seen = model.queue.map(({ id, title, kind }) => ({ id, title, kind }));
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
      // the review screen: Esc goes back to Today, its own fields take the rest
      if (useReviewStore.getState().work) {
        if (e.key === "Escape" && !useReviewStore.getState().reviews[useReviewStore.getState().work]?.confirm) {
          e.preventDefault();
          closeReview();
        }
        return;
      }
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
      else if (key === "s") setPop("snooze");
      else if (key === "e" && actions.done) actions.done.run();
      else if (key === "p" && entry.kind !== "ask")
        setStatus(entry, entry.status === "doing" ? "todo" : "doing").catch(console.error);
      else if (mail && key === "r") actions.primary?.run();
      else if (mail && ["a", "f", "u", "#"].includes(key) && byKey(key)) byKey(key)!.run();
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
    const item = open && cards.find(x => x.provider === open.provider.id && x.card.id === open.id);
    if (!open || !item) return null;
    const own = cards.filter(x => x.provider === item.provider);
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
  const reviewing = model.selected && work === model.selected.id ? model.selected : null;
  return (
    <div className={`${className} relative flex flex-col min-h-0`}>
      {reviewing ? (
        <ReviewScreen model={model} entry={reviewing} />
      ) : (
        <>
          <div className="flex-none h-10 flex items-center gap-3 px-5 border-b border-separator">
            <span className="text-secondary capitalize whitespace-nowrap">{date}</span>
            <div className="flex-1 flex gap-0.75 max-w-75">
              {Array.from({ length: model.total }, (_, i) => (
                <span
                  key={i}
                  className={`flex-1 h-1 rounded-sm ${i < model.cleared ? "bg-ok" : i === model.cleared ? "bg-accent" : "bg-fill-2"}`}
                />
              ))}
            </div>
            <span className="text-xs text-secondary tabular-nums whitespace-nowrap">
              {t("today.progress", { cleared: model.cleared, total: model.total, planned: minutes(model.planned) })}
            </span>
            <span className="flex-1" />
            {errors.length ? (
              <span className="text-xs text-late truncate max-w-80" title={errors.join("\n")}>
                {t("today.boardsDown", { n: errors.length })}
              </span>
            ) : (
              <span className="text-[11px] text-tertiary whitespace-nowrap">{t("today.keysHint")}</span>
            )}
          </div>
          <TodayTimeline model={model} />
          <div className="flex-1 min-h-0 grid grid-cols-[300px_minmax(0,1fr)]">
            <TodayQueue model={model} />
            <TodayDetail model={model} />
          </div>
        </>
      )}
      {toast ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toast toast={toast} />
        </div>
      ) : null}
      {ticket()}
    </div>
  );
}
