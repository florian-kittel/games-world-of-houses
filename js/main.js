/* =========================================================================
 * World of Houses – Bootstrap, Startmenü, Spielschleife, Auto-Save
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config, G = WOH.Game, P = WOH.Persistence;

  var state = null;
  var running = false;
  var lastTime = 0;
  var saveDirty = false;
  var lastSaveAt = 0;
  var OFFLINE_CAP_MS = 2 * 60 * 60 * 1000; // max. 2 h Offline-Aufholung
  var FRAME_CAP_MS = 5 * 60 * 1000;        // max. 5 min pro Frame (Tab-Schlaf)

  var api = {
    requestSave: function () { saveDirty = true; }
  };

  var assetsReady = null; // Promise

  function boot() {
    WOH.UI.init(api);
    // Grafik-Assets im Hintergrund laden (blockiert das Startmenü nicht).
    assetsReady = WOH.Sprites.loadAssets();
    P.load().then(function (payload) {
      showStartScreen(payload);
    });
  }

  // ---------------------------------------------------------------------
  // Startmenü
  // ---------------------------------------------------------------------
  function showStartScreen(savePayload) {
    var overlay = document.getElementById('start-screen');
    var hasSave = savePayload && savePayload.state;
    var diffOptions = Object.keys(C.DIFFICULTY).map(function (k) {
      var d = C.DIFFICULTY[k];
      return '<label class="diff"><input type="radio" name="diff" value="' + k + '"' +
        (k === 'normal' ? ' checked' : '') + '> <b>' + d.name + '</b>' +
        '<small>' + diffDesc(k) + '</small></label>';
    }).join('');

    overlay.innerHTML =
      '<div class="start-card">' +
      '<h1>World of Houses</h1>' +
      '<p class="tagline">Echtzeit-Strategie im Stil von „Die Stämme“ — erhebe dein Haus, baue deine Burg aus, ' +
      'erobere das Land. Top-Down-Pixel-Art.</p>' +
      (hasSave ? '<button class="btn big primary" id="btn-continue">Spiel fortsetzen</button>' +
        '<div class="save-info">Gespeichert: ' + new Date(savePayload.savedAt).toLocaleString('de-DE') + '</div>' : '') +
      '<h3>Neues Spiel</h3>' +
      '<div class="diffs">' + diffOptions + '</div>' +
      '<label class="seed-row">Gegner: ' + enemyOptions() + '</label>' +
      '<label class="seed-row">Seed (optional): <input id="seed-input" type="text" placeholder="zufällig"></label>' +
      '<button class="btn big" id="btn-new">Neue Welt erschaffen</button>' +
      (hasSave ? '<button class="btn ghost sm" id="btn-delete">Spielstand löschen</button>' : '') +
      '<div class="legal">Eigenständige Hausnamen & Wappen. Keine Markeninhalte Dritter.</div>' +
      '</div>';
    overlay.style.display = 'flex';

    if (hasSave) {
      document.getElementById('btn-continue').onclick = function () {
        resumeGame(savePayload);
      };
      document.getElementById('btn-delete').onclick = function () {
        if (confirm('Spielstand wirklich löschen?')) P.clear().then(function () { location.reload(); });
      };
    }
    document.getElementById('btn-new').onclick = function () {
      var diff = (overlay.querySelector('input[name=diff]:checked') || {}).value || 'normal';
      var seedRaw = document.getElementById('seed-input').value.trim();
      var seed = seedRaw ? hashSeed(seedRaw) : WOH.randomSeed();
      var enemies = parseInt((document.getElementById('enemy-input') || {}).value, 10) || C.MAP.defaultEnemies;
      state = G.newGame(seed, diff, enemies);
      startGame();
    };
  }

  function enemyOptions() {
    var max = C.MAP.maxEnemies || 5, def = C.MAP.defaultEnemies || 4, opts = '';
    for (var n = 1; n <= max; n++) {
      opts += '<option value="' + n + '"' + (n === def ? ' selected' : '') + '>' + n + '</option>';
    }
    return '<select id="enemy-input">' + opts + '</select>';
  }

  function diffDesc(k) {
    if (k === 'easy') return 'Passive Häuser, kaum Angriffe. Zum Einstieg.';
    if (k === 'normal') return 'Ausgewogen. Häuser wachsen und greifen gelegentlich an.';
    return 'Aggressive Kriegsherren mit Startvorsprung. Für Erfahrene.';
  }
  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function resumeGame(payload) {
    state = payload.state;
    // Bestehende Karten nachträglich glätten (dünne/isolierte Wasserstellen).
    if (state.map && WOH.MapGen.smoothWater) {
      WOH.MapGen.smoothWater(state.map.tiles, state.map.width, state.map.height);
    }
    // Ältere Spielstände um Rohstoff-Strukturen ergänzen.
    if (state.map && !state.structures && WOH.MapGen.placeResourceStructures) {
      var occ = [];
      for (var vid in state.villages) occ.push({ x: state.villages[vid].x, y: state.villages[vid].y });
      state.structures = WOH.MapGen.placeResourceStructures(
        state.map, WOH.RNG((state.seed ^ 0x5eed) >>> 0), occ);
    }
    // Schema-Migration auf v5 (idempotent: HP-Felder, Repair-Queue, KI-State).
    if (WOH.Persistence.migrate) WOH.Persistence.migrate(state);
    // Offline-Fortschritt simulieren (gedeckelt).
    var offline = Math.min(OFFLINE_CAP_MS, Date.now() - (payload.savedAt || Date.now()));
    if (offline > 1000) G.tick(state, offline);
    startGame();
    if (offline > 60000) {
      WOH.UI.toast('Willkommen zurück — ' + Math.round(offline / 60000) + ' Min. Aufbau wurden simuliert.');
    }
  }

  function startGame() {
    document.getElementById('start-screen').style.display = 'none';
    // Erst rendern/binden, wenn die Grafik-Assets geladen sind.
    (assetsReady || Promise.resolve()).then(function () {
      WOH.UI.bind(state);
      lastTime = performance.now();
      lastSaveAt = Date.now();
      running = true;
      requestAnimationFrame(loop);
    });
    startAutosave();
    // Vor dem Schließen noch speichern
    window.addEventListener('beforeunload', function () { P.save(state); });
    // Beim Verstecken speichern (mobil/Tabwechsel)
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) P.save(state);
    });
  }

  // ---------------------------------------------------------------------
  // Hauptschleife
  // ---------------------------------------------------------------------
  function loop(now) {
    if (!running) return;
    var dt = now - lastTime;
    lastTime = now;
    if (dt < 0) dt = 0;
    if (dt > FRAME_CAP_MS) dt = FRAME_CAP_MS;
    G.tick(state, dt);
    WOH.UI.frame(dt);
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------
  // Auto-Save (nicht-blockierend, im Intervall)
  // ---------------------------------------------------------------------
  function startAutosave() {
    setInterval(function () {
      if (!running) return;
      var due = Date.now() - lastSaveAt > C.SAVE.intervalMs;
      if (!saveDirty && !due) return;
      WOH.UI.setSaveStatus('speichert…');
      P.save(state).then(function (ok) {
        saveDirty = false;
        lastSaveAt = Date.now();
        WOH.UI.setSaveStatus(ok ? 'gespeichert ' + new Date().toLocaleTimeString('de-DE') : 'Speichern fehlgeschlagen');
      });
    }, Math.min(C.SAVE.intervalMs, 3000));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})(window.WOH = window.WOH || {});
