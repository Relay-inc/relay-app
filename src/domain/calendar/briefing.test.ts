import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORDS,
  addPoint,
  editPoint,
  isPointsHeading,
  keepFrom,
  prepState,
  sectionHash,
  mergePrep,
  parseBriefing,
  partOf,
  removePoint,
  shapeIn,
} from "./briefing.ts";
import { pointsIn, toggleTask } from "./meeting-view.ts";

const nl = [
  "### Doel",
  "Scope van de prijssimulatie vastleggen voor sprint 24.",
  "",
  "### Mensen",
  "- [[Tom Willems]]: Product owner, Northwind · laatst ontmoet 2026-10-28",
  "- Sofie Claes · laatst ontmoet 2026-09-02",
  "",
  "### Sinds de vorige keer",
  "van [[2026-10-28 Northwind sync Tom]]",
  "- [x] Tom deelt de pricing API-docs · klaar 2026-10-30",
  "- [ ] Alex schat de prijssimulatie in",
  "",
  "### Threads",
  "- Agenda sprint meeting · 2026-11-04 · `mail:me@x.be:4999`",
  "- Re: pricing API-docs · 2026-10-30",
  "",
  "### Mijn punten",
  "- [ ] Hosting migratie",
  "- [x] Beveiligingsaudit",
].join("\n");

test("the shaped briefing reads into its five blocks", () => {
  const b = parseBriefing(nl)!;
  assert.equal(b.goal, "Scope van de prijssimulatie vastleggen voor sprint 24.");
  assert.deepEqual(b.people, [
    { name: "Tom Willems", link: true, role: "Product owner, Northwind", lastMet: "2026-10-28" },
    { name: "Sofie Claes", link: false, role: "", lastMet: "2026-09-02" },
  ]);
  assert.equal(b.since.from, "2026-10-28 Northwind sync Tom");
  assert.deepEqual(b.since.steps, [
    { n: 0, text: "Tom deelt de pricing API-docs", done: true, doneOn: "2026-10-30" },
    { n: 1, text: "Alex schat de prijssimulatie in", done: false, doneOn: "" },
  ]);
  assert.deepEqual(b.threads, [
    { subject: "Agenda sprint meeting", date: "2026-11-04", key: "mail:me@x.be:4999" },
    { subject: "Re: pricing API-docs", date: "2026-10-30", key: "" },
  ]);
  assert.deepEqual(
    b.points.map(p => [p.n, p.text, p.done]),
    [
      [2, "Hosting migratie", false],
      [3, "Beveiligingsaudit", true],
    ],
  );
});

test("the shape reads in English, French and German too, from what the prompt shows", () => {
  for (const code of ["en", "nl", "fr", "de"]) {
    const w = WORDS[code];
    const text = shapeIn(code)
      .replace("<one line>", "Goal text")
      .replace("[[previous note]]", "[[Prev]]")
      .replace("YYYY-MM-DD · `mail", "2026-11-01 · `mail");
    const b = parseBriefing(text)!;
    assert.ok(b, code);
    assert.equal(b.goal, "Goal text", code);
    assert.equal(b.since.from, "Prev", code);
    assert.equal(b.since.steps.length, 2, code);
    assert.equal(b.threads.length, 1, code);
    assert.equal(b.points.length, 1, code);
    assert.ok(isPointsHeading(w.heading.points));
  }
  assert.equal(partOf("Depuis la dernière fois"), "since");
  assert.equal(partOf("Seit dem letzten Mal"), "since");
  assert.equal(partOf("Something else"), null);
});

test("a free-form briefing is no shape", () => {
  assert.equal(parseBriefing("**Next action:** bring the numbers.\n\n### Open points\n1. VAT\n"), null);
  assert.equal(parseBriefing("### Goal\nx\n\n### People\n- a\n"), null, "two sections are not the shape");
});

test("the Live card reads My points in every language", () => {
  assert.equal(pointsIn(nl).length, 2);
  assert.equal(pointsIn("### Mes points\n- [ ] a\n").length, 1);
  assert.equal(pointsIn("### Meine Punkte\n- [ ] a\n").length, 1);
  assert.equal(pointsIn("### Threads\n- [ ] a\n").length, 0);
});

