import { test } from "node:test";
import assert from "node:assert/strict";
import { matchBoard } from "./board-match.ts";

const board = (name: string) => ({ id: name, name, project: "w", group: "W" });
const boards = ["Trailmap", "Pebble webshop", "Build", "Acme Plastics – MarketHub", "Northwind"].map(board);
const match = (project: string) => matchBoard(project, boards)?.name;

test("the same name, ignoring case, accents and punctuation", () => {
  assert.equal(match("trailmap"), "Trailmap");
  assert.equal(match("Northwînd"), "Northwind");
});
test("one name holding the other", () => {
  assert.equal(match("Pebble"), "Pebble webshop");
  assert.equal(match("Acme Plastics (MarketHub)"), "Acme Plastics – MarketHub");
});
test("no match for short or unrelated names", () => {
  assert.equal(match("UI"), undefined);
  assert.equal(match("Larkspur"), undefined);
  assert.equal(match(""), undefined);
});
