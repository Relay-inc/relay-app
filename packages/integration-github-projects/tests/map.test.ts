// GitHub Projects response mapping on fixture JSON, no network: `pnpm test` (node --test with type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allItems, mapBoards, mapColumns, mapField, NONE } from "../src/map.ts";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));

test("the user and their organizations are projects, their open projects the boards", () => {
  const r = mapBoards(fx("boards").data);
  assert.equal(r.login, "octo");
  assert.deepEqual(r.projects, [{ id: "octo", name: "Octo Cat" }, { id: "acme", name: "Acme" }, { id: "sso-org", name: "sso-org" }]);
  assert.deepEqual(r.boards.map(b => [b.project, b.name]), [["octo", "Side project"], ["acme", "Roadmap"], ["acme", "Website"]]);
});

test("the Status field makes the columns, No status first, each with the kind its name says", () => {
  const { field, url } = mapField(fx("fields").data);
  assert.equal(field?.id, "PVTSSF_st");
  assert.equal(url, "https://github.com/orgs/acme/projects/3");
  const cols = mapColumns(field, "No status");
  assert.deepEqual(cols.map(c => [c.id, c.name, c.state, c.placement]), [[NONE, "No status", "todo", 0], ["aa01", "Todo", "todo", 1], ["aa02", "In Progress", "doing", 2], ["aa03", "Done", "done", 3]]);
  assert.equal(mapField({ node: { fields: { nodes: [{ id: "x", name: "Size", options: [] }] } } }).field?.name, "Size");
  assert.equal(mapField({ node: { fields: { nodes: [{}] } } }).field, null);
});

test("items are cards over every page: archived ones out, drafts without a status in No status", async () => {
  const { field } = mapField(fx("fields").data);
  const pages = [fx("items-1").data, fx("items-2").data], asked: (string | null)[] = [];
  const r = await allItems(async after => { asked.push(after); return pages[asked.length - 1]; }, field, "octo");
  assert.deepEqual(asked, [null, "c1"]);
  assert.deepEqual(r.cards.map(c => [c.id, c.column, c.placement]), [["PVTI_1", "aa02", 0], ["PVTI_2", NONE, 1], ["PVTI_4", "aa03", 2]]);
  assert.deepEqual(r.cards[0], { id: "PVTI_1", title: "Github Projects as board?", number: "482", column: "aa02", placement: 0, due: null, who: "Octo",
    whoName: "Octo Cat", me: true, status: "In Progress", state: "doing", tone: "active", labels: ["idea"], updated: "2026-11-09T10:00:00Z" });
  assert.equal(r.cards[1].number, "");
  assert.deepEqual([r.cards[2].who, r.cards[2].me, r.cards[2].state], ["jdoe", false, "done"]);
  assert.deepEqual(r.urls, [["PVTI_1", "https://github.com/acme/app/issues/482"], ["PVTI_4", "https://github.com/acme/app/pull/490"]]);
});
