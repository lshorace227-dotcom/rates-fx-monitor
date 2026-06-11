// app.js — 双模式：
//   live   = 本地 node server.js 在跑，走 /api/*（完整 Claude + 新闻研判、实时数据）
//   static = 部署在 GitHub Pages，无服务器，回退读 snapshot.json（每日快照数据 + 量化研判）
const $ = (sel) => document.querySelector(sel);

let chart, selected = new Set(["SOFR", "HIBOR_3M"]), curRange = "1Y", registry = [];
let MODE = "live", SNAP = null;
const byId = {};

// 预设对比视图：一键加载组合（normalize=混合量纲时自动开指数化）
const PRESETS = {
  ust:  { ids: ["UST_3M", "UST_5Y", "UST_10Y", "UST_30Y"], normalize: false },
  cnus: { ids: ["SOFR", "LPR_1Y"],                          normalize: true },
  hkus: { ids: ["SOFR", "HIBOR_ON"],                        normalize: false },
  fx:   { ids: ["USDCNY", "DXY"],                           normalize: true },
};

// 浏览器端区间切片（static 模式用；与 lib/util.js 同逻辑）
const RANGE_DAYS = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "5Y": 1827 };
function addDaysISO(iso, days) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function sliceByRange(points, range) {
  if (!points.length || range === "ALL" || !RANGE_DAYS[range]) return points.slice();
  const cutoff = addDaysISO(points[points.length - 1].date, -RANGE_DAYS[range]);
  return points.filter(p => p.date >= cutoff);
}

