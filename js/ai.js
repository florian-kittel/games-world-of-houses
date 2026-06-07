/* =========================================================================
 * World of Houses – KI-Gegner
 * Regelbasierte KI pro Haus. Drei Schwierigkeitsstufen steuern Wirtschafts-,
 * Ausbildungs- und Angriffsverhalten. Schritt 7: Anti-Turtling (Boredom),
 * Belagerungs-Tauglichkeit, Expansionsmodus, Angriffe auf Strukturen.
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config, V = WOH.Village, G = WOH.Game;

  // Bevorzugte Ausbauziele der KI (Wirtschaft zuerst, dann Militär).
  var ECON_PRIORITY = ['farm', 'woodcutter', 'quarry', 'mine', 'warehouse', 'townhall'];
  var MIL_PRIORITY = ['barracks', 'wall', 'range', 'tower'];

  // Neutrale Default-Persönlichkeit (falls keine zugewiesen ist — Altsaves).
  var NEUTRAL_PERSONALITY = {
    name: 'Neutral',
    aggressionMult: 1.0, marginMult: 1.0, minAxe: 10,
    offShareBonus: 0.0, archerBias: 0.0,
    defenseMinMult: 1.0, supportThreshMult: 1.0,
    structureBias: 1.0, heroBarracksReq: null, batchMult: 1.0,
    buildBias: {}, shareResources: false, expandEager: false
  };

  // Persönlichkeit eines Hauses ermitteln; bei fehlender Zuweisung
  // (Altsaves) seed-deterministisch nachziehen und merken.
  function personalityOf(state, hid) {
    var brain = state.ai[hid];
    if (brain && !brain.personality && WOH.Game && WOH.Game.pickPersonalityKey) {
      brain.personality = WOH.Game.pickPersonalityKey(state.seed, hid);
    }
    var key = brain && brain.personality;
    var P = (C.PERSONALITIES && C.PERSONALITIES[key]) || null;
    return P || NEUTRAL_PERSONALITY;
  }

  function update(state, dt) {
    for (var hid in state.ai) {
      var house = state.houses[hid];
      if (!house || house.isPlayer) continue;
      var villages = G.villagesOfHouse(state, hid);
      if (!villages.length) continue;
      var brain = state.ai[hid];
      // Initialisierung (alte Saves, vor Migrationsschritt v5)
      if (typeof brain.lastAttackTime !== 'number') brain.lastAttackTime = state.gameTime || 0;
      brain.nextDecisionAt -= dt;
      if (brain.nextDecisionAt <= 0) {
        var cfg = C.DIFFICULTY[state.difficulty];
        decide(state, hid, villages, cfg);
        brain.nextDecisionAt = cfg.decisionEvery * (0.7 + Math.random() * 0.6);
      }
    }
  }

  function decide(state, hid, villages, cfg) {
    var p = personalityOf(state, hid);
    villages.forEach(function (v) {
      manageEconomy(state, v, cfg, p);
      manageMilitary(state, v, cfg, p);
    });
    // Schritt 8: Defensive Reaktion und Garnison-Stationierung pro Haus
    manageDefense(state, hid, villages, cfg, p);
    manageStructureGarrison(state, hid, villages, cfg, p);
    // Rohstoff-Logistik zwischen eigenen Burgen (nur passende Archetypen).
    if (p.shareResources) manageLogistics(state, hid, villages);
    // Aggressions-Schub im Expansionsmodus. Expansive/Dampfwalze treten früher
    // in den Expansionsmodus (expandEager): bereits, wenn EINE Burg ausgebaut ist.
    var atMax = p.expandEager ? villages.some(isAtMaxStage) : villages.every(isAtMaxStage);
    var pressure = atMax ? (C.AI ? C.AI.pressureMultiplier : 1.0) : 1.0;
    var aggression = cfg.aggression * pressure * (p.aggressionMult || 1.0);
    if (Math.random() < aggression) considerAttack(state, hid, villages, cfg, p);
  }

  // Eine Burg ist auf Max-Stage, wenn Halle = Threshold UND alle wirtschaftlichen
  // Gebaeude auf min. econ-Stufe stehen.
  function isAtMaxStage(v) {
    var th = (C.AI && C.AI.maxStageThreshold) || { townhall: 6, econ: 5 };
    if ((v.buildings.townhall || 0) < th.townhall) return false;
    var econKeys = ['woodcutter', 'quarry', 'mine', 'farm', 'warehouse'];
    return econKeys.every(function (k) { return (v.buildings[k] || 0) >= th.econ; });
  }

  // Wirtschaft ausbauen + Schritt 8: Reparatur beschaedigter Bauwerke.
  function manageEconomy(state, v, cfg, p) {
    p = p || NEUTRAL_PERSONALITY;
    // Erst Reparatur: dringend beschaedigte Wall/Tower sollen vor neuem Bau
    // wieder hochgezogen werden (multiplikativer Schutz lohnt sich am meisten).
    tryRepair(state, v);

    if (v.buildQueue.length >= 2) return;
    if (Math.random() > cfg.econ * 0.9) return;

    var candidates = ECON_PRIORITY.slice();
    MIL_PRIORITY.forEach(function (k) {
      if (V.meetsRequirements(v, k)) candidates.push(k);
    });
    // Persönlichkeits-Bias: höherer buildBias[k] => früher bauen (niedrigere
    // effektive Stufe in der Sortierung). So priorisiert die Defensive Mauer/
    // Turm/Schießplatz, die Aggressive die Kaserne, usw.
    var bias = p.buildBias || {};
    candidates.sort(function (a, b) {
      var ea = (v.buildings[a] || 0) - (bias[a] || 0);
      var eb = (v.buildings[b] || 0) - (bias[b] || 0);
      return ea - eb;
    });
    for (var i = 0; i < candidates.length; i++) {
      var r = G.enqueueBuild(state, v, candidates[i]);
      if (r.ok) return;
    }
  }

  // Repariert Wall/Tower, wenn HP unter Schwellwert UND Lager reicht.
  function tryRepair(state, v) {
    var aic = C.AI || {};
    var threshold = (typeof aic.repairHPThreshold === 'number') ? aic.repairHPThreshold : 0.5;
    var order = aic.repairPriority || ['wall', 'tower'];
    // Sortierung nach HP-Quote: kritischste Komponente zuerst.
    var jobs = [];
    order.forEach(function (key) {
      var lvl = v.buildings[key] || 0;
      if (lvl < 1) return;
      var max = key === 'wall' ? V.wallMaxHP(lvl) : V.towerMaxHP(lvl);
      var hp  = key === 'wall' ? V.wallHP(v)      : V.towerHP(v);
      if (max <= 0) return;
      var ratio = hp / max;
      if (ratio < threshold) jobs.push({ key: key, ratio: ratio });
    });
    jobs.sort(function (a, b) { return a.ratio - b.ratio; });
    for (var i = 0; i < jobs.length; i++) {
      var r = G.startRepair(state, v, jobs[i].key);
      if (r.ok) return; // ein Reparatur-Slot pro Tick reicht
    }
  }

  // Militaer ausbilden. Schritt 7: hoeherer Bogen-Share bei befestigten
  // Nachbarn. Schritt 8: KI bildet Helden aus, sobald Kaserne-Schwellwert
  // erreicht ist und noch kein Held vorhanden ist.
  function manageMilitary(state, v, cfg, p) {
    p = p || NEUTRAL_PERSONALITY;
    if ((v.buildings.barracks || 0) < 1) return;
    if (v.trainingQueue.length >= 2) return;

    // Schritt 8.1: Held-Ausbildung priorisieren. Persönlichkeit kann die
    // benötigte Kaserne-Stufe verschieben (expansiv früher, defensiv später).
    var aic = C.AI || {};
    var heroReq = (p.heroBarracksReq != null) ? p.heroBarracksReq
                : (aic.heroBarracksReq != null ? aic.heroBarracksReq : 4);
    var heroInQueue = (v.trainingQueue || []).some(function (q) { return q.unit === 'hero'; });
    var hasHero = (v.units.hero || 0) >= 1;
    if (!hasHero && !heroInQueue && (v.buildings.barracks || 0) >= heroReq) {
      var r = G.enqueueTrain(state, v, 'hero', 1);
      if (r.ok) return; // Held priorisiert, kein weiterer Trainings-Versuch in diesem Tick
      // Wenn Kosten/Pop nicht reichen, fallback auf normales Truppen-Training
    }

    if (Math.random() > cfg.train) return;

    // Batchgröße skaliert mit Schwierigkeit und Persönlichkeit (Dampfwalze
    // bildet in großen Wellen aus).
    var batch = Math.max(2, Math.round(4 * cfg.train * (p.batchMult || 1.0)));
    var roll = Math.random();
    // Offensiv-Anteil: Grund + Aggression + Persönlichkeits-Bonus (defensiv
    // negativ -> mehr Verteidiger). Auf sinnvolle Spanne klemmen.
    var offShare = 0.4 + cfg.aggression * 0.45 + (p.offShareBonus || 0);
    offShare = Math.max(0.1, Math.min(0.85, offShare));
    var needSiege = hasFortifiedNeighbor(state, v);
    var archerShare = (needSiege ? 0.30 : 0.18) + (p.archerBias || 0);
    archerShare = Math.max(0, Math.min(0.5, archerShare));
    var unit;
    if (roll < offShare) unit = 'axe';
    else if (roll < offShare + 0.22) unit = 'spear';
    else if ((v.buildings.range || 0) >= 1 && roll < offShare + 0.22 + archerShare) unit = 'archer';
    else unit = 'sword';
    G.enqueueTrain(state, v, unit, batch);
  }

  function hasFortifiedNeighbor(state, v) {
    for (var id in state.villages) {
      var t = state.villages[id];
      if (t.houseId === v.houseId) continue;
      if (G.distance(v, t) > 18) continue;
      if ((t.buildings.wall || 0) >= 3) return true;
    }
    return false;
  }

  // Truppensumme einer Burg (ohne Held — Held wird separat behandelt).
  function totalDefenders(v) {
    var n = 0; var u = v.units || {};
    n += (u.spear || 0) + (u.sword || 0) + (u.axe || 0) + (u.archer || 0);
    return n;
  }

  // Schritt 8.4: Defensive Reaktion. Wenn eine eigene Burg eine eingehende
  // hostile Bewegung sieht und die Verteidigung schwach gegenueber der
  // Angreifer-Kraft ist, schickt eine andere eigene Burg mit Truppen-
  // ueberschuss Verstaerkung. Quellburg behaelt mindestens castleDefenseMinimum.
  function manageDefense(state, hid, villages, cfg, p) {
    p = p || NEUTRAL_PERSONALITY;
    var aic = C.AI || {};
    var minDef = (aic.castleDefenseMinimum != null ? aic.castleDefenseMinimum : 30) * (p.defenseMinMult || 1.0);
    var supThresh = (aic.supportThreshold != null ? aic.supportThreshold : 1.2) * (p.supportThreshMult || 1.0);

    villages.forEach(function (v) {
      // Eingehende Bedrohung?
      var threat = 0;
      for (var i = 0; i < state.movements.length; i++) {
        var m = state.movements[i];
        if (m.toId !== v.id) continue;
        if (m.type !== 'attack' && m.type !== 'gather' && m.type !== 'capture') continue;
        if (m.ownerHouseId === hid) continue;
        threat += WOH.Combat.attackPower(m.units);
      }
      if (threat <= 0) return;

      // Eigene Verteidigung gegen die Bedrohung
      var defenders = WOH.Combat.defensePower(v.units, v.buildings.wall || 0, v.buildings.tower || 0);
      if (defenders >= threat * supThresh) return; // ausreichend stark

      // Nachbar-Burg mit Truppen-Ueberschuss suchen
      var best = null, bestSurplus = 0;
      villages.forEach(function (s) {
        if (s.id === v.id) return;
        var surplus = totalDefenders(s) - minDef;
        if (surplus <= 5) return;
        if (G.distance(s, v) > 22) return;
        if (G.hasOutboundMovement(state, s.id, v.id)) return; // schon unterwegs
        if (surplus > bestSurplus) { bestSurplus = surplus; best = s; }
      });
      if (!best) return;

      // Bis zur Haelfte des Ueberschusses entsenden (verteilt auf vorhandene Truppen)
      var send = {};
      var quota = Math.min(50, Math.max(5, Math.floor(bestSurplus / 2)));
      var sent = 0;
      ['spear', 'sword', 'axe', 'archer'].forEach(function (u) {
        var avail = best.units[u] || 0;
        if (sent >= quota || avail <= 0) return;
        var take = Math.min(avail, quota - sent);
        send[u] = take; sent += take;
      });
      if (sent <= 0) return;
      G.sendArmy(state, best.id, v.id, send, 'support');
    });
  }

  // Schritt 8.3: KI fuellt Garnisons eigener eroberter Strukturen auf.
  // Quelle ist die zugewiesene Heimatburg; nur wenn Heimatburg mindestens
  // castleDefenseMinimum behaelt und die Struktur unter Garnison-Ziel ist.
  function manageStructureGarrison(state, hid, villages, cfg, p) {
    p = p || NEUTRAL_PERSONALITY;
    if (!state.structures || !state.structures.length) return;
    var aic = C.AI || {};
    var baseTarget = aic.structureGarrisonTarget != null ? aic.structureGarrisonTarget : 50;
    // Expansive/defensive Häuser besetzen Strukturen stärker (structureBias),
    // begrenzt durch das Garnison-Cap.
    var target = Math.min(C.STRUCTURE_GARRISON_CAP || 100,
      Math.round(baseTarget * Math.max(0.5, Math.min(2.0, p.structureBias || 1.0))));
    var minDef = (aic.castleDefenseMinimum != null ? aic.castleDefenseMinimum : 30) * (p.defenseMinMult || 1.0);

    for (var i = 0; i < state.structures.length; i++) {
      var s = state.structures[i];
      if (s.ownerHouseId !== hid) continue;
      var current = 0; var g = s.garrison || {};
      for (var k in g) current += (g[k] || 0);
      if (current >= target) continue;

      var castle = state.villages[s.assignedCastleId];
      if (!castle || castle.houseId !== hid) continue;
      var surplus = totalDefenders(castle) - minDef;
      if (surplus < 10) continue; // Burg nicht plundern

      // Bis zu 20 Speer/Schwert vorrangig stationieren (Bogen lieber daheim).
      var need = Math.min(target - current, 20, surplus);
      var units = {};
      ['spear', 'sword'].forEach(function (u) {
        if (need <= 0) return;
        var avail = castle.units[u] || 0;
        var take = Math.min(avail, need);
        if (take > 0) { units[u] = take; need -= take; }
      });
      if (Object.keys(units).length === 0) continue;
      G.stationGarrison(state, castle, s, units);
    }
  }

  // Rohstoff-Logistik: verschiebt einen Überschuss-Rohstoff (Quelle nahe am
  // Lagerlimit) zu der eigenen Burg, die davon am wenigsten hat. Nutzt das
  // neue Versorgungstross-System (sendArmy mit resources). Selbst-gedrosselt
  // über brain.lastLogisticsAt, damit keine Tross-Flut entsteht.
  function manageLogistics(state, hid, villages) {
    if (!villages || villages.length < 2) return;
    var brain = state.ai[hid];
    var now = state.gameTime || 0;
    if (brain.lastLogisticsAt && (now - brain.lastLogisticsAt) < 45) return;

    var plan = null;
    C.RESOURCES.forEach(function (r) {
      var donor = null, donorAmt = -1, recip = null, recipAmt = Infinity;
      villages.forEach(function (v) {
        var cap = V.storageCap(v) || 1;
        var amt = v.resources[r] || 0;
        if (amt / cap > 0.85 && amt > donorAmt) { donorAmt = amt; donor = v; }
        if (amt < recipAmt) { recipAmt = amt; recip = v; }
      });
      if (!donor || !recip || donor.id === recip.id) return;
      var recipCap = V.storageCap(recip) || 1;
      if (recipAmt / recipCap >= 0.35) return;           // Empfänger ist nicht knapp
      if (hasResourceSupply(state, donor.id, recip.id)) return; // schon unterwegs
      var donorCap = V.storageCap(donor) || 1;
      var ship = Math.floor(Math.min(donorAmt * 0.4, donorCap * 0.3));
      if (ship < 100) return;
      var gain = donorAmt - recipAmt;                    // Nutzen-Proxy
      if (!plan || gain > plan.gain) plan = { from: donor, to: recip, res: r, amt: ship, gain: gain };
    });
    if (!plan) return;
    var resObj = {}; resObj[plan.res] = plan.amt;
    var r = G.sendArmy(state, plan.from.id, plan.to.id, {}, 'support', resObj);
    if (r.ok) brain.lastLogisticsAt = now;
  }

  // Läuft bereits ein Versorgungstross (Support mit Rohstoffen) zwischen diesen
  // beiden Burgen? Verhindert doppelte Lieferungen derselben Route.
  function hasResourceSupply(state, fromId, toId) {
    var mv = state.movements || [];
    for (var i = 0; i < mv.length; i++) {
      var m = mv[i];
      if (m.type === 'support' && m.fromId === fromId && m.toId === toId && m.resources) return true;
    }
    return false;
  }

  // Aktuellen Boredom-Margin der KI berechnen: 2.0 sinkt mit Stillstandszeit
  // bis zum AI.marginFloor.
  function currentMargin(state, hid) {
    var brain = state.ai[hid] || {};
    var ai = C.AI || { boredomFactor: { normal: 0.001 }, marginFloor: 1.0 };
    var bf = (ai.boredomFactor && ai.boredomFactor[state.difficulty]) || 0.001;
    var dtSinceAttack = Math.max(0, (state.gameTime || 0) - (brain.lastAttackTime || 0));
    var margin = 2.0 - bf * dtSinceAttack;
    return Math.max(ai.marginFloor || 1.0, margin);
  }

  // Benoetigte Bogenanzahl fuer eine erfolgreiche Belagerung des Ziels.
  function archersNeededFor(t) {
    var w = t.buildings ? (t.buildings.wall || 0) : 0;
    var tw = t.buildings ? (t.buildings.tower || 0) : 0;
    var siegeScore = w * 2 + tw * 1.5;
    var ratio = (C.AI && C.AI.archerToSiegeRatio) || 20;
    return Math.ceil(siegeScore * ratio);
  }

  function considerAttack(state, hid, villages, cfg, p) {
    p = p || NEUTRAL_PERSONALITY;
    var best = null, bestAxe = 0;
    villages.forEach(function (v) {
      var a = v.units.axe || 0;
      if (a > bestAxe) { bestAxe = a; best = v; }
    });
    // Mindest-Schlagkraft je Persönlichkeit (Dampfwalze sammelt erst Übermacht,
    // Aggressive schlägt früh zu).
    var minAxe = (p.minAxe != null) ? p.minAxe : 10;
    if (!best || bestAxe < minAxe) return;

    var axes = best.units.axe || 0;
    var swords = best.units.sword || 0;
    var archers = best.units.archer || 0;
    var escort = Math.floor(swords * 0.25);
    var hero = (best.units.hero || 0) >= 1 ? 1 : 0;

    // Truppmix inkl. Bogen (Schritt 7): Bogen helfen Belagerung + leichte
    // Hauptkampf-Beteiligung. Held nur fuer Eroberungs-Trupp.
    var attackUnits = { axe: axes, sword: escort, archer: archers };
    var atkPower = WOH.Combat.attackPower(attackUnits);
    // Nötiger Kraftvorsprung — moduliert durch Persönlichkeit (marginMult).
    var MARGIN = currentMargin(state, hid) * (p.marginMult || 1.0);

    // Strukturen-Ziele bewerten (Sammeln/Erobern) — gewichtet nach structureBias.
    var structureTarget = pickStructureTarget(state, hid, best, p);

    // Burg-Ziele bewerten
    var burgTarget = null, score = -Infinity;
    for (var id in state.villages) {
      var t = state.villages[id];
      if (t.houseId === hid) continue;
      var dist = G.distance(best, t);
      if (dist > 18) continue;
      var def = WOH.Combat.defensePower(t.units, t.buildings.wall || 0, t.buildings.tower || 0);
      if (def < 1) def = 1;
      // Bogen-Suppression naehrt die Erfolgschance bei Wall.
      var sup = C.SIEGE ? Math.min(C.SIEGE.wallSuppressionMax, archers * C.SIEGE.wallSuppressionPerArcher) : 0;
      var defAdj = def * (1 - sup * 0.5); // Heuristik: KI rechnet 50% der Suppression ein
      if (atkPower < defAdj * MARGIN) continue;
      // Belagerungs-Tauglichkeit: bei stark befestigten Zielen pruefen, ob
      // genug Bogenschuetzen verfuegbar sind. Sonst spaeter angreifen.
      var needArch = archersNeededFor(t);
      if (needArch > 0 && archers < needArch * 0.5) continue;
      var value = 0; for (var b in t.buildings) value += t.buildings[b];
      // Aggressive/Dampfwalze suchen verstärkt den Spieler heim.
      var playerBonus = t.isPlayer ? 25 * (p.aggressionMult || 1.0) : 0;
      var s = value * 4 - dist * 2 + playerBonus + (atkPower / defAdj) * 6;
      if (s > score) { score = s; burgTarget = t; }
    }

    // Expansive Häuser (hoher structureBias) bevorzugen eine erobbare Struktur
    // VOR einem Burgangriff — Ausdehnung über Rohstoffknoten.
    if (structureTarget && structureTarget.canCapture && (p.structureBias || 1.0) >= 1.5) {
      var sendC = { axe: Math.min(axes, 50), sword: Math.min(escort, 20), archer: Math.min(archers, 30), hero: 1 };
      var rc = G.sendArmy(state, best.id, structureTarget.struct.id, sendC, 'capture');
      if (rc.ok) { state.ai[hid].lastAttackTime = state.gameTime; return; }
    }

    // Entscheidung: Burg vor Struktur (groesserer Effekt), Struktur als Fallback.
    if (burgTarget) {
      var send = { axe: axes, sword: escort, archer: archers };
      // Held mitgeben bei moeglicher Eroberung — falls Trupp ueberwaeltigend stark.
      if (hero && atkPower > WOH.Combat.defensePower(burgTarget.units,
          burgTarget.buildings.wall || 0, burgTarget.buildings.tower || 0) * (MARGIN + 0.5)) {
        send.hero = 1;
      }
      var r = G.sendArmy(state, best.id, burgTarget.id, send, 'attack');
      if (r.ok) {
        state.ai[hid].lastAttackTime = state.gameTime;
        if (burgTarget.isPlayer) {
          G.pushLog(state, 'Späher melden: ' + state.houses[hid].name +
            ' entsendet eine große Armee (' + axes + ' Axt, ' + archers + ' Bogen) auf ' +
            burgTarget.name + '!', 'bad');
        }
      }
      return;
    }

    if (structureTarget) {
      var attackType = (hero && structureTarget.canCapture) ? 'capture' : 'gather';
      var send2 = { axe: Math.min(axes, 50), sword: Math.min(escort, 20), archer: Math.min(archers, 30) };
      if (attackType === 'capture') send2.hero = 1;
      var r2 = G.sendArmy(state, best.id, structureTarget.struct.id, send2, attackType);
      if (r2.ok) state.ai[hid].lastAttackTime = state.gameTime;
    }
  }

  // Suche eine lohnende Strukturen-Aktion: gut gefuelltes Lager
  // (Sammeln) oder schwache Garnison + verfuegbarer Held (Eroberung).
  function pickStructureTarget(state, hid, src, p) {
    p = p || NEUTRAL_PERSONALITY;
    if (!state.structures || !state.structures.length) return null;
    var heroAvailable = (src.units.hero || 0) >= 1;
    var bias = p.structureBias || 1.0;
    var best = null, bestScore = -1;
    for (var i = 0; i < state.structures.length; i++) {
      var s = state.structures[i];
      if (s.ownerHouseId === hid) continue; // eigene meiden
      var dist = Math.sqrt((src.x - s.x) * (src.x - s.x) + (src.y - s.y) * (src.y - s.y));
      if (dist > 18) continue;
      var garrisonN = 0; var g = s.garrison || {};
      for (var k in g) garrisonN += (g[k] || 0);
      // Bei zu starker Garnison: skip
      if (garrisonN > 50) continue;
      var meta = C.RESOURCE_STRUCTURES[s.type];
      var storeLevel = s.storage && meta ? (s.storage[meta.res] || 0) : 0;
      // Score: Lager-Volumen, Garnisonsschwaeche, Heimatburg-Bonus.
      // Expansions-Bias hebt die Attraktivität von Strukturen insgesamt an.
      var score = (storeLevel * 0.1 - garrisonN * 5 - dist * 2) * bias;
      var canCapture = heroAvailable && s.ownerHouseId == null; // primaer neutrale erobern
      if (canCapture) score += 50 * bias;
      if (score > bestScore) { bestScore = score; best = { struct: s, canCapture: canCapture }; }
    }
    return best;
  }

  WOH.AI = {
    update: update,
    // Exports fuer Tests / Debugging
    currentMargin: currentMargin,
    isAtMaxStage: isAtMaxStage,
    archersNeededFor: archersNeededFor
  };
})(window.WOH = window.WOH || {});
