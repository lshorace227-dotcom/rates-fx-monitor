# 利率与汇率监控仪表盘 —— 设计文档

- **日期**：2026-06-08
- **定位**：自用监控仪表盘（本地运行，信息密度优先，够好即可）
- **一句话**：一个以 HTML 仪表盘为前端的金融数据监控工具，可查询利率/汇率的**历史与最新值**、生成**可视化时间序列图表**、并调用 Claude 实时生成**多情景未来走势研判**。

---

## 1. 目标与范围

### 1.1 用户诉求（原始）
> 以 HTML 方式创建一个可查询历史及现在实时的金融数据，时间序列数据可生成可视化图表，以及可查看市场分析师对此金融数据未来走势研判的分析观点。

### 1.2 确认后的范围
- **数据范围**：利率 + 汇率
  - 利率：SOFR、EFFR、美债 2Y/10Y、HIBOR、Shibor、LPR(1Y/5Y)
  - 汇率：USD/CNY、DXY（代理口径）
- **研判来源**：AI 实时生成（调用 Claude），输出多情景 + 概率 + 逻辑，沿用既有「利率汇率研判」报告骨架。
- **研判时间档**：四档全做 —— 1-3M / 3-6M / 6-12M / 12-24M，每档三情景。
- **研判触发**：手动点按钮生成，结果缓存 6h（省 Claude 额度）。
- **定位**：自用、本地运行；桌面为主；深色克制金融风。

### 1.3 不做（YAGNI，v1 明确排除）
- 用户系统 / 登录 / 多用户
- tick 级实时（一律以数据源可得频率为准，多为日度）
- 下单 / 交易 / 组合管理
- 告警推送（v2 可加邮件，复用既有 launchd 经验）
- 新闻抓取（研判 v1 仅基于喂入的数据 + 模型常识；v2 可接新闻/WebSearch 增强）
- 数据库（内存缓存 + 本地 JSON 兜底足够）

---

## 2. 架构

```
浏览器 (index.html + app.js + ECharts)
        │  fetch /api/*
        ▼
本地代理 server.js  (Node 18+，零 npm 依赖：内置 http + 全局 fetch)
        ├── 静态服务：index.html / app.js / styles.css
        ├── /api/series   代理数据源 → 标准化时间序列
        ├── /api/latest   各标的最新值 + 日/周变动
        ├── /api/insight  取序列 → 构造 prompt → 调 Claude → 结构化研判 JSON
        └── 内存缓存：数据 ~10min TTL，研判 ~6h TTL
        │
        ├── FRED API        (FRED_API_KEY)     —— US 利率、USD/CNY、DXY 代理
        ├── HKMA Open API   (免 key, CORS-ok)  —— HIBOR
        ├── 本地 data/*.json                    —— LPR、Shibor 兜底
        └── Anthropic API   (ANTHROPIC_API_KEY) —— 研判
```

### 2.1 关键决策与理由
- **为什么要本地代理（而非纯单文件 HTML）**：①FRED 等数据源浏览器直连被 CORS 挡；②API key 不应裸露在前端；③可做缓存省额度。代理保持极薄（~100–150 行、零依赖、一条命令启动）。
- **为什么 Node 而非 Python**：与前端同语言、Node 18+ 自带全局 `fetch` 与 `http`，可零 `npm install` 起服务，最贴合「自用、够好、本地跑」。
- **配置**：根目录 `.env`（`FRED_API_KEY`、`ANTHROPIC_API_KEY`），server 端读取，**key 永不进前端**。提供 `.env.example`。
- **启动**：`node server.js` → 浏览器开 `http://localhost:8787`。

---

## 3. 数据层

每个标的一个 adapter，server 端统一归一为标准序列：

```json
{
  "id": "SOFR",
  "points": [{ "date": "2026-06-05", "value": 5.33 }, ...],
  "meta": {
    "label": "SOFR 担保隔夜融资利率",
    "source": "FRED (series SOFR)",
    "freq": "daily",
    "unit": "%",
    "asof": "2026-06-05",
    "caveat": null
  }
}
```

### 3.1 数据源映射

| 标的 | 来源 | 频率 / 口径 | 备注 |
|---|---|---|---|
| SOFR | FRED `SOFR` | 日度，官方 | |
| EFFR 有效联邦基金利率 | FRED `EFFR`（备 `DFF`） | 日度，官方 | |
| 美债 2Y / 10Y | FRED `DGS2` / `DGS10` | 日度，官方 | 可派生 10Y-2Y 利差曲线 |
| HIBOR (O/N,1M,3M,12M) | HKMA Open API | 日度 | 免 key、CORS-ok ✅ |
| USD/CNY | FRED `DEXCHUS`（可选叠加 ECB 免费源） | **日度，非 tick；在岸口径** | UI 标注非实时 tick |
| DXY | FRED `DTWEXBGS` 广义美元指数 | **代理口径，≠ ICE DXY** | UI 明确标注口径差异 |
| Shibor (O/N,1W,3M,1Y) | best-effort 抓取；失败回落 `data/shibor.json` | 无稳定免费 CORS 源 | UI 标「口径/日期」「可能非最新」 |
| LPR 1Y / 5Y | `data/lpr.json`（手动维护） | **月度**（每月 20 日定） | 低频，手动更新成本极低 |

