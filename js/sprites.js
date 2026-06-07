/* =========================================================================
 * World of Houses – Grafik (echte Pixel-Art-Assets aus /assets)
 * Gelände, Siedlungen und Ressourcen-Icons stammen aus den Spritesheets;
 * Gebäude-/Einheiten-Icons der Dorfansicht bleiben prozedural.
 * Quelle: assets/tileset2.png (16x16-Raster), assets/water.png (animiert).
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config;

  // Tile-Atlas (aus js/atlas.js, generiert aus assets/tiles.json).
  var A = WOH.Atlas || {};
  var T = A.tileSize || 16;                                  // Quell-Kachelgröße
  var SHEETS = A.sheets || { ts2: 'assets/tileset2.png', mtn: 'assets/mountains.png', ts1: 'assets/tileset.png' };
  var TILE = A.terrain || { grass: [1, 1], forest: [5, 0], mountain: [6, 0] };
  var WATER = A.water || {
    open: [3, 2], waves: [],
    edge:  { n: [1, 2], s: [1, 0], w: [2, 1], e: [0, 1] },
    outer: { nw: [3, 0], ne: [4, 0], sw: [3, 1], se: [4, 1] },
    inner: { ne: [0, 2], nw: [2, 2], se: [0, 0], sw: [2, 0] }
  };
  var STRUCT = A.structures || {
    castle: [[8, 5], [8, 6], [8, 7]], city: [[12, 5], [12, 6], [12, 7], [12, 8]],
    woodcutter: [[0, 5], [0, 6], [0, 7]], ironmine: [[2, 5], [2, 6], [2, 7]],
    farmstead: [[4, 5], [4, 6], [4, 7]], sheepfarm: [[6, 5], [6, 6], [6, 7]],
    harbor: [[10, 5], [10, 6], [10, 7]]
  };
  var RES_TILE = A.resources || { food: [3, 4], wood: [0, 4], stone: [1, 4], iron: [6, 4] };
  var BORDER = A.border || {
    tl: [11, 1], t: [12, 1], tr: [13, 1], l: [11, 2], r: [13, 2],
    bl: [11, 3], b: [12, 3], br: [13, 3]
  };

  // Geladene Bild-Assets
  var IMG = {};
  var ready = false;

  // Fallback-Basisfarben (falls ein Asset fehlt)
  var TERRAIN_BASE = {
    grass: '#3c5238', forest: '#22381f', mountain: '#5a5751',
    water: '#1f3e54', field: '#5c5430'
  };

  // ---- Asset-Loader (Promise) -----------------------------------------
  function loadAssets() {
    var keys = Object.keys(SHEETS);
    return Promise.all(keys.map(function (k) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { IMG[k] = img; resolve(); };
        img.onerror = function () { IMG[k] = null; resolve(); }; // tolerant
        img.src = SHEETS[k];
      });
    })).then(function () { ready = true; });
  }

  function hash(x, y, salt) {
    var h = (x * 374761393 + y * 668265263 + (salt || 0) * 2654435761) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function tileAt(map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 'water';
    return map.tiles[y * map.width + x];
  }
  function nearWater(map, x, y) {
    return tileAt(map, x - 1, y) === 'water' || tileAt(map, x + 1, y) === 'water' ||
           tileAt(map, x, y - 1) === 'water' || tileAt(map, x, y + 1) === 'water';
  }

  // Zeichne eine Sheet-Kachel (col,row) skaliert nach (dx,dy,dw,dh).
  function blit(ctx, sheet, col, row, dx, dy, dw, dh) {
    var img = IMG[sheet];
    if (!img) { ctx.fillStyle = '#333'; ctx.fillRect(dx, dy, dw, dh); return; }
    ctx.drawImage(img, col * T, row * T, T, T, dx, dy, dw, dh);
  }
  // Wasserfeld: passende Küstenkachel anhand der Land-Nachbarn wählen.
  // WICHTIG: Kacheln werden NIE rotiert – das Sheet liefert eigene Stücke für
  // jede Kante, Außen- und Innenecke (Wasser-Blob in Gras).
  //   outer = zwei orthogonale Landseiten · edge = eine · inner = nur diagonal.
  function drawWater(ctx, map, x, y, ox, oy, d) {
    function land(xx, yy) { return tileAt(map, xx, yy) !== 'water'; }
    var n = land(x, y - 1), s = land(x, y + 1), w = land(x - 1, y), e = land(x + 1, y);
    var W = WATER, tile;
    if (n && w) tile = W.outer.nw;
    else if (n && e) tile = W.outer.ne;
    else if (s && w) tile = W.outer.sw;
    else if (s && e) tile = W.outer.se;
    else if (n) tile = W.edge.n;
    else if (s) tile = W.edge.s;
    else if (w) tile = W.edge.w;
    else if (e) tile = W.edge.e;
    else {
      // Keine orthogonale Landseite – ggf. diagonale Innenecke?
      if (land(x + 1, y - 1)) tile = W.inner.ne;
      else if (land(x - 1, y - 1)) tile = W.inner.nw;
      else if (land(x + 1, y + 1)) tile = W.inner.se;
      else if (land(x - 1, y + 1)) tile = W.inner.sw;
      else {
        // Offenes Wasser: gelegentlich eine Wellen-Variante.
        var r = hash(x, y, 70);
        if (r < 0.82 || !(W.waves && W.waves.length)) tile = W.open;
        else tile = W.waves[Math.floor(hash(x, y, 72) * W.waves.length)];
      }
    }
    if (!tile) tile = W.open || [3, 2];
    blit(ctx, 'ts2', tile[0], tile[1], ox, oy, d, d);
  }

  // ---- Gelände einmalig rendern ---------------------------------------
  function buildTerrainCanvas(map) {
    var ts = C.MAP.tileSize;
    var cv = document.createElement('canvas');
    cv.width = map.width * ts; cv.height = map.height * ts;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    for (var y = 0; y < map.height; y++) {
      for (var x = 0; x < map.width; x++) {
        var t = map.tiles[y * map.width + x];
        var ox = x * ts, oy = y * ts;

        if (t === 'water') {
          drawWater(ctx, map, x, y, ox, oy, ts);
          continue;
        }
        // Grasuntergrund für alle Landfelder
        blit(ctx, 'ts2', TILE.grass[0], TILE.grass[1], ox, oy, ts, ts);

        if (t === 'forest') {
          blit(ctx, 'ts2', TILE.forest[0], TILE.forest[1], ox, oy, ts, ts);
        } else if (t === 'mountain') {
          blit(ctx, 'ts2', TILE.mountain[0], TILE.mountain[1], ox, oy, ts, ts);
        } else if (t === 'field') {
          decorateField(ctx, x, y, ox, oy, ts);
        } else if (t === 'grass') {
          decorateGrass(ctx, x, y, ox, oy, ts);
        }
      }
    }
    drawBorder(ctx, map.width, map.height, ts);
    return cv;
  }

  // Dekorativer Holzrahmen am äußersten Spielfeldring (9-Slice, nicht rotiert).
  function drawBorder(ctx, w, h, ts) {
    if (!IMG.ts2) return;
    var b = BORDER;
    for (var x = 1; x < w - 1; x++) {
      blit(ctx, 'ts2', b.t[0], b.t[1], x * ts, 0, ts, ts);
      blit(ctx, 'ts2', b.b[0], b.b[1], x * ts, (h - 1) * ts, ts, ts);
    }
    for (var y = 1; y < h - 1; y++) {
      blit(ctx, 'ts2', b.l[0], b.l[1], 0, y * ts, ts, ts);
      blit(ctx, 'ts2', b.r[0], b.r[1], (w - 1) * ts, y * ts, ts, ts);
    }
    blit(ctx, 'ts2', b.tl[0], b.tl[1], 0, 0, ts, ts);
    blit(ctx, 'ts2', b.tr[0], b.tr[1], (w - 1) * ts, 0, ts, ts);
    blit(ctx, 'ts2', b.bl[0], b.bl[1], 0, (h - 1) * ts, ts, ts);
    blit(ctx, 'ts2', b.br[0], b.br[1], (w - 1) * ts, (h - 1) * ts, ts, ts);
  }

  // Felder: goldene Furchen auf Gras (kein sauberes reines Feld-Asset vorhanden)
  function decorateField(ctx, gx, gy, ox, oy, ts) {
    ctx.fillStyle = 'rgba(150,138,58,0.55)';
    for (var fy = oy + 4; fy < oy + ts - 2; fy += 6) ctx.fillRect(ox + 2, fy, ts - 4, 3);
    ctx.fillStyle = 'rgba(120,108,42,0.5)';
    for (var fy2 = oy + 7; fy2 < oy + ts - 2; fy2 += 6) ctx.fillRect(ox + 2, fy2, ts - 4, 1);
  }
  // Wiese: dezente Grasbüschel/Blumen für Lebendigkeit
  function decorateGrass(ctx, gx, gy, ox, oy, ts) {
    var r = hash(gx, gy, 5);
    if (r > 0.6) {
      ctx.fillStyle = '#46603c';
      var bx = ox + hash(gx, gy, 6) * ts * 0.7, by = oy + hash(gx, gy, 7) * ts * 0.7;
      ctx.fillRect(bx, by, 2, 3); ctx.fillRect(bx + 3, by + 1, 2, 2);
    }
    if (r > 0.9) {
      var fx = ox + hash(gx, gy, 8) * ts * 0.8, fy = oy + hash(gx, gy, 9) * ts * 0.8;
      ctx.fillStyle = hash(gx, gy, 11) > 0.5 ? '#d8c45a' : '#c87a96';
      ctx.fillRect(fx, fy, 2, 2);
    }
  }

  // Größenstufe (0=basic,1=medium,2=large) nach Punktzahl.
  function sizeTier(score) {
    if (score < 12) return 0;
    if (score < 26) return 1;
    return 2;
  }

  // Generische Struktur zeichnen (transparente Sprites, ohne Hintergrund).
  // type: castle|city|woodcutter|ironmine|farmstead|sheepfarm|harbor
  // Sprite-Quelle: assets/tileset2.png (16x16-Raster), gerade Spalten
  //   castle 8, city 12, woodcutter 0, ironmine 2, farmstead 4, sheepfarm 6,
  //   harbor 10; Reihen 5/6/7 = basic/medium/large (Stadt zusaetzlich 8).
  function drawStructure(ctx, px, py, size, type, tier) {
    var variants = STRUCT[type] || STRUCT.castle;
    tier = Math.max(0, Math.min(variants.length - 1, tier | 0));
    var coord = variants[tier];
    var s = size * 1.25;
    var dx = px - s / 2, dy = py - s * 0.62;
    blit(ctx, 'ts2', coord[0], coord[1], dx, dy, s, s);
    return { dx: dx, dy: dy, s: s };
  }

  // Eroberbare Rohstoff-Struktur zeichnen (Schritt 4):
  // - Sprite-Variante nach structure.level (1/2/3 -> basic/medium/large).
  // - Besitzer-Indikator: kleines Wappen-Crest neben dem Sprite (wie das
  //   Wappen-Label bei Burgen). Neutrale Strukturen: kein Crest.
  // - Hover/Selection: gestrichelter Rahmen analog drawVillageMarker.
  // opts: { selected?: boolean, hover?: boolean }
  // house: Haus-Objekt mit .sigil { p, s } oder null fuer neutral.
  function drawResourceStructure(ctx, px, py, size, structure, opts, house) {
    opts = opts || {};
    var lvl = (typeof structure.level === 'number') ? structure.level
            : (typeof structure.tier === 'number') ? (structure.tier + 1) : 1;
    var tier = Math.max(0, Math.min(2, lvl - 1));
    var box = drawStructure(ctx, px, py, size, structure.type, tier);
    // Besitzer-Crest direkt links oben am Sprite (klein, klar erkennbar).
    if (house && house.sigil) {
      var crestSz = Math.max(6, Math.round(size * 0.22));
      var cx = Math.round(box.dx + 1), cy = Math.round(box.dy + 1);
      drawCrest(ctx, cx, cy, crestSz, house.sigil);
    }
    // Selektion: gestrichelter Rahmen wie bei Burg-Marker.
    if (opts.selected) {
      ctx.strokeStyle = '#e8d7a0'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.strokeRect(box.dx - 1, box.dy - 1, box.s + 2, box.s + 2);
      ctx.setLineDash([]);
    } else if (opts.hover) {
      ctx.strokeStyle = 'rgba(232,215,160,0.6)'; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(box.dx - 1, box.dy - 1, box.s + 2, box.s + 2);
      ctx.setLineDash([]);
    }
    return box;
  }

  // Kleines Wappen-Schild (zweifarbig) – für Labels/HUD.
  function drawCrest(ctx, x, y, sz, sigil) {
    var p = (sigil && sigil.p) || '#888', sc = (sigil && sigil.s) || '#ddd';
    ctx.fillStyle = '#15110d'; ctx.fillRect(x - 1, y - 1, sz + 2, sz + 2);
    ctx.fillStyle = p; ctx.fillRect(x, y, sz, sz);
    ctx.fillStyle = sc;
    ctx.beginPath();
    ctx.moveTo(x, y + sz); ctx.lineTo(x + sz, y); ctx.lineTo(x + sz, y + sz); ctx.closePath();
    ctx.fill();
  }

  // ---- Dorf-/Burgmarker (Haus-Sitz) -----------------------------------
  function drawVillageMarker(ctx, px, py, size, house, opts) {
    opts = opts || {};
    var tier = (typeof opts.tier === 'number') ? opts.tier : sizeTier(opts.score || 0);
    var box = drawStructure(ctx, px, py, size, opts.type || 'castle', tier);
    if (opts.selected) {
      ctx.strokeStyle = '#e8d7a0'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.strokeRect(box.dx - 1, box.dy - 1, box.s + 2, box.s + 2); ctx.setLineDash([]);
    }
  }

  // ---- Icon-Helfer (prozedurale Matrizen) -----------------------------
  function drawMatrix(ctx, x, y, scale, rows, pal) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row[c];
        if (ch === ' ' || ch === '.') continue;
        ctx.fillStyle = pal[ch] || '#000';
        ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
      }
    }
  }

  // ---- Ressourcen-Icons aus dem Sheet als Daten-URL -------------------
  var resIconCache = {};
  function resourceIconURL(res, px) {
    px = px || 2;
    var key = res + '_' + px;
    if (resIconCache[key]) return resIconCache[key];
    var size = T * px;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    var coord = RES_TILE[res];
    if (IMG.ts2 && coord) {
      ctx.drawImage(IMG.ts2, coord[0] * T, coord[1] * T, T, T, 0, 0, size, size);
    }
    var url = cv.toDataURL();
    resIconCache[key] = url;
    return url;
  }
  function drawResourceIcon(ctx, x, y, px, res) {
    var coord = RES_TILE[res];
    if (IMG.ts2 && coord) ctx.drawImage(IMG.ts2, coord[0] * T, coord[1] * T, T, T, x, y, T * px, T * px);
  }

  // ---- Gebäude-Icons (12x12, prozedural) ------------------------------
  var BUILDING_ART = {
    townhall: ['','    aa      ','   abba     ','  abbbba    ',' cccccccc   ',' cddddddc   ',' cddeedda   ',' cddeedda   ',' cddddddc   ',' cccccccc   ','',''],
    woodcutter: ['','  f         ',' fff   gg   ','fffff  gg   ',' fff  hgih  ','  f   hgih  ','  f    ii   ','       ii   ','','','',''],
    quarry: ['','','  jjj jj    ',' jjjjjjj    ','jjkjjjkj    ',' jjjjjj     ','  jkjjk     ','   jjj      ','','','',''],
    mine: ['','   ll       ','  llll  mm  ',' ll ll  mm  ','ll  ll nmmn ','    ll  mm  ','    ll  mm  ','','','','',''],
    farm: ['','            ','  ooo  ppp  ',' ooooo pppp ','  ooo  pppp ',' q q q pppp ',' q q q      ','','','','',''],
    warehouse: ['','  rrrrrr    ',' rsssssr    ',' rs r sr    ',' rssssss    ',' rs r sr    ',' rssssss    ',' rrrrrr     ','','','',''],
    barracks: ['','   t  t     ','  tttttt    ',' tuuuuuut   ',' tu vv ut   ',' tuuuuuut   ',' tu vv ut   ',' tttttttt   ','','','',''],
    range: ['','    w       ','   ww x     ','  w  wxx    ',' w   w xx   ','  w  wxx    ','   ww x     ','    w       ','','','',''],
    wall: ['','            ','yy yy yy yy ','yyyyyyyyyy  ','yyyyyyyyyy  ','yyyyyyyyyy  ','yyyyyyyyyy  ','yyyyyyyyyy  ','','','',''],
    tower: ['','   zz zz    ','   zzzzz    ','   zAAAz    ','   zAAAz    ','   zAAAz    ','   zAAAz    ','   zzzzz    ','','','','']
  };
  var BUILDING_PAL = {
    a: '#b23b3b', b: '#7d2b2b', c: '#5b5550', d: '#8a8278', e: '#2a2622',
    f: '#6b4a1f', g: '#2e4a1e', h: '#8a8278', i: '#5b5550',
    j: '#9aa0a6', k: '#6b7178', l: '#54514c', m: '#b8c4d0', n: '#7d2b2b',
    o: '#c8a24a', p: '#8a9a3a', q: '#6b5a2a',
    r: '#6b4a1f', s: '#a07a3a',
    t: '#3a3733', u: '#7d2b2b', v: '#e8d7a0',
    w: '#7a5a2a', x: '#cdd8e8',
    y: '#6b6660', z: '#5b5550', A: '#2b4a7d'
  };
  function drawBuildingIcon(ctx, x, y, px, key) {
    var art = BUILDING_ART[key]; if (!art) return;
    drawMatrix(ctx, x, y, px, art, BUILDING_PAL);
  }

  // ---- Einheiten-Icons (prozedural) -----------------------------------
  var UNIT_ART = {
    spear: ['  s ','  s ',' hh ','bbbb','bbbb',' bb ',' bb ',' ll '],
    sword: ['  k ',' hh ','bBBb','bBBb',' BB ',' BB ',' ll ',' ll '],
    axe:   [' a  ','aah ','aBBb','bBBb',' BB ',' BB ',' ll ',' ll '],
    archer:[' hh ',' bb ','wbbw','wbbw',' bb ',' bb ',' ll ',' ll '],
    // Held = Krone
    hero:  ['      ',
            'g g g ',
            'ggggg ',
            'gjgjg ',
            'ggggg ',
            '      ',
            '      ',
            '      ']
  };
  var UNIT_PAL = {
    s: '#9aa0a6', h: '#d8b48a', b: '#3a4250', B: '#586273',
    l: '#2a2622', k: '#cdd8e8', a: '#7d2b2b', w: '#6b4a1f',
    g: '#e8c84a', j: '#b23b3b'
  };
  function drawUnitIcon(ctx, x, y, px, key) {
    var art = UNIT_ART[key]; if (!art) return;
    drawMatrix(ctx, x, y, px, art, UNIT_PAL);
  }

  WOH.Sprites = {
    loadAssets: loadAssets,
    isReady: function () { return ready; },
    buildTerrainCanvas: buildTerrainCanvas,
    drawVillageMarker: drawVillageMarker,
    drawBuildingIcon: drawBuildingIcon,
    drawUnitIcon: drawUnitIcon,
    drawResourceIcon: drawResourceIcon,
    resourceIconURL: resourceIconURL,
    drawStructure: drawStructure,
    drawResourceStructure: drawResourceStructure,
    drawCrest: drawCrest,
    sizeTier: sizeTier,
    TERRAIN_BASE: TERRAIN_BASE,
    // Sprite-Indizes pro Strukturtyp/Level (zur Dokumentation; aus Atlas):
    //   Spalte/Reihe in assets/tileset2.png (16x16-Raster).
    //   Level 1 -> Reihe 5 (basic), Level 2 -> Reihe 6, Level 3 -> Reihe 7.
    //   castle col 8, city col 12, woodcutter 0, ironmine 2, farmstead 4,
    //   sheepfarm 6, harbor 10.
    STRUCTURE_SPRITES: STRUCT
  };
})(window.WOH = window.WOH || {});
