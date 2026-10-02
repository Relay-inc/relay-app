import { test } from "node:test";
import assert from "node:assert/strict";
import { link } from "./rules.ts";

const a = { provider: "productive", project: "1", board: "10" };
const b = { provider: "trello", project: "2", board: "20" };

test("linking takes the board from any other vault project and replaces what the project had", () =>
  assert.deepEqual(link({ Beacon: a, Atlas: b }, "Atlas", a), { Atlas: a }));
test("unlinking drops only that vault project's board", () =>
  assert.deepEqual(link({ Beacon: a, Atlas: b }, "Beacon", null), { Atlas: b }));
test("unlinking a project without a board changes nothing", () =>
  assert.deepEqual(link({ Beacon: a }, "", null), { Beacon: a }));
