import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { clientsClaim } from 'workbox-core';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// registerType: 'autoUpdate' (vite.config.js) posts a SKIP_WAITING message to the
// waiting worker instead of calling skipWaiting() itself — without this listener a
// new deploy never activates for a client with the app already open, so updates
// silently never show up until every tab is fully closed and reopened.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
clientsClaim();

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
