// Service Worker — disabled, causing cache issues
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { caches.keys().then(ks => ks.forEach(k => caches.delete(k))); self.clients.claim(); });
self.addEventListener('fetch', e => { return; });
