// Productive's saved views as presets, no network: `pnpm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toFilters, toGroup, toLayout } from "../src/views.ts";

const names = { status: new Map([["7", "In review"]]), who: new Map([["96137", "Kristof"]]), list: new Map([["3", "Sprint 4"]]), me: "96137" };

test("a view's conditions become the board's facets, in names", () => {
  // the two Spardex views: nested "and" trees
  assert.deepEqual(toFilters({ 0: { 0: { task_list_id: { not_eq: null } }, $op: "and" }, $op: "and" }, names), {});
  assert.deepEqual(toFilters({ 0: { 0: { workflow_status_category_id: { eq: ["1", "2", "3"] } }, $op: "and" }, $op: "and" }, names), { state: ["todo", "doing", "done"] });
  // flat, bare values, {me}, and asking for open tasks (all the board has) is no condition
  assert.deepEqual(toFilters({ status: "1", assignee_id: ["{me}"], workflow_status_id: { eq: "7" }, task_list_id: { eq: ["3"] }, tags: { eq: ["bug"] } }, names),
    { who: ["Kristof"], status: ["In review"], list: ["Sprint 4"], label: ["bug"] });
  assert.deepEqual(toFilters(null, names), {});
});

test("what the board can't filter on leaves the view unusable", () => {
  for (const p of [{ status: { eq: "2" } }, { tags: { not_eq: ["x"] } }, { closed_at: { gt_eq: "2026-01-01" } }, { custom_fields: { 2565: { not_eq: null } } },
    { task_list_id: { eq: ["99"] } }, { assignee_id: { eq: ["1"] } }, { $op: "or", 0: { status: "1" }, 1: { tags: ["a"] } }])
    assert.equal(toFilters(p, names), null, JSON.stringify(p));
  assert.deepEqual(toFilters({ $op: "or", 0: { tags: ["a"] } }, names), { label: ["a"] });
});

test("group_by becomes the board's grouping", () => {
  assert.equal(toGroup("task-list,task"), "list");
  assert.equal(toGroup("workflow-status,task"), "status");
  assert.equal(toGroup("project,task"), undefined);
  assert.equal(toGroup(null), undefined);
});

test("layout_id becomes kanban or list, the others leave the board as it is", () => {
  assert.deepEqual([100, 101, 103, null].map(toLayout), ["list", "kanban", undefined, undefined]);
});
