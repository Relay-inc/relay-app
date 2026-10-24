import {
  bindingLabel,
  bindingsOf,
  PICK_ID,
  refusal,
  withBindings,
  type CommandId,
  type PickMod,
} from "../../domain/settings/shortcuts";
import { voiceOf } from "../../domain/settings/voice";
import { t, type Key } from "../../shared/i18n";
import { makeStore } from "../make-store";
import { useSettingsStore } from "./store";
import { save } from "./window";

// Settings › Shortcuts: every command's keys, changed by pressing new ones (domain/settings/shortcuts.ts). A key that
// would type, that macOS has or that another command has is refused, and the row says why.
type ShortcutsPageState = { error: Partial<Record<CommandId, string>> };
export const useShortcutsPageStore = makeStore<ShortcutsPageState>(() => ({ error: {} }));
const set = useShortcutsPageStore.setState;
const current = () => useSettingsStore.getState().settings;

/** The dictation shortcuts that are on: they count as Relay's own keys. */
const dictationKeys = () => {
  const voice = voiceOf(current().voice);
  return [voice.on && voice.shortcut, voice.chatOn && voice.chatShortcut, voice.pasteOn && voice.pasteShortcut].filter(
    (key): key is string => !!key,
  );
};

/** The command's `index`th key, unless it is refused: then the keys stay and the row says why. */
export async function saveKey(id: CommandId, index: number, binding: string) {
  const refused = refusal(current(), id, binding, dictationKeys());
  const key = bindingLabel(binding);
  const why = !refused
    ? undefined
    : refused.why === "taken"
      ? refused.by
        ? t("keys.taken", { key, name: t(`keys.${refused.by}` as Key) })
        : t("keys.takenVoice", { key })
      : t(`keys.${refused.why}`, { key });
  set(draft => {
    draft.error[id] = why;
  });
  if (refused) return;
  const keys = [...bindingsOf(current(), id)];
  keys[index] = binding;
  await save(withBindings(current(), id, keys));
}
/** The command back on its default keys. */
export async function resetKey(id: CommandId) {
  set(draft => {
    delete draft.error[id];
  });
  await save(withBindings(current(), id, null));
}
/** Every command back on its default keys (dictation keeps its own, Settings › Voice). */
export async function resetAll() {
  set(draft => {
    draft.error = {};
  });
  await save({ ...current(), shortcuts: {} });
}
/** The modifier the answers on a question take. */
export const savePick = (mod: PickMod) => save(withBindings(current(), PICK_ID, [mod]));
