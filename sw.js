/* World of Houses — Service Worker.
 * Cache-First-Strategie für statische Assets. Versionierter Cache-Name;
 * alte Caches werden beim Aktivieren entfernt. Beim Update der App
 * CACHE_VERSION inkrementieren — der Browser zieht dann frische Inhalte.
 */
'use strict';

var CACHE_VERSION = 'woh-v3-2026061302';
var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/config.js',
  './js/rng.js',
  './js/houses.js',
  './js/mapgen.js',
  './js/atlas.js',
  './js/sprites.js',
  './js/village.js',
  './js/combat.js',
  './js/game.js',
  './js/ai.js',
  './js/persistence.js',
  './js/ui.js',
  './js/main.js',
  './assets/tileset2.png',
  './assets/tileset.png',
  './assets/mountains.png',
  './assets/water.png',
  './assets/tiles.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // Mit addAll bricht der Install bei einer fehlenden Datei ab.
      // Wir nutzen daher individuelle Adds und tolerieren Fehler
      // (z. B. wenn Icons noch nicht erzeugt wurden).
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(url).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        // Network-Fallback wird nicht automatisch zwischengespeichert,
        // damit IndexedDB-/Cross-Origin-Antworten keine Probleme machen.
        return resp;
      }).catch(function () {
        // Offline ohne Cache-Treffer: HTML-Hauptseite zurueckgeben
        if (req.headers.get('accept') && req.headers.get('accept').indexOf('text/html') !== -1) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
