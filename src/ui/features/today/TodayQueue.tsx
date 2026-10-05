import { useState, type ReactNode } from "react";
import type { Meeting } from "../../../domain/calendar/types";
import type { Slot } from "../../../domain/today/plan";
import { joinable } from "../../../domain/calendar/rules";
import {
  isAgentItem,
  openMeeting,
  projectChip,
  reopen,
  selectEntry,
  wake,
  type Entry,
  type TodayModel,
} from "../../../application/today/today";
import { joinMeeting, meetingProjectOf, timeOf } from "../../../application/calendar/calendar";
import { useTodayStore } from "../../../application/today/store";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { RecordingBar } from "../conversations/RecordingBar";
import { KIND_ICON, StatusDot, minutes } from "./parts";

const iso = (at: number) => new Date(at).toISOString();
const MIN = 60_000;
// what bundles: three or more mails, or PRs, in one group are one row that opens
const BUNDLE: Record<string, "mail" | "pr"> = { mail: "mail", review: "pr", fix: "pr" };

/** The queue as the day runs (design "Today Calm" 6a / 6c): a quiet heading per free slot, the meetings in between as
 *  cards at their time, what did not fit under Tomorrow. A row says what it is once: one icon, the title, and the
 *  project and how long. Three or more mails or PRs in a slot are one row that opens. A click opens an item. */
