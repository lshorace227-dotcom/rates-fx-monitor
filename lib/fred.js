// lib/fred.js
// FRED 观测序列 adapter。normalize 为纯函数（可测）；fetchFred 负责网络。
const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

export function normalizeFred(raw, { id, label, unit, freq, caveat }) {
  const obs = Array.isArray(raw?.observations) ? raw.observations : [];
  const points = obs
    .filter(o => o.value !== "." && o.value != null && o.value !== "")
    .map(o => ({ date: o.date, value: Number(o.value) }))
    .filter(p => Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const asof = points.length ? points[points.length - 1].date : null;
  return { id, points, meta: { label, source: `FRED (${id})`, freq, unit, asof, caveat } };
}

export async function fetchFred(seriesId, { apiKey, start, meta }) {
  const url = `${FRED_BASE}?series_id=${encodeURIComponent(seriesId)}`
    + `&api_key=${apiKey}&file_type=json`
    + (start ? `&observation_start=${start}` : "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  const raw = await res.json();
  return normalizeFred(raw, { id: seriesId, ...meta });
}
