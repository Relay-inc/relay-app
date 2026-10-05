import type { Settings } from "../../domain/settings/types";
import type { SpeechModelInfo, VoiceCfg } from "../../domain/settings/voice";
import {
  dictationAccess,
  dictationAskAccess,
  dictationDelete,
  dictationDownload,
  dictationModels,
  dictationPauseShortcuts,
} from "../../infrastructure/backend";
import { shortcutLabel, voiceOf, type ShortcutKey } from "../../domain/settings/voice";
import { t } from "../../shared/i18n";
import { makeStore } from "../make-store";
import { useSettingsStore } from "./store";
import { save } from "./window";

// Settings › Voice: the three ways to dictate with their shortcuts, the speech model (downloaded here, or removed), its
// language, and meetings. The models and their downloads are this page's own store; the choices are settings.
type VoicePageState = {
  models: SpeechModelInfo[];
  progress: Record<string, number>;
  errors: Record<string, string>;
  access: boolean | null; // Accessibility for pasting into other apps, null until asked
  shortcutError: Partial<Record<ShortcutKey, string>>; // why a shortcut was not taken
};
export const useVoicePageStore = makeStore<VoicePageState>(() => ({
  models: [],
  progress: {},
  errors: {},
  access: null,
  shortcutError: {},
}));
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

/** Whether Relay may paste into other apps; asked again while the page shows, since it is switched in System Settings. */
export async function loadAccess() {
  const access = await dictationAccess().catch(() => false);
  set(draft => {
    draft.access = access;
  });
}
export async function askAccess() {
  await dictationAskAccess().catch(() => false);
  await loadAccess();
}

const KEYS: ShortcutKey[] = ["shortcut", "chatShortcut", "pasteShortcut"];
/** One way's shortcut, unless another way already has it: then it stays and the field says why. */
export async function saveShortcut(key: ShortcutKey, shortcut: string) {
  const voice = voiceOf(current().voice);
  const taken = KEYS.some(other => other !== key && voice[other] === shortcut);
  set(draft => {
    draft.shortcutError[key] = taken ? t("voice.shortcutTaken", { key: shortcutLabel(shortcut) }) : undefined;
  });
  if (!taken) await saveVoice({ [key]: shortcut });
}
export const pauseShortcuts = (paused: boolean) => dictationPauseShortcuts(paused).catch(() => {});
