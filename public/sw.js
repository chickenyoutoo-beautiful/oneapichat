// Self-destructing Service Worker - clears all caches and unregisters
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
    }).then(() => {
      return self.registration.unregister();
    }).then(() => {
      // Reload all clients
      return self.clients.matchAll({type: 'window'});
    }).then(clients => {
      clients.forEach(client => client.navigate(client.url));
    })
  );
});

// Don't intercept any requests
self.addEventListener('fetch', event => {
  // Pass through to network
});
