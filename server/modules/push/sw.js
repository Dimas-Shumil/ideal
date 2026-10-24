/* Push only: no fetch handler, cache, offline mode, or install prompt. */
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
