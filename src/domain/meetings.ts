/** A meeting from the calendar feeds (src-tauri/src/calendar.rs): timed, someone else invited, not declined. */
export type Meeting = {
  id: string; // uid@start, one per occurrence
  feed: string; // the calendar it came from
  title: string;
  start: string; // RFC 3339
  end: string;
  location: string;
  join: string; // the Meet/Zoom/Teams link, or ""
  organizer: string;
  people: { name: string; email: string }[];
};

const MIN = 60_000;
/** Under Waiting from half an hour before the start until 10 minutes after it. */
export const SOON = 30 * MIN;
export const LATE = 10 * MIN;
/** The banner, once per meeting. */
export const BANNER = 5 * MIN;

export const soon = (list: Meeting[], now: number) =>
  list.filter(meeting => {
    const start = Date.parse(meeting.start);
    return start - now <= SOON && now - start <= LATE;
  });
/** The meetings whose banner is due now and has not gone out yet. */
export const bannerDue = (list: Meeting[], now: number, sent: Set<string>) =>
  list.filter(meeting => {
    const left = Date.parse(meeting.start) - now;
    return left > 0 && left <= BANNER && !sent.has(meeting.id);
  });
/** Whole minutes to the start, rounded up; 0 once it started. */
export const minutesLeft = (meeting: Meeting, now: number) =>
  Math.max(0, Math.ceil((Date.parse(meeting.start) - now) / MIN));
