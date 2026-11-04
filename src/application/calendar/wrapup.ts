import { WRITE_MAX } from "@relay/agent-core";
import { t } from "../../shared/i18n";
import { briefingIn, meetingLanguage, meetingNoteName, withEvent, type Recording } from "../../domain/calendar/rules";
import { notesIn } from "../../domain/calendar/meeting-view";
import {
  builtFrom,
  parseDraft,
  summaryIn,
  hasDecision,
  summarySection,
  transcriptIn,
  withDecision,
  withRecording,
  withSummary,
  wrapupAsk,
  type Route,
} from "../../domain/calendar/wrapup";
import type { Meeting } from "../../domain/calendar/types";
import { voiceOf } from "../../domain/settings/voice";
import * as backend from "../../infrastructure/backend";
import { provider } from "../../shared/plugins";
import { urlOk } from "../../shared/markdown";
import { makeStore } from "../make-store";
import { ctxOf } from "../board/ctx";
import { settings } from "../settings/settings";
import { toast } from "../navigation/navigation";
import { addReminder } from "../reminders/reminders";
import { meetingNote, meetingProjectOf } from "./calendar";
import { noteFor, remember } from "./meeting-view";

// The wrap-up of a meeting: a draft written by one run of the agent (backend.aiWrite: no tools, no conversation) from the
// notes, the transcript and the briefing; what the user makes of it (edits the summary and the steps, picks where each
// step goes); and on Accept the summary into the note, the steps to their reminder or ticket. Nothing leaves the screen
// before Accept, and a decision goes to its project's note only when it is clicked.

export type StepState = {
  text: string;
  route: Route;
  due: string; // YYYY-MM-DD, what a reminder is for
  on: boolean; // goes in the note (and to its route)
  status: "idle" | "busy" | "done" | "failed";
  err: string;
  result: string; // what became of it once accepted: "Reminder · Thu 1 Oct", "Ticket created · #12", "Kept as text"
  url: string; // where the ticket is, when the tracker says
};
export type DecisionState = { text: string; status: "idle" | "busy" | "done" | "failed" };
export type Wrap = {
  phase: "generating" | "ready" | "error" | "saving" | "saved";
  summary: string;
  steps: StepState[];
  decisions: DecisionState[];
  canDecide: boolean; // the meeting's project note has a decisions section to add them to
  error: string;
  lines: number; // what it was built from: lines of the notes and minutes of the transcript
  minutes: number;
};
type State = { wraps: Record<string, Wrap> };
export const useWrapupStore = makeStore<State>(() => ({ wraps: {} }));
const set = useWrapupStore.setState;
const wrap = (id: string) => useWrapupStore.getState().wraps[id];
const change = (id: string, recipe: (w: Wrap) => void) =>
  set(draft => {
    if (draft.wraps[id]) recipe(draft.wraps[id]);
  });

const today = () => new Date().toLocaleDateString("sv-SE");
const tomorrow = () => new Date(Date.now() + 864e5).toLocaleDateString("sv-SE");
const VAULT_NEXT = "Next Steps"; // the vault's heading for them, whatever the app's language

/** The recording's files into the meeting note (`## Recording`), so the transcript and audio are linked whether or not
 *  a summary is ever accepted, and a later draft can read the transcript again. */
export async function attachRecording(meeting: Meeting, recording: Recording) {
  const note = await noteFor(meeting);
  const text = withEvent(withRecording(note.text, recording), meeting.id);
  if (text === note.text) return;
  const { hash } = await backend.writeNote(note.path, text, note.hash, false);
  remember(meeting, { path: note.path, text, hash });
}

// a transcript as the vault holds it, without its frontmatter
const bodyOf = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
/** Writes the draft: from the notes, the transcript (the one just recorded, or the one the note links) and the
 *  briefing. Starts again when called again (Regenerate, Retry). */
