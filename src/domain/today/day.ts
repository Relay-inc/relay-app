import type { Meeting } from "../calendar/types";
import type { MeetingStage } from "../calendar/rules";
import { eventOf, joinable, meetingStage } from "../calendar/rules.ts";
import { notesIn } from "../calendar/meeting-view.ts";
import { transcriptIn } from "../calendar/wrapup.ts";
import { followedUp } from "../calendar/followup.ts";
import { DAY, MIN, startOfDay } from "./kinds/common.ts";

// The day around the meetings (the design's day strip, now card and wrap-ups owed): where each meeting sits on the
// hour scale, how much of the working day is free, what the clock says about the next meeting, and which ended
// meetings still wait for their summary. Times are epoch ms, `now` an argument.

const HOUR = 60 * MIN;
/** The working day, in hours: the strip's scale and where free time is counted. */
export const WORK_FROM = 8;
export const WORK_TO = 18;
/** An ended meeting waits for its wrap-up for this many days. */
export const OWED_DAYS = 3;

export type Timed = { id: string; start: number; end: number };
export const timed = (meeting: Meeting): Timed => ({
  id: meeting.id,
  start: Date.parse(meeting.start),
  end: Date.parse(meeting.end),
});

/** The strip's hours: 08:00 to 18:00, widened to whole hours when a meeting falls outside (and cut to today). */
export function scale(meetings: Timed[], now: number) {
  const day = startOfDay(now);
  let from = WORK_FROM;
  let to = WORK_TO;
  for (const m of meetings) {
    from = Math.min(from, Math.floor((Math.max(m.start, day) - day) / HOUR));
    to = Math.max(to, Math.ceil((Math.min(m.end, day + DAY) - day) / HOUR));
  }
  return { from, to: Math.min(24, to) };
}
/** Where a time sits on the scale, 0 to 100 (percent of the strip's width). */
export const pct = (at: number, hours: { from: number; to: number }, now: number) =>
  Math.min(100, Math.max(0, ((at - startOfDay(now)) / HOUR - hours.from) / (hours.to - hours.from)) * 100);

