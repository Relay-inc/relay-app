import { test } from "node:test";
import assert from "node:assert/strict";
import { accountsOf, addAccount, removeAccount, renameAccount } from "./accounts.ts";

const work = { name: "claude-work", dir: "/Users/me/.claude-work" };

test("a provider without accounts reads as the CLI's own folder only", () => {
  assert.deepEqual(accountsOf({ on: true, bin: "" }), { accounts: [], active: "", auto: false });
});
test("a picked folder is named after itself without its dot, once", () => {
  const now = accountsOf({ on: true, bin: "" });
  const added = addAccount(now, work.dir);
  assert.deepEqual(added?.accounts, [work]);
  assert.equal(addAccount(added!, work.dir), null);
  assert.equal(addAccount(now, ""), null);
});
test("renaming trims, removing the active one falls back to the CLI's own", () => {
  const now = { accounts: [work, { name: "home", dir: "/h" }], active: work.dir, auto: true };
  assert.equal(renameAccount(now, 0, "  Work ").accounts[0].name, "Work");
  assert.deepEqual(removeAccount(now, 0), { accounts: [{ name: "home", dir: "/h" }], active: "", auto: true });
  assert.equal(removeAccount(now, 1).active, work.dir);
});
