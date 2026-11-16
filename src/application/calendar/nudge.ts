import { nudgeDue, started } from "../../domain/calendar/rules";
import { onRecordNudgeAnswer, recordNudge } from "../../infrastructure/backend";
import { isPrimary } from "../../infrastructure/window";
import { calendarOn, timeOf } from "./calendar";
import { startRecording, useRecordingStore } from "./recording";
import { useCalendarStore } from "./store";

// The record nudge (src-tauri/src/notify.rs): from a meeting's start until its end, while nothing records, a window over
// every app asks to record it. It stays until Record or Skip; a recording started any other way puts it away and
// answers every meeting in progress then. Answers last for this run of the app. From the main window only, which
// keeps the recording.
const answered = new Set<string>();
let shown = "";

/** Every 30 seconds with the calendar's tick, and whenever the recording changes. */
export function nudgeTick() {
  if (!isPrimary()) return;
  const now = Date.now();
  const list = calendarOn() ? useCalendarStore.getState().list : [];
  const recording = useRecordingStore.getState().phase !== "idle";
  if (recording) for (const meeting of started(list, now)) answered.add(meeting.id);
  const due = recording ? null : nudgeDue(list, now, answered);
  if ((due?.id ?? "") === shown) return;
  shown = due?.id ?? "";
  void recordNudge(due && { id: due.id, title: due.title.slice(0, 160), time: timeOf(due.start) });
}

export async function listenToNudge() {
  if (!isPrimary()) return;
  useRecordingStore.subscribe(nudgeTick);
  await onRecordNudgeAnswer(({ id, record }) => {
    answered.add(id);
    if (record) void startRecording(id);
    nudgeTick();
  });
}
