// test/fred.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeFred } from "../lib/fred.js";

const raw = JSON.parse(readFileSync(new URL("./fixtures/fred-sofr.json", import.meta.url)));

test("normalizeFred parses observations into Series, dropping '.'", () => {
  const s = normalizeFred(raw, { id: "SOFR", label: "SOFR", unit: "%", freq: "daily", caveat: null });
  assert.equal(s.points.length, 4); // 5 条中丢弃 1 条 "."
  for (const p of s.points) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof p.value, "number");
    assert.ok(Number.isFinite(p.value));
  }
  const dates = s.points.map(p => p.date);
  assert.deepEqual(dates, [...dates].sort()); // 升序
  assert.equal(s.meta.source, "FRED (SOFR)");
  assert.equal(s.meta.asof, s.points[s.points.length - 1].date);
  assert.equal(s.meta.asof, "2026-06-05");
});
