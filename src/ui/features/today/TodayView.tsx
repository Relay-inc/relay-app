import { useEffect, useRef, useState } from "react";
import type { Reminder } from "../../../domain/reminders/types";
import type { Board } from "../../../domain/board/rules";
import { newBoard } from "../../../domain/board/rules";
import { todayIso, urgency } from "../../../domain/reminders/rules";
import { joinable } from "../../../domain/calendar/rules";
import { meetingsToday, prsForMe, type TodayCard } from "../../../domain/today/rules";
import { raw } from "../../../shared/i18n";
import { esc } from "../../../shared/html";
import { provider } from "../../../shared/plugins";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { useCalendarStore } from "../../../application/calendar/store";
import { useTodayStore } from "../../../application/today/store";
import { usePullRequestsStore } from "../../../application/pull-requests/store";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { cardOf } from "../../../application/navigation/panel";
import { select } from "../../../application/navigation/navigation";
import { label, projectOf, waitCount } from "../../../application/conversations/selectors";
import { joinMeeting, meetingChat, soonMeetings, timeOf } from "../../../application/calendar/calendar";
import { chatAboutReminder, projectTint, reminderAction } from "../../../application/reminders/reminders";
import { projectLabel } from "../../../application/workspace/vault";
import {
  loadTodayCards,
  openTodayCard,
  openTodayCardIn,
  openTodayPr,
  todayCardChat,
  todaySummary,
} from "../../../application/today/today";
import { Html } from "../../components/Html";
import { Icon } from "../../components/Icon";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { ReminderRow } from "../reminders/ReminderRow";
import { PrRow } from "../pull-requests/PrRow";
import { BoardTicket } from "../board/BoardTicket";
import { NowSection } from "./NowSection";
import { ROW_BUTTON, ROW_PRIMARY, TodayHeading, TodayRow } from "./TodayRow";

const tabNumber = (value: string | number) => raw(`<span class="tabular-nums">${esc(value)}</span>`);
const ICON_BUTTON = "btn-icon cursor-pointer";

/** Today: everything that needs the user, or someone waiting on them, today. Now on top (what an agent asks, a meeting
 *  about to start, a blocked session), then today's meetings, the reminders due, the user's cards, the PRs waiting on
 *  them and the conversations that finished unread. A section with nothing in it is not shown. */
