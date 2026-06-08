# 利率与汇率监控仪表盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个 HTML 仪表盘（前端）+ 零依赖 Node 代理（后端），可查询利率/汇率历史与最新值、画可视化时间序列图、并调用 Claude 生成四档×三情景的未来走势研判。

**Architecture:** 前端 `index.html`/`app.js`/`styles.css` 用 ECharts 画图，所有取数打本地代理 `/api/*`。后端 `server.js`（Node 18+，ESM，零 npm 依赖）静态服务页面并代理 FRED / HKMA 数据源、读取本地 LPR/Shibor JSON、调用 Anthropic API 出研判，内存缓存省额度。Key 只在 server 端（`.env`）。

**Tech Stack:** Node 18+（内置 `http`、全局 `fetch`、`node:test`、`node:assert`）、ESM、ECharts（前端 CDN）、FRED API、HKMA Open API、Anthropic Messages API。

---

## 数据契约（贯穿全程，先读这段）

**标准时间序列（Series）** —— 所有 adapter 归一到此形：

```js
// Series
{
  id: "SOFR",
  points: [ { date: "2026-06-05", value: 5.33 }, ... ],  // date=YYYY-MM-DD, value=number, 升序
  meta: {
    label: "SOFR",
    source: "FRED (SOFR)",
    freq: "daily",          // daily | monthly
    unit: "%",              // % | (汇率留空字符串)
    asof: "2026-06-05",     // points 中最新一条的 date
    caveat: null            // string | null，口径提示（如 DXY 代理口径）
  }
}
```

**研判（Insight）** —— `/api/insight` 返回此形：

```js
// Insight
{
  instrument: "SOFR",
  asof: "2026-06-05",
  current_level: 5.33,
  recent_move_summary: "近 1M ...",
  horizons: [
    { horizon: "1-3M", scenarios: [
        { name: "上行", prob: 0.30, drivers: ["..."], credit_macro_implication: "..." },
        { name: "中性", prob: 0.50, drivers: ["..."], credit_macro_implication: "..." },
        { name: "下行", prob: 0.20, drivers: ["..."], credit_macro_implication: "..." } ] },
    { horizon: "3-6M",  scenarios: [ ...3 条... ] },
    { horizon: "6-12M", scenarios: [ ...3 条... ] },
    { horizon: "12-24M",scenarios: [ ...3 条... ] }
  ],
  key_risks: ["..."],
  watch_items: ["FOMC", "CPI/PCE", "LPR 定价", "..."]
}
```

**Registry 条目** —— 单一事实来源 `lib/registry.js`：

```js
{ id, label, group: "利率"|"汇率", source: "fred"|"hkma"|"local",
  config: {...}, unit: "%"|"", freq: "daily"|"monthly", caveat: null|string }
```

---

## Task 0: 项目骨架

**Files:**
- Create: `package.json`
- Create: `.env.example`
- (已存在：`.gitignore`、`data/`、`lib/`、`test/`、`test/fixtures/`)

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "rates-fx-monitor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "利率与汇率监控仪表盘（自用）",
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  }
}
```

- [ ] **Step 2: 写 .env.example**

```bash
# 复制为 .env 并填入。.env 已被 .gitignore 忽略，不会进版本库。
# FRED API key（免费秒批）：https://fredaccount.stlouisfed.org/apikeys
FRED_API_KEY=

# Anthropic API key：https://console.anthropic.com/
ANTHROPIC_API_KEY=

# 可选：研判用的模型与服务端口（有默认值）
INSIGHT_MODEL=claude-sonnet-4-6
PORT=8787
```

- [ ] **Step 3: 验证 Node 版本 + 提交**

Run: `node -v`
Expected: v18 或更高（确认有全局 fetch 与 node:test）

```bash
git add package.json .env.example
git commit -m "chore: project scaffold (package.json, .env.example)"
```

---

## Task 1: TTL 内存缓存模块

**Files:**
- Create: `lib/cache.js`
- Test: `test/cache.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/cache.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCache } from "../lib/cache.js";

test("set then get returns value before TTL", () => {
  const c = createCache();
  c.set("k", 42, 1000, 1_000_000);          // ttlMs=1000, now=1_000_000
  assert.equal(c.get("k", 1_000_500), 42);   // 0.5s 后仍在
});

test("get returns undefined after TTL", () => {
  const c = createCache();
  c.set("k", 42, 1000, 1_000_000);
  assert.equal(c.get("k", 1_002_000), undefined); // 2s 后过期
});

