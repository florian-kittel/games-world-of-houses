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

    // Schritt 6.5: Bogenschuetzen-Suppression auf wallMult (multiplikativ,
    // wirkt nicht auf baseFlat). Wird VOR der eigentlichen Verteidigungs-
    // berechnung in defensePower nicht beruecksichtigt — daher hier
    // einmalig ableiten und durchziehen.
    var wl = wallLevel || 0, tl = towerLevel || 0;
    var archers = attackUnits.archer || 0;
    var sup = C.SIEGE
      ? Math.min(C.SIEGE.wallSuppressionMax, archers * C.SIEGE.wallSuppressionPerArcher)
      : 0;
    var wallMultBase = 1 + wl * C.COMBAT.wallDefPerLevel;
    var wallMult = wallMultBase * (1 - sup);

    // Verteidigungswert mit ggf. suppressierter wallMult.
    var unitRawAll = 0, archerDef = 0;
    for (var dk in defUnits) {
      var du = C.UNITS[dk]; if (!du) continue;
      var dd = (defUnits[dk] || 0) * du.defI;
      if (dk === 'archer') {
        archerDef += dd;
        dd *= (1 + tl * C.COMBAT.towerArcherBonus);
      }
      unitRawAll += dd;
    }
    var wallBase = C.COMBAT.baseVillageDef + wl * C.COMBAT.wallBaseDef;
    var def = unitRawAll * wallMult + wallBase;

    var atk = attackPower(attackUnits) * (1 + luck) * mor;

    // Verteidigungs-Aufschlüsselung (Einheiten / Palisade / Turm / Held) für den Bericht.
    var unitRaw = 0;
    for (var dk2 in defUnits) {
      var du2 = C.UNITS[dk2]; if (!du2) continue;
      unitRaw += (defUnits[dk2] || 0) * du2.defI;
    }
    var towerExtra = archerDef * (tl * C.COMBAT.towerArcherBonus);

    var result = {
      luck: luck, morale: mor,
      attackPower: Math.round(atk), defensePower: Math.round(def),
      attackerWins: false,
      attackerLosses: {}, defenderLosses: {},
      attackerSurvivors: {}, defenderSurvivors: {},
      defWallLevel: wl, defTowerLevel: tl,
      // Bogen-Suppression fuer den Kampfbericht
      wallSuppression: sup,
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

  // -----------------------------------------------------------------------
  // Strukturen-Kampf (Schritt 5)
  // -----------------------------------------------------------------------
  // Resolver fuer Sammel-/Eroberungstrupps gegen die Garnison einer neutralen
  // oder fremden Rohstoff-Struktur. Mechanik analog `resolve()` fuer Burgen,
  // aber: keine Palisade, kein Wachturm, kein Held-Verteidigungseffekt im
  // Sockel. Spec: "Bonus-Logik wie bei Burg-Wachturm (sofern vorhanden -
  // sonst neutraler Verteidigungswert)" -> Strukturen tragen weder Wall noch
  // Tower; lediglich der bestehende `baseVillageDef` wirkt als Sockel.
  //
  // Strukturen-spezifischer Score-Proxy fuer Moral: Anzahl Garnisons-Einheiten
  // plus level*5 (level reflektiert die Ausbaustufe als geringer Bauwert).
  function structureDefenderScore(structure) {
    var n = 0, g = (structure && structure.garrison) || {};
    for (var k in g) n += (g[k] || 0);
    var lvl = (structure && structure.level) || 1;
    return n + lvl * 5;
  }

  // Kampf-Resolver: Angreifer-Trupp vs. Strukturen-Garnison.
  // Liefert dasselbe Result-Format wie resolve(); zusaetzlich wird im
  // aufrufenden Code (game.js) entschieden, ob Beute (gather) oder
  // Besitzerwechsel (capture) folgt.
  // Befestigung einer Struktur aus ihrer Stufe: Stufe 2 = Palisade 1 + Turm 1,
  // Stufe 3 = Palisade 2 + Turm 2 (Stufe 1 = ungeschützt). Wirkt im Strukturkampf
  // wie Mauer/Turm einer Burg (Verteidigungs-Multiplikator, Grundwert, Turmbonus
  // für Bogenschützen) — ohne Belagerungs-HP.
  function structureFortLevel(structure) {
    var lvl = (structure && structure.level) || 1;
    return Math.max(0, lvl - 1);
  }
  function resolveStructureBattle(attackUnits, garrison, rng, attackerScore, structure) {
    var defScore = structureDefenderScore(structure);
    var fort = structureFortLevel(structure);
    return resolve(attackUnits, garrison || {}, fort, fort, rng, { att: attackerScore, def: defScore });
  }

  // -----------------------------------------------------------------------
  // Belagerung (Schritt 6.5)
  // -----------------------------------------------------------------------
  // Berechnet den Schaden an Mauer und Turm und reduziert ggf. die Stufe.
  // target ist ein Burg-Objekt (village) mit buildings.wall / buildings.tower
  // und (optional) wallHP / towerHP. Liefert ein Resultobjekt fuer den
  // Kampfbericht.
  function applySiege(attackUnits, target) {
    var res = {
      wallDamage: 0, towerDamage: 0,
      wallLevelBefore: target.buildings.wall || 0,
      wallLevelAfter:  target.buildings.wall || 0,
      towerLevelBefore: target.buildings.tower || 0,
      towerLevelAfter:  target.buildings.tower || 0
    };
    if (!C.SIEGE) return res;
    // Strukturen haben keine Wall/Tower - Guard: nur Burgen mit buildings.
    if (!target.buildings) return res;

    // Gesamtschaden berechnen
    var dmgW = 0, dmgT = 0;
    var sw = C.SIEGE.unitSiegeWall || {};
    var st = C.SIEGE.unitSiegeTower || {};
    for (var k in attackUnits) {
      var n = attackUnits[k] || 0;
      dmgW += n * (sw[k] || 0);
      dmgT += n * (st[k] || 0);
    }
    res.wallDamage  = Math.round(dmgW);
    res.towerDamage = Math.round(dmgT);

    // Wall: Stufenabbau mit Ueberschuss-Schaden
    applyDamageToStructure(target, 'wall', dmgW, C.SIEGE.wallMaxHP);
    res.wallLevelAfter = target.buildings.wall || 0;

    // Tower: nur abbauen, solange Tower existiert. Tower-HP wird mit Overflow
    // ebenfalls in tiefere Stufen weitergereicht.
    applyDamageToStructure(target, 'tower', dmgT, C.SIEGE.towerMaxHP);
    res.towerLevelAfter = target.buildings.tower || 0;

    return res;
  }

  // Hilfsfunktion: Schaden an wall/tower, mit Stufenabbau bei <=0 HP.
  function applyDamageToStructure(target, key, dmg, maxHPArr) {
    if (dmg <= 0) return;
    var level = target.buildings[key] || 0;
    if (level < 1) return;
    var hpField = key + 'HP';
    var hp = (typeof target[hpField] === 'number') ? target[hpField] : maxHPArr[Math.min(level, maxHPArr.length - 1)];
    var remaining = dmg;
    while (remaining > 0 && level >= 1) {
      if (hp > remaining) {
        hp -= remaining; remaining = 0;
      } else {
        remaining -= hp;
        level -= 1;
        if (level < 1) { hp = 0; break; }
        hp = maxHPArr[Math.min(level, maxHPArr.length - 1)];
      }
    }
    target.buildings[key] = level;
    target[hpField] = level >= 1 ? hp : 0;
    // Falls Stufe gefallen ist, aktive Reparaturen fuer dieses Bauwerk
    // verlieren ihren Bezug — sie bleiben bestehen, schliessen am Ende aber
    // auf der NEUEN aktuellen Stufe ab (siehe processRepairs in village.js).
  }

  WOH.Combat = {
    resolve: resolve,
    attackPower: attackPower,
    defensePower: defensePower,
    carryCapacity: carryCapacity,
    slowestSpeed: slowestSpeed,
    totalUnits: totalUnits,
    // Schritt 5: Strukturen-Kampf
    resolveStructureBattle: resolveStructureBattle,
    structureDefenderScore: structureDefenderScore,
    structureFortLevel: structureFortLevel,
    // Schritt 6.5: Belagerung
    applySiege: applySiege
  };
})(window.WOH = window.WOH || {});
