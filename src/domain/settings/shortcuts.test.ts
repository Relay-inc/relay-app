import { test } from "node:test";
import assert from "node:assert/strict";
import { bindingLabel, bindingOf, isBinding, pickedDigit, pressed, refusal, withBindings } from "./shortcuts.ts";
import type { Settings } from "./types.ts";

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
  assert.deepEqual(withBindings(moved, "app.quickAsk", ["meta+KeyK"]).shortcuts, {});
});

test("a binding is refused where it would type, belongs to macOS, or another command has it", () => {
  assert.equal(refusal(none, "app.quickAsk", "k")?.why, "typing");
  assert.equal(refusal(none, "app.newGeneral", "Escape")?.why, "typing");
  assert.equal(refusal(none, "chat.send", "shift+Enter"), null);
  assert.equal(refusal(none, "app.quickAsk", "meta+KeyC")?.why, "reserved");
  assert.equal(refusal(none, "mail.selectAll", "meta+KeyA"), null);
  assert.deepEqual(refusal(none, "app.quickAsk", "meta+KeyT"), { why: "taken", by: "app.newGeneral" });
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
