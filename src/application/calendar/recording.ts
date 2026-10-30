import { t } from "../../shared/i18n";
import type { Meeting } from "../../domain/calendar/types";
import { voiceOf } from "../../domain/settings/voice";
import {
  meetingKept,
  meetingRecordCancel,
  meetingRecordRetry,
  meetingRecordStart,
  meetingRecordStop,
} from "../../infrastructure/backend";
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
  title: string; // what the bar calls it: the meeting's, or for a kept recording after a restart its start time
  phase: "idle" | "recording" | "saving";
  secs: number;
  me: number;
  others: number;
  system: boolean; // the Mac's audio is in it
  heard: boolean; // the Mac's track was ever above silence: macOS gives silence, not an error, without the permission
  why: string; // why it is not
  progress: number;
  error: string;
  retry: string; // the kept recording (its folder) the error came after, so it can be tried again
  kept: string[]; // the recordings a failure kept, newest first: still there after a restart
};
export const useRecordingStore = makeStore<RecordingState>(() => ({
  meeting: null,
  title: "",
  phase: "idle",
  secs: 0,
  me: 0,
  others: 0,
  system: false,
  heard: false,
  why: "",
  progress: 0,
  error: "",
  retry: "",
  kept: [],
}));
const set = (patch: Partial<RecordingState>) => useRecordingStore.setState(patch);
const rec = () => useRecordingStore.getState();

export async function startRecording(id: string) {
  const meeting = useCalendarStore.getState().list.find(x => x.id === id);
  if (!meeting || rec().phase !== "idle") return;
  set({ meeting, phase: "recording", secs: 0, me: 0, others: 0, heard: false, progress: 0, error: "", retry: "" });
  try {
    const { system, why } = await meetingRecordStart(({ secs, me = 0, others = 0 }) =>
      set({ secs, me, others, heard: rec().heard || others > 0 }),
    );
    set({ system, why: why ?? "" });
  } catch (e) {
    // nothing recorded yet: a missing model is caught before the microphone opens
    set({ phase: "idle", meeting: null, error: e === "model" ? t("rec.noModelStart") : String(e) });
  }
}

export async function stopRecording() {
  if (rec().phase === "recording") await save(meetingRecordStop);
}

/** The recordings that were kept, for the bar to offer when the app starts (the failure that kept them is long gone). */
export async function loadKept() {
  set({ kept: await meetingKept().catch(() => []) });
}

export const hideKept = () => set({ kept: [] });

/** When a kept recording started, from its folder's name (20261029-152600). */
export const keptStart = (folder: string) => {
  const [, y, mo, d, h, mi] = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)/.exec(folder) ?? [];
  return new Date(+y, +mo - 1, +d, +h, +mi);
};

/** Transcribes a recording a failed stop kept (default: the one that just failed), once more. */
export async function retryRecording(folder = rec().retry) {
  if (rec().phase === "idle" && folder) await save(meetingRecordRetry.bind(null, folder), folder);
}

// `folder`: a retry, which after a restart has no meeting to name it
async function save(write: typeof meetingRecordStop, folder = "") {
  const { meeting } = rec();
  if (!meeting && !folder) return;
  set({
    phase: "saving",
    title: meeting?.title || (folder ? keptStart(folder).toLocaleString() : t("wait.meetingUntitled")),
    progress: 0,
    error: "",
    retry: "",
  });
  try {
    const recording = await write(meeting?.title || t("wait.meetingUntitled"), t("rec.me"), t("rec.others"), progress =>
      set({ progress }),
    );
    set({ phase: "idle", meeting: null });
    loadKept();
    if (meeting && voiceOf(settings().voice).summarize) await chatAbout(meeting, "transcript", recording);
    else toast(t("rec.saved", { path: recording.transcript }));
  } catch (e) {
    // the backend kept the recording and says where after the reason: the newest one, unless it was a retry
    await loadKept();
    set({
      phase: "idle",
      retry: folder || rec().kept[0] || "",
      error: String(e).startsWith("model") ? t("rec.noModel") : String(e),
    });
  }
}

export async function cancelRecording() {
  if (rec().phase !== "recording") return;
  await meetingRecordCancel().catch(() => {});
  set({ phase: "idle", meeting: null });
}
export const dismissRecordingError = () => set({ error: "", retry: "", meeting: null });
