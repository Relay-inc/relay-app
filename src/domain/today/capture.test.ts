import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPrompt } from "./capture.ts";

test("the apply prompt lists every proposal with its note and its change", () => {
  const text = applyPrompt([
    { title: "Rate decided", file: "Contexts/Antenna/State.md", change: "€700 from November" },
    { title: "Follow-up", file: "reminders.md", change: "Call Pieter 12 Oct" },
  ]);
  assert.match(text, /1\. Rate decided — Contexts\/Antenna\/State\.md\n€700 from November/);
  assert.match(text, /2\. Follow-up — reminders\.md\nCall Pieter 12 Oct/);
});
