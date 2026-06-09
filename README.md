# 利率与汇率监控仪表盘（自用 · 无 API key）

本地运行的 HTML 仪表盘：查询利率/汇率历史与**实时**值、画时间序列图、并生成多情景未来走势研判。
**全部数据源与分析均无需任何 API key。** 架构：HTML 前端 + 零依赖 Node 代理。

## 启动（无需任何 key）

1. 装好 Node 18+（实测 v24 OK）：`node -v`
2. `npm start`（即 `node server.js`），浏览器开 http://localhost:8787
3. （可选）`.env`：仅 `PORT` / `OLLAMA_URL` / `OLLAMA_MODEL`，都有默认值。

> 研判叙述用本地 **Ollama**（默认 `qwen2.5:3b`）。没装/没开 Ollama 也能用——研判自动退回**纯量化**结果。装 Ollama：`brew install ollama && ollama serve`，再 `ollama pull qwen2.5:3b`。

## 数据源与口径（全部免 key）

| 标的 | 来源 | 频率/口径 |
|---|---|---|
| SOFR / EFFR | **纽约联储 Markets API** | 日度，官方 |
| 美债 13周/5Y/10Y/30Y | **Yahoo Finance**（^IRX/^FVX/^TNX/^TYX） | 实时盘中 |
| USD/CNY 在岸 · USD/CNH 离岸 | Yahoo（CNY=X / CNH=X） | 实时盘中 |
| 美元指数 DXY | Yahoo（DX-Y.NYB） | 实时，ICE 美元指数 |
| HIBOR O/N,1M,3M,12M | HKMA 实时 API，失败回退 `data/hibor.json` | 日度；见下「HKMA 说明」 |
| Shibor | 本地 `data/shibor.json` | 无免费实时源，手动维护 |
| LPR 1Y/5Y | 本地 `data/lpr.json` | 月度，手动更新（每月 20 日） |

### HKMA 说明（实测）
HKMA 开放 API 受阿里云 WAF 保护，**脚本/服务端访问可能被挑战挂起**（本机 curl 与 headless 浏览器均网络层超时；真实浏览器在友好网络下通常可达）。因此 HIBOR 策略为：服务端尽力实时取（5s 超时）→ 失败回退本地 `data/hibor.json`，并在卡片标注。

## 研判（无 key 的「分析」）
- **量化引擎**（即时、确定）：从序列算 趋势 / 近端动量 / 波动率 / z 分数 / 区间位置，按「短档趋势跟随、长档均值回归」生成**四档（1-3M/3-6M/6-12M/12-24M）× 三情景（上行/中性/下行）概率**（每档和=1）。
- **本地模型叙述**（可选）：把上述信号喂给本地 Ollama，**只改写文字**（驱动、对信贷/宏观的启示、近况、风险/关注），**不改概率**。Ollama 不可用则显示纯量化结果（界面有「纯量化兜底」徽章）。
- 手动触发，结果缓存 6h。

## 维护本地数据
- **LPR**：每月 20 日公布后，在 `data/lpr.json` 追加 `{ "date": "YYYY-MM-DD", "value": x.xx }`。
- **Shibor**：按官方（www.shibor.org / chinamoney.com.cn）核对后改 `data/shibor.json`。
- **HIBOR 兜底**：网络长期取不到 HKMA 时，维护 `data/hibor.json`。

## 测试
`npm test`（Node 内置 `node:test`，零依赖）。覆盖 cache/util/nyfed/yahoo/hkma/local-source/registry/quant/ollama(merge)/env。

## 免责
数据来自上述公开源；研判概率由量化信号确定、叙述由本地模型生成，**非投资建议**。
