// test/cache.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCache } from "../lib/cache.js";

test("set then get returns value before TTL", () => {
  const c = createCache();
  c.set("k", 42, 1000, 1_000_000);          // ttlMs=1000, now=1_000_000
  assert.equal(c.get("k", 1_000_500), 42);   // 0.5s 后仍在
});

test("get returns undefined after TTL", () => {
  const c = createCache();
  c.set("k", 42, 1000, 1_000_000);
  assert.equal(c.get("k", 1_002_000), undefined); // 2s 后过期
});

test("get returns undefined for missing key", () => {
  const c = createCache();
  assert.equal(c.get("nope", 1_000_000), undefined);
});
