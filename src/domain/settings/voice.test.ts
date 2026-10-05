import { test } from "node:test";
import assert from "node:assert/strict";
import { isShortcut, shortcutCode, shortcutLabel, shortcutOf, voiceOf } from "./voice.ts";

const key = (code: string, mods: string[] = []) => ({
  code,
  altKey: mods.includes("alt"),
  shiftKey: mods.includes("shift"),
  ctrlKey: mods.includes("ctrl"),
  metaKey: mods.includes("meta"),
});

test("a shortcut matches its key with exactly its modifiers", () => {
  assert.ok(isShortcut(key("Space", ["alt"]), "alt+Space"));
  assert.ok(!isShortcut(key("Space", ["alt", "shift"]), "alt+Space"));
  assert.ok(!isShortcut(key("Space"), "alt+Space"));
  assert.ok(isShortcut(key("KeyD", ["meta", "shift"]), "shift+meta+KeyD"));
  assert.equal(shortcutCode("ctrl+alt+Space"), "Space");
});

test("a key press makes a shortcut, written the Mac way", () => {
  assert.equal(shortcutOf(key("KeyD", ["meta", "shift"])), "shift+meta+KeyD");
  assert.equal(shortcutOf(key("AltLeft", ["alt"])), null);
  assert.equal(shortcutOf(key("KeyD")), null);
  assert.equal(shortcutOf(key("F5")), "F5");
  assert.equal(shortcutLabel("shift+meta+KeyD"), "⇧⌘D");
  assert.equal(shortcutLabel("ctrl+alt+Space"), "⌃⌥Space");
  assert.equal(shortcutLabel("alt+Digit1"), "⌥1");
});

test("voice settings fall back to their defaults", () => {
  assert.deepEqual(voiceOf(undefined), {
    on: true,
    shortcut: "alt+Space",
    chatOn: false,
    chatShortcut: "alt+shift+Space",
    pasteOn: false,
    pasteShortcut: "ctrl+alt+Space",
    model: "parakeet-v3",
    language: "auto",
    mode: "both",
    meetingModel: "",
    keepAudio: true,
    summarize: true,
  });
  assert.equal(voiceOf({ shortcut: "nonsense!" }).shortcut, "alt+Space");
  assert.equal(voiceOf({ on: false }).on, false);
});
