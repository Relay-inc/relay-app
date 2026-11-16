import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bindingLabel,
  bindingOf,
  bindingsOf,
  COMMANDS,
  isBinding,
  pickedDigit,
  pickLabel,
  pickMods,
  pressed,
  refusal,
  reserved,
  resolve,
  withBindings,
  workspaceDigit,
  workspaceKeyLabel,
} from "./shortcuts.ts";
import type { Settings } from "./types.ts";
import { defaultShortcuts, voiceOf } from "./voice.ts";

const key = (
  key: string,
  code: string,
  mods: { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean } = {},
) => ({
  key,
  code,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
});
const none = {} as Settings;

test("a press records as the physical key with ⌘ ⌥ ⌃, else as typed", () => {
  assert.equal(bindingOf(key("k", "KeyK", { meta: true })), "meta+KeyK");
  assert.equal(bindingOf(key("Ω", "KeyZ", { alt: true, shift: true })), "alt+shift+KeyZ");
  assert.equal(bindingOf(key("E", "KeyE", { shift: true })), "shift+e");
  assert.equal(bindingOf(key("#", "Digit3", { shift: true })), "#");
  assert.equal(bindingOf(key("Enter", "Enter", { shift: true })), "shift+Enter");
  assert.equal(bindingOf(key("Meta", "MetaLeft", { meta: true })), null);
  assert.equal(bindingOf(key(" ", "Space")), null);
});

test("a binding matches its key: by code with modifiers, layout and Caps Lock aside without", () => {
  assert.ok(isBinding(key("k", "KeyK", { meta: true }), "meta+KeyK"));
  assert.ok(!isBinding(key("k", "KeyK", { meta: true, shift: true }), "meta+KeyK"));
  // AZERTY: the A key sits on KeyQ, typed it is still a
  assert.ok(isBinding(key("a", "KeyQ"), "a"));
  assert.ok(isBinding(key("E", "KeyE"), "e")); // Caps Lock
  assert.ok(!isBinding(key("E", "KeyE", { shift: true }), "e"));
  assert.ok(!isBinding(key("e", "KeyE", { meta: true }), "e"));
  assert.ok(isBinding(key("#", "Digit3", { shift: true }), "#"));
  assert.ok(isBinding(key("+", "Equal", { shift: true }), "+"));
  assert.ok(!isBinding(key("Enter", "Enter", { shift: true }), "Enter"));
});

test("labels read like the Mac's", () => {
  assert.equal(bindingLabel("meta+Comma"), "⌘,");
  assert.equal(bindingLabel("alt+shift+meta+KeyK"), "⌥⇧⌘K");
  assert.equal(bindingLabel("shift+Enter"), "⇧↵");
  assert.equal(bindingLabel("j"), "J");
  assert.equal(bindingLabel("+"), "+");
});

test("saved bindings replace the defaults, the defaults drop out of the settings", () => {
  const moved = withBindings(none, "app.quickAsk", ["meta+KeyJ"]);
  assert.ok(pressed(moved, "app.quickAsk", key("j", "KeyJ", { meta: true })));
  assert.ok(!pressed(moved, "app.quickAsk", key("k", "KeyK", { meta: true })));
  assert.deepEqual(withBindings(moved, "app.quickAsk", ["meta+KeyK", "meta+KeyO"]).shortcuts, {});
});

test("a binding is refused where it would type, belongs to macOS, or another command has it", () => {
  assert.equal(refusal(none, "app.quickAsk", "k")?.why, "typing");
  assert.equal(refusal(none, "app.newGeneral", "Escape")?.why, "typing");
  assert.equal(refusal(none, "chat.send", "shift+Enter"), null);
  assert.equal(refusal(none, "app.quickAsk", "meta+KeyC")?.why, "reserved");
  assert.equal(refusal(none, "mail.selectAll", "meta+KeyA"), null);
  assert.deepEqual(refusal(none, "app.quickAsk", "meta+KeyT"), { why: "taken", by: "app.newProject" });
  assert.deepEqual(refusal(none, "today.done", "s"), { why: "taken", by: "today.snooze" });
  assert.deepEqual(refusal(none, "today.done", "#"), { why: "taken", by: "today.trash" });
  // another view's letter, and Esc for unticking mails, are fine
  assert.equal(refusal(none, "mail.archive", "s"), null);
  assert.equal(refusal(none, "mail.unselect", "Escape"), null);
  // a ⌘ key in a view still clashes with Relay's own
  assert.deepEqual(refusal(none, "today.done", "meta+KeyK"), { why: "taken", by: "app.quickAsk" });
  assert.equal(refusal(none, "app.quickAsk", "alt+Space", ["alt+Space"])?.why, "taken");
});

