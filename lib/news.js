// lib/news.js
// 服务端抓真实近期新闻（Google News RSS，免 key）。把真标题+真链接喂给 Claude 的稳定 JSON 路径，
// 避免让无头 claude 自己 WebSearch（实测不真执行、会编造新闻+伪造 URL）。
const GN = "https://news.google.com/rss/search";

const QUERY_BY_ID = {
  SOFR: "SOFR Federal Reserve interest rate", EFFR: "Federal Reserve fed funds rate",
  UST_3M: "US Treasury bill yield Fed", UST_5Y: "US 5-year Treasury yield",
  UST_10Y: "US 10-year Treasury yield", UST_30Y: "US 30-year Treasury yield",
  HIBOR_ON: "HIBOR Hong Kong interbank rate", HIBOR_1M: "HIBOR Hong Kong interbank rate",
  HIBOR_3M: "HIBOR Hong Kong interbank rate", HIBOR_12M: "HIBOR Hong Kong interbank rate",
  LPR_1Y: "China LPR loan prime rate PBOC", LPR_5Y: "China LPR loan prime rate PBOC",
  SHIBOR_ON: "Shibor China interbank rate", SHIBOR_3M: "Shibor China interbank rate",
  USDCNY: "China yuan USD CNY exchange rate PBOC", USDCNH: "offshore yuan CNH exchange rate",
  DXY: "US dollar index DXY",
};

export function newsQueryFor(id, label) {
  return QUERY_BY_ID[id] || label;
}

export function parseRss(xml, n = 6) {
  const items = [...String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, n);
  return items.map(m => {
    const block = m[1];
    const g = (t) => {
      const x = block.match(new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">"));
      return x ? x[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : null;
    };
    const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || null;
    return { title: g("title"), url: g("link"), source, pubDate: g("pubDate") };
  }).filter(a => a.title && a.url);
}

export async function fetchNews(query, { n = 6, timeoutMs = 8000 } = {}) {
  const url = `${GN}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`news HTTP ${res.status}`);
    return parseRss(await res.text(), n);
  } finally {
    clearTimeout(timer);
  }
}
