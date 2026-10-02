import { test } from "node:test";
import assert from "node:assert/strict";
import {
  opened,
  panelItem,
  boardKey,
  termKey,
  prKey,
  mailKey,
  noteKey,
  cardKey,
  chatTime,
  termSid,
  VIEW,
} from "./keys.ts";

test("selection keys", () => {
  assert.deepEqual(opened(VIEW.reminders), { kind: "view", view: "__rem" });
  assert.deepEqual(opened(boardKey("trello")), { kind: "board", provider: "trello" });
  assert.deepEqual(opened(termKey("abc-1")), { kind: "term", sid: "abc-1" });
  assert.deepEqual(opened("c:mupqjmxc"), { kind: "chat", key: "c:mupqjmxc" });
  assert.deepEqual(opened("Spardex"), { kind: "chat", key: "Spardex" }); // a conversation from before the app keys
  assert.equal(termSid(termKey("s1")), "s1");
  assert.equal(termSid("c:1"), "");
  assert.equal(chatTime("c:" + (1700000000000).toString(36)), 1700000000000);
  assert.equal(chatTime("general:" + (42).toString(36)), 42);
  assert.equal(chatTime("Spardex"), 0);
});

test("panel keys round-trip", () => {
  assert.deepEqual(panelItem(prKey("weareantenna/spardex", 26)), {
    kind: "pr",
    repo: "weareantenna/spardex",
    number: 26,
  });
  assert.deepEqual(panelItem(mailKey({ account: "k@x.be", id: "17" })), { kind: "mail", account: "k@x.be", id: "17" });
  assert.deepEqual(panelItem(noteKey("Contexts/A/B.md")), { kind: "note", target: "Contexts/A/B.md" });
  assert.deepEqual(panelItem(cardKey("productive", "123:4")), { kind: "card", provider: "productive", id: "123:4" });
  assert.equal(panelItem(""), null);
});
