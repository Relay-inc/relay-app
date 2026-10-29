import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { yAnchor, ySpan } from "./anchors.ts";

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

test("a comment stays on its sentence while two members edit around it, and is gone with its text", () => {
  const [a, b] = [new Y.Doc(), new Y.Doc()];
  a.getText("md").insert(0, "Intro. The plan is good. End.");
  sync(a, b);
  const s = "The plan is good.";
  const at = a.getText("md").toString().indexOf(s);
  const anchor = JSON.parse(JSON.stringify(yAnchor(a.getText("md"), at, at + s.length))); // as stored
  a.getText("md").insert(0, "Before. ");
  b.getText("md").insert(b.getText("md").length, " After.");
  b.getText("md").insert(b.getText("md").toString().indexOf(" End."), " More");
  sync(a, b);
  for (const d of [a, b]) {
    const t = d.getText("md");
    const span = ySpan(t, anchor)!;
    assert.equal(t.toString().slice(span.from, span.to), s);
  }
  const t = b.getText("md");
  t.delete(t.toString().indexOf(s), s.length);
  sync(a, b);
  assert.equal(ySpan(a.getText("md"), anchor), null);
  assert.equal(ySpan(a.getText("md"), { o: 3 }), null);
});
