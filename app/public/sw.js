const CACHE = 'lyra-shell-v5';
const SHELL = ['/app/', '/app/styles.css', '/app/assets/main.js', '/app/manifest.webmanifest', '/app/icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lyra-shell-') && key !== CACHE).map(key => caches.delete(key))))])));
self.addEventListener('fetch', event => { if (event.request.method !== 'GET') return; event.respondWith(fetch(event.request).catch(() => caches.match(event.request))); });
self.addEventListener('push', event => { const data = event.data?.json?.() || { title: 'Lyra', body: 'You have an update.' }; event.waitUntil(self.registration.showNotification(data.title || 'Lyra', { body: data.body || data.message || 'You have an update.', tag: data.type || 'lyra-update', data })); });
self.addEventListener('notificationclick', event => { event.notification.close(); const target = event.notification.data?.eventId ? `/app/?tab=${event.notification.data.tab || 'lyra'}&event=${encodeURIComponent(event.notification.data.eventId)}` : '/app/'; event.waitUntil(clients.openWindow(target)); });
