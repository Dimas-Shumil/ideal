/* One root worker: PWA fallback and existing explicit-consent Push. */
const CACHE_PREFIX = 'ideal-pwa-offline-';
const CACHE_NAME = CACHE_PREFIX + 'v1';
const OFFLINE = '/offline.html';
const STATIC = new Set([OFFLINE, '/site/css/pwa.css']);
function cacheable(response) {
  return response.ok && !response.redirected && response.type !== 'opaque' &&
    !/no-store/i.test(response.headers.get('Cache-Control') || '');
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of STATIC) {
      const response = await fetch(url, {credentials: 'omit', cache: 'no-store', redirect: 'error'});
      if (!cacheable(response)) throw new Error('Offline resource unavailable');
      await cache.put(url, response);
    }
  })());
  // No skipWaiting: active forms and other tabs retain their worker.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
  })());
  // No clients.claim and no automatic page reload.
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.search && STATIC.has(url.pathname)) {
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE_NAME)).match(url.pathname);
      return cached || fetch(request);
    })());
    return;
  }
  if (request.mode !== 'navigate') return;
  event.respondWith((async () => {
    try { return await fetch(request); }
    catch {
      const fallback = await (await caches.open(CACHE_NAME)).match(OFFLINE);
      return fallback || new Response('Нет соединения с сервером.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
    }
  })());
});
const allowedPaths = new Set(["/trainer/lessons", "/crm/schedule", "/notifications", "/shop-panel/orders"]);
function safeUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && !url.username && !url.password && allowedPaths.has(url.pathname))
      return self.location.origin + url.pathname;
  } catch { /* Use protected fallback. */ }
  return self.location.origin + "/notifications";
}
self.addEventListener("push", event => {
  let data;
  try { data = event.data?.json(); } catch { data = null; }
  if (!data || typeof data !== "object") data = {};
  const title = typeof data.title === "string" ? data.title.slice(0, 100) : "ИДЕАЛ — уведомление";
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === "string" ? data.body.slice(0, 200) : "Откройте кабинет для подробностей.",
    tag: typeof data.tag === "string" ? data.tag.slice(0, 160) : "ideal-push",
    data: { url: safeUrl(data.url) },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = safeUrl(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url === url && "focus" in client) return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
