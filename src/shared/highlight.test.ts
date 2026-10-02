import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightHtml, tokenize } from "./highlight.ts";

const coloured = (code: string, lang: string) =>
  tokenize(code, lang)
    .filter(([kind]) => kind)
    .map(([kind, text]) => `${kind}:${text}`);

test("tokenize: the design's samples", () => {
  assert.deepEqual(coloured('const issue = await productive.task("WEE-212");', "ts"), [
    "kw:const",
    "kw:await",
    "fn:task",
    'str:"WEE-212"',
  ]);
  assert.deepEqual(coloured("if (issue.points > 8) split(issue, { max: 5 });\n// done", "ts"), [
    "kw:if",
    "prop:points",
    "num:8",
    "fn:split",
    "prop:max",
    "num:5",
    "com:// done",
  ]);
  assert.deepEqual(coloured("gh pr merge 741 --squash && git push", "bash"), [
    "fn:gh",
    "num:741",
    "prop:--squash",
    "fn:git",
  ]);
});

test("tokenize: keys, comments and unknown languages", () => {
  assert.deepEqual(coloured('{"a": "b", "n": 1}', "json"), ['prop:"a"', 'str:"b"', 'prop:"n"', "num:1"]);
  assert.deepEqual(coloured("SELECT id FROM t -- x", "sql"), ["kw:SELECT", "kw:FROM", "com:-- x"]);
  assert.deepEqual(coloured("/* one\ntwo */ x", "css"), ["com:/* one\ntwo */"]);
  assert.deepEqual(tokenize("a < b", "nope"), [[null, "a < b"]]);
  // the text comes back whole, escaped in the HTML
  const code = 'x = "<b>" # & y\n';
  assert.equal(
    tokenize(code, "python")
      .map(([, text]) => text)
      .join(""),
    code,
  );
  assert.equal(highlightHtml("<b>", "html"), '&lt;<span class="tok-kw">b</span>&gt;');
});
