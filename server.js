// server.js
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.js";
import { createCache } from "./lib/cache.js";
import { REGISTRY, getEntry } from "./lib/registry.js";
import { getSeries } from "./lib/series-service.js";
import { sliceByRange, summarizeSeries } from "./lib/util.js";
import { requestInsight } from "./lib/insight.js";

const env = loadEnv();
const PORT = Number(env.PORT) || 8787;
const FRED_KEY = env.FRED_API_KEY;
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY;
const MODEL = env.INSIGHT_MODEL || "claude-sonnet-4-6";
const cache = createCache();
const insightCache = createCache();

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function serveStatic(res, entry) {
  try {
    const [file, type] = entry;
    const buf = await readFile(fileURLToPath(new URL("./" + file, import.meta.url)));
    res.writeHead(200, { "content-type": type });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === "/favicon.ico") { res.writeHead(204); return res.end(); }
  if (STATIC[path]) return serveStatic(res, STATIC[path]);

  // 标的清单（前端用来渲染分组与勾选）
  if (path === "/api/registry") {
    return json(res, 200, REGISTRY.map(({ id, label, group, unit, freq, caveat }) => ({ id, label, group, unit, freq, caveat })));
  }

  // 单条序列：/api/series?id=SOFR&range=1Y
  if (path === "/api/series") {
    const id = url.searchParams.get("id");
    const range = url.searchParams.get("range") || "ALL";
    if (!getEntry(id)) return json(res, 400, { error: `unknown id ${id}` });
    if (getEntry(id).source === "fred" && !FRED_KEY) return json(res, 200, { id, points: [], meta: { error: "缺 FRED_API_KEY" } });
    try {
      const s = await getSeries(id, { fredKey: FRED_KEY, cache });
      return json(res, 200, { ...s, points: sliceByRange(s.points, range) });
    } catch (e) {
      return json(res, 200, { id, points: [], meta: { error: String(e.message) } });
    }
  }

  // 概览：所有标的最新值 + 变动（失败的标记 error，不整体崩）
  if (path === "/api/latest") {
    const out = await Promise.all(REGISTRY.map(async e => {
      try {
        if (e.source === "fred" && !FRED_KEY) throw new Error("缺 FRED_API_KEY");
        const s = await getSeries(e.id, { fredKey: FRED_KEY, cache });
        const sum = summarizeSeries(s);
        return { id: e.id, label: e.label, group: e.group, unit: e.unit, caveat: e.caveat,
                 source: s.meta.source, ...sum, spark: s.points.slice(-30).map(p => p.value) };
      } catch (err) {
        return { id: e.id, label: e.label, group: e.group, unit: e.unit, error: String(err.message) };
      }
    }));
    return json(res, 200, out);
  }

  // 研判：/api/insight?id=SOFR （缓存 6h，手动触发）
  if (path === "/api/insight") {
    const id = url.searchParams.get("id");
    if (!getEntry(id)) return json(res, 400, { error: `unknown id ${id}` });
    if (!ANTHROPIC_KEY) return json(res, 400, { error: "缺 ANTHROPIC_API_KEY" });
    const ck = `insight:${id}`;
    const hit = insightCache.get(ck);
    if (hit) return json(res, 200, hit);
    try {
      const s = await getSeries(id, { fredKey: FRED_KEY, cache });
      if (!s.points.length) return json(res, 400, { error: "该标的暂无数据，无法研判" });
      const insight = await requestInsight(s, { apiKey: ANTHROPIC_KEY, model: MODEL });
      insightCache.set(ck, insight, 6 * 60 * 60 * 1000);
      return json(res, 200, insight);
    } catch (e) {
      return json(res, 500, { error: String(e.message) });
    }
  }

  res.writeHead(404); res.end("not found");
});

server.listen(PORT, () => console.log(`▶ rates-fx-monitor: http://localhost:${PORT}`));
