// Trello response mapping on fixture JSON, no network: `pnpm test` (node --test with type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapBoards, mapCards, mapColumns, PERSONAL } from "../src/providers/trello-map.ts";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/trello-${n}.json`, import.meta.url), "utf8"));

test("boards group under their workspace, the rest under personal", () => {
  const r = mapBoards(fx("boards"), fx("orgs"), "Personal");
  assert.deepEqual(r.projects, [{ id: "600000000000000000000a01", name: "Antenna" }, { id: PERSONAL, name: "Personal" }]);
  assert.deepEqual(r.boards.map(b => [b.name, b.project, b.group]), [
    ["Website", "600000000000000000000a01", "Antenna"], ["Groceries", PERSONAL, "Personal"], ["Client board", PERSONAL, "Personal"]]);
});

test("columns are the open lists in board order", () => {
  assert.deepEqual(mapColumns(fx("lists")).map(c => [c.name, c.placement]), [["To do", 16384], ["Doing", 32768], ["Done", 49152.5]]);
});

test("cards carry number, list, due day and the first name of the first member", () => {
  const [a, b] = mapCards(fx("cards"));
  assert.deepEqual(a, { id: "600000000000000000000d01", title: "Fix the header", number: "12", column: "600000000000000000000c01",
    placement: 65535, due: "2026-10-03", who: "Kristof" });
  assert.equal(b.due, null);
  assert.equal(b.who, "");
});

test("assigned to me keeps only my cards", () => {
  assert.deepEqual(mapCards(fx("cards"), "600000000000000000000e01").map(c => c.id), ["600000000000000000000d01"]);
  assert.equal(mapCards(fx("cards"), "600000000000000000000eff").length, 0);
});
