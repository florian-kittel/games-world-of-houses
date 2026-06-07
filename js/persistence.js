/* =========================================================================
 * World of Houses – Persistenz (IndexedDB)
 * Speichert den Spielstand asynchron, ohne das Spiel zu blockieren.
 * Fällt bei fehlendem IndexedDB-Support auf localStorage zurück.
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
      var req = indexedDB.open(C.SAVE.dbName, 1);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(C.SAVE.storeName)) {
          db.createObjectStore(C.SAVE.storeName);
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
    return dbPromise;
  }

  // Spielstand speichern (Promise). Nicht-blockierend.
  function save(state) {
    var payload = { savedAt: Date.now(), state: state };
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(C.SAVE.storeName, 'readwrite');
        tx.objectStore(C.SAVE.storeName).put(payload, C.SAVE.slotId);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function () {
      // Fallback localStorage
      try {
        localStorage.setItem(C.SAVE.dbName + ':' + C.SAVE.slotId, JSON.stringify(payload));
        return true;
      } catch (e) { return false; }
    });
  }

  // Spielstand laden (Promise -> payload | null).
  function load() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(C.SAVE.storeName, 'readonly');
        var req = tx.objectStore(C.SAVE.storeName).get(C.SAVE.slotId);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function () {
      try {
        var raw = localStorage.getItem(C.SAVE.dbName + ':' + C.SAVE.slotId);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    });
  }

  function clear() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(C.SAVE.storeName, 'readwrite');
        tx.objectStore(C.SAVE.storeName).delete(C.SAVE.slotId);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () {
      try { localStorage.removeItem(C.SAVE.dbName + ':' + C.SAVE.slotId); } catch (e) {}
      return true;
    });
  }

  WOH.Persistence = { save: save, load: load, clear: clear };
})(window.WOH = window.WOH || {});
