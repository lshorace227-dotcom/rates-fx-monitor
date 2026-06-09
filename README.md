# 利率与汇率监控仪表盘（自用 · 无 API key）

本地运行的 HTML 仪表盘：查询利率/汇率历史与**实时**值、画时间序列图、并生成多情景未来走势研判。
**全部数据源与分析均无需任何 API key。** 架构：HTML 前端 + 零依赖 Node 代理。

## 启动（无需任何 API key）

1. 装好 Node 18+（实测 v24 OK）：`node -v`
2. `npm start`（即 `node server.js`），浏览器开 http://localhost:8787
3. （可选）`.env`：仅 `PORT` / `CLAUDE_BIN` / `CLAUDE_MODEL`，都有默认值。

> 研判叙述用本地 **`claude` CLI 无头调用**（`claude -p --output-format json`，走你的 Claude Code 订阅，**无需 API key**）。默认模型 `sonnet`。`claude` 不可用/超时时，研判自动退回**纯量化**结果。

## 数据源与口径（全部免 key）

| 标的 | 来源 | 频率/口径 |
|---|---|---|
| SOFR / EFFR | **纽约联储 Markets API** | 日度，官方 |
| 美债 13周/5Y/10Y/30Y | **Yahoo Finance**（^IRX/^FVX/^TNX/^TYX） | 实时盘中 |
| USD/CNY 在岸 | Yahoo（CNY=X） | 实时盘中，有历史 |
| USD/CNH 离岸 | Yahoo（CNH=X） | 仅当前值（Yahoo 无历史，图上单点） |
| 美元指数 DXY | Yahoo（DX-Y.NYB） | 实时，ICE 美元指数 |
| HIBOR 隔夜 / 1M | HKMA `daily-figures-interbank-liquidity`（免 key，有历史） | 日度，官方 |
| HIBOR 3M / 12M | 本地 `data/hibor.json` | HKMA 免费 API 无此两档，手动维护 |
| Shibor | 本地 `data/shibor.json` | 无免费实时源，手动维护 |
| LPR 1Y/5Y | 本地 `data/lpr.json` | 月度，手动更新（每月 20 日） |

### HKMA 说明（实测）
HKMA 免费开放 API 的 HIBOR 数据在 `daily-figures-interbank-liquidity` 端点（字段 `hibor_overnight` / `hibor_fixing_1m`），免 key、有历史、服务端可取。**完整期限曲线（3M/12M 等）不在此免费 API**（属 HKAB，无干净接口），故 3M/12M 留作本地手动维护。HKMA 主机受阿里云 WAF 保护、偶发挂起，故取数带超时，失败回退 `data/hibor.json`。

## 研判（无 key 的「分析」）
- **量化引擎**（即时、确定）：从序列算 趋势 / 近端动量 / 波动率 / z 分数 / 区间位置，按「短档趋势跟随、长档均值回归」生成**四档（1-3M/3-6M/6-12M/12-24M）× 三情景（上行/中性/下行）概率**（每档和=1）。
- **Claude 叙述**：把上述信号喂给本地 `claude` CLI（无头，走 Claude Code 订阅、无需 API key），**只改写文字**（驱动、对信贷/宏观的启示、近况、风险/关注），**不改概率**。`claude` 不可用则显示纯量化结果（界面有「纯量化兜底」徽章）。
- **含实时新闻**（界面勾选，默认开）：**服务端**先抓 Google News RSS（免 key）取该标的近期真实新闻标题与链接，连同量化信号一起喂给 Claude 写研判，底部列出**真实来源链接**（徽章「Claude + 实时新闻」）。约 70–90s；可取消勾选退回纯叙述。
  - 注：不让无头 `claude` 自己 WebSearch——实测无头模式下它不真执行联网（`web_search_requests=0`）反而会**编造新闻+伪造 URL**，故改由服务端抓真实 RSS 再喂给它，确保新闻与来源真实。
- 手动触发，结果按 (标的×是否含新闻) 缓存 6h。每次起一次 `claude` 子进程，计入你的 Claude Code 用量。

## 维护本地数据
- **LPR**：每月 20 日公布后，在 `data/lpr.json` 追加 `{ "date": "YYYY-MM-DD", "value": x.xx }`。
- **Shibor**：按官方（www.shibor.org / chinamoney.com.cn）核对后改 `data/shibor.json`。
- **HIBOR 兜底**：网络长期取不到 HKMA 时，维护 `data/hibor.json`。

## 测试
`npm test`（Node 内置 `node:test`，零依赖）。覆盖 cache/util/nyfed/yahoo/hkma/local-source/registry/quant/narrative/env。

## 免责
数据来自上述公开源；研判概率由量化信号确定、叙述由 Claude 生成，**非投资建议**。
