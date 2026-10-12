import { test } from "node:test";
import assert from "node:assert/strict";
import { afterTest, formatEnv, parseArgs, parseEnv, pluginId, shownPlugins } from "./rules.ts";
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
  view: null,
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
    shownPlugins([plugin({ view }), plugin({ id: "b", view, on: false }), plugin({ id: "c" })]).map(p => p.id),
    ["garmin"],
  );
  assert.deepEqual(shownPlugins(undefined), []);
});

test("a test sets the view and drops allowed tools the server no longer has or hides from apps", () => {
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
  assert.equal(after.view?.uri, "ui://x/y");
  assert.equal(afterTest(plugin(), { server: null, tools: [], views: [] }).view, null);
});
