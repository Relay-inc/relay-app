/** Settings › Voice: three ways to dictate, each switched on with its own shortcut (in the composer; from any app into a
 *  new conversation; from any app pasted where the cursor is), the speech model and language, and meetings. */
export type VoiceMode = "both" | "hold" | "tap"; // both: held records until release, tapped until the next tap
export type VoiceCfg = {
  on?: boolean; // dictation in the composer, on unless false
  shortcut?: string; // its shortcut, only while Relay is in front
  chatOn?: boolean; // the shortcut works in any app and starts a new conversation with what was said, off unless true
  chatShortcut?: string;
  pasteOn?: boolean; // the shortcut works in any app and pastes there (src-tauri/src/anywhere.rs), off unless true
  pasteShortcut?: string;
  model?: string;
  language?: string;
  mode?: VoiceMode;
  meetingModel?: string; // "" or unset: the dictation model
  keepAudio?: boolean; // a recorded meeting's audio goes into the vault, on unless false
  summarize?: boolean; // a recorded meeting starts the conversation that writes its note, on unless false
};
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
/** Each way's shortcut until one is set. ⌃Space is left out: macOS switches the input source with it. */
export const DEFAULT_SHORTCUTS = {
  shortcut: "alt+Space",
  chatShortcut: "alt+shift+Space",
  pasteShortcut: "ctrl+alt+Space",
} as const;
export type ShortcutKey = keyof typeof DEFAULT_SHORTCUTS;
const MODS = ["ctrl", "alt", "shift", "meta"] as const;
const SYMBOLS: Record<(typeof MODS)[number], string> = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" };
const valid = (id: string | undefined): id is string => !!id && /^((ctrl|alt|shift|meta)\+)*[A-Za-z0-9]+$/.test(id);

/** The voice settings with their defaults filled in. */
export const voiceOf = (cfg: VoiceCfg | undefined) => ({
  on: cfg?.on !== false,
  shortcut: valid(cfg?.shortcut) ? cfg!.shortcut! : DEFAULT_SHORTCUTS.shortcut,
  chatOn: cfg?.chatOn === true,
  chatShortcut: valid(cfg?.chatShortcut) ? cfg!.chatShortcut! : DEFAULT_SHORTCUTS.chatShortcut,
  pasteOn: cfg?.pasteOn === true,
  pasteShortcut: valid(cfg?.pasteShortcut) ? cfg!.pasteShortcut! : DEFAULT_SHORTCUTS.pasteShortcut,
  model: cfg?.model || DEFAULT_MODEL,
  language: cfg?.language || "auto",
  mode: cfg?.mode || "both",
  meetingModel: cfg?.meetingModel || "",
  keepAudio: cfg?.keepAudio !== false,
  summarize: cfg?.summarize !== false,
});

/** A shortcut as the Mac writes it: ⌃⌥⇧⌘ in that order, then the key ("KeyD" as D, "Digit1" as 1). */
export function shortcutLabel(id: string) {
  const parts = id.split("+");
  const code = parts.pop() ?? "";
  const key = code.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=\d$)/, "");
  return (
    MODS.filter(mod => parts.includes(mod))
      .map(mod => SYMBOLS[mod])
      .join("") + key
  );
}
/** The shortcut a key press makes, or null while only modifiers are down or none is (a plain letter would type).
 *  Function keys may go alone. */
export function shortcutOf(e: Pick<KeyboardEvent, "code" | "altKey" | "shiftKey" | "ctrlKey" | "metaKey">) {
  if (/^(Shift|Alt|Control|Meta|OS|CapsLock|Fn)/.test(e.code) || !/^[A-Za-z0-9]+$/.test(e.code)) return null;
  const mods = MODS.filter(mod => e[`${mod}Key`]);
  if (!mods.length && !/^F\d{1,2}$/.test(e.code)) return null;
  return [...mods, e.code].join("+");
}

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
  "whisper-turbo": "Whisper Large v3 Turbo",
  "moonshine-base": "Moonshine Base",
};
