// update-data.mjs — 一键更新本地手动维护的利率序列（LPR / Shibor / HIBOR 3M·12M）。
// 这些标的没有稳定的免费实时源，故引导手输：显示官方来源 + 当前值，回车跳过、输入即更新（自动补当天日期、按日去重）。
// 用法：node update-data.mjs   （或双击 update.command）
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { parseValue, applyUpdate } from "./lib/update-data.js";

const DATA = fileURLToPath(new URL("./data/", import.meta.url));
const today = new Date().toISOString().slice(0, 10);

const TARGETS = [
  { file: "lpr.json",    key: "LPR_1Y",    label: "LPR 1年期",     src: "www.chinamoney.com.cn / pbc.gov.cn（每月20日 9:15）" },
  { file: "lpr.json",    key: "LPR_5Y",    label: "LPR 5年期以上",  src: "同上" },
  { file: "shibor.json", key: "SHIBOR_ON", label: "Shibor 隔夜",    src: "www.shibor.org（每交易日 11:00）" },
  { file: "shibor.json", key: "SHIBOR_3M", label: "Shibor 3个月",   src: "www.shibor.org" },
  { file: "hibor.json",  key: "HIBOR_3M",  label: "HIBOR 3个月",    src: "www.hkab.org.hk/en/rates/hibor（每交易日 ~11:15）" },
  { file: "hibor.json",  key: "HIBOR_12M", label: "HIBOR 12个月",   src: "www.hkab.org.hk/en/rates/hibor" },
];

const docs = {};
const loadDoc = (file) => (docs[file] ??= JSON.parse(readFileSync(DATA + file, "utf8")));
const changedFiles = new Set();

const rl = createInterface({ input: stdin, output: stdout });
// 用异步迭代器逐行取，对交互输入与管道/EOF 都稳健（EOF 后剩余项按跳过处理）。
const lines = rl[Symbol.asyncIterator]();
async function ask(prompt) {
  stdout.write(prompt);
  const { value, done } = await lines.next();
  return done ? "" : value;
}

console.log(`\n📊 一键更新本地利率数据（新值日期自动记为 ${today}）`);
console.log(`   直接回车 = 跳过该项；输入数字（如 3.05）= 更新。\n`);

let changed = 0;
for (const t of TARGETS) {
  const d = loadDoc(t.file);
  const series = d.series?.[t.key] ?? [];
  const last = series.length ? series[series.length - 1] : null;
  const cur = last ? `${last.value}（${last.date}）` : "（无）";
  console.log(`• ${t.label}   来源: ${t.src}`);
  const ans = await ask(`  当前 ${cur} → 新值: `);
  const r = parseValue(ans);
  if (r.skip) { console.log("  ↳ 跳过\n"); continue; }
  if (r.error) { console.log(`  ↳ ${r.error}，跳过\n`); continue; }
  d.series[t.key] = applyUpdate(series, r.value, today);
  changedFiles.add(t.file);
  changed++;
  console.log(`  ↳ 已更新为 ${r.value}\n`);
}
rl.close();

if (changed) {
  for (const file of changedFiles) writeFileSync(DATA + file, JSON.stringify(docs[file], null, 2) + "\n");
  console.log(`✅ 写入完成，共更新 ${changed} 项。若 server 正在运行，重启 node server.js 后生效。`);
} else {
  console.log("（未更新任何项）");
}
