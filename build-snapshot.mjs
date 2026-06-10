// build-snapshot.mjs — 在 GitHub Actions（或本地）抓取所有标的，算量化研判，生成静态 dist/。
// 静态站（GitHub Pages）无服务器/无 claude CLI，故：数据=每日快照；研判=量化（确定性，无 LLM）。
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REGISTRY } from "./lib/registry.js";
import { getSeries } from "./lib/series-service.js";
import { summarizeSeries } from "./lib/util.js";
import { templateInsight } from "./lib/quant.js";

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const DIST = ROOT + "dist/";

async function buildInstrument(e) {
  try {
    const series = await getSeries(e.id, {});
    const sum = summarizeSeries(series);
    const quantInsight = series.points.length ? templateInsight(series, e.label) : null;
    return {
      id: e.id, label: e.label, group: e.group, unit: e.unit, caveat: e.caveat,
      source: series.meta.source, asof: sum.asof,
      current: sum.current, chg1m: sum.chg1m, chg3m: sum.chg3m, min: sum.min, max: sum.max,
      spark: series.points.slice(-30).map(p => p.value),
      points: series.points,
      quantInsight,
    };
  } catch (err) {
    return { id: e.id, label: e.label, group: e.group, unit: e.unit, error: String(err.message) };
  }
}

const instruments = [];
for (const e of REGISTRY) {
  const it = await buildInstrument(e);
  instruments.push(it);
  console.log(`  ${e.id}: ${it.error ? "ERROR " + it.error : (it.points?.length ?? 0) + " pts, last " + it.asof}`);
}

const snapshot = { generatedAt: new Date().toISOString(), instruments };
mkdirSync(DIST, { recursive: true });
writeFileSync(DIST + "snapshot.json", JSON.stringify(snapshot));
for (const f of ["index.html", "app.js", "styles.css"]) copyFileSync(ROOT + f, DIST + f);

const ok = instruments.filter(i => !i.error).length;
console.log(`\n✅ snapshot built: ${ok}/${instruments.length} instruments OK, generatedAt ${snapshot.generatedAt}`);
