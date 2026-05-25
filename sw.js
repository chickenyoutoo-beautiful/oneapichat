// Service Worker v5
const CACHE_NAME = 'naujtrats-v5';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // 只缓存 GET 静态资源
  if (e.request.method !== 'GET') return;
  if (url.includes('/engine_api') || url.includes('/chat.php') || url.includes('/auth.php')) return;
  if (!url.startsWith('http')) return;

  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
