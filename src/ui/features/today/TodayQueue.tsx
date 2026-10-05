import type { ReactNode } from "react";
import type { Meeting } from "../../../domain/calendar/types";
import type { Slot } from "../../../domain/today/plan";
import { joinable } from "../../../domain/calendar/rules";
import {
  openMeeting,
  reopen,
  selectEntry,
  setStatus,
  wake,
  type Entry,
  type TodayModel,
} from "../../../application/today/today";
import { joinMeeting, timeOf } from "../../../application/calendar/calendar";
import { useTodayStore } from "../../../application/today/store";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { RecordingBar } from "../conversations/RecordingBar";
import { Caps, KIND_ICON, StatusDot, TONE_BG, minutes } from "./parts";

const iso = (at: number) => new Date(at).toISOString();

/** The queue as the day runs: per free slot what is planned in it and how full it is, the meetings in between, and
 *  what did not fit today at the end. A click opens an item in the detail. */
export function TodayQueue({ model }: { model: TodayModel }) {
  const { t, locale } = useT();
  const pins = useTodayStore(s => s.pins);
  const { queue, slots, placed, tomorrow, used, selected, meetings, now, done, snoozed } = model;

  const row = (entry: Entry) => {
    const on = entry.id === selected?.id;
    const at = placed[entry.id];
    return (
      <div
        key={entry.id}
        role="button"
        tabIndex={-1}
        onClick={() => selectEntry(entry.id)}
        className={`w-full flex items-center gap-2.5 h-10 px-2.5 rounded-[9px] text-left cursor-pointer ${on ? "bg-accent-soft" : "hover:bg-fill"}`}
      >
        <span className={`w-0.75 h-5 rounded-sm flex-none ${TONE_BG[entry.tone]}`} />
        {entry.kind === "ask" ? null : (
          <button
            className="flex-none cursor-pointer"
            title={t(entry.status === "doing" ? "today.status.todo" : "today.status.doing")}
            onClick={e => {
              e.stopPropagation();
              setStatus(entry, entry.status === "doing" ? "todo" : "doing").catch(console.error);
            }}
          >
            <StatusDot status={entry.status} />
          </button>
        )}
        <Icon name={KIND_ICON[entry.kind]} className="glyph size-3.75 flex-none text-secondary" />
        <span className={`flex-1 min-w-0 truncate ${on ? "font-semibold" : ""}`}>{entry.title}</span>
        {pins[entry.id] ? <Icon name="bookmark" className="glyph size-3 flex-none text-accent-text" /> : null}
        <span className="text-[11px] text-tertiary tabular-nums whitespace-nowrap">
          {entry.kind === "ask"
            ? minutes(Math.max(0, Math.floor((now - entry.at) / 60_000)))
            : `${at ? timeOf(iso(at.start)) : t("rem.tomorrow")} · ${minutes(entry.est)}`}
        </span>
      </div>
    );
  };

  const slotGroup = (slot: Slot, index: number) => {
    const rows = queue.filter(entry => entry.kind !== "ask" && placed[entry.id]?.slot === slot.key);
    const length = Math.round((slot.end - slot.start) / 60_000);
    const usedMin = Math.round(used[slot.key] / 60_000);
    const full = usedMin / length > 0.9;
    const after = meetings.find(meeting => meeting.id === slot.after);
    const name =
      index === 0 && slot.start <= now
        ? t("today.slotNow")
        : after
          ? t("today.slotAfter", { title: after.title })
          : t("today.slotLater");
    return (
      <div key={`slot:${slot.key}`}>
        <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1 min-w-0">
          <span className="min-w-0 truncate">
            <Caps>{name}</Caps>
          </span>
          <span className="text-[11px] text-tertiary tabular-nums whitespace-nowrap">
            {timeOf(iso(slot.start))}–{timeOf(iso(slot.end))}
          </span>
          <span className="flex-1" />
          <span className="w-9 flex-none h-1 rounded-sm bg-fill-2 overflow-hidden">
            <span
              className={`block h-full ${full ? "bg-soon" : "bg-accent"}`}
              style={{ width: `${Math.min(100, Math.round((usedMin / length) * 100))}%` }}
            />
          </span>
          <span className={`flex-none text-[11px] tabular-nums ${full ? "text-soon" : "text-tertiary"}`}>
            {usedMin}/{length}′
          </span>
        </div>
        {rows.length ? (
          rows.map(row)
        ) : (
          <div className="mx-2.5 mb-1 px-2.5 py-1.5 rounded-[7px] border border-dashed border-separator-strong text-xs text-tertiary">
            {t("today.free")}
          </div>
        )}
      </div>
    );
  };

  const meetingRow = (meeting: Meeting) => {
    const start = Date.parse(meeting.start);
    const end = Date.parse(meeting.end);
    const live = start <= now && now < end;
    const prep = queue.find(entry => entry.id === `prep:${meeting.id}`);
    const sub = live
      ? t("wait.meetingNow")
      : prep && placed[prep.id]
        ? t("today.prepAt", { time: timeOf(iso(placed[prep.id].start)) })
        : meeting.location || `${timeOf(meeting.start)}–${timeOf(meeting.end)}`;
    return (
      <div
        key={`meet:${meeting.id}`}
        onClick={() => openMeeting(meeting.id)}
        className={`flex items-center gap-2.5 min-h-10 px-2.5 py-1 my-1 rounded-lg shadow-[inset_3px_0_0_var(--color-accent)] ${live || joinable(meeting.join) ? "bg-accent-soft" : "bg-fill"} ${model.meetingItems[meeting.id] ? "cursor-pointer" : ""}`}
      >
        <span className="text-[11px] font-semibold tabular-nums w-9.5">{timeOf(meeting.start)}</span>
        <span className="flex-1 min-w-0 flex flex-col leading-tight">
          <span className="font-semibold truncate">{meeting.title || t("wait.meetingUntitled")}</span>
          <span className={`text-[11px] truncate ${live ? "text-late" : "text-secondary"}`}>{sub}</span>
        </span>
        {joinable(meeting.join) && start - now < 15 * 60_000 ? (
          <button
            className="btn btn-primary h-6! px-2.25! rounded-md! text-[11px]! cursor-pointer"
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
  const parts: [number, ReactNode][] = [
    ...slots.map((slot, i): [number, ReactNode] => [slot.start, slotGroup(slot, i)]),
    ...meetings
      .filter(meeting => Date.parse(meeting.end) > now)
      .map((meeting): [number, ReactNode] => [Date.parse(meeting.start) - 0.5, meetingRow(meeting)]),
  ];
  parts.sort((a, b) => a[0] - b[0]);
  const later = queue.filter(entry => entry.kind !== "ask" && tomorrow.includes(entry.id));
  // an agent waiting on a decision sits on top of the list, above the meetings and the slots
  const asks = queue.filter(entry => entry.kind === "ask");
  return (
    <div className="min-h-0 overflow-y-auto border-r border-separator px-2 pt-1 pb-4">
      <RecordingBar />
      {asks.length ? (
        <div className="mb-1">
          <div className="px-2.5 pt-2.5 pb-1">
            <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-late">
              {t("today.needsYou")} {asks.length}
            </span>
          </div>
          {asks.map(row)}
        </div>
      ) : null}
      {parts.map(([, node]) => node)}
      {later.length ? (
        <div>
          <div className="px-2.5 pt-2.5 pb-1">
            <Caps>{t("rem.tomorrow")}</Caps>
          </div>
          {later.map(row)}
        </div>
      ) : null}
      {snoozed.length ? (
        <div>
          <div className="px-2.5 pt-2.5 pb-1">
            <Caps>
              {t("today.snoozed")} {snoozed.length}
            </Caps>
          </div>
          {snoozed.map(item => (
            <div key={item.id} className="flex items-center gap-2.5 h-9 px-2.5 text-secondary">
              <Icon name={KIND_ICON[item.kind]} className="glyph size-3.5 flex-none" />
              <span className="flex-1 min-w-0 truncate">{item.title}</span>
              <span className="text-[11px] text-tertiary tabular-nums whitespace-nowrap">
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
          <div className="px-2.5 pt-2.5 pb-1">
            <Caps>
              {t("today.doneToday")} {done.length}
            </Caps>
          </div>
          {done.map(item => (
            <div key={item.id} className="flex items-center gap-2.5 h-9 px-2.5 text-secondary">
              <StatusDot status="done" />
              {item.kind ? <Icon name={KIND_ICON[item.kind]} className="glyph size-3.5 flex-none" /> : null}
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
