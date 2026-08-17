const CACHE = 'lyra-shell-v9';
const SHELL = ['/app/', '/app/styles.css', '/app/assets/main.js', '/app/manifest.webmanifest', '/app/icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lyra-shell-') && key !== CACHE).map(key => caches.delete(key))))])));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/app/share') {
    event.respondWith((async () => {
      const form = await event.request.formData();
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('lyra-pwa', 2); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('resources')) request.result.createObjectStore('resources', { keyPath: 'key' }); if (!request.result.objectStoreNames.contains('mutations')) request.result.createObjectStore('mutations', { keyPath: 'id' }); if (!request.result.objectStoreNames.contains('incoming-shares')) request.result.createObjectStore('incoming-shares', { keyPath: 'id' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const item = { id: crypto.randomUUID(), title: String(form.get('title') || '').slice(0, 500), text: String(form.get('text') || '').slice(0, 8000), url: String(form.get('url') || '').slice(0, 2000), createdAt: new Date().toISOString() };
      await new Promise((resolve, reject) => { const request = db.transaction('incoming-shares', 'readwrite').objectStore('incoming-shares').put(item); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
      db.close();
      return Response.redirect('/app/?incoming-share=1', 303);
    })());
    return;
  }
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
self.addEventListener('push', event => { const data = event.data?.json?.() || { title: 'Lyra', body: 'You have an update.' }; event.waitUntil(self.registration.showNotification(data.title || 'Lyra', { body: data.body || data.message || 'You have an update.', tag: data.type || 'lyra-update', data })); });
self.addEventListener('notificationclick', event => { event.notification.close(); const target = event.notification.data?.eventId ? `/app/?tab=${event.notification.data.tab || 'lyra'}&event=${encodeURIComponent(event.notification.data.eventId)}` : '/app/'; event.waitUntil(clients.openWindow(target)); });
