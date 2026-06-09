// lib/insight.js
import { summarizeSeries } from "./util.js";

const HORIZONS = ["1-3M", "3-6M", "6-12M", "12-24M"];

export const INSIGHT_TOOL = {
  name: "emit_insight",
  description: "输出该利率/汇率标的的多情景未来走势研判",
  input_schema: {
    type: "object",
    required: ["instrument", "asof", "current_level", "recent_move_summary", "horizons", "key_risks", "watch_items"],
    properties: {
      instrument: { type: "string" },
      asof: { type: "string" },
      current_level: { type: "number" },
      recent_move_summary: { type: "string" },
      horizons: {
        type: "array",
        items: {
          type: "object",
          required: ["horizon", "scenarios"],
          properties: {
            horizon: { type: "string", enum: HORIZONS },
            scenarios: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "prob", "drivers", "credit_macro_implication"],
                properties: {
                  name: { type: "string", enum: ["上行", "中性", "下行"] },
                  prob: { type: "number" },
                  drivers: { type: "array", items: { type: "string" } },
                  credit_macro_implication: { type: "string" },
                },
              },
            },
          },
        },
      },
      key_risks: { type: "array", items: { type: "string" } },
      watch_items: { type: "array", items: { type: "string" } },
    },
  },
};

export function buildInsightPrompt(series) {
  const s = summarizeSeries(series);
  const recent = series.points.slice(-12).map(p => `${p.date}: ${p.value}`).join("\n");
  return [
    `你是一位资深宏观利率与汇率分析师。针对下列标的，给出多情景未来走势研判。`,
    `标的：${series.meta.label}（${series.id}），单位 ${series.meta.unit || "（汇率）"}。`,
    `截至 ${s.asof}，最新值 ${s.current}；近 1M 变动 ${s.chg1m}，近 3M 变动 ${s.chg3m}；区间 [${s.min}, ${s.max}]。`,
    `近期数据点：\n${recent}`,
    ``,
    `要求：对以下四个时间档各给出三个情景（上行/中性/下行），每个情景含 概率(prob, 0~1)、关键驱动(drivers)、对银行对公信贷与宏观的启示(credit_macro_implication)。`,
    `时间档：${HORIZONS.join("、")}。每个时间档内三情景概率之和应为 1。`,
    `另给出 key_risks 与 watch_items（如 FOMC、CPI/PCE、LPR 定价、关税等）。`,
    `务必通过 emit_insight 工具输出结构化结果。`,
    `注意：你的知识有截止时点，且未接入实时新闻；研判基于以上数据与宏观常识，非投资建议。`,
  ].join("\n");
}

export function normalizeInsight(raw) {
  if (!raw || !Array.isArray(raw.horizons) || raw.horizons.length === 0) {
    throw new Error("insight missing horizons");
  }
  const horizons = raw.horizons.map(h => {
    const total = h.scenarios.reduce((a, s) => a + (Number(s.prob) || 0), 0) || 1;
    // 不做定点舍入，保留全精度使各档概率之和严格为 1；显示时前端再 toFixed。
    return { ...h, scenarios: h.scenarios.map(s => ({ ...s, prob: Number(s.prob) / total })) };
  });
  return { ...raw, horizons };
}

export async function requestInsight(series, { apiKey, model }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: 4000,
      tools: [INSIGHT_TOOL],
      tool_choice: { type: "tool", name: "emit_insight" },
      messages: [{ role: "user", content: buildInsightPrompt(series) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const block = (data.content || []).find(b => b.type === "tool_use");
  if (!block) throw new Error("no tool_use in Anthropic response");
  return normalizeInsight(block.input);
}
