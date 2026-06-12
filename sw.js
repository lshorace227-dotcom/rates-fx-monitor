// sw.js — PWA Service Worker
// 策略：导航/HTML 与 snapshot.json = 网络优先（保更新，离线回退缓存）；
//       静态资源（js/css/图标/CDN echarts）= stale-while-revalidate；
//       /api/* = 永不缓存（live 模式实时数据直通网络）。
const VERSION = "v1";
const CACHE = `rfm-${VERSION}`;

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putCache(req, res) {
  const copy = res.clone();
  caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.includes("/api/")) return; // 实时数据不缓存

  const networkFirst = req.mode === "navigate" || url.pathname.endsWith("snapshot.json");
  if (networkFirst) {
    e.respondWith(
      fetch(req).then(r => putCache(req, r)).catch(() => caches.match(req))
    );
  } else {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(r => putCache(req, r)).catch(() => hit);
        return hit || net;
      })
    );
  }
});
