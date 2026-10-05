import { test } from "node:test";
import assert from "node:assert/strict";
import { nameOf, reviewText } from "./prompt.ts";

const pr = (n: number, repo = "acme/web") => ({ url: `u${n}`, repo, number: n, title: `PR ${n}` });
const file = (pr: string, path: string, size: number) => ({
  pr,
  path,
  lines: [{ kind: "add" as const, old: null, new: 1, text: "x".repeat(size) }],
});

test("a big first PR leaves the second its share", () => {
  const prs = [pr(1), pr(2)];
  const files = [file("u1", "a.ts", 900), file("u1", "b.ts", 900), file("u2", "c.ts", 100)];
  const { text, read } = reviewText(prs, [], files, 2000);
  assert.match(text, /acme\/web#2\/c\.ts/);
  assert.match(text, /acme\/web#1\/a\.ts/);
  assert.doesNotMatch(text, /b\.ts/);
  assert.equal(read, 2);
});

test("one PR names its files by path, several by PR and path", () => {
  const f = file("u2", "src/a.ts", 1);
  assert.equal(nameOf(f, [pr(2)]), "src/a.ts");
  assert.equal(nameOf(f, [pr(1), pr(2)]), "acme/web#2/src/a.ts");
});
