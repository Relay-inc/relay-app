/** Settings › Shortcuts: every key the main window takes, each one changeable. A binding is a string: with ⌘, ⌥ or ⌃
 *  it is the physical key (`meta+KeyK`, as `voice.ts` writes them, so ⌥ does not change it); without, it is the key
 *  as typed (`e`, `#`, `Enter`, `shift+Enter`), so a letter follows the keyboard layout. `settings.shortcuts` holds
 *  only what differs from the defaults: id -> its bindings. A default may say `mod`, the command key: ⌘ (`meta`) on
 *  macOS, Ctrl on Windows. A saved binding never does, it is the keys as they were pressed. */
import { isMac } from "../../shared/platform.ts";
import type { Settings } from "./types";

/** Where a key works. A key may be in two scopes at once on purpose (Esc unticks mails before it closes anything). */
export type Scope = "app" | "chat" | "card" | "today" | "mail";
type Command = { scope: Scope; keys: readonly string[] };

export const COMMANDS = {
  "app.quickAsk": { scope: "app", keys: ["mod+KeyK", "mod+KeyO"] },
  "app.newProject": { scope: "app", keys: ["mod+KeyT"] },
  "app.newGeneral": { scope: "app", keys: ["alt+mod+KeyT"] },
  "app.reopenChat": { scope: "app", keys: ["shift+mod+KeyT"] },
  "app.newWindow": { scope: "app", keys: ["mod+KeyN"] },
  "app.closeChat": { scope: "app", keys: ["mod+KeyW"] },
  "app.settings": { scope: "app", keys: ["mod+Comma"] },
  "app.escape": { scope: "app", keys: ["Escape"] },
  "app.stop": { scope: "app", keys: ["ctrl+KeyC"] },
  // the workspaces in the footer's menu, by their place
  "app.workspace1": { scope: "app", keys: ["ctrl+Digit1"] },
  "app.workspace2": { scope: "app", keys: ["ctrl+Digit2"] },
  "app.workspace3": { scope: "app", keys: ["ctrl+Digit3"] },
  "app.workspace4": { scope: "app", keys: ["ctrl+Digit4"] },
  "app.workspace5": { scope: "app", keys: ["ctrl+Digit5"] },
  "app.workspace6": { scope: "app", keys: ["ctrl+Digit6"] },
  "app.workspace7": { scope: "app", keys: ["ctrl+Digit7"] },
  "app.workspace8": { scope: "app", keys: ["ctrl+Digit8"] },
  "app.workspace9": { scope: "app", keys: ["ctrl+Digit9"] },
  "app.sidebarTab": { scope: "app", keys: ["mod+Period"] },
  // a page back to the conversation or view it was opened from (Esc too, when nothing else takes it)
  "app.back": { scope: "app", keys: ["mod+BracketLeft"] },
  // the pages' editor shows the markdown it hides
  "app.showMarkdown": { scope: "app", keys: ["shift+mod+KeyM"] },
  // registered with the system (anywhere.rs), so it works from any app. ⌘⇧N would be Finder's New Folder and every
  // browser's private window: three modifiers keep it clear of those. On Windows Ctrl+Alt+N, the Win key is the system's
  "app.capture": { scope: "app", keys: ["ctrl+alt+mod+KeyN"] },
  "chat.send": { scope: "chat", keys: ["Enter"] },
  "chat.find": { scope: "chat", keys: ["mod+KeyF", "ctrl+KeyF"] },
  "card.confirm": { scope: "card", keys: ["Enter"] },
  "today.next": { scope: "today", keys: ["j", "ArrowDown"] },
  "today.prev": { scope: "today", keys: ["k", "ArrowUp"] },
  "today.primary": { scope: "today", keys: ["Enter"] },
  "today.secondary": { scope: "today", keys: ["Backspace"] },
  "today.done": { scope: "today", keys: ["e"] },
  "today.snooze": { scope: "today", keys: ["s"] },
  "today.later": { scope: "today", keys: ["l"] },
  "today.meeting": { scope: "today", keys: ["m"] },
  "today.doing": { scope: "today", keys: ["p"] },
  "today.reply": { scope: "today", keys: ["r"] },
  "today.replyAll": { scope: "today", keys: ["a"] },
  "today.forward": { scope: "today", keys: ["f"] },
  "today.ticket": { scope: "today", keys: ["t"] },
  "today.read": { scope: "today", keys: ["u"] },
  "today.trash": { scope: "today", keys: ["#"] },
  "mail.archive": { scope: "mail", keys: ["e"] },
  "mail.trash": { scope: "mail", keys: ["#", "Delete", "Backspace"] },
  "mail.selectAll": { scope: "mail", keys: ["mod+KeyA"] },
  "mail.unselect": { scope: "mail", keys: ["Escape"] },
} as const satisfies Record<string, Command>;
export type CommandId = keyof typeof COMMANDS;
/** The ones in the menu bar (src-tauri/src/lib.rs build_menu reads them from the settings too). */
export const MENU_COMMANDS: readonly CommandId[] = [
  "app.newProject",
  "app.newGeneral",
  "app.reopenChat",
  "app.newWindow",
  "app.closeChat",
  "app.settings",
];
/** The answers on an agent's question: 1 to 9, with this modifier ("" for none). */
export const PICK_ID = "card.pick";
export const PICK_MODS = ["", "alt", "ctrl", "meta"] as const;
export type PickMod = (typeof PICK_MODS)[number];

