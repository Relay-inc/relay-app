import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_SETTINGS, filesOn, type Settings } from "./types.ts";

test("Files is off until switched on, also for settings saved before it existed", () => {
  assert.equal(filesOn(EMPTY_SETTINGS), false);
  assert.equal(filesOn({ ...EMPTY_SETTINGS, experimental: {} } as Settings), false);
  assert.equal(filesOn({ ...EMPTY_SETTINGS, experimental: { files: true } }), true);
});
