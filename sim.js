/* =========================================================================
 * World of Houses – Headless-Smoke-Test (Node)
 * Lädt die Spiel-Logik ohne DOM (config/rng/houses/mapgen/atlas/village/
 * combat/game/ai/persistence) und prüft den Resourcen-Rework:
 *  - Produktionsformel (Stufe × perLevel × Bonus)
 *  - verdoppelte Holzkosten
 *  - Strukturen 5/Stufe inkl. neuer Steinbruch-Struktur
 *  - KI-Persönlichkeiten (Zuweisung, Determinismus)
 *  - Rohstoff-Unterstützung zwischen eigenen Burgen (Marsch + Einbuchung)
 *  - Langlauf ohne Exceptions / negative Rohstoffe
 *
 * Ausführen aus dem Projekt-Stammverzeichnis:  node sim.js
 * ========================================================================= */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const JS = path.join(__dirname, 'js');
const sandbox = { window: {}, Math: Math, console: console, Date: Date };
sandbox.window.WOH = {};
vm.createContext(sandbox);
['config.js','rng.js','houses.js','mapgen.js','atlas.js','village.js','combat.js','game.js','ai.js','persistence.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), sandbox, { filename: f }));
const WOH = sandbox.window.WOH, C = WOH.Config, V = WOH.Village, G = WOH.Game;
function assert(c, m) { if (!c) { console.error('FAIL: ' + m); process.exit(1); } }

assert(C.BUILDINGS.woodcutter.perLevel === 3 && C.BUILDINGS.quarry.perLevel === 2 &&
       C.BUILDINGS.mine.perLevel === 1 && C.BUILDINGS.farm.perLevel === 3, 'perLevel-Basiswerte');
assert(C.BUILDINGS.barracks.baseCost.wood === 400 && C.UNITS.axe.cost.wood === 120, 'Holzkosten verdoppelt');
assert(JSON.stringify(C.RESOURCE_STRUCTURE_LEVELS.production) === JSON.stringify([5,10,15]), 'Struktur 5/10/15');
assert(C.RESOURCE_STRUCTURES.stonemine && C.RESOURCE_STRUCTURES.stonemine.res === 'stone', 'Steinbruch-Struktur');
console.log('[1] Config-Rework OK');

const st = G.newGame(12345, 'hard', 4);
const types = {}; (st.structures||[]).forEach(s => types[s.type] = (types[s.type]||0)+1);
assert((types.stonemine||0) >= 1, 'Steinbruch-Struktur platziert');
for (const hid in st.ai) assert(C.PERSONALITIES[st.ai[hid].personality], 'Persönlichkeit gültig');
const st2 = G.newGame(12345, 'hard', 4);
for (const hid in st.ai) assert(st.ai[hid].personality === st2.ai[hid].personality, 'Persönlichkeit deterministisch');
console.log('[2] Strukturen + Persönlichkeiten OK', JSON.stringify(types));

const pv = st.villages[st.playerVillageId];
const ids = Object.keys(st.villages); const second = ids.map(i=>st.villages[i]).find(v=>v.id!==pv.id);
second.houseId = pv.houseId; second.isPlayer = true;
pv.resources.wood = 2000; second.resources.wood = 0;
const r = G.sendArmy(st, pv.id, second.id, {}, 'support', { wood: 500 });
assert(r.ok && pv.resources.wood === 1500, 'Rohstoff-Tross abgebucht');
let guard = 0; const mv = st.movements.find(m=>m.type==='support'&&m.resources);
while (st.movements.includes(mv) && guard++ < 20000) G.tick(st, 1000);
assert(second.resources.wood >= 499, 'Rohstoffe angekommen');
console.log('[3] Rohstoff-Unterstützung OK');

const st3 = G.newGame(98765, 'hard', 4);
for (let i=0;i<5000 && !st3.gameOver;i++) {
  G.tick(st3, 1000);
  for (const id in st3.villages) C.RESOURCES.forEach(rr => assert(!isNaN(st3.villages[id].resources[rr]) && st3.villages[id].resources[rr] >= 0, 'Rohstoff stabil'));
}
console.log('[4] Langlauf OK — gameTime', Math.round(st3.gameTime), 'gameOver=', st3.gameOver);

const old = G.newGame(555, 'normal', 3);
for (const hid in old.ai) delete old.ai[hid].personality;
old.version = 6; WOH.Persistence.migrate(old);
assert(old.version === 7, 'Migration v7');
for (const hid in old.ai) assert(C.PERSONALITIES[old.ai[hid].personality], 'Migration Persönlichkeit');
console.log('[5] Save-Migration OK');

console.log('\n✓ Alle Smoke-Tests bestanden.');
