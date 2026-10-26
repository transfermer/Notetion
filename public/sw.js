// Service Worker for Notetion PWA
// Cache-first for static assets, network-first for API calls.

const CACHE_NAME = 'notetion-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.json',
];

// Install: cache static assets.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

// Activate: clear old caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// Fetch: cache-first for static, network-first for API.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Static assets (same-origin, no /api/ prefix).
  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // API calls: network-first, fallback to cache if offline.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }
});

// Background sync for offline writes (future M3 enhancement).
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-writes') {
    event.waitUntil(syncPendingWrites());
  }
});

async function syncPendingWrites() {
  // Placeholder: will be implemented with IndexedDB queue in M3.
  console.log('[SW] Background sync triggered');
}
