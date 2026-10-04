import { test } from "node:test";
import assert from "node:assert/strict";
import { isShortcut, shortcutCode, voiceOf } from "./voice.ts";

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
  assert.ok(isShortcut(key("KeyD", ["meta", "shift"]), "meta+shift+KeyD"));
  assert.equal(shortcutCode("ctrl+alt+Space"), "Space");
});

test("voice settings fall back to their defaults", () => {
  assert.deepEqual(voiceOf(undefined), {
    on: true,
    model: "parakeet-v3",
    language: "auto",
    mode: "both",
    shortcut: "alt+Space",
    meetingModel: "",
    keepAudio: true,
    summarize: true,
  });
  assert.equal(voiceOf({ on: false, shortcut: "nonsense" }).shortcut, "alt+Space");
  assert.equal(voiceOf({ on: false }).on, false);
});
