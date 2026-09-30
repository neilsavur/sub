// Caches the app shell only. Audio lives in IndexedDB and must never end up here —
// a few hundred MB of blobs in the cache is exactly what gets the origin evicted.

const CACHE = 'layers-shell-v1';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './audio/mixer.js',
  './audio/layer.js',
  './storage/db.js',
  './storage/files.js',
  './storage/presets.js',
  './ui/layerView.js',
  './ui/library.js',
  './ui/presets.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network first so a deploy is picked up, cache as the offline fallback.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => { /* quota */ });
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
