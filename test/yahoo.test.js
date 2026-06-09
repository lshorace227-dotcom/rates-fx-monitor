// test/yahoo.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeYahoo } from "../lib/yahoo.js";

const raw = JSON.parse(readFileSync(new URL("./fixtures/yahoo-tnx.json", import.meta.url)));

test("normalizeYahoo zips timestamp+close into ascending Series, dropping nulls", () => {
  const s = normalizeYahoo(raw, { id: "UST_10Y", label: "美债 10Y", unit: "%", freq: "daily", caveat: null });
  assert.ok(s.points.length > 0);
  for (const p of s.points) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(p.value));
  }
  const dates = s.points.map(p => p.date);
  assert.deepEqual(dates, [...dates].sort()); // 升序
  assert.match(s.meta.source, /^Yahoo \(/);
  assert.equal(s.meta.asof, s.points[s.points.length - 1].date);
});

test("normalizeYahoo returns empty Series on malformed input", () => {
  const s = normalizeYahoo({}, { id: "X", label: "x", unit: "%", freq: "daily", caveat: null });
  assert.equal(s.points.length, 0);
  assert.equal(s.meta.asof, null);
});
