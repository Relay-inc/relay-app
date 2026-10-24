import { useSettingsStore } from "../../application/settings/store";
import { keyLabel, type CommandId } from "../../domain/settings/shortcuts";

/** A command's key as Settings › Shortcuts has it (⌘,), for a tooltip; follows a change. */
export const useKeyLabel = (id: CommandId) => useSettingsStore(s => keyLabel(s.settings, id));