test("a point is added after another or at the end, edited and removed", () => {
  const added = addPoint(nl, "Nieuw", null);
  assert.ok(added.endsWith("- [x] Beveiligingsaudit\n- [ ] Nieuw"));
  const mid = addPoint(nl, "Midden", 2);
  assert.ok(mid.includes("- [ ] Hosting migratie\n- [ ] Midden\n- [x] Beveiligingsaudit"));
  assert.equal(editPoint(nl, 2, "Anders").includes("- [ ] Anders\n- [x] Beveiligingsaudit"), true);
  assert.equal(removePoint(nl, 2).includes("Hosting migratie"), false);
  assert.equal(removePoint(nl, 2).includes("- [x] Beveiligingsaudit"), true);
  // the first point of a briefing that has the heading but no points
  const empty = "### Doel\nx\n\n### Mijn punten\n\n### Threads\n- a · 2026-11-01\n";
  assert.equal(
    addPoint(empty, "Een", null),
    "### Doel\nx\n\n### Mijn punten\n- [ ] Een\n\n### Threads\n- a · 2026-11-01\n",
  );
  // no heading at all: it is made, in the language asked
  assert.equal(addPoint("### Doel\nx", "Een", null, "en"), "### Doel\nx\n\n### My points\n- [ ] Een");
});

test("ticking works through the same task numbers the blocks show", () => {
  const b = parseBriefing(nl)!;
  const ticked = toggleTask(nl, b.points[0].n);
  assert.equal(parseBriefing(ticked)!.points[0].done, true);
  assert.equal(parseBriefing(ticked)!.since.steps[1].done, false);
});

const meeting = { id: "abc@100", title: "Northwind sync", start: "2026-11-04T09:30:00+01:00" };
const fresh = [
  "### Doel",
  "Nieuw doel.",
  "### Mensen",
  "- Tom · laatst ontmoet 2026-11-04",
  "### Sinds de vorige keer",
  "van [[2026-11-04 Northwind sync]]",
  "- [ ] Tom deelt de pricing API-docs",
  "- [ ] Nieuwe stap",
  "### Threads",
  "- Mail · 2026-11-05",
  "### Mijn punten",
  "- [ ] ",
].join("\n");

test("what is the user's in the old briefing is kept for the prep, nothing when there is none", () => {
  const keep = keepFrom(nl, meeting)!;
  assert.deepEqual(keep.points, [
    { text: "Hosting migratie", done: false },
    { text: "Beveiligingsaudit", done: true },
  ]);
  assert.deepEqual(keep.ticked, ["Tom deelt de pricing API-docs"]);
  assert.deepEqual(keep.meeting, meeting);
  assert.equal(keepFrom("free text\n- [ ] a\n", meeting), null, "no shape: nothing to keep");
  assert.equal(
    keepFrom(fresh.replace("### Mijn punten\n- [ ] ", "### Mijn punten"), meeting),
    null,
    "nothing of the user's",
  );
});

test("a prep that dropped the user's points and ticks gets them back", () => {
  const out = mergePrep(keepFrom(nl, meeting)!, fresh);
  assert.ok(out.includes("Nieuw doel."));
  assert.ok(out.includes("- [x] Tom deelt de pricing API-docs"), "ticked stays ticked");
  assert.ok(out.includes("- [ ] Nieuwe stap"));
  const b = parseBriefing(out)!;
  assert.deepEqual(
    b.points.map(p => [p.text, p.done]),
    [
      ["Hosting migratie", false],
      ["Beveiligingsaudit", true],
    ],
  );
  assert.equal(out.includes("- [ ] \n"), false, "the empty list of the new one is gone");
  // a run without the heading gets the points added, in the language of the briefing
  const noPoints = fresh.slice(0, fresh.indexOf("### Mijn punten")).trimEnd();
  assert.equal(parseBriefing(mergePrep(keepFrom(nl, meeting)!, noPoints))!.points.length, 2);
  // a text that is no shaped briefing is left alone
  assert.equal(mergePrep(keepFrom(nl, meeting)!, "free text\n"), "free text\n");
});

test("merging twice is the same as once, so a trigger that fires again changes nothing", () => {
  const keep = keepFrom(nl, meeting)!;
  const once = mergePrep(keep, fresh);
  assert.equal(mergePrep(keep, once), once);
  // and a prep that kept them itself is not touched
  assert.equal(mergePrep(keep, nl), nl);
  // what the user changed since the snapshot is not undone for items the prep did keep
  assert.equal(parseBriefing(mergePrep(keep, once))!.points.length, 2);
});

test("a turn that has not rewritten the briefing keeps the snapshot, one that did merges it", () => {
  const keep = keepFrom(nl, meeting)!;
  assert.equal(keep.hash, sectionHash(nl));
  assert.equal(prepState(keep, nl), "wait", "still the old briefing: Claude may be asking something");
  assert.equal(prepState(keep, nl + "\n"), "merge", "any change counts as written");
  assert.equal(prepState(keep, fresh), "merge");
  assert.equal(prepState(keep, null), "clear", "no briefing: nothing to merge into");
  assert.notEqual(sectionHash(nl), sectionHash(fresh));
});
