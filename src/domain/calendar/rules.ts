import type { Chat, Item } from "../conversations/types";
import type { Meeting } from "./types";
import { fill, prompts, untrusted, untrustedNote } from "../../shared/prompts.ts";

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
export type MeetingChat = "note" | "prep" | "transcript";
/** A recorded meeting's files, as vault paths (src-tauri/src/meeting.rs): the audio is null when it was not kept. */
export type Recording = { audio: string | null; transcript: string; seconds: number };
const PROMPTS: Record<Exclude<MeetingChat, "transcript">, string> = {
  note: prompts.meetings.note,
  prep: prompts.meetings.prep,
};
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
  recording?: Recording,
) {
  const people = meeting.people.map(person => (person.name ? `${person.name} <${person.email}>` : person.email));
  const details = [
    `Titel: ${meeting.title}`,
    `Wanneer: ${meetingDay(meeting.start, timeZone)} ${time(meeting.start)}–${time(meeting.end)}`,
    meeting.location && `Locatie: ${meeting.location}`,
    meeting.organizer && `Organisator: ${meeting.organizer}`,
    people.length && `Deelnemers: ${people.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  const ask = how === "transcript" && recording ? transcriptPrompt(recording) : PROMPTS[how as keyof typeof PROMPTS];
  return `${ask}\n\n${untrustedNote("nl", ["meeting"])}\n${untrusted("meeting", details)}`;
}

/** The ask after a recording: the note around its files, then the summary. What people said is text of third parties,
 *  like the invite, so the transcript is marked untrusted too. */
const transcriptPrompt = (recording: Recording) =>
  [
    "Deze meeting is opgenomen en op deze Mac uitgeschreven.",
    `Transcriptie: \`${recording.transcript}\``,
    recording.audio && `Audio: \`${recording.audio}\``,
    fill(prompts.meetings.transcript, {
      embed: recording.audio ? "Zet de audio erin als embed en link de transcriptie. " : "Link de transcriptie. ",
    }),
  ]
    .filter(Boolean)
    .join("\n");

// ---------- the briefing before a meeting
/** The conversation that holds a meeting's briefing, the latest one when it was asked again. */
export const briefingOf = (chats: Record<string, Chat>, meetingId: string) =>
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
