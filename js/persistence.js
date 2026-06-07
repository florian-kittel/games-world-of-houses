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

  // ---------------------------------------------------------------------
  // Schema-Migration beim Laden (idempotent).
  // ---------------------------------------------------------------------
  // - v3 -> v4: state.structures normalisieren (Schritt 2-Schema).
  // - v4 -> v5: Burgen erhalten wallHP/towerHP/repairQueue;
  //             KI-State erhaelt lastAttackTime (Schritt 7).
  function migrate(state) {
    if (!state) return state;
    // Strukturen normalisieren (idempotent)
    if (WOH.Game && WOH.Game.normalizeStructures) WOH.Game.normalizeStructures(state);

    // Burg-Defaults fuer Belagerung
    var SIEGE = C.SIEGE || {};
    var maxHPArrW = SIEGE.wallMaxHP || [];
    var maxHPArrT = SIEGE.towerMaxHP || [];
    for (var id in state.villages) {
      var v = state.villages[id];
      var wl = v.buildings && v.buildings.wall || 0;
      var tl = v.buildings && v.buildings.tower || 0;
      if (typeof v.wallHP !== 'number')  v.wallHP  = wl >= 1 ? (maxHPArrW[Math.min(wl, maxHPArrW.length - 1)] || 0) : 0;
      if (typeof v.towerHP !== 'number') v.towerHP = tl >= 1 ? (maxHPArrT[Math.min(tl, maxHPArrT.length - 1)] || 0) : 0;
      if (!Array.isArray(v.repairQueue)) v.repairQueue = [];
    }

    // KI-State: lastAttackTime (Schritt 7-Vorbereitung)
    if (state.ai) {
      for (var hid in state.ai) {
        if (typeof state.ai[hid].lastAttackTime !== 'number') {
          state.ai[hid].lastAttackTime = state.gameTime || 0;
        }
        // v7 (Resourcen-Rework): KI-Persönlichkeit + Logistik-Drossel.
        if (!state.ai[hid].personality && WOH.Game && WOH.Game.pickPersonalityKey) {
          state.ai[hid].personality = WOH.Game.pickPersonalityKey(state.seed, hid);
        }
        if (typeof state.ai[hid].lastLogisticsAt !== 'number') {
          state.ai[hid].lastLogisticsAt = 0;
        }
      }
    }

    // v6 (Schritt 9.1): Strukturen-Upgrade-Queue, Spielende-Status,
    // Statistik-Felder. normalizeStructures haengt upgradeQueue an;
    // Spielende-Defaults sicher belegen.
    if (state.gameOver === undefined) state.gameOver = null;
    if (state.gameEndedAt === undefined) state.gameEndedAt = null;
    if (!state.stats) state.stats = {
      capturedStructures: 0, capturedCastles: 0,
      battlesWon: 0, battlesLost: 0,
      unitLosses: { spear: 0, sword: 0, axe: 0, archer: 0, hero: 0 }
    };
    // Schritt 10: Spielgeschwindigkeit (Default 4 = 4 Spielsek pro Echtsek).
    // Alte Saves vor Schritt 10 hatten TIME_SCALE 6 hartcodiert; der
    // Default-Multiplier 4 ist die naehrungsweise Entsprechung in der
    // neuen Verdopplungs-Skala (0/1/2/4/8). Spieler kann anpassen.
    if (typeof state.speedMultiplier !== 'number') state.speedMultiplier = 4;
    // Schritt 10b: Auto-Pause bei Kampfbericht-Overlay (Default true).
    if (typeof state.pauseOnReport !== 'boolean') state.pauseOnReport = true;

    state.version = 7;
    return state;
  }

  WOH.Persistence = { save: save, load: load, clear: clear, migrate: migrate };
})(window.WOH = window.WOH || {});
