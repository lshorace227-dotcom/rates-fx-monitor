// test/narrative.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNarrativePrompt, mergeNarrative, extractJson } from "../lib/narrative.js";
import { templateInsight } from "../lib/quant.js";

function mkSeries() {
  const points = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), value: 3 + i * 0.05,
  }));
  return { id: "SOFR", points, meta: { unit: "%", label: "SOFR" } };
}

test("buildNarrativePrompt includes instrument, signals and fixed probabilities", () => {
  const p = buildNarrativePrompt(templateInsight(mkSeries(), "SOFR"));
  assert.match(p, /SOFR/);
  assert.match(p, /1-3M/);
  assert.match(p, /不要改概率|已确定/);
});

test("extractJson strips ```json fences", () => {
  assert.deepEqual(extractJson("```json\n{\"a\":1}\n```"), { a: 1 });
});

test("extractJson recovers JSON from surrounding prose", () => {
  assert.deepEqual(extractJson("这是结果：{\"a\":2} 完毕"), { a: 2 });
});

test("extractJson returns null on garbage", () => {
  assert.equal(extractJson("no json here"), null);
});

test("mergeNarrative replaces narrative, keeps quant probs, sets engine=claude", () => {
  const base = templateInsight(mkSeries(), "SOFR");
  const baseProb = base.horizons[0].scenarios.find(s => s.name === "上行").prob;
  const narrative = {
    recent_move_summary: "测试近况",
    horizons: [{ horizon: "1-3M", scenarios: [{ name: "上行", drivers: ["新驱动"], credit_macro_implication: "新启示" }] }],
  };
  const out = mergeNarrative(base, narrative, "claude");
  assert.equal(out.engine, "claude");
  assert.equal(out.recent_move_summary, "测试近况");
  const up = out.horizons[0].scenarios.find(s => s.name === "上行");
  assert.deepEqual(up.drivers, ["新驱动"]);
  assert.equal(up.prob, baseProb); // 概率不变
  assert.ok(out.horizons[1].scenarios[0].credit_macro_implication); // 未提供档位保留模板
});
