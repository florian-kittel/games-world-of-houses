/* =========================================================================
 * World of Houses – Konfiguration & Balancing
 * Zentrale Spielkonstanten. Werte angelehnt an "Die Stämme" / RTS-Standards,
 * aber neu balanciert für beschleunigtes Echtzeit-Gameplay.
 * ========================================================================= */
(function (WOH) {
  'use strict';

  // --- Globaler Zeit-Skalierungsfaktor ---------------------------------
  // Spielsekunden vergehen schneller als Echtzeit, damit ein Prototyp
  // angenehm spielbar bleibt. 1 Echtsekunde = TIME_SCALE Spielsekunden.
  var TIME_SCALE = 6;

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
      baseCost: { food: 90, wood: 90, stone: 80, iron: 60 },
      costFactor: 2.0, baseTime: 40, timeFactor: 2.0, // jede weitere Stufe doppelt so lang
      // Stufenabhängige Voraussetzungen
      levelRequires: {
        3: { barracks: 1, warehouse: 2, farm: 2, quarry: 2, woodcutter: 2, mine: 2 },
        4: { barracks: 2, wall: 1 },
        5: { barracks: 4, tower: 1 }
      },
      desc: 'Verwaltungssitz. Höhere Stufen beschleunigen andere Bauten leicht. Bestimmt die Größe der Burg.'
    },
    woodcutter: {
      name: 'Holzfäller', max: MAX_LEVEL, key: 'woodcutter',
      baseCost: { food: 0, wood: 50, stone: 60, iron: 40 },
      costFactor: 2.0, baseTime: 30, produces: 'wood',
      desc: 'Produziert Holz.'
    },
    quarry: {
      name: 'Steinbruch', max: MAX_LEVEL, key: 'quarry',
      baseCost: { food: 0, wood: 65, stone: 50, iron: 40 },
      costFactor: 2.0, baseTime: 30, produces: 'stone',
      desc: 'Produziert Stein.'
    },
    mine: {
      name: 'Eisenmine', max: MAX_LEVEL, key: 'mine',
      baseCost: { food: 0, wood: 75, stone: 65, iron: 30 },
      costFactor: 2.0, baseTime: 35, produces: 'iron',
      desc: 'Produziert Eisen.'
    },
    farm: {
      name: 'Bauernhof', max: MAX_LEVEL, key: 'farm',
      baseCost: { food: 0, wood: 45, stone: 40, iron: 30 },
      costFactor: 2.0, baseTime: 35, produces: 'food',
      desc: 'Produziert Nahrung und stellt Bevölkerung (Versorgung) bereit.'
    },
    warehouse: {
      name: 'Lager', max: MAX_LEVEL, key: 'warehouse',
      baseCost: { food: 0, wood: 60, stone: 50, iron: 40 },
      costFactor: 2.0, baseTime: 30,
      desc: 'Erhöht die Lagerkapazität aller Rohstoffe.'
    },
    barracks: {
      name: 'Kaserne', max: MAX_LEVEL, key: 'barracks',
      baseCost: { food: 0, wood: 200, stone: 170, iron: 90 },
      costFactor: 2.0, baseTime: 90, requires: { townhall: 2 },
      desc: 'Bildet Schwert-, Axt- und Speerkrieger aus. Höhere Stufen beschleunigen die Ausbildung. Ab Halle 2.'
    },
    range: {
      name: 'Schießplatz', max: MAX_LEVEL, key: 'range',
      baseCost: { food: 0, wood: 220, stone: 140, iron: 160 },
      costFactor: 2.0, baseTime: 110, requires: { barracks: 3 },
      desc: 'Bildet defensive Bogenschützen aus.'
    },
    wall: {
      name: 'Palisade', max: MAX_LEVEL, key: 'wall',
      baseCost: { food: 0, wood: 80, stone: 130, iron: 30 },
      costFactor: 2.0, baseTime: 60,
      desc: 'Erhöht die Grundverteidigung der Burg und verstärkt alle Verteidiger.'
    },
    tower: {
      name: 'Wachturm', max: MAX_LEVEL, key: 'tower',
      baseCost: { food: 0, wood: 120, stone: 200, iron: 80 },
      costFactor: 2.0, baseTime: 80, requires: { wall: 2 },
      desc: 'Erweitert die Spähweite und verstärkt Bogenschützen massiv.'
    }
  };

  // --- Produktion ------------------------------------------------------
  // Rohstoff pro Spielsekunde = (BASE + level * PER_LEVEL) * Standortbonus.
  // (Skalierung an max. Stufe 6 angepasst.)
  var PRODUCTION = {
    base: 0.20,             // pro Sekunde, Grundwert ohne Gebäude
    perLevel: 1.10,         // zusätzlicher Ertrag je Gebäudestufe
    foodUpkeepPerPop: 0.15  // Nahrungsverbrauch je Bevölkerung (pro Anzeige-Sekunde)
  };

  // Lagerkapazität: Stufe 0 = baseCap, je Stufe * factor
  // (erhöht, passend zu den verdoppelten Baukosten)
  var STORAGE = { baseCap: 3000, perLevel: 1.5 };

  // Bauzeit-Wachstum: Faktor pro Stufe nimmt ab (von Start bei frühen Stufen
  // bis End an der Maximalstufe). hallSpeedPerLevel verkürzt andere Gebäude.
  var BUILD = { timeStartFactor: 2.0, timeEndFactor: 1.5, hallSpeedPerLevel: 0.06 };

  // Bevölkerung: Bauernhof stellt Versorgung bereit, Gebäude + Einheiten verbrauchen sie.
  var POPULATION = { base: 60, perFarmLevel: 55 };

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
      cost: { food: 18, wood: 50, stone: 0, iron: 10 },
      pop: 1, atk: 10, defI: 25, defA: 40, speed: 14, trainTime: 18, carry: 25,
      desc: 'Günstiger, vielseitiger Verteidiger. Solide gegen Infanterie und Beschuss.'
    },
    sword: {
      name: 'Schwertkämpfer', key: 'sword', role: 'def', sprite: 'sword',
      cost: { food: 24, wood: 30, stone: 0, iron: 70 },
      pop: 1, atk: 25, defI: 50, defA: 25, speed: 22, trainTime: 30, carry: 15,
      desc: 'Schwer gepanzerter Standverteidiger. Stark gegen Infanterie, langsam.'
    },
    axe: {
      name: 'Axtkämpfer', key: 'axe', role: 'off', sprite: 'axe',
      cost: { food: 24, wood: 60, stone: 0, iron: 40 },
      pop: 1, atk: 45, defI: 10, defA: 10, speed: 14, trainTime: 26, carry: 10,
      desc: 'Reine Angriffseinheit. Hoher Schaden, kaum Verteidigung.'
    },
    archer: {
      name: 'Bogenschütze', key: 'archer', role: 'def', sprite: 'archer',
      cost: { food: 30, wood: 80, stone: 0, iron: 60 },
      pop: 1, atk: 15, defI: 50, defA: 12, speed: 16, trainTime: 34, carry: 0,
      desc: 'Defensive Fernkampfeinheit. Sehr stark hinter Mauern und Türmen.'
    },
    // Held: max. 1 pro Dorf, sehr teuer. Ermöglicht Eroberung (verschwindet dabei).
    // Verteidigt mit der Kraft von 20 Schwertkämpfern (defI 20×50, atk 20×25).
    hero: {
      name: 'Held', key: 'hero', role: 'hero', sprite: 'hero', unique: true,
      cost: { food: 1200, wood: 600, stone: 200, iron: 1000 },
      pop: 5, atk: 500, defI: 1000, defA: 1000, speed: 16, trainTime: 240, carry: 0,
      desc: 'Mächtiger Anführer. Ermöglicht die Eroberung eines Dorfes (verschwindet dabei). ' +
        'Verteidigt mit der Kraft von 20 Schwertkämpfern. Maximal 1 pro Dorf.'
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
    ironmine:   { name: 'Eisenmine',  res: 'iron',  count: 5, terrain: 'mountainAdjacent' },
    farmstead:  { name: 'Hof',        res: 'food',  count: 4, terrain: 'open' },
    sheepfarm:  { name: 'Schaffarm',  res: 'food',  count: 4, terrain: 'open' }
  };
  var RESOURCE_STRUCTURE_ORDER = ['woodcutter', 'ironmine', 'farmstead', 'sheepfarm'];

  // Eroberbare Rohstoff-Strukturen: Stufenwerte und Garnison.
  // Produktion/Lager pro Stufe (Index 0 = Stufe 1 ... Index 2 = Stufe 3).
  // Eigene Strukturen produzieren direkt in das Burg-Lager des Besitzers;
  // neutrale Strukturen produzieren in ihr eigenes Lager (cap durch capacity).
  var RESOURCE_STRUCTURE_LEVELS = {
    maxLevel: 3,
    production: [10, 20, 30],          // Einheiten Rohstoff pro Spielsekunde
    capacity:   [5000, 12500, 20000],  // Eigenes Strukturlager (nur neutral relevant)
    // Upgrade-Kosten: Index 0 = Stufe 1->2, Index 1 = Stufe 2->3 (costFactor 2.0).
    upgradeCost: [
      { food: 0, wood: 1800, stone: 1500, iron:  900 },
      { food: 0, wood: 3600, stone: 3000, iron: 1800 }
    ],
    // Bauzeit in Spielsekunden fuer das jeweilige Upgrade.
    upgradeTime: [240, 480]
  };

  // Maximale dauerhaft stationierte Garnison in einer eigenen Struktur
  // (frei waehlbare Mischung Speer/Schwert/Axt/Bogen; Held nicht stationierbar).
  var STRUCTURE_GARRISON_CAP = 100;

  // Bevoelkerungsbonus auf maxPop der Heimatburg (Index = Strukturstufe).
  // Index 0 = unerobert/neutral (kein Bonus), 1/2/3 = Strukturstufe.
  var STRUCTURE_POP_BONUS = [0, 20, 40, 60];

  var SAVE = {
    dbName: 'world-of-houses',
    storeName: 'saves',
    slotId: 'autosave',
    intervalMs: 5000        // Auto-Save-Intervall (Echtzeit), nicht-blockierend
  };

  WOH.Config = {
    RESOURCE_STRUCTURES: RESOURCE_STRUCTURES,
    RESOURCE_STRUCTURE_ORDER: RESOURCE_STRUCTURE_ORDER,
    RESOURCE_STRUCTURE_LEVELS: RESOURCE_STRUCTURE_LEVELS,
    STRUCTURE_GARRISON_CAP: STRUCTURE_GARRISON_CAP,
    STRUCTURE_POP_BONUS: STRUCTURE_POP_BONUS,
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
    SAVE: SAVE
  };
})(window.WOH = window.WOH || {});