test("the answers on a question follow their modifier", () => {
  assert.equal(pickedDigit(none, key("&", "Digit1")), 1); // Belgian keyboard
  assert.equal(pickedDigit(none, key("3", "Digit3", { shift: true })), 3);
  assert.equal(pickedDigit(none, key("1", "Digit1", { alt: true })), 0);
  const alt = withBindings(none, "card.pick", ["alt"]);
  assert.equal(pickedDigit(alt, key("¡", "Digit1", { alt: true })), 1);
  assert.equal(pickedDigit(alt, key("1", "Digit1")), 0);
});

test("⌃1 to ⌃9 switch workspaces, changeable, and leave a key the answers on a question take", () => {
  const plain = none;
  assert.equal(workspaceDigit(plain, key("2", "Digit2", { ctrl: true })), 2);
  assert.equal(workspaceKeyLabel(plain, 2), "⌃2");
  assert.equal(workspaceDigit(plain, key("2", "Digit2", { alt: true })), 0);
  // rebound in Settings › Shortcuts
  const moved = withBindings(plain, "app.workspace2", ["alt+meta+Digit2"]);
  assert.equal(workspaceDigit(moved, key("2", "Digit2", { alt: true, meta: true })), 2);
  assert.equal(workspaceDigit(moved, key("2", "Digit2", { ctrl: true })), 0);
  assert.equal(workspaceKeyLabel(moved, 2), "⌥⌘2");
  // the answers take ⌃: ⌃2 is theirs, the menu shows no key
  const cards = withBindings(plain, "card.pick", ["ctrl"]);
  assert.equal(workspaceDigit(cards, key("2", "Digit2", { ctrl: true })), 0);
  assert.equal(workspaceKeyLabel(cards, 2), "");
  // and ⌃2 is taken for another command
  assert.equal(refusal(plain, "app.settings", "ctrl+Digit2")?.by, "app.workspace2");
});

test("quick capture's key is nobody else's: no Relay command has it and it is not Finder's or the browsers' ⌘⇧N", () => {
  const [capture] = bindingsOf(none, "app.capture");
  assert.equal(bindingLabel(capture), "⌃⌥⌘N");
  assert.equal(refusal(none, "app.capture", capture), null);
  for (const id of Object.keys(COMMANDS) as (keyof typeof COMMANDS)[])
    if (id !== "app.capture") assert.ok(!bindingsOf(none, id).includes(capture), id);
  // another command's key, and ⌘N (a new window), are refused for it
  assert.deepEqual(refusal(none, "app.capture", "meta+KeyN"), { why: "taken", by: "app.newWindow" });
  // a dictation shortcut on the same key is refused too
  assert.deepEqual(refusal(none, "app.capture", "shift+meta+KeyD", ["shift+meta+KeyD"]), { why: "taken" });
});

