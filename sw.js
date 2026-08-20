/* Strength-Lab Service Worker: App-Shell offline verfügbar machen.
   Cache-Version bei jedem Release erhöhen, damit Clients aktualisieren. */
var CACHE = 'strength-lab-v1.2.0';
var ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'js/algorithm.js',
  'js/generator.js',
  'js/app.js',
  'data/exercises.json',
  'vendor/supabase-js-2.111.0.min.js',
  'fonts/dm-sans-latin.woff2',
  'fonts/dm-sans-latin-ext.woff2',
  'fonts/bebas-neue-latin.woff2',
  'fonts/bebas-neue-latin-ext.woff2',
  'icon.svg',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Statische Assets cache-first; alles andere (Supabase-API) geht direkt
   ins Netz und wird nie gecacht. */
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        return res;
      });
    })
  );
});
