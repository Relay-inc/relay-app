import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE,
  cleanNotes,
  hhmm,
  pointsIn,
  serviceOf,
  tasksIn,
  toggleTask,
  isEmptyStamp,
  longDay,
  markLine,
  newMeetingNote,
  notesIn,
  othersLabel,
  parseNotes,
  quoteLine,
  stamp,
  stepOf,
  withNotes,
} from "./meeting-view.ts";
import { eventOf, meetingLanguage, withLanguage } from "./rules.ts";
import { meetingOf, isView } from "../navigation/views.ts";
import { workKey } from "../navigation/keys.ts";
import type { Meeting } from "./types";

const meeting: Meeting = {
  id: "abc@100",
  feed: "me@x.be",
  title: "Spardex sync",
  start: "2026-11-04T09:30:00+01:00",
  end: "2026-11-04T10:00:00+01:00",
  location: "",
  join: "",
  organizer: "",
  people: [{ name: "Thomas Van Hecke", email: "thomas@spardex.be" }],
};
const apply = (line: string, c: { from: number; to: number; insert: string }) =>
  line.slice(0, c.from) + c.insert + line.slice(c.to);

test("the step follows the stage: recording is Live, recorded or summarised is Wrap-up, else the briefing", () => {
  assert.equal(stepOf("planned", false), "briefing");
  assert.equal(stepOf("briefed", false), "briefing");
  assert.equal(stepOf("live", false), "live");
  assert.equal(stepOf("live", true), "live");
  assert.equal(stepOf("briefed", true), "wrapup");
  assert.equal(stepOf("wrapped", false), "wrapup");
});

test("a meeting key is a view and names its meeting", () => {
  const key = workKey("meeting", "abc@100");
  assert.equal(meetingOf(key), "abc@100");
  assert.ok(isView(key));
  assert.equal(meetingOf("__wait"), "");
  assert.equal(meetingOf(workKey("review", "x")), "");
});

test("Others carries the name in a 1:1 only", () => {
  assert.equal(othersLabel(meeting.people, "Others"), "Thomas Van Hecke");
  assert.equal(othersLabel([{ name: "", email: "a@b.c" }], "Others"), "a@b.c");
  assert.equal(othersLabel([...meeting.people, { name: "Sofie", email: "s@x.be" }], "Others"), "Others");
  assert.equal(othersLabel([], "Others"), "Others");
});

test("a marker goes in after the time, a different one replaces it, the same one comes out", () => {
  assert.equal(
    apply("- [09:38] Post the agenda", markLine("- [09:38] Post the agenda", "action", "10:00")),
    "- [09:38] ! Post the agenda",
  );
  const marked = "- [09:38] ! Post the agenda";
  assert.equal(apply(marked, markLine(marked, "decision", "10:00")), "- [09:38] = Post the agenda");
  assert.equal(apply(marked, markLine(marked, "action", "10:00")), "- [09:38] Post the agenda");
  assert.equal(apply("- [09:40] ?", markLine("- [09:40] ?", "question", "10:00")), "- [09:40] ");
  assert.equal(apply("- [09:40] a ? b", markLine("- [09:40] a ? b", "question", "10:00")), "- [09:40] ? a ? b");
});

test("a line without a time gets one with the marker", () => {
  assert.equal(apply("", markLine("", "question", "10:01")), "- [10:01] ? ");
  assert.equal(apply("loose text", markLine("loose text", "action", "10:01")), "- [10:01] ! loose text");
  assert.equal(apply("- a list item", markLine("- a list item", "decision", "10:01")), "- [10:01] = a list item");
});

test("the notes parse into time, marker and text; lines without a time are left out", () => {
  const notes = [
    "- [09:31] Demo went fine",
    "- [09:33] = Simulator in sprint 24",
    "- [09:38] ! Post the agenda",
    "- [09:40] ? Who takes the audit?",
    "loose line",
    '- [09:50] > "quoted"',
    "- [09:51] !",
  ].join("\n");
  assert.deepEqual(parseNotes(notes), [
    { time: "09:31", marker: null, text: "Demo went fine" },
    { time: "09:33", marker: "decision", text: "Simulator in sprint 24" },
    { time: "09:38", marker: "action", text: "Post the agenda" },
    { time: "09:40", marker: "question", text: "Who takes the audit?" },
    { time: "09:50", marker: null, text: '> "quoted"' },
    { time: "09:51", marker: "action", text: "" },
  ]);
});

test("a quote is a notes line, on one line, with who said it", () => {
  assert.equal(
    quoteLine("09:44", "Thomas", " Zaterdag\n de vijftiende "),
    '- [09:44] > Thomas: "Zaterdag de vijftiende"',
  );
  assert.equal(quoteLine("09:44", "", "x"), '- [09:44] > "x"');
  assert.equal(quoteLine("09:44", 'A "B": C', "x"), '- [09:44] > A B C: "x"');
  assert.equal(parseNotes(quoteLine("09:44", "Me", "x"))[0].time, "09:44");
  assert.equal(QUOTE.exec('> Thomas: "x"')?.[1], "Thomas");
  assert.equal(QUOTE.exec('> "x"')?.[1], undefined);
});

test("the clock time of a line is the machine's, 24 hours", () => {
  assert.equal(hhmm(new Date(2026, 10, 4, 9, 5)), "09:05");
  assert.equal(hhmm(new Date(2026, 10, 4, 21, 43)), "21:43");
});

