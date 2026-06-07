/* =========================================================================
 * World of Houses – KI-Gegner
 * Einfache, regelbasierte KI pro Haus. Drei Schwierigkeitsstufen steuern
 * Wirtschafts-, Ausbildungs- und Angriffsverhalten.
 * ========================================================================= */
(function (WOH) {
  'use strict';
  var C = WOH.Config, V = WOH.Village, G = WOH.Game;

  // Bevorzugte Ausbauziele der KI (Wirtschaft zuerst, dann Militär).
  var ECON_PRIORITY = ['farm', 'woodcutter', 'quarry', 'mine', 'warehouse', 'townhall'];
  var MIL_PRIORITY = ['barracks', 'wall', 'range', 'tower'];

  function update(state, dt) {
    for (var hid in state.ai) {
      var house = state.houses[hid];
      if (!house || house.isPlayer) continue;
      // Haus könnte komplett erobert worden sein
      var villages = G.villagesOfHouse(state, hid);
      if (!villages.length) continue;
      var brain = state.ai[hid];
      brain.nextDecisionAt -= dt;
      if (brain.nextDecisionAt <= 0) {
        var cfg = C.DIFFICULTY[state.difficulty];
        decide(state, hid, villages, cfg);
        brain.nextDecisionAt = cfg.decisionEvery * (0.7 + Math.random() * 0.6);
      }
    }
  }

  function decide(state, hid, villages, cfg) {
    villages.forEach(function (v) {
      manageEconomy(state, v, cfg);
      manageMilitary(state, v, cfg);
    });
    // Angriffsentscheidung auf Hausebene
    if (Math.random() < cfg.aggression) considerAttack(state, hid, villages, cfg);
  }

  // Baue das jeweils niedrigste sinnvolle Gebäude, das bezahlbar ist.
  function manageEconomy(state, v, cfg) {
    if (v.buildQueue.length >= 2) return;
    if (Math.random() > cfg.econ * 0.9) return;

    var candidates = ECON_PRIORITY.slice();
    // Militärgebäude später ergänzen
    MIL_PRIORITY.forEach(function (k) {
      if (V.meetsRequirements(v, k)) candidates.push(k);
    });
    // Sortiere nach aktueller Stufe (niedrigste zuerst), Wirtschaft bevorzugt
    candidates.sort(function (a, b) {
      return (v.buildings[a] || 0) - (v.buildings[b] || 0);
    });
    for (var i = 0; i < candidates.length; i++) {
      var r = G.enqueueBuild(state, v, candidates[i]);
      if (r.ok) return;
    }
  }

  // Bilde Verteidiger und Angreifer aus. Aggressive Häuser massieren Äxte
  // (Offensive), behalten aber auch Verteidigung daheim.
  function manageMilitary(state, v, cfg) {
    if ((v.buildings.barracks || 0) < 1) return;
    if (v.trainingQueue.length >= 2) return;
    if (Math.random() > cfg.train) return;

    var batch = Math.max(2, Math.round(4 * cfg.train));
    var roll = Math.random();
    var offShare = 0.4 + cfg.aggression * 0.45; // aggressiv => mehr Äxte
    var unit;
    if (roll < offShare) unit = 'axe';
    else if (roll < offShare + 0.22) unit = 'spear';
    else if ((v.buildings.range || 0) >= 1 && roll < offShare + 0.4) unit = 'archer';
    else unit = 'sword';
    G.enqueueTrain(state, v, unit, batch);
  }

  // Greife nur an, wenn die Angriffskraft die Verteidigung deutlich übersteigt.
  // So massiert die KI Truppen und vermeidet aussichtslose Angriffe auf starke Burgen.
  function considerAttack(state, hid, villages, cfg) {
    // Stärkstes Offensiv-Dorf (meiste Äxte) als Ausgangspunkt.
    var best = null, bestAxe = 0;
    villages.forEach(function (v) {
      var a = v.units.axe || 0;
      if (a > bestAxe) { bestAxe = a; best = v; }
    });
    if (!best || bestAxe < 10) return; // erst eine echte Armee aufbauen

    var axes = best.units.axe || 0;
    var swords = best.units.sword || 0;
    // Mitgeschickte Schwerter (Begleitung) in die Angriffskraft einrechnen.
    var escort = Math.floor(swords * 0.25);
    var atkPower = WOH.Combat.attackPower({ axe: axes, sword: escort });

    // Klarer Sieg gefordert: Angriffskraft >= MARGIN × Verteidigung
    // (deckt Glücks-Schwankungen ab und hält die eigenen Verluste niedrig).
    var MARGIN = 2.0;

    var target = null, score = -Infinity;
    for (var id in state.villages) {
      var t = state.villages[id];
      if (t.houseId === hid) continue;
      var dist = G.distance(best, t);
      if (dist > 18) continue;
      var def = WOH.Combat.defensePower(t.units, t.buildings.wall || 0, t.buildings.tower || 0);
      if (def < 1) def = 1;
      if (atkPower < def * MARGIN) continue; // nicht überzeugend gewinnbar -> meiden
      var value = 0; for (var b in t.buildings) value += t.buildings[b];
      // Lohnende, nahe, schwächere Ziele bevorzugen; Spieler leicht bevorzugt.
      var s = value * 4 - dist * 2 + (t.isPlayer ? 25 : 0) + (atkPower / def) * 6;
      if (s > score) { score = s; target = t; }
    }
    if (!target) return; // kein überzeugend besiegbares Ziel -> weiter aufrüsten

    // Volle Axt-Armee + Begleitung entsenden (Verteidiger bleiben daheim).
    var send = { axe: axes, sword: escort };
    var r = G.sendArmy(state, best.id, target.id, send, 'attack');
    if (r.ok && target.isPlayer) {
      G.pushLog(state, 'Späher melden: ' + state.houses[hid].name +
        ' entsendet eine große Armee (' + axes + ' Axtkämpfer) auf ' + target.name + '!', 'bad');
    }
  }

  WOH.AI = { update: update };
})(window.WOH = window.WOH || {});
