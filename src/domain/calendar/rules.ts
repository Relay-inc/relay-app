import type { Chat, Item } from "../conversations/types";
import type { Meeting } from "./types";
import { fill, prompts, untrusted, untrustedNote } from "../../shared/prompts.ts";
import { shapeIn, wordsFor } from "./briefing.ts";

// The timing of the meetings under Waiting and their banner, and the prompts of a conversation about one. The clock
// is an argument (`now`, epoch ms), so the rules hold at any moment. Times are instants (RFC 3339 with an offset): the
// backend already turned each event's time zone into one, and skipped all-day events.
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
export const bannerDue = (list: Meeting[], now: number, sent: ReadonlySet<string>) =>
  list.filter(meeting => {
    const left = Date.parse(meeting.start) - now;
    return left > 0 && left <= BANNER && !sent.has(meeting.id);
  });
/** Whole minutes to the start, rounded up; 0 once it started. */
export const minutesLeft = (meeting: Meeting, now: number) =>
  Math.max(0, Math.ceil((Date.parse(meeting.start) - now) / MIN));

// ---------- Join
const HOSTS = ["meet.google.com", "zoom.us", "teams.microsoft.com", "teams.live.com"];
/** Whether a link goes to a meeting service: https, its host exactly one of them (or a zoom.us subdomain), no user,
 *  password or port. The invite's author writes the link, so a host's name in the path or query is no match. The
 *  backend applies the same rule (meeting_link in src-tauri/src/calendar.rs); this one is checked again on Join. */
export function joinable(link: string) {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  const { protocol, hostname, username, password, port } = url;
  if (protocol !== "https:" || username || password || port) return false;
  return HOSTS.includes(hostname) || hostname.endsWith(".zoom.us");
}

// ---------- a conversation about a meeting: a meeting note in the vault, or a briefing before it
export type MeetingChat = "note" | "prep";
/** A recorded meeting's files, as vault paths (src-tauri/src/meeting.rs): the audio is null when it was not kept. */
export type Recording = { audio: string | null; transcript: string; seconds: number; language?: string | null };
const PROMPTS: Record<MeetingChat, string> = {
  note: prompts.meetings.note,
  prep: prompts.meetings.prep,
};
// the quotes around invite text stay closed: a « or » inside it is dropped
const quoted = (text: string) => `«${text.replace(/[«»]/g, "")}»`;
/** The meeting's day as YYYY-MM-DD in `timeZone` (undefined: the machine's), so a meeting just after midnight is on
 *  the next day. */
export const meetingDay = (iso: string, timeZone?: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone });

/** The first message of a conversation about a meeting. The title, the place and the names come from the invite, so
 *  from whoever sent it: the prompt marks them as untrusted (and the conversation is marked like one about a mail). `time` formats an instant as the clock time the user reads. */