async function detectMode() {
  try {
    const r = await fetch("/api/registry", { cache: "no-store" });
    if (!r.ok) throw new Error("no api");
    registry = await r.json();
    MODE = "live";
    $("#mode-badge").textContent = "● 实时";
    $("#mode-badge").classList.add("live");
  } catch {
    MODE = "static";
    SNAP = await fetch("snapshot.json", { cache: "no-store" }).then(r => r.json());
    SNAP.instruments.forEach(it => { byId[it.id] = it; });
    registry = SNAP.instruments.map(({ id, label, group, unit, freq, caveat }) => ({ id, label, group, unit, freq, caveat }));
    const d = SNAP.generatedAt ? new Date(SNAP.generatedAt) : null;
    $("#mode-badge").textContent = "◍ 每日快照" + (d ? " · " + d.toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
    $("#mode-badge").classList.add("static");
    if (d) $(".disclaimer").textContent =
      `每日快照（更新于 ${d.toLocaleString("zh-CN", { hour12: false })}）；研判为量化信号。点击卡片可加入/移出图表。完整 Claude+新闻研判见本地版。`;
  }
}

// ---------- 数据访问（按模式分流）----------
async function getLatestRows() {
  if (MODE === "live") return fetch("/api/latest").then(r => r.json());
  return SNAP.instruments.map(it => it.error
    ? { id: it.id, label: it.label, group: it.group, unit: it.unit, error: it.error }
    : { id: it.id, label: it.label, group: it.group, unit: it.unit, caveat: it.caveat,
        source: it.source, current: it.current, asof: it.asof, chg1m: it.chg1m,
        min: it.min, max: it.max, spark: it.spark });
}
async function getSeriesData(id, range) {
  if (MODE === "live") return fetch(`/api/series?id=${id}&range=${range}`).then(r => r.json());
  const it = byId[id] || {};
  return { id, meta: { label: it.label, source: it.source, unit: it.unit, caveat: it.caveat, asof: it.asof },
           points: sliceByRange(it.points || [], range) };
}
async function getInsight(id, news) {
  if (MODE === "live") return fetch(`/api/insight?id=${id}&news=${news}`).then(r => r.json());
  const it = byId[id] || {};
  if (!it.quantInsight) return { error: "该标的暂无数据，无法研判" };
  return { ...it.quantInsight, _snapshotAt: SNAP.generatedAt };
}

// ---------- 选中状态同步（卡片 ↔ chips ↔ 图表）----------
function toggleInstrument(id) {
  selected.has(id) ? selected.delete(id) : selected.add(id);
  syncSelectionUI();
  drawChart();
}
function setSelection(ids, normalize) {
  selected = new Set(ids);
  if (typeof normalize === "boolean") $("#normalize").checked = normalize;
  syncSelectionUI();
  drawChart();
}
function syncSelectionUI() {
  document.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", selected.has(c.dataset.id)));
  document.querySelectorAll(".card[data-id]").forEach(c => c.classList.toggle("on", selected.has(c.dataset.id)));
}

// ---------- 概览卡片 ----------
function sparkline(values, w = 176, h = 30) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const step = w / (values.length - 1);
  const xy = values.map((v, i) => [i * step, h - 4 - ((v - min) / span) * (h - 8)]);
  const line = xy.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  const [ex, ey] = xy[xy.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#58a6ff" stop-opacity=".35"/><stop offset="100%" stop-color="#58a6ff" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${area}" fill="url(#g)"/>
    <polyline points="${line}" fill="none" stroke="#58a6ff" stroke-width="1.5"/>
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.5" fill="#58a6ff"/>
  </svg>`;
}
function fmt(v, unit) { return v == null ? "—" : (unit === "%" ? v.toFixed(2) + "%" : v.toFixed(4)); }
function chgClass(v) { return v == null ? "" : (v >= 0 ? "up" : "down"); }
function chgText(v, unit) { if (v == null) return ""; const s = v >= 0 ? "▲" : "▼"; return `${s} ${Math.abs(v).toFixed(unit === "%" ? 2 : 4)}`; }
function rangebar(r) {
  if (r.min == null || r.max == null || r.current == null || r.max <= r.min) return "";
  const pos = Math.max(0, Math.min(100, (r.current - r.min) / (r.max - r.min) * 100));
  return `<div class="rangebar"><div class="dot" style="left:${pos.toFixed(1)}%"></div></div>
    <div class="rangebar-lbl"><span>${fmt(r.min, r.unit)}</span><span>区间位置 ${pos.toFixed(0)}%</span><span>${fmt(r.max, r.unit)}</span></div>`;
}

async function loadOverview() {
  const rows = await getLatestRows();
  for (const group of ["利率", "汇率"]) {
    const box = document.getElementById(`cards-${group}`);
    box.innerHTML = "";
    for (const r of rows.filter(x => x.group === group)) {
      const div = document.createElement("div");
      if (r.error) {
        div.className = "card err";
        div.innerHTML = `<div class="label">${r.label}</div><div class="value">—</div><div class="src">⚠ ${r.error}</div>`;
      } else {
        div.className = "card" + (selected.has(r.id) ? " on" : "");
        div.dataset.id = r.id;
        div.title = "点击加入/移出图表";
        const vCls = r.chg1m == null ? "" : (r.chg1m >= 0 ? "vup" : "vdown");
        div.innerHTML =
          `<div class="label">${r.label}</div>` +
          `<div class="value ${vCls}">${fmt(r.current, r.unit)}</div>` +
          `<div class="chg ${chgClass(r.chg1m)}">${chgText(r.chg1m, r.unit)} <span style="color:var(--muted)">1M</span></div>` +
          sparkline(r.spark) +
          rangebar(r) +
          `<div class="src">${r.source || ""} · ${r.asof || ""}${r.caveat ? " · " + r.caveat : ""}</div>`;
        div.addEventListener("click", () => toggleInstrument(r.id));
      }
      box.appendChild(div);
    }
  }
}

// ---------- chips 选择器 + 研判下拉 + 预设 ----------
function buildPickers() {
  const picker = $("#picker"); picker.innerHTML = "";
  for (const e of registry) {
    const chip = document.createElement("button");
    chip.className = "chip" + (selected.has(e.id) ? " on" : "");
    chip.dataset.id = e.id;
    chip.textContent = e.label;
    chip.addEventListener("click", () => toggleInstrument(e.id));
    picker.appendChild(chip);
  }
  const sel = $("#insight-id"); sel.innerHTML = "";
  for (const e of registry) sel.add(new Option(e.label, e.id));
  document.querySelectorAll("#presets button").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = PRESETS[btn.dataset.preset];
      if (p) setSelection(p.ids, p.normalize);
    });
  });
}

// ---------- 主图 ----------
async function drawChart() {
  if (!chart) chart = echarts.init(document.getElementById("chart"), "dark");
  const ids = [...selected];
  const series = await Promise.all(ids.map(id => getSeriesData(id, curRange)));
  const normalize = $("#normalize")?.checked;
  const single = series.filter(s => (s.points || []).length > 0).length === 1;
  chart.setOption({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", label: { backgroundColor: "#1b2330" } },
      backgroundColor: "rgba(22,27,34,.95)", borderColor: "#222a35", textStyle: { color: "#e6edf3", fontSize: 12 },
    },
    legend: { textStyle: { color: "#e6edf3" } },
    grid: { left: 52, right: 16, top: 36, bottom: 56 },
    xAxis: { type: "time" },
    yAxis: { type: "value", scale: true, name: normalize ? "指数 (基准=100)" : "", nameTextStyle: { color: "#8b949e" },
             splitLine: { lineStyle: { color: "#1b2330" } } },
    dataZoom: [{ type: "inside" }, { type: "slider" }],
    series: series.map(s => {
      const pts = s.points || [];
      const base = normalize && pts.length ? pts[0].value : null;
      return {
        name: s.meta?.label || s.id,
        type: "line", showSymbol: pts.length <= 2, smooth: false,
        areaStyle: single ? { opacity: .18 } : undefined,
        data: pts.map(p => [p.date, base ? +(p.value / base * 100).toFixed(2) : p.value]),
      };
    }),
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
  $("#normalize")?.addEventListener("change", drawChart);
  window.addEventListener("resize", () => chart && chart.resize());
}

// ---------- 刷新 ----------
function initRefresh() {
  $("#refresh-btn").addEventListener("click", async () => {
    if (MODE === "static") {
      const d = SNAP?.generatedAt ? new Date(SNAP.generatedAt).toLocaleString("zh-CN", { hour12: false }) : "?";
      $("#refresh-btn").textContent = `快照 ${d}`;
      setTimeout(() => { $("#refresh-btn").textContent = "⟳ 刷新"; }, 2500);
      return;
    }
    $("#refresh-btn").classList.add("spin");
    await loadOverview();
    await drawChart();
    $("#refresh-btn").classList.remove("spin");
  });
}

// ---------- 研判 ----------
function probBar(scenarios) {
  const get = (n) => scenarios.find(s => s.name === n) || { prob: 0 };
  const segs = [["上行", "s-up"], ["中性", "s-mid"], ["下行", "s-down"]].map(([n, cls]) => {
    const p = (get(n).prob * 100);
    return `<div class="seg ${cls}" style="width:${p.toFixed(1)}%">${p >= 12 ? n + " " + p.toFixed(0) + "%" : (p >= 7 ? p.toFixed(0) + "%" : "")}</div>`;
  }).join("");
  return `<div class="probbar">${segs}</div>`;
}
function scaleViz(ttl, mark, leftLbl, rightLbl, plain) {
  return `<div class="scale"><div class="ttl"><span>${ttl}</span></div>
    <div class="track${plain ? " plain" : ""}"><div class="mark" style="left:${mark.toFixed(1)}%"></div></div>
    <div class="ends"><span>${leftLbl}</span><span>${rightLbl}</span></div></div>`;
}
function renderInsight(ins) {
  const isQuantStatic = ins.engine === "quant" && ins._snapshotAt;
  const engineBadge = ins.engine === "claude+news"
    ? `<span class="badge ok">Claude + 实时新闻</span>`
    : ins.engine === "claude"
      ? `<span class="badge ok">Claude 叙述</span>`
      : isQuantStatic
        ? `<span class="badge ok">量化研判 · 每日快照</span>`
        : `<span class="badge warn">纯量化兜底</span>`;
  const g = ins.signals || {};
  let scales = "";
  if (g.trend) {
    const zPos = Math.max(0, Math.min(100, ((Math.max(-3, Math.min(3, g.zScore)) + 3) / 6) * 100));
    const rPos = Math.max(0, Math.min(100, (g.rangePos ?? .5) * 100));
    scales = `<div class="scales">
      ${scaleViz(`z 分数 ${g.zScore}（偏离60日均值）`, zPos, "-3σ 低", "+3σ 高", false)}
      ${scaleViz(`52周区间位置 ${rPos.toFixed(0)}%`, rPos, "一年低点", "一年高点", true)}
    </div>
    <div class="meta-row">趋势 <b>${g.trend}</b> · 近端动量 ${g.shortMom} · 日波动 ${g.vol}</div>`;
  }
  const order = { "上行": 0, "中性": 1, "下行": 2 };
  const horizons = ins.horizons.map((h, i) => {
    const scns = [...h.scenarios].sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9));
    const rows = scns.map(s => `
      <div class="scn">
        <div><div class="name">${s.name}</div><div class="prob">${(s.prob * 100).toFixed(0)}%</div></div>
        <div>
          <div>驱动：${(s.drivers || []).join("；")}</div>
          <div class="imp">信贷/宏观启示：${s.credit_macro_implication || ""}</div>
        </div>
      </div>`).join("");
    return `<details class="horizon"${i === 0 ? " open" : ""}>
      <summary><span class="h-name">${h.horizon}</span>${probBar(scns)}<span class="caret">▶</span></summary>
      <div class="h-body">${rows}</div>
    </details>`;
  }).join("");
  const sourcesBlock = Array.isArray(ins.sources) && ins.sources.length
    ? `<div class="horizon-static"><h3>引用新闻来源</h3>${ins.sources.map(s =>
        `<div class="imp">· <a href="${s.url}" target="_blank" rel="noopener">${s.title || s.url}</a></div>`).join("")}</div>`
    : "";
  return `
    <div class="meta-row">${engineBadge} 标的 ${ins.label || ins.instrument} · 截至 ${ins.asof} · 当前 ${ins.current_level}${ins.engine_note ? " · " + ins.engine_note : ""}</div>
    <div class="meta-row">${ins.recent_move_summary || ""}</div>
    ${scales}
    ${horizons}
    <div class="horizon-static"><h3>关键风险 / 关注项</h3>
      <div>风险：${(ins.key_risks || []).join("；")}</div>
      <div class="imp">关注：${(ins.watch_items || []).join("；")}</div>
    </div>
    ${sourcesBlock}
    <div class="meta-row">⚠ 概率由量化信号确定；${ins.engine && ins.engine.startsWith("claude") ? "叙述由 Claude 生成" : "叙述为量化模板"}，非投资建议。</div>`;
}

function initInsight() {
  if (MODE === "static") {
    const news = $("#insight-news"); if (news) news.closest("label").style.display = "none";
    $("#insight-run").textContent = "查看研判";
  }
  $("#insight-run").addEventListener("click", async () => {
    const id = $("#insight-id").value;
    const news = $("#insight-news")?.checked ? 1 : 0;
    const status = $("#insight-status"), out = $("#insight-output");
    status.innerHTML = MODE === "static" ? "" : `<span class="spinner"></span>` + (news
      ? "Claude 检索实时新闻 + 深度叙述，约 1–3 分钟…"
      : "量化 + Claude 叙述约 40–90s…");
    out.innerHTML = "";
    try {
      const data = await getInsight(id, news);
      if (data.error) { status.textContent = "⚠ " + data.error; return; }
      status.textContent = "";
      out.innerHTML = renderInsight(data);
    } catch (e) {
      status.textContent = "⚠ 请求失败：" + e.message;
    }
  });
}

// ---------- 启动 ----------
async function main() {
  await detectMode();
  await loadOverview();
  buildPickers();
  initRanges();
  initRefresh();
  await drawChart();
  initInsight();
}
main();
