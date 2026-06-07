/* =========================================================================
 * World of Houses – Konfiguration & Balancing
 * Zentrale Spielkonstanten. Werte angelehnt an "Die Stämme" / RTS-Standards,
 * aber neu balanciert für beschleunigtes Echtzeit-Gameplay.
 * ========================================================================= */
(function (WOH) {
  'use strict';

  // --- Globaler Zeit-Skalierungsfaktor ---------------------------------
  // Basis-Skalierung: 1 Spielsekunde = 1 Echtsekunde, wenn der Spieler-
  // Geschwindigkeitsregler auf 1x steht (siehe state.speedMultiplier).
  // Der Spieler kann ueber den HUD-Regler 1x/2x/4x/8x waehlen oder
  // pausieren. Tick: dt = realMs/1000 * TIME_SCALE * speedMultiplier.
  var TIME_SCALE = 1;

  // --- Karte -----------------------------------------------------------
  var MAP = {
    width: 40,            // Felder
    height: 40,
    tileSize: 32,         // Pixel pro Feld (Basis, wird gezoomt)
    villageCount: 5,      // Fallback gesamt (Spieler + Gegner)
    maxEnemies: 5,        // Obergrenze Gegner im Startmenü
    defaultEnemies: 4,    // Vorauswahl Gegner
    minVillageDist: 4,    // Mindestabstand zwischen Burgen (Felder)
    // Geländearten beeinflussen Standortboni
    terrain: {
      grass:    { name: 'Wiese',   color: '#3a4a32' },
      forest:   { name: 'Wald',    color: '#243a22' },
      mountain: { name: 'Gebirge', color: '#54514c' },
      water:    { name: 'Wasser',  color: '#1f3a4d' },
      field:    { name: 'Felder',  color: '#5a5230' }
    }
  };

  // --- Rohstoffe -------------------------------------------------------
  var RESOURCES = ['food', 'wood', 'stone', 'iron'];
  var RESOURCE_META = {
    food:  { name: 'Nahrung', short: 'N', color: '#c8a24a' },
    wood:  { name: 'Holz',    short: 'H', color: '#7a5230' },
    stone: { name: 'Stein',   short: 'S', color: '#9aa0a6' },
    iron:  { name: 'Eisen',   short: 'E', color: '#b8c4d0' }
  };

  // --- Gebäude ---------------------------------------------------------
  // Alle Gebäude max. Stufe 6.
  // baseCost: Kosten Stufe 1. costFactor: 2.0 => Kosten verdoppeln sich je Stufe.
  // baseTime/timeFactor: Bauzeit (Spielsek.), skaliert mit timeFactor^Stufe.
  // requires: feste Voraussetzung (jede Stufe). levelRequires: je Zielstufe.
  var MAX_LEVEL = 6;
  var BUILDINGS = {
    townhall: {
      name: 'Halle', max: MAX_LEVEL, key: 'townhall',
      baseCost: { food: 90, wood: 180, stone: 150, iron: 60 },
      costFactor: 2.0, baseTime: 40, timeFactor: 2.0,
      popPerLevel: 0,  // Halle selbst ist Quelle der Pop
      levelRequires: {
        3: { barracks: 1, warehouse: 2, farm: 2, quarry: 2, woodcutter: 2, mine: 2 },
        4: { barracks: 2, wall: 1 },
        5: { barracks: 4, tower: 1 }
      },
      desc: 'Verwaltungssitz. Hauptquelle der Bevölkerung. Höhere Stufen beschleunigen andere Bauten leicht.'
    },
    woodcutter: {
      name: 'Holzfäller', max: MAX_LEVEL, key: 'woodcutter',
      baseCost: { food: 0, wood: 100, stone: 60, iron: 40 },
      costFactor: 2.0, baseTime: 30, produces: 'wood',
      perLevel: 3,     // Basis-Produktion Holz je Stufe (× Standortbonus)
      popPerLevel: 2,
      desc: 'Produziert Holz: 3 Einheiten je Stufe (× Standortbonus). Benötigt 2 Arbeiter je Stufe.'
    },
    quarry: {
      name: 'Steinbruch', max: MAX_LEVEL, key: 'quarry',
      baseCost: { food: 0, wood: 130, stone: 50, iron: 40 },
      costFactor: 2.0, baseTime: 30, produces: 'stone',
      perLevel: 2,     // Basis-Produktion Stein je Stufe (× Standortbonus)
      popPerLevel: 3,
      desc: 'Produziert Stein: 2 Einheiten je Stufe (× Standortbonus). Schwere Arbeit: 3 Arbeiter je Stufe.'
    },
    mine: {
      name: 'Eisenmine', max: MAX_LEVEL, key: 'mine',
      baseCost: { food: 0, wood: 150, stone: 130, iron: 30 },
      costFactor: 2.0, baseTime: 35, produces: 'iron',
      perLevel: 1,     // Basis-Produktion Eisen je Stufe (× Standortbonus)
      popPerLevel: 3,
      desc: 'Produziert Eisen: 1 Einheit je Stufe (× Standortbonus). 3 Bergleute je Stufe.'
    },
    farm: {
      name: 'Bauernhof', max: MAX_LEVEL, key: 'farm',
      baseCost: { food: 0, wood: 90, stone: 40, iron: 30 },
      costFactor: 2.0, baseTime: 35, produces: 'food',
      perLevel: 3,     // Basis-Produktion Nahrung je Stufe (× Standortbonus)
      popPerLevel: 2,
      desc: 'Produziert Nahrung: 3 Einheiten je Stufe (× Standortbonus) und erhöht zusätzlich die Bevölkerungs-Kapazität.'
    },
    warehouse: {
      name: 'Lager', max: MAX_LEVEL, key: 'warehouse',
      baseCost: { food: 0, wood: 120, stone: 50, iron: 40 },
      costFactor: 2.0, baseTime: 30,
      popPerLevel: 1,
      desc: 'Erhöht die Lagerkapazität aller Rohstoffe. 1 Verwalter je Stufe.'
    },
    barracks: {
      name: 'Kaserne', max: MAX_LEVEL, key: 'barracks',
      baseCost: { food: 0, wood: 400, stone: 300, iron: 90 },
      costFactor: 2.0, baseTime: 90, requires: { townhall: 2 },
      popPerLevel: 3,
      desc: 'Bildet Schwert-, Axt- und Speerkrieger aus. 3 Ausbilder je Stufe. Ab Halle 2.'
    },
    range: {
      name: 'Schießplatz', max: MAX_LEVEL, key: 'range',
      baseCost: { food: 0, wood: 440, stone: 140, iron: 160 },
      costFactor: 2.0, baseTime: 110, requires: { barracks: 3 },
      popPerLevel: 2,
      desc: 'Bildet defensive Bogenschützen aus.'
    },
    wall: {
      name: 'Palisade', max: MAX_LEVEL, key: 'wall',
      baseCost: { food: 0, wood: 160, stone: 280, iron: 30 },
      costFactor: 2.0, baseTime: 60,
      popPerLevel: 0,  // passives Bauwerk
      desc: 'Erhöht die Grundverteidigung der Burg und verstärkt alle Verteidiger.'
    },
    tower: {
      name: 'Wachturm', max: MAX_LEVEL, key: 'tower',
      baseCost: { food: 0, wood: 240, stone: 380, iron: 80 },
      costFactor: 2.0, baseTime: 80, requires: { wall: 2 },
      popPerLevel: 1,
      desc: 'Erweitert die Spähweite und verstärkt Bogenschützen massiv.'
    }
  };

  // --- Produktion ------------------------------------------------------
  // Vereinfachtes Modell (Resourcen-Rework): Produktion eines Rohstoffs pro
  // Spielsekunde = Gebäudestufe × BUILDINGS[k].perLevel × Standortbonus.
  // Basiswerte je Stufe: Holzfäller 3, Steinbruch 2, Eisenmine 1, Bauernhof 3.
  // Ohne Gebäude (Stufe 0) = 0 Produktion. Klare, ganzzahlige Werte
  // erleichtern auch der KI die Wirtschaftsplanung.
  var PRODUCTION = {
    base: 0,                // kein pauschaler Grundwert mehr
    // Hinweis: Nahrungs-Upkeep ist seit Schritt 11 pro Einheit definiert
    // (UNITS[k].foodUpkeep). Dieser Pauschalwert wird nicht mehr verwendet.
    foodUpkeepPerPop: 0
  };

  // Lagerkapazität: Stufe 0 = baseCap, je Stufe * factor
  // (erhöht, passend zu den verdoppelten Baukosten)
  var STORAGE = { baseCap: 3000, perLevel: 1.5 };

  // Bauzeit-Wachstum: Faktor pro Stufe nimmt ab (von Start bei frühen Stufen
  // bis End an der Maximalstufe). hallSpeedPerLevel verkürzt andere Gebäude.
  var BUILD = { timeStartFactor: 2.0, timeEndFactor: 1.5, hallSpeedPerLevel: 0.06 };

  // Bevölkerung (Schritt 11): Halle ist Hauptquelle, Bauernhof zusätzlich.
  // Gebäude verbrauchen Pop nach BUILDINGS[k].popPerLevel, Einheiten nach UNITS[k].pop.
  // Zivilbevölkerung (= Σ Gebäude-Pop) verbraucht zusätzlich Nahrung mit civilianFoodUpkeep.
  var POPULATION = {
    base: 40,
    perTownhallLevel: 25,
    perFarmLevel: 12,
    civilianFoodUpkeep: 0.02
  };

  // --- Einheiten -------------------------------------------------------
  // atk  : Angriffswert
  // defI : Verteidigung gegen Infanterie (Schwert/Axt/Speer)
  // defA : Verteidigung gegen Beschuss (Bogenschützen-Angriffe, künftig)
  // speed: Spielsekunden pro Kartenfeld (kleiner = schneller)
  // pop  : Bevölkerungsverbrauch
  // carry: Tragkapazität für Beute (Rohstoffe gesamt)
  // role : 'off' (Angriff) | 'def' (Verteidigung)
  var UNITS = {
    spear: {
      name: 'Speerträger', key: 'spear', role: 'def', sprite: 'spear',
      cost: { food: 18, wood: 100, stone: 0, iron: 10 },
      pop: 1, atk: 10, defI: 25, defA: 40, speed: 14, trainTime: 18, carry: 25,
      foodUpkeep: 0.10,
      desc: 'Günstiger, vielseitiger Verteidiger. Solide gegen Infanterie und Beschuss.'
    },
    sword: {
      name: 'Schwertkämpfer', key: 'sword', role: 'def', sprite: 'sword',
      cost: { food: 24, wood: 60, stone: 0, iron: 70 },
      pop: 1, atk: 25, defI: 50, defA: 25, speed: 22, trainTime: 30, carry: 15,
      foodUpkeep: 0.15,
      desc: 'Schwer gepanzerter Standverteidiger. Stark gegen Infanterie, langsam.'
    },
    axe: {
      name: 'Axtkämpfer', key: 'axe', role: 'off', sprite: 'axe',
      cost: { food: 24, wood: 120, stone: 0, iron: 40 },
      pop: 1, atk: 45, defI: 10, defA: 10, speed: 10, trainTime: 26, carry: 10,
      foodUpkeep: 0.10,
      desc: 'Reine Angriffseinheit. Hoher Schaden, kaum Verteidigung. Schnellste Einheit auf dem Marsch.'
    },
    archer: {
      name: 'Bogenschütze', key: 'archer', role: 'def', sprite: 'archer',
      cost: { food: 30, wood: 160, stone: 0, iron: 60 },
      pop: 1, atk: 15, defI: 50, defA: 12, speed: 16, trainTime: 34, carry: 0,
      foodUpkeep: 0.10,
      desc: 'Defensive Fernkampfeinheit. Sehr stark hinter Mauern und Türmen.'
    },
    // Held: max. 1 pro Dorf, sehr teuer. Ermöglicht Eroberung (verschwindet dabei).
    // Verteidigt mit der Kraft von 20 Schwertkämpfern (defI 20×50, atk 20×25).
    hero: {
      name: 'Held', key: 'hero', role: 'hero', sprite: 'hero', unique: true,
      cost: { food: 1200, wood: 1200, stone: 200, iron: 1000 },
      pop: 10, atk: 500, defI: 1000, defA: 1000, speed: 16, trainTime: 240, carry: 0,
      foodUpkeep: 1.00,
      desc: 'Mächtiger Anführer. Ermöglicht die Eroberung einer Burg (verschwindet dabei). ' +
        'Verteidigt mit der Kraft von 20 Schwertkämpfern. Maximal 1 pro Burg.'
    }
  };
  var UNIT_ORDER = ['spear', 'sword', 'axe', 'archer', 'hero'];

  // --- Kampf -----------------------------------------------------------
  var COMBAT = {
    luckRange: 0.25,        // ±25 % Zufallseinfluss (aus Sicht des Angreifers)
    lossExponent: 1.5,      // Verlustkurve (Die-Stämme-Stil)
    wallDefPerLevel: 0.06,  // +6 % Verteidigung je Palisadenstufe
    wallBaseDef: 22,        // flache Grundverteidigung je Palisadenstufe
    towerArcherBonus: 0.12, // +12 % Bogenschützen-Verteidigung je Turmstufe
    baseVillageDef: 30,     // Grundverteidigung ohne jede Mauer
    loyaltyPerWin: [18, 35],// Zufallsbereich Treueverlust pro gewonnenem Angriff
    loyaltyRegenPerHour: 12,// Treue-Regeneration (Spielzeit)
    morale: { enabled: true, min: 0.4 } // Schutz für kleine Spieler/Dörfer
  };

  // --- Bewegung --------------------------------------------------------
  var MOVEMENT = {
    // Reisezeit = Distanz(Felder) * langsamste_Einheit.speed (Spielsekunden)
    minTravel: 8,           // Mindestreisezeit in Spielsekunden
    // Tempo eines reinen Versorgungstrosses (Unterstützung NUR mit Rohstoffen,
    // ohne Truppen). Spielsekunden pro Feld — bewusst langsam (Fuhrwerk).
    resourceSpeed: 20,
    // Bewegungstypen (deklarativ; konkrete Resolver liegen in game.js).
    // 'attack', 'return', 'support' sind bereits implementiert; 'gather'
    // und 'capture' werden mit dem Strukturen-System (Schritt 5) ergaenzt.
    types: {
      attack:  { name: 'Angriff',       desc: 'Trupp greift fremde Burg oder Struktur an.' },
      return:  { name: 'Rueckkehr',     desc: 'Ueberlebende Einheiten kehren mit Beute zurueck.' },
      support: { name: 'Unterstuetzung',desc: 'Einheiten und/oder Rohstoffe zur eigenen Burg oder Struktur. Kein Kampf.' },
      gather:  { name: 'Sammeln',       desc: 'Trupp holt Rohstoffe aus neutraler oder fremder Struktur ohne Eroberung.' },
      capture: { name: 'Eroberung',     desc: 'Trupp mit Held; bei Erfolg wechselt Struktur/Burg den Besitzer.' }
    }
  };

  // --- KI-Schwierigkeitsstufen ----------------------------------------
  // econ      : Wirtschafts-/Bautempo
  // train     : Ausbildungstempo
  // aggression: Angriffsneigung (0..1)
  // startBoost: Startvorsprung an Gebäudestufen
  var DIFFICULTY = {
    easy:   { name: 'Knappe',     econ: 0.6, train: 0.4, aggression: 0.05, startBoost: 0, decisionEvery: 18 },
    normal: { name: 'Ritter',     econ: 1.0, train: 0.9, aggression: 0.30, startBoost: 1, decisionEvery: 12 },
    hard:   { name: 'Kriegsherr', econ: 1.5, train: 1.4, aggression: 0.65, startBoost: 3, decisionEvery: 8 }
  };

  // --- Persistenz ------------------------------------------------------
  // --- Neutrale Rohstoff-Strukturen (eroberbar, später) ----------------
  // res: Hauptrohstoff. count: Anzahl pro Karte (wenige). terrain: Platzierungsregel.
  var RESOURCE_STRUCTURES = {
    woodcutter: { name: 'Holzfäller', res: 'wood',  count: 5, terrain: 'forest' },
    ironmine:   { name: 'Eisenmine',  res: 'iron',  count: 4, terrain: 'mountainAdjacent' },
    // Neue Stein-Struktur: nutzt das gleiche Gelände (gebirgsnah) und Sprite
    // wie die Eisenmine (siehe atlas.js -> structures.stonemine).
    stonemine:  { name: 'Steinbruch', res: 'stone', count: 4, terrain: 'mountainAdjacent' },
    farmstead:  { name: 'Hof',        res: 'food',  count: 4, terrain: 'open' },
    sheepfarm:  { name: 'Schaffarm',  res: 'food',  count: 4, terrain: 'open' }
  };
  var RESOURCE_STRUCTURE_ORDER = ['woodcutter', 'ironmine', 'stonemine', 'farmstead', 'sheepfarm'];

  // Eroberbare Rohstoff-Strukturen: Stufenwerte und Garnison.
  // Produktion/Lager pro Stufe (Index 0 = Stufe 1 ... Index 2 = Stufe 3).
  // Eigene Strukturen produzieren direkt in das Burg-Lager des Besitzers;
  // neutrale Strukturen produzieren in ihr eigenes Lager (cap durch capacity).
  var RESOURCE_STRUCTURE_LEVELS = {
    maxLevel: 3,
    // Resourcen-Rework: einheitlich 5 Einheiten je Strukturstufe
    // (Stufe 1 = 5, Stufe 2 = 10, Stufe 3 = 15) pro Spielsekunde — gilt für
    // alle Strukturtypen (Holzfäller, Eisenmine, Steinbruch, Hof, Schaffarm).
    production: [5, 10, 15],           // Einheiten Rohstoff pro Spielsekunde
    capacity:   [5000, 12500, 20000],  // Eigenes Strukturlager (nur neutral relevant)
    // Upgrade-Kosten: Index 0 = Stufe 1->2, Index 1 = Stufe 2->3 (costFactor 2.0).
    // Holzanteil verdoppelt (höherer Holzverbrauch beim Ausbau).
    upgradeCost: [
      { food: 0, wood: 3600, stone: 1500, iron:  900 },
      { food: 0, wood: 7200, stone: 3000, iron: 1800 }
    ],
    // Bauzeit in Spielsekunden fuer das jeweilige Upgrade.
    upgradeTime: [240, 480]
  };

  // Maximale dauerhaft stationierte Garnison in einer eigenen Struktur,
  // gestaffelt nach Strukturstufe (Index = Stufe): 1=30, 2=70, 3=120.
  // STRUCTURE_GARRISON_CAP bleibt als Obergrenze (= Stufe 3) erhalten.
  var STRUCTURE_GARRISON_CAP_LEVELS = [0, 30, 70, 120];
  var STRUCTURE_GARRISON_CAP = 120;
  function structureGarrisonCap(level) {
    var l = Math.max(1, Math.min(3, level || 1));
    return STRUCTURE_GARRISON_CAP_LEVELS[l] || STRUCTURE_GARRISON_CAP;
  }

  // Bevoelkerungsbonus auf maxPop der Heimatburg (Index = Strukturstufe).
  // Index 0 = unerobert/neutral (kein Bonus), 1/2/3 = Strukturstufe.
  var STRUCTURE_POP_BONUS = [0, 20, 40, 60];

  // --- Belagerung (Schritt 6.5) ----------------------------------------
  // Palisade und Wachturm besitzen je Stufe HitPoints. Vor der eigentlichen
  // Kampfauflösung verursacht der Angreifer Belagerungs-Schaden; sinkt die
  // HP auf <=0, fällt die Stufe um 1 und der Überschuss wirkt weiter.
  // Reparatur kostet einen Bruchteil der Bau-Kosten der aktuellen Stufe.
  // Bogenschützen reduzieren zusätzlich den Mauer-Multiplikator dieses
  // Kampfes (multiplikativ, ohne baseFlat zu beeinflussen).
  var SIEGE = {
    // Index 0 unbenutzt — Stufen 1..6
    wallMaxHP:  [null, 220, 340, 500,  700,  940, 1220],
    towerMaxHP: [null, 180, 260, 360,  480,  620,  780],
    // Belagerungs-Schaden je Einheit pro Trupp-Stueck
    unitSiegeWall:  { spear: 0.5, sword: 1.0, axe: 2.5, archer: 5.0, hero: 20.0 },
    unitSiegeTower: { spear: 0.5, sword: 0.5, axe: 1.5, archer: 6.0, hero: 20.0 },
    // Mauer-Bonus-Reduktion durch Bogenschuetzen im Hauptkampf (temporaer)
    wallSuppressionPerArcher: 0.003,  // 0,3 % Bonus-Reduktion je Bogen
    wallSuppressionMax: 0.5,          // max. -50 % auf wallMult
    // Reparatur: Anteil der Bau-Kosten/-Zeit der jeweils aktuellen Stufe
    repairCostFactor: 0.3,
    repairTimeFactor: 0.4,
    repairQueueMax: 2
  };

  // --- KI-Heuristik (Schritt 7) ----------------------------------------
  // boredomFactor: Senkung des MARGIN-Schwellwerts pro Spielsekunde seit
  // dem letzten eigenen Angriff. Schluesselgleich zu DIFFICULTY-Keys
  // (easy/normal/hard), nicht zum 'name'-Feld der Stufe.
  // marginFloor: minimaler Schwellwert, unter dem die KI nie angreift
  // (Selbstmord-Schutz). archerToSiegeRatio: benoetigte Bogen pro
  // Belagerungspunkt (wall*2 + tower*1.5). maxStageThreshold: Schwellen
  // fuer Expansionsmodus. pressureMultiplier: Aggressions-Schub im
  // Expansionsmodus.
  var AI = {
    boredomFactor:  { easy: 0.0005, normal: 0.001, hard: 0.002 },
    marginFloor: 1.0,
    archerToSiegeRatio: 20,
    maxStageThreshold: { townhall: 6, econ: 5 },
    pressureMultiplier: 1.2,
    // Schritt 8: KI-Polishing
    heroBarracksReq: 4,           // Kaserne-Stufe ab der Helden ausgebildet werden
    repairHPThreshold: 0.5,       // unter dieser Quote (HP/maxHP) repariert die KI
    repairPriority: ['wall', 'tower'],
    structureGarrisonTarget: 50,  // KI fuellt eigene Strukturen-Garnison bis hierhin auf
    castleDefenseMinimum: 30,     // Burg behaelt mindestens diese Truppensumme als Verteidigung
    supportThreshold: 1.2         // bei Bedrohung > defenders*supportThreshold wird Hilfe geholt
  };

  // --- KI-Persönlichkeiten (Resourcen-Rework) --------------------------
  // Archetypen, die ZUSÄTZLICH zur Schwierigkeit (DIFFICULTY) das Verhalten
  // prägen. Schwierigkeit bestimmt Tempo (econ/train) und Grund-Aggression;
  // die Persönlichkeit moduliert Stil und Schwerpunkte. Pro Gegner wird beim
  // Spielstart seed-deterministisch ein Archetyp zugewiesen.
  //
  // Felder (alle multiplikativ/additiv auf bestehende AI-Heuristik):
  //  aggressionMult   – Faktor auf Angriffs-Wahrscheinlichkeit
  //  marginMult       – Faktor auf nötigen Kraftvorsprung (klein = wagemutig,
  //                     groß = nur mit Übermacht)
  //  minAxe           – Mindest-Axtkämpfer, bevor ein Angriff erwogen wird
  //  offShareBonus    – additive Verschiebung Richtung Offensiv-Einheiten
  //  archerBias       – additiver Bogenschützen-Anteil (Defensive)
  //  defenseMinMult   – Faktor auf castleDefenseMinimum (Heimatschutz)
  //  supportThreshMult– Faktor auf supportThreshold (Verstärkungs-Eifer)
  //  structureBias    – Gewicht für Strukturen-Eroberung/Expansion
  //  heroBarracksReq  – Kaserne-Stufe, ab der Helden ausgebildet werden
  //  batchMult        – Faktor auf Trainings-Batchgröße
  //  buildBias        – Bau-Prioritäts-Boni je Gebäude (höher = früher)
  //  shareResources   – nutzt Rohstoff-Logistik zwischen eigenen Burgen
  //  expandEager      – tritt früher in den Expansionsmodus
  var PERSONALITIES = {
    aggressive: {
      name: 'Aggressiv',
      aggressionMult: 1.6, marginMult: 0.8, minAxe: 8,
      offShareBonus: 0.15, archerBias: 0.0,
      defenseMinMult: 0.7, supportThreshMult: 0.9,
      structureBias: 0.6, heroBarracksReq: 5, batchMult: 1.0,
      buildBias: { barracks: 2, wall: -1 },
      shareResources: false, expandEager: false
    },
    expansive: {
      name: 'Expansiv',
      aggressionMult: 1.1, marginMult: 0.9, minAxe: 10,
      offShareBonus: 0.05, archerBias: 0.0,
      defenseMinMult: 0.9, supportThreshMult: 1.0,
      structureBias: 2.0, heroBarracksReq: 3, batchMult: 1.0,
      buildBias: { warehouse: 1, farm: 1, barracks: 1 },
      shareResources: true, expandEager: true
    },
    defensive: {
      name: 'Defensiv',
      aggressionMult: 0.5, marginMult: 1.4, minAxe: 16,
      offShareBonus: -0.2, archerBias: 0.2,
      defenseMinMult: 1.6, supportThreshMult: 1.4,
      structureBias: 0.3, heroBarracksReq: 6, batchMult: 0.9,
      buildBias: { wall: 2, tower: 2, range: 2 },
      shareResources: true, expandEager: false
    },
    steamroller: {
      name: 'Dampfwalze',
      aggressionMult: 1.3, marginMult: 1.25, minAxe: 30,
      offShareBonus: 0.2, archerBias: 0.05,
      defenseMinMult: 1.2, supportThreshMult: 1.1,
      structureBias: 0.8, heroBarracksReq: 4, batchMult: 1.8,
      buildBias: { barracks: 1, warehouse: 1, farm: 1 },
      shareResources: true, expandEager: true
    }
  };
  var PERSONALITY_ORDER = ['aggressive', 'expansive', 'defensive', 'steamroller'];

  var SAVE = {
    dbName: 'world-of-houses',
    storeName: 'saves',
    slotId: 'autosave',
    intervalMs: 5000        // Auto-Save-Intervall (Echtzeit), nicht-blockierend
  };

  // (Resourcen-Rework abgeschlossen.)
  WOH.Config = {
    RESOURCE_STRUCTURES: RESOURCE_STRUCTURES,
    RESOURCE_STRUCTURE_ORDER: RESOURCE_STRUCTURE_ORDER,
    RESOURCE_STRUCTURE_LEVELS: RESOURCE_STRUCTURE_LEVELS,
    STRUCTURE_GARRISON_CAP: STRUCTURE_GARRISON_CAP,
    STRUCTURE_GARRISON_CAP_LEVELS: STRUCTURE_GARRISON_CAP_LEVELS,
    structureGarrisonCap: structureGarrisonCap,
    STRUCTURE_POP_BONUS: STRUCTURE_POP_BONUS,
    SIEGE: SIEGE,
    TIME_SCALE: TIME_SCALE,
    MAP: MAP,
    RESOURCES: RESOURCES,
    RESOURCE_META: RESOURCE_META,
    BUILDINGS: BUILDINGS,
    PRODUCTION: PRODUCTION,
    STORAGE: STORAGE,
    BUILD: BUILD,
    POPULATION: POPULATION,
    UNITS: UNITS,
    UNIT_ORDER: UNIT_ORDER,
    COMBAT: COMBAT,
    MOVEMENT: MOVEMENT,
    DIFFICULTY: DIFFICULTY,
    AI: AI,
    PERSONALITIES: PERSONALITIES,
    PERSONALITY_ORDER: PERSONALITY_ORDER,
    SAVE: SAVE
  };
})(window.WOH = window.WOH || {});
