/* Photographic terrain layers. All expensive compositing happens once per map.
 * World coordinates, terrain types and gameplay remain owned by mapgen/UI. */
(function (WOH) {
  'use strict';
  function canvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function terrain(map, atlas) {
    var ts = WOH.Config.MAP.tileSize, w = map.width * ts, h = map.height * ts;
    var out = canvas(w * 2, h * 2), ctx = out.getContext('2d');
    ctx.scale(2, 2);
    var sw = atlas.width / 2, sh = atlas.height / 2;
    // Mirrored repeat prevents hard seams even with imperfect generated textures.
    function texture(col, row, size) {
      var c = canvas(size * 2, size * 2), g = c.getContext('2d');
      for (var y = 0; y < 2; y++) for (var x = 0; x < 2; x++) {
        g.save(); g.translate(x ? size * 2 : 0, y ? size * 2 : 0);
        g.scale(x ? -1 : 1, y ? -1 : 1);
        g.drawImage(atlas, col * sw, row * sh, sw, sh, 0, 0, size, size); g.restore();
      }
      return ctx.createPattern(c, 'repeat');
    }
    ctx.fillStyle = texture(0, 0, 240); ctx.fillRect(0, 0, w, h);
    ['field', 'mountain', 'forest', 'water'].forEach(function (type) {
      var mask = canvas(w, h), m = mask.getContext('2d');
      m.fillStyle = '#fff';
      for (var y = 0; y < map.height; y++) for (var x = 0; x < map.width; x++) {
        if (map.tiles[y * map.width + x] !== type) continue;
        if (type !== 'water') { m.fillRect(x * ts, y * ts, ts, ts); continue; }
        function same(xx, yy) {
          return xx >= 0 && yy >= 0 && xx < map.width && yy < map.height &&
            map.tiles[yy * map.width + xx] === type;
        }
        var left = x * ts, top = y * ts, right = left + ts, bottom = top + ts;
        var n = same(x, y - 1), south = same(x, y + 1), west = same(x - 1, y), east = same(x + 1, y);
        var nw = !n && !west ? ts * .48 : 0, ne = !n && !east ? ts * .48 : 0;
        var se = !south && !east ? ts * .48 : 0, sw = !south && !west ? ts * .48 : 0;
        m.beginPath(); m.moveTo(left + nw, top); m.lineTo(right - ne, top);
        m.quadraticCurveTo(right, top, right, top + ne); m.lineTo(right, bottom - se);
        m.quadraticCurveTo(right, bottom, right - se, bottom); m.lineTo(left + sw, bottom);
        m.quadraticCurveTo(left, bottom, left, bottom - sw); m.lineTo(left, top + nw);
        m.quadraticCurveTo(left, top, left + nw, top); m.closePath(); m.fill();
      }
      var layer = canvas(w, h), g = layer.getContext('2d');
      g.filter = 'blur(' + (type === 'water' ? 5 : 7) + 'px)';
      g.drawImage(mask, 0, 0); g.filter = 'none';
      g.globalCompositeOperation = 'source-in';
      if (type === 'water') {
        var water = g.createLinearGradient(0, 0, w, h);
        water.addColorStop(0, '#46656a'); water.addColorStop(1, '#152c37');
        g.fillStyle = water;
      } else {
        g.fillStyle = texture(type === 'forest' || type === 'field' ? 1 : 0,
          type === 'forest' ? 0 : 1, type === 'forest' ? 180 : 256);
      }
      g.fillRect(0, 0, w, h);
      ctx.save();
      ctx.shadowColor = type === 'water' ? '#a49c75' : 'rgba(9,18,13,.7)';
      ctx.shadowBlur = type === 'water' ? 10 : 12;
      ctx.shadowOffsetY = type === 'water' ? 0 : 4;
      ctx.drawImage(layer, 0, 0); ctx.restore();
      if (type === 'water') {
        g.globalCompositeOperation = 'source-atop'; g.strokeStyle = 'rgba(183,207,204,.13)';
        g.lineWidth = .6;
        for (var i = 0; i < 1800; i++) {
          var rx = (i * 137.31) % w, ry = (i * 73.73) % h;
          g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + 4 + i % 12, ry - 1); g.stroke();
        }
        ctx.drawImage(layer, 0, 0);
      }
    });
    // Restrained atmospheric falloff; labels and controls are drawn afterwards.
    var shade = ctx.createRadialGradient(w / 2, h / 2, w * .15, w / 2, h / 2, Math.max(w, h) * .75);
    shade.addColorStop(0, 'rgba(12,23,26,0)'); shade.addColorStop(1, 'rgba(5,14,21,.38)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#746c50'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, w - 4, h - 4);
    return out;
  }
  function structure(ctx, atlas, px, py, size, type, tier) {
    var cells = { castle: [0, 0], city: [0, 0], farmstead: [1, 0], sheepfarm: [1, 0],
      woodcutter: [0, 1], ironmine: [1, 1], stonemine: [1, 1] };
    var cell = cells[type]; if (!cell) return null;
    var s = size * (1.5 + Math.max(0, Math.min(2, tier || 0)) * .12);
    var dx = px - s / 2, dy = py - s * .62;
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;
    ctx.drawImage(atlas, cell[0] * atlas.width / 2, cell[1] * atlas.height / 2,
      atlas.width / 2, atlas.height / 2, dx, dy, s, s);
    ctx.restore(); return { dx: dx, dy: dy, s: s };
  }
  WOH.Cinematic = { terrain: terrain, structure: structure };
})(window.WOH = window.WOH || {});
