import { test } from "node:test";
import assert from "node:assert/strict";
import { meeting as kind } from "./meeting.ts";
import { NOW, at, flags, iso, meeting, snap, words } from "./fixtures.ts";
import type { Entry, EntryOf } from "./types.ts";

const run = (m = meeting(), now = NOW, project: string | null = null) =>
  kind.entries(snap({ meetings: [m], meetingProject: { [m.id]: project } }), words, now);

test("a meeting to come is a prep, due at its start", () => {
  const [draft] = run(meeting(), NOW, "app");
  assert.equal(draft.kind, "prep");
  assert.equal(draft.id, "prep:m1@9");
  assert.equal(draft.by, at(11));
  assert.equal(draft.project, "app");
  assert.equal(draft.where, "11:00–11:30");
  assert.equal(draft.tone, "", "more than an hour away");
  assert.equal(run(meeting(), at(10, 30))[0].tone, "soon");
});

test("a prep stays while the meeting runs, then it is a note", () => {
  assert.equal(run(meeting(), at(11, 10))[0].kind, "prep");
  assert.match(run(meeting(), at(11, 10))[0].why, /wait.meetingNow/);
  const [note] = run(meeting(), at(12));
  assert.equal(note.kind, "note");
  assert.equal(note.id, "note:m1@9");
  assert.equal(note.at, at(11, 30));
});

test("only today's meetings", () => {
  const tomorrow = meeting({ start: iso(at(11) + 86_400_000), end: iso(at(12) + 86_400_000) });
  assert.deepEqual(run(tomorrow), []);
});

test("a prep joins when the link is a meeting service, and can be done; a note makes the note or skips it", () => {
  const [prep] = run(meeting({ join: "https://meet.google.com/abc-defg-hij" }));
  const withJoin = kind.actions(prep as EntryOf<"meeting">, flags, words);
  assert.deepEqual(
    withJoin.acts.map(a => a.id),
    ["prep", "join", "record"],
  );
  assert.equal(withJoin.secondary, 1);
  assert.equal(withJoin.done?.id, "done");
  const without = kind.actions(run()[0] as Entry as EntryOf<"meeting">, flags, words);
  assert.deepEqual(
    without.acts.map(a => a.id),
    ["prep", "record"],
  );
  assert.equal(without.secondary, undefined);
  const [note] = run(meeting(), at(12));
  const noteActions = kind.actions(note as EntryOf<"meeting">, flags, words);
  assert.deepEqual(
    noteActions.acts.map(a => a.id),
    ["makeNote", "noNote"],
  );
  assert.equal(noteActions.done, undefined);
});
