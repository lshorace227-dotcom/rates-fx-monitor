// lib/update-data.js
// 一键更新脚本的纯逻辑（可测）：解析用户输入 + 把新值并入序列（按日期去重、保持升序）。

// 解析一行输入：空 → {skip}；合法正数(0~100，利率口径) → {value}；否则 {error}
export function parseValue(input) {
  const t = String(input ?? "").trim();
  if (t === "") return { skip: true };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return { error: `无效输入「${t}」（应为 0~100 的数）` };
  return { value: n };
}

// 把 {date: today, value} 并入序列：同日则替换，否则追加；返回升序新数组（不改入参）。
export function applyUpdate(series, value, today) {
  const arr = Array.isArray(series) ? series.map(p => ({ ...p })) : [];
  const idx = arr.findIndex(p => p.date === today);
  if (idx >= 0) arr[idx] = { date: today, value };
  else arr.push({ date: today, value });
  arr.sort((a, b) => (a.date < b.date ? -1 : 1));
  return arr;
}
