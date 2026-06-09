// lib/local-source.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

export function loadLocalSeries(file, key, label) {
  const doc = JSON.parse(readFileSync(DATA_DIR + file, "utf8"));
  const points = (doc.series?.[key] ?? [])
    .map(p => ({ date: p.date, value: Number(p.value) }))
    .filter(p => p.date && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const asof = points.length ? points[points.length - 1].date : null;
  return {
    id: key,
    points,
    meta: { label: label || key, source: doc.source, freq: doc.freq, unit: doc.unit, asof, caveat: doc.caveat },
  };
}
