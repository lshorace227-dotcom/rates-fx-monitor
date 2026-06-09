// test/nyfed.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeNyFed } from "../lib/nyfed.js";

const raw = JSON.parse(readFileSync(new URL("./fixtures/nyfed-sofr.json", import.meta.url)));

test("normalizeNyFed parses refRates into ascending Series", () => {
  const s = normalizeNyFed(raw, { id: "SOFR", label: "SOFR", unit: "%", freq: "daily", caveat: null });
  assert.ok(s.points.length > 0);
  for (const p of s.points) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(p.value));
  }
  const dates = s.points.map(p => p.date);
  assert.deepEqual(dates, [...dates].sort()); // 升序
  assert.equal(s.meta.source, "NY Fed (SOFR)");
  assert.equal(s.meta.asof, s.points[s.points.length - 1].date);
});
