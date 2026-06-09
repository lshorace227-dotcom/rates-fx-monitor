// test/util.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { sliceByRange, summarizeSeries } from "../lib/util.js";

const pts = [
  { date: "2026-01-05", value: 1 },
  { date: "2026-03-05", value: 2 },
  { date: "2026-05-05", value: 3 },
  { date: "2026-06-05", value: 4 },
];

test("sliceByRange '3M' keeps points within 3 months of last date", () => {
  const out = sliceByRange(pts, "3M");
  assert.deepEqual(out.map(p => p.value), [2, 3, 4]); // 2026-03-05 起
});

test("sliceByRange 'ALL' returns everything", () => {
  assert.equal(sliceByRange(pts, "ALL").length, 4);
});

test("summarizeSeries computes current/asof/min/max and changes", () => {
  const s = summarizeSeries({ id: "X", points: pts, meta: { unit: "%" } });
  assert.equal(s.current, 4);
  assert.equal(s.asof, "2026-06-05");
  assert.equal(s.min, 1);
  assert.equal(s.max, 4);
  assert.equal(s.chg1m, 1);  // 4 - 3（约 1 个月前最近一点）
});
