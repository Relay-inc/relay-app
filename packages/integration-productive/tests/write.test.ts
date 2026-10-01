// What the panel writes to Productive, against a fake call context, no network: `pnpm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toHtml, uploadFile } from "../src/write.ts";

test("a comment becomes escaped HTML paragraphs", () => {
  assert.equal(toHtml("Hi <b>you</b>\nline two\n\nnext & last\n"), "<p>Hi &lt;b&gt;you&lt;/b&gt;<br>line two</p><p>next &amp; last</p>");
});

test("a file: the record, the bytes to S3 with the policy, then where they landed", async () => {
  const calls: any[] = [], ups: any[] = [];
  const answers = [{ data: { id: "9", attributes: { aws_policy: { url: "https://b.s3.amazonaws.com/", key: "up/9/a b.pdf", policy: "p", "x-amz-signature": "s", empty: null } } } }, {}];
  const c: any = { config: {}, call: async (...a: any[]) => { calls.push(a); return answers.shift(); }, upload: async (...a: any[]) => { ups.push(a); return ""; } };
  const f = new File(["abc"], "a b.pdf", { type: "application/pdf" });
  assert.equal(await uploadFile(c, f), "9");
  assert.deepEqual(calls[0], ["POST", "/attachments", { data: { type: "attachments", attributes: { name: "a b.pdf", content_type: "application/pdf", size: 3, attachable_type: "task" } } }]);
  assert.deepEqual(ups[0].slice(0, 2), ["https://b.s3.amazonaws.com/", { key: "up/9/a b.pdf", policy: "p", "x-amz-signature": "s" }]);
  // no Location from S3: the bucket and the key
  assert.deepEqual(calls[1], ["PATCH", "/attachments/9", { data: { type: "attachments", id: "9", attributes: { temp_url: "https://b.s3.amazonaws.com/up/9/a%20b.pdf" } } }]);
});