const MODS = ["ctrl", "alt", "shift", "meta"] as const;
const SYMBOLS: Record<(typeof MODS)[number], string> = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" };
// Windows writes them out, in this order, joined with +
const WORDS: Record<(typeof MODS)[number], string> = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Win" };
const WIN_NAMES: Record<string, string> = { Enter: "Enter", Backspace: "Backspace", Delete: "Del", Tab: "Tab" };
const NAMES: Record<string, string> = {
  Escape: "Esc",
  Enter: "↵",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  Space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};
// what macOS or the Edit and Window menus answer before Relay sees the key
const MAC_RESERVED = new Set([
  "meta+KeyC",
  "meta+KeyV",
  "meta+KeyX",
  "meta+KeyZ",
  "shift+meta+KeyZ",
  "meta+KeyA",
  "meta+KeyQ",
  "meta+KeyH",
  "alt+meta+KeyH",
  "meta+KeyM",
  "ctrl+meta+KeyF",
]);
// what Windows or a text field answers: the edit keys and closing the window. Every Win key is the system's too
const WIN_RESERVED = new Set(["ctrl+KeyC", "ctrl+KeyV", "ctrl+KeyX", "ctrl+KeyZ", "ctrl+KeyY", "ctrl+KeyA", "alt+F4"]);
/** Whether macOS, Windows or a text field answers the binding before Relay sees it. */
export const reserved = (binding: string) =>
  isMac() ? MAC_RESERVED.has(binding) : WIN_RESERVED.has(binding) || split(binding).mods.includes("meta");

type Keys = Pick<KeyboardEvent, "key" | "code" | "altKey" | "shiftKey" | "ctrlKey" | "metaKey">;
// `mod` as this platform's command key
const split = (binding: string) => {
  const own = (mods: string[]) => mods.map(mod => (mod !== "mod" ? mod : isMac() ? "meta" : "ctrl"));
  // "+" itself as a typed key
  if (binding.endsWith("+")) return { mods: own(binding.slice(0, -1).split("+").filter(Boolean)), token: "+" };
  const parts = binding.split("+");
  return { mods: own(parts.slice(0, -1)), token: parts[parts.length - 1] };
};
/** The binding with `mod` as this platform's key, its modifiers in the order a press records them. */
export function resolve(binding: string) {
  if (!/(^|\+)mod\+/.test(binding)) return binding;
  const { mods, token } = split(binding);
  return [...MODS.filter(mod => mods.includes(mod)), token].join("+");
}
/** A command's defaults on this platform (⌘F and ⌃F are one key on Windows). */
const defaultsOf = (id: CommandId): readonly string[] => [...new Set(COMMANDS[id].keys.map(resolve))];
const held = (e: Keys) => e.ctrlKey || e.altKey || e.metaKey;
const withMods = (binding: string) => /(^|\+)(ctrl|alt|meta|mod)\+/.test(binding);
const isLetter = (token: string) => /^[a-z]$/.test(token);

