import { test } from "node:test";
import assert from "node:assert/strict";
import { matchBoard } from "./board-match.ts";

const board = (name: string) => ({ id: name, name, project: "w", group: "W" });
const boards = ["Scoutsmap", "GravelArt webshop", "Build", "BE Plastics – TradeHub", "Spardex"].map(board);
const match = (project: string) => matchBoard(project, boards)?.name;

test("the same name, ignoring case, accents and punctuation", () => {
  assert.equal(match("scoutsmap"), "Scoutsmap");
  assert.equal(match("Spardéx"), "Spardex");
});
test("one name holding the other", () => {
  assert.equal(match("GravelArt"), "GravelArt webshop");
  assert.equal(match("BE Plastics (TradeHub)"), "BE Plastics – TradeHub");
});
test("no match for short or unrelated names", () => {
  assert.equal(match("UI"), undefined);
  assert.equal(match("Lemahieu"), undefined);
  assert.equal(match(""), undefined);
});
