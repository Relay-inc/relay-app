import type { Meeting } from "./types";
import { cleanNotes, parseNotes } from "./meeting-view.ts";
import { fill, prompts, untrusted, untrustedNote } from "../../shared/prompts.ts";

// The wrap-up of a meeting: the draft a one-shot run writes from the notes, the transcript and the briefing, what of it
// goes into the note (`## Summary` with **Next Steps**), and the line a decision adds to its project's note.

// ---------- the draft
export type Route = "reminder" | "ticket" | "text";
export type DraftStep = { text: string; route: Route; due?: string };
/** What the model answers: the summary (2-3 sentences, bullets, **Topic** blocks), my next steps and the decisions. */
export type Draft = { summary: string; steps: DraftStep[]; decisions: string[] };

const DAY = /^\d{4}-\d\d-\d\d$/;
const ROUTES: Route[] = ["reminder", "ticket", "text"];
/** The draft in a model's answer: the JSON object in it (a code fence or a sentence around it is ignored). Steps keep
 *  their order; a route it does not know is `text`, a date that is no date is left out. Null when there is no summary. */
export function parseDraft(answer: string): Draft | null {
  const json = answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const o = raw as { summary_md?: unknown; next_steps?: unknown; decisions?: unknown } | null;
  if (!o || typeof o.summary_md !== "string" || !o.summary_md.trim()) return null;
  const steps = (Array.isArray(o.next_steps) ? o.next_steps : []).flatMap((step): DraftStep[] => {
    const text = typeof step?.text === "string" ? step.text.replace(/\s+/g, " ").trim() : "";
    if (!text) return [];
    const route: Route = ROUTES.includes(step.route) ? step.route : "text";
    const due =
      typeof step.due === "string" && DAY.test(step.due) && !isNaN(Date.parse(step.due)) ? step.due : undefined;
    return [{ text, route, ...(due ? { due } : {}) }];
  });
  const decisions = (Array.isArray(o.decisions) ? o.decisions : []).flatMap((d): string[] =>
    typeof d === "string" && d.trim() ? [d.replace(/\s+/g, " ").trim()] : [],
  );
  return { summary: o.summary_md.trim(), steps, decisions };
}

/** What goes to the model: the prompt and the three sources, the invite and the transcript marked as text of third
 *  parties. `today` is YYYY-MM-DD, `language` the meeting's (its name, or "" for the language of the notes). The text
 *  is at most `max` characters: the transcript, which only supports the notes, gives way (`cut` says so). */
export function wrapupAsk(
  meeting: Meeting,
  sources: { notes: string; transcript: string; briefing: string },
  today: string,
  language: string,
  max: number,
) {
  const people = meeting.people.map(p => (p.name ? `${p.name} <${p.email}>` : p.email)).join(", ");
  const system = fill(prompts.meetings.wrapup, {
    language: language || "die van de notities en de transcriptie",
    today,
    untrusted: untrustedNote("nl", ["meeting", "transcript", "briefing"]),
  });
  const fixed = [
    untrusted("meeting", [`Titel: ${meeting.title}`, people && `Deelnemers: ${people}`].filter(Boolean).join("\n")),
    `<notes>\n${sources.notes || "-"}\n</notes>`,
    sources.briefing ? untrusted("briefing", sources.briefing) : "",
  ];
  const room = Math.max(0, max - fixed.join("\n\n").length - 120);
  const cut = sources.transcript.length > room;
  const transcript = cut ? `${sources.transcript.slice(0, room)}\n[...]` : sources.transcript;
  const text = [fixed[0], fixed[1], room && transcript ? untrusted("transcript", transcript) : "", fixed[2]]
    .filter(Boolean)
    .join("\n\n");
  return { system, text, cut };
}
/** How much the draft is built from, for the line under it: the lines of the notes and the minutes of transcript. */
export const builtFrom = (notes: string, seconds: number) => ({
  lines: parseNotes(cleanNotes(notes)).length || cleanNotes(notes).split("\n").filter(Boolean).length,
  minutes: Math.round(seconds / 60),
});

// ---------- into the note
/** `## Summary` as the note has it: the summary, then **Next Steps** as plain bullets (mine only). */
export function summarySection(summary: string, steps: string[], nextSteps: string) {
  const bullets = steps.map(step => `- ${step}`).join("\n");
  return `## Summary\n${summary.trim()}${bullets ? `\n\n**${nextSteps}**\n${bullets}` : ""}`;
}
const HEADING = (name: string) => new RegExp(`^## ${name}[ \\t]*$`, "m");
function span(text: string, name: string) {
  const heading = HEADING(name).exec(text);
  if (!heading) return null;
  const next = /^#{1,2} /m.exec(text.slice(heading.index + heading[0].length));
  return { from: heading.index, end: next ? heading.index + heading[0].length + next.index : text.length };
}
/** The note with its `## Summary` replaced by `section`; one it has not got goes after `## Notes`, else before
 *  at the end. The rest is as it was. */
