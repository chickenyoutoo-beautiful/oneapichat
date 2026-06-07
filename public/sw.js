// Service Worker v19
const CACHE_NAME = 'naujtrats-v19';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // 只处理 GET 请求
  if (e.request.method !== 'GET') return;
  // 跳过 API 请求
  if (url.includes('/engine_api') || url.includes('/chat.php') || url.includes('/auth.php')) return;
  if (!url.startsWith('http')) return;

  e.respondWith(
    fetch(e.request).then(r => {
      if (r && r.ok) {
        var clone = r.clone();
        caches.open(CACHE_NAME).then(function(c) {
          c.put(e.request, clone);
        }).catch(function() {});
      }
      return r;
    }).catch(function() {
      return caches.match(e.request).then(function(cached) {
        return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
