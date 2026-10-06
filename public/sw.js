/* Cadenza service worker — plain JS, no dependencies.
   Registration path is /sw.js (see src/components/pwa-register.tsx).

   Strategy:
   - App shell (HTML navigations + same-origin JS/CSS): stale-while-revalidate.
     Launches are instant, updates still arrive. HTML is NEVER cache-first.
   - /_next/static/* (immutable hashed assets): cache-first, long-lived.
   - Icons / manifest / raster images: cache-first in a bounded cache.
   - Everything else same-origin GET: stale-while-revalidate.
   - NEVER cached: non-GET, /api/*, or cross-origin traffic (incl. Supabase).
*/

const VERSION = 'cadenza-v2';
const STATIC_CACHE = `cadenza-static-${VERSION}`;
const RUNTIME_CACHE = `cadenza-runtime-${VERSION}`;
const IMAGE_CACHE = `cadenza-images-${VERSION}`;
const ALLOWED_CACHES = [STATIC_CACHE, RUNTIME_CACHE, IMAGE_CACHE];

const PRECACHE = ['/', '/manifest.json'];
const MAX_IMAGE_ENTRIES = 40;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key.startsWith('cadenza-') && !ALLOWED_CACHES.includes(key)) {
              return caches.delete(key);
            }
            return undefined;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

function isCacheableResponse(response) {
  return !!response && response.ok && (response.type === 'basic' || response.type === 'default');
}

function trimCache(cacheName, maxEntries) {
  caches.open(cacheName).then((cache) => {
    cache.keys().then((keys) => {
      if (keys.length > maxEntries) {
        cache.delete(keys[0]).then(() => trimCache(cacheName, maxEntries));
      }
    });
  });
}

// Cache-first: good for immutable / versioned bytes.
function cacheFirst(request, cacheName) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((networkResponse) => {
      if (isCacheableResponse(networkResponse)) {
        const copy = networkResponse.clone();
        caches.open(cacheName).then((cache) => {
          cache.put(request, copy).then(() => {
            if (cacheName === IMAGE_CACHE) trimCache(cacheName, MAX_IMAGE_ENTRIES);
          });
        });
      }
      return networkResponse;
    });
  });
}

// Stale-while-revalidate: serve instantly, refresh in the background.
function staleWhileRevalidate(request, cacheName) {
  return caches.match(request).then((cached) => {
    const networkFetch = fetch(request)
      .then((networkResponse) => {
        if (isCacheableResponse(networkResponse)) {
          const copy = networkResponse.clone();
          caches.open(cacheName).then((cache) => cache.put(request, copy));
        }
        return networkResponse;
      })
      .catch((err) => {
        // Offline or network down: prefer the cached copy. Rethrow only when
        // there is nothing to fall back to, so the caller can apply its own
        // offline shell — swallowing here would make respondWith(undefined).
        if (cached) return cached;
        throw err;
      });
    return cached || networkFetch;
  });
}

self.addEventListener('fetch', (event) => {
  // Never intercept non-GET: chat POSTs / streaming must hit the network.
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only handle same-origin GET. This excludes Supabase (*.supabase.co),
  // auth callbacks, fonts/CDNs, and all cross-origin traffic by construction.
  if (url.origin !== self.location.origin) return;

  // Never serve API responses from cache.
  if (url.pathname.startsWith('/api/')) return;

  // Immutable hashed build output: safe to cache forever.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // Icons, manifest, raster images: bounded cache-first.
  if (
    url.pathname === '/manifest.json' ||
    url.pathname.startsWith('/icon') ||
    /\.(png|svg|ico|webp|avif)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
    return;
  }

  // App shell + everything else same-origin: stale-while-revalidate.
  // Navigations fall back to the cached shell entry when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      staleWhileRevalidate(event.request, RUNTIME_CACHE).catch(
        () => caches.match('/').then((shell) => shell || Response.error()) || Response.error()
      )
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request, RUNTIME_CACHE));
});
