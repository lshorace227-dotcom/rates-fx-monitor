// test/registry.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRY, getEntry } from "../lib/registry.js";

test("registry covers required no-key instruments", () => {
  const ids = REGISTRY.map(e => e.id);
  for (const id of ["SOFR", "EFFR", "UST_5Y", "UST_10Y", "UST_30Y", "HIBOR_3M", "USDCNY", "USDCNH", "DXY", "LPR_1Y"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("every entry has group + a no-key source + label", () => {
  for (const e of REGISTRY) {
    assert.ok(["利率", "汇率"].includes(e.group));
    assert.ok(["nyfed", "yahoo", "hkma", "local"].includes(e.source));
    assert.ok(e.label && e.id);
  }
});

test("getEntry returns entry by id", () => {
  assert.equal(getEntry("SOFR").source, "nyfed");
  assert.equal(getEntry("UST_10Y").source, "yahoo");
  assert.equal(getEntry("HIBOR_3M").source, "hkma");
  assert.equal(getEntry("nope"), undefined);
});
