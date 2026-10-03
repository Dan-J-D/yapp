// Yapp service worker: offline app shell, runtime caching of built assets, web push.
const VERSION = 'yapp-v1';
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/worklets/capture.js'];
// Pages worth having offline even before first visit (recording works offline).
const WARM = ['/daily', '/yap', '/yap/L1', '/everyday', '/drills', '/warmup'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(VERSION);
      await c.addAll(SHELL.filter((u) => u !== '/')).catch(() => {});
      // Authenticated pages: best effort (they redirect to /login when logged out).
      await Promise.all(
        ['/', ...WARM].map(async (u) => {
          try {
            const r = await fetch(u, { credentials: 'same-origin', redirect: 'manual' });
            if (r.ok && r.type === 'basic') await c.put(u, r);
          } catch {}
        }),
      );
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always live (SSE, uploads, stats)

  // Hashed build assets + static files: cache first.
  if (/^\/(_astro|icons|worklets)\//.test(url.pathname) || url.pathname === '/favicon.svg') {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((r) => {
            if (r.ok) {
              const copy = r.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return r;
          }),
      ),
    );
    return;
  }

  // Pages: network first, fall back to the cached copy, then the offline page.
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const r = await fetch(req);
          if (r.ok && !r.redirected && url.pathname !== '/login') {
            const c = await caches.open(VERSION);
            await c.put(url.pathname, r.clone());
          }
          return r;
        } catch {
          return (
            (await caches.match(url.pathname)) ||
            (url.pathname.startsWith('/yap/') && (await caches.match('/yap/L1'))) ||
            (await caches.match('/offline.html'))
          );
        }
      })(),
    );
  }
});

self.addEventListener('push', (e) => {
  let data = { title: 'Yapp', body: 'Time for a quick yap!', url: '/' };
  try {
    data = { ...data, ...e.data.json() };
  } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url },
      tag: 'yapp-challenge',
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) {
          await w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
