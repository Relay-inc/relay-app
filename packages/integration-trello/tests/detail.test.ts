import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDetail, actions, trelloTicket } from "../src/detail.ts";
import { markdown } from "@relay/board-core/detail";
import type { Ctx } from "@relay/board-core";
const ref = { provider: "trello", project: "workspace", board: "board" };
const card = { id: "card", idBoard: "board", idShort: 12, name: "Ticket", desc: "**Bold**", idList: "list", list: { name: "Doing" }, board: { name: "Website" }, members: [{ id: "a", fullName: "Alice" }, { id: "b", fullName: "Bob" }], attachments: [{ id: "f", name: "File", bytes: 10, url: "https://trello.com/file" }] };
const context = (call: Ctx["call"]): Ctx => ({ config: {}, call, upload: async () => "", thumb: async () => "" });
test("ticket mapping preserves all members, files, markdown and activity", () => {
  const v = mapDetail(card, [{ id: "list", name: "Doing" }], card.members, [{ type: "commentCard", date: "2026-01-01", data: { text: "hello **world**" }, memberCreator: { fullName: "Alice" } }], "workspace");
  assert.deepEqual(v.assignees?.map(p => p.id), ["a", "b"]);
  assert.match(v.description, /<strong>Bold<\/strong>/);
  assert.equal(v.files?.[0].size, 10);
  assert.match(v.feed[0].html, /<strong>world<\/strong>/);
});
test("markdown cannot inject HTML, executable links or remote images", () => {
  const html = markdown('<script>alert(1)</script>\n\n[x](javascript:alert%281%29) ![image](https://example.com/a.png)\n\n<a href="javascript:evil()">bad</a>');
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.com\/a.png"/);
});
test("actions page using the last id", async () => {
  const calls: string[] = [];
  const result = await actions(context(async (_m, path) => { calls.push(path); return calls.length === 1 ? Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })) : [{ id: "old" }]; }), "card");
  assert.equal(result.length, 1001);
  assert.match(calls[1], /before=999$/);
});
test("member writes affect only one member and then fetch current detail", async () => {
  const writes: unknown[] = [];
  const c = context(async (method, path, body) => {
    if (method !== "GET") { writes.push([method, path, body]); return {}; }
    if (path.startsWith("/cards/card?")) return card;
    return [];
  });
  await trelloTicket.detail.act!(c, ref, "card", "member-add", { value: "c", files: [] });
  await trelloTicket.detail.act!(c, ref, "card", "member-remove", { value: "b", files: [] });
  assert.deepEqual(writes, [["POST", "/cards/card/idMembers", { value: "c" }], ["DELETE", "/cards/card/idMembers/b", undefined]]);
  assert.equal(trelloTicket.detail.cached("card")?.title, "Ticket");
  trelloTicket.reset();
  assert.equal(trelloTicket.detail.cached("card"), undefined);
});
test("comments and files use the provider API, errors propagate", async () => {
  const calls: unknown[] = [];
  const c = context(async (method, path, body) => {
    if (method !== "GET") { calls.push([method, path, body]); return {}; }
    return path.startsWith("/cards/card?") ? card : [];
  });
  c.upload = async (url, fields, file) => { calls.push([url, fields, file.name]); return ""; };
  await trelloTicket.detail.act!(c, ref, "card", "comment", { value: "hello", files: [] });
  await trelloTicket.detail.act!(c, ref, "card", "attach", { value: "", files: [new File(["x"], "x.txt")] });
  assert.deepEqual(calls, [["POST", "/cards/card/actions/comments", { text: "hello" }], ["https://api.trello.com/1/cards/card/attachments", {}, "x.txt"]]);
  c.call = async () => { throw new Error("denied"); };
  await assert.rejects(trelloTicket.detail.act!(c, ref, "card", "comment", { value: "hello", files: [] }), /denied/);
});
