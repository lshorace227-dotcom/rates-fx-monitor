// lib/registry.js
// 单一事实来源：每个标的的展示信息 + 取数配置。全部无 key 源。
export const REGISTRY = [
  // —— 利率：美国（纽约联储，免 key 官方）——
  { id: "SOFR", label: "SOFR 担保隔夜融资利率", group: "利率", source: "nyfed", config: { nyfedPath: "secured/sofr" },   unit: "%", freq: "daily", caveat: null },
  { id: "EFFR", label: "EFFR 有效联邦基金利率", group: "利率", source: "nyfed", config: { nyfedPath: "unsecured/effr" }, unit: "%", freq: "daily", caveat: null },
  // —— 利率：美债收益率曲线（Yahoo，免 key 实时）——
  { id: "UST_3M",  label: "美债 13周收益率", group: "利率", source: "yahoo", config: { symbol: "^IRX" }, unit: "%", freq: "daily", caveat: null },
  { id: "UST_5Y",  label: "美债 5Y 收益率",  group: "利率", source: "yahoo", config: { symbol: "^FVX" }, unit: "%", freq: "daily", caveat: null },
  { id: "UST_10Y", label: "美债 10Y 收益率", group: "利率", source: "yahoo", config: { symbol: "^TNX" }, unit: "%", freq: "daily", caveat: null },
  { id: "UST_30Y", label: "美债 30Y 收益率", group: "利率", source: "yahoo", config: { symbol: "^TYX" }, unit: "%", freq: "daily", caveat: null },
  // —— 利率：香港（HKMA 实时，失败回退 data/hibor.json）——
  { id: "HIBOR_ON", label: "HIBOR 隔夜", group: "利率", source: "hkma", config: { field: "ir_overnight" }, unit: "%", freq: "daily", caveat: null },
  { id: "HIBOR_1M", label: "HIBOR 1M",   group: "利率", source: "hkma", config: { field: "ir_1m" },        unit: "%", freq: "daily", caveat: null },
  { id: "HIBOR_3M", label: "HIBOR 3M",   group: "利率", source: "hkma", config: { field: "ir_3m" },        unit: "%", freq: "daily", caveat: null },
  { id: "HIBOR_12M",label: "HIBOR 12M",  group: "利率", source: "hkma", config: { field: "ir_12m" },       unit: "%", freq: "daily", caveat: null },
  // —— 利率：中国（本地维护）——
  { id: "LPR_1Y", label: "LPR 1Y", group: "利率", source: "local", config: { file: "lpr.json", key: "LPR_1Y" }, unit: "%", freq: "monthly", caveat: "月度，手动更新" },
  { id: "LPR_5Y", label: "LPR 5Y", group: "利率", source: "local", config: { file: "lpr.json", key: "LPR_5Y" }, unit: "%", freq: "monthly", caveat: "月度，手动更新" },
  { id: "SHIBOR_ON", label: "Shibor 隔夜", group: "利率", source: "local", config: { file: "shibor.json", key: "SHIBOR_ON" }, unit: "%", freq: "daily", caveat: "无免费实时源，可能非最新" },
  { id: "SHIBOR_3M", label: "Shibor 3M",   group: "利率", source: "local", config: { file: "shibor.json", key: "SHIBOR_3M" }, unit: "%", freq: "daily", caveat: "无免费实时源，可能非最新" },
  // —— 汇率（Yahoo，免 key 实时）——
  { id: "USDCNY", label: "USD/CNY 在岸", group: "汇率", source: "yahoo", config: { symbol: "CNY=X" },     unit: "", freq: "daily", caveat: "在岸，盘中实时" },
  { id: "USDCNH", label: "USD/CNH 离岸", group: "汇率", source: "yahoo", config: { symbol: "CNH=X" },     unit: "", freq: "daily", caveat: "离岸，盘中实时" },
  { id: "DXY",    label: "美元指数 DXY",  group: "汇率", source: "yahoo", config: { symbol: "DX-Y.NYB" }, unit: "", freq: "daily", caveat: "ICE 美元指数" },
];

export function getEntry(id) {
  return REGISTRY.find(e => e.id === id);
}
