import { test } from "node:test";
import assert from "node:assert/strict";
import { policyCounts, policyOf } from "./actions.ts";
import type { ActionMeta } from "./types.ts";

const act = (id: string, def: ActionMeta["default"]): ActionMeta => ({
  ext: "mail",
  id,
  about: "",
  write: false,
  default: def,
});
const actions = [act("search", "auto"), act("read", "auto"), act("save_draft", "ask"), act("thread", "auto")];

test("an action without a choice runs its default", () => {
  assert.deepEqual(policyCounts(actions, undefined), { auto: 3, ask: 1, deny: 0 });
});
test("an action's own policy wins over the extension's *, which wins over the default", () => {
  const entry = { "*": "ask", read: "deny", search: "auto" };
  assert.equal(policyOf(actions[0], entry), "auto");
  assert.equal(policyOf(actions[1], entry), "deny");
  assert.equal(policyOf(actions[2], entry), "ask");
  assert.deepEqual(policyCounts(actions, entry), { auto: 1, ask: 2, deny: 1 });
});
test("a value that is no policy falls through to the default", () => {
  assert.equal(policyOf(actions[2], { save_draft: "" }), "ask");
});
