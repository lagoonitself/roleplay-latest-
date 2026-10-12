/* Cadenza service worker — plain JS, no dependencies.
   Registration path is /sw.js (see src/components/pwa-register.tsx).

   Strategy:
   - Navigations (HTML): NETWORK-FIRST. The network copy is fetched and cached
     on success; on failure we serve the runtime-cached copy of THAT url, then the
     runtime-cached '/' shell. HTML is never precached at install time, never
     cache-first, and never stale-while-revalidate: stale HTML can reference
     chunk names deleted by a deploy, which white-screens the iOS standalone app.
   - /_next/static/* (immutable hashed assets): cache-first, long-lived.
   - Icons / manifest / raster images: cache-first in a bounded cache.
   - Everything else same-origin GET: stale-while-revalidate in a bounded cache.
   - NEVER cached: non-GET, /api/*, or cross-origin traffic (incl. Supabase).
   - Updates: this worker does NOT self.skipWaiting() on install. The page
     decides when takeover happens via {type: 'SKIP_WAITING'} (see
     pwa-register.tsx), so a fresh worker can never swap in mid-session.
*/

const VERSION = 'cadenza-v4';
const STATIC_CACHE = `cadenza-static-${VERSION}`;
const RUNTIME_CACHE = `cadenza-runtime-${VERSION}`;
const IMAGE_CACHE = `cadenza-images-${VERSION}`;
const ALLOWED_CACHES = [STATIC_CACHE, RUNTIME_CACHE, IMAGE_CACHE];

const PRECACHE = ['/manifest.json'];
const MAX_IMAGE_ENTRIES = 40;
const MAX_RUNTIME_ENTRIES = 60;

self.addEventListener('install', (event) => {
  // Intentionally no self.skipWaiting() here: takeover is page-controlled.
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
  );
});

// The page asks this worker to take over (after the user opts in).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // Validate that the message comes from a same-origin client
    if (event.origin && event.origin !== self.location.origin) return;
    if (event.source) {
      if ('url' in event.source && event.source.url) {
        try {
          if (new URL(event.source.url).origin !== self.location.origin) return;
        } catch {
          return;
        }
      }
    } else if (!event.origin) {
      return;
    }
    self.skipWaiting();
  }
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

// FIFO trim: cache.keys() returns entries in insertion order, so deleting
// from the front drops the oldest entries first.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(keys[i]);
  }
}

// Every cache write is wrapped in event.waitUntil so it survives past the
// response being handed back to the page.
function cachePut(event, cacheName, request, response, maxEntries) {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.put(request, response))
      .then(() => (maxEntries ? trimCache(cacheName, maxEntries) : undefined))
      .catch(() => undefined)
  );
}

// Cache-first: good for immutable / versioned bytes.
function cacheFirst(event, cacheName, maxEntries) {
  const request = event.request;
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((networkResponse) => {
      if (isCacheableResponse(networkResponse)) {
        cachePut(event, cacheName, request, networkResponse.clone(), maxEntries);
      }
      return networkResponse;
    });
  });
}

// Stale-while-revalidate: serve instantly, refresh in the background.
function staleWhileRevalidate(event, cacheName, maxEntries) {
  const request = event.request;
  return caches.match(request).then((cached) => {
    const networkFetch = fetch(request)
      .then((networkResponse) => {
        if (isCacheableResponse(networkResponse)) {
          cachePut(event, cacheName, request, networkResponse.clone(), maxEntries);
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline or network down: return cached copy if present; if uncached,
        // degrade gracefully with an error response instead of an unhandled rejection.
        if (cached) return cached;
        return Response.error();
      });
    return cached || networkFetch;
  });
}

// Network-first for navigations: fresh HTML on every launch when online.
function networkFirstNavigation(event) {
  const request = event.request;
  return fetch(request)
    .then((networkResponse) => {
      if (isCacheableResponse(networkResponse)) {
        cachePut(event, RUNTIME_CACHE, request, networkResponse.clone(), MAX_RUNTIME_ENTRIES);
      }
      return networkResponse;
    })
    .catch(async () => {
      // Offline: prefer the most recent network-fetched HTML for THIS url from RUNTIME_CACHE,
      // then fall back to the runtime-cached '/' shell if available.
      const runtimeCache = await caches.open(RUNTIME_CACHE);
      const cached = await runtimeCache.match(request);
      if (cached) return cached;
      const shell = await runtimeCache.match('/');
      return shell || Response.error();
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

  // Navigations are network-first — never cache-first HTML.
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  // Immutable hashed build output: safe to cache forever.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(event, STATIC_CACHE));
    return;
  }

  // Icons, manifest, raster images: bounded cache-first.
  if (
    url.pathname === '/manifest.json' ||
    url.pathname.startsWith('/icon') ||
    /\.(png|svg|ico|webp|avif)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(event, IMAGE_CACHE, MAX_IMAGE_ENTRIES));
    return;
  }

  // Everything else same-origin: stale-while-revalidate in a bounded cache.
  event.respondWith(staleWhileRevalidate(event, RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
});
