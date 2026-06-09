// lib/cache.js
// 极简 TTL 内存缓存。now 作为参数注入便于测试；生产调用传 Date.now()。
export function createCache() {
  const store = new Map(); // key -> { value, expiresAt }
  return {
    get(key, now = Date.now()) {
      const e = store.get(key);
      if (!e) return undefined;
      if (now >= e.expiresAt) { store.delete(key); return undefined; }
      return e.value;
    },
    set(key, value, ttlMs, now = Date.now()) {
      store.set(key, { value, expiresAt: now + ttlMs });
    },
  };
}