/** Runs `check` as WebView2 on Windows would: its user agent names Windows. */
function onWindows(check: () => void) {
  const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/142.0" },
    configurable: true,
  });
  try {
    check();
  } finally {
    if (was) Object.defineProperty(globalThis, "navigator", was);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

test("mod is ⌘ on the Mac and Ctrl on Windows, in the defaults and in a press", () => {
  assert.equal(resolve("alt+mod+KeyT"), "alt+meta+KeyT");
  assert.deepEqual(bindingsOf(none, "app.quickAsk"), ["meta+KeyK", "meta+KeyO"]);
  assert.ok(pressed(none, "app.newProject", key("t", "KeyT", { meta: true })));
  onWindows(() => {
    assert.equal(resolve("alt+mod+KeyT"), "ctrl+alt+KeyT");
    assert.equal(resolve("ctrl+KeyC"), "ctrl+KeyC");
    assert.deepEqual(bindingsOf(none, "app.quickAsk"), ["ctrl+KeyK", "ctrl+KeyO"]);
    assert.ok(pressed(none, "app.newProject", key("t", "KeyT", { ctrl: true })));
    assert.ok(!pressed(none, "app.newProject", key("t", "KeyT", { meta: true })));
    assert.ok(pressed(none, "app.newGeneral", key("t", "KeyT", { ctrl: true, alt: true })));
    // ⌘F and ⌃F are one key here
    assert.deepEqual(bindingsOf(none, "chat.find"), ["ctrl+KeyF"]);
    // the defaults still drop out of the settings
    assert.deepEqual(withBindings(none, "app.quickAsk", ["ctrl+KeyK", "ctrl+KeyO"]).shortcuts, {});
  });
});

test("labels read like Windows' there: Ctrl+Alt+Shift+K, Enter, Win", () => {
  onWindows(() => {
    assert.equal(bindingLabel("mod+Comma"), "Ctrl+,");
    assert.equal(bindingLabel("alt+shift+mod+KeyK"), "Ctrl+Alt+Shift+K");
    assert.equal(bindingLabel("mod+Enter"), "Ctrl+Enter");
    assert.equal(bindingLabel("shift+Enter"), "Shift+Enter");
    assert.equal(bindingLabel("ctrl+alt+meta+KeyN"), "Ctrl+Alt+Win+N");
    assert.equal(bindingLabel("Backspace"), "Backspace");
    assert.equal(bindingLabel("j"), "J");
    assert.equal(workspaceKeyLabel(none, 2), "Ctrl+2");
    assert.equal(pickLabel("alt"), "Alt+1–9");
    assert.deepEqual(pickMods(), ["", "alt", "ctrl"]);
  });
  assert.equal(bindingLabel("mod+Enter"), "⌘↵");
  assert.equal(pickLabel("meta"), "⌘1–9");
  assert.deepEqual(pickMods(), ["", "alt", "ctrl", "meta"]);
});

test("Windows keeps the edit keys, Alt+F4 and every Win key for itself", () => {
  onWindows(() => {
    assert.equal(refusal(none, "app.quickAsk", "ctrl+KeyV")?.why, "reserved");
    assert.equal(refusal(none, "app.quickAsk", "ctrl+KeyY")?.why, "reserved");
    assert.equal(refusal(none, "app.quickAsk", "alt+F4")?.why, "reserved");
    assert.equal(refusal(none, "app.quickAsk", "meta+KeyJ")?.why, "reserved");
    // a command's own default stays allowed: Ctrl+A ticks all mails, Ctrl+C stops the turn
    assert.equal(refusal(none, "mail.selectAll", "ctrl+KeyA"), null);
    assert.equal(refusal(none, "app.stop", "ctrl+KeyC"), null);
    assert.equal(refusal(none, "app.quickAsk", "k")?.why, "typing");
    assert.deepEqual(refusal(none, "app.quickAsk", "ctrl+KeyT"), { why: "taken", by: "app.newProject" });
  });
  // on the Mac the Win key is ⌘ and free, ⌃V is not an edit key
  assert.equal(refusal(none, "app.quickAsk", "meta+KeyJ"), null);
  assert.equal(refusal(none, "app.quickAsk", "ctrl+KeyV"), null);
});

test("Windows has its own dictation and capture keys: Ctrl where the Mac has the Win key, Alt+Space or Alt+Shift", () => {
  assert.deepEqual(defaultShortcuts(), {
    shortcut: "alt+Space",
    chatShortcut: "alt+shift+Space",
    pasteShortcut: "ctrl+alt+Space",
  });
  assert.deepEqual(bindingsOf(none, "app.capture"), ["ctrl+alt+meta+KeyN"]);
  onWindows(() => {
    const voice = voiceOf(undefined);
    const dictation = [voice.shortcut, voice.chatShortcut, voice.pasteShortcut];
    assert.deepEqual(dictation, ["ctrl+Space", "ctrl+shift+Space", "ctrl+alt+Space"]);
    const [capture] = bindingsOf(none, "app.capture");
    assert.equal(capture, "ctrl+alt+KeyN");
    assert.equal(bindingLabel(capture), "Ctrl+Alt+N");
    assert.equal(refusal(none, "app.capture", capture, dictation), null);
    for (const binding of [...dictation, capture]) {
      assert.ok(!reserved(binding) && !binding.startsWith("alt+"), binding);
      for (const id of Object.keys(COMMANDS) as (keyof typeof COMMANDS)[])
        if (id !== "app.capture") assert.ok(!bindingsOf(none, id).includes(binding), `${binding} ${id}`);
    }
    // a saved key stays what it is
    assert.equal(voiceOf({ pasteShortcut: "ctrl+shift+KeyD" }).pasteShortcut, "ctrl+shift+KeyD");
  });
});
