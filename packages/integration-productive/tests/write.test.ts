// What the panel writes to Productive, against a fake call context, no network: `pnpm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { showMentions, toHtml, uploadFile } from "../src/write.ts";

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

test("a picked person becomes Productive's mention; reading turns it back into @Name", () => {
  const html = toHtml("@Jan Tubeeckx can you check? cc @Jan", [{ id: "903775", name: "Jan Tubeeckx" }, { id: "1", name: "Jan" }]);
  assert.equal(
    html,
    '<p>@[{"type":"person","id":"903775","label":"Jan Tubeeckx","avatar_url":null,"attachment_url":null,"is_done":true}] can you check? cc @[{"type":"person","id":"1","label":"Jan","avatar_url":null,"attachment_url":null,"is_done":true}]</p>',
  );
  assert.equal(toHtml("mail @Janine", [{ id: "1", name: "Jan" }]), "<p>mail @Janine</p>", "only the whole name");
  assert.equal(showMentions(html), "<p><b>@Jan Tubeeckx</b> can you check? cc <b>@Jan</b></p>");
  assert.equal(showMentions("<p>@[not json]</p>"), "<p>@[not json]</p>");
});
