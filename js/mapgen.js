/* =========================================================================
 * World of Houses – Prozedurale Kartengenerierung
 * Erzeugt ein Geländeraster (Value-Noise), platziert Dörfer mit Mindestabstand
 * und leitet aus der Umgebung die Rohstoff-Standortboni ab.
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config;

  // --- Mehroktaviges Value-Noise --------------------------------------
  function makeNoise(rng, w, h) {
    function octave(scale) {
      var gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
      var grid = new Float32Array(gw * gh);
      for (var i = 0; i < grid.length; i++) grid[i] = rng.next();
      return function (x, y) {
        var gx = x / scale, gy = y / scale;
        var x0 = Math.floor(gx), y0 = Math.floor(gy);
        var tx = gx - x0, ty = gy - y0;
        // glatte Interpolation (smoothstep)
        var sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        function g(ix, iy) { return grid[(iy * gw + ix)] || 0; }
        var top = g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx;
        var bot = g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx;
        return top * (1 - sy) + bot * sy;
      };
    }
    var o1 = octave(10), o2 = octave(5), o3 = octave(2.5);
    return function (x, y) {
      return o1(x, y) * 0.6 + o2(x, y) * 0.3 + o3(x, y) * 0.1;
    };
  }

  function terrainFor(elev, moist) {
    if (elev < 0.32) return 'water';
    if (elev > 0.72) return 'mountain';
    if (moist > 0.62) return 'forest';
    if (moist < 0.34) return 'field';
    return 'grass';
  }

  function generateMap(rng) {
    var w = C.MAP.width, h = C.MAP.height;
    var elevN = makeNoise(rng, w, h);
    var moistN = makeNoise(rng, w, h);
    var tiles = new Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var e = elevN(x, y), m = moistN(x, y);
        tiles[y * w + x] = terrainFor(e, m);
      }
    }
    smoothWater(tiles, w, h);
    return { width: w, height: h, tiles: tiles };
  }

  // Stellt sicher, dass jedes Wasserfeld Teil eines mindestens 2x2 großen
  // Wasserblocks ist. So kann jede Küstenkachel korrekt gewählt werden
  // (keine 1-Feld-Kanäle, keine isolierten/diagonalen Einzelfelder).
  // Zu dünne Wasserstellen werden zu Gras.
  function smoothWater(tiles, w, h) {
    function isW(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false; // Rand = Land
      return tiles[y * w + x] === 'water';
    }
    function in2x2(x, y) {
      // Eines der vier 2x2-Quadrate, die (x,y) enthalten, muss komplett Wasser sein.
      for (var ox = -1; ox <= 0; ox++) {
        for (var oy = -1; oy <= 0; oy++) {
          if (isW(x + ox, y + oy) && isW(x + ox + 1, y + oy) &&
              isW(x + ox, y + oy + 1) && isW(x + ox + 1, y + oy + 1)) return true;
        }
      }
      return false;
    }
    var changed = true, guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      var remove = [];
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (tiles[y * w + x] === 'water' && !in2x2(x, y)) remove.push(y * w + x);
        }
      }
      if (remove.length) {
        for (var i = 0; i < remove.length; i++) tiles[remove[i]] = 'grass';
        changed = true;
      }
    }
  }

  function terrainAt(map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 'water';
    return map.tiles[y * map.width + x];
  }

  // Zähle Geländearten in der Umgebung eines Feldes (Radius 2)
  function surroundCounts(map, x, y) {
    var counts = {};
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var t = terrainAt(map, x + dx, y + dy);
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    return counts;
  }

  // Leite Rohstoffboni aus der Umgebung ab.
  function bonusFor(map, x, y, rng) {
    var c = surroundCounts(map, x, y);
    var bonus = { food: 1.0, wood: 1.0, stone: 1.0, iron: 1.0 };
    // Geländegewichte
    bonus.wood  += (c.forest   || 0) * 0.06;
    bonus.stone += (c.mountain || 0) * 0.05;
    bonus.iron  += (c.mountain || 0) * 0.045;
    bonus.food  += (c.field    || 0) * 0.05 + (c.water || 0) * 0.04 + (c.grass || 0) * 0.02;
    // Klemmen auf sinnvolle Spanne
    WOH.Config.RESOURCES.forEach(function (r) {
      bonus[r] = Math.max(0.85, Math.min(2.1, +bonus[r].toFixed(2)));
    });
    return bonus;
  }

  // Bestimme den dominanten Bonus-Rohstoff (für UI/Hausnamen-Geschmack)
  function dominantBonus(bonus) {
    var best = 'food', bv = 0;
    WOH.Config.RESOURCES.forEach(function (r) {
      if (bonus[r] > bv) { bv = bonus[r]; best = r; }
    });
    return { res: best, value: bv };
  }

  // Ist ein Feld frei von Wasser in der 8er-Nachbarschaft? (Abstand zur Küste)
  function clearOfWater(map, x, y) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (terrainAt(map, x + dx, y + dy) === 'water') return false;
      }
    }
    return true;
  }

  // Platziere Dörfer auf bewohnbarem Gelände mit Mindestabstand,
  // niemals direkt an Wasser oder Gebirge.
  function placeVillages(map, rng, count) {
    var w = map.width, h = map.height;
    var spots = [];
    for (var y = 2; y < h - 2; y++) {
      for (var x = 2; x < w - 2; x++) {
        var t = terrainAt(map, x, y);
        if (t !== 'water' && t !== 'mountain' && clearOfWater(map, x, y)) spots.push({ x: x, y: y });
      }
    }
    rng.shuffle(spots);
    var chosen = [];
    var minD = C.MAP.minVillageDist;
    for (var i = 0; i < spots.length && chosen.length < count; i++) {
      var s = spots[i], ok = true;
      for (var j = 0; j < chosen.length; j++) {
        var dx = chosen[j].x - s.x, dy = chosen[j].y - s.y;
        if (Math.sqrt(dx * dx + dy * dy) < minD) { ok = false; break; }
      }
      if (ok) chosen.push(s);
    }
    return chosen;
  }

  // Zähle ein Gelände in der Umgebung (Radius r).
  function countTerrain(map, x, y, type, r) {
    var n = 0;
    for (var dy = -r; dy <= r; dy++)
      for (var dx = -r; dx <= r; dx++)
        if (terrainAt(map, x + dx, y + dy) === type) n++;
    return n;
  }
  function adjacentTo(map, x, y, type) {
    return terrainAt(map, x + 1, y) === type || terrainAt(map, x - 1, y) === type ||
           terrainAt(map, x, y + 1) === type || terrainAt(map, x, y - 1) === type;
  }

  // Eignung eines Feldes für einen Strukturtyp (0 = ungeeignet).
  function suitability(map, x, y, rule) {
    if (rule === 'forest') {
      return terrainAt(map, x, y) === 'forest' ? 2 + countTerrain(map, x, y, 'forest', 1) : 0;
    }
    if (rule === 'mountainAdjacent') {
      var t = terrainAt(map, x, y);
      if (t === 'mountain' || t === 'water') return 0;
      return adjacentTo(map, x, y, 'mountain') ? 2 + countTerrain(map, x, y, 'mountain', 1) : 0;
    }
    if (rule === 'open') {
      var t2 = terrainAt(map, x, y);
      if (t2 !== 'grass' && t2 !== 'field') return 0;
      var grass = countTerrain(map, x, y, 'grass', 2) + countTerrain(map, x, y, 'field', 2);
      return grass >= 16 ? grass : 0; // große freie Fläche bevorzugt
    }
    return 0;
  }

  // Prueft, ob (x,y) ein 2-Tile-Abstand zu Wald/Gebirge eingehalten wird.
  // Wird zusaetzlich zur 'open'-Eignung verlangt (Hof/Schaffarm).
  function openClearance(map, x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var t = terrainAt(map, x + dx, y + dy);
        if (t === 'forest' || t === 'mountain') return false;
      }
    }
    return true;
  }

  // Platziere wenige neutrale Rohstoff-Strukturen nach Geländeregeln.
  // occupied: Liste belegter Felder {x,y} (Dörfer/Burgen). Verändert ggf.
  // map.tiles (Holzfäller: Bäume entfernen, damit das transparente Sprite
  // sauber sitzt).
  //
  // Spec (Schritt 3):
  // - Holzfaeller: auf Wald-Tile (Baum wird zur Lichtung).
  // - Eisenmine:   adjazent zu Gebirge, nicht selbst Gebirge/Wasser.
  // - Hof/Schaffarm: auf Gras/Feld; zusaetzlich 2-Tile-Abstand zu Wald/Gebirge.
  // - Hafen:       noch nicht implementiert (Erweiterungs-Slot vorgesehen).
  // - Mindestabstand zu Burgen: 4 Tiles. Mindestabstand zwischen Strukturen: 3.
  // - Stufe bei Spawn: 1 (Default; Aufstieg per Spielmechanik moeglich).
  // - Determinismus: rng wird vollstaendig durchgereicht.
  function placeResourceStructures(map, rng, occupied) {
    var w = map.width, h = map.height;
    var cfg = C.RESOURCE_STRUCTURES, order = C.RESOURCE_STRUCTURE_ORDER;
    var result = [];

    var castles = (occupied || []).slice();        // Mindestabstand 4
    var placedStructs = [];                        // Mindestabstand 3

    function minDistOk(x, y) {
      var i, dx, dy;
      for (i = 0; i < castles.length; i++) {
        dx = castles[i].x - x; dy = castles[i].y - y;
        if (Math.sqrt(dx * dx + dy * dy) < 4) return false;
      }
      for (i = 0; i < placedStructs.length; i++) {
        dx = placedStructs[i].x - x; dy = placedStructs[i].y - y;
        if (Math.sqrt(dx * dx + dy * dy) < 3) return false;
      }
      return true;
    }

    order.forEach(function (type) {
      if (!cfg[type]) return;                      // Slot reserviert (z.B. spaeter 'harbor')
      var rule = cfg[type].terrain, want = cfg[type].count;
      var cands = [];
      for (var y = 2; y < h - 2; y++) {
        for (var x = 2; x < w - 2; x++) {
          if (!clearOfWater(map, x, y)) continue;
          var sc = suitability(map, x, y, rule);
          if (sc <= 0) continue;
          // Hof/Schaffarm: zusaetzlicher Sicherheitsabstand zu Wald/Gebirge.
          if (rule === 'open' && !openClearance(map, x, y)) continue;
          cands.push({ x: x, y: y, score: sc + rng.next() * 1.5 });
        }
      }
      cands.sort(function (a, b) { return b.score - a.score; });
      var placed = 0;
      // Iteration ist durch cands.length deckelt; bei Platzmangel werden
      // einfach weniger Strukturen platziert (kein Endlos-Loop).
      for (var i = 0; i < cands.length && placed < want; i++) {
        var c = cands[i];
        if (!minDistOk(c.x, c.y)) continue;
        result.push({
          id: 'st_' + type + '_' + c.x + '_' + c.y,
          type: type, x: c.x, y: c.y,
          level: 1, tier: 0,           // Stufe 1 (Spec), tier 0 = basic-Sprite
          ownerHouseId: null
        });
        placedStructs.push({ x: c.x, y: c.y });
        if (type === 'woodcutter') map.tiles[c.y * w + c.x] = 'grass'; // Baeume entfernen
        placed++;
      }
    });
    return result;
  }

  WOH.MapGen = {
    generate: generateMap,
    smoothWater: smoothWater,
    terrainAt: terrainAt,
    bonusFor: bonusFor,
    dominantBonus: dominantBonus,
    placeVillages: placeVillages,
    placeResourceStructures: placeResourceStructures
  };
})(window.WOH = window.WOH || {});
