import { test } from "node:test";
import assert from "node:assert/strict";
import { draftMessage, quoted, recipients, replySubject, type Original } from "./reply.ts";

const mail = (over: Partial<Original> = {}): Original => ({
  from: [{ name: "Pieter", email: "pieter@x.be" }],
  to: [
    { name: null, email: "me@antenna.be" },
    { name: "Jana", email: "jana@x.be" },
  ],
  cc: [
    { name: null, email: "ME@antenna.be" },
    { name: "Arne", email: "arne@x.be" },
  ],
  replyTo: [],
  subject: "Rate",
  messageId: "abc@x.be",
  references: "<root@x.be>",
  date: "1 Oct 2026 09:12",
  text: "Can you confirm?\n\nPieter",
  ...over,
});
const emails = (list: { email: string }[]) => list.map(a => a.email);

test("reply goes to the sender, or to Reply-To; reply all adds To and Cc without me", () => {
  assert.deepEqual(emails(recipients(mail(), "reply", ["me@antenna.be"]).to), ["pieter@x.be"]);
  assert.deepEqual(recipients(mail(), "reply", ["me@antenna.be"]).cc, []);
  const all = recipients(mail(), "all", ["me@antenna.be"]);
  assert.deepEqual(emails(all.to), ["pieter@x.be"]);
  assert.deepEqual(emails(all.cc), ["jana@x.be", "arne@x.be"]);
  assert.deepEqual(
    emails(recipients(mail({ replyTo: [{ name: null, email: "list@x.be" }] }), "reply", ["me@antenna.be"]).to),
    ["list@x.be"],
  );
});

test("a reply to my own mail goes back to whom I wrote; a forward starts empty", () => {
  const mine = mail({ from: [{ name: null, email: "me@antenna.be" }] });
  assert.deepEqual(emails(recipients(mine, "reply", ["me@antenna.be"]).to), ["jana@x.be"]);
  assert.deepEqual(recipients(mail(), "fwd", ["me@antenna.be"]), { to: [], cc: [] });
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
    /^On 1 Oct 2026 09:12, Pieter <pieter@x.be> wrote:\n> Can you confirm\?\n>\n> Pieter$/,
  );
  assert.match(quoted(mail(), "fwd"), /Forwarded message[\s\S]*Subject: Rate/);
  const raw = draftMessage({
    from: "me@antenna.be",
    to: [{ name: "Pieter Ëxample", email: "pieter@x.be" }],
    cc: [{ name: 'A "B"', email: "arne@x.be" }],
    subject: "Re: Prijs\r\nBcc: evil@x.be",
    inReplyTo: "abc@x.be",
    references: "<root@x.be>",
    body: "Ja.\nTot straks",
  });
  assert.match(raw, /^From: me@antenna\.be\r\n/);
  assert.match(raw, /\r\nTo: =\?UTF-8\?B\?[^?]+\?= <pieter@x\.be>\r\n/);
  assert.match(raw, /\r\nCc: "A \\"B\\"" <arne@x\.be>\r\n/);
  assert.match(raw, /\r\nSubject: Re: Prijs Bcc: evil@x\.be\r\n/, "a line break in a header is flattened");
  assert.match(raw, /\r\nIn-Reply-To: <abc@x\.be>\r\nReferences: <root@x\.be> <abc@x\.be>\r\n/);
  assert.ok(raw.endsWith("\r\n\r\nJa.\r\nTot straks"));
});
