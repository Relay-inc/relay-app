import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactName,
  artifactsIn,
  FRAME_SANDBOX,
  firstView,
  frameTheme,
  glyphOf,
  hasLocal,
  isArtifactUrl,
} from "./rules.ts";
import type { Item } from "../conversations/types.ts";

test("artifact links are claude.ai/artifact and claude.ai/code/artifact, not the gallery", () => {
  assert.ok(isArtifactUrl("https://claude.ai/artifact/X15gL4V9C5cBVoFx1SPM3D"));
  assert.ok(isArtifactUrl("https://claude.ai/code/artifact/23336be2-ea67-47fa-abc1-ead8c645a326"));
  assert.ok(isArtifactUrl("https://claude.ai/artifact/X15g#artboard-home"));
  assert.ok(!isArtifactUrl("https://claude.ai/code/artifacts"));
  assert.ok(!isArtifactUrl("https://claude.ai.evil.com/artifact/x"));
  assert.ok(!isArtifactUrl("http://claude.ai/artifact/x"));
  assert.ok(!isArtifactUrl(undefined));
});

test("a page of Claude's own opens from its file, one made from a type opens live", () => {
  const page = { url: "https://claude.ai/artifact/a", path: "/tmp/s/names.html" };
  assert.equal(firstView(page), "local");
  assert.equal(firstView({ ...page, fromType: "https://claude.ai/artifact/t" }), "live");
  assert.equal(firstView({ url: "https://claude.ai/artifact/a" }), "live");
  assert.equal(firstView({ url: "u", path: "/tmp/s/design-system.json" }), "live");
  assert.ok(!hasLocal({ url: "u", path: "/tmp/data.json" }));
});

test("its name, the latest version per link, and its glyph", () => {
  assert.equal(artifactName({ url: "u", title: " Sales dashboard " }), "Sales dashboard");
  assert.equal(artifactName({ url: "u", path: "/tmp/s/q3-report.html" }), "q3-report");
  assert.equal(artifactName({ url: "u" }), "");
  const items: Item[] = [
    { kind: "tool", text: "Artifact", artifact: { url: "a", title: "One", version: 1 } },
    { kind: "ai", text: "done" },
    { kind: "tool", text: "Artifact", artifact: { url: "b", title: "Two" } },
    { kind: "tool", text: "Artifact", artifact: { url: "a", title: "One", version: 2, updated: true } },
  ];
  assert.deepEqual(
    artifactsIn(items).map(a => [a.url, a.version ?? null]),
    [
      ["a", 2],
      ["b", null],
    ],
  );
  assert.equal(glyphOf({ url: "u", icon: "chart" }), "chart");
  assert.equal(glyphOf({ url: "u", title: "Q3 pitch deck" }), "slides");
  assert.equal(glyphOf({ url: "u", fromType: "t", title: "Quill" }), "palette");
  assert.equal(glyphOf({ url: "u", icon: "recipe" }), "page");
});

test("the frame gets light or dark when the app has one, else system; never the shared origin", () => {
  assert.equal(frameTheme("dark"), "dark");
  assert.equal(frameTheme("light"), "light");
  assert.equal(frameTheme(undefined), "system");
  assert.equal(frameTheme("graphite"), "system");
  assert.ok(FRAME_SANDBOX.includes("allow-scripts") && FRAME_SANDBOX.includes("allow-pointer-lock"));
  assert.ok(!FRAME_SANDBOX.includes("allow-same-origin"));
});
