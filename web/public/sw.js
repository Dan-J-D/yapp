// Yapp service worker: offline app shell, runtime caching of built assets, web push.
const VERSION = 'yapp-v1';
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/worklets/capture.js'];
// Pages worth having offline even before first visit (recording works offline).
const WARM = ['/daily', '/yap', '/yap/L1', '/yap/L2', '/yap/L3', '/yap/L4', '/everyday', '/drills', '/warmup', '/transfer'];

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

// Pages ask for a re-warm once logged in (install may have run before the session cookie existed).
self.addEventListener('message', (e) => {
  if (e.data !== 'warm') return;
  e.waitUntil(
    (async () => {
      const c = await caches.open(VERSION);
      const assets = new Set();
      const collect = (text, base) => {
        for (const m of text.matchAll(/(?:\/_astro\/|\.\/)[\w.\-]+\.(?:js|css)/g)) assets.add(new URL(m[0], base).pathname);
      };
      for (const u of ['/', ...WARM]) {
        try {
          const r = await fetch(u, { credentials: 'same-origin', redirect: 'manual' });
          if (!r.ok || r.type !== 'basic') continue;
          collect(await r.clone().text(), location.origin + u);
          await c.put(u, r);
        } catch {}
      }
      // Island chunks and the chunks they import, so warmed pages also hydrate offline.
      const done = new Set();
      while (assets.size > done.size) {
        for (const a of [...assets]) {
          if (done.has(a) || !a.startsWith('/_astro/')) {
            done.add(a);
            continue;
          }
          done.add(a);
          try {
            if (await c.match(a)) continue;
            const r = await fetch(a);
            if (!r.ok) continue;
            if (a.endsWith('.js')) collect(await r.clone().text(), location.origin + a);
            await c.put(a, r);
          } catch {}
        }
      }
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
          return (await caches.match(url.pathname)) || (await caches.match('/offline.html'));
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
