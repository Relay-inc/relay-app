import { dictationCancel, dictationDownload, dictationStart, dictationStop } from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { select } from "../navigation/navigation";
import { newChat } from "./chats";
import { sendMsg } from "./actions";

/** The composer's dictation (src-tauri/src/dictation.rs): `offer` asks to download the speech model first. */
export type DictationPhase = "idle" | "offer" | "downloading" | "recording" | "transcribing";
type DictationState = { phase: DictationPhase; level: number; progress: number; error: string };

export const useDictationStore = makeStore<DictationState>(() => ({ phase: "idle", level: 0, progress: 0, error: "" }));
const set = (patch: Partial<DictationState>) => useDictationStore.setState(patch);
const phase = () => useDictationStore.getState().phase;

export async function startDictation() {
  if (phase() !== "idle") return;
  set({ phase: "recording", level: 0, error: "" });
  try {
    await dictationStart(level => set({ level }));
  } catch (e) {
    set(e === "model" ? { phase: "offer" } : { phase: "idle", error: String(e) });
  }
}

/** Stops recording and resolves with what was said ("" for nothing). */
export async function stopDictation() {
  if (phase() !== "recording") return "";
  set({ phase: "transcribing", level: 0 });
  try {
    return await dictationStop();
  } catch (e) {
    set({ error: String(e) });
    return "";
  } finally {
    set({ phase: "idle" });
  }
}

export function cancelDictation() {
  if (phase() === "recording") dictationCancel();
  if (phase() === "recording" || phase() === "offer") set({ phase: "idle", level: 0 });
}

export async function downloadModel() {
  set({ phase: "downloading", progress: 0, error: "" });
  try {
    await dictationDownload(null, progress => set({ progress }));
    set({ phase: "idle" });
  } catch (e) {
    set({ phase: "offer", error: String(e) });
  }
}

export const dismissDictationError = () => set({ error: "" });

/** What was said with the new-conversation shortcut from any app: a new conversation in General, sent at once. */
export async function chatFromDictation(text: string) {
  await select(newChat(null));
  await sendMsg(text);
}
