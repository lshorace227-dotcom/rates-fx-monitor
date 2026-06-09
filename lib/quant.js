// lib/quant.js
// 从时间序列算确定性量化信号，并据此生成四档×三情景概率与模板叙述（无需任何外部 API）。
import { summarizeSeries } from "./util.js";

const HORIZONS = [
  { horizon: "1-3M",  trendW: 0.80, revW: 0.20, neutralBase: 0.30 },
  { horizon: "3-6M",  trendW: 0.60, revW: 0.40, neutralBase: 0.34 },
  { horizon: "6-12M", trendW: 0.40, revW: 0.60, neutralBase: 0.38 },
  { horizon: "12-24M",trendW: 0.25, revW: 0.75, neutralBase: 0.42 },
];

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const sigmoid = x => 1 / (1 + Math.exp(-x));
const round = (x, n = 4) => +x.toFixed(n);

// 量化信号
export function computeSignals(series) {
  const pts = series.points || [];
  const s = summarizeSeries(series);
  if (pts.length < 2) {
    return { current: s.current, asof: s.asof, sma20: s.current, mean60: s.current, std60: 0,
             zScore: 0, shortMom: 0, vol: 0, trend: "数据不足", rangePos: null };
  }
  const values = pts.map(p => p.value);
  const win = values.slice(-60);
  const last20 = values.slice(-20);
  const current = values[values.length - 1];
  const mean60 = mean(win), std60 = std(win), sma20 = mean(last20);
  const zScore = std60 > 0 ? (current - mean60) / std60 : 0;
  const shortMom = std60 > 0 ? (current - sma20) / std60 : 0;
  const diffs = win.slice(1).map((v, i) => v - win[i]);
  const vol = std(diffs);
  const min = Math.min(...values), max = Math.max(...values);
  const rangePos = max > min ? (current - min) / (max - min) : 0.5;
  const trend = shortMom > 0.25 ? "上行" : shortMom < -0.25 ? "下行" : "横盘";
  return { current, asof: s.asof, sma20: round(sma20), mean60: round(mean60), std60: round(std60),
           zScore: round(zScore), shortMom: round(shortMom), vol: round(vol, 5), trend, rangePos: round(rangePos, 3),
           chg1m: s.chg1m, chg3m: s.chg3m, min, max };
}

// 由信号生成每档三情景概率（趋势跟随 vs 均值回归，随时长加权；概率和严格=1）
export function quantScenarios(signals) {
  const k = 1.2;
  return HORIZONS.map(h => {
    const signal = h.trendW * Math.tanh(signals.shortMom) + h.revW * (-Math.tanh(signals.zScore));
    const neutral = h.neutralBase;
    const up = (1 - neutral) * sigmoid(k * signal);
    const down = (1 - neutral) * (1 - sigmoid(k * signal));
    return { horizon: h.horizon, signal: round(signal, 3),
             probs: { 上行: round(up), 中性: round(neutral), 下行: round(down) } };
  });
}

// 模板叙述（Ollama 不可用时的兜底文字）
function templByDirection(name, label, signals) {
  const lvl = `${label}当前 ${signals.current}`;
  if (name === "上行") return {
    drivers: [`近端动量偏强(shortMom ${signals.shortMom})`, "趋势延续/紧缩预期或避险推升"],
    credit_macro_implication: `若${label}上行：融资成本上升，对杠杆高/再融资敏感借款人不利，关注利息覆盖。`,
  };
  if (name === "下行") return {
    drivers: [`高于均值(z ${signals.zScore})存在回归压力`, "宽松/增长走弱或风险偏好回升"],
    credit_macro_implication: `若${label}下行：融资成本回落，利好再融资与利差，但或反映增长走弱需看基本面。`,
  };
  return {
    drivers: [`${lvl}，处区间 ${Math.round((signals.rangePos ?? 0.5) * 100)}% 位置`, "无明确单边催化，区间震荡"],
    credit_macro_implication: `若${label}横盘：定价环境稳定，按现有假设滚动评估即可。`,
  };
}

// 组装完整 Insight（量化基线；Ollama 可在此基础上改写叙述字段）
export function templateInsight(series, label) {
  const signals = computeSignals(series);
  const horizons = quantScenarios(signals).map(h => ({
    horizon: h.horizon,
    scenarios: ["上行", "中性", "下行"].map(name => ({
      name, prob: h.probs[name], ...templByDirection(name, label, signals),
    })),
  }));
  return {
    instrument: series.id,
    label,
    asof: signals.asof,
    current_level: signals.current,
    recent_move_summary: `趋势 ${signals.trend}；近1M ${signals.chg1m ?? "—"}、近3M ${signals.chg3m ?? "—"}；z=${signals.zScore}，区间位置 ${Math.round((signals.rangePos ?? 0.5) * 100)}%。`,
    horizons,
    key_risks: ["趋势反转", "政策/央行意外", "流动性与风险偏好切换"],
    watch_items: ["FOMC/央行例会", "CPI/PCE 等通胀数据", "LPR/MLF 定价", "地缘与关税"],
    signals,
    engine: "quant",
  };
}