export function meetingPrompt(
  meeting: Meeting,
  how: MeetingChat,
  time: (iso: string) => string,
  timeZone?: string,
  prep: { language: string; code: string; existing: string } = { language: "", code: "", existing: "" },
) {
  const people = meeting.people.map(person => (person.name ? `${person.name} <${person.email}>` : person.email));
  const details = [
    `Titel: ${meeting.title}`,
    `Wanneer: ${meetingDay(meeting.start, timeZone)} ${time(meeting.start)}–${time(meeting.end)}`,
    `Id: ${meeting.id}`,
    meeting.location && `Locatie: ${meeting.location}`,
    meeting.organizer && `Organisator: ${meeting.organizer}`,
    people.length && `Deelnemers: ${people.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  const note = quoted(meetingNoteName(meeting, timeZone));
  // the prep asks for the briefing's fixed shape in the meeting's language, and keeps what a briefing already has of
  // the user's (their points, the steps they ticked): handed over as data, the same way as the invite
  const ask =
    how === "prep"
      ? fill(prompts.meetings.prep, {
          note,
          language: prep.language || "Nederlands",
          shape: shapeIn(prep.code),
          existing: prep.existing
            ? `\nEr staat al een briefing. Neem mijn items onder ${wordsFor(prep.code).heading.points} ongewijzigd over, ook de afgevinkte, en laat de stappen onder ${wordsFor(prep.code).heading.since} die al afgevinkt zijn afgevinkt (<briefing> hieronder).\n`
            : "",
        })
      : fill(PROMPTS[how], { note });
  const tags = how === "prep" && prep.existing ? ["meeting", "briefing"] : ["meeting"];
  return [
    ask,
    untrustedNote("nl", tags),
    untrusted("meeting", details),
    how === "prep" && prep.existing ? untrusted("briefing", prep.existing) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- the briefing before a meeting: under `## Briefing` in the meeting's note, named after its day and title
/** The meeting note's name, as the vault names them: `YYYY-MM-DD Title`, without what a file name cannot hold. The
 *  prompts name it, so Today finds the note the conversation made. */
export const meetingNoteName = (meeting: Meeting, timeZone?: string) =>
  `${meetingDay(meeting.start, timeZone)} ${meeting.title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()}`;
/** A frontmatter key's value in a note (one-line scalar, quotes off); null without frontmatter or key. */
const frontValue = (text: string, key: string) => {
  const head = /^---\n([\s\S]*?)\n---(\n|$)/.exec(text)?.[1];
  const value = head?.match(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, "m"))?.[1];
  return value === undefined ? null : value.replace(/^(["'])(.*)\1$/, "$2");
};
/** The note's `event:`, the id of the calendar event it belongs to. */
export const eventOf = (text: string) => frontValue(text, "event") || null;
/** The note with `event: "<id>"` added to its frontmatter when it has none, the rest as it was. */
export function withEvent(text: string, id: string) {
  const head = /^---\n([\s\S]*?)\n---(\n|$)/.exec(text);
  if (!head || /^event:/m.test(head[1])) return text;
  const end = 4 + head[1].length;
  return `${text.slice(0, end)}\nevent: ${JSON.stringify(id)}${text.slice(end)}`;
}
/** The note with `language:` set to `code` in its frontmatter (added when it has none), or taken out for "". Only the
 *  frontmatter changes. */
export function withLanguage(text: string, code: string) {
  const head = /^---\n([\s\S]*?)\n---(\n|$)/.exec(text);
  if (!head) return text;
  const lines = head[1].split("\n");
  const at = lines.findIndex(line => /^language:/.test(line));
  const line = code ? `language: ${code}` : null;
  if (at >= 0) lines.splice(at, 1, ...(line ? [line] : []));
  else if (line) lines.push(line);
  return `---\n${lines.join("\n")}\n---${text.slice(head[0].length - head[2].length)}`;
}
/** The language a meeting is transcribed in: the note's `language:`, else Settings' unless that is auto, else none (the
 *  recorder then listens for it). */
export const meetingLanguage = (note: string | null, voice: string) =>
  (note && frontValue(note, "language")) || (voice && voice !== "auto" ? voice : undefined);
/** How far a meeting is, derived from its note and whether it is being recorded (nothing is stored). */
export type MeetingStage = "planned" | "briefed" | "live" | "wrapped";
export function meetingStage(note: string | null, recording: boolean): MeetingStage {
  if (recording) return "live";
  if (note && /^## Summary[ \t]*$/m.test(note)) return "wrapped";
  return note && briefingIn(note) ? "briefed" : "planned";
}
const BRIEFING = /^## Briefing[ \t]*$/m;
/** Where the briefing section's body starts and ends in a note; null without one. */
function briefingSpan(text: string) {
  const heading = BRIEFING.exec(text);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const next = /^#{1,2} /m.exec(text.slice(start));
  return { start, end: next ? start + next.index : text.length };
}
/** The briefing in a meeting note; null when it has none (yet). */
export function briefingIn(text: string) {
  const span = briefingSpan(text);
  return span ? text.slice(span.start, span.end).trim() : null;
}
/** The note with its briefing replaced by `body`, the rest as it was. */
export function withBriefing(text: string, body: string) {
  const span = briefingSpan(text);
  if (!span) return text;
  return `${text.slice(0, span.start)}\n${body.trim()}\n\n${text.slice(span.end).replace(/^\n+/, "")}`.replace(
    /\n+$/,
    "\n",
  );
}
/** The conversation a meeting's briefing was asked in, the latest one when it was asked again. */
export const prepChatOf = (chats: Record<string, Chat>, meetingId: string) =>
  Object.values(chats)
    .filter(chat => chat.meeting === meetingId)
    .sort((a, b) => b.at - a.at)[0]?.key ?? null;
/** The briefing itself: the last answer of the first turn (the prompt the button sent), not what was asked after it. */
export function briefingText(items: Item[] | undefined) {
  const turns = (items || []).flatMap((item, i) => (item.kind === "me" ? [i] : []));
  if (!turns.length) return "";
  const firstTurn = items!.slice(turns[0], turns[1]);
  return [...firstTurn].reverse().find(item => item.kind === "ai")?.text ?? "";
}
