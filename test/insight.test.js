// test/insight.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInsightPrompt, normalizeInsight, INSIGHT_TOOL } from "../lib/insight.js";

const series = {
  id: "SOFR",
  points: [{ date: "2026-05-05", value: 5.2 }, { date: "2026-06-05", value: 5.33 }],
  meta: { label: "SOFR", unit: "%", asof: "2026-06-05" },
};

test("buildInsightPrompt mentions instrument, current level and 4 horizons", () => {
  const p = buildInsightPrompt(series);
  assert.match(p, /SOFR/);
  assert.match(p, /5\.33/);
  for (const h of ["1-3M", "3-6M", "6-12M", "12-24M"]) assert.ok(p.includes(h));
});

test("INSIGHT_TOOL is a valid tool schema forcing the structured shape", () => {
  assert.equal(INSIGHT_TOOL.name, "emit_insight");
  assert.ok(INSIGHT_TOOL.input_schema.properties.horizons);
});

test("normalizeInsight rescales each horizon's scenario probs to sum 1", () => {
  const raw = {
    instrument: "SOFR", asof: "2026-06-05", current_level: 5.33, recent_move_summary: "x",
    horizons: [{ horizon: "1-3M", scenarios: [
      { name: "上行", prob: 0.4, drivers: ["a"], credit_macro_implication: "i" },
      { name: "中性", prob: 0.4, drivers: ["b"], credit_macro_implication: "i" },
      { name: "下行", prob: 0.4, drivers: ["c"], credit_macro_implication: "i" },
    ] }],
    key_risks: ["r"], watch_items: ["w"],
  };
  const out = normalizeInsight(raw);
  const sum = out.horizons[0].scenarios.reduce((a, s) => a + s.prob, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("normalizeInsight throws when horizons missing", () => {
  assert.throws(() => normalizeInsight({ instrument: "X" }));
});
