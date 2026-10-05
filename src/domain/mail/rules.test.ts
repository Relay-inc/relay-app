import { test } from "node:test";
import assert from "node:assert/strict";
import { filtered, nextOpen, ticketPrompt, toggleSelection, withFirstPage } from "./rules.ts";
import type { Mail, MailFilter } from "./types";

const mail = (account: string, id: string, date: string): Mail => ({
  id,
  account,
  date,
  subject: "",
  unread: false,
  from: [],
  to: [],
  attachments: false,
});

test("one account's first page replaces its rows and keeps the other account's", () => {
  const list = [mail("a", "1", "2026-01-05T00:00:00Z"), mail("b", "2", "2026-01-02T00:00:00Z")];
  const next = withFirstPage(list, "a", [mail("a", "3", "2026-01-04T00:00:00Z")]);
  assert.deepEqual(
    next.map(m => m.id),
    ["3", "2"],
    "a row of a not in its newest page is gone (archived), b stays",
  );
  assert.deepEqual(
    withFirstPage(list, "a", []).map(m => m.id),
    ["2"],
    "an empty page empties only that account",
  );
});

const row = (id: string, other = false): Mail => ({ ...mail("a@b.be", id, "2026-10-02T10:00:00Z"), other });
const filter: MailFilter = { q: "", state: "all", project: "", box: "inbox" };
const noProject = () => null;

test("the split puts Other mails in their own box, without it everything is the inbox", () => {
  const list = [row("1"), row("2", true)];
  const ids = (box: MailFilter["box"], split?: boolean) =>
    filtered(list, { ...filter, box }, noProject, split).map(m => m.id);
  assert.deepEqual(ids("inbox", true), ["1"]);
  assert.deepEqual(ids("other", true), ["2"]);
  assert.deepEqual(ids("other"), ["1", "2"]);
});

test("a click ticks one, shift-click ticks the range from the last one", () => {
  const shown = ["k1", "k2", "k3", "k4"];
  let selected = toggleSelection(new Set(), "", "k1", false, shown);
  selected = toggleSelection(selected, "k1", "k3", true, shown);
  assert.deepEqual([...selected].sort(), ["k1", "k2", "k3"]);
  selected = toggleSelection(selected, "k3", "k2", false, shown);
  assert.deepEqual([...selected].sort(), ["k1", "k3"]);
});

test("the mail after the ones that leave opens next, else the one above", () => {
  const shown = ["k1", "k2", "k3", "k4"];
  assert.equal(nextOpen(shown, "k2", new Set(["k2", "k3"])), "k4");
  assert.equal(nextOpen(shown, "k4", new Set(["k4"])), "k3");
  assert.equal(nextOpen(shown, "k1", new Set(shown)), "");
});

test("a ticket prompt uses the linked board, else asks the agent to pick one", () => {
  const linked = ticketPrompt("REF", { provider: "productive", project: "12", board: "34" });
  assert.match(linked, /productive, project 12, bord 34/);
  assert.match(linked, /productive\.create_task/);
  assert.match(linked, /productive\.comment/);
  const free = ticketPrompt("REF");
  assert.match(free, /relay productive\.projects/);
  assert.match(free, /trello\.boards/);
  assert.match(ticketPrompt("REF", { provider: "linear", project: "t", board: "t" }), /geen comment-actie/);
});
