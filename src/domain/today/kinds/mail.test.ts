import { test } from "node:test";
import assert from "node:assert/strict";
import { mail as kind, waitsOnYou } from "./mail.ts";
import { NOW, at, flags, iso, mail, snap, words } from "./fixtures.ts";
import type { EntryOf } from "./types.ts";

test("unread mail waits on you; so does read mail that was not answered, once the Inbox/Other split knows people", () => {
  assert.equal(waitsOnYou(mail()), true);
  assert.equal(waitsOnYou(mail({ unread: false })), false, "read, no split");
  assert.equal(waitsOnYou(mail({ unread: false, other: false })), true, "from a person, read, not answered");
  assert.equal(waitsOnYou(mail({ unread: false, other: false, answered: true })), false);
  assert.equal(waitsOnYou(mail({ other: true })), false, "from a machine");
  assert.equal(waitsOnYou(mail({ answered: true })), false);
});

test("a mail item says how long it waits, and is soon after four hours", () => {
  const fresh = mail({ id: "1", date: iso(NOW - 10 * 60_000) });
  const old = mail({ id: "2", subject: "", date: iso(at(5)) });
  const entries = kind.entries(snap({ mails: [fresh, old], mailProject: { "mail:a:1": "app" } }), words, NOW);
  assert.equal(entries[0].id, "mail:mail:a:1");
  assert.equal(entries[0].project, "app");
  assert.equal(entries[0].tone, "");
  assert.equal(entries[0].why, 'today.waiting {"ago":"wait.agoMin {\\"n\\":10}"}');
  assert.equal(entries[1].title, "mail.noSubject");
  assert.equal(entries[1].tone, "soon");
  assert.equal(entries[1].project, null);
  assert.equal(entries[1].why, 'today.waiting {"ago":"wait.agoHour {\\"n\\":5}"}');
});

test("reply, reply all, forward; a ticket only with a board; trash and archive only with the experimental flag", () => {
  const [draft] = kind.entries(snap({ mails: [mail()] }), words, NOW);
  const entry = draft as EntryOf<"mail">;
  const plain = kind.actions(entry, { ...flags, boardsReady: false }, words);
  assert.deepEqual(
    plain.acts.map(a => a.id),
    ["reply", "replyAll", "forward", "chat", "read"],
  );
  assert.equal(plain.done?.id, "read");
  assert.equal(plain.done?.key, "E");
  assert.equal(plain.secondary, undefined);
  const full = kind.actions(entry, { ...flags, mailExperimental: true }, words);
  assert.deepEqual(
    full.acts.map(a => a.id),
    ["reply", "replyAll", "forward", "chat", "ticket", "read", "trash"],
  );
  assert.equal(full.done?.id, "archive");
});

test("a mail is soon only after more than four hours", () => {
  const tone = (ms: number) => kind.entries(snap({ mails: [mail({ date: iso(NOW - ms) })] }), words, NOW)[0].tone;
  assert.equal(tone(4 * 60 * 60_000), "");
  assert.equal(tone(4 * 60 * 60_000 + 1), "soon");
});
