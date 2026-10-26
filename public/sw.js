// Service Worker for Notetion (PWA shell only).
//
// SECURITY MODEL — read before changing:
//  * This worker NEVER caches anything dynamic or private. /api/*, /oauth/*,
//    /mcp/*, /s/*, /sync/* and every non-GET request are left completely
//    untouched (the browser handles them as if no service worker existed).
//    The previous version cached /api/* responses (notes, /auth/me) in
//    CacheStorage, where they survived logout and leaked to the next person
//    using the device.
//  * Only the static app shell is cached:
//      - hashed build files under /assets/  → cache-first (content-addressed, immutable)
//      - page navigations                   → network-first, cached copy only as offline fallback
//      - other same-origin static files     → network-first with cache fallback
//  * Because navigations are network-first, a new deploy is picked up on the
//    next load instead of being masked by a stale cached index.html.
//  * The page can ask for a full wipe with postMessage({type:'CLEAR_CACHES'});
//    it does so on logout.
//
// Bump VERSION to force-drop every cache created by earlier versions.

const VERSION = "v2";
const CACHE = `notetion-shell-${VERSION}`;
const SHELL_URL = "/";

const PRIVATE_PREFIXES = ["/api/", "/oauth/", "/mcp/", "/s/", "/sync/", "/.well-known/"];

function isPrivatePath(pathname) {
  return PRIVATE_PREFIXES.some((p) => pathname.startsWith(p));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Best effort: one missing file must not abort installation.
      await Promise.allSettled(
        [SHELL_URL, "/favicon.svg", "/manifest.json"].map((u) => cache.add(u)),
      );
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Deletes EVERY other cache, including the legacy 'notetion-v1' that held /api responses.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

function cacheable(response) {
  // Only plain same-origin 200s; never redirects, opaque or error responses.
  return response && response.ok && response.type === "basic";
}

async function networkFirst(request, cacheKey) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      const copy = response.clone();
      caches.open(CACHE).then((c) => c.put(cacheKey, copy)).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isPrivatePath(url.pathname)) return;

  if (request.mode === "navigate") {
    // Every SPA route shares one shell document.
    event.respondWith(networkFirst(request, SHELL_URL));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request, request));
});
