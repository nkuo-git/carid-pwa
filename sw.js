// 大便龍的萬能軟體 — Service Worker
// 只快取 App 本身（殼），辨識一定要連網，API 的請求永遠不進快取。

const CACHE = "carid-v23";

/* 跟 index.html 裡 styles.css / app.js 後面的 ?v= 一樣。
   換版就換網址，任何一層快取（瀏覽器、CDN、這裡）都不可能給到舊檔。 */
const V = "23";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=" + V,
  "./app.js?v=" + V,
  "./mc.html",
  "./mc.css?v=" + V,
  "./mc.js?v=" + V,
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

  // 車訊：一定先連網拿最新的，沒網路才用上次抓到的
  if (url.origin === self.location.origin && url.pathname.includes("/news/")) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((r) => r || Response.error()))
    );
    return;
  }

  // 導覽請求：先連網，失敗才用快取的殼（離線時至少開得起來）
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          const copy = res.clone();
          const key = url.pathname.endsWith("/mc.html") ? "./mc.html" : "./index.html";
          caches.open(CACHE).then((c) => c.put(key, copy));
          return res;
        })
        .catch(() => caches.match(url.pathname.endsWith("/mc.html") ? "./mc.html" : "./index.html")
          .then((r) => r || Response.error()))
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
