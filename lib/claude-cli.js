// lib/claude-cli.js
// 用本地 claude CLI 无头调用（claude -p --output-format json）生成研判叙述。
// 走用户的 Claude Code 订阅授权，无需 API key。失败/超时 → 退回纯量化基线。
// 新闻由服务端预先抓好（lib/news.js）以 articles 传入，写进 prompt；这里始终走「干净单轮、无工具」路径
//（实测无头 claude 的 WebSearch 不真执行且会编造，故不让它自己搜）。
import { execFile } from "node:child_process";
import { buildNarrativePrompt, extractJson, mergeNarrative } from "./narrative.js";

const SYSTEM = "你是资深宏观利率与汇率分析师，只输出符合用户要求的 JSON，不使用任何工具、不调用任何函数。";

function runClaude(prompt, { bin, model, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "json", "--strict-mcp-config", "--system-prompt", SYSTEM];
    if (model) args.push("--model", model);
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.killed ? `claude 超时` : `claude CLI: ${err.message}`));
      resolve(stdout);
    });
  });
}

export async function enrichWithClaude(base, { bin = "claude", model = "sonnet", timeoutMs = 150000, articles = null } = {}) {
  const hasNews = Array.isArray(articles) && articles.length;
  try {
    const stdout = await runClaude(buildNarrativePrompt(base, { articles }), { bin, model, timeoutMs });
    const env = JSON.parse(stdout);            // claude --output-format json 的外层信封
    if (env.is_error) throw new Error(String(env.result || "claude error"));
    const narrative = extractJson(env.result); // 内层是模型写的 JSON（可能带 ``` 围栏）
    if (!narrative) throw new Error("无法解析 Claude 输出 JSON");
    const out = mergeNarrative(base, narrative, hasNews ? "claude+news" : "claude");
    if (hasNews) out.sources = articles;       // 来源用 RSS 真链接（非模型编造）
    return out;
  } catch (e) {
    const fb = { ...base, engine: "quant", engine_note: `Claude 不可用，已用量化兜底（${e.message}）` };
    if (hasNews) fb.sources = articles;        // 仍展示已抓到的真实新闻
    return fb;
  }
}
