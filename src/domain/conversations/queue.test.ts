import { test } from "node:test";
import assert from "node:assert/strict";
import { busySend, editQueued, enqueue, moveQueued, removeQueued, restored, storable, type Queued } from "./queue.ts";

const q = (id: string, text = id): Queued => ({ id, text, images: [], files: [] });
const ids = (list: Queued[]) => list.map(x => x.id).join(",");

test("queued messages keep the order they were held in", () => {
  const list = enqueue(enqueue(enqueue(undefined, q("a")), q("b")), q("c"));
  assert.equal(ids(list), "a,b,c");
});

test("a message is edited in place and dropped when nothing is left of it", () => {
  const list = [q("a"), q("b")];
  assert.deepEqual(
    editQueued(list, "b", "  then write the test  ").map(x => x.text),
    ["a", "then write the test"],
  );
  assert.equal(ids(editQueued(list, "a", "   ")), "b");
  // attachments keep a message without text
  assert.equal(ids(editQueued([{ ...q("a"), files: ["/tmp/a.csv"] }], "a", "")), "a");
});

test("removing and moving leave the others in order", () => {
  const list = [q("a"), q("b"), q("c")];
  assert.equal(ids(removeQueued(list, "b")), "a,c");
  assert.equal(ids(moveQueued(list, "c", 0)), "c,a,b");
  assert.equal(ids(moveQueued(list, "a", 2)), "b,c,a");
  assert.equal(ids(moveQueued(list, "a", 99)), "b,c,a");
  assert.equal(ids(moveQueued(list, "missing", 0)), "a,b,c");
});

test("Steer only where the agent can end a turn, the other agents queue", () => {
  assert.equal(busySend(true, { steer: true }), "steer");
  assert.equal(busySend(false, { steer: true }), "queue");
  assert.equal(busySend(true, { steer: false }), "queue");
  assert.equal(busySend(true, undefined), "queue");
});

test("a restart keeps text and files, not pasted images", () => {
  const withImage: Queued = { ...q("b"), images: [{ mt: "image/png", data: "x", url: "blob:1" }] };
  const kept = storable({ "c:1": [q("a"), withImage], "c:2": [withImage] });
  assert.deepEqual(Object.keys(kept), ["c:1"]);
  assert.deepEqual(restored(kept)["c:1"], [q("a")]);
});
