import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, isQuestion, matchCommands } from "./palette.ts";

test("six words or a question mark make a question; five words and a name do not", () => {
  assert.equal(isQuestion("how do I rename a project"), true);
  assert.equal(isQuestion("how do I rename a"), false);
  assert.equal(isQuestion("terminal?"), true);
  assert.equal(isQuestion("  settings  "), false);
  assert.equal(isQuestion(""), false);
});

const commands = [
  { label: "Open today's note" },
  { label: "Settings: General" },
  { label: "Settings" },
  { label: "Today" },
  { label: "Terminal" },
];
const labels = (text: string) => matchCommands(commands, text).map(c => c.label);

test("commands match on every word, in any case; the exact name comes first", () => {
  assert.deepEqual(labels("settings"), ["Settings", "Settings: General"]);
  assert.deepEqual(labels("TODAY"), ["Today", "Open today's note"]);
  assert.deepEqual(labels("term"), ["Terminal"]);
  assert.deepEqual(labels("general settings"), ["Settings: General"]);
  assert.deepEqual(labels("nothing"), []);
});

const group = (id: string, n: number) => ({ id, options: Array.from({ length: n }, (_, i) => `${id}${i}`) });

test("the commands go on top only when one is named exactly", () => {
  const groups = [group("chats", 1), group("projects", 1), group("commands", 1)];
  assert.deepEqual(
    arrange(groups, false).map(g => g.id),
    ["chats", "projects", "commands"],
  );
  assert.deepEqual(
    arrange(groups, true).map(g => g.id),
    ["commands", "chats", "projects"],
  );
});

test("no more than 8 rows over the groups, the later ones cut first", () => {
  const shown = arrange([group("chats", 5), group("projects", 5), group("commands", 5)], false);
  assert.deepEqual(
    shown.map(g => g.options.length),
    [5, 3],
  );
  assert.deepEqual(
    arrange([group("chats", 9)], false).map(g => g.options.length),
    [8],
  );
  assert.deepEqual(arrange([group("chats", 0)], false), []);
});
