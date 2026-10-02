import { test } from "node:test";
import assert from "node:assert/strict";
import type { Card } from "./types.ts";
import { NOBODY, NO_LABEL, facetsOf, matches, options, parsePresets, sameFilters, savePreset, tidy } from "./filter.ts";

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  title: `Task ${id}`,
  number: id,
  column: "c",
  placement: 0,
  due: null,
  who: "",
  ...extra,
});
const cards = [
  card("1", { who: "Laurent", state: "doing", status: "In progress", labels: ["contract"] }),
  card("2", { who: "Jana", state: "todo", status: "Backlog" }),
  card("3", { state: "done", status: "Done", labels: ["contract", "client"] }),
];
const ids = (q: string, f: Parameters<typeof matches>[2]) => cards.filter(c => matches(c, q, f)).map(c => c.id);

test("values of one facet are alternatives, facets add up", () => {
  assert.deepEqual(ids("", { state: ["todo", "doing"] }), ["1", "2"]);
  assert.deepEqual(ids("", { state: ["todo", "doing"], who: ["Jana"] }), ["2"]);
  assert.deepEqual(ids("", {}), ["1", "2", "3"]);
});
test("unassigned and no labels can be asked for", () => {
  assert.deepEqual(ids("", { who: [NOBODY] }), ["3"]);
  assert.deepEqual(ids("", { label: [NO_LABEL] }), ["2"]);
  assert.deepEqual(ids("", { label: ["client"] }), ["3"]);
});
test("a card without the facet's field never matches a filter on it", () => {
  assert.deepEqual(ids("", { folder: ["Sprint 14"] }), []);
});
test("the search is on title and number", () => {
  assert.deepEqual(ids("task 2", {}), ["2"]);
  assert.deepEqual(ids("3", { state: ["done"] }), ["3"]);
});
test("options count with the other filters applied, not their own", () => {
  const o = options(cards, "", { state: ["done"] }, "state");
  assert.deepEqual(o, [
    ["doing", 1],
    ["done", 1],
    ["todo", 1],
  ]);
  assert.deepEqual(options(cards, "", { state: ["done"] }, "who"), [[NOBODY, 1]]);
});
test("a chosen value nobody has stays listed with 0", () => {
  assert.deepEqual(
    options(cards, "", { who: ["Sam"] }, "who").find(x => x[0] === "Sam"),
    ["Sam", 0],
  );
});
test("facets are offered only where a card has a value", () => {
  assert.deepEqual(facetsOf(cards), ["state", "status", "who", "label"]);
  assert.deepEqual(facetsOf([card("9")]), []);
});
test("tidy drops values that left the board and empty facets", () => {
  assert.deepEqual(tidy({ who: ["Jana", "Sam"], state: ["gone"] }, cards), { who: ["Jana"] });
});
test("presets: saving under a name replaces, junk in storage is dropped", () => {
  const saved = savePreset(savePreset([], "Mine", { who: ["Jana"] }), "Mine", { who: ["Laurent"], state: [] });
  assert.deepEqual(saved, [{ name: "Mine", filters: { who: ["Laurent"] } }]);
  assert.deepEqual(parsePresets(JSON.stringify([...saved, { name: "", filters: {} }, 7, { name: "x" }])), saved);
  assert.deepEqual(parsePresets("not json"), []);
  assert.deepEqual(parsePresets(null), []);
});
test("sameFilters ignores order and empty facets", () => {
  assert.ok(sameFilters({ who: ["a", "b"], state: [] }, { who: ["b", "a"] }));
  assert.ok(!sameFilters({ who: ["a"] }, { who: ["b"] }));
});
