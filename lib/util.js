// lib/util.js
const RANGE_DAYS = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "5Y": 1827 };

function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sliceByRange(points, range) {
  if (!points.length || range === "ALL" || !RANGE_DAYS[range]) return points.slice();
  const last = points[points.length - 1].date;
  const cutoff = addDaysISO(last, -RANGE_DAYS[range]);
  return points.filter(p => p.date >= cutoff);
}

// 返回最近一个点在 ~daysAgo 之前的值（用于 chg1m/chg3m）
function valueDaysAgo(points, daysAgo) {
  if (!points.length) return null;
  const target = addDaysISO(points[points.length - 1].date, -daysAgo);
  let chosen = points[0];
  for (const p of points) { if (p.date <= target) chosen = p; else break; }
  return chosen.value;
}

export function summarizeSeries(series) {
  const pts = series.points;
  if (!pts.length) return { current: null, asof: null, min: null, max: null, chg1m: null, chg3m: null };
  const values = pts.map(p => p.value);
  const current = pts[pts.length - 1].value;
  const v1m = valueDaysAgo(pts, 30);
  const v3m = valueDaysAgo(pts, 91);
  return {
    current,
    asof: pts[pts.length - 1].date,
    min: Math.min(...values),
    max: Math.max(...values),
    chg1m: v1m == null ? null : +(current - v1m).toFixed(4),
    chg3m: v3m == null ? null : +(current - v3m).toFixed(4),
  };
}
