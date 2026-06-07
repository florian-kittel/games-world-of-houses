/* =========================================================================
 * World of Houses – Kampfsystem
 * Auflösung nach bewährter "Die-Stämme"-Mechanik: Angriffskraft gegen
 * gewichtete Verteidigung, modifiziert durch Glück, Moral, Palisade und Turm.
 * Verluste folgen einer Potenzkurve (lossExponent).
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config;

  function totalUnits(map) {
    var n = 0; for (var k in map) n += map[k] || 0; return n;
  }

  // Angriffskraft einer Armee (nur 'off'/'def'-Einheiten mit atk).
  function attackPower(units) {
    var p = 0;
    for (var k in units) {
      var u = C.UNITS[k]; if (!u) continue;
      p += (units[k] || 0) * u.atk;
    }
    return p;
  }

  // Verteidigungskraft eines Dorfes gegen einen Infanterieangriff.
  // Berücksichtigt Einheiten-defI, Bogenschützen-Turmbonus, Palisade, Grundwert.
  function defensePower(defUnits, wallLevel, towerLevel) {
    var p = 0;
    for (var k in defUnits) {
      var u = C.UNITS[k]; if (!u) continue;
      var d = (defUnits[k] || 0) * u.defI;
      if (k === 'archer') d *= (1 + towerLevel * C.COMBAT.towerArcherBonus);
      p += d;
    }
    var wallMult = 1 + wallLevel * C.COMBAT.wallDefPerLevel;
    var base = C.COMBAT.baseVillageDef + wallLevel * C.COMBAT.wallBaseDef;
    return p * wallMult + base;
  }

  // Moral: Schutz, wenn ein großer Angreifer ein kleines Dorf trifft.
  // Skaliert mit Punkteverhältnis (hier: Gesamtgebäudestufen als Proxy).
  function morale(attackerScore, defenderScore) {
    if (!C.COMBAT.morale.enabled) return 1;
    if (defenderScore <= 0) return 1;
    var ratio = defenderScore / Math.max(1, attackerScore);
    return Math.max(C.COMBAT.morale.min, Math.min(1, 0.3 + ratio));
  }

  /**
   * Löst eine Schlacht auf.
   * @param attackUnits  {spear,axe,...} angreifende Einheiten
   * @param defUnits     stationierte Verteidiger
   * @param wallLevel    Palisadenstufe des Verteidigers
   * @param towerLevel   Turmstufe des Verteidigers
   * @param rng          Zufallsquelle (für Glück)
   * @param scores       {att, def} Punkte-Proxy für Moral
   * @returns Ergebnisobjekt
   */
  function resolve(attackUnits, defUnits, wallLevel, towerLevel, rng, scores) {
    var luck = rng.range(-C.COMBAT.luckRange, C.COMBAT.luckRange);
    var mor = morale(scores ? scores.att : 1, scores ? scores.def : 1);

    var atk = attackPower(attackUnits) * (1 + luck) * mor;
    var def = defensePower(defUnits, wallLevel || 0, towerLevel || 0);

    // Verteidigungs-Aufschlüsselung (Einheiten / Palisade / Turm / Held) für den Bericht.
    var wl = wallLevel || 0, tl = towerLevel || 0;
    var unitRaw = 0, archerDef = 0;
    for (var dk in defUnits) {
      var du = C.UNITS[dk]; if (!du) continue;
      var dd = (defUnits[dk] || 0) * du.defI;
      unitRaw += dd;
      if (dk === 'archer') archerDef += dd;
    }
    var wallMult = 1 + wl * C.COMBAT.wallDefPerLevel;
    var wallBase = C.COMBAT.baseVillageDef + wl * C.COMBAT.wallBaseDef;
    var towerExtra = archerDef * (tl * C.COMBAT.towerArcherBonus);

    var result = {
      luck: luck, morale: mor,
      attackPower: Math.round(atk), defensePower: Math.round(def),
      attackerWins: false,
      attackerLosses: {}, defenderLosses: {},
      attackerSurvivors: {}, defenderSurvivors: {},
      defWallLevel: wl, defTowerLevel: tl,
      defBreakdown: {
        units: Math.round(unitRaw),
        tower: Math.round(towerExtra),
        wall: Math.round((unitRaw + towerExtra) * (wallMult - 1) + wallBase),
        hero: Math.round((defUnits.hero || 0) * (C.UNITS.hero ? C.UNITS.hero.defI : 0))
      }
    };

    var e = C.COMBAT.lossExponent;

    if (atk <= 0) {
      // Keine Angriffskraft: Verteidiger gewinnt vollständig.
      result.attackerWins = false;
      for (var a0 in attackUnits) { result.attackerLosses[a0] = attackUnits[a0]; result.attackerSurvivors[a0] = 0; }
      for (var d0 in defUnits) { result.defenderLosses[d0] = 0; result.defenderSurvivors[d0] = defUnits[d0]; }
      return result;
    }

    if (atk > def) {
      // Angreifer gewinnt. Verluste anteilig zur Verteidigungsstärke.
      result.attackerWins = true;
      var lossRatioA = def <= 0 ? 0 : Math.pow(def / atk, e);
      for (var a in attackUnits) {
        var lost = Math.floor((attackUnits[a] || 0) * lossRatioA);
        result.attackerLosses[a] = lost;
        result.attackerSurvivors[a] = (attackUnits[a] || 0) - lost;
      }
      for (var d in defUnits) {
        result.defenderLosses[d] = defUnits[d] || 0;
        result.defenderSurvivors[d] = 0;
      }
    } else {
      // Verteidiger gewinnt. Angreifer wird aufgerieben.
      result.attackerWins = false;
      var lossRatioD = atk <= 0 ? 0 : Math.pow(atk / def, e);
      for (var a2 in attackUnits) {
        result.attackerLosses[a2] = attackUnits[a2] || 0;
        result.attackerSurvivors[a2] = 0;
      }
      for (var d2 in defUnits) {
        var dlost = Math.floor((defUnits[d2] || 0) * lossRatioD);
        result.defenderLosses[d2] = dlost;
        result.defenderSurvivors[d2] = (defUnits[d2] || 0) - dlost;
      }
    }
    return result;
  }

  // Tragkapazität einer (überlebenden) Armee.
  function carryCapacity(units) {
    var c = 0;
    for (var k in units) { var u = C.UNITS[k]; if (u) c += (units[k] || 0) * u.carry; }
    return c;
  }

  // Langsamste Einheit bestimmt die Reisegeschwindigkeit.
  function slowestSpeed(units) {
    var s = 0;
    for (var k in units) { if ((units[k] || 0) > 0 && C.UNITS[k]) s = Math.max(s, C.UNITS[k].speed); }
    return s || 14;
  }

  WOH.Combat = {
    resolve: resolve,
    attackPower: attackPower,
    defensePower: defensePower,
    carryCapacity: carryCapacity,
    slowestSpeed: slowestSpeed,
    totalUnits: totalUnits
  };
})(window.WOH = window.WOH || {});
