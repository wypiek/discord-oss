self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data?.json() ?? {};
    } catch {
      return { body: event.data?.text() };
    }
  })();
  event.waitUntil(
    self.registration.showNotification(data.title || "New message", {
      body: data.body || "",
      icon: data.icon,
      badge: "/static/logo.png",
      tag: data.tag,
      renotify: !!data.tag,
      timestamp: Date.now(),
      data: { url: data.url || "/channels/@me" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/channels/@me", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === url.origin);
      if (!open) return self.clients.openWindow(url.href);
      open.postMessage({
        type: "fosscord-notification-click",
        path: url.pathname,
        id: event.notification.data?.id,
      });
      return open.focus();
    })(),
  );
});
