/* =========================================================================
 * World of Houses – Zentraler Spielzustand & Tick-Verarbeitung
 * Verwaltet Welt, Dörfer, Häuser, Bewegungen und das Voranschreiten der Zeit.
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config, V = WOH.Village, Combat = WOH.Combat;

  var idCounter = 1;
  function uid(p) { return (p || 'm') + '_' + (idCounter++) + '_' + Math.floor(Math.random() * 1e6); }

  // Kampfberichte, an denen der Spieler beteiligt ist (transient, nicht gespeichert).
  // Die UI holt sie hier ab und zeigt das Kampfbericht-Overlay.
  var pendingReports = [];

  // ---------------------------------------------------------------------
  // Neues Spiel erzeugen
  // ---------------------------------------------------------------------
  function newGame(seed, difficulty, enemyCount) {
    seed = seed >>> 0;
    var rng = WOH.RNG(seed);
    var diff = C.DIFFICULTY[difficulty] ? difficulty : 'normal';

    // Gesamtzahl Burgen = Spieler + Gegner (max. C.MAP.maxEnemies).
    var maxE = C.MAP.maxEnemies || 5;
    var nEnemies = (enemyCount == null) ? (C.MAP.defaultEnemies || 4) : enemyCount;
    nEnemies = Math.max(1, Math.min(maxE, nEnemies | 0));
    var total = nEnemies + 1;

    var map = WOH.MapGen.generate(rng);
    var spots = WOH.MapGen.placeVillages(map, rng, total);
    var houses = WOH.Houses.generate(rng, spots.length);

    // Spieler bekommt ein zufälliges Haus/Dorf.
    var playerIdx = rng.int(0, spots.length - 1);
    houses[playerIdx].isPlayer = true;
    houses[playerIdx].name = 'Haus ' + houses[playerIdx].surname + ' (Du)';

    var villages = {}, houseMap = {};
    houses.forEach(function (h) { houseMap[h.id] = h; });

    var playerVillageId = null;
    spots.forEach(function (s, i) {
      var house = houses[i];
      var bonus = WOH.MapGen.bonusFor(map, s.x, s.y, rng);
      var vid = 'v_' + i;
      var isPlayer = house.isPlayer;
      var village = createVillage(vid, house, s.x, s.y, bonus, isPlayer, diff, rng);
      villages[vid] = village;
      if (isPlayer) playerVillageId = vid;
    });

    // Neutrale Rohstoff-Strukturen (Dorf-Felder als belegt übergeben).
    var structures = WOH.MapGen.placeResourceStructures(map, rng, spots);

    var state = {
      version: 4,
      seed: seed,
      difficulty: diff,
      gameTime: 0,
      map: map,
      houses: houseMap,
      villages: villages,
      structures: structures,
      playerHouseId: houses[playerIdx].id,
      playerVillageId: playerVillageId,
      movements: [],
      log: [],
      ai: {}
    };
    // Strukturen auf das Schritt-2-Schema bringen (Idempotent).
    normalizeStructures(state);
    // KI-Entscheidungszeitpunkte initialisieren
    for (var hid in houseMap) {
      if (!houseMap[hid].isPlayer) state.ai[hid] = { nextDecisionAt: rng.range(2, 10) };
    }
    pushLog(state, 'Die Welt erwacht. Haus ' + houses[playerIdx].surname +
      ' erhebt sich. ' + (spots.length - 1) + ' rivalisierende Häuser teilen sich das Land.');
    return state;
  }

  function createVillage(id, house, x, y, bonus, isPlayer, diff, rng) {
    var boost = isPlayer ? 0 : C.DIFFICULTY[diff].startBoost;
    var buildings = {
      townhall: 1, woodcutter: 1, quarry: 1, mine: 1, farm: 1,
      warehouse: 1, barracks: 0, range: 0, wall: 0, tower: 0
    };
    // KI-Startvorsprung auf Wirtschaft (Halle startet immer auf 1).
    ['woodcutter', 'quarry', 'mine', 'farm', 'warehouse'].forEach(function (k) {
      buildings[k] = Math.min(C.BUILDINGS[k].max, buildings[k] + boost);
    });

    var units = { spear: 0, sword: 0, axe: 0, archer: 0, hero: 0 };
    if (!isPlayer && boost >= 1) {
      units.spear = rng.int(5, 10) * boost;
      units.sword = rng.int(2, 6) * boost;
    } else if (isPlayer) {
      units.spear = 8; // kleine Starttruppe zur Verteidigung
    }

    return {
      id: id, name: house.seat.replace(/^auf |^von |^vom |^aus /, ''),
      x: x, y: y, houseId: house.id, isPlayer: isPlayer,
      bonus: bonus,
      resources: { food: 400, wood: 400, stone: 400, iron: 250 },
      buildings: buildings,
      units: units,
      trainingQueue: [],
      buildQueue: [],
      loyalty: 100
    };
  }

  // ---------------------------------------------------------------------
  // Hilfsfunktionen
  // ---------------------------------------------------------------------
  function distance(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function villageScore(v) {
    var s = 0; for (var k in v.buildings) s += v.buildings[k];
    for (var u in v.units) s += (v.units[u] || 0) * 0.5;
    return s;
  }
  function houseOf(state, v) { return state.houses[v.houseId]; }
  function villagesOfHouse(state, houseId) {
    var out = [];
    for (var id in state.villages) if (state.villages[id].houseId === houseId) out.push(state.villages[id]);
    return out;
  }
  function pushLog(state, text, kind) {
    state.log.unshift({ t: Math.round(state.gameTime), text: text, kind: kind || 'info' });
    if (state.log.length > 120) state.log.length = 120;
  }

  // ---------------------------------------------------------------------
  // Aktionen
  // ---------------------------------------------------------------------
  function enqueueBuild(state, village, key) {
    var current = village.buildings[key] || 0;
    var queuedToSame = village.buildQueue.filter(function (q) { return q.key === key; }).length;
    var target = current + queuedToSame + 1;
    if (target > V.maxLevel(key)) return { ok: false, msg: 'Maximale Stufe erreicht.' };
    if (!V.meetsRequirements(village, key, target)) return { ok: false, msg: 'Voraussetzungen nicht erfüllt.' };
    var cost = V.buildingCost(key, target - 1);
    if (!V.canAfford(village, cost)) return { ok: false, msg: 'Nicht genug Rohstoffe.' };
    V.pay(village, cost);
    village.buildQueue.push({ key: key, target: target, timeLeft: V.buildTime(village, key, target - 1) });
    return { ok: true };
  }

  function enqueueTrain(state, village, unit, count) {
    if ((village.buildings.barracks || 0) < 1 && unit !== 'archer')
      return { ok: false, msg: 'Keine Kaserne.' };
    if (unit === 'archer' && (village.buildings.range || 0) < 1)
      return { ok: false, msg: 'Kein Schießplatz.' };
    var u = C.UNITS[unit];
    // Held: einzigartig pro Dorf (vorhandener + in Ausbildung + neu <= 1).
    if (u.unique) {
      var inQueue = (village.trainingQueue || []).reduce(function (s, q) {
        return s + (q.unit === unit ? q.remaining : 0);
      }, 0);
      if ((village.units[unit] || 0) + inQueue + count > 1)
        return { ok: false, msg: 'Maximal 1 ' + u.name + ' pro Dorf.' };
    }
    var cost = {};
    C.RESOURCES.forEach(function (r) { cost[r] = (u.cost[r] || 0) * count; });
    if (!V.canAfford(village, cost)) return { ok: false, msg: 'Nicht genug Rohstoffe.' };
    // Bevölkerungsgrenze
    if (V.populationUsed(village) + count * u.pop > V.populationCap(village))
      return { ok: false, msg: 'Bevölkerungsgrenze erreicht (Bauernhof ausbauen).' };
    V.pay(village, cost);
    var src = unit === 'archer' ? 'range' : 'barracks';
    var lvl = village.buildings[src] || 1;
    var perTime = u.trainTime / (1 + lvl * 0.06);
    village.trainingQueue.push({ unit: unit, remaining: count, perTime: perTime, timeLeft: perTime });
    return { ok: true };
  }

  function sendArmy(state, fromId, toId, units, type) {
    var from = state.villages[fromId], to = state.villages[toId];
    if (!from || !to) return { ok: false, msg: 'Ungültiges Ziel.' };
    var any = false;
    for (var k in units) {
      var n = Math.min(units[k] || 0, from.units[k] || 0);
      units[k] = n; if (n > 0) any = true;
    }
    if (!any) return { ok: false, msg: 'Keine Einheiten ausgewählt.' };
    // Einheiten aus dem Dorf abziehen
    for (var u in units) from.units[u] -= units[u];
    var dist = distance(from, to);
    var travel = Math.max(C.MOVEMENT.minTravel, dist * Combat.slowestSpeed(units));
    state.movements.push({
      id: uid('mv'), fromId: fromId, toId: toId, units: units,
      type: type || 'attack', startTime: state.gameTime, arriveTime: state.gameTime + travel,
      ownerHouseId: from.houseId
    });
    return { ok: true, travel: travel };
  }

  // ---------------------------------------------------------------------
  // Tick: dtRealMs -> Spielzeit voranschreiten
  // ---------------------------------------------------------------------
  function tick(state, dtRealMs) {
    var dt = (dtRealMs / 1000) * C.TIME_SCALE;
    if (dt <= 0) return;
    // Sicherheitsobergrenze (z. B. nach langem Tab-Schlaf): in Blöcken abarbeiten
    var MAX_STEP = 30; // Spielsekunden
    while (dt > 0) {
      var step = Math.min(dt, MAX_STEP);
      advance(state, step);
      dt -= step;
    }
  }

  function advance(state, dt) {
    state.gameTime += dt;
    // Dörfer: Produktion, Bau, Ausbildung, Treue-Regeneration
    for (var id in state.villages) {
      var v = state.villages[id];
      V.applyProduction(v, dt);
      processBuildQueue(v, dt);
      processTrainQueue(v, dt);
      if (v.loyalty < 100) v.loyalty = Math.min(100, v.loyalty + C.COMBAT.loyaltyRegenPerHour * (dt / 3600));
    }
    // Strukturen: Produktion in eigenes Lager (neutral) bzw. in die Heimatburg (eigen)
    applyStructureProduction(state, dt);
    processMovements(state);
    WOH.AI.update(state, dt);
  }

  function processBuildQueue(v, dt) {
    if (!v.buildQueue.length) return;
    var job = v.buildQueue[0];
    job.timeLeft -= dt;
    if (job.timeLeft <= 0) {
      v.buildings[job.key] = job.target;
      v.buildQueue.shift();
    }
  }

  function processTrainQueue(v, dt) {
    if (!v.trainingQueue.length) return;
    var job = v.trainingQueue[0];
    job.timeLeft -= dt;
    // Mehrere Einheiten pro Step möglich (bei großem dt)
    while (job.timeLeft <= 0 && job.remaining > 0) {
      v.units[job.unit] = (v.units[job.unit] || 0) + 1;
      job.remaining -= 1;
      job.timeLeft += job.perTime;
    }
    if (job.remaining <= 0) v.trainingQueue.shift();
  }

  function processMovements(state) {
    var remaining = [];
    for (var i = 0; i < state.movements.length; i++) {
      var m = state.movements[i];
      if (state.gameTime >= m.arriveTime) {
        if (m.type === 'attack') resolveAttack(state, m);
        else if (m.type === 'return') resolveReturn(state, m);
        else if (m.type === 'support') resolveSupport(state, m);
        else if (m.type === 'gather')  resolveGatherStub(state, m);
        else if (m.type === 'capture') resolveCaptureStub(state, m);
      } else {
        remaining.push(m);
      }
    }
    state.movements = remaining;
  }

  // -- Strukturen-Stubs (Schritt 2): leiten Einheiten unverbraucht zurueck.
  // -- Echte Sammel-/Eroberungslogik folgt in Schritt 5 (combat.js + ui.js).
  function resolveGatherStub(state, m) {
    var fromHouse = state.houses[m.ownerHouseId];
    if (fromHouse && fromHouse.isPlayer) {
      pushLog(state, 'Sammeln noch nicht implementiert — Trupp kehrt zurueck.', 'info');
    }
    returnArmy(state, m, m.units, null);
  }
  function resolveCaptureStub(state, m) {
    var fromHouse = state.houses[m.ownerHouseId];
    if (fromHouse && fromHouse.isPlayer) {
      pushLog(state, 'Strukturen-Eroberung noch nicht implementiert — Trupp kehrt zurueck.', 'info');
    }
    returnArmy(state, m, m.units, null);
  }

  function resolveSupport(state, m) {
    var to = state.villages[m.toId];
    if (!to) return;
    // Unterstützung verschmilzt mit den Verteidigern (vereinfacht).
    for (var k in m.units) to.units[k] = (to.units[k] || 0) + m.units[k];
    if (to.isPlayer) pushLog(state, 'Verstärkung ist in ' + to.name + ' eingetroffen.', 'good');
  }

  function resolveReturn(state, m) {
    var to = state.villages[m.toId];
    if (!to) return; // Heimatdorf existiert nicht mehr -> Einheiten verloren
    for (var k in m.units) to.units[k] = (to.units[k] || 0) + (m.units[k] || 0);
    if (m.loot) {
      var cap = V.storageCap(to);
      C.RESOURCES.forEach(function (r) {
        to.resources[r] = Math.min(cap, (to.resources[r] || 0) + (m.loot[r] || 0));
      });
    }
    if (to.isPlayer) {
      var lootStr = m.loot ? lootText(m.loot) : '';
      pushLog(state, 'Deine Armee ist nach ' + to.name + ' zurückgekehrt.' +
        (lootStr ? ' Beute: ' + lootStr : ''), 'good');
    }
  }

  function lootText(loot) {
    return C.RESOURCES.filter(function (r) { return (loot[r] || 0) > 0; })
      .map(function (r) { return Math.round(loot[r]) + ' ' + C.RESOURCE_META[r].name; })
      .join(', ');
  }

  function resolveAttack(state, m) {
    var target = state.villages[m.toId];
    var from = state.villages[m.fromId];
    var rng = WOH.RNG((state.seed ^ Math.floor(m.arriveTime * 1000)) >>> 0);

    if (!target) { // Ziel verschwunden
      if (from) returnArmy(state, m, m.units, null);
      return;
    }

    var defUnits = {}; for (var k in target.units) defUnits[k] = target.units[k];
    var attUnits = {}; for (var ak in m.units) attUnits[ak] = m.units[ak];
    var scores = { att: villageScore(from || { buildings: {}, units: {} }), def: villageScore(target) };
    var res = WOH.Combat.resolve(m.units, defUnits, target.buildings.wall || 0, target.buildings.tower || 0, rng, scores);
    res.fromName = from ? from.name : '—';
    res.toName = target.name;
    res.attackerHouse = state.houses[m.ownerHouseId];
    res.defenderHouse = state.houses[target.houseId];
    res.attackerUnits = attUnits;   // ursprüngliche Angreifer (für Bericht)
    res.defenderUnits = defUnits;   // ursprüngliche Verteidiger

    // Verteidiger aktualisieren (Verluste anwenden)
    for (var d in target.units) target.units[d] = res.defenderSurvivors[d] || 0;

    var attackerIsPlayer = m.ownerHouseId === state.playerHouseId;
    var defenderIsPlayer = target.houseId === state.playerHouseId;

    if (res.attackerWins) {
      var survivors = res.attackerSurvivors;
      var hasHero = (survivors.hero || 0) >= 1;
      if (hasHero) {
        // Eroberung: nur mit Held möglich. Der Held verschwindet dabei,
        // die übrigen Überlebenden besetzen das eroberte Dorf.
        survivors.hero = 0;
        captureVillage(state, target, m.ownerHouseId);
        for (var su in survivors) target.units[su] = (target.units[su] || 0) + (survivors[su] || 0);
        res.loot = null; res.captured = true;
      } else {
        // Kein Held: Rohstoffe rauben und heimführen.
        var cap = WOH.Combat.carryCapacity(survivors);
        var loot = {};
        var avail = C.RESOURCES.reduce(function (s, r) { return s + target.resources[r]; }, 0);
        var take = Math.min(cap, avail);
        C.RESOURCES.forEach(function (r) {
          var share = avail > 0 ? (target.resources[r] / avail) : 0;
          var amt = Math.min(target.resources[r], take * share);
          loot[r] = amt; target.resources[r] -= amt;
        });
        res.loot = loot; res.captured = false;
        returnArmy(state, m, survivors, loot);
      }
    } else {
      res.loot = null; res.captured = false;
      // Angreifer aufgerieben -> nichts kehrt zurück.
    }

    logBattle(state, m, res, attackerIsPlayer, defenderIsPlayer);
    if (attackerIsPlayer || defenderIsPlayer) {
      res.playerRole = defenderIsPlayer ? 'defender' : 'attacker';
      pendingReports.push(res);
    }
  }

  function captureVillage(state, village, newHouseId) {
    var old = state.houses[village.houseId];
    var oldHouseId = village.houseId;
    village.houseId = newHouseId;
    village.loyalty = 25;
    village.trainingQueue = [];
    village.buildQueue = [];
    var nh = state.houses[newHouseId];
    village.isPlayer = !!(nh && nh.isPlayer);
    pushLog(state, 'EROBERT: ' + village.name + ' fällt an ' + (nh ? nh.name : '?') +
      (old ? ' (zuvor ' + old.name + ')' : '') + '.', 'battle');
    // Strukturen, die diese Burg als Heimatburg hatten, an die naechste eigene
    // Burg des alten Besitzers ueberweisen (oder neutralisieren, wenn keine mehr).
    reassignStructuresAfterCastleLoss(state, oldHouseId, village.id);
  }

  function returnArmy(state, m, units, loot) {
    var any = WOH.Combat.totalUnits(units) > 0;
    if (!any && !(loot && C.RESOURCES.some(function (r) { return loot[r] > 0; }))) return;
    var from = state.villages[m.fromId];
    if (!from) return;
    var dist = distance(state.villages[m.toId] || from, from);
    var travel = Math.max(C.MOVEMENT.minTravel, dist * WOH.Combat.slowestSpeed(units));
    state.movements.push({
      id: uid('mv'), fromId: m.toId, toId: m.fromId, units: units,
      type: 'return', startTime: state.gameTime, arriveTime: state.gameTime + travel,
      ownerHouseId: m.ownerHouseId, loot: loot
    });
  }

  function logBattle(state, m, res, attIsPlayer, defIsPlayer) {
    if (!attIsPlayer && !defIsPlayer) return; // KI-vs-KI nicht spammen
    var outcome = res.attackerWins ? 'Sieg des Angreifers' : 'Verteidigung hält';
    var who = attIsPlayer ? 'Dein Angriff auf ' + res.toName : 'Angriff auf dein Dorf ' + res.toName;
    var txt = who + ' — ' + outcome +
      ' (Glück ' + (res.luck >= 0 ? '+' : '') + Math.round(res.luck * 100) + '%).';
    if (res.attackerWins && res.loot) txt += ' Beute: ' + lootText(res.loot) + '.';
    if (res.captured) txt += ' Dorf erobert!';
    var kind = res.attackerWins ? (attIsPlayer ? 'good' : 'bad') : (defIsPlayer ? 'good' : 'bad');
    pushLog(state, txt, 'battle');
    state.lastReport = res;
  }

  // ---------------------------------------------------------------------
  // Strukturen (Schritt 2): Normalisierung, Produktion, Reassignment
  // ---------------------------------------------------------------------
  // Idempotente Normalisierung eines Struktur-Objekts auf das Schritt-2-Schema.
  // - level: 1..3 (abgeleitet aus altem tier 0..2, sonst Default 1)
  // - storage: { res: amount } (eigenes Lager, nur bei neutralen Strukturen relevant)
  // - garrison: { spear, sword, axe, archer } (max. STRUCTURE_GARRISON_CAP gesamt)
  // - ownerHouseId / assignedCastleId: null = neutral / keine Heimatburg
  function normalizeStructure(s) {
    if (!s) return s;
    if (typeof s.level !== 'number') {
      s.level = (typeof s.tier === 'number') ? (s.tier + 1) : 1;
    }
    if (s.level < 1) s.level = 1;
    if (s.level > 3) s.level = 3;
    if (s.ownerHouseId === undefined) s.ownerHouseId = null;
    if (s.assignedCastleId === undefined) s.assignedCastleId = null;
    if (!s.storage)  s.storage  = {};
    if (!s.garrison) s.garrison = { spear: 0, sword: 0, axe: 0, archer: 0 };
    return s;
  }
  function normalizeStructures(state) {
    (state.structures || []).forEach(normalizeStructure);
  }

  // Produktion neutraler und eroberter Strukturen ueber dt Spielsekunden.
  // - neutral (ownerHouseId === null): in eigenes Lager bis capacity[level-1]
  // - erobert: direkt in Burg-Lager der zugewiesenen Heimatburg (storageCap)
  // Tritt eine Inkonsistenz auf (Heimatburg fehlt oder wechselte Besitzer),
  // wird die Struktur durch reassignStructuresAfterCastleLoss neu zugeordnet.
  function applyStructureProduction(state, dt) {
    var list = state.structures;
    if (!list || !list.length) return;
    var meta, res, prod, cap;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      meta = C.RESOURCE_STRUCTURES[s.type];
      if (!meta) continue; // unbekannter Typ -> ignorieren
      res  = meta.res;
      prod = C.RESOURCE_STRUCTURE_LEVELS.production[s.level - 1];
      cap  = C.RESOURCE_STRUCTURE_LEVELS.capacity[s.level - 1];
      if (s.ownerHouseId == null) {
        // Neutral: in eigenes Lager
        s.storage[res] = Math.min(cap, (s.storage[res] || 0) + prod * dt);
      } else {
        // Eigen: in Heimatburg
        var target = state.villages[s.assignedCastleId];
        if (!target || target.houseId !== s.ownerHouseId) {
          // Heimatburg fehlt oder anderer Besitzer -> Reassignment ausloesen.
          reassignStructuresAfterCastleLoss(state, s.ownerHouseId,
            (target ? target.id : s.assignedCastleId));
          // Im aktuellen Tick die Produktion verwerfen (vereinfacht).
          continue;
        }
        var vcap = V.storageCap(target);
        target.resources[res] = Math.min(vcap, (target.resources[res] || 0) + prod * dt);
      }
    }
  }

  // Suche die naechstgelegene Burg eines Hauses, ausgenommen excludeId.
  function nearestCastleOfHouseExcept(state, houseId, refX, refY, excludeId) {
    var best = null, bestD = Infinity;
    for (var id in state.villages) {
      var v = state.villages[id];
      if (v.houseId !== houseId) continue;
      if (excludeId && v.id === excludeId) continue;
      var dx = v.x - refX, dy = v.y - refY;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  // Heimatburg-Verlust: Strukturen, die diese Burg als Heimatburg hatten,
  // werden der naechstgelegenen anderen eigenen Burg zugewiesen. Existiert
  // keine weitere eigene Burg, wird die Struktur neutral (Garnison aufgeloest).
  function reassignStructuresAfterCastleLoss(state, oldHouseId, lostCastleId) {
    var list = state.structures;
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.ownerHouseId !== oldHouseId) continue;
      if (s.assignedCastleId !== lostCastleId) continue;
      var next = nearestCastleOfHouseExcept(state, oldHouseId, s.x, s.y, lostCastleId);
      if (next) {
        s.assignedCastleId = next.id;
      } else {
        // Keine andere eigene Burg mehr -> Struktur neutralisieren
        s.ownerHouseId = null;
        s.assignedCastleId = null;
        s.garrison = { spear: 0, sword: 0, axe: 0, archer: 0 };
      }
    }
  }

  WOH.Game = {
    newGame: newGame,
    tick: tick,
    enqueueBuild: enqueueBuild,
    enqueueTrain: enqueueTrain,
    sendArmy: sendArmy,
    distance: distance,
    villageScore: villageScore,
    villagesOfHouse: villagesOfHouse,
    houseOf: houseOf,
    pushLog: pushLog,
    uid: uid,
    pendingReports: pendingReports,
    // Schritt 2: Strukturen
    normalizeStructures: normalizeStructures,
    applyStructureProduction: applyStructureProduction,
    reassignStructuresAfterCastleLoss: reassignStructuresAfterCastleLoss
  };
})(window.WOH = window.WOH || {});
