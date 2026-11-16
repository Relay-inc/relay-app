import {
  answerRecordNudge,
  onRecordNudge,
  recordNudge,
  recordNudgeNow,
  type Nudge,
} from "../../infrastructure/backend";
import { makeStore } from "../make-store";

// The record nudge's own window (nudge.html, src-tauri/src/notify.rs): the meeting it shows, and Record or Skip, which
// go to the main window (./nudge.ts). The card goes away at once; the main window confirms by hiding the window.
export const useNudgeStore = makeStore<{ meeting: Nudge | null }>(() => ({ meeting: null }));

export async function listenToNudgeWindow() {
  const now = await recordNudgeNow();
  if (now) useNudgeStore.setState({ meeting: now });
  await onRecordNudge(meeting => useNudgeStore.setState({ meeting }));
}
export function answerNudge(record: boolean) {
  const meeting = useNudgeStore.getState().meeting;
  if (!meeting) return;
  void answerRecordNudge(meeting.id, record);
  void recordNudge(null);
}
