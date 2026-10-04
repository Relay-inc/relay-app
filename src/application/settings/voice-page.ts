import type { Settings } from "../../domain/settings/types";
import type { SpeechModelInfo, VoiceCfg } from "../../domain/settings/voice";
import { dictationDelete, dictationDownload, dictationModels } from "../../infrastructure/backend";
import { makeStore } from "../make-store";
import { useSettingsStore } from "./store";
import { save } from "./window";

// Settings › Voice: dictation on or off, the speech model (downloaded here, or removed), its language, and the
// shortcut with how it records. The models and their downloads are this page's own store; the choices are settings.
type VoicePageState = { models: SpeechModelInfo[]; progress: Record<string, number>; errors: Record<string, string> };
export const useVoicePageStore = makeStore<VoicePageState>(() => ({ models: [], progress: {}, errors: {} }));
const set = useVoicePageStore.setState;
const current = (): Settings => useSettingsStore.getState().settings;

export async function loadModels() {
  const models = await dictationModels();
  set(draft => {
    draft.models = models;
  });
}
/** One voice setting changed, the others kept. */
export const saveVoice = (patch: VoiceCfg) => save({ ...current(), voice: { ...current().voice, ...patch } });

export async function downloadModel(id: string) {
  set(draft => {
    draft.progress[id] = 0;
    delete draft.errors[id];
  });
  try {
    await dictationDownload(id, done =>
      set(draft => {
        draft.progress[id] = done;
      }),
    );
  } catch (e) {
    set(draft => {
      draft.errors[id] = String(e);
    });
  }
  set(draft => {
    delete draft.progress[id];
  });
  await loadModels();
}
/** Picking a model that is not on this Mac yet downloads it. */
export async function pickModel(id: string) {
  await saveVoice({ model: id });
  const model = useVoicePageStore.getState().models.find(m => m.id === id);
  if (model && !model.installed && !model.downloading) await downloadModel(id);
}
export async function removeModel(id: string) {
  try {
    await dictationDelete(id);
  } catch (e) {
    set(draft => {
      draft.errors[id] = String(e);
    });
  }
  await loadModels();
}
