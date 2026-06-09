// lib/series-service.js
import { getEntry } from "./registry.js";
import { fetchNyFed } from "./nyfed.js";
import { fetchYahoo } from "./yahoo.js";
import { fetchHkma } from "./hkma.js";
import { loadLocalSeries } from "./local-source.js";

// HKMA 实时取数；失败/超时/空 → 回退本地 data/hibor.json
async function getHkmaWithFallback(e, meta) {
  try {
    const live = await fetchHkma(e.config.field, { id: e.id, label: e.label, meta });
    if (live.points.length) return live;
    throw new Error("HKMA empty");
  } catch {
    const local = loadLocalSeries("hibor.json", e.id, e.label);
    local.meta.caveat = (local.meta.caveat || "") + "（HKMA 实时取数失败，回退本地维护值）";
    return local;
  }
}

export async function getSeries(id, { cache, now = Date.now() } = {}) {
  const cached = cache?.get(`series:${id}`, now);
  if (cached) return cached;

  const e = getEntry(id);
  if (!e) throw new Error(`unknown instrument ${id}`);
  const meta = { unit: e.unit, freq: e.freq, caveat: e.caveat };
  let series;
  if (e.source === "nyfed") {
    series = await fetchNyFed(e.config.nyfedPath, { id: e.id, label: e.label, meta });
  } else if (e.source === "yahoo") {
    series = await fetchYahoo(e.config.symbol, { id: e.id, label: e.label, meta });
  } else if (e.source === "hkma") {
    series = await getHkmaWithFallback(e, meta);
  } else {
    series = loadLocalSeries(e.config.file, e.config.key, e.label);
  }
  cache?.set(`series:${id}`, series, 10 * 60 * 1000, now); // 10min
  return series;
}
