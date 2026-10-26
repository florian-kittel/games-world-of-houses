/* Fixed-orientation scenery, overlapping ground and zoom-aware terrain chunks. */
(function (WOH) {
  'use strict';
  var assets = {};
  ['grass-01', 'grass-02', 'field-01', 'water-01', 'forest-01', 'forest-02', 'forest-03', 'rock-01', 'rock-02', 'rock-03'].forEach(function (id) {
    assets['cine_' + id] = 'assets/cinematic/v2/' + id + '.png';
  });
  ['castle', 'woodcutter', 'ironmine', 'stonemine', 'farmstead', 'sheepfarm'].forEach(function (type) {
    for (var n = 1; n <= 3; n++) assets['cine_' + type + '-0' + n] = 'assets/cinematic/v2/' + type + '-0' + n + '.png';
  });
  ['rock-ore-01', 'rock-ore-02', 'rock-quarry-01', 'rock-quarry-02'].forEach(function (id) {
    assets['cine_' + id] = 'assets/cinematic/v2/' + id + '.png';
  });
  // Roof/canopy plans replace the oblique studies for every raised object.
  Object.keys(assets).forEach(function (key) {
    if (!/^cine_(grass|field|water)-/.test(key)) assets[key] = assets[key].replace('/v2/', '/v2/topdown/');
  });
  function hash(x, y, salt) {
    var h = Math.imul(x + 173, 374761393) ^ Math.imul(y + 419, 668265263) ^ Math.imul(salt, 1597334677);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function canvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function available(images, prefix, count) {
    var list = [];
    for (var i = 1; i <= count; i++) if (images['cine_' + prefix + '-0' + i]) list.push(images['cine_' + prefix + '-0' + i]);
    return list;
  }
  function isReady(images) {
    return !!(images['cine_grass-01'] && images['cine_forest-01'] && images['cine_rock-01']);
  }
  function feather(img) {
    var c = canvas(768, 768), g = c.getContext('2d');
    g.drawImage(img, 0, 0, 768, 768); g.globalCompositeOperation = 'destination-in';
    var mask = g.createRadialGradient(384, 384, 130, 384, 384, 380);
    mask.addColorStop(0, '#fff'); mask.addColorStop(.65, 'rgba(255,255,255,.9)'); mask.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = mask; g.fillRect(0, 0, 768, 768); return c;
  }
  // March between tile centres, then smooth whole closed contours, rather than
  // round each water cell separately. Shared geometry also preserves islands.
  function shoreline(map, ts) {
    var links = new Map(), points = new Map(), loops = [];
    var pairs = [[], [[3,0]], [[0,1]], [[3,1]], [[1,2]], [[3,0],[1,2]], [[0,2]], [[3,2]],
      [[2,3]], [[0,2]], [[0,1],[2,3]], [[1,2]], [[1,3]], [[0,1]], [[3,0]], []];
    function wet(x, y) { return x >= 0 && y >= 0 && x < map.width && y < map.height && map.tiles[y * map.width + x] === 'water'; }
    function key(p) { return p[0] + ',' + p[1]; }
    function connect(a, b) {
      var ka = key(a), kb = key(b);
      points.set(ka, a); points.set(kb, b);
      if (!links.has(ka)) links.set(ka, []);
      if (!links.has(kb)) links.set(kb, []);
      links.get(ka).push(kb); links.get(kb).push(ka);
    }
    for (var y = -1; y < map.height; y++) for (var x = -1; x < map.width; x++) {
      var mask = (wet(x,y) ? 1 : 0) | (wet(x+1,y) ? 2 : 0) | (wet(x+1,y+1) ? 4 : 0) | (wet(x,y+1) ? 8 : 0);
      var e = [[x+1,y+.5], [x+1.5,y+1], [x+1,y+1.5], [x+.5,y+1]];
      pairs[mask].forEach(function (pair) { connect(e[pair[0]], e[pair[1]]); });
    }
    var seen = new Set();
    links.forEach(function (_, start) {
      if (seen.has(start)) return;
      var current = start, previous = null, poly = [];
      do {
        seen.add(current); poly.push(points.get(current));
        var next = links.get(current), following = next[0] === previous ? next[1] : next[0];
        previous = current; current = following;
      } while (current !== start && current && !seen.has(current));
      // Chaikin corner cutting keeps the contour inside its local tile envelope.
      for (var pass = 0; pass < 2; pass++) {
        var smooth = [];
        for (var i = 0; i < poly.length; i++) {
          var a = poly[i], b = poly[(i+1) % poly.length];
          smooth.push([a[0]*.75+b[0]*.25, a[1]*.75+b[1]*.25], [a[0]*.25+b[0]*.75, a[1]*.25+b[1]*.75]);
        }
        poly = smooth;
      }
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      var final = poly.map(function (p, i) {
        var prev = poly[(i+poly.length-1)%poly.length], next = poly[(i+1)%poly.length];
        var dx = next[0]-prev[0], dy = next[1]-prev[1], length = Math.sqrt(dx*dx+dy*dy) || 1;
        // Coherent bends break long grid-aligned banks without moving cell
        // centres; a smaller ripple supplies gravel-scale irregularity.
        var ux = p[0]/1.7, uy = p[1]/1.7, ix = Math.floor(ux), iy = Math.floor(uy);
        var tx = ux-ix, ty = uy-iy; tx = tx*tx*(3-2*tx); ty = ty*ty*(3-2*ty);
        var top = hash(ix,iy,60)*(1-tx)+hash(ix+1,iy,60)*tx;
        var bottom = hash(ix,iy+1,60)*(1-tx)+hash(ix+1,iy+1,60)*tx;
        var ripple = (top*(1-ty)+bottom*ty-.5)*.24 + (hash(Math.round(p[0]*32), Math.round(p[1]*32), 61)-.5)*.025;
        var px = (p[0]-dy/length*ripple)*ts, py = (p[1]+dx/length*ripple)*ts;
        minX = Math.min(minX,px); maxX = Math.max(maxX,px); minY = Math.min(minY,py); maxY = Math.max(maxY,py);
        return [px,py];
      });
      loops.push({ points: final, minX: minX, minY: minY, maxX: maxX, maxY: maxY });
    });
    return loops;
  }
  function terrain(map, images, structures) {
    var ts = WOH.Config.MAP.tileSize, width = map.width * ts, height = map.height * ts;
    var ground = available(images, 'grass', 2).map(feather);
    var field = images['cine_field-01'] ? feather(images['cine_field-01']) : ground[0];
    var water = images['cine_water-01'] ? feather(images['cine_water-01']) : null;
    var forests = available(images, 'forest', 3), rocks = available(images, 'rock', 3);
    var oreRocks = available(images, 'rock-ore', 2), quarryRocks = available(images, 'rock-quarry', 2);
    var mineralNeighbours = [];
    // Only the eight directly touching mountain cells change their appearance.
    // A bitmask makes shared neighbours independent of structure array order.
    (structures || []).forEach(function (s) {
      var bit = s.type === 'ironmine' ? 1 : s.type === 'stonemine' ? 2 : 0;
      if (!bit) return;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = s.x + dx, ny = s.y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        var index = ny * map.width + nx;
        if (map.tiles[index] === 'mountain') mineralNeighbours[index] = (mineralNeighbours[index] || 0) | bit;
      }
    });
    var objects = [], chosen = [], chunkTiles = 8, chunkSize = chunkTiles * ts;
    var cache = new Map(), cacheBytes = 0, maxBytes = 64 * 1024 * 1024;
    function tile(x, y) {
      return x < 0 || y < 0 || x >= map.width || y >= map.height ? 'outside' : map.tiles[y * map.width + x];
    }
    for (var y = 0; y < map.height; y++) for (var x = 0; x < map.width; x++) {
      var type = tile(x, y), variants = type === 'forest' ? forests : type === 'mountain' ? rocks : null;
      if (type === 'mountain') {
        var mineral = mineralNeighbours[y * map.width + x];
        if (mineral === 3) mineral = hash(x, y, 51) < .5 ? 1 : 2;
        if (mineral === 1 && oreRocks.length) variants = oreRocks;
        if (mineral === 2 && quarryRocks.length) variants = quarryRocks;
      }
      if (!variants || !variants.length) continue;
      var candidates = [], left = tile(x - 1, y) === type ? chosen[y * map.width + x - 1] : -1;
      var above = tile(x, y - 1) === type ? chosen[(y - 1) * map.width + x] : -1;
      for (var v = 0; v < variants.length; v++) if (variants[v] !== left && variants[v] !== above) candidates.push(v);
      if (!candidates.length) for (var all = 0; all < variants.length; all++) candidates.push(all);
      var variant = candidates[Math.floor(hash(x, y, 19) * candidates.length)];
      chosen[y * map.width + x] = variants[variant];
      if (type === 'forest' && hash(x, y, 24) < .07 && tile(x - 1, y) === type && tile(x + 1, y) === type && tile(x, y - 1) === type && tile(x, y + 1) === type) continue;
      var img = variants[variant], size = ts * ((type === 'forest' ? 1.5 : 1.65) + hash(x, y, 20) * .3);
      var px = (x + .5 + (hash(x, y, 21) - .5) * .5) * ts;
      var py = (y + .5 + (hash(x, y, 22) - .5) * .5) * ts, h = size * img.height / img.width;
      objects.push({ image: img, x: px - size / 2, y: py - h / 2, width: size, height: h, foot: py });
    }
    objects.sort(function (a, b) { return a.foot - b.foot || a.x - b.x; });
    var shores = shoreline(map, ts);
    function shorePath(ctx, visible) {
      ctx.beginPath();
      visible.forEach(function (loop) {
        loop.points.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.closePath();
      });
    }
    function buildChunk(cx, cy, density) {
      var x0 = cx * chunkSize, y0 = cy * chunkSize;
      var w = Math.min(chunkSize, width - x0), h = Math.min(chunkSize, height - y0);
      // One opaque world-pixel of bleed also prevents hairlines when the screen
      // transform samples neighbouring chunk edges at fractional device pixels.
      var c = canvas((w + 2) * density, (h + 2) * density), ctx = c.getContext('2d');
      ctx.scale(density, density); ctx.translate(-x0 + 1, -y0 + 1);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#525d3c'; ctx.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
      // A two-cell apron gives neighbouring chunks identical edge overlaps.
      var minX = Math.max(0, cx * chunkTiles - 2), minY = Math.max(0, cy * chunkTiles - 2);
      var maxX = Math.min(map.width, (cx + 1) * chunkTiles + 2), maxY = Math.min(map.height, (cy + 1) * chunkTiles + 2);
      for (var gy = minY; gy < maxY; gy++) for (var gx = minX; gx < maxX; gx++) {
        var g = ground[Math.floor(hash(gx, gy, 30) * ground.length)];
        ctx.drawImage(g, (gx - .65) * ts, (gy - .65) * ts, ts * 2.3, ts * 2.3);
      }
      for (var fy = minY; fy < maxY; fy++) for (var fx = minX; fx < maxX; fx++) {
        var kind = tile(fx, fy);
        if (kind === 'field') ctx.drawImage(field, (fx - .65) * ts, (fy - .65) * ts, ts * 2.3, ts * 2.3);
        else if (kind === 'forest' || kind === 'mountain') {
          var tint = ctx.createRadialGradient((fx + .5) * ts, (fy + .5) * ts, 0, (fx + .5) * ts, (fy + .5) * ts, ts);
          tint.addColorStop(0, kind === 'forest' ? 'rgba(20,32,19,.45)' : 'rgba(59,54,45,.35)');
          tint.addColorStop(1, 'rgba(30,35,25,0)'); ctx.fillStyle = tint;
          ctx.fillRect((fx - .5) * ts, (fy - .5) * ts, ts * 2, ts * 2);
        }
      }
      var visibleShores = shores.filter(function (s) { return s.maxX >= x0-ts && s.minX <= x0+w+ts && s.maxY >= y0-ts && s.minY <= y0+h+ts; });
      shorePath(ctx, visibleShores);
      ctx.lineJoin = ctx.lineCap = 'round';
      // Layer translucent earth over the existing ground texture; no solid
      // rectangular coast stamps, so every bay and island uses the same bank.
      ctx.strokeStyle = 'rgba(76,73,49,.28)'; ctx.lineWidth = ts*.30; ctx.stroke();
      ctx.strokeStyle = 'rgba(156,147,113,.32)'; ctx.lineWidth = ts*.16; ctx.stroke();
      visibleShores.forEach(function (loop) {
        // Short overlapping translucent strokes vary bank width and material,
        // keeping the ground texture visible instead of a uniform outline.
        for (var bi = 0; bi < loop.points.length; bi++) {
          var bp = loop.points[bi], bn = loop.points[(bi+1)%loop.points.length];
          if (Math.max(bp[0],bn[0]) < x0-ts || Math.min(bp[0],bn[0]) > x0+w+ts || Math.max(bp[1],bn[1]) < y0-ts || Math.min(bp[1],bn[1]) > y0+h+ts) continue;
          var bx = Math.floor(bp[0]/(ts*.55)), by = Math.floor(bp[1]/(ts*.55));
          ctx.beginPath(); ctx.moveTo(bp[0],bp[1]); ctx.lineTo(bn[0],bn[1]);
          ctx.lineWidth = ts*(.10+hash(bx,by,65)*.16);
          ctx.strokeStyle = hash(bx,by,66) < .45 ? 'rgba(135,128,100,.16)' : 'rgba(75,80,56,.19)';
          ctx.stroke();
        }
      });
      shorePath(ctx, visibleShores);
      ctx.fillStyle = '#294550'; ctx.fill('evenodd');
      if (water) {
        ctx.save(); ctx.clip('evenodd');
        for (var iy = Math.floor(minY / 2) - 1; iy <= Math.floor(maxY / 2) + 1; iy++)
          for (var ix = Math.floor(minX / 2) - 1; ix <= Math.floor(maxX / 2) + 1; ix++)
            ctx.drawImage(water, (ix * 2 - 1) * ts, (iy * 2 - 1) * ts, ts * 4, ts * 4);
        ctx.restore();
      }
      ctx.save(); ctx.clip('evenodd');
      // The shoreward half of these strokes produces shallow water, with the
      // deeper centre retaining its detailed water material.
      ctx.strokeStyle = 'rgba(80,119,112,.16)'; ctx.lineWidth = ts*.68; ctx.stroke();
      ctx.strokeStyle = 'rgba(100,137,122,.20)'; ctx.lineWidth = ts*.40; ctx.stroke();
      ctx.strokeStyle = 'rgba(158,167,132,.28)'; ctx.lineWidth = ts*.16; ctx.stroke();
      ctx.restore();
      visibleShores.forEach(function (loop) {
        loop.points.forEach(function (p) {
          if (p[0] < x0-2 || p[0] > x0+w+2 || p[1] < y0-2 || p[1] > y0+h+2) return;
          var hx = Math.round(p[0]*8), hy = Math.round(p[1]*8);
          if (hash(hx,hy,62) > .42) return;
          var size = ts*(.012+hash(hx,hy,63)*.022);
          ctx.fillStyle = hash(hx,hy,64) < .5 ? 'rgba(173,168,140,.55)' : 'rgba(75,80,64,.45)';
          ctx.fillRect(p[0]-size/2,p[1]-size/2,size,size*.65);
        });
      });
      for (var i = 0; i < objects.length; i++) {
        var o = objects[i];
        if (o.x + o.width < x0 - 1 || o.x > x0 + w + 1 || o.y + o.height < y0 - 1 || o.y > y0 + h + 1) continue;
        ctx.drawImage(o.image, o.x, o.y, o.width, o.height);
      }
      return c;
    }
    function getChunk(cx, cy, density) {
      var key = cx + ',' + cy + ',' + density;
      if (cache.has(key)) { var found = cache.get(key); cache.delete(key); cache.set(key, found); return found; }
      var c = buildChunk(cx, cy, density), bytes = c.width * c.height * 4;
      while (cache.size && cacheBytes + bytes > maxBytes) {
        var oldKey = cache.keys().next().value, old = cache.get(oldKey);
        cacheBytes -= old.width * old.height * 4; cache.delete(oldKey); old.width = old.height = 0;
      }
      cache.set(key, c); cacheBytes += bytes; return c;
    }
    return { width: width, height: height, draw: function (ctx, view) {
      var required = view.zoom * view.pixelRatio, density = Math.max(2, Math.min(6, Math.ceil(required)));
      var minCX = Math.max(0, Math.floor(view.x / chunkSize)), minCY = Math.max(0, Math.floor(view.y / chunkSize));
      var maxCX = Math.min(Math.ceil(width / chunkSize), Math.ceil((view.x + view.width) / chunkSize));
      var maxCY = Math.min(Math.ceil(height / chunkSize), Math.ceil((view.y + view.height) / chunkSize));
      // The visible working set must fit the cache, otherwise wide high-DPI
      // views would evict their own chunks and rebuild them on every frame.
      var visible = Math.max(1, (maxCX - minCX) * (maxCY - minCY));
      var affordable = Math.max(1, Math.floor(Math.sqrt(maxBytes * .8 / (visible * (chunkSize + 2) * (chunkSize + 2) * 4))));
      density = Math.min(density, affordable);
      for (var cy = minCY; cy < maxCY; cy++) for (var cx = minCX; cx < maxCX; cx++) {
        var chunk = getChunk(cx, cy, density);
        ctx.drawImage(chunk, cx * chunkSize - 1, cy * chunkSize - 1, chunk.width / density, chunk.height / density);
      }
      ctx.strokeStyle = '#81775a'; ctx.lineWidth = 1; ctx.strokeRect(.5, .5, width - 1, height - 1);
    }, stats: function () { return { objects: objects.length, chunks: cache.size, cacheBytes: cacheBytes, maxBytes: maxBytes }; } };
  }
  function structure(ctx, images, px, py, size, type, tier) {
    tier = Math.max(0, Math.min(2, tier | 0));
    var img = images['cine_' + type + '-0' + (tier + 1)]; if (!img) return null;
    var s = size * (type === 'castle' ? 1.85 : 1.65), h = s * img.height / img.width;
    var dx = px - s / 2, dy = py + size * .28 - h;
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, s, h); ctx.restore(); return { dx: dx, dy: dy, s: s };
  }
  WOH.Cinematic = { assets: assets, isReady: isReady, terrain: terrain, structure: structure, shoreline: shoreline };
})(window.WOH = window.WOH || {});
