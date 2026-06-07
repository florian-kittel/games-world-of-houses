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
  function productionPerSec(village, res) {
    var level = 0;
    for (var k in C.BUILDINGS) {
      if (C.BUILDINGS[k].produces === res) { level = village.buildings[k] || 0; break; }
    }
    var base = C.PRODUCTION.base + level * C.PRODUCTION.perLevel;
    var prod = base * (village.bonus[res] || 1);
    // Nahrung wird durch die Bevölkerung verbraucht (Netto-Ertrag, ggf. negativ).
    // foodUpkeepPerPop ist pro Anzeige-Sekunde definiert -> auf Spielsekunde umrechnen.
    if (res === 'food') {
      prod -= populationUsed(village) * (C.PRODUCTION.foodUpkeepPerPop || 0) / C.TIME_SCALE;
    }
    return prod;
  }

  function storageCap(village) {
    var lvl = village.buildings.warehouse || 0;
    return Math.round(C.STORAGE.baseCap * pow(C.STORAGE.perLevel, lvl));
  }

  // Bereitgestellte Bevölkerung (Versorgung) durch Bauernhof.
  function populationCap(village) {
    return C.POPULATION.base + (village.buildings.farm || 0) * C.POPULATION.perFarmLevel;
  }

  // Verbrauchte Bevölkerung: Gebäude + stationierte/ausgebildete Einheiten.
  function populationUsed(village) {
    var used = 0, k;
    for (k in village.buildings) used += (village.buildings[k] || 0);
    for (k in village.units) used += (village.units[k] || 0) * (C.UNITS[k] ? C.UNITS[k].pop : 1);
    (village.trainingQueue || []).forEach(function (q) {
      used += q.remaining * (C.UNITS[q.unit] ? C.UNITS[q.unit].pop : 1);
    });
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
  // Nahrung ist nicht durch das Lager gedeckelt? -> doch, zur Einfachheit gleich.
  function applyProduction(village, dtSec) {
    var cap = storageCap(village);
    C.RESOURCES.forEach(function (r) {
      var add = productionPerSec(village, r) * dtSec;
      village.resources[r] = Math.max(0, Math.min(cap, (village.resources[r] || 0) + add));
    });
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
    applyProduction: applyProduction
  };
})(window.WOH = window.WOH || {});
