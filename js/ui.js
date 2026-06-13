/* =========================================================================
 * World of Houses – Benutzeroberfläche
 * Karten- und Dorfansicht, HUD, Truppenversand, Ereignisprotokoll.
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config, G = WOH.Game, S = WOH.Sprites, V = WOH.Village;

  var state = null, api = null;
  var dom = {};
  var cam = { x: 0, y: 0, zoom: 1, drag: null, moved: false };
  var terrainCanvas = null;
  var activeVillageId = null;   // im Overlay angezeigtes Dorf
  var targetVillageId = null;   // angeklicktes Zieldorf (Karte)
  var selectedStructureId = null; // angeklickte Rohstoff-Struktur (Karte)
  var hoverStructureId = null;  // Mauszeiger ueber Struktur (Hover-Highlight)
  var overlayOpen = false;
  var overlayMode = 'village';    // 'village' | 'structure' — Inhalt des Overlays
  var activeStructureId = null;   // im Overlay verwaltete eigene Struktur
  var reportOpen = false;
  var panelTimer = 0;
  var trainCounts = {};         // gemerkte Ausbildungsmengen je Einheit (überlebt Neuaufbau)
  var sendCounts = {};          // gemerkte Truppenmengen fürs Angriffs-/Unterstützungsformular
  var sendFromId = null;        // gewähltes Quell-Dorf für den Angriff
  var garrisonCounts = {};      // Mengen fuer Garnison-Stationierung
  var supportCounts = {};       // Einheiten-Mengen fuer Support-Picker
  var supportResCounts = {};    // Rohstoff-Mengen fuer Support-Picker (Tross)
  var supportSourceId = null;   // gewaehlte Quelle (Burg- oder Struktur-Id)
  var activeBurgTab = 'buildings'; // 'buildings' | 'military' — nur auf schmalen Viewports sichtbar

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function fmt(n) { return Math.floor(n).toLocaleString('de-DE'); }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (h > 0 ? h + ':' : '') + p(m) + ':' + p(s);
  }
  // Ressourcen-Icon als eingebettete Canvas (umgeht toDataURL-Taint bei file://).
  function resIcoTag(r, internal) {
    internal = internal || 32;
    var cls = internal <= 26 ? 'res-ico sm' : 'res-ico';
    return '<canvas class="' + cls + '" data-res="' + r + '" width="' + internal + '" height="' + internal + '"></canvas>';
  }
  function paintResIcons(container) {
    if (!container) return;
    Array.prototype.forEach.call(container.querySelectorAll('canvas[data-res]'), function (c) {
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      S.drawResourceIcon(ctx, 0, 0, c.width / 16, c.getAttribute('data-res'));
    });
  }
  // Gemeinsamer Helfer fuer Einheiten-Icons (vorher in 5 Panels dupliziert).
  // ox/oy/scale erlauben die groesseren Overlay-Icons (3,0,4) vs. Sidebar (2,0,3).
  function paintUnitIcons(container, ox, oy, scale) {
    if (!container) return;
    ox = (ox == null) ? 2 : ox; oy = (oy == null) ? 0 : oy; scale = (scale == null) ? 3 : scale;
    Array.prototype.forEach.call(container.querySelectorAll('canvas[data-unit]'), function (c) {
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      S.drawUnitIcon(ctx, ox, oy, scale, c.getAttribute('data-unit'));
    });
  }

  // Laufende Nummer eines Dorfes innerhalb seines Hauses (stabil nach id-Reihenfolge).
  function villageOrdinal(v) {
    var same = G.villagesOfHouse(state, v.houseId).slice();
    same.sort(function (a, b) {
      return (parseInt(a.id.split('_')[1] || 0, 10)) - (parseInt(b.id.split('_')[1] || 0, 10));
    });
    for (var i = 0; i < same.length; i++) if (same[i].id === v.id) return i + 1;
    return 1;
  }
  // "#n" nur, wenn das Haus mehr als ein Dorf besitzt.
  function villageTag(v) {
    return G.villagesOfHouse(state, v.houseId).length > 1 ? ' #' + villageOrdinal(v) : '';
  }
  // CSS-Hintergrund für ein zweifarbiges Wappen passend zum Muster (sigil.pattern).
  // Deckungsgleich mit S.drawCrest auf der Karte: diagonal/horizontal/vertical/
  // cross/triangleUp/triangleDown.
  function crestBg(sigil) {
    var p = (sigil && sigil.p) || '#888', s = (sigil && sigil.s) || '#ddd';
    switch (sigil && sigil.pattern) {
      case 'horizontal': return 'linear-gradient(180deg,' + p + ' 0 50%,' + s + ' 50% 100%)';
      case 'vertical':   return 'linear-gradient(90deg,' + p + ' 0 50%,' + s + ' 50% 100%)';
      case 'cross':      return 'linear-gradient(' + s + ',' + s + ') no-repeat center/100% 32%,' +
                                'linear-gradient(' + s + ',' + s + ') no-repeat center/32% 100%,' + p;
      case 'triangleUp': return 'linear-gradient(to top right,' + p + ' 0 50%,' + s + ' 50% 100%) left/50% 100% no-repeat,' +
                                'linear-gradient(to top left,' + p + ' 0 50%,' + s + ' 50% 100%) right/50% 100% no-repeat';
      case 'triangleDown': return 'linear-gradient(to bottom right,' + p + ' 0 50%,' + s + ' 50% 100%) left/50% 100% no-repeat,' +
                                'linear-gradient(to bottom left,' + p + ' 0 50%,' + s + ' 50% 100%) right/50% 100% no-repeat';
      case 'diagonal':
      default:           return 'linear-gradient(135deg,' + p + ' 0 50%,' + s + ' 50% 100%)';
    }
  }
  // Quell-Dorf für den Angriff (gewählt oder aktives Dorf).
  function sourceVillage() {
    var s = sendFromId && state.villages[sendFromId];
    if (s && s.houseId === state.playerHouseId) return s;
    return activeVillage();
  }

  // ---------------------------------------------------------------------
  function init(_api) {
    api = _api;
    dom.topbar = $('topbar');
    dom.mapView = $('map-view');
    dom.sidebar = $('sidebar');
    dom.canvas = $('map-canvas');
    dom.ctx = dom.canvas.getContext('2d');
    dom.saveStatus = $('save-status');
    dom.overlay = $('village-overlay');
    dom.villageBody = $('village-body');
    dom.overlayTitle = $('overlay-title');
    dom.battleOverlay = $('battle-overlay');
    dom.battleBody = $('battle-body');
    dom.battleTitle = $('battle-title');
    attachCanvasEvents();
    window.addEventListener('resize', resizeCanvas);
    $('overlay-close').addEventListener('click', closeVillage);
    dom.overlay.querySelector('.overlay-backdrop').addEventListener('click', closeVillage);
    $('battle-close').addEventListener('click', closeBattle);
    dom.battleOverlay.querySelector('.overlay-backdrop').addEventListener('click', closeBattle);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (reportOpen) closeBattle();
      else if (overlayOpen) closeVillage();
      else if ($('sidebar').classList.contains('open')) closeSidebar();
    });
    // Mobile: Burger-Button + Backdrop fuer Sidebar-Sheet
    var burger = $('sidebar-toggle');
    var backdrop = $('sidebar-backdrop');
    if (burger) burger.addEventListener('click', toggleSidebar);
    if (backdrop) backdrop.addEventListener('click', closeSidebar);
  }

  function toggleSidebar() {
    var sb = $('sidebar'), bd = $('sidebar-backdrop');
    if (!sb) return;
    if (sb.classList.contains('open')) closeSidebar();
    else { sb.classList.add('open'); if (bd) bd.classList.add('show'); }
  }
  function closeSidebar() {
    var sb = $('sidebar'), bd = $('sidebar-backdrop');
    if (sb) sb.classList.remove('open');
    if (bd) bd.classList.remove('show');
  }
  function openSidebarSheet() {
    var sb = $('sidebar'), bd = $('sidebar-backdrop');
    if (sb) sb.classList.add('open');
    if (bd) bd.classList.add('show');
  }

  function bind(s) {
    state = s;
    terrainCanvas = S.buildTerrainCanvas(state.map);
    activeVillageId = state.playerVillageId;
    targetVillageId = null;
    overlayOpen = false;
    dom.overlay.style.display = 'none';
    // Kamera auf Spielerdorf zentrieren
    var pv = state.villages[state.playerVillageId];
    resizeCanvas();
    if (pv) centerOn(pv);
    buildTopbar();
    renderSidebar();
  }

  function activeVillage() {
    var v = state.villages[activeVillageId];
    if (!v || v.houseId !== state.playerHouseId) {
      // Falls verloren: erstes eigenes Dorf wählen
      var own = G.villagesOfHouse(state, state.playerHouseId);
      v = own[0] || null;
      activeVillageId = v ? v.id : null;
    }
    return v;
  }

  // ---------------------------------------------------------------------
  // Kamera / Canvas
  // ---------------------------------------------------------------------
  function resizeCanvas() {
    if (!dom.canvas) return;
    var rect = dom.mapView.getBoundingClientRect();
    dom.canvas.width = Math.max(100, rect.width);
    dom.canvas.height = Math.max(100, rect.height);
    if (overlayOpen && dom.overlay) dom.overlay.style.top = dom.topbar.offsetHeight + 'px';
  }
  function centerOn(v) {
    var ts = C.MAP.tileSize;
    cam.x = v.x * ts - dom.canvas.width / (2 * cam.zoom);
    cam.y = v.y * ts - dom.canvas.height / (2 * cam.zoom);
    clampCam();
  }
  function clampCam() {
    var ts = C.MAP.tileSize;
    var worldW = state.map.width * ts, worldH = state.map.height * ts;
    var viewW = dom.canvas.width / cam.zoom, viewH = dom.canvas.height / cam.zoom;
    cam.x = Math.max(-40, Math.min(worldW - viewW + 40, cam.x));
    cam.y = Math.max(-40, Math.min(worldH - viewH + 40, cam.y));
  }
  function worldToScreen(wx, wy) {
    return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
  }
  function screenToWorld(sx, sy) {
    return { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
  }

  // Phase B: Pointer Events (Touch + Maus + Pen einheitlich).
  // Single-Pointer = Pan / Tap; Two-Pointer = Pinch-Zoom.
  // Long-Press (>= 500 ms ohne Bewegung) = Tooltip-Open analog Hover.
  var activePointers = {};      // pointerId -> {x, y}
  var pinchInitDist = 0;
  var pinchInitZoom = 1;
  var pinchCenter   = null;
  var longPressTimer = null;
  var LONG_PRESS_MS = 500;
  var TAP_THRESHOLD_PX = 8;
  // Doppel-Tap (Touch + Maus): zwei tap-Events innerhalb 350 ms und unter 25 px
  // Abstand. iOS Safari synthetisiert dblclick aus zwei Taps nicht zuverlaessig,
  // wenn touch-action:none gesetzt ist — deshalb erkennen wir es selbst.
  var DOUBLE_TAP_MS = 350;
  var DOUBLE_TAP_PX = 25;
  var lastTapTime = 0, lastTapX = 0, lastTapY = 0;

  function cancelLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }
  function pinchDistance(pts) {
    var keys = Object.keys(pts); if (keys.length < 2) return 0;
    var a = pts[keys[0]], b = pts[keys[1]];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function pinchMidpoint(pts) {
    var keys = Object.keys(pts);
    var a = pts[keys[0]], b = pts[keys[1]];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function attachCanvasEvents() {
    var cv = dom.canvas;

    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      activePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = Object.keys(activePointers).length;
      if (n === 1) {
        cam.drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, pointerId: e.pointerId };
        cam.moved = false;
        // Long-Press auf Touch ist ein Tooltip-Trigger (Strukturen-Info)
        if (e.pointerType === 'touch') {
          cancelLongPress();
          longPressTimer = setTimeout(function () {
            if (!cam.moved) {
              var st = structureAtEvent(e);
              if (st) {
                selectedStructureId = st.id;
                targetVillageId = null;
                renderSidebar();
                openSidebarSheet();
              }
            }
          }, LONG_PRESS_MS);
        }
      } else if (n === 2) {
        // Pinch-Start
        cam.drag = null;
        cancelLongPress();
        pinchInitDist = pinchDistance(activePointers);
        pinchInitZoom = cam.zoom;
        pinchCenter   = pinchMidpoint(activePointers);
      }
    });

    cv.addEventListener('pointermove', function (e) {
      if (activePointers[e.pointerId]) {
        activePointers[e.pointerId].x = e.clientX;
        activePointers[e.pointerId].y = e.clientY;
      }
      var n = Object.keys(activePointers).length;
      if (n === 2 && pinchInitDist > 0) {
        // Pinch-Zoom
        var d = pinchDistance(activePointers);
        var factor = d / pinchInitDist;
        var newZoom = Math.max(0.4, Math.min(3, pinchInitZoom * factor));
        var rect = cv.getBoundingClientRect();
        var mx = pinchCenter.x - rect.left, my = pinchCenter.y - rect.top;
        var before = screenToWorld(mx, my);
        cam.zoom = newZoom;
        var after = screenToWorld(mx, my);
        cam.x += before.x - after.x; cam.y += before.y - after.y;
        clampCam();
        return;
      }
      if (cam.drag) {
        var dx = e.clientX - cam.drag.sx, dy = e.clientY - cam.drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > TAP_THRESHOLD_PX) {
          cam.moved = true;
          cancelLongPress();
        }
        cam.x = cam.drag.cx - dx / cam.zoom;
        cam.y = cam.drag.cy - dy / cam.zoom;
        clampCam();
        return;
      }
      // Hover-Highlight nur fuer Maus, nicht fuer Touch
      if (e.pointerType !== 'mouse') return;
      if (e.target !== cv) { hoverStructureId = null; return; }
      var st = structureAtEvent(e);
      hoverStructureId = st ? st.id : null;
    });

    function endPointer(e) {
      cancelLongPress();
      var wasDragging = cam.drag && cam.drag.pointerId === e.pointerId;
      delete activePointers[e.pointerId];
      var n = Object.keys(activePointers).length;
      if (n < 2) {
        pinchInitDist = 0; pinchCenter = null;
      }
      if (n === 0 && wasDragging && !cam.moved) {
        // Doppel-Tap-Erkennung: zwei Taps binnen DOUBLE_TAP_MS und nahe beieinander.
        var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var dx = e.clientX - lastTapX, dy = e.clientY - lastTapY;
        var isDouble = (lastTapTime > 0)
          && (now - lastTapTime < DOUBLE_TAP_MS)
          && (Math.hypot(dx, dy) < DOUBLE_TAP_PX);
        if (isDouble) {
          handleMapDblTap(e);
          lastTapTime = 0; // Reset, damit kein 3.-Tap als Doppel-Tap zaehlt
        } else {
          handleMapClick(e);
          lastTapTime = now; lastTapX = e.clientX; lastTapY = e.clientY;
        }
      }
      if (n === 0) cam.drag = null;
    }
    cv.addEventListener('pointerup', endPointer);
    cv.addEventListener('pointercancel', endPointer);

    // Mausrad-Zoom bleibt fuer Desktop
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = cv.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var before = screenToWorld(mx, my);
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      cam.zoom = Math.max(0.4, Math.min(3, cam.zoom * factor));
      var after = screenToWorld(mx, my);
      cam.x += before.x - after.x; cam.y += before.y - after.y;
      clampCam();
    }, { passive: false });
    // Klassischer dblclick (Desktop-Maus) leitet auf gemeinsame Handler-Funktion um.
    // Touch-Geraete werden durch eigene Doppel-Tap-Logik in endPointer() bedient.
    cv.addEventListener('dblclick', handleMapDblTap);
  }

  // Doppel-Tap / Doppel-Klick auf der Karte:
  //  - eigene Burg     -> Burgansicht-Overlay
  //  - eigene Struktur -> Struktur-Verwaltungs-Overlay
  //  - fremde Burg     -> Angriffsziel selektieren + Sidebar oeffnen (auf Touch)
  //  - fremde Struktur -> Aktion-Picker selektieren + Sidebar oeffnen (auf Touch)
  function handleMapDblTap(e) {
    var rect = dom.canvas.getBoundingClientRect();
    var w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    var ts = C.MAP.tileSize;
    var v = villageAtEvent(e);
    var s = structureAtEvent(e);
    var pickStructure = false;
    if (v && s) {
      var dV = Math.hypot(v.x * ts + ts / 2 - w.x, v.y * ts + ts / 2 - w.y);
      var dS = Math.hypot(s.x * ts + ts / 2 - w.x, s.y * ts + ts / 2 - w.y);
      pickStructure = dS < dV;
    } else if (s) { pickStructure = true; }

    // Auf schmalen Viewports (Phone/iPad-Portrait) zusaetzlich Sidebar-Sheet oeffnen,
    // damit das Verwaltungs-/Aktions-Panel sofort sichtbar ist.
    var openSheet = (window.innerWidth <= 1024);

    if (pickStructure) {
      if (s.ownerHouseId === state.playerHouseId) {
        openStructure(s.id);
      } else {
        selectedStructureId = s.id; targetVillageId = null;
        renderSidebar();
        if (openSheet) openSidebarSheet();
      }
      return;
    }
    if (!v) return;
    if (v.houseId === state.playerHouseId) {
      activeVillageId = v.id; openVillage(v.id);
    } else {
      targetVillageId = v.id;
      renderSidebar();
      toast('Fremde Burg als Angriffsziel gewählt.');
      if (openSheet) openSidebarSheet();
    }
  }

  function villageAtEvent(e) {
    var rect = dom.canvas.getBoundingClientRect();
    var w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    var ts = C.MAP.tileSize;
    var best = null, bestD = 1e9;
    for (var id in state.villages) {
      var v = state.villages[id];
      var cx = v.x * ts + ts / 2, cy = v.y * ts + ts / 2;
      var d = Math.hypot(cx - w.x, cy - w.y);
      if (d < bestD) { bestD = d; best = v; }
    }
    return (best && bestD < ts * 0.9) ? best : null;
  }

  // Hit-Test fuer Rohstoff-Strukturen (analog villageAtEvent, etwas
  // kleinerer Trefferradius).
  function structureAtEvent(e) {
    var rect = dom.canvas.getBoundingClientRect();
    var w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    var ts = C.MAP.tileSize;
    var best = null, bestD = 1e9;
    var structs = state.structures || [];
    for (var i = 0; i < structs.length; i++) {
      var s = structs[i];
      var cx = s.x * ts + ts / 2, cy = s.y * ts + ts / 2;
      var d = Math.hypot(cx - w.x, cy - w.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return (best && bestD < ts * 0.9) ? best : null;
  }

  function handleMapClick(e) {
    // Klick-Prioritaet: das geometrisch naehere Element gewinnt (Burg oder
    // Struktur). Dadurch koennen Strukturen direkt neben Burgen sauber
    // selektiert werden.
    var rect = dom.canvas.getBoundingClientRect();
    var w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    var v = villageAtEvent(e);
    var s = structureAtEvent(e);
    var pickStructure = false;
    if (v && s) {
      var ts = C.MAP.tileSize;
      var dV = Math.hypot(v.x * ts + ts / 2 - w.x, v.y * ts + ts / 2 - w.y);
      var dS = Math.hypot(s.x * ts + ts / 2 - w.x, s.y * ts + ts / 2 - w.y);
      pickStructure = dS < dV;
    } else if (s) {
      pickStructure = true;
    }
    if (pickStructure) {
      selectedStructureId = s.id;
      targetVillageId = null;       // andere Selektion clear
      sendCounts = {}; garrisonCounts = {}; supportCounts = {}; supportResCounts = {}; supportSourceId = null;
      renderSidebar();
      return;
    }
    if (v) {
      selectedStructureId = null;
      if (v.houseId === state.playerHouseId) { activeVillageId = v.id; }
      targetVillageId = v.id;
      renderSidebar();
      return;
    }
    // Klick ins Leere: Selektionen zuruecksetzen
    selectedStructureId = null;
    renderSidebar();
  }

  // ---------------------------------------------------------------------
  // Render (jeder Frame)
  // ---------------------------------------------------------------------
  function frame(dtMs) {
    if (!state) return;
    renderMap();
    updateHUD();
    // Anstehende Kampfberichte anzeigen (einer nach dem anderen).
    if (!reportOpen && G.pendingReports && G.pendingReports.length) {
      showBattleReport(G.pendingReports.shift());
    }
    panelTimer += dtMs;
    if (panelTimer > 400) { panelTimer = 0; refreshDynamic(); }
    // Schritt 8.5: Sieg/Niederlage-Overlay zeigen
    if (state.gameOver && !endScreenShown) showEndScreen();
  }

  var endScreenShown = false;

  function showEndScreen() {
    endScreenShown = true;
    var existing = document.getElementById('end-screen');
    if (existing) existing.remove();
    var victory = state.gameOver === 'victory';
    var st = state.stats || {};
    var lossList = '';
    if (st.unitLosses) {
      lossList = C.UNIT_ORDER.filter(function (k) { return (st.unitLosses[k] || 0) > 0; })
        .map(function (k) { return '<li>' + C.UNITS[k].name + ': ' + st.unitLosses[k] + '</li>'; }).join('');
    }
    if (!lossList) lossList = '<li class="muted">keine</li>';

    var div = el('div'); div.id = 'end-screen';
    div.innerHTML =
      '<div class="end-card ' + (victory ? 'victory' : 'defeat') + '">' +
      '<h1>' + (victory ? '🏰 Sieg!' : '⚑ Niederlage') + '</h1>' +
      '<p class="end-sub">' + (victory ?
        'Alle gegnerischen Häuser sind ausgelöscht. Das Land gehört Eurem Haus.' :
        'Eure letzte Burg ist gefallen. Das Spiel ist verloren.') + '</p>' +
      '<div class="end-stats">' +
      '<div><b>Spielzeit:</b> ' + fmtTime(state.gameEndedAt || state.gameTime) + '</div>' +
      '<div><b>Eroberte Burgen:</b> ' + (st.capturedCastles || 0) + '</div>' +
      '<div><b>Eroberte Strukturen:</b> ' + (st.capturedStructures || 0) + '</div>' +
      '<div><b>Schlachten gewonnen / verloren:</b> ' + (st.battlesWon || 0) + ' / ' + (st.battlesLost || 0) + '</div>' +
      '<div><b>Eigene Verluste:</b><ul class="loss-list">' + lossList + '</ul></div>' +
      '</div>' +
      '<div class="end-actions">' +
      '<button class="btn big primary" id="end-new">Neue Welt</button>' +
      '<button class="btn big ghost" id="end-load">Spielstand laden</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(div);
    document.getElementById('end-new').onclick = function () {
      if (WOH.Persistence) WOH.Persistence.clear().then(function () { location.reload(); });
      else location.reload();
    };
    document.getElementById('end-load').onclick = function () { location.reload(); };
  }

  function renderMap() {
    var ctx = dom.ctx, cv = dom.canvas, ts = C.MAP.tileSize;
    ctx.fillStyle = '#0c1418';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(-cam.x * cam.zoom, -cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);
    // Terrain
    if (terrainCanvas) ctx.drawImage(terrainCanvas, 0, 0);
    // Bewegungslinien — Burgen UND Strukturen als Ziel/Quelle.
    // entityById liefert {x,y,ownerHouseId} fuer Burg oder Struktur einheitlich.
    var threatenedStructIds = {};  // fuer Ziel-Highlight unten
    state.movements.forEach(function (m) {
      var from = G.entityById ? G.entityById(state, m.fromId) : null;
      var to   = G.entityById ? G.entityById(state, m.toId)   : null;
      // Fallback wenn entityById fehlt (sollte nicht passieren)
      if (!from && state.villages[m.fromId]) {
        var fv = state.villages[m.fromId];
        from = { x: fv.x, y: fv.y, ownerHouseId: fv.houseId, kind: 'village' };
      }
      if (!to && state.villages[m.toId]) {
        var tv = state.villages[m.toId];
        to = { x: tv.x, y: tv.y, ownerHouseId: tv.houseId, kind: 'village' };
      }
      if (!from || !to) return;
      var prog = (state.gameTime - m.startTime) / (m.arriveTime - m.startTime);
      prog = Math.max(0, Math.min(1, prog));
      var fx = from.x * ts + ts / 2, fy = from.y * ts + ts / 2;
      var tx = to.x * ts + ts / 2, ty = to.y * ts + ts / 2;
      var px = fx + (tx - fx) * prog, py = fy + (ty - fy) * prog;
      var isPlayerAtt = m.ownerHouseId === state.playerHouseId;
      // Eingehend = feindliches Movement gegen eigenes Asset (Burg ODER Struktur).
      var hostile = (m.type === 'attack' || m.type === 'gather' || m.type === 'capture');
      var incoming = hostile && !isPlayerAtt && to.ownerHouseId === state.playerHouseId;
      // Struktur-Highlight notieren
      if (incoming && to.kind === 'structure') threatenedStructIds[m.toId] = true;
      // Eigene Unterstützung (Truppen/Rohstoffe) wird visuell von Angriffen
      // getrennt: blaue Linie; reiner Rohstoff-Tross zusätzlich bernsteinfarben.
      var isSupport = (m.type === 'support');
      var isSupply  = isSupport && m.resources && WOH.Combat.totalUnits(m.units || {}) <= 0;
      var lineCol, dotCol;
      if (incoming) { lineCol = 'rgba(210,70,70,0.7)'; dotCol = '#d24646'; }
      else if (isPlayerAtt && isSupply) { lineCol = 'rgba(200,162,74,0.6)'; dotCol = '#c8a24a'; }
      else if (isPlayerAtt && isSupport) { lineCol = 'rgba(90,160,216,0.6)'; dotCol = '#5aa0d8'; }
      else if (isPlayerAtt) { lineCol = 'rgba(110,207,151,0.6)'; dotCol = '#6fcf97'; }
      else { lineCol = 'rgba(186,178,170,0.6)'; dotCol = '#bdb6ae'; }
      ctx.strokeStyle = lineCol;
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
      // Marschpunkt: Rohstoff-Tross als kleines Quadrat (Fuhrwerk), sonst Kreis.
      ctx.fillStyle = dotCol;
      if (isSupply) {
        var sq = 4 / cam.zoom + 2;
        ctx.fillRect(px - sq, py - sq, sq * 2, sq * 2);
      } else {
        ctx.beginPath(); ctx.arc(px, py, 4 / cam.zoom + 2, 0, Math.PI * 2); ctx.fill();
      }
    });
    // Neutrale und eroberte Rohstoff-Strukturen (unter den Dörfern)
    var structs = state.structures || [];
    var threatened = threatenedStructIds;  // lokal aus dem Movement-Loop oben
    for (var si = 0; si < structs.length; si++) {
      var st = structs[si];
      var ownerHouse = st.ownerHouseId ? state.houses[st.ownerHouseId] : null;
      var isSel = st.id === selectedStructureId;
      var isHov = !isSel && st.id === hoverStructureId;
      S.drawResourceStructure(ctx,
        st.x * ts + ts / 2, st.y * ts + ts / 2, ts * 0.95,
        st,
        { selected: isSel, hover: isHov },
        ownerHouse);
      // Bedroht: roter, pulsierender Ring (analog Burg-Bedrohung in Sidebar)
      if (threatened[st.id]) {
        var pulse = 0.5 + 0.5 * Math.sin(state.gameTime * 4);
        ctx.strokeStyle = 'rgba(210,70,70,' + (0.55 + 0.35 * pulse).toFixed(2) + ')';
        ctx.lineWidth = 2 / cam.zoom;
        ctx.beginPath();
        ctx.arc(st.x * ts + ts / 2, st.y * ts + ts / 2, ts * 0.7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Dörfer
    for (var id in state.villages) {
      var v = state.villages[id];
      var house = state.houses[v.houseId];
      var p = { x: v.x * ts + ts / 2, y: v.y * ts + ts / 2 };
      var hall = v.buildings.townhall || 1;
      S.drawVillageMarker(ctx, p.x, p.y, ts * 1.1, house, {
        selected: id === targetVillageId,
        player: v.houseId === state.playerHouseId,
        tier: hall <= 2 ? 0 : (hall <= 4 ? 1 : 2)
      });
    }
    ctx.restore();
    // Burg-Labels (Bildschirmraum): größeres Wappen-Schild + zwei Zeilen.
    // Zeile 1 = Burgname, Zeile 2 = Hausname. Spieler: blauer Hintergrund.
    ctx.textAlign = 'left';
    var SHIELD = 20, GAP = 6, PADX = 5, PADY = 4;
    var F1 = 'bold 11px monospace', F2 = '10px monospace';
    for (var id2 in state.villages) {
      var v2 = state.villages[id2];
      var sp = worldToScreen(v2.x * ts + ts / 2, v2.y * ts + ts / 2);
      if (sp.x < -80 || sp.x > cv.width + 80 || sp.y < -40 || sp.y > cv.height + 40) continue;
      var h2 = state.houses[v2.houseId];
      var isP = v2.houseId === state.playerHouseId;
      var line1 = v2.name + villageTag(v2);   // Burgname
      var line2 = h2.name;                     // Hausname (z. B. "Haus Schwarzfels")
      ctx.font = F1; var w1 = ctx.measureText(line1).width;
      ctx.font = F2; var w2 = ctx.measureText(line2).width;
      var textW = Math.max(w1, w2);
      var boxW = PADX + SHIELD + GAP + textW + PADX;
      var BOXH = SHIELD + PADY * 2;
      var bx = Math.round(sp.x - boxW / 2), by = Math.round(sp.y + ts * 0.5);
      ctx.fillStyle = isP ? 'rgba(38,92,170,0.95)' : 'rgba(12,16,20,0.72)';
      ctx.fillRect(bx, by, boxW, BOXH);
      S.drawCrest(ctx, bx + PADX, by + PADY, SHIELD, h2.sigil);
      var tx = bx + PADX + SHIELD + GAP;
      ctx.font = F1;
      ctx.fillStyle = isP ? '#ffffff' : '#e2e6ec';
      ctx.fillText(line1, tx, by + PADY + 10);
      ctx.font = F2;
      ctx.fillStyle = isP ? 'rgba(255,255,255,0.82)' : '#99a2ad';
      ctx.fillText(line2, tx, by + PADY + 22);
    }
    // Struktur-Labels nur bei stärkerem Zoom
    if (cam.zoom > 1.1) {
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      var sM = C.RESOURCE_STRUCTURES || {};
      (state.structures || []).forEach(function (st) {
        var sp2 = worldToScreen(st.x * ts + ts / 2, st.y * ts + ts / 2);
        if (sp2.x < -40 || sp2.x > cv.width + 40 || sp2.y < -40 || sp2.y > cv.height + 40) return;
        var nm = (sM[st.type] && sM[st.type].name) || st.type;
        var tw2 = ctx.measureText(nm).width;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sp2.x - tw2 / 2 - 3, sp2.y + ts * 0.5, tw2 + 6, 13);
        ctx.fillStyle = '#cfc6a8';
        ctx.fillText(nm, sp2.x, sp2.y + ts * 0.5 + 10);
      });
    }
  }

  // ---------------------------------------------------------------------
  // HUD / Topbar
  // ---------------------------------------------------------------------
  function buildTopbar() {
    var house = state.houses[state.playerHouseId];
    dom.topbar.innerHTML = '';
    var left = el('div', 'tb-left');
    var crest = el('span', 'crest');
    crest.style.background = crestBg(house.sigil);
    left.appendChild(crest);
    left.appendChild(el('span', 'tb-house', house.name + ' — <i>' + house.motto + '</i>'));
    dom.topbar.appendChild(left);

    var res = el('div', 'tb-res'); res.id = 'tb-res';
    var rhtml = '';
    C.RESOURCES.forEach(function (r) {
      rhtml += '<span class="res" data-r="' + r + '" title="' + C.RESOURCE_META[r].name + '">' +
        resIcoTag(r, 32) + ' <span class="res-val">–</span></span>';
    });
    rhtml += '<span class="res pop" title="Bevölkerung">⚑ <span class="pop-val">–</span></span>';
    res.innerHTML = rhtml;
    dom.topbar.appendChild(res);
    paintResIcons(res);

    var right = el('div', 'tb-right');
    var sel = el('select', 'vill-select'); sel.id = 'vill-select';
    sel.addEventListener('change', function () {
      activeVillageId = sel.value;
      if (overlayOpen) openVillage(sel.value); else renderSidebar();
    });
    right.appendChild(sel);
    var manageBtn = el('button', 'tab active', '⌂ Burg verwalten');
    manageBtn.onclick = function () { openVillage(activeVillageId); };
    right.appendChild(manageBtn);
    // Schritt 10: Geschwindigkeits-Regler (Pause/1x/2x/4x/8x)
    var speedBox = el('span', 'tb-speed');
    speedBox.id = 'tb-speed';
    speedBox.innerHTML = buildSpeedButtonsHtml();
    right.appendChild(speedBox);
    right.appendChild(el('span', 'tb-clock', '⏱ <span id="game-clock">0:00</span>'));
    dom.topbar.appendChild(right);
    updateVillageSelect();
    attachSpeedButtons();
  }

  // Schritt 10: Speed-Buttons im HUD.
  var SPEED_OPTIONS = [
    { val: 0, label: '⏸',  title: 'Pause' },
    { val: 1, label: '1×', title: 'Normale Geschwindigkeit' },
    { val: 2, label: '2×', title: 'Doppelte Geschwindigkeit' },
    { val: 4, label: '4×', title: 'Vierfache Geschwindigkeit' },
    { val: 8, label: '8×', title: 'Achtfache Geschwindigkeit (für lange Wartephasen)' }
  ];
  function buildSpeedButtonsHtml() {
    var active = (state && typeof state.speedMultiplier === 'number') ? state.speedMultiplier : 1;
    return SPEED_OPTIONS.map(function (o) {
      var cls = 'speed-btn' + (o.val === active ? ' active' : '');
      return '<button class="' + cls + '" data-speed="' + o.val + '" title="' + o.title + '">' + o.label + '</button>';
    }).join('');
  }
  function attachSpeedButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('#tb-speed .speed-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var v = parseInt(btn.getAttribute('data-speed'), 10);
        if (!state || isNaN(v)) return;
        state.speedMultiplier = v;
        api.requestSave();
        refreshSpeedButtons();
      });
    });
  }
  function refreshSpeedButtons() {
    var box = $('tb-speed');
    if (!box) return;
    var active = (state && typeof state.speedMultiplier === 'number') ? state.speedMultiplier : 1;
    Array.prototype.forEach.call(box.querySelectorAll('.speed-btn'), function (btn) {
      var v = parseInt(btn.getAttribute('data-speed'), 10);
      btn.classList.toggle('active', v === active);
    });
  }

  function updateHUD() {
    var v = activeVillage();
    var resBox = $('tb-res');
    if (v && resBox && !resBox._hoverWired) {
      attachHudPopups(resBox);
      resBox._hoverWired = true;
    }
    if (v && resBox) {
      var cap = V.storageCap(v);
      C.RESOURCES.forEach(function (r) {
        var cell = resBox.querySelector('.res[data-r="' + r + '"]');
        if (!cell) return;
        // includeStructures=true: Direktproduktion eroberter Strukturen mit
        // einrechnen, damit die HUD-Rate den tatsaechlichen Lager-Zufluss zeigt.
        var rate = V.productionPerSec(v, r, state, true) * C.TIME_SCALE;
        var val = v.resources[r];
        cell.classList.toggle('full', val >= cap);
        var valEl = cell.querySelector('.res-val');
        if (valEl) valEl.innerHTML = fmt(val) + '<small>/' + fmt(cap) + ' · ' +
          (rate >= 0 ? '+' : '') + rate.toFixed(1) + '/s</small>';
      });
      // Pop-Anzeige mit Strukturen-Bonus-Aufschluesselung (Schritt 6)
      var pop = V.populationUsed(v, state);
      var capBase = V.populationCap(v);             // Burg-intern (Bauernhof)
      var capTotal = V.populationCap(v, state);     // inkl. Strukturen-Bonus
      var bonusFromStructs = capTotal - capBase;
      var popEl = resBox.querySelector('.pop-val');
      if (popEl) {
        var detail = bonusFromStructs > 0 ? (' (Burg ' + fmt(capBase) + ' + Strukturen ' + fmt(bonusFromStructs) + ')') : '';
        popEl.innerHTML = fmt(pop) + '/' + fmt(capTotal) + '<small>' + detail + '</small>';
      }
    }
    var clk = $('game-clock'); if (clk) clk.textContent = fmtTime(state.gameTime);
    // Schritt 10: Pause-Hinweis an der Uhr, wenn speedMultiplier === 0
    var clkBox = clk && clk.parentElement;
    if (clkBox) clkBox.classList.toggle('paused', state.speedMultiplier === 0);
  }

  // Schritt 11: Hover-Popups in der Topbar. Beim Hover ueber einen
  // Ressourcen-Eintrag oder die Pop-Anzeige oeffnet sich ein kleines Popup
  // mit Aufschluesselung der Quellen und Verbraucher.
  function attachHudPopups(resBox) {
    function wire(el, htmlBuilder) {
      if (!el) return;
      el.classList.add('hud-hover');
      // Maus: Hover oeffnet/schliesst
      el.addEventListener('mouseenter', function () { showHudPopup(el, htmlBuilder()); });
      el.addEventListener('mouseleave', closeHudPopup);
      // Touch: Tap toggelt
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var existing = document.getElementById('hud-popup');
        if (existing && existing._anchor === el) closeHudPopup();
        else showHudPopup(el, htmlBuilder());
      });
    }
    wire(resBox.querySelector('.res.pop'), buildPopPopupHtml);
    C.RESOURCES.forEach(function (r) {
      wire(resBox.querySelector('.res[data-r="' + r + '"]'), function () { return buildResPopupHtml(r); });
    });
    // Tap ausserhalb schliesst das Popup
    if (!document._hudPopupOutsideWired) {
      document._hudPopupOutsideWired = true;
      document.addEventListener('click', function (e) {
        var p = document.getElementById('hud-popup');
        if (!p) return;
        if (p.contains(e.target)) return;
        if (p._anchor && p._anchor.contains(e.target)) return;
        closeHudPopup();
      });
    }
  }

  function showHudPopup(anchor, html) {
    closeHudPopup();
    var pop = el('div', 'hud-popup'); pop.id = 'hud-popup'; pop.innerHTML = html;
    pop._anchor = anchor;
    document.body.appendChild(pop);
    // Auf mobil (< 600px) sitzt das Popup als Bottom-Sheet — Position via CSS.
    if (window.innerWidth >= 600) {
      var rect = anchor.getBoundingClientRect();
      pop.style.top  = (rect.bottom + 6) + 'px';
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, rect.left)) + 'px';
    }
  }
  function closeHudPopup() {
    var e = document.getElementById('hud-popup'); if (e) e.remove();
  }

  function fmtRate(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '/s'; }
  function fmtAmt(n)  { return n.toFixed(2) + '/s'; }

  function buildPopPopupHtml() {
    var v = activeVillage(); if (!v) return '';
    var cap = V.populationCapBreakdown(v, state);
    var use = V.populationBreakdown(v, state);
    var html = '<h4>Bevölkerung</h4>';
    html += '<div class="hud-section"><b>Kapazität (' + fmt(cap.total) + ')</b>';
    html += '<div>· Basis: <span>' + cap.base + '</span></div>';
    html += '<div>· Halle (St. ' + (v.buildings.townhall || 0) + '): <span>+' + cap.hall + '</span></div>';
    html += '<div>· Bauernhof (St. ' + (v.buildings.farm || 0) + '): <span>+' + cap.farm + '</span></div>';
    if (cap.structures > 0) html += '<div>· Strukturen: <span>+' + cap.structures + '</span></div>';
    html += '</div>';
    html += '<div class="hud-section"><b>Verbrauch (' + fmt(use.total) + ')</b>';
    html += '<div>· Zivilbevölkerung (Gebäude): <span>' + use.civilians + '</span></div>';
    html += '<div>· Armee (stationiert): <span>' + use.army + '</span></div>';
    if (use.training > 0) html += '<div>· Ausbildung: <span>' + use.training + '</span></div>';
    if (use.garrison > 0) html += '<div>· Garnison in Strukturen: <span>' + use.garrison + '</span></div>';
    if (use.marching > 0) html += '<div>· Armee unterwegs: <span>' + use.marching + '</span></div>';
    html += '</div>';
    var free = cap.total - use.total;
    var freeCls = free < 0 ? 'bad' : (free < 20 ? '' : 'good');
    html += '<div class="hud-saldo"><b>Frei:</b> <span class="' + freeCls + '">' + free + '</span></div>';
    return html;
  }

  function buildResPopupHtml(res) {
    var v = activeVillage(); if (!v) return '';
    var meta = C.RESOURCE_META[res];
    var html = '<h4>' + meta.name + '</h4>';

    if (res === 'food') {
      var b = V.foodUpkeepBreakdown(v, state);
      var produced = (function () {
        var farmLvl = v.buildings.farm || 0;
        return ((C.PRODUCTION.base || 0) + farmLvl * (C.BUILDINGS.farm.perLevel || 0)) * (v.bonus.food || 1);
      })();
      // Strukturen-Direktproduktion (eigene Strukturen mit res=food)
      var structProd = structureProductionPerSec(v, 'food');
      html += '<div class="hud-section"><b>Produktion (' + fmtAmt(produced + structProd) + ')</b>';
      html += '<div>· Bauernhof (St. ' + (v.buildings.farm || 0) + ' × Bonus ' + (v.bonus.food || 1).toFixed(2) + '): <span>+' + produced.toFixed(2) + '/s</span></div>';
      if (structProd > 0) html += '<div>· Eigene Höfe/Schaffarmen: <span>+' + structProd.toFixed(2) + '/s</span></div>';
      html += '</div>';
      html += '<div class="hud-section"><b>Verbrauch (' + fmtAmt(b.total) + ')</b>';
      html += '<div>· Bevölkerung: <span>' + b.civilians.toFixed(2) + '/s</span></div>';
      html += '<div>· Armee: <span>' + b.army.toFixed(2) + '/s</span></div>';
      if (b.training > 0) html += '<div>· Ausbildung: <span>' + b.training.toFixed(2) + '/s</span></div>';
      if (b.garrison > 0) html += '<div>· Garnison in Strukturen: <span>' + b.garrison.toFixed(2) + '/s</span></div>';
      if (b.marching > 0) html += '<div>· Armee unterwegs: <span>' + b.marching.toFixed(2) + '/s</span></div>';
      html += '</div>';
      var net = produced + structProd - b.total;
      var cls = net < 0 ? 'bad' : 'good';
      html += '<div class="hud-saldo"><b>Saldo:</b> <span class="' + cls + '">' + fmtRate(net) + '</span></div>';
    } else {
      // wood/stone/iron: nur Produktion aufschluesseln
      var prodKey = res === 'wood' ? 'woodcutter' : (res === 'stone' ? 'quarry' : 'mine');
      var lvl = v.buildings[prodKey] || 0;
      var bld = ((C.PRODUCTION.base || 0) + lvl * (C.BUILDINGS[prodKey].perLevel || 0)) * (v.bonus[res] || 1);
      var sp = structureProductionPerSec(v, res);
      html += '<div class="hud-section"><b>Produktion (' + fmtAmt(bld + sp) + ')</b>';
      html += '<div>· ' + C.BUILDINGS[prodKey].name + ' (St. ' + lvl + ' × Bonus ' + (v.bonus[res] || 1).toFixed(2) + '): <span>+' + bld.toFixed(2) + '/s</span></div>';
      if (sp > 0) html += '<div>· Eigene Strukturen: <span>+' + sp.toFixed(2) + '/s</span></div>';
      html += '</div>';
      html += '<div class="hud-section"><b>Lager</b><div>· ' + fmt(v.resources[res]) + ' / ' + fmt(V.storageCap(v)) + '</div></div>';
    }
    return html;
  }

  // Direktproduktion eroberter Strukturen, die an dieser Burg haengen,
  // begrenzt auf den passenden Rohstoff.
  function structureProductionPerSec(village, res) {
    if (!state.structures) return 0;
    var sum = 0;
    for (var i = 0; i < state.structures.length; i++) {
      var s = state.structures[i];
      if (s.assignedCastleId !== village.id || s.ownerHouseId !== village.houseId) continue;
      var meta = C.RESOURCE_STRUCTURES[s.type];
      if (!meta || meta.res !== res) continue;
      var lvl = Math.max(1, Math.min(3, s.level || 1));
      sum += C.RESOURCE_STRUCTURE_LEVELS.production[lvl - 1] || 0;
    }
    return sum;
  }

  function openVillage(id) {
    if (id) activeVillageId = id;
    var v = activeVillage();
    if (!v) { toast('Keine eigene Burg mehr.'); return; }
    overlayMode = 'village';
    overlayOpen = true;
    activeBurgTab = 'buildings'; // beim Öffnen immer mit Gebäude-Tab starten
    dom.overlay.classList.remove('struct-mode');
    dom.overlay.style.display = 'flex';
    dom.overlay.style.top = dom.topbar.offsetHeight + 'px'; // Topbar (Ressourcen) sichtbar lassen
    updateVillageSelect();
    renderVillageView();
  }
  // Eigene Struktur im selben Overlay verwalten (analog zur Burgansicht).
  function openStructure(id) {
    var s = G.findStructureById(state, id);
    if (!s || s.ownerHouseId !== state.playerHouseId) { toast('Nur eigene Strukturen können verwaltet werden.'); return; }
    activeStructureId = id;
    selectedStructureId = id;     // hält Seiten-Selektion synchron
    overlayMode = 'structure';
    overlayOpen = true;
    dom.overlay.classList.add('struct-mode');
    dom.overlay.style.display = 'flex';
    dom.overlay.style.top = dom.topbar.offsetHeight + 'px';
    renderStructureView();
  }
  function closeVillage() {
    overlayOpen = false;
    overlayMode = 'village';
    dom.overlay.classList.remove('struct-mode');
    dom.overlay.style.display = 'none';
  }
  // Overlay-Inhalt je nach Modus rendern.
  function renderOverlay() {
    if (overlayMode === 'structure') renderStructureView();
    else renderVillageView();
  }

  // ---------------------------------------------------------------------
  // Kampfbericht-Overlay
  // ---------------------------------------------------------------------
  function closeBattle() {
    reportOpen = false;
    dom.battleOverlay.style.display = 'none';
    // Schritt 10b: Pause aufheben
    if (state) state._reportPaused = false;
  }

  function battleSideHtml(label, house, villageName, units, surv, loss, power, sym) {
    var sig = house ? house.sigil : null;
    var crest = '<span class="crest sm" style="background:' + crestBg(sig) + '"></span>';
    var rows = '';
    C.UNIT_ORDER.forEach(function (k) {
      var o = units[k] || 0; if (!o) return;
      var s = surv[k] || 0, l = loss[k] || 0;
      rows += '<div class="brow"><canvas class="unit-ico" width="24" height="30" data-unit="' + k + '"></canvas>' +
        '<span class="bn">' + C.UNITS[k].name + '</span>' +
        '<span class="bc">' + o + ' → ' + s + (l > 0 ? ' <span class="bad">(−' + l + ')</span>' : '') + '</span></div>';
    });
    if (!rows) rows = '<div class="brow muted">— keine —</div>';
    return '<div class="battle-side"><h3>' + sym + ' ' + label + '</h3>' +
      '<div class="bside-head">' + crest + ' ' + (house ? house.name : '?') +
      '<br><small>' + villageName + '</small></div>' + rows +
      '<div class="bpow">Stärke: ' + fmt(power) + '</div></div>';
  }

  function showBattleReport(res) {
    reportOpen = true;
    var role = res.playerRole, aWin = res.attackerWins, cls, txt;
    var isStruct = res.targetKind === 'structure';
    if (role === 'defender') {
      if (aWin) {
        cls = 'bad';
        if (isStruct) txt = res.captured ? 'Deine Struktur wurde EROBERT!' : 'Deine Struktur wurde geplündert!';
        else          txt = res.captured ? 'Deine Burg wurde EROBERT!'     : 'Deine Burg wurde geplündert!';
      } else {
        cls = 'good';
        txt = isStruct ? 'Strukturen-Verteidigung gehalten!' : 'Angriff abgewehrt!';
      }
    } else {
      if (aWin) {
        cls = 'good';
        if (isStruct) {
          if (res.captured) txt = 'Struktur EROBERT!';
          else if (res.loot && C.RESOURCES.some(function (r) { return res.loot[r] > 0; })) txt = 'Sammelaktion erfolgreich – Beute erbeutet!';
          else txt = 'Sammelaktion erfolgreich – Lager war leer.';
        } else {
          txt = res.captured ? 'Burg EROBERT!' : 'Sieg – Beute erobert!';
        }
      } else {
        cls = 'bad'; txt = 'Niederlage – Armee verloren.';
      }
    }
    var titlePrefix = isStruct
      ? (res.action === 'capture' ? 'Eroberungs-Versuch: ' : 'Sammelaktion: ')
      : 'Kampfbericht: ';
    dom.battleTitle.textContent = titlePrefix + (res.attackerHouse ? res.attackerHouse.surname : '?') + ' → ' + res.toName;
    var html = '<div class="battle-banner ' + cls + '">' + txt + '</div>';
    html += '<div class="battle-meta">Glück ' + (res.luck >= 0 ? '+' : '') + Math.round(res.luck * 100) +
      '% · Moral ' + Math.round(res.morale * 100) + '%</div>';
    html += '<div class="battle-grid">';
    html += battleSideHtml('Angreifer', res.attackerHouse, res.fromName, res.attackerUnits,
      res.attackerSurvivors, res.attackerLosses, res.attackPower, '⚔');
    html += battleSideHtml('Verteidiger', res.defenderHouse, res.toName, res.defenderUnits,
      res.defenderSurvivors, res.defenderLosses, res.defensePower, '⛨');
    html += '</div>';
    // Schritt 6.5: Belagerungs-Block (vor Verteidigungs-Aufschluesselung)
    if (res.siegeResult) {
      var sg = res.siegeResult;
      var parts = [];
      if (sg.wallDamage > 0) {
        var wTransition = (sg.wallLevelAfter !== sg.wallLevelBefore)
          ? (' (Stufe ' + sg.wallLevelBefore + ' → ' + sg.wallLevelAfter + ')')
          : ' (Stufe hält)';
        parts.push('Palisade −' + fmt(sg.wallDamage) + ' HP' + wTransition);
      }
      if (sg.towerDamage > 0) {
        var tTransition = (sg.towerLevelAfter !== sg.towerLevelBefore)
          ? (' (Stufe ' + sg.towerLevelBefore + ' → ' + sg.towerLevelAfter + ')')
          : ' (Stufe hält)';
        parts.push('Turm −' + fmt(sg.towerDamage) + ' HP' + tTransition);
      }
      if (res.wallSuppression && res.wallSuppression > 0) {
        parts.push('Bogen-Suppression −' + Math.round(res.wallSuppression * 100) + '% wallMult');
      }
      if (parts.length) html += '<div class="battle-siege"><b>Belagerung:</b> ' + parts.join(' · ') + '</div>';
    }
    // Verteidigungs-Aufschlüsselung: Einheiten / Palisade / Turm / Held
    var bd = res.defBreakdown;
    if (bd) {
      var parts2 = ['Einheiten ' + fmt(bd.units)];
      parts2.push('Palisade (St. ' + (res.defWallLevel || 0) + ') +' + fmt(bd.wall));
      parts2.push('Turm (St. ' + (res.defTowerLevel || 0) + ') +' + fmt(bd.tower));
      if (bd.hero > 0) parts2.push('davon Held +' + fmt(bd.hero));
      html += '<div class="battle-breakdown"><b>Verteidigung:</b> ' + parts2.join(' · ') + '</div>';
    }
    if (res.loot && C.RESOURCES.some(function (r) { return res.loot[r] > 0; })) {
      html += '<div class="battle-loot"><b>Beute:</b> ' + C.RESOURCES.filter(function (r) { return res.loot[r] > 0; })
        .map(function (r) { return '<span class="costtag">' + resIcoTag(r, 22) + Math.round(res.loot[r]) + '</span>'; }).join(' ') + '</div>';
    }
    // Schritt 10b: Toggle „Zeit beim Bericht anhalten"
    var pauseChecked = state.pauseOnReport ? 'checked' : '';
    html += '<label class="battle-pause-toggle"><input type="checkbox" class="pause-on-report" ' + pauseChecked + '> ' +
      'Zeit beim Kampfbericht anhalten</label>';
    html += '<button class="btn full battle-ok">Schließen</button>';
    dom.battleBody.innerHTML = html;
    paintResIcons(dom.battleBody);
    paintUnitIcons(dom.battleBody, 3, 0, 4);
    var okb = dom.battleBody.querySelector('.battle-ok');
    if (okb) okb.addEventListener('click', closeBattle);
    // Schritt 10b: Toggle „Zeit anhalten" — Preference im state speichern.
    // Aenderungen wirken sofort: wenn deaktiviert, wird _reportPaused
    // sofort geloest, der Tick laeuft trotz geoeffnetem Bericht weiter.
    var pcb = dom.battleBody.querySelector('.pause-on-report');
    if (pcb) pcb.addEventListener('change', function () {
      state.pauseOnReport = pcb.checked;
      state._reportPaused = state.pauseOnReport;  // reagiert sofort waehrend offenem Bericht
      api.requestSave();
    });
    // Pause bei Anzeige aktivieren, falls Toggle aktiv
    state._reportPaused = !!state.pauseOnReport;
    dom.battleOverlay.style.display = 'flex';
    dom.battleOverlay.style.top = dom.topbar.offsetHeight + 'px';
  }

  // ---------------------------------------------------------------------
  // Panels: Dorfansicht + Sidebar
  // ---------------------------------------------------------------------
  function refreshPanels() {
    if (!state) return;
    updateVillageSelect();
    if (overlayOpen) renderOverlay();
    renderSidebar();
  }
  // leichtgewichtige Aktualisierung (Queues, Beträge).
  // Der jeweils fokussierte Bereich wird NICHT neu aufgebaut, sonst würden
  // Eingabefelder (z. B. Ausbildungsmenge) beim Tippen zurückgesetzt.
  function refreshDynamic() {
    var ae = document.activeElement;
    var inBody = ae && dom.villageBody && dom.villageBody.contains(ae);
    var inSide = ae && dom.sideTop && dom.sideTop.contains(ae);
    if (overlayOpen && !inBody) renderOverlay();
    if (!inSide) renderSideTop();      // Bewegungen/Ziel laufend aktualisieren
    renderSideLog();                   // Chronik nur bei Änderung (kein Flackern)
  }

  function updateVillageSelect() {
    var sel = $('vill-select'); if (!sel) return;
    var own = G.villagesOfHouse(state, state.playerHouseId);
    sel.innerHTML = '';
    own.forEach(function (v) {
      var o = el('option', null, v.name + villageTag(v));
      o.value = v.id; if (v.id === activeVillageId) o.selected = true;
      sel.appendChild(o);
    });
  }

  function renderVillageView() {
    var v = activeVillage();
    if (!v) { dom.villageBody.innerHTML = '<p class="empty">Keine eigene Burg mehr. Das Spiel ist verloren.</p>'; return; }
    var house = state.houses[v.houseId];
    dom.overlayTitle.innerHTML = '<span class="crest sm" style="background:' + crestBg(house.sigil) + '"></span> ' +
      v.name + villageTag(v) + ' — ' + house.name + ' · Treue ' + Math.round(v.loyalty) + '%';
    var html = '';
    // Tab-Header — nur auf schmalen Viewports sichtbar (via CSS gesteuert).
    // Auf Desktop bleibt er ausgeblendet und beide Spalten sind nebeneinander sichtbar.
    html += '<nav class="burg-tabs" role="tablist" aria-label="Burgansicht">';
    html += '<button class="burg-tab' + (activeBurgTab === 'buildings' ? ' active' : '') +
      '" data-burg-tab="buildings" role="tab" aria-selected="' + (activeBurgTab === 'buildings') + '">Gebäude</button>';
    html += '<button class="burg-tab' + (activeBurgTab === 'military' ? ' active' : '') +
      '" data-burg-tab="military" role="tab" aria-selected="' + (activeBurgTab === 'military') + '">Militär</button>';
    html += '</nav>';
    html += '<div class="vv-grid" data-burg-tab="' + activeBurgTab + '">';
    // Gebäude-Spalte: Bau-Warteschlange LINKS neben dem Gebäude-Grid
    html += '<div class="vv-col vv-col-buildings"><h2>Gebäude</h2>';
    html += '<div class="bld-area">';
    html += '<div class="queue-col">' + buildQueueListHtml(v) + '</div>';
    html += '<div class="bld-grid">';
    Object.keys(C.BUILDINGS).forEach(function (key) { html += buildingCardHtml(v, key); });
    html += '</div>';
    html += '</div>';
    html += '</div>';
    // Militär-Spalte: Trainings-Warteschlange RECHTS neben dem Kaserne-HUD
    html += '<div class="vv-col vv-col-military"><h2>Kaserne &amp; Verteidigung</h2>';
    html += militaryHtml(v);
    html += '</div>';
    html += '</div>';
    dom.villageBody.innerHTML = html;
    attachVillageEvents(v);
  }

  // Overlay-Ansicht für eine eigene Struktur (analog zur Burgansicht).
  function renderStructureView() {
    var s = G.findStructureById(state, activeStructureId);
    if (!s || s.ownerHouseId !== state.playerHouseId) { overlayMode = 'village'; renderVillageView(); return; }
    var meta = structureMeta(s);
    var lvl = s.level || 1;
    var house = state.houses[s.ownerHouseId];
    var resKey = meta.res;
    var prod = C.RESOURCE_STRUCTURE_LEVELS.production[lvl - 1] || 0;
    var castle = state.villages[s.assignedCastleId];
    dom.overlayTitle.innerHTML = (house ? '<span class="crest sm" style="background:' + crestBg(house.sigil) + '"></span> ' : '') +
      meta.name + ' (Stufe ' + lvl + ') — eigene Struktur · Pos. ' + s.x + ',' + s.y;
    var sfort = WOH.Combat.structureFortLevel(s);
    var ownCastles = G.villagesOfHouse(state, state.playerHouseId);

    // Zweispaltig: links Verwaltung (Info+Heimatburg, Ausbau, Garnison),
    // rechts Verstärkung anfordern — wie bei Burgen.
    var html = '<div class="struct-grid">';
    html += '<div class="struct-main">';

    // Info-Box (inkl. Heimatburg-Auswahl oben).
    html += '<div class="def-box">';
    if (ownCastles.length > 1) {
      html += '<div class="home-row">Heimatburg: ' +
        '<select class="home-select">' +
        ownCastles.map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === s.assignedCastleId ? ' selected' : '') + '>' +
            c.name + villageTag(c) + '</option>';
        }).join('') + '</select> <button class="btn xs home-apply">Ändern</button></div>';
    } else {
      html += 'Heimatburg: <b>' + (castle ? castle.name + villageTag(castle) : '?') + '</b><br>';
    }
    html += 'Produktion fließt direkt in das Burg-Lager (+' + (prod * C.TIME_SCALE).toFixed(0) +
      ' ' + C.RESOURCE_META[resKey].name + '/s)<br>';
    html += 'Bevölkerungs-Bonus: +' + (C.STRUCTURE_POP_BONUS[lvl] || 0);
    if (sfort > 0) html += '<br>Befestigung: Palisade ' + sfort + ' · Turm ' + sfort;
    html += '</div>';

    html += structureUpgradeHtml(s, castle);
    html += structureGarrisonHtml(s, castle);
    html += '</div>'; // .struct-main

    // Rechte Spalte: Verstärkung anfordern.
    html += '<div class="struct-side">' + supportPickerHtml(s, 'structure') + '</div>';
    html += '</div>'; // .struct-grid

    dom.villageBody.innerHTML = html;
    attachStructureEvents(dom.villageBody);
  }

  // Bau-Warteschlange als vertikale Listendarstellung. Ein Eintrag pro
  // Auftrag: Gebäudename als Zeile 1, Stufe und Restzeit als Zeile 2.
  function buildQueueListHtml(v) {
    var html = '<div class="queue-list"><h3>Bau-Warteschlange</h3>';
    if (!v.buildQueue || !v.buildQueue.length) {
      html += '<div class="queue-empty">— leer —</div>';
    } else {
      v.buildQueue.forEach(function (q, idx) {
        var name = (C.BUILDINGS[q.key] && C.BUILDINGS[q.key].name) || q.key;
        html += '<div class="queue-item' + (idx === 0 ? ' active' : '') + '">' +
          '<button class="qi-cancel" data-cancel="build" data-idx="' + idx + '" title="Abbrechen — 50% Rohstoffe zurück">✕</button>' +
          '<div class="qi-name">' + name + '</div>' +
          '<div class="qi-meta">→ Stufe ' + q.target + ' · ' + fmtTime(q.timeLeft) + '</div>' +
          '</div>';
      });
    }
    html += '</div>';
    return html;
  }

  // Trainings-Warteschlange analog (rechts neben Kaserne-HUD).
  function trainQueueListHtml(v) {
    var html = '<div class="queue-list"><h3>Ausbildungs-Warteschlange</h3>';
    if (!v.trainingQueue || !v.trainingQueue.length) {
      html += '<div class="queue-empty">— leer —</div>';
    } else {
      v.trainingQueue.forEach(function (q, idx) {
        var name = (C.UNITS[q.unit] && C.UNITS[q.unit].name) || q.unit;
        html += '<div class="queue-item' + (idx === 0 ? ' active' : '') + '">' +
          '<button class="qi-cancel" data-cancel="train" data-idx="' + idx + '" title="Abbrechen — 50% Rohstoffe zurück">✕</button>' +
          '<div class="qi-name">' + name + '</div>' +
          '<div class="qi-meta">× ' + q.remaining + ' · ' + fmtTime(q.timeLeft) + '</div>' +
          '</div>';
      });
    }
    html += '</div>';
    return html;
  }

  function buildingCardHtml(v, key) {
    var b = C.BUILDINGS[key];
    var lvl = v.buildings[key] || 0;
    var queued = v.buildQueue.filter(function (q) { return q.key === key; }).length;
    var target = lvl + queued + 1;
    var maxed = target > b.max;
    var cost = V.buildingCost(key, target - 1);
    var unmet = maxed ? [] : V.unmetRequirements(v, key, target);
    var ok = !maxed && unmet.length === 0 && V.canAfford(v, cost);
    var reqTxt = unmet.length ? '<div class="req">Benötigt für Stufe ' + target + ': ' + unmet.join(', ') + '</div>' : '';
    var costStr = C.RESOURCES.filter(function (r) { return cost[r] > 0; }).map(function (r) {
      var lack = v.resources[r] < cost[r];
      return '<span class="costtag ' + (lack ? 'lack' : '') + '">' +
        resIcoTag(r, 26) + fmt(cost[r]) + '</span>';
    }).join(' ');
    var prodTxt = '';
    if (b.produces) {
      var rate = ((C.PRODUCTION.base || 0) + lvl * (b.perLevel || 0)) * (v.bonus[b.produces] || 1) * C.TIME_SCALE;
      prodTxt = '<div class="prod">+' + rate.toFixed(1) + ' ' + C.RESOURCE_META[b.produces].name + '/s</div>';
    }
    var active = v.buildQueue.length && v.buildQueue[0].key === key;
    var html = '<div class="bld-card' + (active ? ' updating' : '') + '">';
    html += '<div class="bld-top"><canvas class="bld-ico" width="40" height="40" data-bld="' + key + '"></canvas>';
    html += '<div class="bld-meta"><span class="bld-name unit-name" data-binfo="' + key + '" tabindex="0"><b>' + b.name + '</b></span>' +
      '<span class="lvl">Stufe ' + lvl + (maxed ? ' · max' : '') + '</span></div></div>';
    // Schritt 6.5: HP-Leiste fuer Wall/Tower (falls Bauwerk vorhanden)
    if ((key === 'wall' || key === 'tower') && lvl >= 1) {
      var hp  = (key === 'wall') ? V.wallHP(v) : V.towerHP(v);
      var max = (key === 'wall') ? V.wallMaxHP(lvl) : V.towerMaxHP(lvl);
      var pct = max > 0 ? Math.max(0, Math.min(100, Math.round(100 * hp / max))) : 0;
      var inRepair = (v.repairQueue || []).find ? (v.repairQueue||[]).find(function(q){return q.key===key;}) :
        (v.repairQueue || []).filter(function(q){return q.key===key;})[0];
      html += '<div class="hp-row" title="HP der ' + b.name + '">';
      html += '<div class="hp-bar"><div class="hp-fill" style="width:' + pct + '%"></div></div>';
      html += '<span class="hp-val">' + fmt(hp) + '/' + fmt(max) + '</span>';
      html += '</div>';
      if (inRepair) {
        var left = Math.max(0, inRepair.endsAt - (state.gameTime || 0));
        html += '<div class="repair-active">Reparatur läuft… (' + fmtTime(left) + ')</div>';
      } else if (hp < max) {
        var rc = V.repairCost(v, key);
        var rt = V.repairTime(v, key);
        var rcStr = C.RESOURCES.filter(function (r) { return rc[r] > 0; }).map(function (r) {
          var lack = v.resources[r] < rc[r];
          return '<span class="costtag ' + (lack ? 'lack' : '') + '">' +
            resIcoTag(r, 22) + fmt(rc[r]) + '</span>';
        }).join(' ');
        var afford = V.canAfford(v, rc);
        html += '<div class="repair-box">' + rcStr +
          '<button class="btn sm repair-btn" data-repair="' + key + '" ' + (afford ? '' : 'disabled') + '>' +
          'Reparieren <small>' + fmtTime(rt) + '</small></button></div>';
      }
    }
    html += prodTxt + reqTxt;
    if (!maxed) {
      html += '<div class="bld-cost">' + costStr + '</div>';
      html += '<button class="btn sm build-btn" data-build="' + key + '" ' + (ok ? '' : 'disabled') + '>' +
        'Ausbauen →' + target + ' <small>' + fmtTime(V.buildTime(v, key, target - 1)) + '</small></button>';
    }
    html += '</div>';
    return html;
  }

  // Aufschlüsselung der Verteidigungskraft einer Burg + Wirkung auf einen
  // Angriff. Spiegelt exakt WOH.Combat.defensePower/resolve wider:
  //   Gesamt = (Einheiten-Vert. + Turm-Bonus) × Palisade-Faktor + Grundwert.
  // Ein Angriff gewinnt, wenn Angriffskraft × (1 ± Glück) × Moral > Gesamt.
  function defenseInfoHtml(v) {
    var CB = C.COMBAT;
    var wl = v.buildings.wall || 0, tl = v.buildings.tower || 0;
    var unitRaw = 0, archerRaw = 0;
    for (var k in v.units) {
      var u = C.UNITS[k]; if (!u) continue;
      unitRaw += (v.units[k] || 0) * u.defI;
      if (k === 'archer') archerRaw += (v.units[k] || 0) * u.defI;
    }
    var towerBonus = archerRaw * tl * CB.towerArcherBonus;
    var wallMult = 1 + wl * CB.wallDefPerLevel;
    var wallFlat = CB.baseVillageDef + wl * CB.wallBaseDef;
    var total = (unitRaw + towerBonus) * wallMult + wallFlat;

    var luck = CB.luckRange || 0;
    var needWorst = total / (1 - luck); // Verteidiger-Glück max → Angreifer braucht mehr
    var needBest  = total / (1 + luck); // Angreifer-Glück max → weniger nötig

    var pad = '&nbsp;&nbsp;';
    var h = '<div class="def-box">';
    h += '<b>Verteidigungskraft: ' + fmt(Math.round(total)) + '</b>' +
         ' <span class="muted">(Palisade ' + wl + ' · Turm ' + tl + ')</span>';
    h += '<div class="def-breakdown">';
    h += '<div>' + pad + 'Einheiten (Σ Verteidigung): <span>' + fmt(Math.round(unitRaw)) + '</span></div>';
    if (towerBonus > 0) {
      h += '<div>' + pad + '+ Turm verstärkt Bogenschützen: <span>+' + fmt(Math.round(towerBonus)) +
           '</span> <span class="muted">(+' + Math.round(CB.towerArcherBonus * 100) + '%/Turmstufe)</span></div>';
    }
    h += '<div>' + pad + '× Palisaden-Faktor: <span>×' + wallMult.toFixed(2) +
         '</span> <span class="muted">(+' + Math.round(CB.wallDefPerLevel * 100) + '%/Stufe)</span></div>';
    h += '<div>' + pad + '+ Grundverteidigung: <span>+' + fmt(Math.round(wallFlat)) +
         '</span> <span class="muted">(Sockel ' + CB.baseVillageDef + ' + ' + CB.wallBaseDef + '/Palisadenstufe)</span></div>';
    h += '<div class="def-total">' + pad + '= Gesamt: <span>' + fmt(Math.round(total)) + '</span></div>';
    h += '</div>';

    // Wirkung auf einen Angriff
    h += '<div class="def-effect"><b>Wirkung auf einen Angriff</b>';
    h += '<div>' + pad + 'Ein Trupp gewinnt, wenn seine <i>Angriffskraft × Glück (±' +
         Math.round(luck * 100) + '%) × Moral</i> die Verteidigungskraft übersteigt.</div>';
    h += '<div>' + pad + 'Nötige Angriffskraft: <span class="good">' + fmt(Math.round(needBest)) +
         '</span> – <span class="bad">' + fmt(Math.round(needWorst)) + '</span>' +
         ' <span class="muted">(je nach Glück; im Mittel ' + fmt(Math.round(total)) + ')</span></div>';
    var supPer = C.SIEGE ? (C.SIEGE.wallSuppressionPerArcher * 100).toFixed(1) : '0.3';
    var supMax = C.SIEGE ? Math.round(C.SIEGE.wallSuppressionMax * 100) : 50;
    h += '<div>' + pad + '<span class="muted">Bogenschützen des Angreifers senken den Palisaden-Faktor ' +
         '(−' + supPer + '%/Bogen, max −' + supMax + '%); Axtkämpfer (Angr. ' + C.UNITS.axe.atk +
         ') sind am wirksamsten.</span></div>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  // Hover-Info-Popup für einen Kriegertyp: vollständige Werte + Rollenhinweise.
  function unitTooltipHtml(key) {
    var u = C.UNITS[key]; if (!u) return '';
    var roleLabel = u.role === 'off' ? 'Offensive' : (u.role === 'hero' ? 'Held' : 'Defensiv');
    var roleCls = u.role === 'off' ? 'off' : (u.role === 'hero' ? 'hero' : 'def');
    var costStr = C.RESOURCES.filter(function (r) { return (u.cost[r] || 0) > 0; })
      .map(function (r) { return C.RESOURCE_META[r].name + ' ' + fmt(u.cost[r]); }).join(' · ');
    // Belagerungswerte (Schaden je Stück an Mauer/Turm)
    var sw = (C.SIEGE && C.SIEGE.unitSiegeWall) ? (C.SIEGE.unitSiegeWall[key] || 0) : 0;
    var stw = (C.SIEGE && C.SIEGE.unitSiegeTower) ? (C.SIEGE.unitSiegeTower[key] || 0) : 0;

    function row(label, val) { return '<span><i>' + label + ':</i> ' + val + '</span>'; }
    var stats = '';
    stats += row('Angriff', u.atk);
    stats += row('Vert. Infanterie', u.defI);
    stats += row('Vert. Beschuss', u.defA);
    stats += row('Tempo', u.speed + ' Sek/Feld');
    stats += row('Bevölkerung', u.pop);
    stats += row('Nahrung', (u.foodUpkeep || 0).toFixed(2) + '/s');
    stats += row('Tragkapazität', (u.carry || 0) + (u.carry ? '' : ' (keine Beute)'));
    var vv = activeVillage();
    var eff = vv ? V.trainTimeFor(vv, key) : u.trainTime;
    stats += row('Ausbildung', fmtTime(eff) +
      (eff < u.trainTime ? ' <span class="muted">(Basis ' + fmtTime(u.trainTime) + ')</span>' : ''));
    if (sw || stw) stats += row('Belagerung M/T', sw + ' / ' + stw);

    // Rollenspezifische Hinweise
    var note = '';
    if (key === 'spear') note = 'Günstiger Allrounder. Höchste Tragkapazität — ideal zum Sammeln/Beute holen.';
    else if (key === 'sword') note = 'Harter Standverteidiger, sehr stark gegen Infanterie, aber langsam.';
    else if (key === 'axe') note = 'Reine Angriffseinheit. Höchste Belagerungswirkung gegen Mauern.';
    else if (key === 'archer') note = 'Defensiv stark; im Wachturm +' + Math.round(C.COMBAT.towerArcherBonus * 100) +
      '%/Stufe. Als Angreifer senken Bogen den Palisaden-Faktor (Belagerung).';
    else if (key === 'hero') note = 'Max. 1 pro Burg. Ermöglicht die Eroberung einer Burg/Struktur (wird dabei verbraucht). ' +
      'Verteidigt mit der Kraft von ~20 Schwertkämpfern.';

    var h = '';
    h += '<div class="ut-head"><b>' + u.name + '</b> <span class="ut-role ' + roleCls + '">' + roleLabel + '</span></div>';
    h += '<div class="ut-desc">' + (u.desc || '') + '</div>';
    h += '<div class="ut-stats">' + stats + '</div>';
    h += '<div class="ut-cost"><i>Kosten:</i> ' + costStr + '</div>';
    if (note) h += '<div class="ut-note">' + note + '</div>';
    return h;
  }

  // Hover-Info-Popup für ein Gebäude: Funktion, Werte und nächste Stufe.
  function buildingTooltipHtml(key, v) {
    var b = C.BUILDINGS[key]; if (!b) return '';
    var lvl = v.buildings[key] || 0;
    var maxed = lvl >= b.max;
    var cat, catCls;
    if (b.produces) { cat = 'Wirtschaft'; catCls = 'def'; }
    else if (key === 'barracks' || key === 'range') { cat = 'Militär'; catCls = 'off'; }
    else if (key === 'wall' || key === 'tower') { cat = 'Verteidigung'; catCls = 'def'; }
    else if (key === 'warehouse') { cat = 'Lager'; catCls = 'def'; }
    else { cat = 'Verwaltung'; catCls = 'hero'; }

    function row(l, val) { return '<span><i>' + l + ':</i> ' + val + '</span>'; }
    var stats = '';
    stats += row('Stufe', lvl + ' / ' + b.max);
    if (b.produces) {
      var bonus = (v.bonus[b.produces] || 1);
      var cur = lvl * (b.perLevel || 0) * bonus;
      var nxt = (lvl + 1) * (b.perLevel || 0) * bonus;
      stats += row('Produktion', '+' + (b.perLevel || 0) + ' ' + C.RESOURCE_META[b.produces].name + '/Stufe');
      stats += row('Standortbonus', '×' + bonus.toFixed(2));
      stats += row('Aktuell', '+' + cur.toFixed(1) + '/s' + (maxed ? '' : ' → ' + nxt.toFixed(1) + '/s'));
    }
    if (key === 'townhall') stats += row('Bevölkerung', '+' + C.POPULATION.perTownhallLevel + '/Stufe (Hauptquelle)');
    if (key === 'farm') stats += row('Bev.-Kapazität', '+' + C.POPULATION.perFarmLevel + '/Stufe');
    if (typeof b.popPerLevel === 'number' && b.popPerLevel > 0) stats += row('Arbeiter', b.popPerLevel + '/Stufe');
    if (key === 'barracks' || key === 'range') {
      stats += row('Ausbildungstempo', (lvl > 0 ? '−' + (lvl * 10) + '% ' : '') + '<span class="muted">(−10%/Stufe, außer Held)</span>');
    }
    if (key === 'warehouse') {
      var capNow = Math.round(C.STORAGE.baseCap * Math.pow(C.STORAGE.perLevel, lvl));
      var capNext = Math.round(C.STORAGE.baseCap * Math.pow(C.STORAGE.perLevel, lvl + 1));
      stats += row('Lagerkapazität', fmt(capNow) + (maxed ? '' : ' → ' + fmt(capNext)));
    }
    if (key === 'wall') {
      stats += row('Grundvert.', '+' + C.COMBAT.wallBaseDef + '/Stufe');
      stats += row('Vert.-Faktor', '+' + Math.round(C.COMBAT.wallDefPerLevel * 100) + '%/Stufe');
      if (lvl >= 1) stats += row('HP', fmt(V.wallHP(v)) + '/' + fmt(V.wallMaxHP(lvl)));
    }
    if (key === 'tower') {
      stats += row('Bogen-Bonus', '+' + Math.round(C.COMBAT.towerArcherBonus * 100) + '%/Stufe');
      if (lvl >= 1) stats += row('HP', fmt(V.towerHP(v)) + '/' + fmt(V.towerMaxHP(lvl)));
    }

    var h = '';
    h += '<div class="ut-head"><b>' + b.name + '</b> <span class="ut-role ' + catCls + '">' + cat + '</span></div>';
    h += '<div class="ut-desc">' + (b.desc || '') + '</div>';
    h += '<div class="ut-stats">' + stats + '</div>';
    if (!maxed) {
      var target = lvl + v.buildQueue.filter(function (q) { return q.key === key; }).length + 1;
      if (target <= b.max) {
        var cost = V.buildingCost(key, target - 1);
        var costStr = C.RESOURCES.filter(function (r) { return cost[r] > 0; })
          .map(function (r) { return C.RESOURCE_META[r].name + ' ' + fmt(cost[r]); }).join(' · ');
        h += '<div class="ut-cost"><i>Nächste Stufe (' + target + '):</i> ' + costStr + ' · ' + fmtTime(V.buildTime(v, key, target - 1)) + '</div>';
        var unmet = V.unmetRequirements(v, key, target);
        if (unmet.length) h += '<div class="ut-note">Voraussetzung: ' + unmet.join(', ') + '</div>';
      }
    } else {
      h += '<div class="ut-note">Maximalstufe erreicht.</div>';
    }
    return h;
  }

  // Gemeinsames, body-weit fixiertes Info-Popup (umgeht overflow-Clipping).
  var _unitTipEl = null;
  function ensureUnitTip() {
    if (!_unitTipEl) { _unitTipEl = el('div'); _unitTipEl.id = 'unit-tip-pop'; document.body.appendChild(_unitTipEl); }
    return _unitTipEl;
  }
  function placeUnitTip(x, y) {
    var t = _unitTipEl; if (!t) return;
    var w = t.offsetWidth, h = t.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (x + w + 10 > vw) x = vw - w - 10;
    if (y + h + 10 > vh) y = vh - h - 10;
    if (x < 8) x = 8; if (y < 8) y = 8;
    t.style.left = Math.round(x) + 'px'; t.style.top = Math.round(y) + 'px';
  }
  // Generisches Anzeigen: beliebiger HTML-Inhalt, fest unter dem Anker.
  function showInfoTip(html, anchor) {
    var t = ensureUnitTip();
    t.innerHTML = html;
    t.style.display = 'block';
    var r = anchor.getBoundingClientRect();
    placeUnitTip(r.left, r.bottom + 6);
  }
  function showUnitTip(key, anchor) { showInfoTip(unitTooltipHtml(key), anchor); }
  function hideUnitTip() { if (_unitTipEl) _unitTipEl.style.display = 'none'; }

  function militaryHtml(v) {
    var html = '';
    // Mil-Area zuerst: Kaserne-Tabelle links, Trainings-Warteschlange rechts.
    html += '<div class="mil-area">';
    html += '<div class="unit-table-wrap">';
    html += '<table class="unit-table"><thead><tr><th></th><th>Einheit</th><th>Angr.</th><th>Vert.</th><th>Tempo</th><th>Anzahl</th><th>Ausbilden</th></tr></thead><tbody>';
    C.UNIT_ORDER.forEach(function (key) {
      var u = C.UNITS[key];
      var avail = key === 'archer' ? (v.buildings.range || 0) >= 1 : (v.buildings.barracks || 0) >= 1;
      var costStr = C.RESOURCES.filter(function (r) { return u.cost[r] > 0; }).map(function (r) {
        return '<span class="costtag">' + resIcoTag(r, 26) + fmt(u.cost[r]) + '</span>';
      }).join(' ');
      var rowCls = u.role === 'off' ? 'off' : (u.role === 'hero' ? 'hero' : 'def');
      html += '<tr class="' + rowCls + '">';
      html += '<td><canvas class="unit-ico" width="30" height="36" data-unit="' + key + '"></canvas></td>';
      html += '<td><span class="unit-name" data-uinfo="' + key + '" tabindex="0"><b>' + u.name + '</b></span>' +
        ' <span class="utime">(' + fmtTime(V.trainTimeFor(v, key)) + ')</span><br><small>' + costStr + '</small></td>';
      html += '<td>' + u.atk + '</td><td>' + u.defI + '</td><td>' + (u.speed) + '</td>';
      html += '<td class="cnt">' + fmt(v.units[key] || 0) + (u.unique ? '/1' : '') + '</td>';
      if (!avail) {
        html += '<td><small class="muted">' + (key === 'archer' ? 'Schießplatz nötig' : 'Kaserne nötig') + '</small></td>';
      } else if (u.unique) {
        var heroInQueue = (v.trainingQueue || []).some(function (q) { return q.unit === key; });
        var hasHero = (v.units[key] || 0) >= 1 || heroInQueue;
        html += '<td><button class="btn sm train-btn" data-train="' + key + '" ' + (hasHero ? 'disabled' : '') + '>' +
          (hasHero ? 'vorhanden' : 'Anwerben') + '</button></td>';
      } else {
        var tcVal = (trainCounts[key] != null ? trainCounts[key] : 5);
        html += '<td><span class="train-ctl"><input class="train-n" type="number" min="1" value="' + tcVal + '" data-unit="' + key + '">' +
          '<button class="btn sm train-btn" data-train="' + key + '">+</button></span></td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';   // .unit-table-wrap schliessen
    html += '<div class="queue-col">' + trainQueueListHtml(v) + '</div>';
    html += '</div>';   // .mil-area schliessen

    // Standortboni und Verteidigungskraft jetzt UNTER der Tabelle.
    var bonusTxt = C.RESOURCES.map(function (r) {
      var b = v.bonus[r];
      var cls = b > 1.25 ? 'good' : (b < 0.95 ? 'bad' : '');
      return '<span class="' + cls + '">' + C.RESOURCE_META[r].name + ' ×' + b.toFixed(2) + '</span>';
    }).join(' · ');
    html += '<div class="bonus-box"><b>Standortboni:</b> ' + bonusTxt + '</div>';
    html += defenseInfoHtml(v);

    html += '<p class="hint">Off-Einheiten (rot) für Angriffe, Def-Einheiten (blau) zur Verteidigung. ' +
      'Speer = günstiger Allrounder, Schwert = harter Standverteidiger, Axt = reine Offensive, Bogenschütze = stark hinter Mauern.</p>';
    return html;
  }

  function attachVillageEvents(v) {
    // Tab-Switch (Burgansicht): aktiver Tab nur via data-Attribut umschalten,
    // ohne Re-Render — flicker-frei und ohne State-Verlust in Inputs.
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('.burg-tab'), function (btn) {
      btn.addEventListener('click', function () {
        var t = btn.getAttribute('data-burg-tab');
        if (t !== 'buildings' && t !== 'military') return;
        if (activeBurgTab === t) return;
        activeBurgTab = t;
        var grid = dom.villageBody.querySelector('.vv-grid');
        if (grid) grid.setAttribute('data-burg-tab', t);
        Array.prototype.forEach.call(dom.villageBody.querySelectorAll('.burg-tab'), function (b) {
          var on = b.getAttribute('data-burg-tab') === t;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        // Inhalt aktualisieren (Counter, Queues), aber ohne Tab-Header neu zu bauen.
        // Einfachste Konsistenz: refreshPanels via renderVillageView re-rendert,
        // setzt aber activeBurgTab nicht zurueck — daher unkritisch.
        renderVillageView();
      });
    });
    // Icons zeichnen
    paintResIcons(dom.villageBody);
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('canvas[data-bld]'), function (c) {
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      S.drawBuildingIcon(ctx, 2, 2, 3, c.getAttribute('data-bld'));
    });
    paintUnitIcons(dom.villageBody, 3, 0, 4);
    // Hover-Info-Popup für Kriegernamen (fixed positioniert -> kein Clipping).
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('.unit-name[data-uinfo]'), function (nm) {
      var key = nm.getAttribute('data-uinfo');
      nm.addEventListener('mouseenter', function () { showUnitTip(key, nm); });
      nm.addEventListener('mouseleave', hideUnitTip);
      nm.addEventListener('focus', function () { showUnitTip(key, nm); });
      nm.addEventListener('blur', hideUnitTip);
    });
    // Gebäude-Namen: gleiches Info-Popup mit Gebäude-Werten.
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('.bld-name[data-binfo]'), function (nm) {
      var key = nm.getAttribute('data-binfo');
      nm.addEventListener('mouseenter', function () { showInfoTip(buildingTooltipHtml(key, v), nm); });
      nm.addEventListener('mouseleave', hideUnitTip);
      nm.addEventListener('focus', function () { showInfoTip(buildingTooltipHtml(key, v), nm); });
      nm.addEventListener('blur', hideUnitTip);
    });
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('[data-build]'), function (btn) {
      btn.addEventListener('click', function () {
        var r = G.enqueueBuild(state, v, btn.getAttribute('data-build'));
        if (!r.ok) toast(r.msg); else api.requestSave();
        renderVillageView();
      });
    });
    // Warteschlangen-Aufträge abbrechen (50 % Rohstoffe zurück).
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('[data-cancel]'), function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-cancel');
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var r = (kind === 'build') ? G.cancelBuild(state, v, idx) : G.cancelTrain(state, v, idx);
        if (!r.ok) { toast(r.msg); return; }
        api.requestSave();
        toast('Auftrag abgebrochen — 50 % der Rohstoffe erstattet.');
        renderVillageView();
      });
    });
    // Eingegebene Mengen merken, damit Aktualisierungen sie nicht zurücksetzen.
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('input.train-n'), function (inp) {
      inp.addEventListener('input', function () { trainCounts[inp.getAttribute('data-unit')] = inp.value; });
    });
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('[data-train]'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-train');
        var u = C.UNITS[key];
        var raw = (trainCounts[key] != null ? trainCounts[key] : 5);
        var n = (u && u.unique) ? 1 : Math.max(1, parseInt(raw, 10) || 1);
        var r = G.enqueueTrain(state, v, key, n);
        if (!r.ok) toast(r.msg); else api.requestSave();
        renderVillageView();
      });
    });
    // Schritt 6.5: Reparatur-Buttons
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('[data-repair]'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-repair');
        var r = G.startRepair(state, v, key);
        if (!r.ok) { toast(r.msg); return; }
        api.requestSave();
        var costStr = C.RESOURCES.filter(function (rr) { return r.cost[rr] > 0; })
          .map(function (rr) { return Math.round(r.cost[rr]) + ' ' + C.RESOURCE_META[rr].short; }).join(' / ');
        toast('Reparatur ' + C.BUILDINGS[key].name + ' begonnen — Dauer ' + fmtTime(r.time) + ', Kosten ' + costStr + '.');
        renderVillageView();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Sidebar: Ziel/Angriff, eingehende Angriffe, Log
  // ---------------------------------------------------------------------
  var lastLogSig = '';
  function ensureSidebarStructure() {
    if (!dom.sideTop || !dom.sidebar.contains(dom.sideTop)) {
      dom.sidebar.innerHTML = '<div id="side-top"></div><div id="side-log"></div>';
      dom.sideTop = $('side-top');
      dom.sideLog = $('side-log');
      lastLogSig = '';
    }
  }
  // Dynamischer Teil (Bewegungen, Ziel/Angriff) – darf häufig neu gebaut werden.
  function renderSideTop() {
    ensureSidebarStructure();
    // Wenn Struktur selektiert: Struktur-Panel statt klassischem Ziel-Panel.
    var middle = selectedStructureId ? structurePanelHtml() : targetHtml();
    dom.sideTop.innerHTML = incomingHtml() + outgoingHtml() + middle;
    attachSidebarEvents();
    if (selectedStructureId) attachStructureEvents();
  }
  // Chronik – nur neu rendern, wenn ein neues Ereignis vorliegt (kein Flackern).
  function renderSideLog(force) {
    ensureSidebarStructure();
    var top = state.log[0];
    var sig = state.log.length + ':' + (top ? top.t + '|' + top.text : '');
    if (!force && sig === lastLogSig) return;
    lastLogSig = sig;
    dom.sideLog.innerHTML = logHtml();
  }
  function renderSidebar() {
    ensureSidebarStructure();
    renderSideTop();
    renderSideLog(true);
  }

  // Hilfsfunktion: lesbarer Ziel-Name (Burg oder Struktur).
  function targetLabel(m) {
    var v = state.villages[m.toId];
    if (v) return v.name + villageTag(v);
    var s = G.findStructureById ? G.findStructureById(state, m.toId) : null;
    if (s) {
      var meta = C.RESOURCE_STRUCTURES[s.type];
      return (meta ? meta.name : s.type) + ' (' + s.x + ',' + s.y + ')';
    }
    return '—';
  }
  // Symbol + Text fuer einen Bewegungstyp.
  function movementSym(type) {
    if (type === 'attack')  return '⚔ Angriff';
    if (type === 'support') return '⛨ Hilfe';
    if (type === 'gather')  return '⛏ Sammeln';
    if (type === 'capture') return '⚑ Eroberung';
    return '↩ Rückkehr';
  }

  // Eigene Bewegungen: Angriffe/Sammeln/Eroberungen/Unterstützung sowie Rückkehrer.
  function outgoingHtml() {
    var mine = state.movements.filter(function (m) {
      return m.ownerHouseId === state.playerHouseId;
    }).sort(function (a, b) { return a.arriveTime - b.arriveTime; });
    if (!mine.length) return '';
    var html = '<div class="panel"><h3>↗ Eigene Bewegungen (' + mine.length + ')</h3>';
    mine.forEach(function (m) {
      var eta = m.arriveTime - state.gameTime;
      var sym = movementSym(m.type);
      var dest = targetLabel(m);
      var lootStr = (m.loot && C.RESOURCES.some(function (r) { return m.loot[r] > 0; }))
        ? ' · Beute: ' + C.RESOURCES.filter(function (r) { return m.loot[r] > 0; })
          .map(function (r) { return Math.round(m.loot[r]) + ' ' + C.RESOURCE_META[r].name; }).join(', ')
        : '';
      // Versorgungstross: transportierte Rohstoffe ausweisen.
      var resStr = (m.resources && C.RESOURCES.some(function (r) { return m.resources[r] > 0; }))
        ? ' · Fracht: ' + C.RESOURCES.filter(function (r) { return m.resources[r] > 0; })
          .map(function (r) { return Math.round(m.resources[r]) + ' ' + C.RESOURCE_META[r].name; }).join(', ')
        : '';
      var unitStr = WOH.Combat.totalUnits(m.units || {}) > 0 ? unitsInline(m.units) : (resStr ? 'Tross' : 'leer');
      html += '<div class="outgoing"><b>' + sym + '</b> → ' + dest + '<br>' +
        '<small>' + unitStr + lootStr + resStr + '</small><br>' +
        '<span class="eta-out">Ankunft in ' + fmtTime(eta) + '</span></div>';
    });
    html += '</div>';
    return html;
  }

  // Eingehende feindliche Bewegungen: Angriff, Sammeln, Eroberung — egal ob
  // Ziel eine eigene Burg oder eigene Struktur ist.
  function incomingHtml() {
    var ownVillages = {};
    G.villagesOfHouse(state, state.playerHouseId).forEach(function (v) { ownVillages[v.id] = v; });
    var ownStructs = {};
    (state.structures || []).forEach(function (s) {
      if (s.ownerHouseId === state.playerHouseId) ownStructs[s.id] = s;
    });
    var incoming = state.movements.filter(function (m) {
      var hostile = (m.type === 'attack' || m.type === 'gather' || m.type === 'capture');
      if (!hostile) return false;
      return ownVillages[m.toId] || ownStructs[m.toId];
    }).sort(function (a, b) { return a.arriveTime - b.arriveTime; });
    if (!incoming.length) return '<div class="panel"><h3>Eingehende Angriffe</h3><p class="muted">Keine. Das Land ist ruhig.</p></div>';
    var html = '<div class="panel danger"><h3>⚔ Eingehende Bedrohungen (' + incoming.length + ')</h3>';
    incoming.forEach(function (m) {
      var from = state.villages[m.fromId];
      var house = from ? state.houses[from.houseId] : null;
      var eta = m.arriveTime - state.gameTime;
      var sym = movementSym(m.type);
      var target = targetLabel(m);
      html += '<div class="incoming"><b>' + (house ? house.name : '?') + '</b> · ' + sym + '<br>' +
        '→ ' + target + '<br>' +
        '<span class="eta">Ankunft in ' + fmtTime(eta) + '</span></div>';
    });
    html += '</div>';
    return html;
  }

  function targetHtml() {
    var t = state.villages[targetVillageId];
    if (!t) return '<div class="panel"><h3>Ziel</h3><p class="muted">Klicke auf der Karte eine Burg oder Struktur an.</p></div>';
    var house = state.houses[t.houseId];
    var src = sourceVillage();
    var isOwn = t.houseId === state.playerHouseId;
    var dist = src ? G.distance(src, t) : 0;
    var html = '<div class="panel"><h3>Ziel: ' + t.name + villageTag(t) + '</h3>';
    html += '<div class="crestline"><span class="crest sm" style="background:' + crestBg(house.sigil) + '"></span> ' + house.name + '</div>';
    html += '<div class="muted small">Entfernung ' + dist.toFixed(1) + ' Felder · Treue ' + Math.round(t.loyalty) + '%</div>';
    if (isOwn) {
      html += '<div class="def-box small">Garnison — ' + unitsInline(t.units) + '</div>';
      // Unterstützung: Truppen und/oder Rohstoffe von einer anderen eigenen Burg/Struktur.
      html += supportPickerHtml(t, 'village');
      html += '</div>';
      return html;
    }
    if (!src) { html += '<p class="muted">Keine eigene Burg.</p></div>'; return html; }
    // Angriffsformular
    var own = G.villagesOfHouse(state, state.playerHouseId);
    if (own.length > 1) {
      own.sort(function (a, b) { return villageOrdinal(a) - villageOrdinal(b); });
      html += '<label class="send-from-row">Von: <select class="send-from">' +
        own.map(function (o) {
          return '<option value="' + o.id + '"' + (o.id === src.id ? ' selected' : '') + '>' +
            o.name + villageTag(o) + ' (' + (o.units.axe || 0) + ' Axt)</option>';
        }).join('') + '</select></label>';
    }
    html += '<div class="muted small">Garnison ' + src.name + villageTag(src) + ': ' + unitsInline(src.units) + '</div>';
    html += '<div class="send-form">';
    C.UNIT_ORDER.forEach(function (key) {
      var have = src.units[key] || 0;
      var scVal = (sendCounts[key] != null ? sendCounts[key] : 0);
      html += '<label class="send-row"><canvas class="unit-ico" width="24" height="30" data-unit="' + key + '"></canvas>' +
        C.UNITS[key].name + ' <small>(' + have + ')</small>' +
        '<input class="send-n" type="number" min="0" max="' + have + '" value="' + scVal + '" data-unit="' + key + '"></label>';
    });
    html += '<div class="send-eta muted small" id="send-eta"></div>';
    // Anti-Duplikat: wenn aus dieser Quelle bereits ein hostile Trupp zum Ziel
    // unterwegs ist, Angriffs-Button disablen mit erklaerender Beschriftung.
    var busy = G.hasOutboundMovement && G.hasOutboundMovement(state, src.id, t.id);
    var btnTitle = busy ? ' title="Trupp ist bereits unterwegs zu diesem Ziel" disabled' : '';
    var btnText = busy ? '⚔ Trupp bereits unterwegs' : '⚔ Angriff entsenden';
    html += '<button class="btn full attack-btn"' + btnTitle + '>' + btnText + '</button>';
    html += '<div class="muted small" style="margin-top:6px">Held mitschicken ⇒ Eroberung bei Sieg (Held geht verloren). Eigene Burgen unterstützt du über die Zielansicht der jeweiligen Burg.</div>';
    html += '</div></div>';
    return html;
  }

  // -----------------------------------------------------------------------
  // Strukturen-Panel (Schritt 6): Info + Aktionen abhaengig vom Besitzer.
  // -----------------------------------------------------------------------
  function selectedStructure() {
    return G.findStructureById(state, selectedStructureId);
  }
  function structureMeta(s) { return C.RESOURCE_STRUCTURES[s.type] || { name: s.type, res: 'wood' }; }
  function garrisonTotal(s) {
    var n = 0, g = s.garrison || {};
    for (var k in g) n += (g[k] || 0);
    return n;
  }

  function structurePanelHtml() {
    var s = selectedStructure();
    if (!s) return '';
    var meta = structureMeta(s);
    var lvl = s.level || 1;
    var levels = C.RESOURCE_STRUCTURE_LEVELS;
    var isOwn = s.ownerHouseId === state.playerHouseId;
    var isNeutral = !s.ownerHouseId;
    var ownerHouse = s.ownerHouseId ? state.houses[s.ownerHouseId] : null;
    var resKey = meta.res;
    var src = sourceVillage();
    var dist = src ? Math.sqrt((src.x - s.x) * (src.x - s.x) + (src.y - s.y) * (src.y - s.y)) : 0;

    // Header
    var ownerLine;
    if (isNeutral) ownerLine = '<span class="muted">neutral</span>';
    else if (isOwn) ownerLine = '<span class="good">eigene Struktur</span>';
    else ownerLine = '<span class="bad">' + (ownerHouse ? ownerHouse.name : 'fremd') + '</span>';

    var html = '<div class="panel"><h3>⌂ ' + meta.name + ' (Stufe ' + lvl + ')</h3>';
    html += '<div class="muted small">Pos. ' + s.x + ',' + s.y + ' · ' + ownerLine +
      ' · Entfernung ' + dist.toFixed(1) + ' Felder</div>';

    // Lager-Anzeige
    var cap = levels.capacity[lvl - 1] || 0;
    var prod = levels.production[lvl - 1] || 0;
    var fort = WOH.Combat.structureFortLevel(s);
    var fortLine = fort > 0 ? '<br>Befestigung: Palisade ' + fort + ' · Turm ' + fort : '';
    if (isOwn) {
      var castle = state.villages[s.assignedCastleId];
      var castleName = castle ? (castle.name + villageTag(castle)) : '?';
      html += '<div class="def-box small">';
      html += 'Heimatburg: <b>' + castleName + '</b><br>';
      html += 'Produktion fliesst direkt in das Burg-Lager (+' +
        (prod * C.TIME_SCALE).toFixed(0) + ' ' + C.RESOURCE_META[resKey].name + '/s)<br>';
      html += 'Pop-Bonus: +' + (C.STRUCTURE_POP_BONUS[lvl] || 0) + '<br>';
      html += 'Garnison: ' + garrisonTotal(s) + '/' + C.structureGarrisonCap(s.level) + ' — ' + unitsInline(s.garrison || {});
      html += fortLine;
      html += '</div>';
    } else {
      var inStore = Math.floor(s.storage && s.storage[resKey] || 0);
      html += '<div class="def-box small">';
      html += 'Lager: <b>' + fmt(inStore) + ' / ' + fmt(cap) + ' ' + C.RESOURCE_META[resKey].name + '</b><br>';
      html += 'Garnison: ' + garrisonTotal(s) + ' — ' + unitsInline(s.garrison || {});
      html += fortLine;
      html += '</div>';
    }

    // Aktionen — eigene Struktur wird im Overlay verwaltet (wie Burgen).
    if (isOwn) {
      html += '<button class="btn full struct-open">⌂ Struktur verwalten</button>';
    } else {
      html += structureAttackActionsHtml(s);
    }

    html += '</div>';
    return html;
  }

  // Aktionen fuer neutrale oder fremde Strukturen: Sammeln / Eroberung.
  function structureAttackActionsHtml(s) {
    var src = sourceVillage();
    if (!src) return '<p class="muted">Keine eigene Burg als Quelle vorhanden.</p>';
    var own = G.villagesOfHouse(state, state.playerHouseId);
    var html = '';
    if (own.length > 1) {
      own.sort(function (a, b) { return villageOrdinal(a) - villageOrdinal(b); });
      html += '<label class="send-from-row">Von: <select class="send-from">' +
        own.map(function (o) {
          return '<option value="' + o.id + '"' + (o.id === src.id ? ' selected' : '') + '>' +
            o.name + villageTag(o) + ' (Axt ' + (o.units.axe || 0) + ', Held ' + (o.units.hero || 0) + ')</option>';
        }).join('') + '</select></label>';
    }
    html += '<div class="muted small">Garnison ' + src.name + villageTag(src) + ': ' + unitsInline(src.units) + '</div>';
    html += '<div class="send-form">';
    C.UNIT_ORDER.forEach(function (key) {
      var have = src.units[key] || 0;
      var scVal = (sendCounts[key] != null ? sendCounts[key] : 0);
      html += '<label class="send-row"><canvas class="unit-ico" width="24" height="30" data-unit="' + key + '"></canvas>' +
        C.UNITS[key].name + ' <small>(' + have + ')</small>' +
        '<input class="send-n" type="number" min="0" max="' + have + '" value="' + scVal + '" data-unit="' + key + '"></label>';
    });
    html += '<div class="send-eta muted small" id="send-eta-struct"></div>';
    // Anti-Duplikat: aus derselben Quell-Burg darf nur ein hostile Trupp pro
    // Ziel-Struktur gleichzeitig laufen.
    var sBusy = G.hasOutboundMovement && G.hasOutboundMovement(state, src.id, selectedStructureId);
    var sAttr = sBusy ? ' title="Trupp ist bereits unterwegs zu diesem Ziel" disabled' : '';
    var sLabelGather = sBusy ? '⛏ Trupp bereits unterwegs' : '⛏ Sammeln (Trupp ohne Held)';
    var sLabelCapt   = sBusy ? '⚑ Trupp bereits unterwegs' : '⚑ Eroberung (Held erforderlich)';
    html += '<button class="btn full gather-btn"' + sAttr + '>' + sLabelGather + '</button>';
    html += '<button class="btn full capture-btn"' + sAttr + '>' + sLabelCapt + '</button>';
    html += '<div class="muted small" style="margin-top:6px">Sammeln raubt Rohstoffe aus dem Lager. ' +
      'Eroberung wechselt den Besitzer (Held wird verbraucht).</div>';
    html += '</div>';
    return html;
  }

  // Aktionen fuer eigene Strukturen: Upgrade / Garnison verwalten /
  // Heimatburg aendern / Unterstuetzung anfordern.
  // Ausbau-Panel: Kosten-Info links, Button rechtsbündig.
  function structureUpgradeHtml(s, castle) {
    var lvl = s.level || 1;
    var levels = C.RESOURCE_STRUCTURE_LEVELS;
    var html = '<div class="struct-panel"><div class="sp-head">Ausbau</div>';
    var inUpgrade = Array.isArray(s.upgradeQueue) && s.upgradeQueue.length > 0;
    if (inUpgrade) {
      var q = s.upgradeQueue[0];
      var left = Math.max(0, q.endsAt - (state.gameTime || 0));
      html += '<div class="muted small">Ausbau auf Stufe ' + q.targetLevel + ' läuft — Restzeit ' + fmtTime(left) + '</div>';
    } else if (lvl < 3) {
      var cost = levels.upgradeCost[lvl - 1];
      var costStr = C.RESOURCES.filter(function (r) { return cost[r] > 0; }).map(function (r) {
        var lack = castle && castle.resources[r] < cost[r];
        return '<span class="costtag ' + (lack ? 'lack' : '') + '">' + resIcoTag(r, 22) + fmt(cost[r]) + '</span>';
      }).join(' ');
      var afford = castle && C.RESOURCES.every(function (r) { return (castle.resources[r] || 0) >= (cost[r] || 0); });
      html += '<div class="sp-row">';
      html += '<div class="sp-info"><b>Stufe ' + lvl + ' → ' + (lvl + 1) + '</b><div class="sp-cost">' + costStr + '</div>' +
        '<small>' + fmtTime(levels.upgradeTime[lvl - 1]) + ' Bauzeit · zahlt aus ' + (castle ? castle.name + villageTag(castle) : '?') + '</small></div>';
      html += '<button class="btn upgrade-btn" ' + (afford ? '' : 'disabled') + '>Ausbauen</button>';
      html += '</div>';
    } else {
      html += '<div class="muted small">Maximale Stufe erreicht.</div>';
    }
    html += '</div>';
    return html;
  }

  // Garnison-Panel: pro Einheit ein Schieberegler, der das Verhältnis
  // Burg ⇄ Garnison festlegt. "Übernehmen" verschiebt die Differenz
  // (mit Marschzeit) — gleichzeitig hin und zurück möglich.
  function structureGarrisonHtml(s, castle) {
    var cap = C.structureGarrisonCap(s.level);
    var html = '<div class="struct-panel" data-garrcap="' + cap + '"><div class="sp-head">Garnison <small class="muted">(max. ' +
      cap + ' · Stufe ' + (s.level || 1) + ')</small></div>';
    if (!castle) {
      html += '<div class="muted small">Keine Heimatburg — Garnison nicht verwaltbar.</div></div>';
      return html;
    }
    var any = false, curSum = 0;
    html += '<div class="garr-sliders">';
    ['spear', 'sword', 'axe', 'archer'].forEach(function (k) {
      var inCastle = castle.units[k] || 0;
      var inGarr = (s.garrison && s.garrison[k]) || 0;
      var total = inCastle + inGarr;
      if (total > 0) any = true;
      curSum += inGarr;
      html += '<div class="garr-row" data-unit="' + k + '">' +
        '<canvas class="unit-ico" width="22" height="28" data-unit="' + k + '"></canvas>' +
        '<span class="gr-name">' + C.UNITS[k].name + '</span>' +
        '<input class="garr-slider" type="range" min="0" max="' + total + '" value="' + inGarr + '" data-unit="' + k + '"' +
          (total === 0 ? ' disabled' : '') + '>' +
        '<span class="gr-split" data-unit="' + k + '">Burg <b>' + inCastle + '</b> · Garnison <b>' + inGarr + '</b></span>' +
        '</div>';
    });
    html += '</div>';
    if (!any) {
      html += '<div class="muted small">Keine Einheiten in Burg oder Garnison.</div>';
    } else {
      html += '<div class="garr-total muted small">Garnison gewählt: <b class="gt-sum' + (curSum > cap ? ' bad' : '') + '">' +
        curSum + '</b> / ' + cap + '</div>';
      html += '<button class="btn sm garr-apply">Übernehmen</button>' +
        '<div class="muted small" style="margin-top:4px">Regler verschieben und übernehmen — die Einheiten wechseln mit Marschzeit.</div>';
    }
    html += '</div>';
    return html;
  }

  // Einheitlicher Support-Picker (ersetzt die früher getrennten Varianten für
  // Burg- und Struktur-Ziele). Quelle = eigene Burg ODER eigene Struktur.
  // targetKind: 'village' | 'structure'. Rohstoff-Tross nur bei Burg-Ziel mit
  // Burg-Quelle (Strukturen besitzen kein eigenes Rohstofflager).
  function supportPickerHtml(target, targetKind) {
    // Gültige Quellen sammeln: andere eigene Burgen + eigene Strukturen (nicht das Ziel selbst).
    var sources = [];
    G.villagesOfHouse(state, state.playerHouseId).forEach(function (v) {
      if (targetKind === 'village' && v.id === target.id) return;
      sources.push({ id: v.id, kind: 'village', label: 'Burg: ' + v.name + villageTag(v) });
    });
    (state.structures || []).forEach(function (st) {
      if (st.ownerHouseId !== state.playerHouseId) return;
      if (targetKind === 'structure' && st.id === target.id) return;
      sources.push({ id: st.id, kind: 'structure', label: 'Struktur: ' + structureMeta(st).name + ' (' + st.x + ',' + st.y + ')' });
    });

    var head = '<div class="support-picker"><b>⛨ Verstärkung anfordern</b>';
    if (!sources.length) {
      return head + '<div class="muted small">Keine andere eigene Burg oder Struktur als Quelle verfügbar.</div></div>';
    }
    // Quelle absichern: gemerkte Auswahl muss eine gültige Quelle sein, sonst erste nehmen.
    if (!sources.some(function (s) { return s.id === supportSourceId; })) supportSourceId = sources[0].id;
    var src = G.entityById(state, supportSourceId);

    var html = head;
    html += '<label class="support-from-row">Von <select class="support-source-sel">';
    sources.forEach(function (s) {
      html += '<option value="' + s.id + '"' + (s.id === supportSourceId ? ' selected' : '') + '>' + s.label + '</option>';
    });
    html += '</select></label>';

    // Entfernung zum Ziel (Marschzeit richtet sich nach der langsamsten Einheit).
    var dist = G.distance(src.ref, target);
    html += '<div class="muted small">Entfernung: ' + dist.toFixed(1) + ' Felder · Marschzeit je nach langsamster Einheit.</div>';

    // Verfügbare Einheiten (Burg: stationierte Truppen; Struktur: Garnison; Held nicht sendbar).
    var availUnits = {};
    if (src.kind === 'village') {
      ['spear', 'sword', 'axe', 'archer'].forEach(function (k) { availUnits[k] = src.ref.units[k] || 0; });
    } else {
      ['spear', 'sword', 'axe', 'archer'].forEach(function (k) { availUnits[k] = (src.ref.garrison && src.ref.garrison[k]) || 0; });
    }
    html += '<div class="support-section-label">Truppen</div><div class="send-form">';
    ['spear', 'sword', 'axe', 'archer'].forEach(function (k) {
      var have = availUnits[k] || 0;
      var v = (supportCounts['u_' + k] != null ? supportCounts['u_' + k] : 0);
      html += '<label class="send-row"><canvas class="unit-ico" width="24" height="30" data-unit="' + k + '"></canvas>' +
        C.UNITS[k].name + ' <small>(' + have + ')</small>' +
        '<input class="sup-n" type="number" min="0" max="' + have + '" value="' + v + '" data-unit="' + k + '"></label>';
    });
    html += '</div>';

    // Rohstoffe: nur eigene Burg -> eigene Burg (Strukturen haben kein eigenes Rohstofflager).
    if (targetKind === 'village' && src.kind === 'village') {
      html += '<div class="support-section-label">Rohstoffe <small class="muted">(reiner Tross reist langsamer)</small></div><div class="send-form">';
      C.RESOURCES.forEach(function (r) {
        var have = Math.floor(src.ref.resources[r] || 0);
        var rv = (supportResCounts[r] != null ? supportResCounts[r] : 0);
        html += '<label class="send-row">' + resIcoTag(r, 22) + ' ' + C.RESOURCE_META[r].name +
          ' <small>(' + fmt(have) + ')</small>' +
          '<input class="sup-r" type="number" min="0" max="' + have + '" value="' + rv + '" data-res="' + r + '"></label>';
      });
      html += '</div>';
    } else if (targetKind === 'village' && src.kind === 'structure') {
      html += '<div class="muted small">Rohstoffe können nur von einer Burg gesendet werden.</div>';
    }

    html += '<button class="btn full support-send" data-kind="' + targetKind + '" data-target="' + target.id + '">⛨ Anfordern</button>';
    html += '</div>';
    return html;
  }

  function unitsInline(units) {
    var parts = C.UNIT_ORDER.filter(function (k) { return (units[k] || 0) > 0; }).map(function (k) {
      return C.UNITS[k].name.slice(0, 3) + ' ' + units[k];
    });
    return parts.length ? parts.join(', ') : 'leer';
  }

  function logHtml() {
    var html = '<div class="panel"><h3>Chronik</h3><div class="log">';
    state.log.slice(0, 40).forEach(function (e) {
      html += '<div class="log-e ' + (e.kind || '') + '"><span class="lt">' + fmtTime(e.t) + '</span> ' + e.text + '</div>';
    });
    html += '</div></div>';
    return html;
  }

  function attachSidebarEvents() {
    paintUnitIcons(dom.sidebar);
    function collect() {
      var units = {};
      C.UNIT_ORDER.forEach(function (k) {
        units[k] = Math.max(0, parseInt(sendCounts[k], 10) || 0);
      });
      return units;
    }
    function updateEta() {
      var etaBox = $('send-eta'); if (!etaBox) return;
      var units = collect();
      var t = state.villages[targetVillageId], src = sourceVillage();
      if (!t || !src) return;
      var any = Object.keys(units).some(function (k) { return units[k] > 0; });
      if (!any) { etaBox.textContent = ''; return; }
      var travel = Math.max(C.MOVEMENT.minTravel, G.distance(src, t) * WOH.Combat.slowestSpeed(units));
      etaBox.textContent = 'Marschzeit: ' + fmtTime(travel) + ' (Spielzeit)';
    }
    Array.prototype.forEach.call(dom.sidebar.querySelectorAll('input.send-n'), function (inp) {
      inp.addEventListener('input', function () {
        sendCounts[inp.getAttribute('data-unit')] = inp.value;
        updateEta();
      });
    });
    var fromSel = dom.sidebar.querySelector('.send-from');
    if (fromSel) fromSel.addEventListener('change', function () {
      sendFromId = fromSel.value;
      renderSidebar(); // Garnison/Maxima/ETA für neues Quell-Dorf aktualisieren
    });
    var atk = dom.sidebar.querySelector('.attack-btn');
    if (atk) atk.addEventListener('click', function () { send('attack'); });

    // Support-Picker (eigene Burg als Ziel) wird direkt gerendert; nur verdrahten.
    wireSupportControls();

    function send(type) {
      var units = collect();
      var src = sourceVillage();
      var r = G.sendArmy(state, src.id, targetVillageId, units, type);
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      sendCounts = {}; // nach erfolgreichem Versand zurücksetzen
      toast((type === 'attack' ? 'Angriff' : 'Unterstützung') + ' entsandt — Marschzeit ' + fmtTime(r.travel) + '.');
      refreshPanels();
    }
  }

  // -----------------------------------------------------------------------
  // Event-Handler fuer Strukturen-Panel (Schritt 6)
  // -----------------------------------------------------------------------
  // root: Container, in dem die Struktur-Controls liegen (Sidebar oder Overlay-Body).
  function attachStructureEvents(root) {
    root = root || dom.sidebar;
    var s = (root === dom.sidebar) ? selectedStructure() : G.findStructureById(state, activeStructureId);
    if (!s) return;

    // "Struktur verwalten" (Sidebar-Kurzpanel) öffnet das Overlay.
    var so = root.querySelector('.struct-open');
    if (so) so.addEventListener('click', function () { openStructure(s.id); });

    // Unit-Icons in Inputs zeichnen
    paintUnitIcons(root);
    paintResIcons(root);

    // Quelldorf-Selector (analog Angriff)
    var fromSel = root.querySelector('.send-from');
    if (fromSel) fromSel.addEventListener('change', function () {
      sendFromId = fromSel.value; renderSidebar();
    });

    // Truppen-Mengen merken
    Array.prototype.forEach.call(root.querySelectorAll('input.send-n'), function (inp) {
      inp.addEventListener('input', function () { sendCounts[inp.getAttribute('data-unit')] = inp.value; });
    });

    function collectSend() {
      var u = {};
      C.UNIT_ORDER.forEach(function (k) { u[k] = Math.max(0, parseInt(sendCounts[k], 10) || 0); });
      return u;
    }

    // Sammeln
    var gb = root.querySelector('.gather-btn');
    if (gb) gb.addEventListener('click', function () {
      var src = sourceVillage();
      if (!src) { toast('Keine Quell-Burg.'); return; }
      var units = collectSend();
      // Held wird bei gather nicht mitgeschickt (Spec: gather = ohne Eroberung).
      units.hero = 0;
      var r = G.sendArmy(state, src.id, s.id, units, 'gather');
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      sendCounts = {};
      toast('Sammeltrupp entsandt — Marschzeit ' + fmtTime(r.travel) + '.');
      refreshPanels();
    });

    // Eroberung
    var cb = root.querySelector('.capture-btn');
    if (cb) cb.addEventListener('click', function () {
      var src = sourceVillage();
      if (!src) { toast('Keine Quell-Burg.'); return; }
      var units = collectSend();
      if ((units.hero || 0) < 1) { toast('Eroberung erfordert einen Helden im Trupp.'); return; }
      var r = G.sendArmy(state, src.id, s.id, units, 'capture');
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      sendCounts = {};
      toast('Eroberungstrupp entsandt — Marschzeit ' + fmtTime(r.travel) + '.');
      refreshPanels();
    });

    // Upgrade
    var ub = root.querySelector('.upgrade-btn');
    if (ub) ub.addEventListener('click', function () {
      var r = G.upgradeStructure(state, s);
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      toast('Struktur auf Stufe ' + r.newLevel + ' ausgebaut.');
      refreshPanels();
    });

    // Garnison-Schieberegler: Live-Anzeige + Summen-Begrenzung auf das
    // stufenabhängige Limit (Stufe 1=30, 2=70, 3=120).
    var castleForGarr = state.villages[s.assignedCastleId];
    var garrCap = C.structureGarrisonCap(s.level);
    var garrSliders = root.querySelectorAll('input.garr-slider');
    function sliderSum() {
      var sum = 0;
      Array.prototype.forEach.call(garrSliders, function (sl) { sum += parseInt(sl.value, 10) || 0; });
      return sum;
    }
    function refreshGarrUI() {
      Array.prototype.forEach.call(garrSliders, function (sl) {
        var k = sl.getAttribute('data-unit');
        var tgt = parseInt(sl.value, 10) || 0;
        var total = parseInt(sl.getAttribute('max'), 10) || 0;
        var split = root.querySelector('.gr-split[data-unit="' + k + '"]');
        if (split) split.innerHTML = 'Burg <b>' + (total - tgt) + '</b> · Garnison <b>' + tgt + '</b>';
      });
      var sum = sliderSum();
      var gt = root.querySelector('.gt-sum');
      if (gt) { gt.textContent = sum; gt.className = 'gt-sum' + (sum > garrCap ? ' bad' : ''); }
    }
    Array.prototype.forEach.call(garrSliders, function (inp) {
      inp.addEventListener('input', function () {
        // Summe darf das Limit nicht überschreiten -> aktuellen Regler kappen.
        var over = sliderSum() - garrCap;
        if (over > 0) inp.value = Math.max(0, (parseInt(inp.value, 10) || 0) - over);
        refreshGarrUI();
      });
    });
    // Übernehmen: Differenzen pro Einheit berechnen und verschieben.
    var gap = root.querySelector('.garr-apply');
    if (gap) gap.addEventListener('click', function () {
      if (!castleForGarr) { toast('Heimatburg fehlt.'); return; }
      var station = {}, withdraw = {}, stationTot = 0, withdrawTot = 0, targetSum = 0;
      Array.prototype.forEach.call(root.querySelectorAll('input.garr-slider'), function (inp) {
        var k = inp.getAttribute('data-unit');
        var cur = (s.garrison && s.garrison[k]) || 0;
        var total = parseInt(inp.getAttribute('max'), 10) || 0;
        var tgt = Math.max(0, Math.min(total, parseInt(inp.value, 10) || 0));
        targetSum += tgt;
        var d = tgt - cur;
        if (d > 0) { station[k] = d; stationTot += d; }
        else if (d < 0) { withdraw[k] = -d; withdrawTot += (-d); }
      });
      if (stationTot === 0 && withdrawTot === 0) { toast('Keine Änderung am Garnisons-Verhältnis.'); return; }
      if (targetSum > garrCap) {
        toast('Garnisons-Limit (' + garrCap + ') überschritten.'); return;
      }
      var parts = [];
      if (withdrawTot > 0) {
        var rw = G.withdrawGarrison(state, s, withdraw);
        if (!rw.ok) { toast(rw.msg); return; }
        parts.push(withdrawTot + ' zur Burg');
      }
      if (stationTot > 0) {
        var rs = G.sendArmy(state, castleForGarr.id, s.id, station, 'support');
        if (!rs.ok) { toast(rs.msg); return; }
        parts.push(stationTot + ' zur Garnison');
      }
      api.requestSave();
      toast('Garnison angepasst — ' + parts.join(', ') + ' (unterwegs).');
      refreshPanels();
    });

    // Heimatburg ändern
    var ha = root.querySelector('.home-apply');
    if (ha) ha.addEventListener('click', function () {
      var sel2 = root.querySelector('.home-select');
      var newId = sel2 ? sel2.value : null;
      if (!newId) return;
      var r = G.reassignHomeCastle(state, s, newId);
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      toast('Heimatburg geändert.');
      refreshPanels();
    });

    // Support-Picker (eigene Struktur als Ziel) wird direkt gerendert; nur verdrahten.
    wireSupportControls(root);
  }

  // -----------------------------------------------------------------------
  // Gemeinsame Support-Verdrahtung (Burg- und Struktur-Panel teilen den Picker).
  // root: Container (Sidebar oder Overlay-Body).
  // -----------------------------------------------------------------------
  function wireSupportControls(root) {
    root = root || dom.sidebar;
    var ssel = root.querySelector('.support-source-sel');
    if (ssel) ssel.addEventListener('change', function () {
      supportSourceId = ssel.value; supportCounts = {}; supportResCounts = {}; refreshPanels();
    });
    Array.prototype.forEach.call(root.querySelectorAll('input.sup-n'), function (inp) {
      inp.addEventListener('input', function () { supportCounts['u_' + inp.getAttribute('data-unit')] = inp.value; });
    });
    Array.prototype.forEach.call(root.querySelectorAll('input.sup-r'), function (inp) {
      inp.addEventListener('input', function () { supportResCounts[inp.getAttribute('data-res')] = inp.value; });
    });
    var ssend = root.querySelector('.support-send');
    if (ssend) ssend.addEventListener('click', function () {
      var kind = ssend.getAttribute('data-kind');
      var tid = ssend.getAttribute('data-target');
      var target = (kind === 'village') ? state.villages[tid] : G.findStructureById(state, tid);
      if (!target) { toast('Ziel nicht gefunden.'); return; }
      sendSupportToTarget(target, kind);
    });
    // Icons im Picker zeichnen (Einheiten + Rohstoffe).
    paintUnitIcons(root);
    paintResIcons(root);
  }

  // Schritt 9.2: Unterstuetzung laeuft jetzt durchgehend ueber Marschzeit.
  // sendArmy benoetigt eine Burg als Quelle — Strukturen als Quelle bleiben
  // instantaner Transfer (Strukturen koennen keine Bewegungen erzeugen).
  function sendSupportToTarget(target, targetKind) {
    var srcEnt = G.entityById(state, supportSourceId);
    if (!srcEnt || srcEnt.ownerHouseId !== state.playerHouseId) {
      toast('Quelle ist nicht eigen.'); return;
    }
    var units = {};
    C.UNIT_ORDER.forEach(function (k) { units[k] = Math.max(0, parseInt(supportCounts['u_' + k], 10) || 0); });
    units.hero = 0; // Held nicht supportbar
    var total = 0; for (var k in units) total += units[k];

    // Rohstoff-Tross: nur eigene Burg -> eigene Burg.
    var resObj = null, resTotal = 0;
    var canCarry = (srcEnt.kind === 'village' && targetKind === 'village');
    if (canCarry) {
      resObj = {};
      C.RESOURCES.forEach(function (r) {
        var amt = Math.max(0, parseInt(supportResCounts[r], 10) || 0);
        amt = Math.min(amt, Math.floor(srcEnt.ref.resources[r] || 0));
        resObj[r] = amt; resTotal += amt;
      });
      if (resTotal <= 0) resObj = null;
    }

    if (total <= 0 && resTotal <= 0) { toast('Weder Einheiten noch Rohstoffe ausgewählt.'); return; }

    // Verfügbarkeit der Einheiten
    var avail = srcEnt.kind === 'village' ? srcEnt.ref.units : (srcEnt.ref.garrison || {});
    for (var k0 in units) {
      if ((units[k0] || 0) > (avail[k0] || 0)) { toast('Nicht genug ' + C.UNITS[k0].name + ' in der Quelle.'); return; }
    }

    if (srcEnt.kind === 'village') {
      // Burg -> beliebiges Ziel: durchgaengig per sendArmy + Marschzeit (inkl. Rohstoff-Tross).
      var r = G.sendArmy(state, srcEnt.id, target.id, units, 'support', resObj);
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      supportCounts = {}; supportResCounts = {}; supportSourceId = null;
      var what = (total > 0 && resTotal > 0) ? 'Unterstützung + Rohstoffe'
               : (resTotal > 0 ? 'Rohstoff-Tross' : 'Unterstützung');
      toast(what + ' entsandt — Marschzeit ' + fmtTime(r.travel) + '.');
      refreshPanels();
      return;
    }

    // Struktur als Quelle: nur Einheiten (Garnison), keine Rohstoffe.
    if (total <= 0) { toast('Keine Einheiten ausgewählt.'); return; }

    // Quelle ist Struktur: instantaner Garnisons-Transfer (Strukturen haben
    // keine eigene Bewegungs-Identitaet im Movement-System).
    var srcGar = srcEnt.ref.garrison || {};
    if (targetKind === 'structure') {
      var tg = target.garrison || { spear: 0, sword: 0, axe: 0, archer: 0 };
      var curr = 0; for (var tk in tg) curr += tg[tk] || 0;
      var sum = 0; for (var sk in units) sum += units[sk];
      var tcap = C.structureGarrisonCap(target.level);
      if (curr + sum > tcap) {
        toast('Garnisons-Limit des Ziels (' + tcap + ') würde überschritten.'); return;
      }
      for (var su in units) {
        srcGar[su] = (srcGar[su] || 0) - units[su];
        tg[su] = (tg[su] || 0) + units[su];
      }
      target.garrison = tg;
    } else {
      for (var su2 in units) {
        srcGar[su2] = (srcGar[su2] || 0) - units[su2];
        target.units[su2] = (target.units[su2] || 0) + units[su2];
      }
    }
    srcEnt.ref.garrison = srcGar;
    api.requestSave();
    supportCounts = {}; supportSourceId = null;
    toast('Garnison von ' + structureMeta(srcEnt.ref).name + ' übertragen.');
    refreshPanels();
  }

  // ---------------------------------------------------------------------
  function toast(msg) {
    var t = $('toast');
    if (!t) { t = el('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show';
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = ''; }, 2600);
  }

  function setSaveStatus(txt) { if (dom.saveStatus) dom.saveStatus.textContent = txt; }

  WOH.UI = {
    init: init, bind: bind, frame: frame,
    refreshPanels: refreshPanels, setSaveStatus: setSaveStatus, toast: toast
  };
})(window.WOH = window.WOH || {});

