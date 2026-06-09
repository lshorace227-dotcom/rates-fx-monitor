// lib/yahoo.js
// Yahoo Finance 非官方 chart 接口（免 key）：美债收益率(^IRX/^FVX/^TNX/^TYX)、汇率(CNY=X/CNH=X)、DXY(DX-Y.NYB)。
// 服务端抓取绕 CORS。返回 chart.result[0]：timestamp[](unix秒) + indicators.quote[0].close[]（可能含 null）。
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

function tsToISO(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

export function normalizeYahoo(raw, { id, label, unit, freq, caveat }) {
  const r = raw?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const close = r?.indicators?.quote?.[0]?.close ?? [];
  const points = ts
    .map((t, i) => ({ date: tsToISO(t), value: Number(close[i]) }))
    .filter(p => p.date && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const asof = points.length ? points[points.length - 1].date : null;
  return { id, points, meta: { label, source: `Yahoo (${r?.meta?.symbol || id})`, freq, unit, asof, caveat } };
}

export async function fetchYahoo(symbol, { id, label, meta, range = "5y", interval = "1d", timeoutMs = 8000 }) {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
    const raw = await res.json();
    return normalizeYahoo(raw, { id, label, ...meta });
  } finally {
    clearTimeout(timer);
  }
}
