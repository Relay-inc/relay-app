import { test } from "node:test";
import assert from "node:assert/strict";
import { modelName } from "../src/models.ts";
import { strings } from "../src/locales.ts";

test("model ids as the usage view names them", () => {
  assert.equal(modelName("opencode/big-pickle"), "Big Pickle (OpenCode Zen)");
  assert.equal(modelName("anthropic/claude-sonnet-5-5"), "Claude Sonnet 5.5 (Anthropic)");
  assert.equal(modelName("openai/gpt-6.1-sol"), "GPT 6.1 Sol (OpenAI)");
  assert.equal(modelName("lmstudio/qwen3-coder"), "Qwen3 Coder (lmstudio)");
  assert.equal(modelName("big-pickle"), "big-pickle");
});

test("every language has the keys of English", () => {
  const en = Object.keys(strings.en).sort();
  for (const l of ["nl", "fr", "de"] as const) assert.deepEqual(Object.keys(strings[l]).sort(), en, l);
});