test("get returns undefined for missing key", () => {
  const c = createCache();
  assert.equal(c.get("nope", 1_000_000), undefined);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/cache.test.js`
Expected: FAIL（`createCache` 未定义 / 模块不存在）

- [ ] **Step 3: 写实现**

```js
// lib/cache.js
// 极简 TTL 内存缓存。now 作为参数注入便于测试；生产调用传 Date.now()。
export function createCache() {
  const store = new Map(); // key -> { value, expiresAt }
  return {
    get(key, now = Date.now()) {
      const e = store.get(key);
      if (!e) return undefined;
      if (now >= e.expiresAt) { store.delete(key); return undefined; }
      return e.value;
    },
    set(key, value, ttlMs, now = Date.now()) {
      store.set(key, { value, expiresAt: now + ttlMs });
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/cache.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add lib/cache.js test/cache.test.js
git commit -m "feat: TTL in-memory cache"
```

---

## Task 2: 通用工具 —— 区间切片与序列统计

**Files:**
- Create: `lib/util.js`
- Test: `test/util.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/util.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { sliceByRange, summarizeSeries } from "../lib/util.js";

const pts = [
  { date: "2026-01-05", value: 1 },
  { date: "2026-03-05", value: 2 },
  { date: "2026-05-05", value: 3 },
  { date: "2026-06-05", value: 4 },
];

test("sliceByRange '3M' keeps points within 3 months of last date", () => {
  const out = sliceByRange(pts, "3M");
  assert.deepEqual(out.map(p => p.value), [2, 3, 4]); // 2026-03-05 起
});

test("sliceByRange 'ALL' returns everything", () => {
  assert.equal(sliceByRange(pts, "ALL").length, 4);
});

test("summarizeSeries computes current/asof/min/max and changes", () => {
  const s = summarizeSeries({ id: "X", points: pts, meta: { unit: "%" } });
  assert.equal(s.current, 4);
  assert.equal(s.asof, "2026-06-05");
  assert.equal(s.min, 1);
  assert.equal(s.max, 4);
  assert.equal(s.chg1m, 1);  // 4 - 3（约 1 个月前最近一点）
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/util.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/util.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add lib/util.js test/util.test.js
git commit -m "feat: range slicing + series summary utils"
```

---

## Task 3: FRED adapter（探测真实响应 → 归一 TDD → 实时拉取）

**Files:**
- Create: `test/fixtures/fred-sofr.json`（探测得到的真实样本）
- Create: `lib/fred.js`
- Test: `test/fred.test.js`

- [ ] **Step 1: 探测 FRED 真实响应并存 fixture**

> 需要一个 FRED key（免费）。先 `export FRED_API_KEY=xxxx`，再：

Run:
```bash
curl -s "https://api.stlouisfed.org/fred/series/observations?series_id=SOFR&api_key=$FRED_API_KEY&file_type=json&observation_start=2026-04-01" \
  -o "test/fixtures/fred-sofr.json"
head -c 400 "test/fixtures/fred-sofr.json"
```
Expected: 看到形如 `{"observations":[{"date":"2026-04-01","value":"5.33",...}, ...]}`；其中缺失值的 `value` 是 `"."`。
若字段与下方 `normalizeFred` 假设不符，以**实际 fixture 为准**调整解析。

- [ ] **Step 2: 写失败测试（对着真实 fixture）**

```js
// test/fred.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeFred } from "../lib/fred.js";

const raw = JSON.parse(readFileSync(new URL("./fixtures/fred-sofr.json", import.meta.url)));

test("normalizeFred parses observations into Series, dropping '.'", () => {
  const s = normalizeFred(raw, { id: "SOFR", label: "SOFR", unit: "%", freq: "daily", caveat: null });
  assert.ok(s.points.length > 0);
  for (const p of s.points) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof p.value, "number");
    assert.ok(Number.isFinite(p.value));
  }
  // 升序
  const dates = s.points.map(p => p.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(s.meta.source, "FRED (SOFR)");
  assert.equal(s.meta.asof, s.points[s.points.length - 1].date);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/fred.test.js`
Expected: FAIL（`lib/fred.js` 不存在）

- [ ] **Step 4: 写实现**

```js
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/fred.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add lib/fred.js test/fred.test.js test/fixtures/fred-sofr.json
git commit -m "feat: FRED adapter with fixture-backed normalize"
```

---

## Task 4: HKMA HIBOR adapter（探测 → 归一 TDD → 拉取）

**Files:**
- Create: `test/fixtures/hkma-hibor.json`
- Create: `lib/hkma.js`
- Test: `test/hkma.test.js`

- [ ] **Step 1: 探测 HKMA 真实响应并存 fixture**

> HKMA Open API 免 key。先确认正确端点（HKMA 文档：market-data-and-statistics → daily monetary statistics → interbank interest rates）。

Run:
```bash
curl -s "https://api.hkma.gov.hk/public/market-data-and-statistics/daily-monetary-statistics/interbank-interest-rates?lang=en&pagesize=50" \
  -o "test/fixtures/hkma-hibor.json"
python3 -c "import json,sys; d=json.load(open('test/fixtures/hkma-hibor.json')); rec=d['result']['records'][0]; print(list(rec.keys())); print(rec)"
```
Expected: 打印出单条记录的字段名（含 `end_of_date` 与各期限 HIBOR，如 `ir_overnight`/`ir_1m`/`ir_3m`/`ir_12m` 等）。
**以实际字段名为准**填入下方 `FIELD_MAP`；若端点 404，改用 HKMA 文档当前路径并更新 `HKMA_URL`。

- [ ] **Step 2: 写失败测试（对着真实 fixture）**

```js
// test/hkma.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeHkma } from "../lib/hkma.js";

const raw = JSON.parse(readFileSync(new URL("./fixtures/hkma-hibor.json", import.meta.url)));

test("normalizeHkma extracts a tenor into ascending Series", () => {
  const s = normalizeHkma(raw, {
    id: "HIBOR_3M", label: "HIBOR 3M", field: "ir_3m",  // ← 按 Step 1 实际字段名
    unit: "%", freq: "daily", caveat: null,
  });
  assert.ok(s.points.length > 0);
  for (const p of s.points) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(p.value));
  }
  const dates = s.points.map(p => p.date);
  assert.deepEqual(dates, [...dates].sort()); // 升序
  assert.equal(s.meta.source, "HKMA (HIBOR fixing)");
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/hkma.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 写实现（FIELD/日期键按 Step 1 实测调整）**

```js
// lib/hkma.js
const HKMA_URL = "https://api.hkma.gov.hk/public/market-data-and-statistics/daily-monetary-statistics/interbank-interest-rates";
const DATE_KEY = "end_of_date"; // ← 按 Step 1 实测确认

export function normalizeHkma(raw, { id, label, field, unit, freq, caveat }) {
  const records = raw?.result?.records ?? [];
  const points = records
    .map(r => ({ date: r[DATE_KEY], value: Number(r[field]) }))
    .filter(p => p.date && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const asof = points.length ? points[points.length - 1].date : null;
  return { id, points, meta: { label, source: "HKMA (HIBOR fixing)", freq, unit, asof, caveat } };
}

export async function fetchHkma(field, { id, label, meta, pagesize = 365 }) {
  const url = `${HKMA_URL}?lang=en&pagesize=${pagesize}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HKMA HTTP ${res.status}`);
  const raw = await res.json();
  return normalizeHkma(raw, { id, label, field, ...meta });
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/hkma.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add lib/hkma.js test/hkma.test.js test/fixtures/hkma-hibor.json
git commit -m "feat: HKMA HIBOR adapter with fixture-backed normalize"
```

---

## Task 5: 本地数据源（LPR / Shibor）+ 种子数据

**Files:**
- Create: `data/lpr.json`
- Create: `data/shibor.json`
- Create: `lib/local-source.js`
- Test: `test/local-source.test.js`

- [ ] **Step 1: 写种子数据文件**

> 这是用户维护的数据，非代码占位。执行时用 WebSearch/官方源核实**当前最新值**再填，`asof` 写真实公布日。下方为结构示例（值需核实更新）。

```json
// data/lpr.json
{
  "label": "LPR 贷款市场报价利率",
  "source": "PBOC 月度公布",
  "freq": "monthly",
  "unit": "%",
  "caveat": "月度数据；每月 20 日公布，需手动更新",
  "series": {
    "LPR_1Y": [
      { "date": "2026-05-20", "value": 3.00 }
    ],
    "LPR_5Y": [
      { "date": "2026-05-20", "value": 3.50 }
    ]
  }
}
```

```json
// data/shibor.json
{
  "label": "Shibor 上海银行间同业拆放利率",
  "source": "手动录入（无稳定免费 CORS 源）",
  "freq": "daily",
  "unit": "%",
  "caveat": "无免费实时源，可能非最新；请核对口径与日期",
  "series": {
    "SHIBOR_ON": [ { "date": "2026-05-30", "value": 1.50 } ],
    "SHIBOR_3M": [ { "date": "2026-05-30", "value": 1.90 } ]
  }
}
```

- [ ] **Step 2: 写失败测试**

```js
// test/local-source.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLocalSeries } from "../lib/local-source.js";

test("loadLocalSeries reads a tenor from data file into Series", () => {
  const s = loadLocalSeries("lpr.json", "LPR_1Y");
  assert.equal(s.id, "LPR_1Y");
  assert.ok(s.points.length >= 1);
  assert.ok(Number.isFinite(s.points[0].value));
  assert.equal(s.meta.freq, "monthly");
  assert.ok(s.meta.caveat); // 口径提示存在
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/local-source.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 写实现**

```js
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
```

- [ ] **Step 5: 跑测试确认通过 + 提交**

Run: `node --test test/local-source.test.js`
Expected: PASS

```bash
git add data/lpr.json data/shibor.json lib/local-source.js test/local-source.test.js
git commit -m "feat: local LPR/Shibor source + seed data"
```

---

## Task 6: 标的注册表 + 统一取数

**Files:**
- Create: `lib/registry.js`
- Create: `lib/series-service.js`
- Test: `test/registry.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/registry.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRY, getEntry } from "../lib/registry.js";

test("registry covers required instruments", () => {
  const ids = REGISTRY.map(e => e.id);
  for (const id of ["SOFR", "EFFR", "DGS2", "DGS10", "HIBOR_3M", "DEXCHUS", "DTWEXBGS", "LPR_1Y"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("every entry has group + source + label", () => {
  for (const e of REGISTRY) {
    assert.ok(["利率", "汇率"].includes(e.group));
    assert.ok(["fred", "hkma", "local"].includes(e.source));
    assert.ok(e.label && e.id);
  }
});

test("getEntry returns entry by id", () => {
  assert.equal(getEntry("SOFR").source, "fred");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/registry.test.js`
Expected: FAIL

- [ ] **Step 3: 写 registry**

```js
// lib/registry.js
// 单一事实来源：每个标的的展示信息 + 取数配置。
export const REGISTRY = [
  // —— 利率：美国（FRED）——
  { id: "SOFR",  label: "SOFR 担保隔夜融资利率", group: "利率", source: "fred", config: { seriesId: "SOFR" },  unit: "%", freq: "daily", caveat: null },
  { id: "EFFR",  label: "EFFR 有效联邦基金利率", group: "利率", source: "fred", config: { seriesId: "EFFR" },  unit: "%", freq: "daily", caveat: null },
  { id: "DGS2",  label: "美债 2Y 收益率",        group: "利率", source: "fred", config: { seriesId: "DGS2" },  unit: "%", freq: "daily", caveat: null },
  { id: "DGS10", label: "美债 10Y 收益率",       group: "利率", source: "fred", config: { seriesId: "DGS10" }, unit: "%", freq: "daily", caveat: null },
  // —— 利率：香港（HKMA）—— field 按 Task 4 Step 1 实测字段名
  { id: "HIBOR_ON", label: "HIBOR 隔夜", group: "利率", source: "hkma", config: { field: "ir_overnight" }, unit: "%", freq: "daily", caveat: null },
  { id: "HIBOR_1M", label: "HIBOR 1M",   group: "利率", source: "hkma", config: { field: "ir_1m" },        unit: "%", freq: "daily", caveat: null },
  { id: "HIBOR_3M", label: "HIBOR 3M",   group: "利率", source: "hkma", config: { field: "ir_3m" },        unit: "%", freq: "daily", caveat: null },
  { id: "HIBOR_12M",label: "HIBOR 12M",  group: "利率", source: "hkma", config: { field: "ir_12m" },       unit: "%", freq: "daily", caveat: null },
  // —— 利率：中国（本地维护）——
  { id: "LPR_1Y", label: "LPR 1Y", group: "利率", source: "local", config: { file: "lpr.json", key: "LPR_1Y" }, unit: "%", freq: "monthly", caveat: "月度，手动更新" },
  { id: "LPR_5Y", label: "LPR 5Y", group: "利率", source: "local", config: { file: "lpr.json", key: "LPR_5Y" }, unit: "%", freq: "monthly", caveat: "月度，手动更新" },
  { id: "SHIBOR_ON", label: "Shibor 隔夜", group: "利率", source: "local", config: { file: "shibor.json", key: "SHIBOR_ON" }, unit: "%", freq: "daily", caveat: "无免费实时源，可能非最新" },
  { id: "SHIBOR_3M", label: "Shibor 3M",   group: "利率", source: "local", config: { file: "shibor.json", key: "SHIBOR_3M" }, unit: "%", freq: "daily", caveat: "无免费实时源，可能非最新" },
  // —— 汇率 ——
  { id: "DEXCHUS",  label: "USD/CNY 在岸", group: "汇率", source: "fred", config: { seriesId: "DEXCHUS" },  unit: "", freq: "daily", caveat: "FRED 日度，非 tick；在岸口径" },
  { id: "DTWEXBGS", label: "美元指数(广义)", group: "汇率", source: "fred", config: { seriesId: "DTWEXBGS" }, unit: "", freq: "daily", caveat: "广义美元指数代理，≠ ICE DXY" },
];

export function getEntry(id) {
  return REGISTRY.find(e => e.id === id);
}
```

- [ ] **Step 4: 跑测试确认通过 + 提交**

Run: `node --test test/registry.test.js`
Expected: PASS

```bash
git add lib/registry.js test/registry.test.js
git commit -m "feat: instrument registry"
```

- [ ] **Step 5: 写 series-service（按 registry 分发到 adapter + 缓存；含 start 计算）**

```js
// lib/series-service.js
import { getEntry } from "./registry.js";
import { fetchFred } from "./fred.js";
import { fetchHkma } from "./hkma.js";
import { loadLocalSeries } from "./local-source.js";

// 计算 5 年前的 YYYY-MM-DD 作为 FRED observation_start（拉满历史给前端切片）
function fiveYearsAgoISO(now = Date.now()) {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

export async function getSeries(id, { fredKey, cache, now = Date.now() }) {
  const cached = cache?.get(`series:${id}`, now);
  if (cached) return cached;

  const e = getEntry(id);
  if (!e) throw new Error(`unknown instrument ${id}`);
  const meta = { unit: e.unit, freq: e.freq, caveat: e.caveat };
  let series;
  if (e.source === "fred") {
    series = await fetchFred(e.config.seriesId, { apiKey: fredKey, start: fiveYearsAgoISO(now), meta: { ...meta, label: e.label } });
    series.id = e.id; series.meta.label = e.label;
  } else if (e.source === "hkma") {
    series = await fetchHkma(e.config.field, { id: e.id, label: e.label, meta });
  } else {
    series = loadLocalSeries(e.config.file, e.config.key, e.label);
  }
  cache?.set(`series:${id}`, series, 10 * 60 * 1000, now); // 10min
  return series;
}
```

> 此模块依赖前面已测的 adapter；其网络分支在 Task 11 端到端验证时一并验。提交：

```bash
git add lib/series-service.js
git commit -m "feat: series service dispatch + 10min cache"
```

---

## Task 7: 研判模块（prompt 构造 + 概率校验/归一 TDD + Claude 调用）

**Files:**
- Create: `lib/insight.js`
- Test: `test/insight.test.js`

- [ ] **Step 1: 写失败测试（纯函数部分）**

```js
// test/insight.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInsightPrompt, normalizeInsight, INSIGHT_TOOL } from "../lib/insight.js";

const series = {
  id: "SOFR",
  points: [{ date: "2026-05-05", value: 5.2 }, { date: "2026-06-05", value: 5.33 }],
  meta: { label: "SOFR", unit: "%", asof: "2026-06-05" },
};

test("buildInsightPrompt mentions instrument, current level and 4 horizons", () => {
  const p = buildInsightPrompt(series);
  assert.match(p, /SOFR/);
  assert.match(p, /5\.33/);
  for (const h of ["1-3M", "3-6M", "6-12M", "12-24M"]) assert.ok(p.includes(h));
});

test("INSIGHT_TOOL is a valid tool schema forcing the structured shape", () => {
  assert.equal(INSIGHT_TOOL.name, "emit_insight");
  assert.ok(INSIGHT_TOOL.input_schema.properties.horizons);
});

test("normalizeInsight rescales each horizon's scenario probs to sum 1", () => {
  const raw = {
    instrument: "SOFR", asof: "2026-06-05", current_level: 5.33, recent_move_summary: "x",
    horizons: [{ horizon: "1-3M", scenarios: [
      { name: "上行", prob: 0.4, drivers: ["a"], credit_macro_implication: "i" },
      { name: "中性", prob: 0.4, drivers: ["b"], credit_macro_implication: "i" },
      { name: "下行", prob: 0.4, drivers: ["c"], credit_macro_implication: "i" },
    ] }],
    key_risks: ["r"], watch_items: ["w"],
  };
  const out = normalizeInsight(raw);
  const sum = out.horizons[0].scenarios.reduce((a, s) => a + s.prob, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("normalizeInsight throws when horizons missing", () => {
  assert.throws(() => normalizeInsight({ instrument: "X" }));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/insight.test.js`
Expected: FAIL

- [ ] **Step 3: 写实现**

```js
// lib/insight.js
import { summarizeSeries } from "./util.js";

const HORIZONS = ["1-3M", "3-6M", "6-12M", "12-24M"];

export const INSIGHT_TOOL = {
  name: "emit_insight",
  description: "输出该利率/汇率标的的多情景未来走势研判",
  input_schema: {
    type: "object",
    required: ["instrument", "asof", "current_level", "recent_move_summary", "horizons", "key_risks", "watch_items"],
    properties: {
      instrument: { type: "string" },
      asof: { type: "string" },
      current_level: { type: "number" },
      recent_move_summary: { type: "string" },
      horizons: {
        type: "array",
        items: {
          type: "object",
          required: ["horizon", "scenarios"],
          properties: {
            horizon: { type: "string", enum: HORIZONS },
            scenarios: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "prob", "drivers", "credit_macro_implication"],
                properties: {
                  name: { type: "string", enum: ["上行", "中性", "下行"] },
                  prob: { type: "number" },
                  drivers: { type: "array", items: { type: "string" } },
                  credit_macro_implication: { type: "string" },
                },
              },
            },
          },
        },
      },
      key_risks: { type: "array", items: { type: "string" } },
      watch_items: { type: "array", items: { type: "string" } },
    },
  },
};

export function buildInsightPrompt(series) {
  const s = summarizeSeries(series);
  const recent = series.points.slice(-12).map(p => `${p.date}: ${p.value}`).join("\n");
  return [
    `你是一位资深宏观利率与汇率分析师。针对下列标的，给出多情景未来走势研判。`,
    `标的：${series.meta.label}（${series.id}），单位 ${series.meta.unit || "（汇率）"}。`,
    `截至 ${s.asof}，最新值 ${s.current}；近 1M 变动 ${s.chg1m}，近 3M 变动 ${s.chg3m}；区间 [${s.min}, ${s.max}]。`,
    `近期数据点：\n${recent}`,
    ``,
    `要求：对以下四个时间档各给出三个情景（上行/中性/下行），每个情景含 概率(prob, 0~1)、关键驱动(drivers)、对银行对公信贷与宏观的启示(credit_macro_implication)。`,
    `时间档：${HORIZONS.join("、")}。每个时间档内三情景概率之和应为 1。`,
    `另给出 key_risks 与 watch_items（如 FOMC、CPI/PCE、LPR 定价、关税等）。`,
    `务必通过 emit_insight 工具输出结构化结果。`,
    `注意：你的知识有截止时点，且未接入实时新闻；研判基于以上数据与宏观常识，非投资建议。`,
  ].join("\n");
}

export function normalizeInsight(raw) {
  if (!raw || !Array.isArray(raw.horizons) || raw.horizons.length === 0) {
    throw new Error("insight missing horizons");
  }
  const horizons = raw.horizons.map(h => {
    const total = h.scenarios.reduce((a, s) => a + (Number(s.prob) || 0), 0) || 1;
    return { ...h, scenarios: h.scenarios.map(s => ({ ...s, prob: +(Number(s.prob) / total).toFixed(4) })) };
  });
  return { ...raw, horizons };
}

export async function requestInsight(series, { apiKey, model }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: 4000,
      tools: [INSIGHT_TOOL],
      tool_choice: { type: "tool", name: "emit_insight" },
      messages: [{ role: "user", content: buildInsightPrompt(series) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const block = (data.content || []).find(b => b.type === "tool_use");
  if (!block) throw new Error("no tool_use in Anthropic response");
  return normalizeInsight(block.input);
}
```

- [ ] **Step 4: 跑测试确认通过 + 提交**

Run: `node --test test/insight.test.js`
Expected: PASS（4 tests）

```bash
git add lib/insight.js test/insight.test.js
git commit -m "feat: insight prompt + tool schema + prob normalization"
```

---

## Task 8: 本地代理 server.js（路由 + 静态 + .env 解析）

**Files:**
- Create: `lib/env.js`（零依赖 .env 解析）
- Create: `server.js`
- Test: `test/env.test.js`

- [ ] **Step 1: 写 env 解析失败测试**

```js
// test/env.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "../lib/env.js";

test("parseEnv reads KEY=VALUE, ignores comments/blank", () => {
  const env = parseEnv("# c\nFRED_API_KEY=abc\n\nPORT=9000\n");
  assert.equal(env.FRED_API_KEY, "abc");
  assert.equal(env.PORT, "9000");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/env.test.js`
Expected: FAIL

- [ ] **Step 3: 写 env 实现**

```js
// lib/env.js
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

export function loadEnv() {
  const path = fileURLToPath(new URL("../.env", import.meta.url));
  const fromFile = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  return { ...fromFile, ...process.env }; // 进程环境变量优先
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/env.test.js`
Expected: PASS

- [ ] **Step 5: 写 server.js**

```js
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
```

- [ ] **Step 6: 冒烟验证（无 key 也应起得来 + registry 可用）**

Run:
```bash
node server.js &
sleep 1
curl -s http://localhost:8787/api/registry | head -c 200
curl -s http://localhost:8787/ | head -c 100
kill %1
```
Expected: registry 返回 JSON 数组；`/` 返回 HTML（Task 9 后才有内容，此刻可能 404，正常）。server 不报错退出。

- [ ] **Step 7: 提交**

```bash
git add lib/env.js test/env.test.js server.js
git commit -m "feat: zero-dep Node proxy server (routes + static + .env)"
```

---

## Task 9: 前端骨架（index.html + styles.css）

**Files:**
- Create: `index.html`
- Create: `styles.css`

- [ ] **Step 1: 写 index.html**

```html
<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>利率与汇率监控仪表盘</title>
  <link rel="stylesheet" href="/styles.css" />
  <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
</head>
<body>
  <header>
    <h1>利率与汇率监控仪表盘</h1>
    <p class="disclaimer">数据源见各卡片标注；研判为 AI 生成，非投资建议。</p>
  </header>

  <section id="overview">
    <h2>概览</h2>
    <div id="cards-利率" class="card-group"></div>
    <div id="cards-汇率" class="card-group"></div>
  </section>

  <section id="chart-section">
    <h2>时间序列</h2>
    <div id="picker"></div>
    <div id="ranges">
      <button data-range="1M">1M</button><button data-range="3M">3M</button>
      <button data-range="6M">6M</button><button data-range="1Y" class="active">1Y</button>
      <button data-range="5Y">5Y</button><button data-range="ALL">全部</button>
    </div>
    <div id="chart"></div>
  </section>

  <section id="insight-section">
    <h2>AI 研判</h2>
    <div id="insight-controls">
      <select id="insight-id"></select>
      <button id="insight-run">生成研判</button>
      <span id="insight-status"></span>
    </div>
    <div id="insight-output"></div>
  </section>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 styles.css（深色金融风）**

```css
/* styles.css */
:root { --bg:#0e1116; --panel:#161b22; --line:#222a35; --fg:#e6edf3; --muted:#8b949e; --up:#f85149; --down:#3fb950; --accent:#58a6ff; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system,"PingFang SC",system-ui,sans-serif; }
header { padding:16px 24px; border-bottom:1px solid var(--line); }
h1 { font-size:18px; margin:0; }
.disclaimer { color:var(--muted); font-size:12px; margin:4px 0 0; }
section { padding:16px 24px; }
h2 { font-size:14px; color:var(--muted); font-weight:600; margin:0 0 12px; }
.card-group { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:12px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; width:200px; }
.card .label { font-size:13px; }
.card .value { font-size:22px; font-weight:600; margin:2px 0; }
.card .chg.up { color:var(--up); } .card .chg.down { color:var(--down); }
.card .src { color:var(--muted); font-size:11px; margin-top:6px; }
.card.err { opacity:.6; }
.card svg { display:block; margin-top:6px; }
#picker { display:flex; flex-wrap:wrap; gap:8px 16px; margin-bottom:8px; }
#picker label { color:var(--fg); font-size:13px; }
#ranges button, #insight-controls button { background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:4px 10px; cursor:pointer; }
#ranges button.active { border-color:var(--accent); color:var(--accent); }
#chart { width:100%; height:420px; background:var(--panel); border:1px solid var(--line); border-radius:8px; margin-top:8px; }
#insight-controls { display:flex; gap:8px; align-items:center; margin-bottom:12px; }
#insight-id { background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:4px 8px; }
.horizon { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:12px; }
.horizon h3 { margin:0 0 8px; font-size:14px; color:var(--accent); }
.scn { display:grid; grid-template-columns:60px 1fr; gap:8px; padding:6px 0; border-top:1px solid var(--line); }
.scn .bar { height:8px; background:var(--accent); border-radius:4px; align-self:center; }
.scn .name { font-weight:600; } .scn .imp { color:var(--muted); font-size:12px; }
.meta-row { color:var(--muted); font-size:12px; margin-top:8px; }
</style>
```

> 注：上面 CSS 末尾误带 `</style>`，写文件时删掉该行（`.css` 文件不需要标签）。

- [ ] **Step 3: 验证静态服务**

Run:
```bash
node server.js & sleep 1
curl -s http://localhost:8787/ | grep -o "<title>.*</title>"
curl -s http://localhost:8787/styles.css | head -c 60
kill %1
```
Expected: 返回 `<title>利率与汇率监控仪表盘</title>` 与 CSS 内容。

- [ ] **Step 4: 提交**

```bash
git add index.html styles.css
git commit -m "feat: frontend skeleton (index.html + dark styles)"
```

---

## Task 10: 前端逻辑 app.js —— 概览卡片 + sparkline

**Files:**
- Create: `app.js`

- [ ] **Step 1: 写 app.js 第一段（概览）**

```js
// app.js
const $ = (sel) => document.querySelector(sel);

function sparkline(values, w = 176, h = 28) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
  return `<svg width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="#58a6ff" stroke-width="1.5"/></svg>`;
}

function fmt(v, unit) { return v == null ? "—" : (unit === "%" ? v.toFixed(2) + "%" : v.toFixed(4)); }
function chgClass(v) { return v == null ? "" : (v >= 0 ? "up" : "down"); }
function chgText(v, unit) { if (v == null) return ""; const s = v >= 0 ? "▲" : "▼"; return `${s} ${Math.abs(v).toFixed(unit === "%" ? 2 : 4)}`; }

async function loadOverview() {
  const rows = await fetch("/api/latest").then(r => r.json());
  for (const group of ["利率", "汇率"]) {
    const box = document.getElementById(`cards-${group}`);
    box.innerHTML = "";
    for (const r of rows.filter(x => x.group === group)) {
      const div = document.createElement("div");
      div.className = "card" + (r.error ? " err" : "");
      if (r.error) {
        div.innerHTML = `<div class="label">${r.label}</div><div class="value">—</div><div class="src">⚠ ${r.error}</div>`;
      } else {
        div.innerHTML =
          `<div class="label">${r.label}</div>` +
          `<div class="value">${fmt(r.current, r.unit)}</div>` +
          `<div class="chg ${chgClass(r.chg1m)}">${chgText(r.chg1m, r.unit)} <span style="color:var(--muted)">1M</span></div>` +
          sparkline(r.spark) +
          `<div class="src">${r.source || ""} · ${r.asof || ""}${r.caveat ? " · " + r.caveat : ""}</div>`;
      }
      box.appendChild(div);
    }
  }
}
```

- [ ] **Step 2: 浏览器验证概览**

Run: `node server.js`（需已配 `.env` 的 `FRED_API_KEY`），浏览器开 `http://localhost:8787`
Expected: 利率/汇率两组卡片渲染；US 利率与 USD/CNY 显示真实最新值 + sparkline；缺数据的标的显示 ⚠ 而非整页崩。
（关闭：Ctrl-C）

- [ ] **Step 3: 提交**

```bash
git add app.js
git commit -m "feat: overview cards + sparkline"
```

---

## Task 11: 前端 app.js —— 主图（ECharts）+ 选择器 + 范围

**Files:**
- Modify: `app.js`（追加）

- [ ] **Step 1: 追加图表逻辑**

```js
// app.js（追加）
let chart, selected = new Set(["SOFR", "HIBOR_3M"]), curRange = "1Y", registry = [];

async function loadRegistry() {
  registry = await fetch("/api/registry").then(r => r.json());
  // 选择器（勾选）
  const picker = $("#picker"); picker.innerHTML = "";
  for (const e of registry) {
    const id = `chk-${e.id}`;
    const wrap = document.createElement("label");
    wrap.innerHTML = `<input type="checkbox" id="${id}" value="${e.id}" ${selected.has(e.id) ? "checked" : ""}/> ${e.label}`;
    wrap.querySelector("input").addEventListener("change", (ev) => {
      ev.target.checked ? selected.add(e.id) : selected.delete(e.id);
      drawChart();
    });
    picker.appendChild(wrap);
  }
  // 研判下拉
  const sel = $("#insight-id"); sel.innerHTML = "";
  for (const e of registry) sel.add(new Option(e.label, e.id));
}

async function drawChart() {
  if (!chart) chart = echarts.init(document.getElementById("chart"), "dark");
  const ids = [...selected];
  const series = await Promise.all(ids.map(id =>
    fetch(`/api/series?id=${id}&range=${curRange}`).then(r => r.json())));
  chart.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: "#e6edf3" } },
    grid: { left: 48, right: 16, top: 32, bottom: 56 },
    xAxis: { type: "time" },
    yAxis: { type: "value", scale: true },
    dataZoom: [{ type: "inside" }, { type: "slider" }],
    series: series.map(s => ({
      name: s.meta?.label || s.id,
      type: "line", showSymbol: false, smooth: false,
      data: (s.points || []).map(p => [p.date, p.value]),
    })),
  }, true);
}

function initRanges() {
  document.querySelectorAll("#ranges button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#ranges button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      curRange = btn.dataset.range;
      drawChart();
    });
  });
  window.addEventListener("resize", () => chart && chart.resize());
}

async function main() {
  await loadOverview();
  await loadRegistry();
  initRanges();
  await drawChart();
}
main();
```

- [ ] **Step 2: 浏览器验证图表**

Run: `node server.js`，开 `http://localhost:8787`
Expected: 默认画 SOFR + HIBOR_3M 折线；勾选其它标的叠加；范围按钮 1M/3M/.../ALL 切换重绘；可滚轮缩放/拖拽 slider；tooltip 显示各序列值。

- [ ] **Step 3: 提交**

```bash
git add app.js
git commit -m "feat: ECharts time-series chart + instrument picker + ranges"
```

---

## Task 12: 前端 app.js —— AI 研判面板（四档×三情景）

**Files:**
- Modify: `app.js`（追加）

- [ ] **Step 1: 追加研判渲染**

```js
// app.js（追加）
function renderInsight(ins) {
  const order = { "上行": 0, "中性": 1, "下行": 2 };
  const horizons = ins.horizons.map(h => {
    const scns = [...h.scenarios].sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9));
    const rows = scns.map(s => `
      <div class="scn">
        <div><div class="name">${s.name}</div><div>${(s.prob * 100).toFixed(0)}%</div></div>
        <div>
          <div class="bar" style="width:${(s.prob * 100).toFixed(0)}%"></div>
          <div>驱动：${(s.drivers || []).join("；")}</div>
          <div class="imp">信贷/宏观启示：${s.credit_macro_implication || ""}</div>
        </div>
      </div>`).join("");
    return `<div class="horizon"><h3>${h.horizon}</h3>${rows}</div>`;
  }).join("");
  return `
    <div class="meta-row">标的 ${ins.instrument} · 截至 ${ins.asof} · 当前 ${ins.current_level} · ${ins.recent_move_summary || ""}</div>
    ${horizons}
    <div class="horizon"><h3>关键风险 / 关注项</h3>
      <div>风险：${(ins.key_risks || []).join("；")}</div>
      <div class="imp">关注：${(ins.watch_items || []).join("；")}</div>
    </div>
    <div class="meta-row">⚠ AI 生成，非投资建议；模型知识有截止且未接入实时新闻。</div>`;
}

function initInsight() {
  $("#insight-run").addEventListener("click", async () => {
    const id = $("#insight-id").value;
    const status = $("#insight-status"), out = $("#insight-output");
    status.textContent = "生成中…（首次约 10–30s）"; out.innerHTML = "";
    try {
      const res = await fetch(`/api/insight?id=${id}`);
      const data = await res.json();
      if (data.error) { status.textContent = "⚠ " + data.error; return; }
      status.textContent = "";
      out.innerHTML = renderInsight(data);
    } catch (e) {
      status.textContent = "⚠ 请求失败：" + e.message;
    }
  });
}
```

- [ ] **Step 2: 在 main() 末尾接入 initInsight()**

修改 `app.js` 的 `main()`，在 `await drawChart();` 后加一行：

```js
  initInsight();
```

- [ ] **Step 3: 浏览器验证研判**

Run: `node server.js`（需 `.env` 配 `ANTHROPIC_API_KEY`），开页面 → 选标的 → 点「生成研判」
Expected: 约 10–30s 后渲染四个时间档（1-3M/3-6M/6-12M/12-24M），每档三情景（上行/中性/下行）带概率条、驱动、信贷启示；底部免责标注；二次点击同标的秒回（命中 6h 缓存）。

- [ ] **Step 4: 提交**

```bash
git add app.js
git commit -m "feat: AI insight panel (4 horizons x 3 scenarios)"
```

---

## Task 13: README + 端到端验收 + 收尾

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README.md**

````markdown
# 利率与汇率监控仪表盘（自用）

本地运行的 HTML 仪表盘：查询利率/汇率历史与最新值、画时间序列图、用 Claude 生成多情景未来走势研判。

## 启动

1. 装好 Node 18+（`node -v`）。
2. 复制 `.env.example` 为 `.env`，填入：
   - `FRED_API_KEY`（免费秒批：https://fredaccount.stlouisfed.org/apikeys）
   - `ANTHROPIC_API_KEY`（https://console.anthropic.com/）
3. `npm start`（即 `node server.js`），浏览器开 http://localhost:8787

## 数据源与口径

| 标的 | 来源 | 频率/口径 |
|---|---|---|
| SOFR / EFFR / 美债 2Y,10Y | FRED | 日度，官方 |
| HIBOR O/N,1M,3M,12M | HKMA Open API | 日度，官方 |
| USD/CNY | FRED `DEXCHUS` | 日度，非 tick；在岸 |
| 美元指数 | FRED `DTWEXBGS` | 广义美元指数代理，≠ ICE DXY |
| Shibor | 本地 `data/shibor.json` | 无免费实时源，手动维护 |
| LPR 1Y/5Y | 本地 `data/lpr.json` | 月度，手动更新（每月 20 日） |

## 维护本地数据

LPR 每月 20 日公布后，在 `data/lpr.json` 的对应序列追加 `{ "date": "YYYY-MM-DD", "value": x.xx }`。Shibor 同理改 `data/shibor.json`。

## 测试

`npm test`（Node 内置测试，零依赖）。

## 免责

数据来自上述公开源，研判由 AI 生成，**非投资建议**；模型知识有截止时点且未接入实时新闻。
````

- [ ] **Step 2: 跑全部单测**

Run: `node --test`
Expected: 所有测试 PASS（cache / util / fred / hkma / local-source / registry / insight / env）。

- [ ] **Step 3: 端到端验收（对照 spec §8）**

Run: `node server.js`，逐项核对：
- [ ] server 起得来，页面打开
- [ ] SOFR/EFFR/2Y/10Y + HIBOR + USD/CNY 有真实历史与最新值并出图
- [ ] 范围切换 / 多序列叠加 / 缩放可用
- [ ] 选标的能出四档×三情景研判（概率和=1）
- [ ] 每序列显示来源/频率/口径/更新时间
- [ ] 缺 key / 缺数据 / Claude 失败均友好降级，不整页崩

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: README (启动/数据源口径/维护/免责)"
```

---

## Self-Review（计划自检）

**Spec 覆盖核对：**
- §2 架构（HTML 前端 + 零依赖 Node 代理）→ Task 8/9/10/11/12 ✅
- §3 数据层（FRED/HKMA/本地，标准 Series，口径标注）→ Task 3/4/5/6 + 卡片 src 行 ✅
- §4 UI（概览条、主图范围/叠加/缩放、研判面板、深色风）→ Task 9/10/11/12 ✅
- §5 研判（四档×三情景、强制结构化、概率和=1、6h 缓存、免责）→ Task 7/12 + server insightCache ✅
- §6 错误降级（数据源失败/缺 key/Claude 失败）→ Task 8（/api/latest、/api/series、/api/insight 容错）+ Task 10/12 前端降级 ✅
- §7 文件结构 → 各 Task Create 路径一致 ✅
- §8 验收标准 → Task 13 Step 3 逐条核对 ✅

**占位符扫描：** 无 TBD/TODO。外部 API（FRED/HKMA）字段以「探测真实响应→对 fixture 写归一」处理，非占位；`data/*.json` 为用户维护的种子数据，已注明执行时核实当前值。

**类型一致性：** Series/Insight/Registry 三个契约在「数据契约」段统一定义，全程引用一致（`getSeries`/`normalizeFred`/`normalizeHkma`/`loadLocalSeries`/`buildInsightPrompt`/`normalizeInsight`/`requestInsight` 命名贯穿）。

**已知风险（执行时注意）：**
1. HKMA 端点路径与字段名需以 Task 4 Step 1 实测为准（计划已内置探测步骤）。
2. FRED 浏览器直连有 CORS——本设计一律经 server 端 fetch，已规避。
3. `INSIGHT_MODEL` 默认 `claude-sonnet-4-6`，可在 `.env` 改。研判用 tool_choice 强制结构化输出。
