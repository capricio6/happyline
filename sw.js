const CACHE_NAME = "book-stock-pwa-v2.0.4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  // 설치 시에도 캐시를 거치지 않고 최신 파일을 받아 캐시에 저장
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(
      APP_SHELL.map((url) =>
        fetch(url, { cache: "no-store" })
          .then((response) => cache.put(url, response))
          .catch(() => undefined)
      )
    )),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // CDN 등 다른 출처 요청은 서비스 워커가 개입하지 않음 (ZXing/html5-qrcode 등)
  if (url.origin !== self.location.origin) return;

  // 항상 네트워크 최신 우선 + no-store → 옛날 캐시가 화면에 남지 않음
  // 네트워크 실패(오프라인) 시에만 캐시 fallback
  event.respondWith(
    fetch(event.request.url, { cache: "no-store" })
      .then((response) => {
        // merged-stock.csv는 캐시하지 않고 항상 최신만 사용
        if (!url.pathname.endsWith("/merged-stock.csv")) {
          const copy = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(event.request, copy))
            .catch(() => undefined);
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
      ),
  );
});