export function TodayView() {
  const { t, th, locale } = useT();
  // a clock, for which meetings are over
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const nowCount = useDerived(waitCount);
  const soon = useDerived(soonMeetings);
  const meetingList = useCalendarStore(s => s.list);
  const calendarErrors = useCalendarStore(s => s.errors);
  const { coming, past } = meetingsToday(meetingList, clock, new Set(soon.map(meeting => meeting.id)));
  const allReminders = useWorkspaceStore(s => s.snap.reminders) as Reminder[];
  const reminders = allReminders.filter(reminder => reminder.days <= 0).sort((a, b) => a.days - b.days);
  const cards = useTodayStore(s => s.cards);
  const cardErrors = useTodayStore(s => s.errors);
  const prs = prsForMe(usePullRequestsStore(s => s.list));
  const unseenSet = useConversationsStore(s => s.unseen);
  const pendingList = useConversationsStore(s => s.pendingList);
  const asking = new Set(pendingList.map(request => request.project));
  const unseen = [...unseenSet].filter(key => !asking.has(key)); // what asks is under Now already

  const [showPast, setShowPast] = useState(false);
  const [calendarRow, setCalendarRow] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const runAction = async (reminder: Reminder, action: "done" | "push", date?: string) => {
    setBusyRow(reminder.id);
    setCalendarRow(null);
    await reminderAction(reminder, action, date);
    setBusyRow(null);
  };

  // the ticket window over Today, for the card open in it; a status or assignee changed there shows once it closes
  const modal = useNavigationStore(s => s.panel.modal);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !modal) loadTodayCards();
    wasOpen.current = !!modal;
  }, [modal]);
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

  const rest = coming.length + reminders.length + cards.length + prs.review.length + prs.mine.length + unseen.length;
  const dateLine = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(clock);

  const cardDue = (item: TodayCard) => {
    const due = item.card.due;
    if (!due) return <span className="text-soon">{item.card.status || t("today.inProgress")}</span>;
    const days = Math.round((Date.parse(due) - Date.parse(todayIso())) / 864e5); // both yyyy-mm-dd, read as UTC
    const local = days < 0 ? "due-late" : "due-soon";
    return days < 0 ? (
      <Html className={local} html={th("due.overdue", { n: tabNumber(-days) })} />
    ) : (
      <span className={local}>{t("rem.today")}</span>
    );
  };

  const errors = [...calendarErrors.map(error => t("wait.calendarDown", { error })), ...cardErrors];
  return (
    <div className="mx-auto flex max-w-170 flex-col gap-7 px-8 pt-7 pb-8">
      <header className="flex flex-col gap-0.5">
        <h1 className="m-0 text-xl font-semibold tracking-tight capitalize">{dateLine}</h1>
        <span className="text-[13px] text-secondary">{todaySummary(nowCount, rest)}</span>
      </header>

      <NowSection />

      {!nowCount && !rest ? (
        <div className="flex flex-col items-center gap-2.5 py-16 text-secondary">
          <span className="grid place-items-center size-10 rounded-full bg-add-bg text-add-fg">
            <Icon name="check" className="glyph size-5" />
          </span>
          <span className="text-[15px] font-semibold text-label">{t("wait.none")}</span>
          <span className="text-[13px]">{t("wait.noneSub")}</span>
        </div>
      ) : null}

      {coming.length || past.length ? (
        <section>
          <TodayHeading n={coming.length}>{t("today.meetings")}</TodayHeading>
          {coming.map(meeting => (
            <TodayRow
              key={meeting.id}
              icon="cal"
              title={meeting.title || t("wait.meetingUntitled")}
              onOpen={() => meetingChat(meeting.id, "prep")}
              meta={
                <span className="tabular-nums">
                  {timeOf(meeting.start)}–{timeOf(meeting.end)}
                  {meeting.location ? ` · ${meeting.location}` : ""}
                </span>
              }
              actions={
                <>
                  <button className={ROW_BUTTON} onClick={() => meetingChat(meeting.id, "prep")}>
                    {t("wait.meetingPrep")}
                  </button>
                  <button className={ROW_BUTTON} onClick={() => meetingChat(meeting.id, "note")}>
                    {t("wait.meetingNote")}
                  </button>
                  {joinable(meeting.join) ? (
                    <button className={ROW_PRIMARY} onClick={() => joinMeeting(meeting.join)}>
                      {t("wait.meetingJoin")}
                    </button>
                  ) : null}
                </>
              }
            />
          ))}
          {past.length ? (
            <button
              className="mt-2 text-xs text-secondary cursor-pointer hover:text-label"
              onClick={() => setShowPast(!showPast)}
            >
              {t(showPast ? "today.hidePast" : "today.showPast", { n: past.length })}
            </button>
          ) : null}
          {showPast &&
            past.map(meeting => (
              <TodayRow
                key={meeting.id}
                dim
                icon="cal"
                title={meeting.title || t("wait.meetingUntitled")}
                onOpen={() => meetingChat(meeting.id, "note")}
                meta={
                  <span className="tabular-nums">
                    {timeOf(meeting.start)}–{timeOf(meeting.end)}
                  </span>
                }
                actions={
                  <button className={ROW_BUTTON} onClick={() => meetingChat(meeting.id, "note")}>
                    {t("wait.meetingNote")}
                  </button>
                }
              />
            ))}
        </section>
      ) : null}

      {reminders.length ? (
        <section>
          <TodayHeading n={reminders.length} tone={reminders.some(r => r.days < 0) ? "text-late" : "text-soon"}>
            {t("nav.reminders")}
          </TodayHeading>
          {reminders.map(reminder => (
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              label={reminder.project ? projectLabel(reminder.project) : ""}
              tint={projectTint(reminder.project)}
              urgency={urgency(reminder.days)}
              busy={busyRow === reminder.id}
              cal={calendarRow === reminder.id}
              onChat={() => chatAboutReminder(reminder.id)}
              onDone={() => runAction(reminder, "done")}
              onPush={date => runAction(reminder, "push", date)}
              onCalendar={() => setCalendarRow(calendarRow === reminder.id ? null : reminder.id)}
              onCloseCalendar={() => setCalendarRow(null)}
            />
          ))}
        </section>
      ) : null}

      {cards.length ? (
        <section>
          <TodayHeading n={cards.length}>{t("today.cards")}</TodayHeading>
          {cards.map(item => (
            <TodayRow
              key={`${item.provider}:${item.card.id}`}
              icon="board"
              title={[
                item.card.number && `${/^\d+$/.test(item.card.number) ? "#" : ""}${item.card.number}`,
                item.card.title,
              ]
                .filter(Boolean)
                .join(" ")}
              onOpen={() => openTodayCard(item)}
              project={projectLabel(item.project)}
              tint={projectTint(item.project)}
              meta={
                <>
                  {cardDue(item)}
                  <span>{provider(item.provider)?.name}</span>
                </>
              }
              actions={
                <>
                  <button
                    className={ICON_BUTTON}
                    title={t("rem.chat")}
                    aria-label={t("rem.chat")}
                    onClick={() => todayCardChat(item)}
                  >
                    <Icon name="chat" className="glyph size-3.75 stroke-current!" />
                  </button>
                  <button
                    className={ICON_BUTTON}
                    title={t("kb.openIn", { name: provider(item.provider)?.name ?? "" })}
                    aria-label={t("kb.openIn", { name: provider(item.provider)?.name ?? "" })}
                    onClick={() => openTodayCardIn(item)}
                  >
                    <Icon name="out" className="glyph size-3.75 stroke-current!" />
                  </button>
                  <button className={ROW_PRIMARY} onClick={() => openTodayCard(item)}>
                    {t("today.open")}
                  </button>
                </>
              }
            />
          ))}
        </section>
      ) : null}

      {prs.review.length || prs.mine.length ? (
        <section>
          <TodayHeading n={prs.review.length + prs.mine.length}>{t("nav.prs")}</TodayHeading>
          {prs.review.map(pr => (
            <PrRow key={pr.url} pr={pr} onOpen={() => openTodayPr(pr.repo, pr.number)} />
          ))}
          {prs.mine.map(pr => (
            <PrRow key={pr.url} pr={pr} mine onOpen={() => openTodayPr(pr.repo, pr.number)} />
          ))}
        </section>
      ) : null}

      {unseen.length ? (
        <section>
          <TodayHeading n={unseen.length}>{t("today.finished")}</TodayHeading>
          {unseen.map(key => (
            <TodayRow
              key={key}
              icon="chat"
              title={label(key)}
              onOpen={() => select(key)}
              project={projectOf(key) ?? ""}
              actions={
                <button className={ROW_PRIMARY} onClick={() => select(key)}>
                  {t("wait.open")}
                </button>
              }
            />
          ))}
        </section>
      ) : null}

      {errors.length ? <div className="text-xs text-secondary">{errors.join(" · ")}</div> : null}
      {ticket()}
    </div>
  );
}
