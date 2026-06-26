import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ url }) => url.hostname.endsWith('.supabase.co'),
  new NetworkFirst({ cacheName: 'supabase-api', networkTimeoutSeconds: 10 })
);

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const { title, body, tag } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icons/icon-192.png',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      const existing = list.find(c => c.url.startsWith(self.location.origin));
      return existing ? existing.focus() : clients.openWindow('/');
    })
  );
});
