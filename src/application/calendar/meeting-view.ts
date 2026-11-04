import { t } from "../../shared/i18n";
import { workKey } from "../../domain/navigation/keys";
import { WAIT } from "../../domain/navigation/views";
import {
  eventOf,
  meetingNoteName,
  withBriefing,
  withEvent,
  withLanguage,
  briefingIn,
  type MeetingStage,
  meetingStage,
} from "../../domain/calendar/rules";
import { cleanNotes, newMeetingNote, notesIn, toggleTask, withNotes } from "../../domain/calendar/meeting-view";
import type { Meeting } from "../../domain/calendar/types";
import * as backend from "../../infrastructure/backend";
import { select } from "../navigation/navigation";
import { useWorkspaceStore } from "../workspace/store";
import { meetingNote } from "./calendar";
import { useRecordingStore } from "./recording";
import { useCalendarStore } from "./store";

// The Meeting view (a full view, `work:meeting:<event id>`): one meeting's briefing, typed notes and live transcript.
// Its note is the vault's meeting note, made when the first thing is written to it. Every write reads the note again
// first and changes only its own section (the briefing, the notes) or the frontmatter's `language:`, so an edit made
// elsewhere in between is not lost; a note changed while writing throws "changed", nothing written.
const set = useCalendarStore.setState;
const cal = () => useCalendarStore.getState();
/** The folder the vault keeps its meeting notes in (the default vault's Calendar/, `note_by_event` looks there too). */
const FOLDER = "Calendar";

/** A meeting by its event id: the calendar's, the one being recorded (an ad-hoc one is in no calendar), or the one a
 *  link or a click opened the view on. */
export const meetingById = (id: string): Meeting | undefined =>
  cal().list.find(x => x.id === id) ?? useRecordingStore.getState().meeting ?? cal().opened[id];
const known = (id: string) => meetingById(id)?.id === id;

/** The Meeting view on a meeting, from Today, the recording bar, a link or Cmd-K. */
export function openMeetingView(meeting: Meeting) {
  set(draft => {
    draft.opened[meeting.id] = meeting;
  });
  return select(workKey("meeting", meeting.id));
}
/** The same for a meeting known by its id only (the sidebar's row). */
export async function openMeetingId(id: string) {
  const meeting = meetingById(id);
  if (meeting) await openMeetingView(meeting);
}

/** The stage of the open meeting, from its note and whether it is being recorded. */
export function stageOf(id: string): MeetingStage {
  const rec = useRecordingStore.getState();
  const { note } = cal();
  return meetingStage(note?.id === id ? note.text : null, rec.phase === "recording" && rec.meeting?.id === id);
}

// the notes as last read or written, per meeting: what an edit outside Relay is told from
const base = new Map<string, string>();
/** Reads the meeting's note into the store (null when it has none yet). `again`: a look at the note while the view is
 *  open (the recorder writes the language into it): what the notes were read as stays, so an edit made outside is
 *  still told from what is typed. */
export async function loadMeetingNote(meeting: Meeting, again = false) {
  const found = await meetingNote(meeting).catch(() => null);
  if (!known(meeting.id)) return;
  if (!again) base.set(meeting.id, found ? (notesIn(found.text) ?? "") : "");
  set(draft => {
    draft.note = found ? { id: meeting.id, ...found } : null;
    draft.noted = meeting.id;
    if (!again) draft.conflict = false;
  });
}
/** Back to Today (Esc, and the view's back button). */
export const backToToday = () => select(WAIT);

/** The meeting's note, made in the vault's meeting-note shape when it has none. */
export async function noteFor(meeting: Meeting) {
  const found = await meetingNote(meeting);
  if (found) return found;
  const root = useWorkspaceStore.getState().notes.root;
  const create = () => backend.createNote(`${root}/${FOLDER}`, meetingNoteName(meeting), false);
  const path = await create().catch(async () => {
    await backend.createNote(root, FOLDER, true).catch(() => {}); // a vault without the folder yet
    return create();
  });
  const empty = (await backend.readNote(path)) as { hash: string };
  const text = newMeetingNote(
    meeting,
    meeting.title || t("wait.meetingUntitled"),
    new Date().toLocaleDateString("sv-SE"),
  );
  const { hash } = await backend.writeNote(path, text, empty.hash, false);
  return { path, text, hash };
}
export const remember = (meeting: Meeting, note: { path: string; text: string; hash: string }) =>
  set(draft => {
    draft.note = { id: meeting.id, ...note };
    draft.noted = meeting.id;
    draft.error = "";
  });

// one write at a time: the typing's saves queue up behind each other
let queue: Promise<unknown> = Promise.resolve();
/** The typed notes into the note's `## Notes`. Where they were changed outside Relay since they were read, nothing is
 *  written and the view says so (`conflict`), unless `force` (Keep mine). */
export function saveNotes(meeting: Meeting, typed: string, force = false) {
  const run = async () => {
    set(draft => void (draft.saving = true));
    try {
      await write();
    } finally {
      set(draft => void (draft.saving = false));
    }
  };
  const write = async () => {
    const body = cleanNotes(typed);
    for (let tries = 0; tries < 2; tries++) {
      const note = await noteFor(meeting);
      const theirs = notesIn(note.text) ?? "";
      if (!force && theirs !== (base.get(meeting.id) ?? "")) return set(draft => void (draft.conflict = true));
      const text =
        theirs === body && eventOf(note.text) ? note.text : withEvent(withNotes(note.text, body), meeting.id);
      try {
        const { hash } = text === note.text ? note : await backend.writeNote(note.path, text, note.hash, false);
        base.set(meeting.id, body);
        remember(meeting, { path: note.path, text, hash });
        return set(draft => void (draft.conflict = false));
      } catch (error) {
        if (String(error) !== "changed") return set(draft => void (draft.error = String(error)));
      }
    }
    set(draft => void (draft.conflict = true)); // changed twice while writing: let the user look
  };
  return (queue = queue.then(run).catch(error => set(draft => void (draft.error = String(error)))));
}

/** The language of the meeting's transcription into its note's `language:` ("" for Auto): the frontmatter only. */
export function saveLanguage(meeting: Meeting, code: string) {
  const run = async () => {
    const note = await noteFor(meeting);
    const text = withLanguage(note.text, code);
    if (text === note.text) return remember(meeting, note);
    const { hash } = await backend.writeNote(note.path, text, note.hash, false);
    remember(meeting, { path: note.path, text, hash });
  };
  return (queue = queue.then(run).catch(error => set(draft => void (draft.error = String(error)))));
}

/** The briefing of the meeting's note replaced by `body` (or by what `body` makes of the briefing as it is now), the
 *  note read again right before; null when the note or its briefing is gone. A note changed in between throws
 *  "changed" (nothing written). */
export async function saveBriefing(meeting: Meeting, body: string | ((now: string) => string)) {
  const note = await meetingNote(meeting);
  const now = note && briefingIn(note.text);
  if (!note || now === null) return null;
  const text = withEvent(withBriefing(note.text, typeof body === "string" ? body : body(now)), meeting.id);
  const { hash } = await backend.writeNote(note.path, text, note.hash, false);
  remember(meeting, { path: note.path, text, hash });
  return { path: note.path, text, hash };
}
/** A task of the briefing ticked or unticked (the `n`th `- [ ]`): My points on the Live step, the lists of the briefing. */
export const toggleBriefingTask = (meeting: Meeting, n: number) =>
  saveBriefing(meeting, now => toggleTask(now, n)).catch(error => set(draft => void (draft.error = String(error))));
