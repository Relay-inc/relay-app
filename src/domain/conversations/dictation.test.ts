import { test } from "node:test";
import assert from "node:assert/strict";
import { insertDictated } from "./dictation.ts";

test("dictated text gets a space where it would touch a word", () => {
  assert.deepEqual(insertDictated("", 0, 0, "Hallo"), { value: "Hallo", cursor: 5 });
  assert.deepEqual(insertDictated("Hallo", 5, 5, "Pieter"), { value: "Hallo Pieter", cursor: 12 });
  assert.deepEqual(insertDictated("Hallo ", 6, 6, "Pieter"), { value: "Hallo Pieter", cursor: 12 });
  assert.deepEqual(insertDictated("ab", 1, 1, "x"), { value: "a x b", cursor: 3 });
  assert.deepEqual(insertDictated("a old b", 2, 5, "new"), { value: "a new b", cursor: 5 });
});
