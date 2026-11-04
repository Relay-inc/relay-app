import { test } from "node:test";
import assert from "node:assert/strict";
import { meeting as kind } from "./meeting.ts";
import { NOW, at, flags, meeting, snap, words } from "./fixtures.ts";
import type { EntryOf } from "./types.ts";

const run = (m = meeting(), now = NOW, project: string | null = null) =>
  kind.entries(snap({ meetings: [m], meetingProject: { [m.id]: project } }), words, now);

test("a meeting is no item of the queue: the strip, the card and the wrap-ups owed carry it", () => {
  assert.deepEqual(run(), []);
  assert.deepEqual(run(meeting(), at(11, 10)), []);
  assert.deepEqual(run(meeting(), at(12)), []);
});

const item = (kindName: "prep" | "note", m = meeting()) =>
  ({
    kind: kindName,
    id: `${kindName}:${m.id}`,
    subject: { type: "meeting", meeting: m },
  }) as unknown as EntryOf<"meeting">;

test("a prep joins when the link is a meeting service, and can be done; a note makes the note or skips it", () => {
  const withJoin = kind.actions(item("prep", meeting({ join: "https://meet.google.com/abc-defg-hij" })), flags, words);
  assert.deepEqual(
    withJoin.acts.map(a => a.id),
    ["prep", "join", "record"],
  );
  assert.equal(withJoin.secondary, 1);
  assert.equal(withJoin.done?.id, "done");
  const without = kind.actions(item("prep"), flags, words);
  assert.deepEqual(
    without.acts.map(a => a.id),
    ["prep", "record"],
  );
  assert.equal(without.secondary, undefined);
  const noteActions = kind.actions(item("note"), flags, words);
  assert.deepEqual(
    noteActions.acts.map(a => a.id),
    ["makeNote", "noNote"],
  );
  assert.equal(noteActions.done, undefined);
});