export function TodayQueue({ model }: { model: TodayModel }) {
  const { t, locale } = useT();
  const pins = useTodayStore(s => s.pins);
  const [opened, setOpened] = useState<string[]>([]);
  const { queue, slots, placed, tomorrow, selected, meetings, now, done, snoozed } = model;

  const meta = (entry: Entry) =>
    [
      projectChip(entry.project)?.label,
      entry.kind === "ask" || entry.kind === "blocked"
        ? minutes(Math.max(0, Math.floor((now - entry.at) / MIN)))
        : minutes(entry.est),
    ]
      .filter(Boolean)
      .join(" · ");

  const row = (entry: Entry, child = false) => {
    const on = entry.id === selected?.id;
    return (
      <div
        key={entry.id}
        role="button"
        tabIndex={-1}
        onClick={() => selectEntry(entry.id)}
        className={`flex items-center gap-3 py-1.5 cursor-pointer outline-none ${child ? "min-h-9 pl-10 pr-3 rounded-lg" : "min-h-12 px-3 rounded-xl"} ${on ? "bg-accent-soft" : "hover:bg-fill"}`}
      >
        {child ? null : (
          <span className="relative flex-none text-tertiary">
            <Icon name={KIND_ICON[entry.kind]} className="glyph size-4" />
            {/* in progress: a small dot on the icon, the only mark a row carries */}
            {entry.status === "doing" ? (
              <span className="absolute -right-0.5 -bottom-0.5 size-1.75 rounded-full bg-accent shadow-[0_0_0_1.5px_var(--color-bg)]" />
            ) : null}
          </span>
        )}
        <span className="flex-1 min-w-0 flex flex-col leading-snug">
          <span className={`truncate ${child ? "text-[13px]" : "text-sm"} ${on ? "font-medium" : ""}`}>
            {entry.title}
          </span>
          {child ? null : <span className="truncate text-xs text-tertiary">{meta(entry)}</span>}
        </span>
        {child ? <span className="text-xs text-tertiary tabular-nums">{minutes(entry.est)}</span> : null}
        {pins[entry.id] ? <Icon name="bookmark" className="glyph size-3 flex-none text-accent-text" /> : null}
      </div>
    );
  };

  // the rows of a group, with three or more of a kind as one row that opens (it opens by itself when it holds the
  // open item); "more" when that kind came as single rows earlier in the day
  const shown = new Set<string>();
  const rows = (group: string, items: Entry[]) => {
    const count = (kind: string) => items.filter(entry => BUNDLE[entry.kind] === kind).length;
    const out: ReactNode[] = [];
    const bundled = new Set<string>();
    for (const entry of items) {
      const kind = BUNDLE[entry.kind];
      if (!kind || count(kind) < 3) {
        if (kind) shown.add(kind);
        out.push(row(entry));
        continue;
      }
      if (bundled.has(kind)) continue;
      bundled.add(kind);
      const members = items.filter(x => BUNDLE[x.kind] === kind);
      const key = `${group}:${kind}`;
      const open = opened.includes(key) || members.some(x => x.id === selected?.id);
      const label = t(`today.bundle.${kind}${shown.has(kind) ? "More" : ""}`, { n: members.length });
      shown.add(kind);
      out.push(
        <div key={key}>
          <button
            onClick={() => setOpened(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))}
            className="w-full flex items-center gap-3 min-h-12 px-3 rounded-xl text-left cursor-pointer hover:bg-fill"
          >
            <Icon name={kind === "mail" ? "mail" : "pr"} className="glyph size-4 flex-none text-tertiary" />
            <span className="flex-1 min-w-0 flex flex-col leading-snug">
              <span className="truncate text-sm">{label}</span>
              <span className="text-xs text-tertiary">{minutes(members.reduce((sum, x) => sum + x.est, 0))}</span>
            </span>
            <Icon
              name="chevron"
              className={`glyph size-3.25 flex-none text-tertiary transition-transform duration-150 ease-out ${open ? "" : "-rotate-90"}`}
            />
          </button>
          {open ? members.map(member => row(member, true)) : null}
        </div>,
      );
    }
    return out;
  };

  const heading = (label: string, sub?: string) => (
    <div className="flex items-baseline gap-2 px-3 pt-4 pb-1.5 min-w-0">
      <span className="text-[13px] font-semibold truncate">{label}</span>
      {sub ? <span className="text-xs text-tertiary tabular-nums whitespace-nowrap">{sub}</span> : null}
    </div>
  );

  // a slot is named by what is around it: now, before the next meeting, between two, or the rest of the day
  const slotGroup = (slot: Slot) => {
    const items = queue.filter(entry => !isAgentItem(entry) && placed[entry.id]?.slot === slot.key);
    if (!items.length) return null;
    const next = meetings.find(meeting => Math.abs(Date.parse(meeting.start) - slot.end) < MIN);
    const before = slot.after ? meetings.find(meeting => meeting.id === slot.after) : undefined;
    const from = Math.max(slot.start, now);
    const [label, sub] =
      next && before
        ? [t("today.slotBetween"), `${timeOf(iso(slot.start))}–${timeOf(iso(slot.end))}`]
        : next
          ? [
              t("today.slotBefore", { title: next.title || t("wait.meetingUntitled") }),
              t("today.minFree", { n: Math.max(0, Math.round((slot.end - from) / MIN)) }),
            ]
          : slot.start <= now
            ? [t("today.slotNow"), t("today.until", { time: timeOf(iso(slot.end)) })]
            : [
                new Date(slot.start).getHours() < 17 ? t("today.slotAfternoon") : t("today.slotEvening"),
                t("today.from", { time: timeOf(iso(slot.start)) }),
              ];
    return (
      <div key={`slot:${slot.key}`}>
        {heading(label, sub)}
        {rows(slot.key, items)}
      </div>
    );
  };

  // a meeting at its time, as a card: Join only when it starts within 15 minutes (or runs)
  const meetingCard = (meeting: Meeting) => {
    const start = Date.parse(meeting.start);
    const end = Date.parse(meeting.end);
    const live = start <= now && now < end;
    const soon = !live && start - now < 15 * MIN;
    const on = !!selected && selected.id === model.meetingItems[meeting.id];
    const where = meeting.location && !/^https?:/.test(meeting.location) ? meeting.location : "";
    const sub = [
      projectChip(meetingProjectOf(meeting))?.label,
      where,
      meeting.people.length > 1 ? t("today.people", { n: meeting.people.length }) : "",
      live
        ? `${t("today.meetingNow")} · ${t("today.until", { time: timeOf(meeting.end) })}`
        : soon
          ? t("today.inMin", { n: Math.max(0, Math.round((start - now) / MIN)) })
          : t("today.until", { time: timeOf(meeting.end) }),
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div
        key={`meet:${meeting.id}`}
        onClick={() => openMeeting(meeting.id)}
        className={`flex items-center gap-3 min-h-13 my-2 px-3 py-1.5 rounded-xl bg-raised ${on ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : "shadow-[inset_0_0_0_1px_var(--color-separator-strong)] hover:bg-fill"} ${model.meetingItems[meeting.id] ? "cursor-pointer" : ""}`}
      >
        <span className="w-11 flex-none text-sm font-semibold tabular-nums">{timeOf(meeting.start)}</span>
        <span className="flex-1 min-w-0 flex flex-col leading-snug">
          <span className={`text-sm truncate ${on ? "font-semibold" : "font-medium"}`}>
            {meeting.title || t("wait.meetingUntitled")}
          </span>
          <span className={`text-xs truncate ${live || soon ? "text-soon" : "text-tertiary"}`}>{sub}</span>
        </span>
        {(live || soon) && joinable(meeting.join) ? (
          <button
            className="flex-none h-7.5 px-3.5 rounded-lg bg-accent text-on-accent text-[13px] font-medium cursor-pointer hover:bg-accent-hover"
            onClick={e => {
              e.stopPropagation();
              joinMeeting(meeting.join);
            }}
          >
            {t("wait.meetingJoin")}
          </button>
        ) : null}
      </div>
    );
  };

  // the slots and the meetings that are not over, in the order of the day
  const ahead = meetings.filter(meeting => Date.parse(meeting.end) > now);
  const parts: [number, ReactNode][] = [
    ...slots.map((slot): [number, ReactNode] => [slot.start, slotGroup(slot)]),
    ...ahead.map((meeting): [number, ReactNode] => [Date.parse(meeting.start) - 0.5, meetingCard(meeting)]),
  ];
  parts.sort((a, b) => a[0] - b[0]);
  const later = queue.filter(entry => !isAgentItem(entry) && tomorrow.includes(entry.id));
  // what an agent needs you for sits on top: a decision, a blocked session, a result to read
  const asks = queue.filter(isAgentItem);
  const tomorrowDate = new Date(now + 864e5).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const quiet = "flex items-center gap-3 h-9 px-3 text-[13px] text-secondary";
  return (
    <div className="min-h-0 overflow-y-auto border-r border-separator px-3 pt-2 pb-6">
      <RecordingBar />
      {!ahead.length && meetings.length ? (
        <div className="flex items-center gap-2 h-8 mt-1 px-3 rounded-lg bg-fill text-xs text-secondary">
          <Icon name="cal" className="glyph size-3.5 text-tertiary" />
          {t("today.noMoreMeetings")}
          <span className="text-tertiary">· {t("today.earlier", { n: meetings.length })}</span>
        </div>
      ) : null}
      {asks.length ? (
        <div>
          {heading(t("today.agentsNeedYou"), String(asks.length))}
          {asks.map(entry => row(entry))}
        </div>
      ) : null}
      {parts.map(([, node]) => node)}
      {later.length ? (
        <div>
          {heading(t("rem.tomorrow"), tomorrowDate)}
          {rows("tomorrow", later)}
        </div>
      ) : null}
      {snoozed.length ? (
        <div>
          {heading(t("today.snoozed"), String(snoozed.length))}
          {snoozed.map(item => (
            <div key={item.id} className={quiet}>
              <Icon name={KIND_ICON[item.kind]} className="glyph size-4 flex-none text-tertiary" />
              <span className="flex-1 min-w-0 truncate">{item.title}</span>
              <span className="text-xs text-tertiary tabular-nums whitespace-nowrap">
                {new Date(`${item.until}T00:00`).toLocaleDateString(locale, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <button className="text-xs hover:text-label cursor-pointer" onClick={() => wake(item.id)}>
                {t("today.wake")}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {done.length ? (
        <div>
          {heading(t("today.doneToday"), String(done.length))}
          {done.map(item => (
            <div key={item.id} className={quiet}>
              <StatusDot status="done" />
              <span className="flex-1 min-w-0 truncate line-through decoration-tertiary">{item.title}</span>
              {item.reopen ? (
                <button className="text-xs hover:text-label cursor-pointer" onClick={() => reopen(item.id)}>
                  {t("today.reopen")}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
