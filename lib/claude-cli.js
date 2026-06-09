// lib/claude-cli.js
// 用本地 claude CLI 无头调用（claude -p --output-format json）生成研判叙述。
// 走用户的 Claude Code 订阅授权，无需 API key。失败/超时 → 退回纯量化基线。
import { execFile } from "node:child_process";
import { buildNarrativePrompt, extractJson, mergeNarrative } from "./narrative.js";

// 用最小 system-prompt 替换 CC 默认 + strict-mcp 关掉 MCP，逼成「干净单轮 LLM 调用」（无工具、不 agentic）。
const SYSTEM = "你是资深宏观利率与汇率分析师，只输出符合用户要求的 JSON，不使用任何工具、不调用任何函数。";

function runClaude(prompt, { bin, model, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "json", "--strict-mcp-config", "--system-prompt", SYSTEM];
    if (model) args.push("--model", model);
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.killed ? `claude 超时` : `claude CLI: ${err.message}`));
      resolve(stdout);
    });
  });
}

export async function enrichWithClaude(base, { bin = "claude", model = "sonnet", timeoutMs = 150000 } = {}) {
  try {
    const stdout = await runClaude(buildNarrativePrompt(base), { bin, model, timeoutMs });
    const env = JSON.parse(stdout);            // claude --output-format json 的外层信封
    if (env.is_error) throw new Error(String(env.result || "claude error"));
    const narrative = extractJson(env.result); // 内层是模型写的 JSON（可能带 ``` 围栏）
    if (!narrative) throw new Error("无法解析 Claude 输出 JSON");
    return mergeNarrative(base, narrative, "claude");
  } catch (e) {
    return { ...base, engine: "quant", engine_note: `Claude 不可用，已用量化兜底（${e.message}）` };
  }
}
