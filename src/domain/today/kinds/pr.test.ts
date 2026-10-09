import { test } from "node:test";
import assert from "node:assert/strict";
import { groupId, pr as kind, reviewGroupOf } from "./pr.ts";
import { NOW, flags, iso, at, pr, snap, words } from "./fixtures.ts";
import type { EntryOf } from "./types.ts";

const ticket = { provider: "prod", card: "9", number: "212", title: "Export" };

test("a review asked of the user is an item, the user's own PR only when it needs them", () => {
  const entries = kind.entries(
    snap({
      prs: {
        review: [pr()],
        mine: [
          pr({ number: 8, url: "u8", review: "CHANGES_REQUESTED" }),
          pr({ number: 9, url: "u9", ci: "FAILURE" }),
          pr({ number: 10, url: "u10" }),
        ],
      },
    }),
    words,
    NOW,
  );
  assert.deepEqual(
    entries.map(e => [e.id, e.kind]),
    [
      ["review:https://github.com/acme/app/pull/7", "review"],
      ["fix:u8", "fix"],
      ["fix:u9", "fix"],
    ],
  );
  assert.equal(entries[0].where, "acme/app #7 · bob");
  assert.equal(entries[1].where, "acme/app #8 · today.yours");
  assert.equal(entries[1].why, "rv.changes");
  assert.equal(entries[2].why, "today.checksRed");
});

test("the reviews of one ticket are one item, planned for the time of all of them", () => {
  const a = pr();
  const b = pr({ number: 8, url: "u8", repo: "acme/api", author: "cy", created: iso(at(7)) });
  const c = pr({ number: 9, url: "u9" });
  const entries = kind.entries(
    snap({
      prs: { review: [a, b, c], mine: [] },
      tickets: { [a.url]: ticket, u8: ticket },
    }),
    words,
    NOW,
  );
  assert.equal(entries.length, 2);
  const [group, alone] = entries;
  assert.equal(group.id, groupId("prod", "9"));
  assert.equal(group.times, 2);
  assert.equal(group.at, at(7), "from the oldest");
  assert.equal(group.title, '#212 Export · today.prsCount {"n":2}');
  assert.equal(group.where, "acme/app #7, acme/api #8 · bob, cy");
  assert.equal(alone.id, "review:u9");
  assert.equal(alone.times, 1);
  assert.deepEqual(group.subject.type === "pr" && group.subject.prs?.map(x => x.number), [7, 8]);
});

test("a ticket with one PR does not group", () => {
  const a = pr();
  const [only] = kind.entries(snap({ prs: { review: [a], mine: [] }, tickets: { [a.url]: ticket } }), words, NOW);
  assert.equal(only.id, `review:${a.url}`);
  assert.equal(only.title, a.title);
});

test("a review offers to review the group together, a lone one by itself; your own PR to fix it", () => {
  const a = pr();
  const b = pr({ number: 8, url: "u8" });
  const [group] = kind.entries(
    snap({ prs: { review: [a, b], mine: [] }, tickets: { [a.url]: ticket, u8: ticket } }),
    words,
    NOW,
  );
  const together = kind.actions(group as EntryOf<"pr">, flags, words);
  assert.deepEqual(
    together.acts.map(x => x.id),
    ["reviewTogether", "github", "inRelay", "reviewChat", "findTicket"],
  );
  assert.equal(together.done?.label, "today.markReviewed");
  assert.equal(reviewGroupOf(group as EntryOf<"pr">)?.prs.length, 2);
  const [lone] = kind.entries(snap({ prs: { review: [a], mine: [] } }), words, NOW);
  assert.equal(kind.actions(lone as EntryOf<"pr">, flags, words).acts[0].id, "review");
  assert.equal(reviewGroupOf(lone as EntryOf<"pr">), null);
  const [fix] = kind.entries(snap({ prs: { review: [], mine: [pr({ ci: "ERROR" })] } }), words, NOW);
  const fixing = kind.actions(fix as EntryOf<"pr">, flags, words);
  assert.deepEqual(
    fixing.acts.map(x => x.id),
    ["fix", "github", "inRelay", "findTicket"],
  );
  assert.equal(fixing.done?.label, "today.status.done");
});

test("your own PRs of one ticket that need you are one fix item", () => {
  const a = pr({ ci: "FAILURE" });
  const b = pr({ number: 8, url: "u8", repo: "acme/api", review: "CHANGES_REQUESTED" });
  const entries = kind.entries(
    snap({ prs: { review: [], mine: [a, b] }, tickets: { [a.url]: ticket, u8: ticket } }),
    words,
    NOW,
  );
  assert.equal(entries.length, 1);
  const [fix] = entries;
  assert.equal(fix.id, `fix:${groupId("prod", "9")}`);
  assert.equal(fix.where, "acme/app #7, acme/api #8 · today.yours");
  assert.equal(fix.why, "rv.changes");
  assert.equal(reviewGroupOf(fix as EntryOf<"pr">), null, "not a review");
  assert.deepEqual(fix.subject.type === "pr" && fix.subject.prs?.map(x => x.number), [7, 8]);
});