export function withSummary(text: string, section: string) {
  const had = span(text, "Summary");
  const at = had ?? span(text, "Notes");
  if (had)
    return `${text.slice(0, had.from)}${section}\n\n${text.slice(had.end).replace(/^\n+/, "")}`.replace(/\n+$/, "\n");
  if (at) {
    const where = span(text, "Notes") ? at.end : at.from;
    return `${text.slice(0, where).replace(/\n*$/, "\n\n")}${section}\n\n${text.slice(where).replace(/^\n+/, "")}`.replace(
      /\n+$/,
      "\n",
    );
  }
  return `${text.replace(/\n*$/, "\n\n")}${section}\n`;
}
/** The summary section's body (without its heading), or null. */
export function summaryIn(text: string) {
  const s = span(text, "Summary");
  return s
    ? text
        .slice(s.from, s.end)
        .replace(/^## Summary[ \t]*\n?/, "")
        .trim()
    : null;
}

// ---------- the recording's files: under the date line, before the first H2, as the vault's notes have them
const AUDIO = /^!\[\[.+\]\]$/;
const TRANSCRIPT = /^Transcript: \[\[(.+)\]\]$/;
/** The note with the recording's files under its H1 and date line (`![[audio]]`, `Transcript: [[transcript]]`), before
 *  the first `## ` section. A second recording adds its lines under the first; a line already there is not added again.
 *  Paths are the vault's, as the recorder gives them. */
export function withRecording(text: string, recording: { audio: string | null; transcript: string }) {
  const first = /^## /m.exec(text);
  const at = first ? first.index : text.length;
  const head = text.slice(0, at);
  const want = [
    recording.audio ? `![[${recording.audio}]]` : "",
    `Transcript: [[${recording.transcript.replace(/\.md$/, "")}]]`,
  ].filter(Boolean);
  const lines = head.split("\n");
  const add = want.filter(line => !lines.includes(line));
  if (!add.length) return text;
  const last = lines.reduce((at, line, i) => (AUDIO.test(line) || TRANSCRIPT.test(line) ? i : at), -1);
  if (last >= 0) {
    lines.splice(last + 1, 0, ...add);
    return `${lines.join("\n")}${text.slice(at)}`;
  }
  return `${head.replace(/\n*$/, "\n\n")}${add.join("\n")}\n${first ? "\n" : ""}${text.slice(at)}`;
}
/** The transcript a note links under its date line (its vault path, `.md` added; the latest recording's), or null. */
export function transcriptIn(text: string) {
  const first = /^## /m.exec(text);
  const found = text
    .slice(0, first ? first.index : text.length)
    .split("\n")
    .flatMap(line => TRANSCRIPT.exec(line)?.[1] ?? []);
  return found.length ? `${found[found.length - 1]}.md` : null;
}

// ---------- a decision into its project's note
/** Whether a decisions section already holds this decision from this meeting, whatever day it was added. */
export const hasDecision = (section: string, decision: string, from: string) => {
  const tail = `: ${decision.replace(/\s+/g, " ").trim()} ([[${from}]])`;
  return section.split("\n").some(line => /^- \d{4}-\d\d-\d\d/.test(line) && line.slice(12) === tail);
};
const DECISIONS = ["Decisions", "Beslissingen", "Décisions", "Entscheidungen"];
/** The project note with one dated line added at the end of its decisions section (`## Decisions`, or the same in
 *  Dutch, French or German); null when the note has none. `from` is the meeting note's name, linked. */
export function withDecision(text: string, day: string, decision: string, from: string) {
  for (const name of DECISIONS) {
    const s = span(text, name);
    if (!s) continue;
    const body = text.slice(s.from, s.end).replace(/\n+$/, "");
    const line = `- ${day}: ${decision.replace(/\s+/g, " ").trim()} ([[${from}]])`;
    if (hasDecision(body, decision, from)) return text;
    return `${text.slice(0, s.from)}${body}\n${line}\n${s.end < text.length ? "\n" : ""}${text.slice(s.end).replace(/^\n+/, "")}`;
  }
  return null;
}
