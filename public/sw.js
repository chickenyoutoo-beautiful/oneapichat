// Service Worker v66 — 仅缓存静态资源, 其他全部放行
const CACHE_NAME = 'naujtrats-v106';
const STATIC_EXTS = /\.(css|woff2?|ttf|eot|png|jpg|jpeg|svg|ico|webp|json)$/i;

// ========== Install ==========
self.addEventListener('install', e => {
  self.skipWaiting();
});

// ========== Activate: 清理旧缓存 ==========
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ========== Fetch: 仅静态资源走缓存, 其余全部放行 ==========
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  // 只缓存静态文件
  if (!STATIC_EXTS.test(url) && !url.includes('/oneapichat/lib/')) return;
  // 不缓存带版本号的 JS/CSS (由 nginx 管理)
  if (url.includes('?v=')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(r => {
        if (r && r.ok) {
          var clone = r.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return r;
      }).catch(() => new Response('', { status: 503 }));
    })
  );
});
