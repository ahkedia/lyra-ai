const CACHE = 'lyra-shell-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => { if (event.request.method !== 'GET') return; event.respondWith(fetch(event.request).catch(() => caches.match(event.request))); });
self.addEventListener('push', event => { const data = event.data?.json?.() || { title: 'Lyra', body: 'You have an update.' }; event.waitUntil(self.registration.showNotification(data.title || 'Lyra', { body: data.body || data.message || 'You have an update.', tag: data.type || 'lyra-update', data })); });
self.addEventListener('notificationclick', event => { event.notification.close(); event.waitUntil(clients.openWindow('/')); });
