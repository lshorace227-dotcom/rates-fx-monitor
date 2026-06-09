// lib/nyfed.js
// 纽约联储 Markets Data API（免 key）：SOFR / EFFR 等参考利率。
// 端点示例：https://markets.newyorkfed.org/api/rates/secured/sofr/last/500.json
const NYFED_BASE = "https://markets.newyorkfed.org/api/rates";

export function normalizeNyFed(raw, { id, label, unit, freq, caveat }) {
  const rows = raw?.refRates ?? [];
  const points = rows
    .map(r => ({ date: r.effectiveDate, value: Number(r.percentRate) }))
    .filter(p => p.date && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const asof = points.length ? points[points.length - 1].date : null;
  return { id, points, meta: { label, source: `NY Fed (${id})`, freq, unit, asof, caveat } };
}

export async function fetchNyFed(nyfedPath, { id, label, meta, n = 500, timeoutMs = 8000 }) {
  const url = `${NYFED_BASE}/${nyfedPath}/last/${n}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`NY Fed ${id} HTTP ${res.status}`);
    const raw = await res.json();
    return normalizeNyFed(raw, { id, label, ...meta });
  } finally {
    clearTimeout(timer);
  }
}
