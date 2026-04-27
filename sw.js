/* ====================================================
   GOLIAT PWA - Service Worker v4 (Wow Factor Update)
   Network-first for app shell, cache-first for static externals
   ==================================================== */

const CACHE_NAME = 'goliat-v5';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

const CACHEABLE_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.tailwindcss.com'
];

function isAppShellRequest(url) {
  return APP_SHELL.some((asset) => url.pathname === asset || url.pathname.endsWith(asset));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse?.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      return cache.match('/index.html');
    }

    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const networkResponse = await fetch(request);
  const url = new URL(request.url);
  const shouldCache = networkResponse.ok && (
    isAppShellRequest(url) ||
    CACHEABLE_ORIGINS.some((origin) => url.hostname.includes(origin))
  );

  if (shouldCache) {
    cache.put(request, networkResponse.clone());
  }

  return networkResponse;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  if (event.request.mode === 'navigate' || isAppShellRequest(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

self.addEventListener('push', (event) => {
  const defaults = {
    title: 'Goliat - Alerte Cote',
    body: 'Une cote VIP vient d\'exploser. Agissez maintenant !',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'goliat-alert',
    requireInteraction: true,
    actions: [
      { action: 'voir', title: 'Voir le prono' },
      { action: 'ignorer', title: 'Ignorer' }
    ]
  };

  const data = event.data ? event.data.json() : defaults;

  event.waitUntil(
    self.registration.showNotification(data.title || defaults.title, {
      body: data.body || defaults.body,
      icon: data.icon || defaults.icon,
      badge: defaults.badge,
      tag: data.tag || defaults.tag,
      requireInteraction: data.urgent || false,
      data: { url: data.url || '/index.html#pronos' },
      actions: defaults.actions
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existingClient = clientList.find((client) => client.url.includes('goliat'));
      if (existingClient) {
        existingClient.focus();
        existingClient.navigate(targetUrl);
      } else {
        clients.openWindow(targetUrl);
      }
    })
  );
});
