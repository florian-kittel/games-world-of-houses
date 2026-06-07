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
  var selectedStructureId = null; // angeklickte Rohstoff-Struktur (Karte); Wiring in Schritt 6
  var overlayOpen = false;
  var reportOpen = false;
  var panelTimer = 0;
  var trainCounts = {};         // gemerkte Ausbildungsmengen je Einheit (überlebt Neuaufbau)
  var sendCounts = {};          // gemerkte Truppenmengen fürs Angriffs-/Unterstützungsformular
  var sendFromId = null;        // gewähltes Quell-Dorf für den Angriff

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
      if (!cam.drag) return;
      var dx = e.clientX - cam.drag.sx, dy = e.clientY - cam.drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) cam.moved = true;
      cam.x = cam.drag.cx - dx / cam.zoom;
      cam.y = cam.drag.cy - dy / cam.zoom;
      clampCam();
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

  function handleMapClick(e) {
    var best = villageAtEvent(e);
    if (!best) return;
    if (best.houseId === state.playerHouseId) { activeVillageId = best.id; }
    targetVillageId = best.id;
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
    // Bewegungslinien
    state.movements.forEach(function (m) {
      var from = state.villages[m.fromId], to = state.villages[m.toId];
      if (!from || !to) return;
      var prog = (state.gameTime - m.startTime) / (m.arriveTime - m.startTime);
      prog = Math.max(0, Math.min(1, prog));
      var fx = from.x * ts + ts / 2, fy = from.y * ts + ts / 2;
      var tx = to.x * ts + ts / 2, ty = to.y * ts + ts / 2;
      var px = fx + (tx - fx) * prog, py = fy + (ty - fy) * prog;
      var isPlayerAtt = m.ownerHouseId === state.playerHouseId;
      var incoming = to.houseId === state.playerHouseId && m.type === 'attack';
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
    for (var si = 0; si < structs.length; si++) {
      var st = structs[si];
      var ownerHouse = st.ownerHouseId ? state.houses[st.ownerHouseId] : null;
      S.drawResourceStructure(ctx,
        st.x * ts + ts / 2, st.y * ts + ts / 2, ts * 0.95,
        st,
        { selected: st.id === selectedStructureId },
        ownerHouse);
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
    right.appendChild(el('span', 'tb-clock', '⏱ <span id="game-clock">0:00</span>'));
    dom.topbar.appendChild(right);
    updateVillageSelect();
  }

  function updateHUD() {
    var v = activeVillage();
    var resBox = $('tb-res');
    if (v && resBox) {
      var cap = V.storageCap(v);
      C.RESOURCES.forEach(function (r) {
        var cell = resBox.querySelector('.res[data-r="' + r + '"]');
        if (!cell) return;
        var rate = V.productionPerSec(v, r) * C.TIME_SCALE;
        var val = v.resources[r];
        cell.classList.toggle('full', val >= cap);
        var valEl = cell.querySelector('.res-val');
        if (valEl) valEl.innerHTML = fmt(val) + '<small>/' + fmt(cap) + ' · ' +
          (rate >= 0 ? '+' : '') + rate.toFixed(1) + '/s</small>';
      });
      var pop = V.populationUsed(v), popCap = V.populationCap(v);
      var popEl = resBox.querySelector('.pop-val');
      if (popEl) popEl.textContent = fmt(pop) + '/' + fmt(popCap);
    }
    var clk = $('game-clock'); if (clk) clk.textContent = fmtTime(state.gameTime);
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
    if (role === 'defender') {
      if (aWin) { cls = 'bad'; txt = res.captured ? 'Dein Dorf wurde EROBERT!' : 'Dein Dorf wurde geplündert!'; }
      else { cls = 'good'; txt = 'Angriff abgewehrt!'; }
    } else {
      if (aWin) { cls = 'good'; txt = res.captured ? 'Dorf EROBERT!' : 'Sieg – Beute erobert!'; }
      else { cls = 'bad'; txt = 'Niederlage – Armee verloren.'; }
    }
    dom.battleTitle.textContent = 'Kampfbericht: ' + (res.attackerHouse ? res.attackerHouse.surname : '?') + ' → ' + res.toName;
    var html = '<div class="battle-banner ' + cls + '">' + txt + '</div>';
    html += '<div class="battle-meta">Glück ' + (res.luck >= 0 ? '+' : '') + Math.round(res.luck * 100) +
      '% · Moral ' + Math.round(res.morale * 100) + '%</div>';
    html += '<div class="battle-grid">';
    html += battleSideHtml('Angreifer', res.attackerHouse, res.fromName, res.attackerUnits,
      res.attackerSurvivors, res.attackerLosses, res.attackPower, '⚔');
    html += battleSideHtml('Verteidiger', res.defenderHouse, res.toName, res.defenderUnits,
      res.defenderSurvivors, res.defenderLosses, res.defensePower, '⛨');
    html += '</div>';
    // Verteidigungs-Aufschlüsselung: Einheiten / Palisade / Turm / Held
    var bd = res.defBreakdown;
    if (bd) {
      var parts = ['Einheiten ' + fmt(bd.units)];
      parts.push('Palisade (St. ' + (res.defWallLevel || 0) + ') +' + fmt(bd.wall));
      parts.push('Turm (St. ' + (res.defTowerLevel || 0) + ') +' + fmt(bd.tower));
      if (bd.hero > 0) parts.push('davon Held +' + fmt(bd.hero));
      html += '<div class="battle-breakdown"><b>Verteidigung:</b> ' + parts.join(' · ') + '</div>';
    }
    if (res.loot && C.RESOURCES.some(function (r) { return res.loot[r] > 0; })) {
      html += '<div class="battle-loot"><b>Beute:</b> ' + C.RESOURCES.filter(function (r) { return res.loot[r] > 0; })
        .map(function (r) { return '<span class="costtag">' + resIcoTag(r, 22) + Math.round(res.loot[r]) + '</span>'; }).join(' ') + '</div>';
    }
    html += '<button class="btn full battle-ok">Schließen</button>';
    dom.battleBody.innerHTML = html;
    paintResIcons(dom.battleBody);
    Array.prototype.forEach.call(dom.battleBody.querySelectorAll('canvas[data-unit]'), function (c) {
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      S.drawUnitIcon(ctx, 3, 0, 4, c.getAttribute('data-unit'));
    });
    var okb = dom.battleBody.querySelector('.battle-ok');
    if (okb) okb.addEventListener('click', closeBattle);
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
    html += '<div class="vv-col"><h2>Gebäude</h2>';
    html += '<div class="bld-grid">';
    Object.keys(C.BUILDINGS).forEach(function (key) { html += buildingCardHtml(v, key); });
    html += '</div>';
    html += buildQueueHtml(v);
    html += '</div>';
    html += '<div class="vv-col"><h2>Kaserne &amp; Verteidigung</h2>';
    html += militaryHtml(v);
    html += '</div>';
    html += '</div>';
    dom.villageBody.innerHTML = html;
    attachVillageEvents(v);
  }

  function buildQueueHtml(v) {
    if (!v.buildQueue.length) return '';
    var html = '<div class="queue"><b>Bau-Warteschlange:</b> ';
    html += v.buildQueue.map(function (q) {
      return C.BUILDINGS[q.key].name + ' →' + q.target + ' (' + fmtTime(q.timeLeft) + ')';
    }).join(' · ');
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
    var bonusTxt = C.RESOURCES.map(function (r) {
      var b = v.bonus[r];
      var cls = b > 1.25 ? 'good' : (b < 0.95 ? 'bad' : '');
      return '<span class="' + cls + '">' + C.RESOURCE_META[r].name + ' ×' + b.toFixed(2) + '</span>';
    }).join(' · ');
    html += '<div class="bonus-box"><b>Standortboni:</b> ' + bonusTxt + '</div>';

    // Verteidigungsübersicht
    var def = WOH.Combat.defensePower(v.units, v.buildings.wall || 0, v.buildings.tower || 0);
    html += '<div class="def-box"><b>Verteidigungskraft:</b> ' + fmt(def) +
      ' &nbsp;|&nbsp; Palisade ' + (v.buildings.wall || 0) + ' · Turm ' + (v.buildings.tower || 0) + '</div>';

    // Ausbildung
    if (v.trainingQueue.length) {
      html += '<div class="queue"><b>Ausbildung:</b> ' + v.trainingQueue.map(function (q) {
        return C.UNITS[q.unit].name + ' ×' + q.remaining + ' (' + fmtTime(q.timeLeft) + ')';
      }).join(' · ') + '</div>';
    }

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
    dom.sideTop.innerHTML = incomingHtml() + outgoingHtml() + targetHtml();
    attachSidebarEvents();
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

  // Eigene Bewegungen: Angriffe/Unterstützung unterwegs sowie Rückkehrer.
  function outgoingHtml() {
    var mine = state.movements.filter(function (m) {
      return m.ownerHouseId === state.playerHouseId;
    }).sort(function (a, b) { return a.arriveTime - b.arriveTime; });
    if (!mine.length) return '';
    var html = '<div class="panel"><h3>↗ Eigene Bewegungen (' + mine.length + ')</h3>';
    mine.forEach(function (m) {
      var to = state.villages[m.toId];
      var eta = m.arriveTime - state.gameTime;
      var sym = m.type === 'attack' ? '⚔ Angriff' : (m.type === 'support' ? '⛨ Hilfe' : '↩ Rückkehr');
      var dest = to ? (to.name + villageTag(to)) : '—';
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

  function incomingHtml() {
    var own = {};
    G.villagesOfHouse(state, state.playerHouseId).forEach(function (v) { own[v.id] = v; });
    var incoming = state.movements.filter(function (m) {
      return m.type === 'attack' && own[m.toId];
    }).sort(function (a, b) { return a.arriveTime - b.arriveTime; });
    if (!incoming.length) return '<div class="panel"><h3>Eingehende Angriffe</h3><p class="muted">Keine. Das Land ist ruhig.</p></div>';
    var html = '<div class="panel danger"><h3>⚔ Eingehende Angriffe (' + incoming.length + ')</h3>';
    incoming.forEach(function (m) {
      var from = state.villages[m.fromId];
      var house = from ? state.houses[from.houseId] : null;
      var eta = m.arriveTime - state.gameTime;
      html += '<div class="incoming"><b>' + (house ? house.name : '?') + '</b><br>' +
        '→ ' + state.villages[m.toId].name + villageTag(state.villages[m.toId]) + '<br>' +
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
      html += '<div class="def-box small">Garnison — ' + unitsInline(t.units) + '</div></div>';
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
    html += '<button class="btn full attack-btn">⚔ Angriff entsenden</button>';
    html += '<button class="btn full ghost support-btn">⛨ Unterstützung senden</button>';
    html += '<div class="muted small" style="margin-top:6px">Held mitschicken ⇒ Eroberung bei Sieg (Held geht verloren).</div>';
    html += '</div></div>';
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