/** The free gaps of the working day: between the meetings, from `now` once it is inside the day. */
export function freeGaps(meetings: Timed[], now: number) {
  const day = startOfDay(now);
  const open = day + WORK_FROM * HOUR;
  const close = day + WORK_TO * HOUR;
  let cursor = Math.min(close, Math.max(open, now));
  const gaps: { start: number; end: number }[] = [];
  for (const m of [...meetings].sort((a, b) => a.start - b.start)) {
    if (m.start > cursor) gaps.push({ start: cursor, end: Math.min(m.start, close) });
    cursor = Math.max(cursor, m.end);
    if (cursor >= close) break;
  }
  if (cursor < close) gaps.push({ start: cursor, end: close });
  return gaps.filter(gap => gap.end - gap.start >= MIN);
}
/** Minutes free in all, and the largest gap (null when none). */
export function freeTime(meetings: Timed[], now: number) {
  const gaps = freeGaps(meetings, now);
  const largest = gaps.reduce<(typeof gaps)[number] | null>(
    (best, g) => (!best || g.end - g.start > best.end - best.start ? g : best),
    null,
  );
  return { minutes: Math.round(gaps.reduce((sum, g) => sum + (g.end - g.start), 0) / MIN), largest };
}
/** "3h 10", "45 min", "2h": the design's short length. */
export const lengthOf = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${String(m).padStart(2, "0")}` : `${h}h`) : `${m} min`;
};

/** Meetings that overlap go side by side in lanes (0 is the top one); `lanes` is how many the day needs. */
export function lanes(meetings: Timed[]) {
  const ends: number[] = [];
  const lane: Record<string, number> = {};
  for (const m of [...meetings].sort((a, b) => a.start - b.start || a.end - b.end)) {
    let at = ends.findIndex(end => end <= m.start);
    if (at < 0) at = ends.length;
    ends[at] = m.end;
    lane[m.id] = at;
  }
  return { lane, lanes: Math.max(1, ends.length) };
}

// ---------- what a meeting's note says
/** What Today needs of a meeting's note: how far the meeting is (without the recording, which is the clock's), whether
 *  there is something to wrap up (notes typed, a recording linked), and whether a follow-up was drafted. */
export type Digest = { stage: MeetingStage; content: boolean; followed: boolean };
export const digestOf = (text: string | null): Digest => ({
  stage: meetingStage(text, false),
  content: !!text && (!!notesIn(text)?.trim() || !!transcriptIn(text)),
  followed: !!text && followedUp(text),
});
/** A meeting's note as an owed wrap-up of an earlier day: `day` is its date (YYYY-MM-DD), from its file name. Null when
 *  it is no meeting note, has its summary, or has nothing to wrap up. */
export function owedFrom(path: string, text: string, day: string): Owed | null {
  if (!/^type:[ \t]*Meeting[ \t]*$/m.test(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "")) return null;
  const digest = digestOf(text);
  if (digest.stage === "wrapped" || !digest.content) return null;
  const title =
    /^# (.+)$/m.exec(text)?.[1]?.trim() ||
    path
      .replace(/^.*\//, "")
      .replace(/\.md$/, "")
      .replace(/^\d{4}-\d\d-\d\d /, "");
  const [y, m, d] = day.split("-").map(Number);
  return { id: eventOf(text) ?? `note:${path}`, title, start: new Date(y, m - 1, d, 12).toISOString() };
}

// ---------- the glyph of a meeting on the strip
export type Glyph = { stage: "planned" | "briefed" | "live" | "wrapped"; followed: boolean; dashed: boolean };
/** ○ planned, ◐ briefed, ● live, ✓ wrapped, and ✉ besides when it was followed up; dashed when it is over and not wrapped. */
export const glyphOf = (stage: MeetingStage, followed: boolean, ended: boolean): Glyph => ({
  stage,
  followed: followed && stage === "wrapped",
  dashed: ended && stage !== "wrapped" && stage !== "live",
});

// ---------- the now card
export type NowCard =
  | { kind: "none" }
  | { kind: "next"; meeting: Meeting; minutes: number; stage: MeetingStage }
  | { kind: "soon"; meeting: Meeting; minutes: number; running: boolean; stage: MeetingStage; joinFirst: boolean }
  | { kind: "live"; meeting: Meeting; minutes: number };
/** The card above the queue, from the clock: the recording one (live), a meeting that runs or starts within 30
 *  minutes (expanded, with Join when it has a link), the next one later today (a line), else nothing. `stages` is each
 *  meeting's stage, "live" for the one being recorded. */
export function nowCard(meetings: Meeting[], stages: Record<string, MeetingStage>, now: number): NowCard {
  const live = meetings.find(m => stages[m.id] === "live");
  if (live)
    return { kind: "live", meeting: live, minutes: Math.max(0, Math.floor((now - Date.parse(live.start)) / MIN)) };
  const sorted = [...meetings].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const stageOf = (m: Meeting): MeetingStage => stages[m.id] ?? "planned";
  const running = sorted.find(m => Date.parse(m.start) <= now && now < Date.parse(m.end));
  if (running)
    return {
      kind: "soon",
      meeting: running,
      minutes: 0,
      running: true,
      stage: stageOf(running),
      joinFirst: joinable(running.join),
    };
  const next = sorted.find(m => Date.parse(m.start) > now);
  if (!next) return { kind: "none" };
  const minutes = Math.ceil((Date.parse(next.start) - now) / MIN);
  return minutes <= 30
    ? { kind: "soon", meeting: next, minutes, running: false, stage: stageOf(next), joinFirst: joinable(next.join) }
    : { kind: "next", meeting: next, minutes, stage: stageOf(next) };
}

// ---------- wrap-ups owed
/** A meeting note that has something to wrap up (notes typed or a recording) and no summary. */
export type Owed = { id: string; title: string; start: string };
/** The meetings that ended in the last 3 days without their summary, oldest first: the ones of today from the calendar
 *  (with what their note says), the earlier ones from their notes. Meetings still running or to come are not owed. */
export function wrapUps(
  today: Meeting[],
  notes: Record<string, { stage: MeetingStage; content: boolean }>,
  earlier: Owed[],
  now: number,
): Owed[] {
  const since = startOfDay(now) - (OWED_DAYS - 1) * DAY;
  const todays = today.flatMap((m): Owed[] => {
    const note = notes[m.id];
    return Date.parse(m.end) <= now && note?.content && note.stage !== "wrapped" && note.stage !== "live"
      ? [{ id: m.id, title: m.title, start: m.start }]
      : [];
  });
  const seen = new Set(todays.map(o => o.id));
  return [
    ...earlier.filter(o => Date.parse(o.start) >= since && Date.parse(o.start) < startOfDay(now) && !seen.has(o.id)),
    ...todays,
  ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
