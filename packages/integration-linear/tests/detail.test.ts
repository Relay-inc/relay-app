import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ASSIGN, COMMENT, UPLOAD, ATTACH, DETAIL, COMMENTS, HISTORY, FILES, LABELS, PEOPLE, WORKFLOW, mapDetail, pages, linearTicket } from "../src/detail.ts";
import { MOVE } from "../src/map.ts";
import type { Ctx } from "@relay/board-core";
const issue = { id: "issue", identifier: "ENG-12", title: "Ticket", description: "**Hello**", url: "https://linear.app/team/issue/ENG-12", createdAt: "2026-01-01", team: { id: "team", name: "Engineering" }, state: { id: "doing", name: "Doing", type: "started" }, assignee: null };
const ref = { provider: "linear", project: "old-team", board: "project" };
const calls: any[] = [];
function context(): Ctx {
  return { config: {}, thumb: async () => "", upload: async (url, headers, file) => { calls.push(["upload", url, headers, file.name]); return ""; },
    call: async (_m, _p, body: any) => {
      calls.push(body);
      const q = body.query;
      if (q === DETAIL) return { data: { issue } };
      const field = new Map([[COMMENTS, "comments"], [HISTORY, "history"], [FILES, "attachments"], [LABELS, "labels"], [PEOPLE, "members"], [WORKFLOW, "states"]]).get(q);
      if (field) return { data: { [q === PEOPLE || q === WORKFLOW ? "team" : "issue"]: { [field]: { nodes: [], pageInfo: { hasNextPage: false } } } } };
      if (q === UPLOAD) return { data: { fileUpload: { success: true, uploadFile: { uploadUrl: "https://storage.googleapis.com/linear/file?signature=x", assetUrl: "https://uploads.linear.app/file", headers: [{ key: "x-goog-test", value: "signed" }] } } } };
      return { data: { [q === COMMENT ? "commentCreate" : q === ATTACH ? "attachmentCreate" : "issueUpdate"]: { success: true } } };
    } };
}
test("detail maps closed states, unassigned issues, sorted feed and attachment links", () => {
  const v = mapDetail({ ...issue, state: { id: "done", name: "Done", type: "completed" } }, [{ createdAt: "2026-01-02", body: "**Comment**", user: { name: "Alice" } }], [{ createdAt: "2026-01-03", fromState: { name: "Doing" }, toState: { name: "Done" }, actor: { name: "Bob" } }], [{ id: "f", title: "Doc", url: "javascript:bad" }], [{ name: "bug" }], [{ id: "done", name: "Done", type: "completed" }, { id: "todo", name: "Todo", type: "unstarted" }], [{ id: "a", name: "Alice", active: true }, { id: "b", name: "Disabled", active: false }]);
  assert.equal(v.closed, true);
  assert.equal(v.assignee, undefined);
  assert.equal(v.feed[0].change, "Status: Doing → Done");
  assert.match(v.feed[1].html, /<strong>Comment/);
  assert.deepEqual(v.statuses?.map(s => s.id), ["todo", "done"]);
  assert.deepEqual(v.people?.map(p => p.id), ["a"]);
  assert.equal(v.files?.[0].url, "");
});
test("pagination follows cursors and refuses non-advancing pages", async () => {
  const c = context(); let n = 0;
  c.call = async (_m, _p, b: any) => { n++; assert.equal(b.variables.after, n === 1 ? null : "next"); return { data: { issue: { comments: { nodes: [n], pageInfo: { hasNextPage: n === 1, endCursor: "next" } } } } }; };
  assert.deepEqual(await pages(c, COMMENTS, "issue", "issue", "comments"), [1, 2]);
  c.call = async () => ({ data: { issue: { comments: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } } });
  await assert.rejects(pages(c, COMMENTS, "issue", "issue", "comments"), /did not advance/);
});
test("writes use exact mutations and use the issue's current team for pickers", async () => {
  calls.length = 0; const c = context();
  for (const [action, value] of [["status", "done"], ["assignee", ""], ["comment", "Hello"]]) await linearTicket.detail.act!(c, ref, "issue", action, { value, files: [] });
  assert.ok(calls.some(c => c.query === MOVE && c.variables.stateId === "done"));
  assert.ok(calls.some(c => c.query === ASSIGN && c.variables.assigneeId === null));
  assert.ok(calls.some(c => c.query === COMMENT && c.variables.body === "Hello"));
  assert.ok(calls.some(c => c.query === PEOPLE && c.variables.id === "team"));
  assert.equal(linearTicket.detail.cached("issue")?.number, "ENG-12");
  linearTicket.reset(); assert.equal(linearTicket.detail.cached("issue"), undefined);
});
test("files upload with signed headers before linking to the issue", async () => {
  calls.length = 0;
  await linearTicket.detail.act!(context(), ref, "issue", "attach", { value: "", files: [new File(["hello"], "test.txt", { type: "text/plain" })] });
  assert.equal(calls[0].query, UPLOAD);
  assert.equal(calls[1][0], "upload");
  assert.equal(calls[1][2]["x-goog-test"], "signed");
  assert.equal(calls[2].query, ATTACH);
  assert.deepEqual(calls[2].variables, { id: "issue", title: "test.txt", url: "https://uploads.linear.app/file" });
});
test("failed writes and uploads reject instead of reporting success", async () => {
  const c = context(); c.call = async () => ({ data: { issueUpdate: { success: false } } });
  await assert.rejects(linearTicket.detail.act!(c, ref, "issue", "assignee", { value: "", files: [] }), /refused/);
  c.call = async () => ({ errors: [{ message: "Forbidden" }] });
  await assert.rejects(linearTicket.detail.fetch(c, ref, "issue"), /Forbidden/);
  const upload = context(); upload.upload = async () => { throw new Error("upload failed"); }; calls.length = 0;
  await assert.rejects(linearTicket.detail.act!(upload, ref, "issue", "attach", { value: "", files: [new File(["x"], "x")] }), /upload failed/);
  assert.ok(!calls.some(c => c.query === ATTACH));
});
test("backend and frontend agree on each allowed mutation", () => {
  const rust = readFileSync(new URL("../src/lib.rs", import.meta.url), "utf8");
  for (const q of [ASSIGN, COMMENT, UPLOAD, ATTACH]) assert.ok(rust.includes(`= "${q}";`));
});
