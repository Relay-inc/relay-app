import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCommands } from "./commands.ts";

const list = [
  { name: "review", description: "Review a PR" },
  { name: "code-review:code-review", description: "Code review a pull request" },
  { name: "close", description: "Session close" },
  { name: "today", description: "Morning briefing" },
];
const names = (typed: string) => matchCommands(list, typed).map(command => command.name);

test("a slash alone lists everything, by name", () =>
  assert.deepEqual(names("/"), ["close", "code-review:code-review", "review", "today"]));
test("prefix before contains before description", () => {
  assert.deepEqual(names("/rev"), ["review", "code-review:code-review"]);
  assert.deepEqual(names("/brief"), ["today"]);
});
test("nothing once the name is done or without a leading slash", () => {
  assert.deepEqual(names("/review 12"), []);
  assert.deepEqual(names("review"), []);
  assert.deepEqual(names(" /review"), []);
});