export async function generateDraft(meeting: Meeting, recording?: Recording | null) {
  const id = meeting.id;
  set(draft => {
    draft.wraps[id] = {
      phase: "generating",
      summary: "",
      steps: [],
      decisions: [],
      canDecide: false,
      error: "",
      lines: 0,
      minutes: 0,
    };
  });
  try {
    const note = await meetingNote(meeting).catch(() => null);
    const notes = note ? (notesIn(note.text) ?? "") : "";
    const path = recording?.transcript ?? (note ? transcriptIn(note.text) : null);
    const transcript = path
      ? bodyOf(String(((await backend.readNote(path).catch(() => null)) as { text?: string } | null)?.text ?? ""))
      : "";
    if (!notes.trim() && !transcript) throw new Error(t("meet.wrap.nothing"));
    const code = meetingLanguage(note?.text ?? null, voiceOf(settings().voice).language) ?? "";
    const language = code ? (new Intl.DisplayNames(["nl"], { type: "language" }).of(code) ?? code) : "";
    const { system, text } = wrapupAsk(
      meeting,
      { notes, transcript, briefing: note ? (briefingIn(note.text) ?? "") : "" },
      today(),
      language,
      WRITE_MAX,
    );
    const draft = parseDraft(await backend.aiWrite(system, text, "claude"));
    if (!draft) throw new Error(t("meet.wrap.unreadable"));
    const from = builtFrom(notes, recording?.seconds ?? 0);
    change(id, w => {
      w.phase = "ready";
      w.summary = draft.summary;
      w.steps = draft.steps.map(step => ({
        text: step.text,
        route: step.route,
        due: step.due ?? tomorrow(),
        on: true,
        status: "idle",
        err: "",
        result: "",
        url: "",
      }));
      w.decisions = draft.decisions.map(text => ({ text, status: "idle" }));
      w.lines = from.lines;
      w.canDecide = false;
      w.minutes = from.minutes || (transcript ? Math.max(1, Math.round(transcript.length / 900)) : 0);
    });
    void checkDecisions(meeting);
  } catch (error) {
    change(id, w => {
      w.phase = "error";
      w.error = error instanceof Error ? error.message : String(error);
    });
  }
}

export const editSummary = (id: string, summary: string) => change(id, w => void (w.summary = summary));
export const editStep = (id: string, i: number, patch: Partial<Pick<StepState, "text" | "route" | "due" | "on">>) =>
  change(id, w => {
    // once accepted, a failed step stays failed until it is retried (with the route it has now)
    if (w.steps[i]) Object.assign(w.steps[i], patch, w.phase === "saved" ? {} : { status: "idle", err: "" });
  });

/** The board a meeting's project is linked to, when its tracker can make a card; null with the reason otherwise. */
export function ticketBoard(meeting: Meeting) {
  const project = meetingProjectOf(meeting);
  const ref = project ? settings().boards?.[project] : undefined;
  const tracker = ref && provider(ref.provider);
  return tracker?.create && ref ? { tracker, ref } : null;
}

// one step to where it goes: a reminder, or a card on the project's board; plain text goes nowhere. What became of it.
async function route(meeting: Meeting, step: StepState) {
  if (step.route === "reminder") {
    await addReminder(step.text, step.due, meetingProjectOf(meeting), null);
    toast(t("meet.wrap.reminderMade", { text: step.text }));
    const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(
      new Date(`${step.due}T12:00:00`),
    );
    return { result: t("meet.wrap.resultReminder", { date: day }), url: "" };
  }
  if (step.route === "ticket") {
    const board = ticketBoard(meeting);
    if (!board) throw new Error(t("meet.wrap.noBoard"));
    const ctx = ctxOf(board.tracker);
    const columns = await board.tracker.columns(ctx, board.ref);
    const column = columns.find(c => c.state === "todo") ?? columns[0];
    if (!column) throw new Error(t("meet.wrap.noBoard"));
    const card = await board.tracker.create!(ctx, board.ref, {
      title: step.text,
      description: t("meet.wrap.fromMeeting", { title: meeting.title, day: today() }),
      column: column.id,
    });
    toast(t("meet.wrap.ticketMade", { text: step.text }));
    const url = await board.tracker.url(ctx, board.ref, card.id).catch(() => "");
    return {
      result: t("meet.wrap.resultTicket", {
        item: /^\d+$/.test(card.number) ? `#${card.number}` : card.number || card.title,
      }),
      url,
    };
  }
  return { result: t("meet.wrap.resultText"), url: "" };
}
const routeStep = async (meeting: Meeting, i: number) => {
  const step = wrap(meeting.id)?.steps[i];
  if (!step || !step.on || step.status === "done") return;
  change(meeting.id, w => void (w.steps[i].status = "busy"));
  try {
    const made = await route(meeting, step);
    change(meeting.id, w => {
      w.steps[i].status = "done";
      w.steps[i].result = made.result;
      w.steps[i].url = made.url;
    });
  } catch (error) {
    change(meeting.id, w => {
      w.steps[i].status = "failed";
      w.steps[i].err = String(error);
    });
  }
};
/** Where a created ticket is, in the browser (web links only). */
export const openResult = (url: string) => urlOk(url) && backend.openUrl(url);
/** A step that failed, once more. */
export const retryStep = routeStep;