/** The binding a key press makes, or null while only modifiers are down. */
export function bindingOf(e: Keys) {
  if (/^(Shift|Alt|Control|Meta|OS|CapsLock|Fn|Dead|Process|Unidentified)/.test(e.key)) return null;
  if (held(e)) return /^[A-Za-z0-9]+$/.test(e.code) ? [...MODS.filter(mod => e[`${mod}Key`]), e.code].join("+") : null;
  if (e.key === " ") return null; // a plain space types, and clicks the button that records it
  if (e.key.length === 1) {
    const key = e.key.toLowerCase();
    // a shifted letter keeps its shift; any other character already says it (⇧3 gives #)
    return isLetter(key) && e.shiftKey ? `shift+${key}` : key;
  }
  return e.shiftKey ? `shift+${e.key}` : e.key;
}

/** Whether a key press is the binding: with ⌘ ⌥ ⌃ by its physical key and exactly its modifiers, else by the key
 *  as typed (Caps Lock does not count, a character's own shift neither). */
export function isBinding(e: Keys, binding: string) {
  const { mods, token } = split(binding);
  const has = (mod: string) => mods.includes(mod);
  if (withMods(binding))
    return (
      e.code === token &&
      e.altKey === has("alt") &&
      e.shiftKey === has("shift") &&
      e.ctrlKey === has("ctrl") &&
      e.metaKey === has("meta")
    );
  if (held(e)) return false;
  if (token.length === 1) return e.key.toLowerCase() === token && (!isLetter(token) || e.shiftKey === has("shift"));
  return e.key === token && e.shiftKey === has("shift");
}

/** A binding as the platform writes it: ⌃⌥⇧⌘ in that order, then the key, on the Mac, Ctrl+Alt+Shift+K on Windows. */
export function bindingLabel(binding: string) {
  const { mods, token } = split(binding);
  const mac = isMac();
  const name = (!mac && WIN_NAMES[token]) || NAMES[token];
  const key = name ?? token.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=\d$)/, "");
  const down = MODS.filter(mod => mods.includes(mod));
  const keyText = key.length === 1 ? key.toUpperCase() : key;
  if (mac) return down.map(mod => SYMBOLS[mod]).join("") + keyText;
  return [...down.map(mod => WORDS[mod]), keyText].join("+");
}

/** Every command's bindings, the saved ones over the defaults. */
export const bindingsOf = (settings: Settings, id: CommandId): readonly string[] =>
  settings.shortcuts?.[id] ?? defaultsOf(id);
/** Whether a key press runs the command. */
export const pressed = (settings: Settings, id: CommandId, e: Keys) =>
  bindingsOf(settings, id).some(binding => isBinding(e, binding));
/** The command's first binding, for a tooltip. */
export const keyLabel = (settings: Settings, id: CommandId) => bindingLabel(bindingsOf(settings, id)[0]);

/** The modifier the answers on a question take. */
export const pickModOf = (settings: Settings): PickMod => {
  const saved = settings.shortcuts?.[PICK_ID]?.[0] ?? "";
  return (PICK_MODS as readonly string[]).includes(saved) ? (saved as PickMod) : "";
};
/** The answer a key press picks, 1 to 9, or 0. The digit by its physical key (a Belgian keyboard types & for 1), or
 *  as typed; without a modifier shift is let through for the same reason. */
