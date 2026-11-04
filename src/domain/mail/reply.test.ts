import { test } from "node:test";
import assert from "node:assert/strict";
import { draftMessage, quoted, recipients, replySubject, type Original } from "./reply.ts";

const mail = (over: Partial<Original> = {}): Original => ({
  from: [{ name: "Sofie", email: "sofie@example.com" }],
  to: [
    { name: null, email: "me@example.com" },
    { name: "Jana", email: "jana@example.com" },
  ],
  cc: [
    { name: null, email: "ME@example.com" },
    { name: "Arne", email: "arne@example.com" },
  ],
  replyTo: [],
  subject: "Rate",
  messageId: "abc@example.com",
  references: "<root@example.com>",
  date: "1 Oct 2026 09:12",
  text: "Can you confirm?\n\nSofie",
  ...over,
});
const emails = (list: { email: string }[]) => list.map(a => a.email);

test("reply goes to the sender, or to Reply-To; reply all adds To and Cc without me", () => {
  assert.deepEqual(emails(recipients(mail(), "reply", ["me@example.com"]).to), ["sofie@example.com"]);
  assert.deepEqual(recipients(mail(), "reply", ["me@example.com"]).cc, []);
  const all = recipients(mail(), "all", ["me@example.com"]);
  assert.deepEqual(emails(all.to), ["sofie@example.com"]);
  assert.deepEqual(emails(all.cc), ["jana@example.com", "arne@example.com"]);
  assert.deepEqual(
    emails(recipients(mail({ replyTo: [{ name: null, email: "list@example.com" }] }), "reply", ["me@example.com"]).to),
    ["list@example.com"],
  );
});

test("a reply to my own mail goes back to whom I wrote; a forward starts empty", () => {
  const mine = mail({ from: [{ name: null, email: "me@example.com" }] });
  assert.deepEqual(emails(recipients(mine, "reply", ["me@example.com"]).to), ["jana@example.com"]);
  assert.deepEqual(recipients(mail(), "fwd", ["me@example.com"]), { to: [], cc: [] });
});

test("subject prefixes once", () => {
  assert.equal(replySubject("Rate", "reply"), "Re: Rate");
  assert.equal(replySubject("RE: Rate", "all"), "RE: Rate");
  assert.equal(replySubject("Rate", "fwd"), "Fwd: Rate");
  assert.equal(replySubject("Fwd: Rate", "fwd"), "Fwd: Rate");
});

test("the quote and the draft: threading headers, encoded names, no header injection", () => {
  assert.match(
    quoted(mail(), "reply"),
    /^On 1 Oct 2026 09:12, Sofie <sofie@example.com> wrote:\n> Can you confirm\?\n>\n> Sofie$/,
  );
  assert.match(quoted(mail(), "fwd"), /Forwarded message[\s\S]*Subject: Rate/);
  const raw = draftMessage({
    from: "me@example.com",
    to: [{ name: "Sofie Ëxample", email: "sofie@example.com" }],
    cc: [{ name: 'A "B"', email: "arne@example.com" }],
    subject: "Re: Prijs\r\nBcc: evil@example.com",
    inReplyTo: "abc@example.com",
    references: "<root@example.com>",
    body: "Ja.\nTot straks",
  });
  assert.match(raw, /^From: me@example\.com\r\n/);
  assert.match(raw, /\r\nTo: =\?UTF-8\?B\?[^?]+\?= <sofie@example\.com>\r\n/);
  assert.match(raw, /\r\nCc: "A \\"B\\"" <arne@example\.com>\r\n/);
  assert.match(raw, /\r\nSubject: Re: Prijs Bcc: evil@example\.com\r\n/, "a line break in a header is flattened");
  assert.match(raw, /\r\nIn-Reply-To: <abc@example\.com>\r\nReferences: <root@example\.com> <abc@example\.com>\r\n/);
  assert.ok(raw.endsWith("\r\n\r\nJa.\r\nTot straks"));
});
