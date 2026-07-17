// Service Worker v63 — Cache-First + 预缓存 + 更新通知
const CACHE_NAME = 'naujtrats-v63';
const STATIC_EXTS = /\.(js|css|woff2?|ttf|eot|png|jpg|svg|ico|webp|json)$/i;
const PRELOAD_URLS = [
  '/oneapichat/lib/katex/fonts/KaTeX_Main-Regular.woff2',
  '/oneapichat/lib/katex/fonts/KaTeX_Math-Italic.woff2',
  '/oneapichat/lib/katex/katex.min.css',
];

// ========== Install: 预缓存关键静态资源 ==========
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(PRELOAD_URLS.map(url =>
        cache.add(url).catch(() => { /* 预缓存失败不影响安装 */ })
      ));
    })
  );
  self.skipWaiting();
});

// ========== Activate: 清理旧缓存 + 通知客户端刷新 ==========
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.matchAll()).then(clients => {
      clients.forEach(c => {
        try { c.postMessage({ type: 'SW_UPDATED' }); } catch(_) {}
      });
    })
  );
  self.clients.claim();
});

// ========== Fetch: Cache-First for static, Network-First for HTML/API ==========
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (!url.startsWith('http')) return;
  // 跳过 API/数据请求
  if (url.includes('/engine_api') || url.includes('/chat.php') || url.includes('/auth.php')
      || url.includes('/engine/') || url.includes('/proxy.php') || url.includes('/fetch.php')
      || url.includes('/upload.php') || url.includes('/memory_api') || url.includes('/chaoxing_api')) return;

  const isStatic = STATIC_EXTS.test(url) || url.includes('/lib/');

  if (isStatic) {
    // ★ Cache-First: 静态资源直接读缓存（JS/CSS/字体带 ?v= 版本号永不过期）
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          if (r && r.ok) {
            var clone = r.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
          }
          return r;
        });
      })
    );
  } else {
    // ★ Network-First: HTML 优先走网络，失败回退缓存
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.ok) {
          var clone = r.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return r;
      }).catch(() => {
        return caches.match(e.request).then(cached => {
          return cached || new Response('Offline', { status: 503 });
        });
      })
    );
  }
});
