// test/local-source.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLocalSeries } from "../lib/local-source.js";

test("loadLocalSeries reads a tenor from data file into Series", () => {
  const s = loadLocalSeries("lpr.json", "LPR_1Y");
  assert.equal(s.id, "LPR_1Y");
  assert.ok(s.points.length >= 1);
  assert.ok(Number.isFinite(s.points[0].value));
  assert.equal(s.meta.freq, "monthly");
  assert.ok(s.meta.caveat); // 口径提示存在
  // 升序，asof 为最后一条
  const dates = s.points.map(p => p.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(s.meta.asof, s.points[s.points.length - 1].date);
});

test("loadLocalSeries works for hibor fallback file", () => {
  const s = loadLocalSeries("hibor.json", "HIBOR_3M", "HIBOR 3M");
  assert.equal(s.id, "HIBOR_3M");
  assert.equal(s.points.length, 1);
  assert.equal(s.points[0].value, 2.85);
});