### 3.2 数据诚实性原则
- 每条序列在 UI 必须显示：**来源 + 频率 + 口径 + 最后更新时间**。
- Shibor/LPR/DXY 的局限不隐藏，直接标在界面（对信贷分析的可溯源要求尤其重要）。
- 数据源失败时 **降级不崩溃**：卡片显示「数据源不可用 + 上次成功值/时间」。

---

## 4. 前端 UI / 交互

- **概览条**：利率组、汇率组分区；每张卡片显示 标的名 / 最新值 / 日·周变动（涨跌色）/ 迷你 sparkline / 来源·更新时间。
- **主图区**：选一个或多个标的叠加 → ECharts 折线时间序列：
  - 时间范围切换：1M / 3M / 6M / 1Y / 5Y / 全部
  - 多序列对比叠加（如 SOFR vs HIBOR、2Y vs 10Y 利差、USD/CNY vs DXY）
  - dataZoom 缩放拖拽、悬浮 tooltip、图例开关
- **AI 研判面板**：选中标的 → 点「生成研判」→ 渲染研判卡（见 §5）；面板含四个时间档（1-3M/3-6M/6-12M/12-24M）切换/分区。
- **风格**：深色克制金融风，信息密度优先，桌面为主，简单响应式。
- **图表库**：ECharts（多序列、缩放、免费、成熟）。

---

## 5. AI 研判逻辑

- 端点 `/api/insight?id=<标的>`：
  1. 取该标的近 6–12M 序列 + 近期变动统计（最新值、近 1M/3M 变动、min/max）。
  2. 构造 prompt：要求 Claude 针对**四个时间档各出三情景**，输出**强制结构化 JSON**（用 tool_use / JSON 模式）。
  3. 结果缓存 6h。
- 输出 schema（示意）：

```json
{
  "instrument": "SOFR",
  "asof": "2026-06-05",
  "current_level": 5.33,
  "recent_move_summary": "近 1M ...",
  "horizons": [
    {
      "horizon": "1-3M",
      "scenarios": [
        { "name": "上行", "prob": 0.30, "drivers": ["..."], "credit_macro_implication": "..." },
        { "name": "中性", "prob": 0.50, "drivers": ["..."], "credit_macro_implication": "..." },
        { "name": "下行", "prob": 0.20, "drivers": ["..."], "credit_macro_implication": "..." }
      ]
    }
    // 3-6M / 6-12M / 12-24M 同构
  ],
  "key_risks": ["..."],
  "watch_items": ["FOMC", "CPI/PCE", "LPR 定价", "..."]
}
```

- **约束**：每档三情景 `prob` 之和 = 1（prompt 强制 + server 端校验/归一）。
- **模型**：默认 Claude（Opus/Sonnet 可配，写进 `.env` 或 server 常量）。
- **免责标注**：研判卡注明「AI 生成 · 非投资建议 · 基于截至 <asof> 的数据 · 模型知识有截止、非实时新闻」。

---

## 6. 错误处理 / 边界

| 情况 | 行为 |
|---|---|
| 某数据源失败 | 该卡片显示「不可用 + 上次成功值/时间」，其余正常，不整页崩 |
| 缺 API key | 启动时友好报错，指向 `.env`/`.env.example` |
| LPR/Shibor 兜底缺失 | 标「需手动更新」 |
| Claude 调用失败/超时 | 研判卡显示错误 + 重试按钮 |
| 额度/速率 | 研判手动触发 + 6h 缓存；数据 10min 缓存 |

---

## 7. 文件结构

```
~/5. Other Claude Output/rates-fx-monitor/
  index.html          # 仪表盘 UI 骨架
  app.js              # 前端逻辑：取数、ECharts 画图、研判渲染
  styles.css          # 深色金融风样式
  server.js           # 零依赖 Node 代理（静态服务 + /api/* + 缓存）
  data/
    lpr.json          # 手动维护的 LPR 月度值（含 asof）
    shibor.json       # Shibor 兜底值（含 asof）
  .env.example        # FRED_API_KEY / ANTHROPIC_API_KEY 模板
  .gitignore          # 忽略 .env、node_modules，避免 key 进版本库
  README.md           # 启动说明、数据源口径表、免责声明
  docs/superpowers/specs/2026-06-08-rates-fx-monitor-design.md
```

---

## 8. 验收标准（Success Criteria）

1. `node server.js` 能启动；浏览器打开见仪表盘。
2. 至少 **US 利率（SOFR/EFFR/2Y/10Y）+ HIBOR + USD/CNY** 能取到真实历史与最新值并画出时间序列图。
3. 时间范围切换、多序列叠加、缩放拖拽可用。
4. 选中标的能调 Claude 出**四档 × 三情景**结构化研判并正确渲染（概率和=1）。
5. 每条序列显示 来源 / 频率 / 口径 / 更新时间。
6. 缺数据、缺 key、Claude 失败均有友好降级，不整页崩。
7. README 含启动步骤、数据源口径说明与免责声明。

---

## 9. 未来扩展（v2，非本次范围）

- 新闻 / WebSearch 增强研判（接入实时事件）
- 邮件告警（复用既有本地 launchd 经验）
- 更多资产类（股指、商品、加密）
- Shibor 稳定数据源 / 离岸 CNH 实时
- 部署上线（如要转副业产品形态）
