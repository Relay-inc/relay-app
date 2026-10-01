// Linear response mapping on fixture JSON, no network: `pnpm test` (node --test with type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allIssues, issueFilter, mapIssues, mapStates, mapTeams, MAX_PAGES } from "../src/map.ts";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const T1 = "b0000000-0000-4000-8000-000000000001";

test("teams are projects, each with the whole team first and then its projects", () => {
  const r = mapTeams(fx("teams").data, "All issues");
  assert.deepEqual(r.projects.map(p => p.name), ["Antenna", "Website"]);
  assert.deepEqual(r.boards.map(b => [b.group, b.name, b.id === b.project]), [
    ["Antenna", "All issues", true], ["Antenna", "Onboarding", false], ["Antenna", "Vault app", false], ["Website", "All issues", true]]);
});

test("columns are workflow states by type then position, closed ones only on request", () => {
  assert.deepEqual(mapStates(fx("states").data, false).map(c => c.name), ["Triage", "Backlog", "Todo", "In Progress", "In Review"]);
  const all = mapStates(fx("states").data, true);
  assert.deepEqual(all.map(c => c.name).slice(-2), ["Done", "Canceled"]);
  assert.deepEqual(all.map(c => c.placement), [0, 1, 2, 3, 4, 5, 6]);
});

test("the filter narrows to a project and to open states", () => {
  assert.deepEqual(issueFilter({ provider: "linear", project: T1, board: T1 }, true), { team: { id: { eq: T1 } } });
  assert.deepEqual(issueFilter({ provider: "linear", project: T1, board: "c1" }, false),
    { team: { id: { eq: T1 } }, project: { id: { eq: "c1" } }, state: { type: { nin: ["completed", "canceled"] } } });
});

test("issues carry identifier, state, assignee's first name, priority and url", () => {
  const r = mapIssues(fx("issues-1").data);
  assert.deepEqual(r.cards[0], { id: "d0000000-0000-4000-8000-000000000001", title: "Fix the header", number: "ANT-12", column: "s-todo",
    placement: -42.5, due: "2026-10-03", who: "kristof", priority: 1 });
  assert.equal(r.cards[1].who, "");
  assert.equal(r.cards[1].due, null);
  assert.equal(r.urls[1][1], "https://linear.app/antenna/issue/ANT-13/write-docs");
  assert.equal(r.next, "cursor-1");
  assert.equal(mapIssues(fx("issues-2").data).cards[0].who, "Jan");
});

test("pages are followed by cursor until the last, and capped", async () => {
  const seen: (string | null)[] = [];
  const r = await allIssues(async after => { seen.push(after); return fx(after ? "issues-2" : "issues-1").data; });
  assert.deepEqual(seen, [null, "cursor-1"]);
  assert.deepEqual(r.cards.map(c => c.number), ["ANT-12", "ANT-13", "ANT-14"]);
  let n = 0;
  await allIssues(async () => { n++; return fx("issues-1").data; });
  assert.equal(n, MAX_PAGES);
});

test("an issue carries its state kind, status name, labels and last update when Linear sends them", () => {
  const [c] = mapIssues({ issues: { nodes: [{ id: "i", identifier: "A-1", title: "t", state: { id: "s", name: "In Review", type: "started" },
    labels: { nodes: [{ name: "bug" }] }, updatedAt: "2026-09-30T10:00:00Z" }], pageInfo: {} } }).cards;
  assert.deepEqual([c.state, c.status, c.labels, c.updated], ["doing", "In Review", ["bug"], "2026-09-30T10:00:00Z"]);
  assert.equal(mapStates(fx("states").data, true).find(s => s.name === "Done")?.state, "done");
});
