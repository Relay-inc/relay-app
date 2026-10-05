import { t } from "../../shared/i18n";
import type { Meeting } from "../../domain/calendar/types";
import { voiceOf } from "../../domain/settings/voice";
import { meetingRecordCancel, meetingRecordStart, meetingRecordStop } from "../../infrastructure/backend";
import { settings } from "../settings/settings";
import { makeStore } from "../make-store";
import { toast } from "../navigation/navigation";
import { chatAbout } from "./calendar";
import { useCalendarStore } from "./store";

// Recording a meeting from its card in Waiting for you (src-tauri/src/meeting.rs): the microphone and what the Mac
// plays, then on Stop the audio and transcript in the vault and, unless switched off in Settings › Voice, a
// conversation that makes the meeting note and summarises it. One recording at a time; it keeps the meeting it is
// about, since a long meeting leaves the list of soon ones before it ends.
type RecordingState = {
  meeting: Meeting | null;
  phase: "idle" | "recording" | "saving";
  secs: number;
  me: number;
  others: number;
  system: boolean; // the Mac's audio is in it
  heard: boolean; // the Mac's track was ever above silence: macOS gives silence, not an error, without the permission
  why: string; // why it is not
  progress: number;
  error: string;
};
export const useRecordingStore = makeStore<RecordingState>(() => ({
  meeting: null,
  phase: "idle",
  secs: 0,
  me: 0,
  others: 0,
  system: false,
  heard: false,
  why: "",
  progress: 0,
  error: "",
}));
const set = (patch: Partial<RecordingState>) => useRecordingStore.setState(patch);
const rec = () => useRecordingStore.getState();

export async function startRecording(id: string) {
  const meeting = useCalendarStore.getState().list.find(x => x.id === id);
  if (!meeting || rec().phase !== "idle") return;
  set({ meeting, phase: "recording", secs: 0, me: 0, others: 0, heard: false, progress: 0, error: "" });
  try {
    const { system, why } = await meetingRecordStart(({ secs, me = 0, others = 0 }) =>
      set({ secs, me, others, heard: rec().heard || others > 0 }),
    );
    set({ system, why: why ?? "" });
  } catch (e) {
    set({ phase: "idle", error: String(e) });
  }
}

export async function stopRecording() {
  const { meeting, phase } = rec();
  if (!meeting || phase !== "recording") return;
  set({ phase: "saving", progress: 0 });
  try {
    const recording = await meetingRecordStop(
      meeting.title || t("wait.meetingUntitled"),
      t("rec.me"),
      t("rec.others"),
      progress => set({ progress }),
    );
    set({ phase: "idle", meeting: null });
    if (voiceOf(settings().voice).summarize) await chatAbout(meeting, "transcript", recording);
    else toast(t("rec.saved", { path: recording.transcript }));
  } catch (e) {
    // the backend kept the recording and says where in the error
    set({ phase: "idle", error: e === "model" ? t("rec.noModel") : String(e) });
  }
}

export async function cancelRecording() {
  if (rec().phase !== "recording") return;
  await meetingRecordCancel().catch(() => {});
  set({ phase: "idle", meeting: null });
}
export const dismissRecordingError = () => set({ error: "" });
