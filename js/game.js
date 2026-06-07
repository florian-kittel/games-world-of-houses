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
      version: 6,
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
      ai: {},
      // Schritt 8.5: Spielende-Status und Statistik
      gameOver: null,             // 'victory' | 'defeat' | null
      gameEndedAt: null,          // gameTime des Ergebnisses
      // Schritt 10: Spielgeschwindigkeit (Singleplayer-Regler).
      // 0 = Pause, 1 = Echtzeit (1 Spielsek = 1 Echtsek), 2/4/8 = mehrfach.
      // Wirkt multiplikativ auf TIME_SCALE im tick(). Default 4
      // (angenehmes Tempo fuer Wirtschaftsaufbau; ueber HUD anpassbar).
      speedMultiplier: 4,
      // Schritt 10b: Auto-Pause, wenn ein Kampfbericht-Overlay offen ist.
      // Vom Spieler im Overlay umschaltbar. UI setzt _reportPaused waehrend
      // der Bericht offen ist; tick() pruefen beides.
      pauseOnReport: true,
      stats: {
        capturedStructures: 0,
        capturedCastles: 0,
        battlesWon: 0,
        battlesLost: 0,
        unitLosses: { spear: 0, sword: 0, axe: 0, archer: 0, hero: 0 }
      }
    };
    // Strukturen auf das Schritt-2-Schema bringen (Idempotent).
    normalizeStructures(state);
    // KI-Entscheidungszeitpunkte initialisieren (Schritt 7: + lastAttackTime)
    for (var hid in houseMap) {
      if (!houseMap[hid].isPlayer) {
        state.ai[hid] = { nextDecisionAt: rng.range(2, 10), lastAttackTime: 0 };
      }
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
      // Schritt 6.5: Belagerung
      wallHP: 0,
      towerHP: 0,
      repairQueue: [],
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
    // Bevölkerungsgrenze (Schritt 5: inkl. Strukturen-Bonus/Garnison)
    if (V.populationUsed(village, state) + count * u.pop > V.populationCap(village, state))
      return { ok: false, msg: 'Bevölkerungsgrenze erreicht (Bauernhof ausbauen).' };
    V.pay(village, cost);
    var src = unit === 'archer' ? 'range' : 'barracks';
    var lvl = village.buildings[src] || 1;
    var perTime = u.trainTime / (1 + lvl * 0.06);
    village.trainingQueue.push({ unit: unit, remaining: count, perTime: perTime, timeLeft: perTime });
    return { ok: true };
  }

  // Lookup-Helper: gibt Burg- ODER Struktur-Entitaet mit gemeinsamem
  // Mindest-Interface { id, x, y, ownerHouseId }. Wird fuer Distanzberechnung
  // und Sendearmee-Validierung verwendet.
  function entityById(state, id) {
    if (state.villages[id]) {
      var v = state.villages[id];
      return { kind: 'village', id: v.id, x: v.x, y: v.y, ownerHouseId: v.houseId, ref: v };
    }
    var s = findStructureById(state, id);
    if (s) return { kind: 'structure', id: s.id, x: s.x, y: s.y, ownerHouseId: s.ownerHouseId, ref: s };
    return null;
  }

  // Prueft, ob bereits eine hostile Bewegung (attack/gather/capture) von
  // derselben Quell-Burg zum selben Ziel laeuft. Return-Bewegungen blocken
  // nicht — sobald der Trupp den Rueckweg angetreten hat, ist eine neue
  // Welle zulaessig. Support ist nicht hostile und blockt ebenfalls nicht.
  function hasOutboundMovement(state, fromId, toId) {
    if (!state.movements) return false;
    for (var i = 0; i < state.movements.length; i++) {
      var m = state.movements[i];
      if (m.fromId !== fromId || m.toId !== toId) continue;
      if (m.type === 'attack' || m.type === 'gather' || m.type === 'capture') return true;
    }
    return false;
  }

  function sendArmy(state, fromId, toId, units, type) {
    var from = state.villages[fromId];
    if (!from) return { ok: false, msg: 'Quelle ist keine Burg.' };
    // Ziel darf Burg ODER Struktur sein (Schritt 6).
    var toEnt = entityById(state, toId);
    if (!toEnt) return { ok: false, msg: 'Ungültiges Ziel.' };
    var any = false;
    for (var k in units) {
      var n = Math.min(units[k] || 0, from.units[k] || 0);
      units[k] = n; if (n > 0) any = true;
    }
    if (!any) return { ok: false, msg: 'Keine Einheiten ausgewählt.' };
    // Konsistenzcheck Bewegungstyp gegen Ziel-Kind:
    if (toEnt.kind === 'structure' && type !== 'gather' && type !== 'capture' && type !== 'support') {
      return { ok: false, msg: 'Strukturen koennen nicht angegriffen werden — Sammeln, Eroberung oder Unterstuetzung waehlen.' };
    }
    if (type === 'capture' && !(units.hero >= 1)) {
      return { ok: false, msg: 'Eroberung erfordert einen Helden im Trupp.' };
    }
    // Duplikat-Schutz: hostile Bewegungen (attack/gather/capture) duerfen
    // nur einmal gleichzeitig zwischen derselben Quell-Burg und demselben
    // Ziel laufen. Support ist davon ausgenommen — Verstaerkung darf
    // nachgesendet werden.
    var hostile = (type === 'attack' || type === 'gather' || type === 'capture');
    if (hostile && hasOutboundMovement(state, fromId, toId)) {
      return { ok: false, code: 'duplicate-outbound',
        msg: 'Trupp ist bereits unterwegs zu diesem Ziel. Vorhandenen Trupp abwarten oder von anderer Burg unterstützen.' };
    }
    // Einheiten aus dem Dorf abziehen
    for (var u in units) from.units[u] -= units[u];
    var dx = from.x - toEnt.x, dy = from.y - toEnt.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var travel = Math.max(C.MOVEMENT.minTravel, dist * Combat.slowestSpeed(units));
    state.movements.push({
      id: uid('mv'), fromId: fromId, toId: toId, units: units,
      type: type || 'attack', startTime: state.gameTime, arriveTime: state.gameTime + travel,
      ownerHouseId: from.houseId,
      toKind: toEnt.kind
    });
    return { ok: true, travel: travel };
  }

  // -----------------------------------------------------------------------
  // Strukturen-Verwaltung fuer die UI (Schritt 6)
  // -----------------------------------------------------------------------

  // Truppen aus einer eigenen Burg in die Garnison einer zugewiesenen
  // Struktur stationieren. Sofortig (kein Marsch); Bevoelkerung der Burg
  // wird durch populationUsed(village, state) automatisch angepasst.
  function stationGarrison(state, castle, structure, units) {
    if (!castle || !structure) return { ok: false, msg: 'Ungueltig.' };
    if (structure.ownerHouseId !== castle.houseId) return { ok: false, msg: 'Struktur gehoert nicht zu dieser Fraktion.' };
    if (structure.assignedCastleId !== castle.id) return { ok: false, msg: 'Struktur ist nicht dieser Burg zugewiesen.' };
    // Verfuegbarkeit pruefen und Cap einhalten.
    var have = {};
    for (var k in units) have[k] = Math.min(units[k] || 0, castle.units[k] || 0);
    // Held kann nicht stationiert werden.
    have.hero = 0;
    var addTotal = 0; for (var k1 in have) addTotal += have[k1];
    if (addTotal <= 0) return { ok: false, msg: 'Keine Einheiten ausgewaehlt.' };
    var garrison = structure.garrison || { spear: 0, sword: 0, axe: 0, archer: 0 };
    var current = 0; for (var k2 in garrison) current += (garrison[k2] || 0);
    if (current + addTotal > C.STRUCTURE_GARRISON_CAP) {
      return { ok: false, msg: 'Garnison-Cap (' + C.STRUCTURE_GARRISON_CAP + ') wuerde ueberschritten.' };
    }
    // Transfer ausfuehren.
    for (var k3 in have) {
      castle.units[k3] = (castle.units[k3] || 0) - have[k3];
      garrison[k3] = (garrison[k3] || 0) + have[k3];
    }
    structure.garrison = garrison;
    return { ok: true };
  }

  // Garnison aus einer eigenen Struktur in die Heimatburg zurueckziehen.
  // Sofortig (kein Marsch).
  function withdrawGarrison(state, structure, units) {
    if (!structure) return { ok: false, msg: 'Ungueltig.' };
    var castle = state.villages[structure.assignedCastleId];
    if (!castle || castle.houseId !== structure.ownerHouseId) {
      return { ok: false, msg: 'Heimatburg fehlt oder anderer Besitzer.' };
    }
    var garrison = structure.garrison || {};
    var moved = 0;
    for (var k in units) {
      var n = Math.min(units[k] || 0, garrison[k] || 0);
      if (n <= 0) continue;
      garrison[k] -= n;
      castle.units[k] = (castle.units[k] || 0) + n;
      moved += n;
    }
    if (moved <= 0) return { ok: false, msg: 'Keine Einheiten ausgewaehlt.' };
    structure.garrison = garrison;
    return { ok: true };
  }

  // Heimatburg manuell auf eine andere eigene Burg umstellen.
  function reassignHomeCastle(state, structure, newCastleId) {
    var nc = state.villages[newCastleId];
    if (!nc) return { ok: false, msg: 'Ziel-Burg nicht gefunden.' };
    if (nc.houseId !== structure.ownerHouseId) {
      return { ok: false, msg: 'Burg gehoert nicht zur Fraktion.' };
    }
    structure.assignedCastleId = newCastleId;
    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // Belagerung — Reparatur starten (Schritt 6.5)
  // -----------------------------------------------------------------------
  // key: 'wall' | 'tower'. Burg muss eigene sein, Stufe >= 1, HP < max,
  // Queue nicht voll, Kosten verfuegbar. Sofortiger Abzug der Kosten, Eintrag
  // in repairQueue; Fertigstellung im Tick durch processRepairs.
  function startRepair(state, village, key) {
    if (!village) return { ok: false, msg: 'Ungueltig.' };
    if (key !== 'wall' && key !== 'tower') return { ok: false, msg: 'Unbekannte Reparatur.' };
    var lvl = village.buildings[key] || 0;
    if (lvl < 1) return { ok: false, msg: C.BUILDINGS[key].name + ' nicht vorhanden.' };
    var max = key === 'wall' ? V.wallMaxHP(lvl) : V.towerMaxHP(lvl);
    var hp  = key === 'wall' ? V.wallHP(village) : V.towerHP(village);
    if (hp >= max) return { ok: false, msg: 'Bereits voll repariert.' };
    if (!village.repairQueue) village.repairQueue = [];
    var qmax = (C.SIEGE && C.SIEGE.repairQueueMax) || 2;
    // Bereits laufende Reparatur derselben Komponente blockiert.
    if (village.repairQueue.some(function (q) { return q.key === key; }))
      return { ok: false, msg: C.BUILDINGS[key].name + '-Reparatur laeuft bereits.' };
    if (village.repairQueue.length >= qmax)
      return { ok: false, msg: 'Reparaturschlange voll (max. ' + qmax + ').' };
    var cost = V.repairCost(village, key);
    if (!V.canAfford(village, cost)) return { ok: false, msg: 'Nicht genug Rohstoffe.' };
    V.pay(village, cost);
    var t = V.repairTime(village, key);
    village.repairQueue.push({
      key: key,
      endsAt: state.gameTime + t,
      cost: cost,
      time: t
    });
    return { ok: true, time: t, cost: cost };
  }

  // Upgrade einer eigenen Struktur auf naechste Stufe (1->2 oder 2->3).
  // Schritt 9.1: Kosten werden sofort gezahlt, Stufenwechsel erfolgt
  // verzoegert ueber `structure.upgradeQueue` mit `endsAt`. Tick-Verarbeitung
  // schliesst faellige Upgrades ab.
  function upgradeStructure(state, structure) {
    if (!structure || !structure.ownerHouseId) return { ok: false, msg: 'Struktur ist nicht erobert.' };
    var lvl = structure.level || 1;
    if (lvl >= 3) return { ok: false, msg: 'Maximale Stufe erreicht.' };
    var castle = state.villages[structure.assignedCastleId];
    if (!castle) return { ok: false, msg: 'Heimatburg fehlt.' };
    if (!Array.isArray(structure.upgradeQueue)) structure.upgradeQueue = [];
    if (structure.upgradeQueue.length > 0) return { ok: false, msg: 'Upgrade laeuft bereits.' };
    var levels = C.RESOURCE_STRUCTURE_LEVELS;
    var cost = levels.upgradeCost[lvl - 1];
    var time = levels.upgradeTime[lvl - 1];
    for (var r in cost) {
      if ((castle.resources[r] || 0) < cost[r]) {
        return { ok: false, msg: 'Nicht genug Rohstoffe in ' + castle.name + '.' };
      }
    }
    for (var r2 in cost) castle.resources[r2] -= cost[r2];
    structure.upgradeQueue.push({
      targetLevel: lvl + 1,
      startedAt: state.gameTime,
      endsAt: state.gameTime + time
    });
    return { ok: true, newLevel: lvl + 1, time: time };
  }

  // Schritt 9.1: faellige Strukturen-Upgrades pro Tick abschliessen.
  function processStructureUpgrades(state) {
    var list = state.structures || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!Array.isArray(s.upgradeQueue) || s.upgradeQueue.length === 0) continue;
      var q = s.upgradeQueue[0];
      if (state.gameTime >= q.endsAt) {
        s.level = q.targetLevel;
        s.tier = s.level - 1;
        s.upgradeQueue.shift();
      }
    }
  }

  // ---------------------------------------------------------------------
  // Tick: dtRealMs -> Spielzeit voranschreiten
  // ---------------------------------------------------------------------
  function tick(state, dtRealMs) {
    if (state.gameOver) return; // Schritt 8.5: Tick pausiert nach Spielende
    var speed = (typeof state.speedMultiplier === 'number') ? state.speedMultiplier : 1;
    if (speed <= 0) return;     // Schritt 10: Pause via Speed-Regler
    // Schritt 10b: Auto-Pause waehrend Kampfbericht (wenn pauseOnReport aktiv)
    if (state.pauseOnReport && state._reportPaused) return;
    var dt = (dtRealMs / 1000) * C.TIME_SCALE * speed;
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
    // `state` wird an `applyProduction` weitergereicht, damit Garnisons-Pop
    // in zugewiesenen Strukturen in den Food-Upkeep einfliesst (Schritt 5).
    for (var id in state.villages) {
      var v = state.villages[id];
      V.applyProduction(v, dt, state);
      processBuildQueue(v, dt);
      processTrainQueue(v, dt);
      // Schritt 6.5: Reparatur-Queue abarbeiten
      if (V.processRepairs) V.processRepairs(v, dt, state.gameTime);
      if (v.loyalty < 100) v.loyalty = Math.min(100, v.loyalty + C.COMBAT.loyaltyRegenPerHour * (dt / 3600));
    }
    // Strukturen: Produktion in eigenes Lager (neutral) bzw. in die Heimatburg (eigen)
    applyStructureProduction(state, dt);
    // Schritt 9.1: laufende Strukturen-Upgrades abschliessen
    processStructureUpgrades(state);
    processMovements(state);
    WOH.AI.update(state, dt);
    // Schritt 8.5: Sieg/Niederlage pruefen (nur wenn noch nicht entschieden)
    if (!state.gameOver) processGameEnd(state);
  }

  // Sieg = alle gegnerischen Haeuser haben keine Burg mehr.
  // Niederlage = der Spieler selbst hat keine Burg mehr.
  function processGameEnd(state) {
    var playerHas = false;
    var enemyHas = false;
    for (var id in state.villages) {
      var v = state.villages[id];
      if (v.houseId === state.playerHouseId) playerHas = true;
      else if (state.houses[v.houseId] && !state.houses[v.houseId].isPlayer) enemyHas = true;
    }
    if (!playerHas) {
      state.gameOver = 'defeat';
      state.gameEndedAt = state.gameTime;
      pushLog(state, 'Niederlage — alle eigenen Burgen verloren.', 'bad');
    } else if (!enemyHas) {
      state.gameOver = 'victory';
      state.gameEndedAt = state.gameTime;
      pushLog(state, 'Sieg — alle gegnerischen Haeuser ausgeloescht!', 'good');
    }
  }

  function processBuildQueue(v, dt) {
    if (!v.buildQueue.length) return;
    var job = v.buildQueue[0];
    job.timeLeft -= dt;
    if (job.timeLeft <= 0) {
      v.buildings[job.key] = job.target;
      // Schritt 6.5: Wall/Tower fertiggestellt -> HP auf max der neuen Stufe.
      if (job.key === 'wall')  v.wallHP  = V.wallMaxHP  ? V.wallMaxHP(job.target)  : v.wallHP;
      if (job.key === 'tower') v.towerHP = V.towerMaxHP ? V.towerMaxHP(job.target) : v.towerHP;
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
        else if (m.type === 'gather')  resolveGather(state, m);
        else if (m.type === 'capture') resolveCapture(state, m);
      } else {
        remaining.push(m);
      }
    }
    state.movements = remaining;
  }

  // -- Strukturen-Resolver (Schritt 5): echte Kampf-, Beute-, Eroberungslogik
  // -- gegen neutrale oder fremde Rohstoff-Strukturen.

  // Lookup-Helper: Struktur ueber ihre id finden.
  function findStructureById(state, id) {
    var list = state.structures || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Strukturname fuer Logs.
  function structureName(structure) {
    var meta = C.RESOURCE_STRUCTURES[structure.type];
    return (meta && meta.name) ? meta.name : structure.type;
  }

  // Score-Proxy fuer Moral: Truppstaerke als Anzahl Einheiten + Atk/100.
  function armyScore(units) {
    var s = 0; for (var k in units) s += (units[k] || 0);
    return s + WOH.Combat.attackPower(units) / 100;
  }

  // gather: Sammeln an neutraler oder fremder Struktur, OHNE Eroberung.
  // - Bei Sieg: Trupp leert Strukturlager bis zur Tragkapazitaet und kehrt heim.
  // - Bei Niederlage: Trupp verloren, Lager unveraendert.
  function resolveGather(state, m) {
    var struct = findStructureById(state, m.toId);
    if (!struct) { returnArmy(state, m, m.units, null); return; }

    var attUnits = {}; for (var k0 in m.units) attUnits[k0] = m.units[k0];
    var defUnits = {}; var g = struct.garrison || {};
    for (var dk0 in g) defUnits[dk0] = g[dk0];

    var rng = WOH.RNG((state.seed ^ Math.floor(m.arriveTime * 1000)) >>> 0);
    var attScore = armyScore(attUnits);
    var res = WOH.Combat.resolveStructureBattle(m.units, defUnits, rng, attScore, struct);
    res.fromName = (state.villages[m.fromId] && state.villages[m.fromId].name) || '—';
    res.toName = structureName(struct);
    res.attackerHouse = state.houses[m.ownerHouseId];
    res.defenderHouse = struct.ownerHouseId ? state.houses[struct.ownerHouseId] : null;
    res.attackerUnits = attUnits;
    res.defenderUnits = defUnits;
    res.targetKind = 'structure';
    res.action = 'gather';

    // Garnison aktualisieren (Verluste anwenden)
    var newG = { spear: 0, sword: 0, axe: 0, archer: 0 };
    for (var dk in res.defenderSurvivors) newG[dk] = res.defenderSurvivors[dk] || 0;
    struct.garrison = newG;

    var attackerIsPlayer = m.ownerHouseId === state.playerHouseId;
    var defenderIsPlayer = struct.ownerHouseId === state.playerHouseId;

    if (res.attackerWins) {
      var survivors = res.attackerSurvivors;
      // Beute aus Strukturlager
      var meta = C.RESOURCE_STRUCTURES[struct.type];
      var resKey = meta ? meta.res : null;
      var loot = {};
      if (resKey) {
        var cap = WOH.Combat.carryCapacity(survivors);
        var avail = struct.storage[resKey] || 0;
        var take = Math.min(cap, avail);
        if (take > 0) {
          loot[resKey] = take;
          struct.storage[resKey] = avail - take;
        }
      }
      res.loot = loot; res.captured = false;
      returnArmy(state, m, survivors, loot);
    } else {
      res.loot = null; res.captured = false;
      // Angreifer aufgerieben -> nichts kehrt zurueck.
    }

    if (attackerIsPlayer || defenderIsPlayer) {
      logStructureBattle(state, res, attackerIsPlayer, defenderIsPlayer);
      res.playerRole = defenderIsPlayer ? 'defender' : 'attacker';
      pendingReports.push(res);
      trackBattleStats(state, res, attackerIsPlayer, defenderIsPlayer);
    }
  }

  // capture: Eroberungs-Versuch mit Held. Bei Sieg + ueberlebendem Held wechselt
  // die Struktur in den Besitz der angreifenden Fraktion, assignedCastleId =
  // Heimatburg des Helden (Ursprung). Held wird verbraucht. Lager bleibt
  // erhalten (Reserve fuer neuen Besitzer). Garnison wird zurueckgesetzt.
  // Faellt der Held im Kampf, keine Eroberung — Ueberlebende kehren zurueck.
  function resolveCapture(state, m) {
    var struct = findStructureById(state, m.toId);
    if (!struct) { returnArmy(state, m, m.units, null); return; }

    // Schutz: falls UI-Bug einen Trupp ohne Held mit type='capture' schickt,
    // wird das als gather behandelt (keine Eroberung moeglich, kein Verlust).
    if (!(m.units.hero >= 1)) {
      resolveGather(state, m);
      return;
    }

    var attUnits = {}; for (var k0 in m.units) attUnits[k0] = m.units[k0];
    var defUnits = {}; var g = struct.garrison || {};
    for (var dk0 in g) defUnits[dk0] = g[dk0];

    var rng = WOH.RNG((state.seed ^ Math.floor(m.arriveTime * 1000)) >>> 0);
    var attScore = armyScore(attUnits);
    var res = WOH.Combat.resolveStructureBattle(m.units, defUnits, rng, attScore, struct);
    res.fromName = (state.villages[m.fromId] && state.villages[m.fromId].name) || '—';
    res.toName = structureName(struct);
    res.attackerHouse = state.houses[m.ownerHouseId];
    res.defenderHouse = struct.ownerHouseId ? state.houses[struct.ownerHouseId] : null;
    res.attackerUnits = attUnits;
    res.defenderUnits = defUnits;
    res.targetKind = 'structure';
    res.action = 'capture';

    // Garnison aktualisieren
    var newG = { spear: 0, sword: 0, axe: 0, archer: 0 };
    for (var dk in res.defenderSurvivors) newG[dk] = res.defenderSurvivors[dk] || 0;
    struct.garrison = newG;

    var attackerIsPlayer = m.ownerHouseId === state.playerHouseId;
    var defenderIsPlayer = struct.ownerHouseId === state.playerHouseId;

    if (res.attackerWins) {
      var survivors = res.attackerSurvivors;
      var heroSurvived = (survivors.hero || 0) >= 1;
      if (heroSurvived) {
        // Eroberung: Held verbraucht, Besitzer wechselt, assignedCastleId
        // = Heimatburg des Helden (Ursprung des Trupps).
        survivors.hero = 0;
        struct.ownerHouseId = m.ownerHouseId;
        struct.assignedCastleId = m.fromId;
        struct.garrison = { spear: 0, sword: 0, axe: 0, archer: 0 };
        // Strukturlager bleibt erhalten - neuer Besitzer erbt es.
        res.captured = true;
        res.loot = null;
        returnArmy(state, m, survivors, null);
      } else {
        // Held fiel - keine Eroberung. Ueberlebende kehren ohne Beute zurueck.
        res.captured = false;
        res.loot = null;
        returnArmy(state, m, survivors, null);
      }
    } else {
      res.captured = false;
      res.loot = null;
      // Angreifer aufgerieben (inkl. Held) -> Trupp verloren.
    }

    if (attackerIsPlayer || defenderIsPlayer) {
      logStructureBattle(state, res, attackerIsPlayer, defenderIsPlayer);
      res.playerRole = defenderIsPlayer ? 'defender' : 'attacker';
      pendingReports.push(res);
      trackBattleStats(state, res, attackerIsPlayer, defenderIsPlayer);
      if (attackerIsPlayer && res.captured && state.stats) state.stats.capturedStructures++;
    }
  }

  // Schritt 8.5: zentrale Statistik-Buchung pro Schlacht mit Spielerbeteiligung
  function trackBattleStats(state, res, attIsPlayer, defIsPlayer) {
    if (!state.stats) return;
    var won = (attIsPlayer && res.attackerWins) || (defIsPlayer && !res.attackerWins);
    if (won) state.stats.battlesWon++; else state.stats.battlesLost++;
    var losses = attIsPlayer ? res.attackerLosses : res.defenderLosses;
    for (var u in losses) {
      if (state.stats.unitLosses[u] != null) state.stats.unitLosses[u] += (losses[u] || 0);
    }
  }

  function logStructureBattle(state, res, attIsPlayer, defIsPlayer) {
    var name = res.toName;
    var verb = res.action === 'capture' ? 'Eroberungs-Versuch bei' : 'Sammelaktion bei';
    var outcome;
    if (res.attackerWins && res.captured) outcome = 'EROBERT';
    else if (res.attackerWins && res.loot && Object.keys(res.loot).length) outcome = 'erfolgreich (Beute: ' + lootText(res.loot) + ')';
    else if (res.attackerWins) outcome = 'erfolgreich (keine Beute)';
    else outcome = 'abgewehrt';
    var kind = res.attackerWins ? (attIsPlayer ? 'good' : 'bad') : (defIsPlayer ? 'good' : 'bad');
    if (res.captured) kind = 'battle';
    pushLog(state, verb + ' ' + name + ' — ' + outcome + '.', kind);
  }

  function resolveSupport(state, m) {
    // Schritt 9.2: support strukturbewusst — Ziel kann Burg oder Struktur sein.
    var toV = state.villages[m.toId];
    if (toV) {
      for (var k in m.units) toV.units[k] = (toV.units[k] || 0) + m.units[k];
      if (toV.isPlayer) pushLog(state, 'Verstärkung ist in ' + toV.name + ' eingetroffen.', 'good');
      return;
    }
    var toS = findStructureById(state, m.toId);
    if (!toS) return; // Ziel verschwunden
    if (!toS.garrison) toS.garrison = { spear: 0, sword: 0, axe: 0, archer: 0 };
    // Cap respektieren — Ueberschuss wird ausgesetzt (faellt nicht zurueck).
    var current = 0; for (var t in toS.garrison) current += (toS.garrison[t] || 0);
    var cap = C.STRUCTURE_GARRISON_CAP || 100;
    for (var u in m.units) {
      if (u === 'hero') continue; // Held nicht in Garnison
      var room = Math.max(0, cap - current);
      var add = Math.min(m.units[u] || 0, room);
      toS.garrison[u] = (toS.garrison[u] || 0) + add;
      current += add;
    }
    var ownerIsPlayer = toS.ownerHouseId === state.playerHouseId;
    if (ownerIsPlayer) {
      var meta = C.RESOURCE_STRUCTURES[toS.type];
      pushLog(state, 'Verstärkung ist in ' + (meta ? meta.name : toS.type) +
        ' (' + toS.x + ',' + toS.y + ') eingetroffen.', 'good');
    }
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

    // Schritt 6.5: Belagerungs-Phase VOR dem Hauptkampf.
    // Schaden an Wall/Tower-HP, ggf. Stufenabbau (mit Ueberschuss-Schaden).
    var siege = WOH.Combat.applySiege ? WOH.Combat.applySiege(m.units, target) : null;

    var scores = { att: villageScore(from || { buildings: {}, units: {} }), def: villageScore(target) };
    var res = WOH.Combat.resolve(m.units, defUnits, target.buildings.wall || 0, target.buildings.tower || 0, rng, scores);
    if (siege) res.siegeResult = siege;
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
      trackBattleStats(state, res, attackerIsPlayer, defenderIsPlayer);
      if (attackerIsPlayer && res.captured && state.stats) state.stats.capturedCastles++;
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
    // Ziel kann Burg ODER Struktur sein — Koordinaten ueber entityById
    // aufloesen, sodass die Rueckkehr exakt dieselbe Distanz wie der Hinweg
    // hat (Fix: vorher fiel die Strukturen-Distanz auf 0 zurueck und der
    // Trupp war in `minTravel` Sekunden zuhause).
    var toEnt = entityById(state, m.toId);
    var to = toEnt || from;
    var dist = distance(to, from);
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
    // Schritt 9.1: Strukturen-Upgrade-Queue
    if (!Array.isArray(s.upgradeQueue)) s.upgradeQueue = [];
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
    reassignStructuresAfterCastleLoss: reassignStructuresAfterCastleLoss,
    // Schritt 6: UI-Operationen auf Strukturen
    findStructureById: findStructureById,
    entityById: entityById,
    stationGarrison: stationGarrison,
    withdrawGarrison: withdrawGarrison,
    reassignHomeCastle: reassignHomeCastle,
    upgradeStructure: upgradeStructure,
    // Schritt 6.5: Belagerung
    startRepair: startRepair,
    // Anti-Duplikat-Versand
    hasOutboundMovement: hasOutboundMovement
  };
})(window.WOH = window.WOH || {});
