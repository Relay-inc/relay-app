/** Settings › Voice: dictation on or off, the speech model and language, and when it records. */
export type VoiceMode = "both" | "hold" | "tap"; // both: held records until release, tapped until the next tap
export type VoiceCfg = { on?: boolean; model?: string; language?: string; mode?: VoiceMode; shortcut?: string };
/** A speech model as `dictation_models` lists it: `langs` the languages it knows, `auto` whether it hears which. */
export type SpeechModelInfo = {
  id: string;
  mb: number;
  langs: string[];
  auto: boolean;
  installed: boolean;
  downloading: boolean;
};

export const DEFAULT_MODEL = "parakeet-v3";
/** The shortcuts to pick from, with their label. ⌃Space is left out: macOS switches the input source with it. */
export const VOICE_SHORTCUTS = [
  ["alt+Space", "⌥Space"],
  ["alt+shift+Space", "⇧⌥Space"],
  ["ctrl+alt+Space", "⌃⌥Space"],
  ["meta+shift+KeyD", "⇧⌘D"],
] as const;
export const DEFAULT_SHORTCUT = VOICE_SHORTCUTS[0][0];

/** The voice settings with their defaults filled in. */
export const voiceOf = (cfg: VoiceCfg | undefined) => ({
  on: cfg?.on !== false,
  model: cfg?.model || DEFAULT_MODEL,
  language: cfg?.language || "auto",
  mode: cfg?.mode || "both",
  shortcut: VOICE_SHORTCUTS.some(([id]) => id === cfg?.shortcut) ? cfg!.shortcut! : DEFAULT_SHORTCUT,
});
export const shortcutLabel = (id: string) => VOICE_SHORTCUTS.find(([key]) => key === id)?.[1] ?? id;

type Keys = Pick<KeyboardEvent, "code" | "altKey" | "shiftKey" | "ctrlKey" | "metaKey">;
/** Whether a key event is the shortcut: its key (by `code`, so ⌥ does not change it) with exactly its modifiers. */
export function isShortcut(e: Keys, shortcut: string) {
  const parts = shortcut.split("+");
  const code = parts.pop();
  const has = (mod: string) => parts.includes(mod);
  return (
    e.code === code &&
    e.altKey === has("alt") &&
    e.shiftKey === has("shift") &&
    e.ctrlKey === has("ctrl") &&
    e.metaKey === has("meta")
  );
}
/** The key the shortcut ends in, whose release ends a held recording (the modifiers may come up first). */
export const shortcutCode = (shortcut: string) => shortcut.split("+").pop()!;
/** The models' names (their makers', not translated), in the order Settings › Voice lists them. */
export const MODEL_NAMES: Record<string, string> = {
  "parakeet-v3": "Parakeet V3",
  "parakeet-v2": "Parakeet V2",
  "canary-1b-v2": "Canary 1B v2",
  cohere: "Cohere Transcribe",
  "moonshine-base": "Moonshine Base",
};
