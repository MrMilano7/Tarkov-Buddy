/**
 * sw.js — Tarkov Companion service worker.
 *
 * Strategy: NETWORK-FIRST for everything, cache as a fallback.
 * Online you always get the live files (no stale-cache traps — we learned
 * that lesson the hard way in v0.3); offline you get the last good copy of
 * the entire app and data. The cache name embeds the version: deploying a
 * new version drops all old caches on activate.
 */
const VERSION = "0.9.9";
const CACHE = `tarkov-companion-${VERSION}`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch (err) {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      // offline navigation to a page we never cached: fall back to the shell
      if (request.mode === "navigate") {
        const shell = await cache.match("index.html") || await cache.match("./");
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
