import { test } from "node:test";
import assert from "node:assert/strict";
import { buildsToShow, prsOf, ticketsOf, waitingOf } from "./rules.ts";
import type { Card } from "../board/types";
import type { PR } from "../pull-requests/types";

const card = (over: Partial<Card>): Card => ({
  id: "1",
  title: "t",
  number: "1",
  column: "c",
  placement: 0,
  due: null,
  who: "Sofie",
  me: true,
  ...over,
});
const pr = (over: Partial<PR>): PR => ({
  number: 1,
  title: "t",
  url: "u",
  repo: "orchard-web",
  draft: false,
  created: "",
  updated: "",
  author: "Tom",
  review: null,
  ci: null,
  project: "Orchard",
  ...over,
});

test("waiting: only this project's agent and review items, agents first, at most 3", () => {
  const entry = (kind: string, project: string | null, rank: number, at = 0) => ({ kind, project, rank, at }) as never;
  const { rows, total } = waitingOf(
    [
      entry("review", "Orchard", 1),
      entry("ask", "Orchard", 0, 2),
      entry("ask", "Harbor", 0),
      entry("card", "Orchard", 4),
      entry("ask", "Orchard", 0, 1),
      entry("fix", "Orchard", 1),
      entry("mail", "Orchard", 3),
    ],
    "Orchard",
  );
  assert.equal(total, 4);
  assert.deepEqual(
    rows.map(row => [row.kind, row.at]),
    [
      ["ask", 1],
      ["ask", 2],
      ["review", 0],
    ],
  );
});

test("tickets: mine and open, in progress first, then due date, capped at 3 with the total", () => {
  const { rows, total } = ticketsOf([
    card({ id: "a", state: "todo", due: "2026-12-01" }),
    card({ id: "b", state: "doing", due: null, placement: 2 }),
    card({ id: "c", state: "done" }),
    card({ id: "d", me: false, state: "doing" }),
    card({ id: "e", state: "todo", due: "2026-11-30" }),
    card({ id: "f", state: "doing", due: "2026-11-29" }),
    card({ id: "g", state: "todo", due: null }),
  ]);
  assert.equal(total, 5);
  assert.deepEqual(
    rows.map(row => row.id),
    ["f", "b", "e"],
  );
});

test("builds: failed and running only", () => {
  const list = [{ tone: "fail" }, { tone: "busy" }, { tone: "ok" }, { tone: "none" }] as const;
  assert.deepEqual(buildsToShow([...list]), [{ tone: "fail" }, { tone: "busy" }]);
  assert.deepEqual(buildsToShow([{ tone: "ok" as const }]), []);
});

test("PRs: this project's open ones, and those that wait on the user", () => {
  const list = {
    review: [pr({ number: 1 }), pr({ number: 2, project: "Harbor" })],
    mine: [
      pr({ number: 3, review: "CHANGES_REQUESTED" }),
      pr({ number: 4, ci: "SUCCESS" }),
      pr({ number: 5, ci: "FAILURE", project: "Harbor" }),
    ],
  };
  assert.deepEqual(prsOf(list, "Orchard"), { open: 3, waiting: 2 });
  assert.deepEqual(prsOf(null, "Orchard"), { open: 0, waiting: 0 });
});
