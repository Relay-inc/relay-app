import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterTest,
  formatEnv,
  inlineHeight,
  parseArgs,
  parseEnv,
  pluginId,
  shownPlugins,
  toolResult,
  viewFor,
} from "./rules.ts";
import type { Plugin } from "./types.ts";

const plugin = (over: Partial<Plugin> = {}): Plugin => ({
  id: "garmin",
  name: "Garmin",
  command: "uvx",
  args: [],
  env: {},
  secrets: [],
  on: true,
  allowed: [],
  views: [],
  ...over,
});

test("an id from a name, unique among the plugins", () => {
  assert.equal(pluginId("Garmin (Connect)", []), "garmin-connect");
  assert.equal(pluginId("Garmin", ["garmin"]), "garmin-2");
  assert.equal(pluginId("Garmin", ["garmin", "garmin-2"]), "garmin-3");
  assert.equal(pluginId("???", []), "plugin");
  assert.equal(pluginId("x".repeat(60), []).length, 40);
});

test("env and arguments as typed", () => {
  assert.deepEqual(parseEnv("A=1\n B = two words \nnoequals\n=x\nC=a=b"), { A: "1", B: "two words", C: "a=b" });
  assert.equal(formatEnv({ A: "1", B: "2" }), "A=1\nB=2");
  assert.deepEqual(parseArgs("--from\n git+https://x y\n\n"), ["--from", " git+https://x y"]);
});

test("a plugin shows in the sidebar when it is on and has a view", () => {
  const view = { uri: "ui://x/y", name: "Y" };
  assert.deepEqual(
    shownPlugins([plugin({ views: [view] }), plugin({ id: "b", views: [view], on: false }), plugin({ id: "c" })]).map(
      p => p.id,
    ),
    ["garmin"],
  );
  assert.deepEqual(shownPlugins(undefined), []);
});

test("a test sets the views and drops allowed tools the server no longer has or hides from apps", () => {
  const found = {
    server: null,
    tools: [
      { name: "roll", view: "ui://x/y", app: true },
      { name: "hidden", view: null, app: false },
    ],
    views: [{ uri: "ui://x/y", name: "Y" }],
  };
  const after = afterTest(plugin({ allowed: ["roll", "hidden", "gone"] }), found);
  assert.deepEqual(after.allowed, ["roll"]);
  assert.deepEqual(
    after.views.map(v => v.uri),
    ["ui://x/y"],
  );
  assert.equal(afterTest(plugin(), { server: null, tools: [], views: [] }).views.length, 0);
});

test("a test records which tool renders in which view", () => {
  const found = {
    server: null,
    views: [{ uri: "ui://x/dice", name: "Dice" }],
    tools: [
      { name: "roll", view: "ui://x/dice", app: true },
      { name: "peek", view: null, app: false },
    ],
  };
  assert.deepEqual(afterTest(plugin({ toolViews: { gone: "ui://x/old" } }), found).toolViews, { roll: "ui://x/dice" });
});

test("a call to mcp__<server>__<tool> has the view of the plugin that runs that server", () => {
  const dice = plugin({ id: "dice", toolViews: { roll: "ui://x/dice", get__more: "ui://x/more" } });
  assert.deepEqual(viewFor([dice], "mcp__dice__roll"), { plugin: dice, uri: "ui://x/dice" });
  // a tool name may hold "__" itself
  assert.equal(viewFor([dice], "mcp__dice__get__more")?.uri, "ui://x/more");
  // the name Claude Code knows the server by wins over the id, and it makes `_` of what it does not allow
  const named = plugin({ id: "dice", mcp: "my dice", toolViews: { roll: "ui://x/dice" } });
  assert.equal(viewFor([named], "mcp__my_dice__roll")?.uri, "ui://x/dice");
  assert.equal(viewFor([named], "mcp__dice__roll"), null);
  // not switched on, a tool without a view, another server, and tools that are not MCP's
  assert.equal(viewFor([plugin({ ...dice, on: false })], "mcp__dice__roll"), null);
  assert.equal(viewFor([dice], "mcp__dice__other"), null);
  assert.equal(viewFor([dice], "mcp__cards__roll"), null);
  assert.equal(viewFor([dice], "roll"), null);
  assert.equal(viewFor([dice], "mcp__dice"), null);
  assert.equal(viewFor([plugin({ id: "dice" })], "mcp__dice__roll"), null, "an entry from before has no toolViews");
  assert.equal(viewFor(undefined, "mcp__dice__roll"), null);
});

test("what the view is told of a result", () => {
  assert.equal(toolResult(undefined, false), null, "a call that has no result yet");
  assert.deepEqual(toolResult({ text: "hi", structured: { a: 1 } }, false), {
    content: [{ type: "text", text: "hi" }],
    structuredContent: { a: 1 },
  });
  // a transcript keeps the text only: for a tool with structured content that is its JSON
  assert.deepEqual(toolResult({ text: '{"value":17}' }, false)?.structuredContent, { value: 17 });
  assert.equal(toolResult({ text: "Rolled 4" }, false)?.structuredContent, undefined);
  assert.equal(toolResult({ text: "{broken" }, false)?.structuredContent, undefined);
  assert.deepEqual(toolResult(undefined, true), { content: [], isError: true });
});

test("the height a view asks for is capped", () => {
  assert.equal(inlineHeight(120.2), 121);
  assert.equal(inlineHeight(5000), 480);
  assert.equal(inlineHeight(undefined), null);
  assert.equal(inlineHeight(-1), null);
});
