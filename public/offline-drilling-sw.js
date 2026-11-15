const CACHE = "gf-offline-drilling-v5";
const SHELL = [
  "/offline-drilling.html", "/offline-drilling.css", "/offline-drilling.js", "/drilling-shift-log.mjs", "/offline-drilling-shift-ui.mjs",
  "/offline-drilling.webmanifest", "/offline-drilling-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key.startsWith("gf-offline-drilling-") && key !== CACHE).map((key) => caches.delete(key)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => await cache.match(url.pathname) || fetch(event.request)));
});
