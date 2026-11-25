/**
 * TaiChiFlow / FitLog Service Worker v1.2
 *
 * 版本规范：
 *   - 小改动：1.1 → 1.2 → 1.3
 *   - 大改版：2.1 → 2.2
 *
 * 升级说明：
 *   APP_VERSION 变化时缓存名随之变化，activate 阶段会自动清理旧版本缓存。
 */
const APP_VERSION = "1.2";
const USEFUL_CACHE_NAME = `taichiflow-useful-v${APP_VERSION}`;
const USELESS_CACHE_NAME = `taichiflow-useless-v${APP_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
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
          return undefined;
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isCoreAsset = CORE_ASSETS.some(
    (asset) => url.pathname.endsWith(asset.replace("./", "")) || url.pathname.endsWith("/")
  );

  if (isCoreAsset) {
    // App Shell：缓存优先，保证离线可用
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // 非核心同源请求归入“无用缓存桶”，便于用户在设置页按需清理
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
});
