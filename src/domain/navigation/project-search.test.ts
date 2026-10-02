import { test } from "node:test";
import assert from "node:assert/strict";
import { searchProjects } from "./project-search.ts";

const projects = [
  { name: "Relay Docs", context: "Personal", aliases: [] },
  { name: "Old Relay", context: "Work", aliases: [] },
  { name: "Relay", context: "Personal", aliases: ["vault-app"] },
  { name: "Café", context: "Work", aliases: ["coffee"], label: "Morning brew" },
];
const names = (query: string, limit?: number) => searchProjects(projects, query, limit).map(p => p.name);

test("exact names rank before prefixes and other substrings", () => {
  assert.deepEqual(names("relay"), ["Relay", "Relay Docs", "Old Relay"]);
});
test("search includes aliases, custom labels and context", () => {
  assert.deepEqual(names("vault-app"), ["Relay"]);
  assert.deepEqual(names("morning"), ["Café"]);
  assert.deepEqual(names("personal relay"), ["Relay", "Relay Docs"]);
});
test("case, accents and surrounding spaces do not prevent matches", () => {
  assert.deepEqual(names("  CAFE  "), ["Café"]);
});
test("blank and unmatched queries give no results; every word must match", () => {
  assert.deepEqual(names("   "), []);
  assert.deepEqual(names("relay coffee"), []);
  assert.deepEqual(names("nonexistent"), []);
});
test("results are capped without changing the source list", () => {
  assert.deepEqual(names("relay", 2), ["Relay", "Relay Docs"]);
  assert.equal(projects[0].name, "Relay Docs");
});
