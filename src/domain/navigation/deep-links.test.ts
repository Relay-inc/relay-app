import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLink, unhandled } from "./deep-links.ts";

test("an ask link only carries the text for Cmd-K", () => {
  assert.deepEqual(parseLink("relay://ask?q=%20Hoe%20staat%20Relay%3F%20"), { kind: "ask", text: "Hoe staat Relay?" });
  assert.deepEqual(parseLink("relay://ask"), { kind: "ask", text: "" });
});

test("an open link names the project to look for", () =>
  assert.deepEqual(parseLink("relay://open?q=weemaes"), { kind: "open", query: "weemaes" }));

test("other links do nothing", () => {
  assert.equal(parseLink("relay://send?q=x"), null);
  assert.equal(parseLink("https://ask?q=x"), null);
  assert.equal(parseLink("not a url"), null);
});

test("a reload does not handle the launch link again", () => {
  assert.deepEqual(unhandled(["relay://ask?q=a"], ["relay://ask?q=a"]), []);
  assert.deepEqual(unhandled(["relay://ask?q=a"], []), ["relay://ask?q=a"]);
});