export function pickedDigit(settings: Settings, e: Keys) {
  const mod = pickModOf(settings);
  if (e.ctrlKey !== (mod === "ctrl") || e.altKey !== (mod === "alt") || e.metaKey !== (mod === "meta")) return 0;
  if (mod && e.shiftKey) return 0;
  const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code)?.[2] ?? (/^[1-9]$/.test(e.key) ? e.key : "");
  return Number(digit) || 0;
}
/** ⌃1 to ⌃9 by default: the workspace at that place in the footer's menu. */
export const WORKSPACE_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `app.workspace${n}` as CommandId);
/** The workspace a key press switches to, 1 to 9, or 0. A key the answers on a question take (⌃ and a digit when
 *  they take ⌃) stays theirs. */
export function workspaceDigit(settings: Settings, e: Keys) {
  if (pickedDigit(settings, e)) return 0;
  return WORKSPACE_KEYS.findIndex(id => pressed(settings, id, e)) + 1;
}
/** The key of the workspace at place `n` (1 to 9) as the menu shows it, "" when the answers on a question take it. */
export function workspaceKeyLabel(settings: Settings, n: number) {
  const binding = bindingsOf(settings, WORKSPACE_KEYS[n - 1])[0];
  if (!binding) return "";
  const { mods, token } = split(binding);
  const press = {
    key: token.replace(/^Digit/, ""),
    code: token,
    ...Object.fromEntries(MODS.map(mod => [`${mod}Key`, mods.includes(mod)])),
  } as Keys;
  return pickedDigit(settings, press) ? "" : bindingLabel(binding);
}
export const pickLabel = (mod: PickMod) => (!mod ? "" : isMac() ? SYMBOLS[mod] : `${WORDS[mod]}+`) + "1–9";
/** The modifiers the answers may take here: not the Win key, Windows keeps Win and a digit for the taskbar. */
export const pickMods = (): readonly PickMod[] => PICK_MODS.filter(mod => isMac() || mod !== "meta");

/** Why a binding cannot go on a command, or "" when it can: `typing` when a plain key would type in a field
 *  (anywhere in Relay, the composer), `reserved` when macOS has it, `taken` with the command that has it. `others`
 *  are bindings outside this list that count as anywhere in Relay (dictation's). */
export function refusal(
  settings: Settings,
  id: CommandId,
  binding: string,
  others: readonly string[] = [],
): { why: "typing" | "reserved" | "taken"; by?: CommandId } | null {
  const { scope } = COMMANDS[id];
  // anywhere in Relay and in the composer a key needs ⌘ ⌥ ⌃, except a function key, Esc for Esc and Enter to send
  const plainOk =
    /^F\d{1,2}$/.test(binding) ||
    (id === "app.escape" && binding === "Escape") ||
    (id === "chat.send" && /^(shift\+)?Enter$/.test(binding));
  if ((scope === "app" || scope === "chat") && !withMods(binding) && !plainOk) return { why: "typing" };
  if (reserved(binding) && !defaultsOf(id).includes(binding)) return { why: "reserved" };
  // the same scope, or a ⌘ ⌥ ⌃ key anywhere in Relay, which the window or the menu takes first
  const clashes = (other: Scope) => other === scope || (withMods(binding) && (other === "app" || scope === "app"));
  for (const other of Object.keys(COMMANDS) as CommandId[]) {
    if (other !== id && clashes(COMMANDS[other].scope) && bindingsOf(settings, other).includes(binding))
      return { why: "taken", by: other };
  }
  if (withMods(binding) && others.includes(binding)) return { why: "taken" };
  return null;
}

/** The settings with the command's bindings changed: back to the defaults (`null`, or the defaults themselves) drops
 *  it from `settings.shortcuts`. */
export function withBindings(settings: Settings, id: string, keys: readonly string[] | null) {
  const next = { ...settings.shortcuts };
  const defaults = id in COMMANDS ? defaultsOf(id as CommandId) : [""];
  if (!keys || keys.join("\n") === defaults.join("\n")) delete next[id];
  else next[id] = [...keys];
  return { ...settings, shortcuts: next };
}
