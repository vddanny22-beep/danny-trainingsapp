const CACHE_NAME = "trainingsapp-v10";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/storage.js",
  "./js/progression.js",
  "./js/seed.js",
  "./js/schema-editor.js",
  "./js/today-view.js",
  "./js/history-view.js",
  "./js/sheet-sync.js",
  "./js/sparkline.js",
  "./js/progress-view.js",
  "./js/ai-chat.js",
  "./js/chat-view.js",
  "./js/rest-timer.js",
  "./js/backup.js",
  "./js/volume-stats.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  // { cache: "reload" } bypasses the browser's HTTP cache so precaching always
  // picks up the current files on disk, not a stale cached copy from an
  // earlier visit — otherwise an app update can silently ship with old code.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((url) => fetch(url, { cache: "reload" }).then((resp) => cache.put(url, resp))))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Only cache successful same-origin GET requests.
        if (event.request.method === "GET" && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match("./index.html"))
  );
});
