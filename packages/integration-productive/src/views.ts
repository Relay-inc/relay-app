import type { ViewFilters } from "@relay/board-core";

// A Productive saved view (a `filter` record) as a preset: its conditions in the board's facets, kept apart from
// index.ts so tests/views.test.ts can run it without a webview. Values become names, as the cards carry them.
// The board only has a folder's open tasks in active lists, so asking for open/active is no condition at all;
// anything else the board can't filter on (dates, custom fields, "or", "not") leaves the view unusable: null.

export type Names = { status: Map<string, string>; who: Map<string, string>; list: Map<string, string>; me: string };
const STATE: Record<string, string> = { "1": "todo", "2": "doing", "3": "done" };
const OPEN = new Set(["status", "folder_status", "task_list_status", "project.status"]);

// the conditions of an "and" tree: { "$op": "and", "0": {...}, field: {...} }; null when there is an "or" in it
function conditions(p: Record<string, any>): [string, any][] | null {
  const kids = Object.entries(p).filter(([k]) => /^\d+$/.test(k));
  if (p.$op === "or" && kids.length + Object.keys(p).filter(k => k !== "$op" && !/^\d+$/.test(k)).length > 1) return null;
  const out = Object.entries(p).filter(([k]) => k !== "$op" && !/^\d+$/.test(k));
  for (const [, kid] of kids) {
    const c = conditions(kid || {});
    if (!c) return null;
    out.push(...c);
  }
  return out;
}
const list = (v: unknown) => (Array.isArray(v) ? v : [v]).map(x => (x == null ? null : String(x)));

export function toFilters(params: Record<string, any> | null, names: Names): ViewFilters | null {
  const conds = conditions(params || {});
  if (!conds) return null;
  const out: ViewFilters = {};
  for (const [field, raw] of conds) {
    const ops = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { eq: raw };
    if (field === "task_list_id" && Object.keys(ops).join() === "not_eq" && list(ops.not_eq).every(x => x == null)) continue;
    if (Object.keys(ops).join() !== "eq") return null;
    const ids = list(ops.eq);
    if (OPEN.has(field)) {
      if (ids.includes("1")) continue;
      return null;
    }
    const map = (facet: keyof ViewFilters, lookup: (id: string) => string | undefined) => {
      const values = ids.map(id => (id == null ? undefined : lookup(id)));
      if (values.some(v => v == null)) return false;
      out[facet] = [...(out[facet] ?? []), ...(values as string[])];
      return true;
    };
    const ok =
      field === "workflow_status_category_id" ? map("state", id => STATE[id])
      : field === "workflow_status_id" ? map("status", id => names.status.get(id))
      : field === "assignee_id" ? map("who", id => names.who.get(id === "{me}" ? names.me : id))
      : field === "task_list_id" ? map("list", id => names.list.get(id))
      : field === "tags" ? map("label", id => id)
      : false;
    if (!ok) return null;
  }
  return out;
}

/** Productive's layout_id as the board's view. Not documented: 100 is the list (its views carry columns), 101 the board
 * (the default, and the status board Active sprint); table, Gantt and calendar (103-105) the board doesn't have. */
export const toLayout = (layoutId: number | null) => (layoutId === 100 ? "list" : layoutId === 101 ? "kanban" : undefined);

/** Productive's group_by ("task-list,task", "workflow-status,task") as the board's grouping, when it has it. */
export const toGroup = (groupBy: string | null) =>
  groupBy?.startsWith("task-list") ? "list" : groupBy?.startsWith("workflow-status") ? "status" : undefined;
