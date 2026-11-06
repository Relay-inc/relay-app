import test from "node:test";
import assert from "node:assert/strict";
import { singleFlight } from "./single-flight.ts";

test("overlapping calls share one load, a later call starts a new one", async () => {
  let calls = 0;
  const load = singleFlight(async () => ++calls);
  const [a, b] = await Promise.all([load(), load()]);
  assert.deepEqual([a, b, calls], [1, 1, 1]);
  assert.equal(await load(), 2);
});

test("a failed load does not stick", async () => {
  let fail = true;
  const load = singleFlight(async () => { if (fail) throw new Error("x"); return 1; });
  await assert.rejects(load());
  fail = false;
  assert.equal(await load(), 1);
});
