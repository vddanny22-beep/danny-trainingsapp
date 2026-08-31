// IMPORTANT: bump this on every deploy that changes any cached file's
// content, even when APP_SHELL's file list is unchanged. The browser only
// checks for a service worker update by byte-comparing this script against
// the one it already has — it never looks at whether the files this script
// lists have changed. Editing progress-view.js without bumping this leaves
// this file byte-identical, so no update is ever detected and every
// installed client keeps serving the stale cached copy forever, no matter
// how many times they close and reopen the app.
const CACHE_NAME = "trainingsapp-v14";
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
  "./js/app-update.js",
  "./js/workout-draft.js",
  "./js/decimal-input.js",
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
  // Deliberately no skipWaiting() here: a silent takeover leaves open pages
  // running the previous version's JS with no sign anything changed. The new
  // worker waits until the page offers the user a reload (see js/app-update.js)
  // and posts the message below.
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
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
