// lib/registry.js
// 单一事实来源：每个标的的展示信息 + 取数配置。
export const REGISTRY = [
  // —— 利率：美国（FRED）——
  { id: "SOFR",  label: "SOFR 担保隔夜融资利率", group: "利率", source: "fred", config: { seriesId: "SOFR" },  unit: "%", freq: "daily", caveat: null },
  { id: "EFFR",  label: "EFFR 有效联邦基金利率", group: "利率", source: "fred", config: { seriesId: "EFFR" },  unit: "%", freq: "daily", caveat: null },
  { id: "DGS2",  label: "美债 2Y 收益率",        group: "利率", source: "fred", config: { seriesId: "DGS2" },  unit: "%", freq: "daily", caveat: null },
  { id: "DGS10", label: "美债 10Y 收益率",       group: "利率", source: "fred", config: { seriesId: "DGS10" }, unit: "%", freq: "daily", caveat: null },
  // —— 利率：香港（HKMA 实时，失败回退 data/hibor.json）—— field 为 HKMA interbank-interest-rates 字段名
  { id: "HIBOR_ON", label: "HIBOR 隔夜", group: "利率", source: "hkma", config: { field: "ir_overnight" }, unit: "%", freq: "daily", caveat: null },
  { id: "HIBOR_1M", label: "HIBOR 1M",   group: "利率", source: "hkma", config: { field: "ir_1m" },        unit: "%", freq: "daily", caveat: null },
  { id: "HIBOR_3M", label: "HIBOR 3M",   group: "利率", source: "hkma", config: { field: "ir_3m" },        unit: "%", freq: "daily", caveat: null },
  { id: "HIBOR_12M",label: "HIBOR 12M",  group: "利率", source: "hkma", config: { field: "ir_12m" },       unit: "%", freq: "daily", caveat: null },
  // —— 利率：中国（本地维护）——
  { id: "LPR_1Y", label: "LPR 1Y", group: "利率", source: "local", config: { file: "lpr.json", key: "LPR_1Y" }, unit: "%", freq: "monthly", caveat: "月度，手动更新" },
  { id: "LPR_5Y", label: "LPR 5Y", group: "利率", source: "local", config: { file: "lpr.json", key: "LPR_5Y" }, unit: "%", freq: "monthly", caveat: "月度，手动更新" },
  { id: "SHIBOR_ON", label: "Shibor 隔夜", group: "利率", source: "local", config: { file: "shibor.json", key: "SHIBOR_ON" }, unit: "%", freq: "daily", caveat: "无免费实时源，可能非最新" },
  { id: "SHIBOR_3M", label: "Shibor 3M",   group: "利率", source: "local", config: { file: "shibor.json", key: "SHIBOR_3M" }, unit: "%", freq: "daily", caveat: "无免费实时源，可能非最新" },
  // —— 汇率 ——
  { id: "DEXCHUS",  label: "USD/CNY 在岸", group: "汇率", source: "fred", config: { seriesId: "DEXCHUS" },  unit: "", freq: "daily", caveat: "FRED 日度，非 tick；在岸口径" },
  { id: "DTWEXBGS", label: "美元指数(广义)", group: "汇率", source: "fred", config: { seriesId: "DTWEXBGS" }, unit: "", freq: "daily", caveat: "广义美元指数代理，≠ ICE DXY" },
];

export function getEntry(id) {
  return REGISTRY.find(e => e.id === id);
}
