// lib/hkma.js
// HKMA HIBOR fixing adapter。normalize 为纯函数（可测）；fetchHkma 负责网络（带超时）。
// 正确端点：daily-figures-interbank-liquidity（含 hibor_overnight / hibor_fixing_1m，有历史，免 key）。
// 注意：HKMA API 受阿里云 WAF 保护，偶发挂起；故 fetch 带超时，上层失败时回退本地 data/hibor.json。
const HKMA_URL = "https://api.hkma.gov.hk/public/market-data-and-statistics/daily-monetary-statistics/daily-figures-interbank-liquidity";

// HKMA 不同端点日期字段名有 end_of_date / end_of_day 两种，做容错。
function pickDate(rec) {
  return rec.end_of_date ?? rec.end_of_day ?? rec.date ?? null;
}

export function normalizeHkma(raw, { id, label, field, unit, freq, caveat }) {
  const records = raw?.result?.records ?? [];
  const points = records
    .map(r => ({ date: pickDate(r), value: Number(r[field]) }))
    .filter(p => p.date && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const asof = points.length ? points[points.length - 1].date : null;
  return { id, points, meta: { label, source: "HKMA (HIBOR fixing)", freq, unit, asof, caveat } };
}

export async function fetchHkma(field, { id, label, meta, pagesize = 500, timeoutMs = 8000 }) {
  const url = `${HKMA_URL}?lang=en&pagesize=${pagesize}&sortby=end_of_date&sortorder=desc`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HKMA HTTP ${res.status}`);
    const raw = await res.json();
    return normalizeHkma(raw, { id, label, field, ...meta });
  } finally {
    clearTimeout(timer);
  }
}
