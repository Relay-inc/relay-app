import { test } from "node:test";
import assert from "node:assert/strict";
import { trailing } from "./trailing.ts";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test("a burst of calls runs once", async () => {
  let n = 0;
  const run = trailing(() => n++, 30);
  for (let i = 0; i < 200; i++) run();
  assert.equal(n, 0);
  await wait(80);
  assert.equal(n, 1);
  run();
  await wait(80);
  assert.equal(n, 2);
});

test("a steady stream of calls still runs it, not only after the stream ends", async () => {
  let n = 0;
  const run = trailing(() => n++, 30);
  for (let i = 0; i < 20; i++) {
    run();
    await wait(10);
  }
  assert.ok(n >= 3, `ran ${n} times in 200 ms of calls`);
});
