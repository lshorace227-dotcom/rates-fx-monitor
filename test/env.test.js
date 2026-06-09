// test/env.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "../lib/env.js";

test("parseEnv reads KEY=VALUE, ignores comments/blank", () => {
  const env = parseEnv("# c\nFRED_API_KEY=abc\n\nPORT=9000\n");
  assert.equal(env.FRED_API_KEY, "abc");
  assert.equal(env.PORT, "9000");
});

test("parseEnv keeps '=' inside values", () => {
  const env = parseEnv("K=a=b=c\n");
  assert.equal(env.K, "a=b=c");
});
