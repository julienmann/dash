// Service worker for the training dashboard PWA.
//
// Strategy: network-first for the app itself (a single HTML file — always prefer the
// fresh copy so deploys land immediately), falling back to the cached copy offline.
// Static assets (icons, manifest) are cache-first. API calls to the worker and Strava
// are cross-origin and never touched here.

const CACHE = 'jm-dashboard-v1';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (e.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    // App shell: fresh when online, cached when not.
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./'))
    );
    return;
  }

  // Icons/manifest: cache-first, refresh in the background.
  e.respondWith(
    caches.match(e.request).then(hit => {
      const refresh = fetch(e.request)
        .then(res => { caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
