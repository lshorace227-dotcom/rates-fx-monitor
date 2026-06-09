// app.js
const $ = (sel) => document.querySelector(sel);

let chart, selected = new Set(["SOFR", "HIBOR_3M"]), curRange = "1Y", registry = [];

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

// ---------- 选择器 + 研判下拉 ----------
async function loadRegistry() {
  registry = await fetch("/api/registry").then(r => r.json());
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
  const series = await Promise.all(ids.map(id =>
    fetch(`/api/series?id=${id}&range=${curRange}`).then(r => r.json())));
  chart.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: "#e6edf3" } },
    grid: { left: 52, right: 16, top: 32, bottom: 56 },
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

// ---------- AI 研判 ----------
function renderInsight(ins) {
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
  const engineBadge = ins.engine === "claude"
    ? `<span class="badge ok">Claude 叙述</span>`
    : `<span class="badge warn">纯量化兜底</span>`;
  const g = ins.signals || {};
  const signalRow = g.trend
    ? `<div class="meta-row">量化信号：趋势 <b>${g.trend}</b> · z=${g.zScore} · 近端动量 ${g.shortMom} · 日波动 ${g.vol} · 区间位置 ${Math.round((g.rangePos ?? 0.5) * 100)}%</div>`
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
    <div class="meta-row">⚠ 概率由量化信号确定；叙述由 Claude 生成，非投资建议。</div>`;
}

function initInsight() {
  $("#insight-run").addEventListener("click", async () => {
    const id = $("#insight-id").value;
    const status = $("#insight-status"), out = $("#insight-output");
    status.textContent = "生成中…（量化即时 + Claude sonnet 深度叙述约 40–90s；claude 不可用则退回纯量化）"; out.innerHTML = "";
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

// ---------- 启动 ----------
async function main() {
  await loadOverview();
  await loadRegistry();
  initRanges();
  await drawChart();
  initInsight();
}
main();
