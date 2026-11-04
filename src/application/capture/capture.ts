import * as backend from "../../infrastructure/backend";
import { applyTheme } from "../../infrastructure/window";
import { makeStore } from "../make-store";
import { initLanguage } from "../settings/settings";
import { cancelDictation, startDictation, stopDictation, useDictationStore } from "../conversations/dictation";

// Quick capture (src-tauri/src/anywhere.rs opens the window): one text field, a mic, Save to Inbox. The text stays
// when the window is put away with Esc, and goes once it is saved.
export const useCaptureStore = makeStore<{ text: string; error: string; saving: boolean; focus: number }>(() => ({
  text: "",
  error: "",
  saving: false,
  focus: 0,
}));
const set = useCaptureStore.setState;

export const type = (text: string) =>
  set(draft => {
    draft.text = text;
  });
/** The window was brought forward: ask the field for the focus. */
export const opened = () =>
  set(draft => {
    draft.focus++;
  });

/** The window's start: language, theme and accent as the main window has them, and the focus whenever the window is
 *  brought forward again. */
export async function initCapture() {
  const saved = await backend.getSettings();
  await initLanguage();
  applyTheme(saved.theme, saved.accent);
  await backend.onCaptureOpen(opened);
  opened();
}

/** Writes the note and puts the window away. Blank text is not saved. */
export async function save() {
  const { text, saving } = useCaptureStore.getState();
  if (!text.trim() || saving) return;
  set(draft => {
    draft.saving = true;
    draft.error = "";
  });
  try {
    await backend.quickCaptureSave(text);
    set(draft => {
      draft.text = "";
    });
    await backend.quickCaptureHide();
  } catch (e) {
    set(draft => {
      draft.error = String(e);
    });
  } finally {
    set(draft => {
      draft.saving = false;
    });
  }
}
/** Esc: the window goes, what was typed stays, a recording stops. */
export function close() {
  cancelDictation();
  return backend.quickCaptureHide();
}

/** The mic: starts the existing dictation, and a second click puts what was said at the end of the text. */
export async function dictate() {
  if (useDictationStore.getState().phase !== "recording") return startDictation();
  const said = await stopDictation();
  if (!said) return;
  const text = useCaptureStore.getState().text;
  type(`${text}${text && !/\s$/.test(text) ? " " : ""}${said}`);
}