const briefing =
  "**Goal:** x\n- [ ] not mine\n\n## My points\n- [x] done one\n- [ ] open one\n\n## Threads\n- [ ] other";
test("the tasks of a briefing, and the ones under My points", () => {
  assert.deepEqual(
    tasksIn(briefing).map(t => [t.n, t.done, t.section]),
    [
      [0, false, ""],
      [1, true, "My points"],
      [2, false, "My points"],
      [3, false, "Threads"],
    ],
  );
  assert.deepEqual(
    pointsIn(briefing).map(t => t.text),
    ["done one", "open one"],
  );
  assert.deepEqual(pointsIn("- [ ] loose"), []);
});

test("ticking a task changes that checkbox only", () => {
  assert.equal(toggleTask(briefing, 2), briefing.replace("- [ ] open one", "- [x] open one"));
  assert.equal(toggleTask(briefing, 1), briefing.replace("- [x] done one", "- [ ] done one"));
  assert.equal(toggleTask(toggleTask(briefing, 3), 3), briefing);
  assert.equal(toggleTask(briefing, 9), briefing);
});

test("the service a join link goes to", () => {
  assert.equal(serviceOf("https://meet.google.com/abc"), "Meet");
  assert.equal(serviceOf("https://acme.zoom.us/j/1"), "Zoom");
  assert.equal(serviceOf("https://teams.microsoft.com/l/x"), "Teams");
});

test("lines that hold only a time are not written", () => {
  assert.ok(isEmptyStamp(stamp("09:38")));
  assert.ok(isEmptyStamp("- [09:38] ! "));
  assert.ok(!isEmptyStamp("- [09:38] a"));
  assert.equal(cleanNotes("- [09:31] a\n- [09:32] \n- [09:33] = b\n- [09:34] "), "- [09:31] a\n- [09:33] = b");
});

const note = "---\ntype: Meeting\n---\n# T\n\n## Briefing\nGoal\n\n## Notes\n- [09:31] a\n\n## Summary\nDone\n";
test("only the notes section is read and replaced", () => {
  assert.equal(notesIn(note), "- [09:31] a");
  assert.equal(notesIn("# T\n## Summary\nx\n"), null);
  assert.equal(
    withNotes(note, "- [09:31] a\n- [09:35] ! b"),
    "---\ntype: Meeting\n---\n# T\n\n## Briefing\nGoal\n\n## Notes\n- [09:31] a\n- [09:35] ! b\n\n## Summary\nDone\n",
  );
  // the rest is byte-identical: put the same notes back
  assert.equal(withNotes(note, notesIn(note)!), note);
  assert.equal(withNotes("# T\n\n## Notes\n- x\n", "- y"), "# T\n\n## Notes\n- y\n");
});

test("a note without the section gets one before the summary, else at the end", () => {
  assert.equal(withNotes("# T\n\n## Summary\nS\n", "- [09:31] a"), "# T\n\n## Notes\n- [09:31] a\n\n## Summary\nS\n");
  assert.equal(withNotes("# T\n\n## Briefing\nG\n", "- [09:31] a"), "# T\n\n## Briefing\nG\n\n## Notes\n- [09:31] a\n");
});

test("the language is set in the frontmatter only, or taken out", () => {
  const text = '---\ntype: Meeting\nevent: "abc@100"\n---\n# T\nlanguage: x\n';
  assert.equal(withLanguage(text, "nl"), '---\ntype: Meeting\nevent: "abc@100"\nlanguage: nl\n---\n# T\nlanguage: x\n');
  assert.equal(withLanguage(withLanguage(text, "nl"), "fr"), withLanguage(text, "fr"));
  assert.equal(withLanguage(withLanguage(text, "nl"), ""), text);
  assert.equal(meetingLanguage(withLanguage(text, "nl"), "auto"), "nl");
  assert.equal(withLanguage("no frontmatter\n", "nl"), "no frontmatter\n");
});

test("a day reads as the vault writes it", () => {
  assert.equal(longDay("2026-10-02"), "Friday October 2nd, 2026");
  assert.equal(longDay("2026-11-04"), "Wednesday November 4th, 2026");
  assert.equal(longDay("2026-11-11"), "Wednesday November 11th, 2026");
  assert.equal(longDay("2026-11-23"), "Monday November 23rd, 2026");
});

test("a new meeting note has the vault's shape and keeps its event id", () => {
  const text = newMeetingNote(meeting, "Spardex sync", "2026-11-04", "Europe/Brussels");
  assert.equal(
    text,
    '---\ntype: Meeting\nevent: "abc@100"\nwith:\n  - "Thomas Van Hecke"\ncreated: 2026-11-04\n---\n\n# Spardex sync\n[[2026-11-04|Wednesday November 4th, 2026]]\n\n## Notes\n',
  );
  assert.equal(eventOf(text), "abc@100");
  assert.equal(notesIn(text), "");
  const alone = newMeetingNote({ ...meeting, people: [] }, "Now", "2026-11-04", "Europe/Brussels");
  assert.ok(alone.includes("\nwith:\ncreated:"));
  // a name with quotes stays one plain string
  const odd = newMeetingNote({ ...meeting, people: [{ name: 'Al "B": C', email: "a@b.c" }] }, "T", "2026-11-04");
  assert.ok(odd.includes('  - "Al \\"B\\": C"'));
});
