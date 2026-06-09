// lib/env.js
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

export function loadEnv() {
  const path = fileURLToPath(new URL("../.env", import.meta.url));
  const fromFile = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  return { ...fromFile, ...process.env }; // 进程环境变量优先
}
