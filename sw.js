// 大便龍的辨車軟體 — Service Worker
// 只快取 App 本身（殼），辨識一定要連網，API 的請求永遠不進快取。

const CACHE = "carid-v8";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 單一檔案失敗不讓整個安裝失敗；cache: "reload" 是為了繞過瀏覽器自己的 HTTP 快取，
      // 不然抓回來的可能還是舊檔，換版就沒意義了
      .then((cache) => Promise.allSettled(
        SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })))
      ))
    // 這裡不 skipWaiting：新版先在旁邊待命，等畫面上的「更新」被按了才接手
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Gemini API：一律走網路，不碰快取
  if (url.hostname.endsWith("googleapis.com")) return;

  // 導覽請求：先連網，失敗才用快取的殼（離線時至少開得起來）
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || Response.error()))
    );
    return;
  }

  // 其他（CSS / JS / 圖示 / 字型 / CDN 上的 SDK）：先用快取，同時在背景更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
