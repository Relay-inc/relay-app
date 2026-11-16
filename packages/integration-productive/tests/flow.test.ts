import { test } from "node:test";
import assert from "node:assert/strict";
import { ticketFlow } from "../src/flow.ts";

const flow = (at: string, verdict: string, rest = "") => ({ at, html: `<p><strong>Ticket flow:</strong></p><p>${verdict}</p>${rest}` });
const medium = `<p>Size M (6-10h): invoice lines, a migration</p><p>Risk: high (money: invoice line quantities)</p><p>Budget: over by ~4h</p>`;

test("no flow comment, no verdict", () => {
  assert.equal(ticketFlow([]), undefined);
  assert.equal(ticketFlow([{ at: "2026-03-02T09:00:00Z", html: "<p>Sofie: can you look at this?</p>" }]), undefined);
});

test("a ready verdict with size, hours, risk and budget", () => {
  assert.deepEqual(ticketFlow([flow("2026-03-02T09:00:00Z", "Ready", medium)]),
    { verdict: "ready", size: "M", hours: "6-10h", risk: "high", budget: "over by ~4h", built: false });
});

test("the latest flow comment wins, whatever the order they come in", () => {
  const got = ticketFlow([flow("2026-03-04T09:00:00Z", "Ready", "<p>Size S (1h)</p>"), flow("2026-03-02T09:00:00Z", "Not ready", medium)]);
  assert.equal(got?.verdict, "ready");
  assert.equal(got?.size, "S");
  assert.equal(got?.risk, undefined);
});

test("built only counts after the flow comment", () => {
  const built = { at: "2026-03-05T09:00:00Z", html: "<p><strong>Ticket built:</strong> M, 9h worked</p>" };
  assert.equal(ticketFlow([flow("2026-03-02T09:00:00Z", "Ready", medium), built])?.built, true);
  // a new flow comment after the build starts over
  assert.equal(ticketFlow([flow("2026-03-02T09:00:00Z", "Ready", medium), built, flow("2026-03-06T09:00:00Z", "Split")])?.built, false);
});

test("Dutch keywords, other case, extra whitespace and entities", () => {
  const html = `<p>ticket  FLOW :</p><p>Niet klaar &mdash; wacht op Tom Willems</p><ul><li>Grootte:   l  (16h+)</li><li>Risico: Hoog</li><li>Budget:  geen schatting</li></ul>`;
  assert.deepEqual(ticketFlow([{ at: "2026-03-02T09:00:00Z", html }]), { verdict: "not-ready", size: "L", hours: "16h+", risk: "high", budget: "geen schatting", built: false });
  assert.equal(ticketFlow([flow("2026-03-02T09:00:00Z", "Splitsen")])?.verdict, "split");
  assert.equal(ticketFlow([flow("2026-03-02T09:00:00Z", "Klaar", "<p>Risk: normaal</p>")])?.risk, "normal");
});

test("a flow comment without a readable verdict is skipped for the one before it", () => {
  const got = ticketFlow([flow("2026-03-02T09:00:00Z", "Split"), { at: "2026-03-03T09:00:00Z", html: "<p>Ticket flow: maybe later</p>" }]);
  assert.equal(got?.verdict, "split");
  assert.equal(ticketFlow([{ at: "2026-03-03T09:00:00Z", html: "<p>Ticket flow:</p>" }]), undefined);
  // a mention of the words inside a longer comment is no flow comment
  assert.equal(ticketFlow([{ at: "2026-03-03T09:00:00Z", html: "<p>See the Ticket flow: Ready comment above</p>" }]), undefined);
});
