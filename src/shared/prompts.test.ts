import test from "node:test";
import assert from "node:assert/strict";
import { fill, prompts } from "./prompts.ts";

// the prompts that go out as they are, and the templates that still wait for their values
const all = Object.entries(prompts).flatMap(([group, items]) =>
  Object.entries(items).map(([name, text]) => [`${group}.${name}`, text]),
);
const slots = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);

test("every prompt is there, without the editor's trailing newline", () => {
  assert.ok(all.length > 20);
  for (const [name, text] of all) assert.ok(text.length > 20 && !text.endsWith("\n"), name);
});

test("a prompt without values has no placeholder, a template is filled to the last one", () => {
  for (const [name, text] of all) {
    const vars = Object.fromEntries(slots(text).map(slot => [slot, "x"]));
    assert.ok(!fill(text, vars).includes("{{"), name);
  }
});

test("fill throws on a placeholder without a value and on a value without a placeholder", () => {
  assert.throws(() => fill("a {{b}}", {}), /\{\{b\}\}/);
  assert.throws(() => fill("a", { b: "1" }), /placeholder for b/);
  assert.equal(fill("a {{b}} {{b}}", { b: "{{c}}" }), "a {{c}} {{c}}");
});
