/* Service worker: lets the game open offline after the first visit and makes it installable.
 * Same-origin files: network first (updates arrive), cache as fallback. The Three.js CDN file: cache first. */
const CACHE = 'zone-royale-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin, cdn = /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (!sameOrigin && !cdn) return;
  if (cdn) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
    return;
  }
  e.respondWith(fetch(req).then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req).then((hit) => hit || caches.match('./'))));
});
