/* =========================================================================
 * World of Houses – Haus-Generator
 * Erzeugt GoT-ähnliche, aber eigenständige Hausnamen, Wappenfarben und Mottos.
 * Keine 1:1-Kopien existierender Marken.
 * ========================================================================= */
(function (WOH) {
  'use strict';

  // Eigenständige Nachnamen mit "mittelalterlich-fantastischem" Klang.
  var SURNAMES = [
    'Karrenwald', 'Sturmfels', 'Graufurt', 'Eisenhart', 'Falkenstein',
    'Wintermark', 'Rabenhorst', 'Dornau', 'Hochmund', 'Bleichmoor',
    'Goldbach', 'Schwarzwasser', 'Lindwurm', 'Aschborn', 'Marwen',
    'Frosttal', 'Rotgar', 'Steinmar', 'Wellengrund', 'Lichthall',
    'Düsterhain', 'Brandfeld', 'Salzmark', 'Norden', 'Greifenau',
    'Tarnholm', 'Velduin', 'Cassmark', 'Orven', 'Haldric'
  ];

  var SEATS = [
    'von Karrenstein', 'auf Eisenfeste', 'vom Sturmkliff', 'aus Graufurt',
    'von Rabenhall', 'auf Dornwacht', 'vom Hochmund', 'aus Bleichmoor',
    'von Goldhafen', 'auf Schwarzfels', 'vom Lindtal', 'aus Aschau'
  ];

  var WORDS = [
    'Wir Brechen Nicht', 'Stahl und Asche', 'Standhaft im Sturm',
    'Wir Säen Eisen', 'Die Nacht Gehört Uns', 'Erst Recht',
    'Unbeugsam', 'Feuer und Treue', 'Bis Zum Letzten Mann',
    'Wir Erinnern', 'Hart wie Fels', 'Der Winter Kennt Uns',
    'Wir Erheben Uns', 'Blut und Korn', 'Niemals Knien'
  ];

  // Wappenfarben (Primär/Sekundär) – kühle, GoT-nahe Paletten.
  var SIGILS = [
    { p: '#7d2b2b', s: '#e8d7a0' }, // Bordeaux/Gold
    { p: '#2b4a7d', s: '#cdd8e8' }, // Stahlblau/Silber
    { p: '#2f5d3a', s: '#dce4c8' }, // Waldgrün
    { p: '#3a3a44', s: '#b8c0cc' }, // Schiefer
    { p: '#6b4a1f', s: '#e4cfa0' }, // Bronze
    { p: '#5a2d5a', s: '#d8c4e0' }, // Purpur
    { p: '#1f4d4d', s: '#bfe0dc' }, // Petrol
    { p: '#7a5a1f', s: '#efe2b8' }, // Ocker
    { p: '#444c1f', s: '#d8dcb0' }, // Olive
    { p: '#5a1f2b', s: '#e0b8c0' }  // Weinrot
  ];

  var EMBLEMS = ['falke', 'rabe', 'wolf', 'baer', 'hirsch', 'turm', 'drache', 'schwert', 'sonne', 'fisch'];

  function generateHouses(rng, count) {
    var surnames = rng.shuffle(SURNAMES.slice());
    var seats = rng.shuffle(SEATS.slice());
    var sigils = rng.shuffle(SIGILS.slice());
    var emblems = rng.shuffle(EMBLEMS.slice());
    var houses = [];
    for (var i = 0; i < count; i++) {
      var sur = surnames[i % surnames.length];
      houses.push({
        id: 'house_' + i,
        name: 'Haus ' + sur,
        surname: sur,
        seat: seats[i % seats.length],
        motto: rng.pick(WORDS),
        sigil: sigils[i % sigils.length],
        emblem: emblems[i % emblems.length],
        isPlayer: false
      });
    }
    return houses;
  }

  WOH.Houses = { generate: generateHouses };
})(window.WOH = window.WOH || {});
