import { test } from "node:test";
import assert from "node:assert/strict";
import { soon, bannerDue, minutesLeft, type Meeting } from "./meetings.ts";

const now = Date.parse("2026-10-01T10:00:00Z");
const at = (id: string, minutes: number): Meeting => ({
  id,
  feed: "me@x.be",
  title: id,
  start: new Date(now + minutes * 60_000).toISOString(),
  end: new Date(now + (minutes + 60) * 60_000).toISOString(),
  location: "",
  join: "",
  organizer: "",
  people: [],
});
const ids = (list: Meeting[]) => list.map(meeting => meeting.id);
const list = [at("started-long-ago", -11), at("just-started", -10), at("in-5", 5), at("in-30", 30), at("in-31", 31)];

test("waiting shows a meeting from half an hour before until 10 minutes after its start", () => {
  assert.deepEqual(ids(soon(list, now)), ["just-started", "in-5", "in-30"]);
});

test("the banner goes out once, in the last 5 minutes before the start", () => {
  const sent = new Set<string>();
  assert.deepEqual(ids(bannerDue(list, now, sent)), ["in-5"]);
  sent.add("in-5");
  assert.deepEqual(ids(bannerDue(list, now, sent)), []);
  assert.deepEqual(ids(bannerDue([at("in-6", 6), at("now", 0)], now, sent)), [], "not earlier, not once started");
});

test("minutes left round up and stop at zero", () => {
  assert.equal(minutesLeft(at("x", 4.2), now), 5);
  assert.equal(minutesLeft(at("x", -3), now), 0);
});
