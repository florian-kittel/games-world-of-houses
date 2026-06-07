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
    // Globale Regel: kein Gebäude darf eine höhere Stufe als die Halle haben
    // (die Halle selbst ausgenommen). Begrenzt vorzeitiges Hochleveln einzelner
    // Gebäude — erst die Halle ausbauen, dann ziehen die übrigen nach.
    if (key !== 'townhall' && targetLevel != null) {
      var hall = village.buildings.townhall || 0;
      if (targetLevel > hall) {
        unmet.push((C.BUILDINGS.townhall ? C.BUILDINGS.townhall.name : 'Halle') + ' ' + targetLevel);
      }
    }
    return unmet;
  }

  function meetsRequirements(village, key, targetLevel) {
    return unmetRequirements(village, key, targetLevel).length === 0;
  }

  function maxLevel(key) { return C.BUILDINGS[key].max; }

  // Produktion pro Spielsekunde für einen Rohstoff.
  // `state` (optional, ab Schritt 5): wenn übergeben, wird der Food-Upkeep
  // um die Garnison-Einheiten in zugewiesenen Strukturen erweitert.
  // `includeStructures` (Schritt 11c, optional): wenn true, wird die
  // Direkt-Produktion eroberter eigener Strukturen ebenfalls aufaddiert —
  // sinnvoll fuer UI-Anzeigen (sonst Doppel-Buchung in applyProduction).
  function productionPerSec(village, res, state, includeStructures) {
    // Vereinfachtes Modell: Produktion = Stufe × gebäudespezifisches perLevel
    // × Standortbonus. (Basiswerte: Holzfäller 3, Steinbruch 2, Eisenmine 1,
    // Bauernhof 3 — siehe BUILDINGS[k].perLevel in config.js.)
    var level = 0, perLevel = 0;
    for (var k in C.BUILDINGS) {
      if (C.BUILDINGS[k].produces === res) {
        level = village.buildings[k] || 0;
        perLevel = C.BUILDINGS[k].perLevel || 0;
        break;
      }
    }
    var base = (C.PRODUCTION.base || 0) + level * perLevel;
    var prod = base * (village.bonus[res] || 1);
    if (res === 'food') {
      prod -= foodUpkeepFor(village, state);
    }
    if (includeStructures && state && state.structures) {
      for (var i = 0; i < state.structures.length; i++) {
        var s = state.structures[i];
        if (s.assignedCastleId !== village.id || s.ownerHouseId !== village.houseId) continue;
        var meta = C.RESOURCE_STRUCTURES[s.type];
        if (!meta || meta.res !== res) continue;
        var lvl = Math.max(1, Math.min(3, s.level || 1));
        prod += (C.RESOURCE_STRUCTURE_LEVELS.production[lvl - 1] || 0);
      }
    }
    return prod;
  }

  // Nahrungs-Upkeep mit Aufschluesselung (Schritt 11).
  // Zivilbevölkerung = Σ Gebäude-Pop × civilianFoodUpkeep.
  // Armee = stationierte Einheiten + Trainings-Queue + Garnison (jeweils
  // × UNITS[k].foodUpkeep).
  function foodUpkeepBreakdown(village, state) {
    var civPop = 0, k;
    for (k in village.buildings) {
      var b = C.BUILDINGS[k];
      var pPer = (b && typeof b.popPerLevel === 'number') ? b.popPerLevel : 1;
      civPop += (village.buildings[k] || 0) * pPer;
    }
    var civilians = civPop * (C.POPULATION.civilianFoodUpkeep || 0);

    var army = 0, training = 0, garrison = 0, marching = 0, u;
    for (k in village.units) {
      u = C.UNITS[k]; if (!u || !u.foodUpkeep) continue;
      army += (village.units[k] || 0) * u.foodUpkeep;
    }
    (village.trainingQueue || []).forEach(function (q) {
      u = C.UNITS[q.unit]; if (!u || !u.foodUpkeep) return;
      training += q.remaining * u.foodUpkeep;
    });
    if (state && state.structures) {
      for (var i = 0; i < state.structures.length; i++) {
        var s = state.structures[i];
        if (s.assignedCastleId !== village.id || s.ownerHouseId !== village.houseId) continue;
        var g = s.garrison || {};
        for (var gk in g) {
          u = C.UNITS[gk]; if (!u || !u.foodUpkeep) continue;
          garrison += (g[gk] || 0) * u.foodUpkeep;
        }
      }
    }
    // Schritt 11b: wandernde Armee wird ueber die Heimatburg versorgt
    if (state && state.movements) {
      for (var mi = 0; mi < state.movements.length; mi++) {
        var m = state.movements[mi];
        if (movementHomeId(m) !== village.id) continue;
        for (var mk in m.units) {
          u = C.UNITS[mk]; if (!u || !u.foodUpkeep) continue;
          marching += (m.units[mk] || 0) * u.foodUpkeep;
        }
      }
    }
    return { civilians: civilians, army: army, training: training, garrison: garrison, marching: marching,
             total: civilians + army + training + garrison + marching };
  }

  function foodUpkeepFor(village, state) {
    return foodUpkeepBreakdown(village, state).total;
  }

  function storageCap(village) {
    var lvl = village.buildings.warehouse || 0;
    return Math.round(C.STORAGE.baseCap * pow(C.STORAGE.perLevel, lvl));
  }

  // Bereitgestellte Bevölkerung — Schritt 11:
  // - Halle (perTownhallLevel) ist die Hauptquelle.
  // - Bauernhof (perFarmLevel) gibt zusätzlich Pop.
  // - Eroberte Strukturen (STRUCTURE_POP_BONUS) zusätzlich.
  function populationCap(village, state) {
    var pop = C.POPULATION.base
            + (village.buildings.townhall || 0) * (C.POPULATION.perTownhallLevel || 0)
            + (village.buildings.farm     || 0) * (C.POPULATION.perFarmLevel     || 0);
    if (!state || !state.structures || !C.STRUCTURE_POP_BONUS) return pop;
    for (var i = 0; i < state.structures.length; i++) {
      var s = state.structures[i];
      if (s.assignedCastleId !== village.id || s.ownerHouseId !== village.houseId) continue;
      var lvl = Math.max(1, Math.min(3, s.level || 1));
      pop += C.STRUCTURE_POP_BONUS[lvl] || 0;
    }
    return pop;
  }

  // Schritt 11b: Bestimmt die Heimatburg eines Movements.
  // Hinweg (attack/gather/capture/support): fromId = Heimatburg.
  // Rueckkehr (return): toId = Heimatburg (Truppen kommen heim).
  function movementHomeId(m) {
    return m.type === 'return' ? m.toId : m.fromId;
  }

  // Verbrauchte Bevölkerung — Schritt 11:
  // Gebäude verbrauchen `popPerLevel × level` Arbeiter; Einheiten nach `pop`-
  // Faktor (Held 10). Trainings-Queue, zugewiesene Strukturen-Garnison sowie
  // wandernde Armeen (Schritt 11b) werden mitgerechnet.
  function populationUsed(village, state) {
    var used = 0, k;
    for (k in village.buildings) {
      var b = C.BUILDINGS[k];
      var pPer = (b && typeof b.popPerLevel === 'number') ? b.popPerLevel : 1;
      used += (village.buildings[k] || 0) * pPer;
    }
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
    // Wandernde Armeen (Movements)
    if (state && state.movements) {
      for (var mi = 0; mi < state.movements.length; mi++) {
        var m = state.movements[mi];
        if (movementHomeId(m) !== village.id) continue;
        for (var mk in m.units) used += (m.units[mk] || 0) * (C.UNITS[mk] ? C.UNITS[mk].pop : 1);
      }
    }
    return used;
  }

  // Detaillierte Aufschluesselung des Pop-Verbrauchs (fuer Hover-Tooltips).
  function populationBreakdown(village, state) {
    var civilians = 0, army = 0, garrison = 0, training = 0, marching = 0;
    var k;
    for (k in village.buildings) {
      var b = C.BUILDINGS[k];
      var pPer = (b && typeof b.popPerLevel === 'number') ? b.popPerLevel : 1;
      civilians += (village.buildings[k] || 0) * pPer;
    }
    for (k in village.units) army += (village.units[k] || 0) * (C.UNITS[k] ? C.UNITS[k].pop : 1);
    (village.trainingQueue || []).forEach(function (q) {
      training += q.remaining * (C.UNITS[q.unit] ? C.UNITS[q.unit].pop : 1);
    });
    if (state && state.structures) {
      for (var i = 0; i < state.structures.length; i++) {
        var s = state.structures[i];
        if (s.assignedCastleId !== village.id || s.ownerHouseId !== village.houseId) continue;
        var g = s.garrison || {};
        for (var u in g) garrison += (g[u] || 0) * (C.UNITS[u] ? C.UNITS[u].pop : 1);
      }
    }
    if (state && state.movements) {
      for (var mi = 0; mi < state.movements.length; mi++) {
        var m = state.movements[mi];
        if (movementHomeId(m) !== village.id) continue;
        for (var mk in m.units) marching += (m.units[mk] || 0) * (C.UNITS[mk] ? C.UNITS[mk].pop : 1);
      }
    }
    return { civilians: civilians, army: army, training: training, garrison: garrison, marching: marching,
             total: civilians + army + training + garrison + marching };
  }
  function populationCapBreakdown(village, state) {
    var fromHall = (village.buildings.townhall || 0) * (C.POPULATION.perTownhallLevel || 0);
    var fromFarm = (village.buildings.farm     || 0) * (C.POPULATION.perFarmLevel     || 0);
    var fromStructures = 0;
    if (state && state.structures && C.STRUCTURE_POP_BONUS) {
      for (var i = 0; i < state.structures.length; i++) {
        var s = state.structures[i];
        if (s.assignedCastleId !== village.id || s.ownerHouseId !== village.houseId) continue;
        var lvl = Math.max(1, Math.min(3, s.level || 1));
        fromStructures += C.STRUCTURE_POP_BONUS[lvl] || 0;
      }
    }
    return { base: C.POPULATION.base, hall: fromHall, farm: fromFarm,
             structures: fromStructures,
             total: C.POPULATION.base + fromHall + fromFarm + fromStructures };
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
    foodUpkeepFor: foodUpkeepFor,
    foodUpkeepBreakdown: foodUpkeepBreakdown,
    populationBreakdown: populationBreakdown,
    populationCapBreakdown: populationCapBreakdown,
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
