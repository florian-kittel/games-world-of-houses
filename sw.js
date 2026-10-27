/* World of Houses — Service Worker.
 * Cache-First-Strategie für statische Assets. Versionierter Cache-Name;
 * alte Caches werden beim Aktivieren entfernt. Beim Update der App
 * CACHE_VERSION inkrementieren — der Browser zieht dann frische Inhalte.
 */
'use strict';

var CACHE_VERSION = 'woh-cinematic-2026102708';
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
  './js/cinematic-v2.js',
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
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];
['grass-01', 'grass-02', 'field-01', 'water-01'].forEach(function (id) {
  ASSETS.push('./assets/cinematic/map/' + id + '.png');
});
['forest-01', 'forest-02', 'forest-03', 'rock-01', 'rock-02', 'rock-03',
 'rock-ore-01', 'rock-ore-02', 'rock-quarry-01', 'rock-quarry-02'].forEach(function (id) {
  ASSETS.push('./assets/cinematic/map/' + id + '.png');
});
['castle', 'woodcutter', 'ironmine', 'stonemine', 'farmstead', 'sheepfarm'].forEach(function (type) {
  var folder = './assets/cinematic/map/';
  for (var level = 1; level <= 3; level++) ASSETS.push(folder + type + '-0' + level + '.png');
});
['townhall-building-v3','woodcutter-close-v3','quarry-close-v3','ironmine-right-angle-v5',
 'farm-aligned-v4','warehouse-building-v3','barracks-aligned-v4','range-aligned-v4',
 'wall-aligned-v4','tower-aligned-v4'].forEach(function (id) {
  ASSETS.push('./assets/cinematic/ui/' + id + '.png');
});
['food','wood','stone','iron','population'].forEach(function (key) {
  ASSETS.push('./assets/cinematic/ui/resource-' + key + '.png');
});
['spear','sword','axe','archer','hero'].forEach(function (key) {
  ASSETS.push('./assets/cinematic/ui/unit-' + key + '.png');
});
// index.html uses revisioned script/style URLs; cache those exact requests offline.
ASSETS = ASSETS.concat(ASSETS.filter(function (url) {
  return /\.(js|css)$/.test(url);
}).map(function (url) { return url + '?v=2026102701'; }));
ASSETS.push('./css/style.css?v=2026102707', './js/ui.js?v=2026102706', './js/main.js?v=2026102704');
ASSETS.push('./js/cinematic-v2.js?v=2026102708');

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
