/**
 * UltraCC Service Worker — offline-first shell caching.
 *
 * Strategy:
 *   - Navigation/HTML → Network-first, cached fallback for offline use.
 *   - Versioned static assets → Cache-first, network fallback.
 *   - Static assets (icons, manifest) → Cache-first.
 *   - API/gateway requests → Network-only (VTOP data must be fresh).
 *   - Cached VTOP data lives in IndexedDB, not the SW cache.
 */

const CACHE_NAME = 'ultracc-shell-v5';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/icon-192.svg',
  '/manifest.json',
];

// Discovers and precaches production entry files and dynamic chunks
async function precacheDiscoveredAssets(cache) {
  try {
    const indexResponse = (await cache.match('/index.html')) || (await fetch('/index.html'));
    if (!indexResponse) return;
    const html = await indexResponse.text();

    // Match all /assets/... scripts and stylesheets
    const entryMatches = html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g);
    const entryAssets = Array.from(entryMatches, (m) => m[1]);

    const discovered = new Set(entryAssets);
    const queue = [...entryAssets];

    // Precache entry assets
    await Promise.allSettled(
      entryAssets.map(async (assetUrl) => {
        try {
          const res = await fetch(assetUrl);
          if (res.ok) await cache.put(assetUrl, res);
        } catch {}
      })
    );

    // Recursively discover dynamic chunks from JS assets
    while (queue.length > 0) {
      const assetUrl = queue.shift();
      if (!assetUrl.endsWith('.js')) continue;

      let content = '';
      try {
        const cachedRes = await cache.match(assetUrl);
        if (cachedRes) {
          content = await cachedRes.text();
        } else {
          const fetchedRes = await fetch(assetUrl);
          if (fetchedRes.ok) {
            const clone = fetchedRes.clone();
            await cache.put(assetUrl, clone);
            content = await fetchedRes.text();
          }
        }
      } catch {
        continue;
      }

      if (!content) continue;

      const matches = content.matchAll(/(?:\/?assets\/|\.\/)?([a-zA-Z0-9_-]+\.(?:js|css))/g);
      const newUrls = [];

      for (const match of matches) {
        const filename = match[1];
        const fullUrl = `/assets/${filename}`;
        if (!discovered.has(fullUrl)) {
          discovered.add(fullUrl);
          newUrls.push(fullUrl);
          queue.push(fullUrl);
        }
      }

      if (newUrls.length > 0) {
        await Promise.allSettled(
          newUrls.map(async (url) => {
            try {
              const res = await fetch(url);
              if (res.ok) await cache.put(url, res);
            } catch {}
          })
        );
      }
    }
  } catch (err) {
    console.warn('Asset precache failed:', err);
  }
}

// Install — pre-cache the app shell and its assets.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled(
        SHELL_ASSETS.map((asset) => cache.add(asset).catch(() => {}))
      );
      await precacheDiscoveredAssets(cache);
      // No automatic skipWaiting: the client shows an "Update now" affordance
      // and calls SKIP_WAITING so the student is never interrupted mid-task.
    })()
  );
});

// Message handler — the client-driven update flow.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ---------------------------------------------------------------------------
// Background push notifications
//
// Payload shape (see supabase/functions/push-dispatch):
//   { id, title, body, url, tag }
// The reminder is composed on the student's own device, so nothing here is
// fetched or enriched — it is displayed verbatim and opens the right screen.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'UltraCC', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'UltraCC';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-any.svg',
      badge: '/icon-192.svg',
      // Same tag = one live notification per class/quiz, refreshed in place.
      tag: payload.tag || payload.id || 'ultracc',
      data: { url: payload.url || '/?tab=dashboard', id: payload.id },
      requireInteraction: false,
    })
  );
});

// Tapping a push focuses an existing UltraCC window (and routes it) or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/?tab=dashboard';

  event.waitUntil(
    (async () => {
      const target = new URL(targetUrl, self.location.origin);
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      for (const client of clients) {
        if (new URL(client.url).origin !== target.origin) continue;
        await client.focus();
        if ('navigate' in client) {
          try { await client.navigate(target.href); } catch { /* older clients */ }
        } else {
          client.postMessage({ type: 'PUSH_OPEN_URL', url: target.href });
        }
        return;
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

// The browser can rotate a subscription on its own (e.g. after a key change).
// Tell the app so it can re-register instead of silently going quiet.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGE' });
    })()
  );
});

// After activation, tell every open client to reload so the new shell is
// actually in use (the client listens for SW_APPLY_UPDATE).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await caches.keys().then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'SW_APPLY_UPDATE' });
      }
    })()
  );
});

// Fetch — cache-first for shell and assets, network-first for navigation, network-only for API.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests.
  if (event.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  // Never cache API or gateway requests.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/supabase/')) {
    return;
  }

  // Navigation requests: Network-first, fallback to cached /index.html.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/index.html', clone.clone());
              cache.put('/', clone);
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = (await caches.match('/index.html')) || (await caches.match('/'));
          if (cached) return cached;
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        })
    );
    return;
  }

  // Versioned static assets & static files — cache-first.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(async () => {
            const fallback = await caches.match(url.pathname);
            if (fallback) return fallback;
            return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
          });
      })
    );
    return;
  }

  // Everything else — network-only (API calls, images, etc.)
  // VTOP data is in IndexedDB, not in SW cache.
});
