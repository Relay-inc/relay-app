import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NEW_VIEW, parseViewSpec, viewOf } from "./views.ts";

const body = (block: string) => block.split("\n").slice(1, -1).join("\n");

describe("view block", () => {
  it("reads what / View inserts: meetings about this page", () => {
    const spec = parseViewSpec(body(NEW_VIEW))!;
    assert.equal(spec.collection, "meetings");
    assert.equal(spec.layout, "table");
    assert.equal(spec.about, "this");
    assert.equal(spec.sort, null);
    assert.deepEqual(viewOf(spec, "Northwind Portal").filters, [{ key: "about", is: "Northwind Portal" }]);
  });

  it("the same block is another page's view on another page", () => {
    const spec = parseViewSpec("collection: meetings\nabout: this")!;
    assert.equal(viewOf(spec, "Contoso Shop").filters[0].is, "Contoso Shop");
    assert.equal(viewOf(spec, "Northwind Portal").filters[0].is, "Northwind Portal");
  });

  it("reads layout, sort, group, context and a named page; ignores keys it does not know", () => {
    const spec = parseViewSpec(
      "Collection: Documents\nlayout: board\nabout: Northwind\ncontext: Work\nsort: date desc\ngroup: status\nfoo: 1",
    )!;
    assert.deepEqual(viewOf(spec, "x"), {
      collection: "documents",
      context: "Work",
      layout: "board",
      filters: [{ key: "about", is: "Northwind" }],
      sort: { key: "date", dir: "desc" },
      group: "status",
    });
  });

  it("is not a view without a known collection", () => {
    assert.equal(parseViewSpec("about: this"), null);
    assert.equal(parseViewSpec("collection: nope"), null);
  });
});
