// lib/narrative.js
// 引擎无关的「叙述」工具：构造提示词、抽取 JSON、把模型叙述并回量化基线（不改概率）。

export function buildNarrativePrompt(base, { articles = null } = {}) {
  const s = base.signals || {};
  const probLines = base.horizons.map(h =>
    `${h.horizon}: 上行 ${(h.scenarios.find(x => x.name === "上行").prob * 100).toFixed(0)}% / 中性 ${(h.scenarios.find(x => x.name === "中性").prob * 100).toFixed(0)}% / 下行 ${(h.scenarios.find(x => x.name === "下行").prob * 100).toFixed(0)}%`
  ).join("\n");
  const hasNews = Array.isArray(articles) && articles.length;
  const newsLines = hasNews ? [
    `近期真实新闻（来自 Google News，已为你检索好；请据此并结合量化信号写研判，不要编造未列出的新闻）：`,
    ...articles.map((a, i) => `${i + 1}. ${a.title}（${a.source || "?"}，${(a.pubDate || "").slice(0, 16)}）`),
    ``,
  ] : [];
  return [
    `你是资深宏观利率与汇率分析师。下面给出某标的的量化信号与"已确定的情景概率"，请只写"叙述"，不要改概率。`,
    ...newsLines,
    `标的：${base.label}（${base.instrument}），截至 ${base.asof}，当前 ${base.current_level}。`,
    `量化信号：趋势 ${s.trend}；近端动量 shortMom=${s.shortMom}；z 分数=${s.zScore}；日波动 ${s.vol}；区间位置 ${Math.round((s.rangePos ?? 0.5) * 100)}%。`,
    `各时间档已定概率：\n${probLines}`,
    ``,
    `请输出 JSON（简体中文），结构严格如下：`,
    `{"recent_move_summary":"一句近况","key_risks":["..."],"watch_items":["..."],`,
    `"horizons":[{"horizon":"1-3M","scenarios":[{"name":"上行","drivers":["驱动1","驱动2"],"credit_macro_implication":"对银行对公信贷/宏观的启示"},{"name":"中性",...},{"name":"下行",...}]}, ...其余 3-6M/6-12M/12-24M 同构]}`,
    `每个情景 drivers 2-3 条、implication 一句，聚焦银行对公信贷视角，结合给定量化信号${hasNews ? "与上述真实新闻" : ""}给出有依据的逻辑。只输出 JSON。`,
  ].join("\n");
}

// 从可能含 markdown 围栏或前后缀文字的字符串里抽取 JSON 对象。
export function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch {}
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i !== -1 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch {} }
  return null;
}

// 把模型叙述并回量化基线：按 (horizon,name) 匹配，仅替换 drivers/implication，概率保持不变。缺失项保留模板。
export function mergeNarrative(base, narrative, engineName = "claude") {
  if (!narrative || typeof narrative !== "object") return base;
  const out = { ...base };
  if (typeof narrative.recent_move_summary === "string" && narrative.recent_move_summary.trim()) {
    out.recent_move_summary = narrative.recent_move_summary.trim();
  }
  if (Array.isArray(narrative.key_risks) && narrative.key_risks.length) out.key_risks = narrative.key_risks;
  if (Array.isArray(narrative.watch_items) && narrative.watch_items.length) out.watch_items = narrative.watch_items;
  if (Array.isArray(narrative.sources) && narrative.sources.length) out.sources = narrative.sources;
  const nByH = new Map((narrative.horizons || []).map(h => [h.horizon, h]));
  out.horizons = base.horizons.map(h => {
    const nh = nByH.get(h.horizon);
    if (!nh) return h;
    const nByName = new Map((nh.scenarios || []).map(s => [s.name, s]));
    return {
      ...h,
      scenarios: h.scenarios.map(sc => {
        const ns = nByName.get(sc.name);
        if (!ns) return sc;
        return {
          ...sc,
          drivers: Array.isArray(ns.drivers) && ns.drivers.length ? ns.drivers : sc.drivers,
          credit_macro_implication: (typeof ns.credit_macro_implication === "string" && ns.credit_macro_implication.trim())
            ? ns.credit_macro_implication.trim() : sc.credit_macro_implication,
        };
      }),
    };
  });
  out.engine = engineName;
  return out;
}
