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
  var reportOpen = false;
  var panelTimer = 0;
  var trainCounts = {};         // gemerkte Ausbildungsmengen je Einheit (überlebt Neuaufbau)
  var sendCounts = {};          // gemerkte Truppenmengen fürs Angriffs-/Unterstützungsformular
  var sendFromId = null;        // gewähltes Quell-Dorf für den Angriff
  var garrisonCounts = {};      // Mengen fuer Garnison-Stationierung
  var supportCounts = {};       // Mengen fuer Support-Picker (Einheiten + Rohstoffe)
  var supportSourceId = null;   // gewaehlte Quelle (Burg- oder Struktur-Id)

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
    });
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

  function attachCanvasEvents() {
    var cv = dom.canvas;
    cv.addEventListener('mousedown', function (e) {
      cam.drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
      cam.moved = false;
    });
    window.addEventListener('mousemove', function (e) {
      if (cam.drag) {
        var dx = e.clientX - cam.drag.sx, dy = e.clientY - cam.drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) cam.moved = true;
        cam.x = cam.drag.cx - dx / cam.zoom;
        cam.y = cam.drag.cy - dy / cam.zoom;
        clampCam();
        return;
      }
      // Hover-Highlight ueber Strukturen (nur wenn nicht gedraggt)
      if (e.target !== cv) { hoverStructureId = null; return; }
      var st = structureAtEvent(e);
      hoverStructureId = st ? st.id : null;
    });
    window.addEventListener('mouseup', function (e) {
      if (cam.drag && !cam.moved) handleMapClick(e);
      cam.drag = null;
    });
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
    // Doppelklick öffnet die Dorfansicht als Overlay.
    cv.addEventListener('dblclick', function (e) {
      var v = villageAtEvent(e);
      if (!v) return;
      if (v.houseId === state.playerHouseId) { activeVillageId = v.id; openVillage(v.id); }
      else { targetVillageId = v.id; renderSidebar(); toast('Fremdes Dorf als Angriffsziel gewählt.'); }
    });
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
    return (best && bestD < ts * 0.75) ? best : null;
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
      sendCounts = {}; garrisonCounts = {}; supportCounts = {}; supportSourceId = null;
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
      ctx.strokeStyle = incoming ? 'rgba(210,70,70,0.7)' : (isPlayerAtt ? 'rgba(110,207,151,0.6)' : 'rgba(150,150,160,0.25)');
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
      // Marschpunkt
      ctx.fillStyle = incoming ? '#d24646' : (isPlayerAtt ? '#6fcf97' : '#9a9aa6');
      ctx.beginPath(); ctx.arc(px, py, 4 / cam.zoom + 2, 0, Math.PI * 2); ctx.fill();
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
    // Burg-Labels (Bildschirmraum): Wappen-Schild + Name.
    // Spieler: blauer Hintergrund, weiße Schrift. Andere: graue Schrift.
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    var SHIELD = 10, GAP = 4, PADX = 4, BOXH = 15;
    for (var id2 in state.villages) {
      var v2 = state.villages[id2];
      var sp = worldToScreen(v2.x * ts + ts / 2, v2.y * ts + ts / 2);
      if (sp.x < -60 || sp.x > cv.width + 60 || sp.y < -40 || sp.y > cv.height + 40) continue;
      var h2 = state.houses[v2.houseId];
      var isP = v2.houseId === state.playerHouseId;
      var label = h2.surname + villageTag(v2);
      var tw = ctx.measureText(label).width;
      var boxW = PADX + SHIELD + GAP + tw + PADX;
      var bx = Math.round(sp.x - boxW / 2), by = Math.round(sp.y + ts * 0.5);
      ctx.fillStyle = isP ? 'rgba(38,92,170,0.95)' : 'rgba(12,16,20,0.66)';
      ctx.fillRect(bx, by, boxW, BOXH);
      S.drawCrest(ctx, bx + PADX, by + (BOXH - SHIELD) / 2, SHIELD, h2.sigil);
      ctx.fillStyle = isP ? '#ffffff' : '#c2c2c2';
      ctx.fillText(label, bx + PADX + SHIELD + GAP, by + 11);
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
    crest.style.background = 'linear-gradient(135deg,' + house.sigil.p + ' 0 50%,' + house.sigil.s + ' 50% 100%)';
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
    var manageBtn = el('button', 'tab active', '⌂ Dorf verwalten');
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
    if (v && resBox) {
      var cap = V.storageCap(v);
      C.RESOURCES.forEach(function (r) {
        var cell = resBox.querySelector('.res[data-r="' + r + '"]');
        if (!cell) return;
        var rate = V.productionPerSec(v, r, state) * C.TIME_SCALE;
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

  function openVillage(id) {
    if (id) activeVillageId = id;
    var v = activeVillage();
    if (!v) { toast('Kein eigenes Dorf mehr.'); return; }
    overlayOpen = true;
    dom.overlay.style.display = 'flex';
    dom.overlay.style.top = dom.topbar.offsetHeight + 'px'; // Topbar (Ressourcen) sichtbar lassen
    updateVillageSelect();
    renderVillageView();
  }
  function closeVillage() {
    overlayOpen = false;
    dom.overlay.style.display = 'none';
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
    var crest = '<span class="crest sm" style="background:linear-gradient(135deg,' +
      (sig ? sig.p : '#888') + ' 0 50%,' + (sig ? sig.s : '#ddd') + ' 50% 100%)"></span>';
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
        else          txt = res.captured ? 'Dein Dorf wurde EROBERT!'      : 'Dein Dorf wurde geplündert!';
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
          txt = res.captured ? 'Dorf EROBERT!' : 'Sieg – Beute erobert!';
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
    Array.prototype.forEach.call(dom.battleBody.querySelectorAll('canvas[data-unit]'), function (c) {
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      S.drawUnitIcon(ctx, 3, 0, 4, c.getAttribute('data-unit'));
    });
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
    if (overlayOpen) renderVillageView();
    renderSidebar();
  }
  // leichtgewichtige Aktualisierung (Queues, Beträge).
  // Der jeweils fokussierte Bereich wird NICHT neu aufgebaut, sonst würden
  // Eingabefelder (z. B. Ausbildungsmenge) beim Tippen zurückgesetzt.
  function refreshDynamic() {
    var ae = document.activeElement;
    var inBody = ae && dom.villageBody && dom.villageBody.contains(ae);
    var inSide = ae && dom.sideTop && dom.sideTop.contains(ae);
    if (overlayOpen && !inBody) renderVillageView();
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
    if (!v) { dom.villageBody.innerHTML = '<p class="empty">Kein eigenes Dorf mehr. Das Spiel ist verloren.</p>'; return; }
    var house = state.houses[v.houseId];
    dom.overlayTitle.innerHTML = '<span class="crest sm" style="background:linear-gradient(135deg,' +
      house.sigil.p + ' 0 50%,' + house.sigil.s + ' 50% 100%)"></span> ' +
      v.name + villageTag(v) + ' — ' + house.name + ' · Treue ' + Math.round(v.loyalty) + '%';
    var html = '';
    html += '<div class="vv-grid">';
    // Gebäude-Spalte: Bau-Warteschlange LINKS neben dem Gebäude-Grid
    html += '<div class="vv-col"><h2>Gebäude</h2>';
    html += '<div class="bld-area">';
    html += '<div class="queue-col">' + buildQueueListHtml(v) + '</div>';
    html += '<div class="bld-grid">';
    Object.keys(C.BUILDINGS).forEach(function (key) { html += buildingCardHtml(v, key); });
    html += '</div>';
    html += '</div>';
    html += '</div>';
    // Militär-Spalte: Trainings-Warteschlange RECHTS neben dem Kaserne-HUD
    html += '<div class="vv-col"><h2>Kaserne &amp; Verteidigung</h2>';
    html += militaryHtml(v);
    html += '</div>';
    html += '</div>';
    dom.villageBody.innerHTML = html;
    attachVillageEvents(v);
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
      var rate = (C.PRODUCTION.base + lvl * C.PRODUCTION.perLevel) * (v.bonus[b.produces] || 1) * C.TIME_SCALE;
      prodTxt = '<div class="prod">+' + rate.toFixed(1) + ' ' + C.RESOURCE_META[b.produces].name + '/s</div>';
    }
    var active = v.buildQueue.length && v.buildQueue[0].key === key;
    var html = '<div class="bld-card' + (active ? ' updating' : '') + '" title="' + b.desc + '">';
    html += '<div class="bld-top"><canvas class="bld-ico" width="40" height="40" data-bld="' + key + '"></canvas>';
    html += '<div class="bld-meta"><b>' + b.name + '</b><span class="lvl">Stufe ' + lvl + (maxed ? ' · max' : '') + '</span></div></div>';
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
      html += '<td><b>' + u.name + '</b><br><small>' + costStr + ' · ' + fmtTime(u.trainTime) + '</small></td>';
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
    var def = WOH.Combat.defensePower(v.units, v.buildings.wall || 0, v.buildings.tower || 0);
    html += '<div class="def-box"><b>Verteidigungskraft:</b> ' + fmt(def) +
      ' &nbsp;|&nbsp; Palisade ' + (v.buildings.wall || 0) + ' · Turm ' + (v.buildings.tower || 0) + '</div>';

    html += '<p class="hint">Off-Einheiten (rot) für Angriffe, Def-Einheiten (blau) zur Verteidigung. ' +
      'Speer = günstiger Allrounder, Schwert = harter Standverteidiger, Axt = reine Offensive, Bogenschütze = stark hinter Mauern.</p>';
    return html;
  }

  function attachVillageEvents(v) {
    // Icons zeichnen
    paintResIcons(dom.villageBody);
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('canvas[data-bld]'), function (c) {
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      S.drawBuildingIcon(ctx, 2, 2, 3, c.getAttribute('data-bld'));
    });
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('canvas[data-unit]'), function (c) {
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      S.drawUnitIcon(ctx, 3, 0, 4, c.getAttribute('data-unit'));
    });
    Array.prototype.forEach.call(dom.villageBody.querySelectorAll('[data-build]'), function (btn) {
      btn.addEventListener('click', function () {
        var r = G.enqueueBuild(state, v, btn.getAttribute('data-build'));
        if (!r.ok) toast(r.msg); else api.requestSave();
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
      html += '<div class="outgoing"><b>' + sym + '</b> → ' + dest + '<br>' +
        '<small>' + unitsInline(m.units) + lootStr + '</small><br>' +
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
    if (!t) return '<div class="panel"><h3>Ziel</h3><p class="muted">Klicke auf der Karte ein Dorf an.</p></div>';
    var house = state.houses[t.houseId];
    var src = sourceVillage();
    var isOwn = t.houseId === state.playerHouseId;
    var dist = src ? G.distance(src, t) : 0;
    var html = '<div class="panel"><h3>Ziel: ' + t.name + villageTag(t) + '</h3>';
    html += '<div class="crestline"><span class="crest sm" style="background:linear-gradient(135deg,' +
      house.sigil.p + ' 0 50%,' + house.sigil.s + ' 50% 100%)"></span> ' + house.name + '</div>';
    html += '<div class="muted small">Entfernung ' + dist.toFixed(1) + ' Felder · Treue ' + Math.round(t.loyalty) + '%</div>';
    if (isOwn) {
      html += '<div class="def-box small">Garnison — ' + unitsInline(t.units) + '</div>';
      // Unterstuetzung anfordern (Schritt 6, auch fuer Burgen)
      html += '<div class="support-req-box"><b>Unterstuetzung anfordern</b><br>' +
        '<button class="btn sm support-open-castle">Quelle waehlen…</button></div>';
      if (supportSourceId) html += castleSupportPickerHtml(t);
      html += '</div>';
      return html;
    }
    if (!src) { html += '<p class="muted">Kein eigenes Dorf.</p></div>'; return html; }
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
    html += '<button class="btn full ghost support-btn">⛨ Unterstützung senden</button>';
    html += '<div class="muted small" style="margin-top:6px">Held mitschicken ⇒ Eroberung bei Sieg (Held geht verloren).</div>';
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
    if (isOwn) {
      var castle = state.villages[s.assignedCastleId];
      var castleName = castle ? (castle.name + villageTag(castle)) : '?';
      html += '<div class="def-box small">';
      html += 'Heimatburg: <b>' + castleName + '</b><br>';
      html += 'Produktion fliesst direkt in das Burg-Lager (+' +
        (prod * C.TIME_SCALE).toFixed(0) + ' ' + C.RESOURCE_META[resKey].name + '/s)<br>';
      html += 'Pop-Bonus: +' + (C.STRUCTURE_POP_BONUS[lvl] || 0) + '<br>';
      html += 'Garnison: ' + garrisonTotal(s) + '/' + C.STRUCTURE_GARRISON_CAP + ' — ' + unitsInline(s.garrison || {});
      html += '</div>';
    } else {
      var inStore = Math.floor(s.storage && s.storage[resKey] || 0);
      html += '<div class="def-box small">';
      html += 'Lager: <b>' + fmt(inStore) + ' / ' + fmt(cap) + ' ' + C.RESOURCE_META[resKey].name + '</b><br>';
      html += 'Garnison: ' + garrisonTotal(s) + ' — ' + unitsInline(s.garrison || {});
      html += '</div>';
    }

    // Aktionen
    if (isOwn) {
      html += structureOwnActionsHtml(s);
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
  function structureOwnActionsHtml(s) {
    var lvl = s.level || 1;
    var levels = C.RESOURCE_STRUCTURE_LEVELS;
    var castle = state.villages[s.assignedCastleId];
    var html = '<div class="own-actions">';

    // Upgrade — Schritt 9.1: zeigt laufende Upgrade-Queue, sonst Upgrade-Button
    var inUpgrade = Array.isArray(s.upgradeQueue) && s.upgradeQueue.length > 0;
    if (inUpgrade) {
      var q = s.upgradeQueue[0];
      var left = Math.max(0, q.endsAt - (state.gameTime || 0));
      html += '<div class="upgrade-box"><b>Upgrade auf Stufe ' + q.targetLevel + ' läuft</b><br>' +
        '<small>Restzeit: ' + fmtTime(left) + '</small></div>';
    } else if (lvl < 3) {
      var cost = levels.upgradeCost[lvl - 1];
      var costStr = C.RESOURCES.filter(function (r) { return cost[r] > 0; }).map(function (r) {
        var lack = castle && castle.resources[r] < cost[r];
        return '<span class="costtag ' + (lack ? 'lack' : '') + '">' + resIcoTag(r, 22) + fmt(cost[r]) + '</span>';
      }).join(' ');
      var afford = castle && C.RESOURCES.every(function (r) { return (castle.resources[r] || 0) >= (cost[r] || 0); });
      html += '<div class="upgrade-box"><b>Upgrade auf Stufe ' + (lvl + 1) + '</b><br>' + costStr +
        '<br><small>' + fmtTime(levels.upgradeTime[lvl - 1]) + ' Bauzeit (zahlt aus ' + (castle ? castle.name : '?') + ')</small><br>' +
        '<button class="btn sm upgrade-btn" ' + (afford ? '' : 'disabled') + '>Upgrade ausführen</button></div>';
    } else {
      html += '<div class="upgrade-box muted">Maximale Stufe erreicht.</div>';
    }

    // Garnison verwalten — stationieren & zurueckziehen
    if (castle) {
      var garrFree = C.STRUCTURE_GARRISON_CAP - garrisonTotal(s);
      html += '<div class="garrison-box"><b>Garnison verwalten</b> ' +
        '<small>(frei: ' + garrFree + ')</small>';
      html += '<table class="unit-table small"><tbody>';
      ['spear', 'sword', 'axe', 'archer'].forEach(function (k) {
        var inCastle = castle.units[k] || 0;
        var inGarr = (s.garrison && s.garrison[k]) || 0;
        var gv = (garrisonCounts[k] != null ? garrisonCounts[k] : 0);
        html += '<tr><td><b>' + C.UNITS[k].name + '</b></td>' +
          '<td>Burg: ' + inCastle + '</td>' +
          '<td>Garnison: ' + inGarr + '</td>' +
          '<td><input class="garr-n" type="number" min="0" value="' + gv + '" data-unit="' + k + '"></td></tr>';
      });
      html += '</tbody></table>';
      html += '<button class="btn sm garr-station">→ Stationieren</button> ' +
        '<button class="btn sm garr-withdraw">← Zurueckziehen</button></div>';
    }

    // Heimatburg aendern
    var ownCastles = G.villagesOfHouse(state, state.playerHouseId);
    if (ownCastles.length > 1) {
      html += '<div class="home-box"><b>Heimatburg</b> ' +
        '<select class="home-select">' +
        ownCastles.map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === s.assignedCastleId ? ' selected' : '') + '>' +
            c.name + villageTag(c) + '</option>';
        }).join('') + '</select> <button class="btn sm home-apply">Aendern</button></div>';
    }

    // Unterstuetzung anfordern
    html += '<div class="support-req-box"><b>Unterstuetzung anfordern</b><br>' +
      '<button class="btn sm support-open">Quelle waehlen…</button></div>';

    // Bei geoeffnetem Support-Picker: Auswahl + Truppen + Senden
    if (supportSourceId) html += structureSupportPickerHtml(s);

    html += '</div>';
    return html;
  }

  // Support-Picker fuer eigene Burg (Ziel ist Burg, Quelle Burg oder Struktur).
  function castleSupportPickerHtml(targetCastle) {
    var src = G.entityById(state, supportSourceId);
    if (!src || src.ownerHouseId !== state.playerHouseId) { supportSourceId = null; return ''; }
    var ownVillages = G.villagesOfHouse(state, state.playerHouseId).filter(function (c) { return c.id !== targetCastle.id; });
    var ownStructs = (state.structures || []).filter(function (st) { return st.ownerHouseId === state.playerHouseId; });
    var html = '<div class="support-picker"><b>Unterstuetzung von:</b> ';
    html += '<select class="support-source-sel">';
    ownVillages.forEach(function (v) {
      html += '<option value="' + v.id + '"' + (v.id === supportSourceId ? ' selected' : '') + '>Burg: ' + v.name + villageTag(v) + '</option>';
    });
    ownStructs.forEach(function (st) {
      var nm = (C.RESOURCE_STRUCTURES[st.type] ? C.RESOURCE_STRUCTURES[st.type].name : st.type) + ' (' + st.x + ',' + st.y + ')';
      html += '<option value="' + st.id + '"' + (st.id === supportSourceId ? ' selected' : '') + '>Struktur: ' + nm + '</option>';
    });
    html += '</select>';
    var availUnits = {};
    if (src.kind === 'village') {
      ['spear','sword','axe','archer','hero'].forEach(function (k) { availUnits[k] = src.ref.units[k] || 0; });
    } else {
      ['spear','sword','axe','archer'].forEach(function (k) { availUnits[k] = (src.ref.garrison && src.ref.garrison[k]) || 0; });
      availUnits.hero = 0;
    }
    html += '<div class="send-form">';
    C.UNIT_ORDER.forEach(function (k) {
      var have = availUnits[k] || 0;
      var v = (supportCounts['u_' + k] != null ? supportCounts['u_' + k] : 0);
      html += '<label class="send-row"><canvas class="unit-ico" width="24" height="30" data-unit="' + k + '"></canvas>' +
        C.UNITS[k].name + ' <small>(' + have + ')</small>' +
        '<input class="sup-n" type="number" min="0" max="' + have + '" value="' + v + '" data-unit="' + k + '"></label>';
    });
    html += '</div>';
    html += '<button class="btn full support-send-castle">⛨ Unterstuetzung entsenden</button>';
    html += '<button class="btn ghost sm support-cancel">Abbrechen</button>';
    html += '</div>';
    return html;
  }

  function structureSupportPickerHtml(targetStruct) {
    var src = G.entityById(state, supportSourceId);
    if (!src || src.ownerHouseId !== state.playerHouseId) {
      supportSourceId = null;
      return '';
    }
    var ownVillages = G.villagesOfHouse(state, state.playerHouseId);
    var ownStructs = (state.structures || []).filter(function (st) {
      return st.ownerHouseId === state.playerHouseId && st.id !== targetStruct.id;
    });
    var html = '<div class="support-picker"><b>Unterstuetzung von:</b> ';
    html += '<select class="support-source-sel">';
    ownVillages.forEach(function (v) {
      html += '<option value="' + v.id + '"' + (v.id === supportSourceId ? ' selected' : '') + '>Burg: ' + v.name + villageTag(v) + '</option>';
    });
    ownStructs.forEach(function (st) {
      var nm = structureMeta(st).name + ' (' + st.x + ',' + st.y + ')';
      html += '<option value="' + st.id + '"' + (st.id === supportSourceId ? ' selected' : '') + '>Struktur: ' + nm + '</option>';
    });
    html += '</select>';

    // Verfuegbare Einheiten ermitteln
    var availUnits = {};
    if (src.kind === 'village') {
      ['spear','sword','axe','archer','hero'].forEach(function (k) { availUnits[k] = src.ref.units[k] || 0; });
    } else {
      // Struktur als Quelle: Garnison schickt (Held nicht in Garnison moeglich)
      ['spear','sword','axe','archer'].forEach(function (k) { availUnits[k] = (src.ref.garrison && src.ref.garrison[k]) || 0; });
      availUnits.hero = 0;
    }
    html += '<div class="send-form">';
    C.UNIT_ORDER.forEach(function (k) {
      var have = availUnits[k] || 0;
      var v = (supportCounts['u_' + k] != null ? supportCounts['u_' + k] : 0);
      html += '<label class="send-row"><canvas class="unit-ico" width="24" height="30" data-unit="' + k + '"></canvas>' +
        C.UNITS[k].name + ' <small>(' + have + ')</small>' +
        '<input class="sup-n" type="number" min="0" max="' + have + '" value="' + v + '" data-unit="' + k + '"></label>';
    });
    html += '</div>';

    html += '<button class="btn full support-send">⛨ Unterstuetzung entsenden</button>';
    html += '<button class="btn ghost sm support-cancel">Abbrechen</button>';
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
    Array.prototype.forEach.call(dom.sidebar.querySelectorAll('canvas[data-unit]'), function (c) {
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      S.drawUnitIcon(ctx, 2, 0, 3, c.getAttribute('data-unit'));
    });
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
    var sup = dom.sidebar.querySelector('.support-btn');
    if (sup) sup.addEventListener('click', function () { send('support'); });

    // Unterstuetzung anfordern fuer eigene Burgen (Ziel = Burg)
    var soc = dom.sidebar.querySelector('.support-open-castle');
    if (soc) soc.addEventListener('click', function () {
      var t = state.villages[targetVillageId];
      if (!t) return;
      var own = G.villagesOfHouse(state, state.playerHouseId).filter(function (c) { return c.id !== t.id; });
      supportSourceId = (own[0] && own[0].id) || null;
      supportCounts = {};
      refreshPanels();
    });
    var sca = dom.sidebar.querySelector('.support-cancel');
    if (sca) sca.addEventListener('click', function () {
      supportSourceId = null; supportCounts = {}; refreshPanels();
    });
    var ssel = dom.sidebar.querySelector('.support-source-sel');
    if (ssel) ssel.addEventListener('change', function () {
      supportSourceId = ssel.value; supportCounts = {}; refreshPanels();
    });
    Array.prototype.forEach.call(dom.sidebar.querySelectorAll('input.sup-n'), function (inp) {
      inp.addEventListener('input', function () { supportCounts['u_' + inp.getAttribute('data-unit')] = inp.value; });
    });
    var ssc = dom.sidebar.querySelector('.support-send-castle');
    if (ssc) ssc.addEventListener('click', function () {
      var t = state.villages[targetVillageId];
      if (!t) return;
      sendSupportToTarget(t, 'village');
    });

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
  function attachStructureEvents() {
    var s = selectedStructure();
    if (!s) return;
    // Unit-Icons in Inputs zeichnen
    Array.prototype.forEach.call(dom.sidebar.querySelectorAll('canvas[data-unit]'), function (c) {
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      S.drawUnitIcon(ctx, 2, 0, 3, c.getAttribute('data-unit'));
    });
    paintResIcons(dom.sidebar);

    // Quelldorf-Selector (analog Angriff)
    var fromSel = dom.sidebar.querySelector('.send-from');
    if (fromSel) fromSel.addEventListener('change', function () {
      sendFromId = fromSel.value; renderSidebar();
    });

    // Truppen-Mengen merken
    Array.prototype.forEach.call(dom.sidebar.querySelectorAll('input.send-n'), function (inp) {
      inp.addEventListener('input', function () { sendCounts[inp.getAttribute('data-unit')] = inp.value; });
    });

    function collectSend() {
      var u = {};
      C.UNIT_ORDER.forEach(function (k) { u[k] = Math.max(0, parseInt(sendCounts[k], 10) || 0); });
      return u;
    }

    // Sammeln
    var gb = dom.sidebar.querySelector('.gather-btn');
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
    var cb = dom.sidebar.querySelector('.capture-btn');
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
    var ub = dom.sidebar.querySelector('.upgrade-btn');
    if (ub) ub.addEventListener('click', function () {
      var r = G.upgradeStructure(state, s);
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      toast('Struktur auf Stufe ' + r.newLevel + ' ausgebaut.');
      refreshPanels();
    });

    // Garnison verwalten
    Array.prototype.forEach.call(dom.sidebar.querySelectorAll('input.garr-n'), function (inp) {
      inp.addEventListener('input', function () { garrisonCounts[inp.getAttribute('data-unit')] = inp.value; });
    });
    function collectGarr() {
      var u = {};
      ['spear', 'sword', 'axe', 'archer'].forEach(function (k) {
        u[k] = Math.max(0, parseInt(garrisonCounts[k], 10) || 0);
      });
      return u;
    }
    var stb = dom.sidebar.querySelector('.garr-station');
    if (stb) stb.addEventListener('click', function () {
      var castle = state.villages[s.assignedCastleId];
      if (!castle) { toast('Heimatburg fehlt.'); return; }
      var r = G.stationGarrison(state, castle, s, collectGarr());
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      garrisonCounts = {};
      toast('Einheiten stationiert.');
      refreshPanels();
    });
    var wdb = dom.sidebar.querySelector('.garr-withdraw');
    if (wdb) wdb.addEventListener('click', function () {
      var r = G.withdrawGarrison(state, s, collectGarr());
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      garrisonCounts = {};
      toast('Einheiten zurueckgezogen.');
      refreshPanels();
    });

    // Heimatburg aendern
    var ha = dom.sidebar.querySelector('.home-apply');
    if (ha) ha.addEventListener('click', function () {
      var sel2 = dom.sidebar.querySelector('.home-select');
      var newId = sel2 ? sel2.value : null;
      if (!newId) return;
      var r = G.reassignHomeCastle(state, s, newId);
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      toast('Heimatburg geaendert.');
      refreshPanels();
    });

    // Unterstuetzung anfordern: Picker oeffnen/abbrechen
    var sop = dom.sidebar.querySelector('.support-open');
    if (sop) sop.addEventListener('click', function () {
      // Default: erste eigene Burg (nicht diese Struktur) als Quelle
      var own = G.villagesOfHouse(state, state.playerHouseId);
      supportSourceId = (own[0] && own[0].id) || null;
      supportCounts = {};
      refreshPanels();
    });
    var sca = dom.sidebar.querySelector('.support-cancel');
    if (sca) sca.addEventListener('click', function () {
      supportSourceId = null; supportCounts = {}; refreshPanels();
    });
    var ssel = dom.sidebar.querySelector('.support-source-sel');
    if (ssel) ssel.addEventListener('change', function () {
      supportSourceId = ssel.value; supportCounts = {}; refreshPanels();
    });
    Array.prototype.forEach.call(dom.sidebar.querySelectorAll('input.sup-n'), function (inp) {
      inp.addEventListener('input', function () { supportCounts['u_' + inp.getAttribute('data-unit')] = inp.value; });
    });
    var ssend = dom.sidebar.querySelector('.support-send');
    if (ssend) ssend.addEventListener('click', function () {
      sendSupport(s);
    });
  }

  // Unterstuetzung an Struktur entsenden (genutzt vom Struktur-Panel).
  function sendSupport(target) { sendSupportToTarget(target, 'structure'); }

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
    if (total <= 0) { toast('Keine Einheiten ausgewaehlt.'); return; }

    // Verfuegbarkeit
    var avail = srcEnt.kind === 'village' ? srcEnt.ref.units : (srcEnt.ref.garrison || {});
    for (var k0 in units) {
      if ((units[k0] || 0) > (avail[k0] || 0)) { toast('Nicht genug ' + C.UNITS[k0].name + ' in der Quelle.'); return; }
    }

    if (srcEnt.kind === 'village') {
      // Burg -> beliebiges Ziel: durchgaengig per sendArmy + Marschzeit
      var r = G.sendArmy(state, srcEnt.id, target.id, units, 'support');
      if (!r.ok) { toast(r.msg); return; }
      api.requestSave();
      supportCounts = {}; supportSourceId = null;
      toast('Unterstuetzung entsandt — Marschzeit ' + fmtTime(r.travel) + '.');
      refreshPanels();
      return;
    }

    // Quelle ist Struktur: instantaner Garnisons-Transfer (Strukturen haben
    // keine eigene Bewegungs-Identitaet im Movement-System).
    var srcGar = srcEnt.ref.garrison || {};
    if (targetKind === 'structure') {
      var tg = target.garrison || { spear: 0, sword: 0, axe: 0, archer: 0 };
      var curr = 0; for (var tk in tg) curr += tg[tk] || 0;
      var sum = 0; for (var sk in units) sum += units[sk];
      if (curr + sum > C.STRUCTURE_GARRISON_CAP) {
        toast('Garnisons-Cap des Ziels wuerde ueberschritten.'); return;
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
    toast('Garnison von ' + structureMeta(srcEnt.ref).name + ' uebertragen.');
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
