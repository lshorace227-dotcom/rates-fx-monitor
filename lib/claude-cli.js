// lib/claude-cli.js
// 用本地 claude CLI 无头调用（claude -p --output-format json）生成研判叙述。
// 走用户的 Claude Code 订阅授权，无需 API key。失败/超时 → 退回纯量化基线。
// news=true 时放开内置 WebSearch/WebFetch，让 Claude 先检索近期新闻再写研判（更慢、用量更高）。
import { execFile } from "node:child_process";
import { buildNarrativePrompt, extractJson, mergeNarrative } from "./narrative.js";

// 纯叙述模式：最小 system-prompt 替换 CC 默认 + strict-mcp 关掉 MCP → 干净单轮、无工具、快。
const SYSTEM_PLAIN = "你是资深宏观利率与汇率分析师，只输出符合用户要求的 JSON，不使用任何工具、不调用任何函数。";
// 新闻模式：允许联网检索，但仍要求最终只输出 JSON。
const SYSTEM_NEWS = "你是资深宏观利率与汇率分析师。可使用 WebSearch/WebFetch 检索近期新闻，检索完成后最终只输出符合用户要求的 JSON。";

function runClaude(prompt, { bin, model, timeoutMs, news }) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "json", "--strict-mcp-config"];
    if (news) {
      args.push("--system-prompt", SYSTEM_NEWS, "--allowedTools", "WebSearch", "WebFetch");
    } else {
      args.push("--system-prompt", SYSTEM_PLAIN);
    }
    if (model) args.push("--model", model);
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.killed ? `claude 超时` : `claude CLI: ${err.message}`));
      resolve(stdout);
    });
  });
}

export async function enrichWithClaude(base, { bin = "claude", model = "sonnet", timeoutMs, news = false } = {}) {
  const tmo = timeoutMs || (news ? 300000 : 150000);
  try {
    const stdout = await runClaude(buildNarrativePrompt(base, { news }), { bin, model, timeoutMs: tmo, news });
    const env = JSON.parse(stdout);            // claude --output-format json 的外层信封
    if (env.is_error) throw new Error(String(env.result || "claude error"));
    const narrative = extractJson(env.result); // 内层是模型写的 JSON（可能带 ``` 围栏）
    if (!narrative) throw new Error("无法解析 Claude 输出 JSON");
    const out = mergeNarrative(base, narrative, news ? "claude+news" : "claude");
    return out;
  } catch (e) {
    return { ...base, engine: "quant", engine_note: `Claude 不可用，已用量化兜底（${e.message}）` };
  }
}
