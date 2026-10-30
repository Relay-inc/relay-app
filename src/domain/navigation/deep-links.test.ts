import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLink, unhandled } from "./deep-links.ts";

test("an ask link only carries the text for Cmd-K", () => {
  assert.deepEqual(parseLink("relay://ask?q=%20Hoe%20staat%20Relay%3F%20"), { kind: "ask", text: "Hoe staat Relay?" });
  assert.deepEqual(parseLink("relay://ask"), { kind: "ask", text: "" });
});

test("an open link names the project to look for", () =>
  assert.deepEqual(parseLink("relay://open?q=weemaes"), { kind: "open", query: "weemaes" }));

test("a meeting link carries the meeting as the calendar feeds would", () => {
  const link = parseLink(
    "relay://meeting?do=prep&uid=abc%40google.com&start=1793520000&end=1793523600&title=Design%20review&with=Ann%20%3Cann%40x.be%3E&with=bob%40x.be",
  );
  assert.deepEqual(link, {
    kind: "meeting",
    act: "prep",
    meeting: {
      id: "abc@google.com@1793520000",
      feed: "link",
      title: "Design review",
      start: "2026-11-01T08:00:00.000Z",
      end: "2026-11-01T09:00:00.000Z",
      location: "",
      join: "",
      organizer: "",
      people: [
        { name: "Ann", email: "ann@x.be" },
        { name: "", email: "bob@x.be" },
      ],
    },
  });
  assert.equal(parseLink("relay://meeting?do=send&uid=a&start=1"), null);
  assert.equal(parseLink("relay://meeting?do=prep&start=1"), null);
});

test("other links do nothing", () => {
  assert.equal(parseLink("relay://send?q=x"), null);
  assert.equal(parseLink("https://ask?q=x"), null);
  assert.equal(parseLink("not a url"), null);
});

test("a reload does not handle the launch link again", () => {
  assert.deepEqual(unhandled(["relay://ask?q=a"], ["relay://ask?q=a"]), []);
  assert.deepEqual(unhandled(["relay://ask?q=a"], []), ["relay://ask?q=a"]);
});
