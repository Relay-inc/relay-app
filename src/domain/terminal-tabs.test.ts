import { test } from "node:test";
import assert from "node:assert/strict";
import { activeAfterClose, nextTitle } from "./terminal-tabs.ts";

test("a new tab takes the lowest free number", () => {
  assert.equal(nextTitle([]), "zsh 1");
  assert.equal(nextTitle(["zsh 1", "zsh 2"]), "zsh 3");
  assert.equal(nextTitle(["zsh 2"]), "zsh 1");
});

test("closing the shown tab shows its neighbour, closing another keeps the shown one", () => {
  assert.equal(activeAfterClose([1, 2, 3], 2, 2), 3);
  assert.equal(activeAfterClose([1, 2, 3], 3, 3), 2);
  assert.equal(activeAfterClose([1, 2, 3], 1, 3), 3);
  assert.equal(activeAfterClose([1], 1, 1), 0);
});
