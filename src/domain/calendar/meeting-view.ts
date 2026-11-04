import type { Meeting } from "./types";
import { isPointsHeading } from "./briefing.ts";
import { meetingDay, type MeetingStage } from "./rules.ts";

// The Meeting view's rules: which step it is on, the typed notes (`## Notes` of the meeting note, one timestamped line
// each, a marker after the time for an action, decision or question), and the note a meeting gets when it has none.

// ---------- the steps
export type Step = "briefing" | "live" | "wrapup";
export const STEPS: readonly Step[] = ["briefing", "live", "wrapup"];
/** The step a meeting is on: Live while it is recorded, Wrap-up once it is wrapped or `wrapping` (recorded and being
 *  written out, a draft on its way, or over without its summary), else the briefing. */
export const stepOf = (stage: MeetingStage, wrapping: boolean): Step =>
  stage === "live" ? "live" : stage === "wrapped" || wrapping ? "wrapup" : "briefing";

/** Who a transcript line is from: "Others" is named when exactly one other person is invited (a 1:1). */
export const othersLabel = (people: Meeting["people"], others: string) =>
  people.length === 1 ? people[0].name || people[0].email : others;

// ---------- the notes: `- [09:38] ! text` (! action, = decision, ? question)
export type Marker = "action" | "decision" | "question";
export const SIGN: Record<Marker, string> = { action: "!", decision: "=", question: "?" };
export const MARKER_OF: Record<string, Marker> = { "!": "action", "=": "decision", "?": "question" };
/** A notes line: the dash and time (1), the time (2), the marker (3) and the text (4). */
export const LINE = /^(\s*- \[(\d\d:\d\d)\] )(?:([!=?])(?: |$))?(.*)$/;
const EMPTY = /^\s*- \[\d\d:\d\d\] ?[!=?]? ?$/;

