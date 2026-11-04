import type { Meeting } from "./types";
import { sectionSpan } from "./wrapup.ts";
import { fill, prompts, untrusted, untrustedNote } from "../../shared/prompts.ts";

// The follow-up mail after a meeting: asked from the accepted summary, addressed to everyone invited, saved as a draft
// (Relay never sends). The note remembers it: `followed-up: true` and a line under **Next Steps**.

export type Addr = { name: string | null; email: string };
export type MailDraft = { subject: string; body: string };

/** The draft in a model's answer (the JSON object in it); null without a body. A missing subject is `fallback`. */
export function parseMail(answer: string, fallback: string): MailDraft | null {
  const json = answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const o = raw as { subject?: unknown; body?: unknown } | null;
  if (!o || typeof o.body !== "string" || !o.body.trim()) return null;
  const subject = typeof o.subject === "string" ? o.subject.replace(/\s+/g, " ").trim() : "";
  return { subject: subject || fallback, body: o.body.replace(/\r\n/g, "\n").trim() };
}

/** Who it goes to: every attendee, once each (by address), without me (`mine`: my own addresses). */
export function recipients(meeting: Meeting, mine: string[]): Addr[] {
  const own = new Set(mine.map(email => email.toLowerCase()));
  const seen = new Set<string>();
  return meeting.people.flatMap(person => {
    const key = person.email.trim().toLowerCase();
    if (!key || own.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [{ name: person.name || null, email: person.email.trim() }];
  });
}
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
/** An address typed into Cc: "name@x.be" or "Name <name@x.be>"; null when it is none. */
export function addrOf(text: string): Addr | null {
  const m = /^(.*?)\s*<([^>]+)>$/.exec(text.trim());
  const email = (m ? m[2] : text).trim();
  return EMAIL.test(email) ? { name: m?.[1].replace(/^"|"$/g, "").trim() || null, email } : null;
}

const RECAP: Record<string, string> = { nl: "Recap", fr: "Récap", de: "Recap", en: "Recap" };
/** "Recap <title> – <d MMM>" in the meeting's language (`language`: a code, "" for English). */
export function defaultSubject(meeting: Meeting, language: string, timeZone?: string) {
  const day = new Intl.DateTimeFormat(!language || language === "en" ? "en-GB" : language, {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(meeting.start));
  return `${RECAP[language] ?? "Recap"} ${meeting.title.replace(/\s+/g, " ").trim()} – ${day}`;
}

/** What goes to the model: the prompt and the summary (as the note has it) and the meeting, marked as text of third
 *  parties. `language` is the language's name, `name` the sender's first name when the app knows it. */
export function followupAsk(
  meeting: Meeting,
  summary: string,
  subject: string,
  language: string,
  name: string,
  day: string,
) {
  const people = meeting.people.map(p => (p.name ? `${p.name} <${p.email}>` : p.email)).join(", ");
  const system = fill(prompts.meetings.followup, {
    language: language || "die van het verslag",
    subject,
    signoff: name ? ` met mijn voornaam (${name})` : " zonder naam eronder",
    untrusted: untrustedNote("nl", ["summary", "meeting"]),
  });
  const text = [
    untrusted("summary", summary),
    untrusted(
      "meeting",
      [`Titel: ${meeting.title}`, `Datum: ${day}`, people && `Deelnemers: ${people}`].filter(Boolean).join("\n"),
    ),
  ].join("\n\n");
  return { system, text };
}

// ---------- into the note
const HEAD = /^---\n([\s\S]*?)\n---(\n|$)/;
/** Whether the note says a follow-up mail was drafted (`followed-up: true`). */
export const followedUp = (text: string) => /^followed-up:[ \t]*true[ \t]*$/m.test(HEAD.exec(text)?.[1] ?? "");
/** The note with `followed-up: true` in its frontmatter (replacing a `false`), the rest as it was. */
export function withFollowedUp(text: string) {
  const head = HEAD.exec(text);
  if (!head) return text;
  const lines = head[1].split("\n");
  const at = lines.findIndex(line => /^followed-up:/.test(line));
  if (at >= 0) lines[at] = "followed-up: true";
  else lines.push("followed-up: true");
  return `---\n${lines.join("\n")}\n---${text.slice(head[0].length - head[2].length)}`;
}

/** The note with one line under **Next Steps** in its summary: `- Follow-up mail drafted: "subject"` (the heading is added
 *  when the summary has none; the line is not added twice). Null when the note has no summary. */
export function withFollowupLine(text: string, subject: string, nextSteps = "Next Steps") {
  const s = sectionSpan(text, "Summary");
  if (!s) return null;
  const line = `- Follow-up mail drafted: "${subject.replace(/\s+/g, " ").trim()}"`;
  const body = text.slice(s.from, s.end).replace(/\n+$/, "");
  if (body.split("\n").includes(line)) return text;
  const heading = `**${nextSteps}**`;
  const next = body.includes(heading) ? `${body}\n${line}` : `${body}\n\n${heading}\n${line}`;
  return `${text.slice(0, s.from)}${next}\n${s.end < text.length ? "\n" : ""}${text.slice(s.end).replace(/^\n+/, "")}`;
}
