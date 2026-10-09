import { test } from "node:test";
import assert from "node:assert/strict";
import { byTicket, prNumbers } from "./group.ts";
import type { PR } from "./types";

const pr = (number: number, repo = "acme/app"): PR => ({
  number,
  title: `PR ${number}`,
  url: `u${number}`,
  repo,
  draft: false,
  created: "",
  updated: "",
  author: "bob",
  review: null,
  ci: null,
  project: "p",
});
const ticket = { provider: "prod", card: "9", number: "452", title: "Certificates" };

test("the PRs of one ticket go together at the first one's place, across repos", () => {
  const groups = byTicket([pr(1), pr(2, "acme/front"), pr(3), pr(4)], {
    u1: ticket,
    u3: ticket,
    u4: { ...ticket, card: "10" },
  });
  assert.deepEqual(
    groups.map(g => [g.key, g.ticket?.number, g.prs.map(x => x.number)]),
    [
      ["prod:9", "452", [1, 3]],
      ["u2", undefined, [2]],
      ["u4", undefined, [4]],
    ],
  );
});

test("PR numbers name the repo once per run of the same repo", () => {
  assert.equal(prNumbers([pr(7), pr(8)]), "acme/app #7, #8");
  assert.equal(prNumbers([pr(193, "l/front"), pr(140, "l/back")]), "l/front #193, l/back #140");
});