/** The time of a notes line: HH:MM on the machine's clock, 24 hours whatever the locale. */
export const hhmm = (at: Date) =>
  `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
/** The start of a new notes line: a list dash and the time. */
export const stamp = (time: string) => `- [${time}] `;
/** Whether Enter on this line starts another notes line (a list item) rather than a plain new line. */
export const isNotesLine = (line: string) => /^\s*- /.test(line);
/** Whether the line holds nothing but its time (and marker): Enter on it leaves the list. */
export const isEmptyStamp = (line: string) => EMPTY.test(line);

/** What toggling `kind` does to a line, as the replacement of its characters from `from` to `to`: the marker goes in
 *  after the time, a different one replaces it, the same one comes out. A line without a time gets one. */
export function markLine(line: string, kind: Marker, time: string) {
  const sign = SIGN[kind];
  const m = LINE.exec(line);
  if (!m) return { from: 0, to: /^\s*(?:- )?/.exec(line)![0].length, insert: `${stamp(time)}${sign} ` };
  const from = m[1].length;
  const to = from + (m[3] ? (line[from + 1] === " " ? 2 : 1) : 0); // the marker and the space after it
  return { from, to, insert: m[3] === sign ? "" : `${sign} ` };
}

/** A line of the notes: the time, its marker if it has one, and the text after them. */
export type NoteLine = { time: string; marker: Marker | null; text: string };
/** The timestamped lines of the notes, in order (lines without a time are left out). */
export function parseNotes(notes: string): NoteLine[] {
  return notes.split("\n").flatMap(line => {
    const m = LINE.exec(line);
    return m ? [{ time: m[2], marker: m[3] ? MARKER_OF[m[3]] : null, text: m[4].trim() }] : [];
  });
}
/** A quoted transcript line, as a notes line: `- [09:44] > Tom: "text"` (no name: `> "text"`). */
export const quoteLine = (time: string, speaker: string, text: string) => {
  const who = speaker
    .replace(/[:"\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${stamp(time)}> ${who ? `${who}: ` : ""}"${text.trim().replace(/\s+/g, " ")}"`;
};
/** The start of a quote in a line's text: `> `, the speaker (1) when there is one, then the opening quote. */
export const QUOTE = /^> (?:([^:"]{1,40}): )?"/;
/** The notes as they are written to the note: the lines that hold only a time are left out. */
export const cleanNotes = (notes: string) =>
  notes
    .split("\n")
    .filter(line => !EMPTY.test(line))
    .join("\n")
    .trim();

// ---------- the `## Notes` section of the note
const NOTES = /^## Notes[ \t]*$/m;
function notesSpan(text: string) {
  const heading = NOTES.exec(text);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const next = /^#{1,2} /m.exec(text.slice(start));
  return { start, end: next ? start + next.index : text.length };
}
/** The notes in a meeting note; null when it has no `## Notes`. */
export function notesIn(text: string) {
  const span = notesSpan(text);
  return span ? text.slice(span.start, span.end).trim() : null;
}
/** The note with its notes replaced by `body`, the rest as it was. A note without the section gets one before
 *  `## Summary`, else at the end. */
export function withNotes(text: string, body: string) {
  const span = notesSpan(text);
  const section = `## Notes\n${body.trim()}\n\n`;
  if (span)
    return `${text.slice(0, span.start)}\n${body.trim()}\n\n${text.slice(span.end).replace(/^\n+/, "")}`.replace(
      /\n+$/,
      "\n",
    );
  const summary = /^## Summary[ \t]*$/m.exec(text);
  if (summary) return `${text.slice(0, summary.index)}${section}${text.slice(summary.index)}`;
  return `${text.replace(/\n*$/, "\n\n")}${section}`.replace(/\n+$/, "\n");
}

// ---------- the note a meeting gets when it has none: the vault's meeting-note shape
const ordinal = (n: number) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
};
/** "Friday October 2nd, 2026" for 2026-10-02, the text of a meeting note's date link. */
export function longDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const part = (opts: Intl.DateTimeFormatOptions) => date.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  return `${part({ weekday: "long" })} ${part({ month: "long" })} ${ordinal(d)}, ${y}`;
}
/** A new meeting note: frontmatter (`event:` its match key, `with:` the invited by name), the title, the day linked,
 *  and an empty `## Notes`. `today` is the creation date (YYYY-MM-DD). */
export function newMeetingNote(
  meeting: Meeting,
  title: string,
  today: string,
  timeZone?: string,
  project?: string | null,
) {
  const day = meetingDay(meeting.start, timeZone);
  const names = meeting.people.map(person => JSON.stringify(person.name || person.email));
  return [
    "---",
    "type: Meeting",
    `event: ${JSON.stringify(meeting.id)}`,
    ...(project ? [`about: ${JSON.stringify(`[[${project}]]`)}`] : []),
    names.length ? `with:\n${names.map(name => `  - ${name}`).join("\n")}` : "with:",
    `created: ${today}`,
    "---",
    "",
    `# ${title.replace(/\s+/g, " ").trim()}`,
    `[[${day}|${longDay(day)}]]`,
    "",
    "## Notes",
    "",
  ].join("\n");
}

// ---------- the tasks (`- [ ]`) in the briefing: My points are the ones under that heading
export type Task = { n: number; done: boolean; text: string; section: string };
const TASK = /^(\s*[-*+] \[)([ xX])(\] )(.*)$/;
/** The tasks of a markdown text in order, `n` counting from 0, each with the heading it stands under. */
export function tasksIn(markdown: string): Task[] {
  let section = "";
  return markdown
    .split("\n")
    .flatMap(line => {
      const heading = /^#{1,6}\s+(.*?)\s*#*$/.exec(line) ?? /^\*\*(.+?)\*\*:?$/.exec(line);
      if (heading) section = heading[1];
      const m = TASK.exec(line);
      return m ? [{ n: 0, done: m[2] !== " ", text: m[4], section }] : [];
    })
    .map((task, n) => ({ ...task, n }));
}
/** The tasks under a "My points" heading. */
export const pointsIn = (briefing: string) => tasksIn(briefing).filter(task => isPointsHeading(task.section));
/** The markdown with its `n`th task ticked or unticked, the rest as it was. */
export function toggleTask(markdown: string, n: number) {
  let at = -1;
  return markdown
    .split("\n")
    .map(line => {
      const m = TASK.exec(line);
      return m && ++at === n ? `${m[1]}${m[2] === " " ? "x" : " "}${m[3]}${m[4]}` : line;
    })
    .join("\n");
}

/** The meeting service a join link goes to, for "Back to Meet". */
export const serviceOf = (link: string) =>
  link.includes("zoom.us") ? "Zoom" : link.includes("teams.") ? "Teams" : "Meet";
