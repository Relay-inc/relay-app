import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { modelName } from "../src/models.ts";
import { strings } from "../src/locales.ts";

test("model ids read as the Usage view shows them", () => {
  assert.equal(modelName("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelName("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(modelName("claude-sonnet-5"), "Sonnet 5");
  assert.equal(modelName("gpt-5"), "gpt-5");
});

test("every limit window label the backend sends has a string in every language", () => {
  // the labels limits_of in src/usage_log.rs uses
  const src = readFileSync(new URL("../src/usage_log.rs", import.meta.url), "utf8");
  const labels = [...new Set([...src.matchAll(/"(limit\.[A-Za-z]+)"/g)].map(m => m[1]))];
  assert.deepEqual(labels.sort(), ["limit.session", "limit.weekly", "limit.weeklyModel"]);
  for (const l of Object.values(strings)) for (const k of [...labels, "off.no-login", "off.expired", "off.unavailable"]) assert.ok((l as any)[k], k);
});

test("the stream fixture is what the Rust parser is tested on", () => {
  const lines = readFileSync(new URL("./fixtures/stream.jsonl", import.meta.url), "utf8").trim().split("\n");
  assert.equal(JSON.parse(lines[0]).subtype, "init");
});
