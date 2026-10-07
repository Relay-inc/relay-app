import { test } from "node:test";
import assert from "node:assert/strict";
import { workItems } from "./work.ts";
import { opened, workKey } from "../navigation/keys.ts";

const now = 1_000_000;
const meeting = (id: string, start: number, end: number) => ({ id, title: id, start, end, project: "P", item: null });

test("work in progress: a started review, the draft, a running or recorded meeting", () => {
  const work = workItems({
    reviews: [{ item: "review:u", title: "Review #1", project: "P" }],
    compose: { mail: "mail:a@b:1", title: "Re: rate", project: null },
    meetings: [
      meeting("running", now - 10, now + 10),
      meeting("later", now + 10, now + 20),
      meeting("recorded", now - 30, now - 20),
    ],
    recording: "recorded",
    now,
  });
  assert.deepEqual(
    work.map(w => [w.kind, w.id, w.closable, w.busy]),
    [
      ["review", "review:u", true, false],
      ["mail", "mail:a@b:1", true, false],
      ["meeting", "running", false, false],
      ["meeting", "recorded", false, true],
    ],
  );
  assert.equal(work[1].item, "mail:mail:a@b:1");
});

test("a work key says what it opens, nothing else parses it", () => {
  assert.deepEqual(opened(workKey("meeting", "uid@123")), { kind: "work", work: "meeting", id: "uid@123" });
  assert.deepEqual(opened(workKey("review", "review:https://x/1")), {
    kind: "work",
    work: "review",
    id: "review:https://x/1",
  });
});
