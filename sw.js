// Service Worker for PWA - NAUJTRATS
const CACHE_NAME = 'naujtrats-v1';
const ASSETS = [
  '/oneapichat/',
  '/oneapichat/index.html',
  '/oneapichat/css/style.css',
  '/oneapichat/js/main.js',
  '/oneapichat/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // API 请求不缓存
  if (e.request.url.includes('/engine/') || e.request.url.includes('/chat.php') || e.request.url.includes('/auth.php') || e.request.url.includes('/api/')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
