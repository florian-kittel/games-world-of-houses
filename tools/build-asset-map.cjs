/* Analysis only: exports the existing atlas as a browsable reference.
 * Run from any directory with node tools/build-asset-map.cjs. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/atlas.js'), 'utf8'), context);
const atlas = context.window.WOH.Atlas;
const source = JSON.parse(fs.readFileSync(path.join(root, 'assets/tiles.json'), 'utf8'));
const entries = [];
const names = { grass: 'Wiese', forest: 'Wald', mountain: 'Gebirge', water: 'Wasser', field: 'Acker', woodcutter: 'Holzfäller',
  ironmine: 'Eisenmine', stonemine: 'Steinbruch', farmstead: 'Hof', sheepfarm: 'Schaffarm',
  castle: 'Burg', harbor: 'Hafen', city: 'Stadt', food: 'Nahrung', wood: 'Holz', stone: 'Stein', iron: 'Eisen' };
function add(id, group, coord, usage, note = '') {
  entries.push({ id, group, sheet: 'assets/tileset2.png', cell: Array.from(coord),
    sourceRect: { x: coord[0] * 16, y: coord[1] * 16, width: 16, height: 16 },
    usage, note, transforms: { rotate: false, mirrorX: false, mirrorY: false } });
}
for (const [id, coord] of Object.entries(atlas.terrain))
  add('terrain.' + id, 'Gelände', coord, 'Classic aktiv; Cinematic-Fallback', names[id]);
add('water.open', 'Wasser', atlas.water.open, 'Classic aktiv; Cinematic-Fallback', 'Offenes Wasser');
atlas.water.waves.forEach((c, i) => add('water.waves.' + i, 'Wasser', c, 'Classic aktiv; Cinematic-Fallback', 'Statische Wellenvariante, keine Laufzeitanimation'));
for (const kind of ['edge', 'outer', 'inner']) for (const [direction, c] of Object.entries(atlas.water[kind]))
  add('water.' + kind + '.' + direction, 'Wasser', c, 'Classic aktiv; Cinematic-Fallback', 'Eigene Richtungszeichnung; siehe Wasser-Semantik in ASSET-MAP.md');
for (const [id, c] of Object.entries(atlas.resources))
  add('resource.' + id, 'Rohstofficons', c, 'Weiterhin aktiv im HUD und in Dialogen', names[id]);
for (const [id, variants] of Object.entries(atlas.structures)) {
  if (!Array.isArray(variants)) continue;
  variants.forEach((c, tier) => {
    let note = names[id] + ' – Bildstufe ' + (tier + 1);
    if (id === 'castle') note += '; Halle ' + ['1–2', '3–4', '5–6'][tier];
    if (id === 'stonemine') note += '; teilt Originalbild mit Eisenmine';
    if (id === 'city' || id === 'harbor') note += '; im Atlas vorhanden, kein regulär platzierter Kartentyp';
    add('structure.' + id + '.' + (tier + 1), 'Bauten und Ausbaustufen', c,
      id === 'city' || id === 'harbor' ? 'Reserve / Renderer unterstützt; regulär ungenutzt' : 'Classic aktiv; in Cinematic ersetzt / Fallback', note);
  });
}
for (const [id, c] of Object.entries(atlas.border)) if (Array.isArray(c))
  add('border.' + id, 'Kartenrahmen', c, 'Classic aktiv; Cinematic-Fallback', 'Positionsgebundenes Rahmenteil');
for (const id of ['forest_overlay', 'mountain_overlay'])
  add('catalog.' + id, 'Weitere vorhandene Assets', source.catalog[id], 'Katalogisiert, im Kartenrenderer ungenutzt', 'Transparente Geländeauflage');
for (const [id, c] of Object.entries(source.catalog.icons_extra))
  add('catalog.icon.' + id, 'Weitere vorhandene Assets', c, 'Katalogisiert, im Renderer ungenutzt', id);
add('catalog.icon.ore', 'Weitere vorhandene Assets', [2, 4], 'Nur visuell identifiziert; keine Atlaszuordnung', 'Helle Stein-/Erzvariante; Rohstoffbedeutung nicht festgelegt');
for (let i = 0; i < 8; i++) add('catalog.ship.' + i, 'Schiffe', [i, 9], 'Katalogisiert, im Renderer ungenutzt', 'Richtungs-/Zustandsvariante; keine gesicherte Animationsreihenfolge');
for (let i = 0; i < 5; i++) add('catalog.waveOverlay.' + i, 'Weitere vorhandene Assets', [i + 4, 3], 'Visuell vorhanden, im Renderer ungenutzt', 'Welle auf transparentem Grund');
for (const [id, col] of Object.entries(source.catalog.structures_with_bg)) {
  if (typeof col !== 'number') continue;
  const count = id === 'city' ? 4 : 3;
  for (let tier = 0; tier < count; tier++) add('catalog.withBackground.' + id + '.' + (tier + 1),
    'Bauten mit Hintergrund', [col, 5 + tier], 'Vorhanden, bewusst nicht auf der Karte verwendet', names[id] + ' mit festem Boden; keine neue Generierung nötig');
}
const imagePaths = ['assets/tileset2.png', 'assets/tileset.png', 'assets/mountains.png', 'assets/water.png',
  'assets/cinematic/terrain.png', 'assets/cinematic/structures.png'];
const images = imagePaths.map(file => {
  const bytes = fs.readFileSync(path.join(root, file));
  return { file, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
});
const data = { schemaVersion: 1, purpose: 'Analyse und Generierungsplanung; kein Laufzeitmanifest',
  coordinateConvention: 'Nullbasiert [Spalte, Zeile], Originalzelle 16 × 16 px',
  sources: ['js/atlas.js', 'assets/tiles.json', 'assets/reference/tileset2_labeled.png', 'js/sprites.js', 'js/ui.js', 'js/cinematic.js'],
  knownManifestDrift: ['structures.stonemine existiert in js/atlas.js, fehlt aber in assets/tiles.json'],
  images, entries,
  procedural: { terrain: ['field', 'grass decorations'],
    buildingIcons: ['townhall', 'woodcutter', 'quarry', 'mine', 'farm', 'warehouse', 'barracks', 'range', 'wall', 'tower'],
    unitIcons: ['spear', 'sword', 'axe', 'archer', 'hero'],
    overlays: ['house crest: 6 patterns, dynamic colours', 'garrison shield', 'selection/hover/threat', 'movement lines/markers', 'labels'] },
  nextGenerationProposal: { camera: 'Eine feste schräge Draufsicht für alle erhöhten Objekte; Winkel anhand Pilotassets festlegen',
    rotate: false, mirrorX: false, mirrorY: false, lighting: 'Eine feste Lichtquelle links oben',
    activeStructureImages: 18, activeStructureTypes: ['castle', 'woodcutter', 'ironmine', 'stonemine', 'farmstead', 'sheepfarm'],
    reservedStructureImages: 7, waterImagesForExistingContract: 18,
    proposedMinimumTilePixels: 256, proposedMinimumStructurePixels: 512,
    note: 'Vorschlag, keine bereits erzeugten Assets. Endgültige Geländevariantenzahl nach Pilot festlegen.' } };
for (const e of entries) {
  if (e.cell[0] < 0 || e.cell[0] >= 14 || e.cell[1] < 0 || e.cell[1] >= 10)
    throw new Error('Invalid coordinate: ' + e.id);
}
if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Duplicate IDs');
const jsonPath = path.join(root, 'docs/asset-map.json');
// Preserve the Classic inventory and add the separately generated Cinematic set.
const cinematicContext = { window: { WOH: {} } };
data.sources.push('js/cinematic-v2.js');
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/cinematic-v2.js'), 'utf8'), cinematicContext);
data.cinematicV2 = Object.entries(cinematicContext.window.WOH.Cinematic.assets).map(([key, file]) => {
  const absolute = path.join(root, file);
  const bytes = fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
  const id = key.slice(5);
  return { id, file, width: bytes ? bytes.readUInt32BE(16) : null, height: bytes ? bytes.readUInt32BE(20) : null,
    classicType: id.startsWith('forest') ? 'forest' : id.startsWith('rock') ? 'mountain' : id.startsWith('grass') ? 'grass' : id.split('-')[0],
    level: /^(castle|woodcutter|ironmine|stonemine|farmstead|sheepfarm)-/.test(id) ? Number(id.slice(-2)) : null,
    transforms: { rotate: false, mirrorX: false, mirrorY: false } };
});
fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const groups = [...new Set(entries.map(e => e.group))];
function cinematicCards(items) {
  return '<div class="cards">' + items.map(e => {
    const size = e.classicType === 'castle' ? 160 : 112;
    const stage = e.classicType === 'castle' ? ' · Halle ' + ['1–2', '3–4', '5–6'][e.level - 1] : '';
    const mineralLabel = e.id.startsWith('rock-ore-') ? 'Erzfelsen · dunkel und schroff' : e.id.startsWith('rock-quarry-') ? 'Steinbruchfelsen · heller Kalkstein' : null;
    return '<article><img loading="lazy" style="width:' + size + 'px;height:' + size + 'px;object-fit:contain;flex:none;background:#30392c;border:0" src="../' + esc(e.file) + '" alt="' + esc(e.id) + '"><div><code>' + esc(e.id) + '</code><p>' + (mineralLabel || names[e.classicType] || esc(e.classicType)) + (e.level ? ' · Bildstufe ' + e.level : ' · Variante') + stage + '</p><small>' + e.width + ' × ' + e.height + ' px · feste Orientierung</small></div></article>';
  }).join('') + '</div>';
}
const cinematicSection = '<section id="cinematic-v2"><h2>Cinematic v2 · neue Assets</h2>' +
  '<p>Einzelbilder mit fester Blick- und Lichtrichtung. Je drei Wald- und Felsvarianten, zwei Wiesenböden und je drei echte Bauzustände für Burg und fünf Produktionsarten. Die Landschaft wird ohne Drehen oder Spiegeln zusammengesetzt.</p>' +
  '<p><a href="../assets/cinematic/v2/README.md">Darstellung und Auflösung</a> · <a href="../assets/cinematic/v2/topdown/prompts.json">Top-down-Prompts</a> · <a href="../assets/cinematic/v2/topdown/castle-roof-prompts.json">Burgprompts</a> · <a href="../assets/cinematic/v2/prompts.json">Erste Studien</a></p>' +
  '<h3 id="cinematic-castles">Burgen · drei Ausbaustufen in Draufsicht</h3>' + cinematicCards(data.cinematicV2.filter(e => e.classicType === 'castle')) +
  '<h3 id="cinematic-shores">Wasser und natürliche Ufer</h3><p>Durchgehende, geglättete Küstenkonturen mit unregelmäßigem Erd-/Kiessaum und flachem Uferwasser. Inseln, Buchten und kleine Teiche bleiben erhalten. Die Darstellung verwendet vorhandene Wasser- und Bodenmaterialien; die Spielfelder bleiben unverändert.</p><a href="previews/cinematic-shorelines.png"><img loading="lazy" style="max-width:960px;width:100%" src="previews/cinematic-shorelines.png" alt="Cinematic-Ufer mit Bucht, Insel und kleinem Teich"></a>' +
  '<h3 id="cinematic-mineral-rocks">Felsen rund um Minen</h3><p>Je zwei zusätzliche Varianten: dunkle, schroffe Erzfelsen und heller, kantiger Kalkstein. Alle acht angrenzenden Bergfelder erhalten den passenden Typ. Bei gemeinsamer Nachbarschaft werden beide Materialien ortsfest gemischt; sonstige Bergfelder behalten ihre bisherigen Varianten.</p><p><a href="../assets/cinematic/v2/topdown/mineral-rock-prompts.json">Generierungsprompts</a> · <a href="previews/cinematic-mineral-rocks.png">Vergleich im Gelände</a></p>' + cinematicCards(data.cinematicV2.filter(e => /^rock-(ore|quarry)-/.test(e.id))) +
  '<h3>Gelände und Varianten</h3>' + cinematicCards(data.cinematicV2.filter(e => !e.level && !/^rock-(ore|quarry)-/.test(e.id))) +
  '<h3>Produktionsgebäude und Ausbaustufen</h3>' + cinematicCards(data.cinematicV2.filter(e => e.level && e.classicType !== 'castle')) + '</section>';
const sections = groups.map(group => `<section><h2>${esc(group)}</h2><div class="cards">` + entries.filter(e => e.group === group).map(e =>
  `<article><div class="sprite" role="img" aria-label="${esc(e.note || e.id)}" style="background-position:-${e.cell[0] * 64}px -${e.cell[1] * 64}px"></div><div><code>${esc(e.id)}</code><p>${esc(e.note)}</p><small>[${e.cell.join(', ')}] · ${esc(e.usage)}</small></div></article>`).join('') + '</div></section>').join('\n');
fs.writeFileSync(path.join(root, 'docs/asset-map.html'), `<!doctype html>
<html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>World of Houses – Asset-Map</title><style>
:root{color-scheme:dark}body{margin:0;background:#12191d;color:#dddcd2;font:15px/1.55 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:32px}h1,h2{font-family:Georgia,serif;color:#dec995}h1{font-size:34px}h2{margin-top:40px}a{color:#b8d8e8}.intro{max-width:900px}nav{display:flex;gap:20px;flex-wrap:wrap}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}article{padding:14px;display:flex;gap:16px;background:#1c262b;border:1px solid #354247;border-radius:8px}code{overflow-wrap:anywhere;color:#f1dca6}p{margin:5px 0}small{color:#aab9bc}.sprite{width:64px;height:64px;flex:none;background-image:url('../assets/tileset2.png');background-size:896px 640px;image-rendering:pixelated;background-color:#101315}img{max-width:100%;height:auto;border:1px solid #354247}summary{cursor:pointer;color:#dec995}details{margin:20px 0}.note{padding:16px;border-left:3px solid #b79c64;background:#1c262b}
</style><main><h1>World of Houses · Asset-Map</h1><div class="intro"><p>Bestandsaufnahme der ursprünglichen Grafik und Grundlage für neue Assets. Die Spielgrafik wird durch diese Referenzseite nicht verändert.</p><p>${entries.length} semantische Zuordnungen, ${new Set(entries.map(e => e.cell.join(','))).size} verschiedene Originalzellen. Geteilte Bilder und ungenutzte Reserven sind absichtlich sichtbar.</p><nav><a href="ASSET-MAP.md">Analyse und Generierungsplan</a><a href="asset-map.json">Maschinenlesbarer Katalog</a><a href="../index.html">Zum Spiel</a></nav><p class="note">Koordinaten: [Spalte, Zeile], ab 0; jede Originalzelle 16 × 16 px. Alle Vorschauen behalten ihre originale Orientierung. Drei Burgbilder entsprechen Halle 1–2 / 3–4 / 5–6. Steinbruch und Eisenmine teilen ursprünglich dieselben Bilder.</p></div>
<details><summary>Beschriftetes Originalsheet: tileset2</summary><img src="../assets/reference/tileset2_labeled.png" alt="Vollständiges beschriftetes Originalsheet mit Koordinaten"></details>
${cinematicSection}
${sections}
<section><h2>Weitere vorhandene Sheets</h2><p>Diese Bilder sind im Projekt vorhanden, werden aber vom Kartenrenderer nicht als Bildquelle verwendet. Sie zeigen teilweise zusammenhängende Motive über mehrere Zellen; nicht pauschal als einzelne 16-Pixel-Sprites behandeln.</p><details><summary>Große Berge und Schneeberge · mountains.png</summary><img src="../assets/reference/mountains_labeled.png" alt="Beschriftete große Gebirgsmotive"></details><details><summary>Gelände, Straßen, Mauern, Burgen und Dekoration · tileset.png</summary><img src="../assets/reference/tileset_labeled.png" alt="Beschriftetes zusätzliches Terrain- und Architektursheet"></details><details><summary>water.png · vorhanden, kein Lade- oder Animationspfad im aktuellen Renderer</summary><img src="../assets/water.png" alt="Vorhandenes Wassersheet"></details></section>
<section><h2>Prozedurale Grafiken</h2><p>10 Gebäudeicons, 5 Einheitenicons, dynamische Hauswappen mit 6 Mustern sowie Garnisons-, Auswahl-, Bedrohungs- und Marschmarkierungen entstehen im Code. Sie sind keine Ausschnitte aus tileset2. Details und Abgrenzung stehen in der Analyse.</p></section></main></html>\n`);
console.log(JSON.stringify({ entries: entries.length, uniqueCells: new Set(entries.map(e => e.cell.join(','))).size, images, outputs: ['docs/asset-map.json', 'docs/asset-map.html'] }, null, 2));
