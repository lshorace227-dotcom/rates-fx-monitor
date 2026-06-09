# 利率与汇率监控仪表盘（自用）

本地运行的 HTML 仪表盘：查询利率/汇率历史与最新值、画时间序列图、用 Claude 生成多情景未来走势研判。
架构：**HTML 前端 + 零依赖 Node 代理**（key 只在服务端，永不进前端）。

## 启动

1. 装好 Node 18+（实测 v24 OK）：`node -v`
2. 复制 `.env.example` 为 `.env`，填入：
   - `FRED_API_KEY`（免费秒批：https://fredaccount.stlouisfed.org/apikeys）
   - `ANTHROPIC_API_KEY`（https://console.anthropic.com/）
3. `npm start`（即 `node server.js`），浏览器开 http://localhost:8787

> 无 key 也能启动：缺 `FRED_API_KEY` 时 US 利率/汇率卡片显示「⚠ 缺 FRED_API_KEY」；缺 `ANTHROPIC_API_KEY` 时研判按钮提示缺 key。LPR/Shibor/HIBOR 不依赖 key。

## 数据源与口径

| 标的 | 来源 | 频率/口径 |
|---|---|---|
| SOFR / EFFR / 美债 2Y,10Y | FRED（需 key） | 日度，官方 |
| HIBOR O/N,1M,3M,12M | HKMA 实时 API，失败回退 `data/hibor.json` | 日度；见下「HKMA 说明」 |
| USD/CNY | FRED `DEXCHUS`（需 key） | 日度，非 tick；在岸 |
| 美元指数 | FRED `DTWEXBGS`（需 key） | 广义美元指数代理，**≠ ICE DXY** |
| Shibor | 本地 `data/shibor.json` | 无免费实时源，手动维护 |
| LPR 1Y/5Y | 本地 `data/lpr.json` | 月度，手动更新（每月 20 日） |

### HKMA 说明（实测）
HKMA 开放 API 受阿里云 WAF 保护：**脚本/服务端访问会被挑战挂起**（curl 与 headless 浏览器在本环境均网络层超时；真实浏览器在友好网络下通常可达）。
因此 HIBOR 取数策略为：**服务端尽力实时取（5s 超时）→ 失败则回退本地 `data/hibor.json` 维护值**，并在卡片标注「HKMA 实时取数失败，回退本地维护值」。在你本机正常网络、低频访问下，实时大概率能取到；取不到也不会卡死仪表盘。

## 维护本地数据

- **LPR**：每月 20 日公布后，在 `data/lpr.json` 对应序列追加 `{ "date": "YYYY-MM-DD", "value": x.xx }`。
- **Shibor**：按官方（www.shibor.org / chinamoney.com.cn）核对后改 `data/shibor.json`。
- **HIBOR 兜底**：若你的网络长期取不到 HKMA 实时，可在 `data/hibor.json` 维护最新值。

## 功能
- **概览卡片**：利率/汇率分组，每张显示 最新值 / 1M 变动 / sparkline / 来源·日期·口径。
- **时间序列图**：勾选多个标的叠加对比；1M/3M/6M/1Y/5Y/全部 范围切换；缩放/拖拽/tooltip（ECharts）。
- **AI 研判**：选标的 → 生成研判 → 四个时间档（1-3M/3-6M/6-12M/12-24M）× 三情景（上行/中性/下行），各带概率、驱动、对信贷/宏观的启示。手动触发，结果缓存 6h。

## 测试
`npm test`（Node 内置 `node:test`，零依赖）。覆盖 cache / util / fred / hkma / local-source / registry / insight / env 的纯逻辑。

## 缓存
数据 10 分钟、研判 6 小时（内存缓存，重启即清）。

## 免责
数据来自上述公开源；研判由 AI 生成，**非投资建议**；模型知识有截止时点且未接入实时新闻。