/** Accept: `## Summary` with **Next Steps** into the note (the note read again right before, so what was changed
 *  elsewhere stays; a note changed in between says "changed" and nothing is written), then each step to its route. */
export async function acceptDraft(meeting: Meeting) {
  const w = wrap(meeting.id);
  if (!w || w.phase === "saving" || w.phase === "saved") return;
  change(meeting.id, d => {
    d.phase = "saving";
    d.error = "";
  });
  try {
    const note = await noteFor(meeting);
    const section = summarySection(
      w.summary,
      w.steps.filter(s => s.on && s.text.trim()).map(s => s.text.trim()),
      VAULT_NEXT,
    );
    const text = withEvent(withSummary(note.text, section), meeting.id);
    const { hash } = await backend.writeNote(note.path, text, note.hash, false);
    remember(meeting, { path: note.path, text, hash });
  } catch (error) {
    change(meeting.id, d => {
      d.phase = "ready";
      d.error = String(error);
    });
    return;
  }
  change(meeting.id, d => void (d.phase = "saved"));
  for (let i = 0; i < w.steps.length; i++) await routeStep(meeting, i);
}

// whether the meeting's project note has a decisions section: otherwise "Add to the note" is off
async function checkDecisions(meeting: Meeting) {
  const project = meetingProjectOf(meeting);
  const read = project ? ((await backend.readNote(project).catch(() => null)) as { text?: string } | null) : null;
  const text = typeof read?.text === "string" ? read.text : "";
  const ok = withDecision(text, "2000-01-01", "x", "x") !== null;
  const from = meetingNoteName(meeting);
  // the ones the note already holds (an earlier click, an earlier draft) show as added
  change(meeting.id, w => {
    w.canDecide = ok;
    for (const d of w.decisions) if (ok && hasDecision(text, d.text, from)) d.status = "done";
  });
}
/** A decision as one dated line in its project's note, on a click. */
export async function addDecision(meeting: Meeting, i: number) {
  const project = meetingProjectOf(meeting);
  const decision = wrap(meeting.id)?.decisions[i];
  if (!project || !decision || decision.status === "done") return;
  const mark = (status: DecisionState["status"]) => change(meeting.id, w => void (w.decisions[i].status = status));
  mark("busy");
  try {
    const read = (await backend.readNote(project)) as { path: string; text: string; hash: string };
    const text = withDecision(read.text, today(), decision.text, meetingNoteName(meeting));
    if (text === null) throw new Error(t("meet.wrap.noDecisions", { project }));
    if (text !== read.text) await backend.writeNote(read.path, text, read.hash, false);
    mark("done");
    toast(t("meet.wrap.decisionAdded", { project }));
  } catch (error) {
    mark("failed");
    toast(String(error instanceof Error ? error.message : error));
  }
}
/** The next steps a summary in a note ends with, for the saved state after a restart. */
export function savedSteps(noteText: string) {
  const body = summaryIn(noteText) ?? "";
  const at = body.indexOf(`**${VAULT_NEXT}**`);
  return at < 0
    ? []
    : body
        .slice(at)
        .split("\n")
        .slice(1)
        .flatMap(line => (/^\s*[-*] /.test(line) ? [line.replace(/^\s*[-*] /, "").trim()] : []));
}
/** The summary of a note without its Next Steps, for the saved state. */
export const savedSummary = (noteText: string) => {
  const body = summaryIn(noteText) ?? "";
  const at = body.indexOf(`**${VAULT_NEXT}**`);
  return (at < 0 ? body : body.slice(0, at)).trim();
};
