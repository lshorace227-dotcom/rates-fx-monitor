// test/registry.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRY, getEntry } from "../lib/registry.js";

test("registry covers required instruments", () => {
  const ids = REGISTRY.map(e => e.id);
  for (const id of ["SOFR", "EFFR", "DGS2", "DGS10", "HIBOR_3M", "DEXCHUS", "DTWEXBGS", "LPR_1Y"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("every entry has group + source + label", () => {
  for (const e of REGISTRY) {
    assert.ok(["利率", "汇率"].includes(e.group));
    assert.ok(["fred", "hkma", "local"].includes(e.source));
    assert.ok(e.label && e.id);
  }
});

test("getEntry returns entry by id", () => {
  assert.equal(getEntry("SOFR").source, "fred");
  assert.equal(getEntry("HIBOR_3M").source, "hkma");
  assert.equal(getEntry("nope"), undefined);
});
