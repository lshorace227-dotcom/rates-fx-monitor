// test/hkma.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeHkma } from "../lib/hkma.js";

const raw = JSON.parse(readFileSync(new URL("./fixtures/hkma-hibor.json", import.meta.url)));

test("normalizeHkma extracts a tenor into ascending Series", () => {
  const s = normalizeHkma(raw, {
    id: "HIBOR_1M", label: "HIBOR 1M", field: "hibor_fixing_1m",
    unit: "%", freq: "daily", caveat: null,
  });
  assert.ok(s.points.length > 0);
  for (const p of s.points) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(p.value));
  }
  const dates = s.points.map(p => p.date);
  assert.deepEqual(dates, [...dates].sort()); // 升序
  assert.equal(s.points[s.points.length - 1].value, 2.73435); // 最新 1M
  assert.equal(s.meta.source, "HKMA (HIBOR fixing)");
  assert.equal(s.meta.asof, "2026-06-09");
});

test("normalizeHkma returns empty Series when no records", () => {
  const s = normalizeHkma({ result: { records: [] } }, { id: "HIBOR_1M", label: "x", field: "hibor_fixing_1m" });
  assert.equal(s.points.length, 0);
  assert.equal(s.meta.asof, null);
});
