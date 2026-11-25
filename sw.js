/**
 * TaiChiFlow Service Worker
 * 版本规范：1.1, 1.2 小版本迭代；2.1, 2.2 大版本迭代
 */
const APP_VERSION = "1.1";
const USEFUL_CACHE_NAME = `taichiflow-useful-v${APP_VERSION}`;
const USELESS_CACHE_NAME = `taichiflow-useless-v${APP_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(USEFUL_CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== USEFUL_CACHE_NAME && key !== USELESS_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isCoreAsset = CORE_ASSETS.some(
    (asset) => url.pathname.endsWith(asset.replace("./", "")) || url.pathname.endsWith("/")
  );

  if (isCoreAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  } else {
    // 非核心动态请求归入无用/临时缓存桶，便于用户在设置页按需一键清理
    event.respondWith(
      fetch(event.request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(USELESS_CACHE_NAME).then((cache) => {
              cache.put(event.request, resClone);
            });
          }
          return networkRes;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
