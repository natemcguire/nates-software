// Nate's Software Service Worker v2
// Fix: v1 was cache-first for everything, so it served a STALE precached
// /index.html across deploys — pointing at old hashed asset filenames that
// 404 and fall back to HTML, breaking MIME. v2 is network-first for the HTML
// shell and navigations (always pick up fresh asset hashes) and only
// cache-first for content-hashed /assets/* (which are immutable).
const CACHE_NAME = 'nates-software-v2';
const CORE_ASSETS = [
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isNavigation(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API: network-first, no stale serving.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // HTML shell / navigations: NETWORK-FIRST so new deploys' asset hashes load.
  // Never serve a stale precached index.html. Fall back to cache only offline.
  if (isNavigation(request)) {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html') || caches.match('/'))
    );
    return;
  }

  // Content-hashed /assets/* are immutable → cache-first is safe and fast.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
    return;
  }

  // Everything else: network-first, cache fallback.
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
