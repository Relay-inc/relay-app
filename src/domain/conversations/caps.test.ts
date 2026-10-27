import { test } from "node:test";
import assert from "node:assert/strict";
import { machineBlock, waitsForPickup } from "./rules.ts";

test("a message sent mid-turn waits only for an agent that says when it takes one up", () => {
  assert.ok(waitsForPickup({ picked: true }));
  assert.ok(!waitsForPickup({ picked: false }));
  assert.ok(!waitsForPickup(undefined));
});

test("only an agent that can run remotely may go to a work machine, and not with a mail", () => {
  assert.equal(machineBlock({ remote: true }, false), null);
  assert.equal(machineBlock({ remote: true }, true), "composer.machineNoMail");
  assert.equal(machineBlock({ remote: false }, true), "composer.machineOnlyClaude");
  assert.equal(machineBlock(undefined, false), "composer.machineOnlyClaude");
  assert.equal(machineBlock({ remote: true }, false, true), "composer.machineSharedVault");
});
