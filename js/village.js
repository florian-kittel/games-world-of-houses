/* =========================================================================
 * World of Houses – Dorf-Logik
 * Reine Berechnungsfunktionen rund um Gebäude, Produktion, Lager und
 * Bevölkerung. Operiert auf Dorf-Objekten (siehe game.js).
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config;

  function pow(factor, level) { return Math.pow(factor, level); }

  // Kosten, um ein Gebäude von (level) auf (level+1) zu bringen.
  function buildingCost(key, level) {
    var b = C.BUILDINGS[key];
    var f = pow(b.costFactor, level);
    var cost = {};
    C.RESOURCES.forEach(function (r) {
      cost[r] = Math.round((b.baseCost[r] || 0) * f);
    });
    return cost;
  }

  // Bauzeit (Spielsekunden) für die nächste Stufe.
  // Der Bauzeit-Faktor pro Stufe NIMMT AB: vom Startfaktor (frühe Stufen) bis
  // zum Endfaktor an der Maximalstufe (z. B. 2.0 -> 1.5). So wächst die Zeit
  // weiter, explodiert aber nicht. Höhere Halle verkürzt andere Gebäude leicht.
  function buildTime(village, key, level) {
    var b = C.BUILDINGS[key];
    var bld = C.BUILD || { timeStartFactor: 2.0, timeEndFactor: 1.5, hallSpeedPerLevel: 0.06 };
    var max = b.max || 6;
    var mult = 1;
    for (var s = 2; s <= level + 1; s++) {
      var t = (max > 2) ? (s - 2) / (max - 2) : 1; // 0 (erste Stufe) .. 1 (Maximalstufe)
      if (t > 1) t = 1;
      mult *= bld.timeStartFactor + (bld.timeEndFactor - bld.timeStartFactor) * t;
    }
    var raw = b.baseTime * mult;
    if (key !== 'townhall') {
      var hall = village.buildings.townhall || 0;
      raw *= 1 / (1 + hall * (bld.hallSpeedPerLevel || 0.06));
    }
    return Math.max(4, raw);
  }

  // Voraussetzungen für die Zielstufe ermitteln (Liste unerfüllter Anforderungen).
  // Berücksichtigt feste requires und stufenabhängige levelRequires.
  function unmetRequirements(village, key, targetLevel) {
    var b = C.BUILDINGS[key];
    var unmet = [];
    function check(req) {
      if (!req) return;
      for (var k in req) {
        if ((village.buildings[k] || 0) < req[k]) {
          unmet.push((C.BUILDINGS[k] ? C.BUILDINGS[k].name : k) + ' ' + req[k]);
        }
      }
    }
    check(b.requires);
    if (b.levelRequires && targetLevel != null) check(b.levelRequires[targetLevel]);
    return unmet;
  }

  function meetsRequirements(village, key, targetLevel) {
    return unmetRequirements(village, key, targetLevel).length === 0;
  }

  function maxLevel(key) { return C.BUILDINGS[key].max; }

  // Produktion pro Spielsekunde für einen Rohstoff.
  // `state` (optional, ab Schritt 5): wenn übergeben, wird der Food-Upkeep
  // um die Garnison-Pop in zugewiesenen Strukturen erweitert.
  function productionPerSec(village, res, state) {
    var level = 0;
    for (var k in C.BUILDINGS) {
      if (C.BUILDINGS[k].produces === res) { level = village.buildings[k] || 0; break; }
    }
    var base = C.PRODUCTION.base + level * C.PRODUCTION.perLevel;
    var prod = base * (village.bonus[res] || 1);
    // Nahrung wird durch die Bevölkerung verbraucht (Netto-Ertrag, ggf. negativ).
    // foodUpkeepPerPop ist pro Anzeige-Sekunde definiert -> auf Spielsekunde umrechnen.
    if (res === 'food') {
      prod -= populationUsed(village, state) * (C.PRODUCTION.foodUpkeepPerPop || 0) / C.TIME_SCALE;
    }
    return prod;
  }

  function storageCap(village) {
    var lvl = village.buildings.warehouse || 0;
    return Math.round(C.STORAGE.baseCap * pow(C.STORAGE.perLevel, lvl));
  }

  // Bereitgestellte Bevölkerung (Versorgung).
  // Basis: Bauernhof-Stufe; Schritt 5: + Bonus aus zugewiesenen eroberten
  // Rohstoff-Strukturen (`STRUCTURE_POP_BONUS[structure.level]`).
  // `state` ist optional: ohne state wird nur die Burg-interne Versorgung
  // berechnet (abwaertskompatibel fuer Aufrufer, die keinen state durchreichen).
  function populationCap(village, state) {
    var base = C.POPULATION.base + (village.buildings.farm || 0) * C.POPULATION.perFarmLevel;
    if (!state || !state.structures || !C.STRUCTURE_POP_BONUS) return base;
    var bonus = 0;
    for (var i = 0; i < state.structures.length; i++) {
      var s = state.structures[i];
      if (s.assignedCastleId !== village.id || s.ownerHouseId !== village.houseId) continue;
      var lvl = Math.max(1, Math.min(3, s.level || 1));
      bonus += C.STRUCTURE_POP_BONUS[lvl] || 0;
    }
    return base + bonus;
  }

  // Verbrauchte Bevölkerung: Gebäude + stationierte/ausgebildete Einheiten.
  // Schritt 5: + Garnison-Einheiten in zugewiesenen eroberten Strukturen
  // werden ueber die Heimatburg verbucht (Spec: "belegen dort keine
  // Bevoelkerung mehr; Versorgung laeuft zentral aus dem besitzenden Haus").
  function populationUsed(village, state) {
    var used = 0, k;
    for (k in village.buildings) used += (village.buildings[k] || 0);
    for (k in village.units) used += (village.units[k] || 0) * (C.UNITS[k] ? C.UNITS[k].pop : 1);
    (village.trainingQueue || []).forEach(function (q) {
      used += q.remaining * (C.UNITS[q.unit] ? C.UNITS[q.unit].pop : 1);
    });
    if (state && state.structures) {
      for (var i = 0; i < state.structures.length; i++) {
        var s = state.structures[i];
        if (s.assignedCastleId !== village.id || s.ownerHouseId !== village.houseId) continue;
        var g = s.garrison || {};
        for (var u in g) used += (g[u] || 0) * (C.UNITS[u] ? C.UNITS[u].pop : 1);
      }
    }
    return used;
  }

  function canAfford(village, cost) {
    return C.RESOURCES.every(function (r) {
      return (village.resources[r] || 0) >= (cost[r] || 0);
    });
  }

  function pay(village, cost) {
    C.RESOURCES.forEach(function (r) {
      village.resources[r] -= (cost[r] || 0);
    });
  }

  // Wende Produktion über dt Spielsekunden an, begrenzt durch Lagerkapazität.
  // `state` ist optional und wird an `productionPerSec` weitergereicht, damit
  // der Food-Upkeep die Garnison in zugewiesenen Strukturen mitzaehlt.
  function applyProduction(village, dtSec, state) {
    var cap = storageCap(village);
    C.RESOURCES.forEach(function (r) {
      var add = productionPerSec(village, r, state) * dtSec;
      village.resources[r] = Math.max(0, Math.min(cap, (village.resources[r] || 0) + add));
    });
  }

  // -----------------------------------------------------------------------
  // Belagerung (Schritt 6.5): HP-Helpers + Reparatur-Queue
  // -----------------------------------------------------------------------
  function wallMaxHP(level) {
    var lvl = level | 0;
    if (lvl < 1) return 0;
    var arr = (C.SIEGE && C.SIEGE.wallMaxHP) || [];
    return arr[Math.min(lvl, arr.length - 1)] || 0;
  }
  function towerMaxHP(level) {
    var lvl = level | 0;
    if (lvl < 1) return 0;
    var arr = (C.SIEGE && C.SIEGE.towerMaxHP) || [];
    return arr[Math.min(lvl, arr.length - 1)] || 0;
  }
  // Liefert aktuelle HP; bei undefinierten Feldern Default = maxHP der Stufe.
  function wallHP(v) {
    var lvl = v.buildings.wall || 0;
    if (lvl < 1) return 0;
    if (typeof v.wallHP !== 'number') v.wallHP = wallMaxHP(lvl);
    return v.wallHP;
  }
  function towerHP(v) {
    var lvl = v.buildings.tower || 0;
    if (lvl < 1) return 0;
    if (typeof v.towerHP !== 'number') v.towerHP = towerMaxHP(lvl);
    return v.towerHP;
  }

  // Reparaturkosten/-zeit der aktuellen Stufe (Bruchteil der Baukosten/-zeit).
  function repairCost(v, key) {
    var lvl = v.buildings[key] || 0;
    if (lvl < 1) return { food: 0, wood: 0, stone: 0, iron: 0 };
    var base = buildingCost(key, lvl - 1); // Kosten der ZURZEIT stehenden Stufe
    var f = (C.SIEGE && C.SIEGE.repairCostFactor) || 0.3;
    var cost = {};
    C.RESOURCES.forEach(function (r) {
      cost[r] = Math.round((base[r] || 0) * f);
    });
    return cost;
  }
  function repairTime(v, key) {
    var lvl = v.buildings[key] || 0;
    if (lvl < 1) return 0;
    var t = buildTime(v, key, lvl - 1);
    var f = (C.SIEGE && C.SIEGE.repairTimeFactor) || 0.4;
    return Math.max(4, t * f);
  }

  // Tick: schliesst abgelaufene Reparatur-Eintraege ab.
  function processRepairs(village, dtSec, gameTime) {
    if (!village.repairQueue || !village.repairQueue.length) return;
    var remaining = [];
    for (var i = 0; i < village.repairQueue.length; i++) {
      var r = village.repairQueue[i];
      if (gameTime >= r.endsAt) {
        // Reparatur abgeschlossen: HP auf max der aktuellen Stufe.
        if (r.key === 'wall') village.wallHP = wallMaxHP(village.buildings.wall || 0);
        else if (r.key === 'tower') village.towerHP = towerMaxHP(village.buildings.tower || 0);
      } else {
        remaining.push(r);
      }
    }
    village.repairQueue = remaining;
  }

  WOH.Village = {
    buildingCost: buildingCost,
    buildTime: buildTime,
    meetsRequirements: meetsRequirements,
    unmetRequirements: unmetRequirements,
    maxLevel: maxLevel,
    productionPerSec: productionPerSec,
    storageCap: storageCap,
    populationCap: populationCap,
    populationUsed: populationUsed,
    canAfford: canAfford,
    pay: pay,
    applyProduction: applyProduction,
    // Schritt 6.5: Belagerung
    wallMaxHP: wallMaxHP,
    towerMaxHP: towerMaxHP,
    wallHP: wallHP,
    towerHP: towerHP,
    repairCost: repairCost,
    repairTime: repairTime,
    processRepairs: processRepairs
  };
})(window.WOH = window.WOH || {});
