import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPrefix, isFilter, matchesLabel, queryOf, takeFilters } from "./search.ts";

test("a finished filter becomes a pill, the text stays to type", () => {
  assert.deepEqual(takeFilters("type:Document in:Studio pricewise rate"), {
    filters: ["type:Document", "in:Studio"],
    rest: "pricewise rate",
  });
  // still being typed: no pill yet
  assert.deepEqual(takeFilters("type:Document in:Stu"), { filters: ["type:Document"], rest: "in:Stu" });
  assert.deepEqual(takeFilters("type:"), { filters: [], rest: "type:" });
  assert.deepEqual(takeFilters("type: rate"), { filters: [], rest: "type: rate" });
  assert.deepEqual(takeFilters('rate in:"Client Work" #plan limit'), {
    filters: ['in:"Client Work"', "#plan"],
    rest: "rate limit",
  });
  assert.deepEqual(takeFilters("plain words "), { filters: [], rest: "plain words " });
});

test("the query the backend gets is the pills and the text", () => {
  assert.equal(queryOf(["type:Document", "in:Studio"], "pricewise rate"), "type:Document in:Studio pricewise rate");
  assert.equal(queryOf([], "  rate "), "rate");
  assert.equal(queryOf(["#plan"], ""), "#plan");
});

test("filters are told from words", () => {
  assert.ok(isFilter("type:Document") && isFilter("in:Studio") && isFilter("#tag"));
  assert.ok(!isFilter("type:") && !isFilter("#") && !isFilter("typed") && !isFilter("in"));
  assert.ok(filterPrefix("rate in:") && filterPrefix("#pl") && !filterPrefix("rate in: x"));
});

test("an action matches when its label has every word", () => {
  assert.ok(matchesLabel("Open today's note", "today note"));
  assert.ok(matchesLabel("New Meeting in Beacon", "meet"));
  assert.ok(!matchesLabel("New Meeting", "meeting beacon"));
  assert.ok(!matchesLabel("New Meeting", "  "));
});
