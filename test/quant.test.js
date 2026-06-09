// test/quant.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSignals, quantScenarios, templateInsight } from "../lib/quant.js";

function mkSeries(values) {
  const points = values.map((v, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    return { date: d.toISOString().slice(0, 10), value: v };
  });
  return { id: "TST", points, meta: { unit: "%", label: "测试" } };
}

const rising = mkSeries(Array.from({ length: 60 }, (_, i) => i + 1)); // 1..60 单调上升
const flat = mkSeries(Array.from({ length: 60 }, () => 5.0));

test("quantScenarios probabilities sum to 1 per horizon", () => {
  for (const series of [rising, flat]) {
    const sc = quantScenarios(computeSignals(series));
    for (const h of sc) {
      const sum = h.probs.上行 + h.probs.中性 + h.probs.下行;
      assert.ok(Math.abs(sum - 1) < 1e-6, `${h.horizon} sum=${sum}`);
    }
  }
});

test("rising series: short horizon favors 上行 (trend following)", () => {
  const sc = quantScenarios(computeSignals(rising));
  const short = sc.find(h => h.horizon === "1-3M");
  assert.ok(short.probs.上行 > short.probs.下行, `up ${short.probs.上行} vs down ${short.probs.下行}`);
});

test("rising series far above mean: long horizon favors 下行 (mean reversion)", () => {
  const sc = quantScenarios(computeSignals(rising));
  const long = sc.find(h => h.horizon === "12-24M");
  assert.ok(long.probs.下行 > long.probs.上行, `down ${long.probs.下行} vs up ${long.probs.上行}`);
});

test("flat series: up ≈ down, neutral carries base mass", () => {
  const sc = quantScenarios(computeSignals(flat));
  const h = sc[0];
  assert.ok(Math.abs(h.probs.上行 - h.probs.下行) < 1e-6);
  assert.ok(h.probs.中性 > 0.25);
});

test("templateInsight returns full Insight shape with quant engine", () => {
  const ins = templateInsight(rising, "测试利率");
  assert.equal(ins.engine, "quant");
  assert.equal(ins.horizons.length, 4);
  assert.equal(ins.horizons[0].scenarios.length, 3);
  assert.ok(ins.signals && typeof ins.signals.zScore === "number");
  for (const h of ins.horizons) {
    for (const s of h.scenarios) {
      assert.ok(Array.isArray(s.drivers) && s.credit_macro_implication);
    }
  }
});
