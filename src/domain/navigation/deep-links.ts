import type { Meeting } from "../calendar/types.ts";

/** What a relay:// link asks for. `ask` only fills Cmd-K: a link from outside (any web page can open one) never sends
 *  a prompt by itself, the user presses Enter. `meeting` (from Keel) likewise only offers its action. */
export type MeetingLinkAct = "prep" | "record" | "note";
export type DeepLink =
  | { kind: "ask"; text: string }
  | { kind: "open"; query: string }
  | { kind: "meeting"; act: MeetingLinkAct; meeting: Meeting };
const ACTS: MeetingLinkAct[] = ["prep", "record", "note"];

/** relay://ask opens Cmd-K, relay://ask?q=… with the question typed, relay://open?q=… the best matching project. */
export function parseLink(link: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "relay:") return null;
  const query = url.searchParams.get("q")?.trim() || "";
  if (url.host === "ask") return { kind: "ask", text: query };
  if (url.host === "open") return { kind: "open", query };
  if (url.host === "meeting") return meetingLink(url.searchParams);
  return null;
}

/** relay://meeting?do=prep|record|note&uid=…&start=…&end=… (unix seconds) and title, location, join, organizer and
 *  `with` per guest ("Name <mail>"): the meeting as the calendar feeds give it (id uid@start, src-tauri/src/calendar.rs),
 *  so Relay's own copy is found when it has one. */
function meetingLink(p: URLSearchParams): DeepLink | null {
  const act = p.get("do") as MeetingLinkAct;
  const uid = p.get("uid")?.trim();
  const start = Number(p.get("start"));
  const end = Number(p.get("end")) || start + 3600;
  if (!ACTS.includes(act) || !uid || !start) return null;
  const iso = (secs: number) => new Date(secs * 1000).toISOString();
  const people = p.getAll("with").map(guest => {
    const [, name = "", email = guest] = /^(.*?)\s*<([^>]+)>$/.exec(guest) ?? [];
    return { name: name.trim(), email: email.trim() };
  });
  return {
    kind: "meeting",
    act,
    meeting: {
      id: `${uid}@${start}`,
      feed: "link",
      title: p.get("title")?.trim() ?? "",
      start: iso(start),
      end: iso(end),
      location: p.get("location") ?? "",
      join: p.get("join") ?? "",
      organizer: p.get("organizer") ?? "",
      people,
    },
  };
}

/** The launch links still to handle: a webview reload boots again with the same launch link, which was handled. */
export const unhandled = (links: string[], handled: string[]) => links.filter(link => !handled.includes(link));
