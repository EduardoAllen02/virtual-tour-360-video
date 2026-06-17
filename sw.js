// Service Worker — cache viewer static assets; video uses browser HTTP cache natively
const CACHE = 'vt360-video-v1';
const STATIC = [
  './viewer/index.html',
  './viewer/viewer.js',
  './viewer/style.css',
  './viewer/lang.js',
  './viewer/timeline.js',
  './viewer/overlays.js',
  './viewer/hotspots.js',
  './tour-config.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  // Pass video and image range requests directly to network
  if (url.endsWith('.mp4') || url.endsWith('.jpg') || url.endsWith('.jpeg')) return;
  // Cache-first for static viewer assets
  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(event.request).then(hit => {
        if (hit) return hit;
        return fetch(event.request).then(res => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        });
      })
    )
  );
});
