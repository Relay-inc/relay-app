import { test } from "node:test";
import assert from "node:assert/strict";
import { modelName } from "../src/models.ts";
import { strings } from "../src/locales.ts";
import antigravity from "../src/index.ts";

test("model ids as the usage view names them", () => {
  assert.equal(modelName("gemini-3.8-flash-high"), "Gemini 3.8 Flash High");
  assert.equal(modelName("claude-opus-4-6-thinking"), "Claude Opus 4.6 Thinking");
  assert.equal(modelName("gpt-oss-120b-medium"), "GPT OSS 120B Medium");
  assert.equal(modelName("antigravity"), "Antigravity");
});

test("every language has the keys of English", () => {
  const en = Object.keys(strings.en).sort();
  for (const l of ["nl", "fr", "de"] as const) assert.deepEqual(Object.keys(strings[l]).sort(), en, l);
});

test("every option and choice has its label", () => {
  for (const o of antigravity.options ?? []) for (const k of [o.label, ...o.choices.map(c => c.label)]) assert.ok(strings.en[k], k);
});
