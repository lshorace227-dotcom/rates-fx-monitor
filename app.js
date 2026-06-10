// app.js — 双模式：
//   live   = 本地 node server.js 在跑，走 /api/*（完整 Claude + 新闻研判、实时数据）
//   static = 部署在 GitHub Pages，无服务器，回退读 snapshot.json（每日快照数据 + 量化研判）
const $ = (sel) => document.querySelector(sel);

let chart, selected = new Set(["SOFR", "HIBOR_3M"]), curRange = "1Y", registry = [];
let MODE = "live", SNAP = null;
const byId = {};

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
  } catch {
    MODE = "static";
    SNAP = await fetch("snapshot.json", { cache: "no-store" }).then(r => r.json());
    SNAP.instruments.forEach(it => { byId[it.id] = it; });
    registry = SNAP.instruments.map(({ id, label, group, unit, freq, caveat }) => ({ id, label, group, unit, freq, caveat }));
    const d = SNAP.generatedAt ? new Date(SNAP.generatedAt) : null;
    if (d) $(".disclaimer").textContent =
      `数据为每日快照（更新于 ${d.toLocaleString("zh-CN", { hour12: false })}）；研判为量化信号（确定性）。完整 Claude+实时新闻研判见本地版。`;
  }
}

// ---------- 数据访问（按模式分流）----------
async function getLatestRows() {
  if (MODE === "live") return fetch("/api/latest").then(r => r.json());
  return SNAP.instruments.map(it => it.error
    ? { id: it.id, label: it.label, group: it.group, unit: it.unit, error: it.error }
    : { id: it.id, label: it.label, group: it.group, unit: it.unit, caveat: it.caveat,
        source: it.source, current: it.current, asof: it.asof, chg1m: it.chg1m, spark: it.spark });
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

// ---------- 概览卡片 ----------
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
  const rows = await getLatestRows();
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

// ---------- 选择器 + 研判下拉 ----------
function buildPickers() {
  const picker = $("#picker"); picker.innerHTML = "";
  for (const e of registry) {
    const wrap = document.createElement("label");
    wrap.innerHTML = `<input type="checkbox" value="${e.id}" ${selected.has(e.id) ? "checked" : ""}/> ${e.label}`;
    wrap.querySelector("input").addEventListener("change", (ev) => {
      ev.target.checked ? selected.add(e.id) : selected.delete(e.id);
      drawChart();
    });
    picker.appendChild(wrap);
  }
  const sel = $("#insight-id"); sel.innerHTML = "";
  for (const e of registry) sel.add(new Option(e.label, e.id));
}

// ---------- 主图 ----------
async function drawChart() {
  if (!chart) chart = echarts.init(document.getElementById("chart"), "dark");
  const ids = [...selected];
  const series = await Promise.all(ids.map(id => getSeriesData(id, curRange)));
  const normalize = $("#normalize")?.checked;
  chart.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: "#e6edf3" } },
    grid: { left: 52, right: 16, top: 32, bottom: 56 },
    xAxis: { type: "time" },
    yAxis: { type: "value", scale: true, name: normalize ? "指数 (基准=100)" : "", nameTextStyle: { color: "#8b949e" } },
    dataZoom: [{ type: "inside" }, { type: "slider" }],
    series: series.map(s => {
      const pts = s.points || [];
      const base = normalize && pts.length ? pts[0].value : null;
      return {
        name: s.meta?.label || s.id,
        type: "line", showSymbol: pts.length <= 2, smooth: false,
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

// ---------- 研判 ----------
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
  const signalRow = g.trend
    ? `<div class="meta-row">量化信号：趋势 <b>${g.trend}</b> · z=${g.zScore} · 近端动量 ${g.shortMom} · 日波动 ${g.vol} · 区间位置 ${Math.round((g.rangePos ?? 0.5) * 100)}%</div>`
    : "";
  const order = { "上行": 0, "中性": 1, "下行": 2 };
  const horizons = ins.horizons.map(h => {
    const scns = [...h.scenarios].sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9));
    const rows = scns.map(s => `
      <div class="scn">
        <div><div class="name">${s.name}</div><div class="prob">${(s.prob * 100).toFixed(0)}%</div></div>
        <div>
          <div class="bar" style="width:${(s.prob * 100).toFixed(0)}%"></div>
          <div>驱动：${(s.drivers || []).join("；")}</div>
          <div class="imp">信贷/宏观启示：${s.credit_macro_implication || ""}</div>
        </div>
      </div>`).join("");
    return `<div class="horizon"><h3>${h.horizon}</h3>${rows}</div>`;
  }).join("");
  const sourcesBlock = Array.isArray(ins.sources) && ins.sources.length
    ? `<div class="horizon"><h3>引用新闻来源</h3>${ins.sources.map(s =>
        `<div class="imp">· <a href="${s.url}" target="_blank" rel="noopener">${s.title || s.url}</a></div>`).join("")}</div>`
    : "";
  return `
    <div class="meta-row">${engineBadge} 标的 ${ins.label || ins.instrument} · 截至 ${ins.asof} · 当前 ${ins.current_level}${ins.engine_note ? " · " + ins.engine_note : ""}</div>
    <div class="meta-row">${ins.recent_move_summary || ""}</div>
    ${signalRow}
    ${horizons}
    <div class="horizon"><h3>关键风险 / 关注项</h3>
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
    status.textContent = MODE === "static" ? "" : (news
      ? "生成中…（Claude 检索实时新闻 + 深度叙述，约 1–3 分钟；claude 不可用则退回纯量化）"
      : "生成中…（量化 + Claude 叙述约 40–90s；claude 不可用则退回纯量化）");
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
  await drawChart();
  initInsight();
}
main();
