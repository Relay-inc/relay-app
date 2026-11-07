import { test } from "node:test";
import assert from "node:assert/strict";
import { coverOf, emojiOf, iconOf, pageIcon } from "./decor.ts";
import { removeProperty, setProperty } from "./properties.ts";

test("decor: an icon is exactly one grapheme", () => {
  assert.equal(emojiOf("🚀"), "🚀");
  assert.equal(emojiOf(" 🇧🇪 "), "🇧🇪"); // a flag: two code points, one grapheme
  assert.equal(emojiOf("👩‍👩‍👧"), "👩‍👩‍👧"); // a ZWJ sequence
  assert.equal(emojiOf("ab"), null);
  assert.equal(emojiOf("🚀🚀"), null);
  assert.equal(emojiOf(""), null);
  assert.equal(emojiOf(3), null);
});

test("decor: icon and cover written and removed with setProperty", () => {
  const yaml = "type: Document\nstatus: Active";
  const set = setProperty(setProperty(yaml, "icon", "🚀"), "cover", "[[Kickoff banner.png]]");
  assert.equal(set, 'type: Document\nstatus: Active\nicon: 🚀\ncover: "[[Kickoff banner.png]]"');
  assert.equal(coverOf(set), "Kickoff banner.png");
  assert.deepEqual(pageIcon(set), { emoji: "🚀" });
  const removed = removeProperty(removeProperty(set, "icon"), "cover");
  assert.equal(removed, yaml);
  assert.equal(coverOf(removed), "");
  assert.equal(pageIcon(removed), null);
});

test("decor: the note's icon wins over its project's, which wins over none", () => {
  const project = { value: "icons/northwind.png", img: "data:image/png;base64,AAAA" };
  assert.deepEqual(pageIcon("icon: 🚀", project), { emoji: "🚀" });
  assert.deepEqual(pageIcon("type: Project", project), { project });
  assert.deepEqual(pageIcon("icon: ab", { value: "🚚", icon: "🚚" }), { project: { value: "🚚", icon: "🚚" } });
  assert.equal(pageIcon("type: Project", { value: "", img: null }), null);
  assert.equal(pageIcon(""), null);
});

test("decor: a project row in the Pages tree, from the index's icon: value", () => {
  const config = { value: "🚚", icon: "🚚" };
  assert.deepEqual(iconOf(undefined, config), { project: config }); // no icon: on the project note: the config's
  assert.deepEqual(iconOf("🚀", config), { emoji: "🚀" }); // icon: set: the emoji
  assert.deepEqual(iconOf("ab", config), { project: config }); // not one emoji: as if unset
  assert.deepEqual(iconOf("🚀"), { emoji: "🚀" }); // a page row
  assert.equal(iconOf(undefined), null); // the file glyph
});
