// Service Worker v10
const CACHE_NAME = 'naujtrats-v10';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.includes('/engine_api') || url.includes('/chat.php') || url.includes('/auth.php')) return;
  if (!url.startsWith('http')) return;

  e.respondWith(
    fetch(e.request).then(r => {
      if (!r.ok && r.status !== 0) return r;
      var clone = r.clone();
      caches.open(CACHE_NAME).then(function(c) {
        return c.put(e.request, clone);
      }).catch(function() {});
      return r;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
