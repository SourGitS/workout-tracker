const CACHE_NAME = 'daily-v45';

const ASSETS = [
  '/workout-tracker/',
  '/workout-tracker/index.html',
  '/workout-tracker/css/style.css',
  '/workout-tracker/js/app.js',
  '/workout-tracker/icon-192.png',
  '/workout-tracker/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only handle GET requests; let Firebase auth/DB and non-GET requests pass through
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // Network-first for the app shell (HTML/CSS/JS) so code updates take effect
  // immediately and you never get a stale/mismatched index.html + app.js combo.
  const isAppShell = event.request.mode === 'navigate' ||
    /\.(?:html|js|css)$/.test(url.pathname);

  if (isAppShell) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else (images, CDN libraries)
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
