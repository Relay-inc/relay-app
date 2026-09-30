import { test } from "node:test";
import assert from "node:assert/strict";
import { modelName } from "../src/models.ts";
import { strings } from "../src/locales.ts";

test("model ids as the usage view names them", () => {
  assert.equal(modelName("gpt-6.1-sol"), "GPT-6.1-Sol");
  assert.equal(modelName("gpt-5.1-codex-mini"), "GPT-5.1-Codex-Mini");
  assert.equal(modelName("codex"), "Codex");
});

test("every language has the keys of English", () => {
  const en = Object.keys(strings.en).sort();
  for (const l of ["nl", "fr", "de"] as const) assert.deepEqual(Object.keys(strings[l]).sort(), en, l);
});
