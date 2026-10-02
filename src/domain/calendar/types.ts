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
/** What `calendar_meetings` answers: the meetings of the next hours, and per calendar that failed why. */
export type Meetings = { meetings: Meeting[]; errors: string[] };
