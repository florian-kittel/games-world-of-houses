// Behaviour checks for deterministic placement, zoom detail and cache bounds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const canvases = [], scales = [], imageDraws = [];
function context() {
  return { drawImage(img, ...args) { if (img.id) imageDraws.push([img.id, ...args]); },
    scale(x, y) { assert.ok(x > 0 && y > 0, 'No mirrored scenery'); scales.push([x, y]); },
    rotate() { assert.fail('No rotated scenery'); },
    translate() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, closePath() {}, save() {}, restore() {}, fill() {}, clip() {}, stroke() {}, strokeRect() {},
    createRadialGradient() { return { addColorStop() {} }; }
  };
}
const sandbox = { window: { WOH: { Config: { MAP: { tileSize: 32 } } } },
  document: { createElement() { const c = { width: 0, height: 0, getContext: context }; canvases.push(c); return c; } } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/cinematic-v2.js'), 'utf8'), sandbox);
const renderer = sandbox.window.WOH.Cinematic;
const images = Object.fromEntries(Object.keys(renderer.assets).map(id => [id, { id, width: 1024, height: 1024 }]));
const map = { width: 40, height: 40, tiles: Array(1600).fill('forest') };
const before = JSON.stringify(map);
const a = renderer.terrain(map, images), screen = context();
const view = { x: 0, y: 0, width: 800, height: 600, zoom: 1, pixelRatio: 2 };
a.draw(screen, view);
const afterFirstDraw = canvases.length;
a.draw(screen, view);
assert.equal(canvases.length, afterFirstDraw, 'Reuse warm chunks');
const used = new Set(imageDraws.filter(c => c[0].includes('forest')).map(c => c[0]));
assert.equal(used.size, 3, 'All forest variants participate');
const neighbours = new Map();
imageDraws.filter(c => c[0].includes('forest')).forEach(c => {
  const x = Math.floor((c[1] + c[3] / 2) / 32), y = Math.floor((c[2] + c[4] / 2) / 32);
  neighbours.set(x + ',' + y, c[0]);
});
for (const [key, id] of neighbours) {
  const [x, y] = key.split(',').map(Number);
  assert.notEqual(neighbours.get((x - 1) + ',' + y), id, 'No identical horizontal neighbour');
  assert.notEqual(neighbours.get(x + ',' + (y - 1)), id, 'No identical vertical neighbour');
}
const firstPlacement = imageDraws.filter(c => c[0].includes('forest')).slice(0, 100);
imageDraws.length = 0;
renderer.terrain(map, images).draw(screen, view);
assert.deepEqual(imageDraws.filter(c => c[0].includes('forest')).slice(0, 100), firstPlacement, 'Stable placement across rebuilds');
a.draw(screen, { x: 256, y: 256, width: 200, height: 200, zoom: 3, pixelRatio: 2 });
assert.ok(scales.some(s => s[0] === 6), 'Six source pixels per world pixel at max zoom/DPR');
for (let y = 0; y < 1280; y += 200) for (let x = 0; x < 1280; x += 200) {
  a.draw(screen, { x, y, width: 500, height: 300, zoom: 3, pixelRatio: 2 });
  assert.ok(a.stats().cacheBytes <= a.stats().maxBytes, 'Bounded terrain memory');
}
const extreme = { x: 0, y: 0, width: 1280, height: 1280, zoom: 3, pixelRatio: 2 };
a.draw(screen, extreme);
const beforeWarmExtreme = canvases.length;
a.draw(screen, extreme);
assert.equal(canvases.length, beforeWarmExtreme, 'No cache thrashing for a large visible working set');
assert.equal(JSON.stringify(map), before, 'Rendering never changes the simulation map');
const tiers = [];
for (let tier = 0; tier < 3; tier++) {
  renderer.structure(screen, images, 100, 100, 32, 'castle', tier);
  tiers.push(imageDraws.at(-1)[0]);
}
assert.equal(new Set(tiers).size, 3, 'Three independent castle states');
assert.equal(renderer.structure(screen, images, 0, 0, 32, 'harbor', 0), null, 'Unsupported types fall back');
// Mineral scenery includes diagonals and never modifies simulation/save data.
const mineralMap = { width: 14, height: 10, tiles: Array(140).fill('mountain') };
const mines = [{ type: 'ironmine', x: 3, y: 4 }, { type: 'stonemine', x: 5, y: 4 },
  { type: 'woodcutter', x: 10, y: 4 }, { type: 'ironmine', x: 0, y: 0 }];
mineralMap.tiles[3 * 14 + 2] = 'grass';
mineralMap.tiles[5 * 14 + 6] = 'forest';
const mineralBefore = JSON.stringify({ mineralMap, mines });
function placements(structures, source = images) {
  imageDraws.length = 0;
  renderer.terrain(mineralMap, source, structures).draw(screen,
    { x: 0, y: 0, width: 448, height: 320, zoom: 2, pixelRatio: 1 });
  return new Map(imageDraws.filter(c => /cine_(rock|forest)-/.test(c[0])).map(c =>
    [Math.floor((c[1] + c[3] / 2) / 32) + ',' + Math.floor((c[2] + c[4] / 2) / 32), c[0]]));
}
const mineralPlacement = placements(mines), shared = [];
for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
  const key = x + ',' + y, id = mineralPlacement.get(key), kind = mineralMap.tiles[y * 14 + x];
  if (kind === 'grass') { assert.equal(id, undefined); continue; }
  if (kind === 'forest') { assert.match(id, /^cine_forest-/); continue; }
  const touching = mines.filter(s => /^(ironmine|stonemine)$/.test(s.type) &&
    Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) === 1);
  const ore = touching.some(s => s.type === 'ironmine'), quarry = touching.some(s => s.type === 'stonemine');
  if (ore && quarry) { assert.match(id, /^cine_rock-(ore|quarry)-/); shared.push(id); }
  else if (ore) assert.match(id, /^cine_rock-ore-/, 'All adjacent ore rocks, including diagonals');
  else if (quarry) assert.match(id, /^cine_rock-quarry-/, 'All adjacent quarry rocks, including diagonals');
  else assert.match(id, /^cine_rock-0/, 'Distant rocks remain unchanged');
}
assert.ok(shared.some(id => id.includes('ore')) && shared.some(id => id.includes('quarry')), 'Shared neighbourhood mixes both materials');
assert.deepEqual(placements(mines.slice().reverse()), mineralPlacement, 'Structure order never affects shared neighbours');
assert.deepEqual(placements(mines), mineralPlacement, 'Stable on rebuild/zoom/mode reload');
assert.equal(JSON.stringify({ mineralMap, mines }), mineralBefore, 'No map or structure mutation');
const legacyImages = Object.fromEntries(Object.entries(images).filter(([id]) => !/rock-(ore|quarry)-/.test(id)));
assert.ok([...placements(mines, legacyImages).values()].every(id => !/rock-(ore|quarry)-/.test(id)), 'Missing mineral assets fall back to ordinary rock');
console.log('PASS: eight-neighbour mineral rocks, stable overlap mixing, boundaries, unaffected terrain, fallback, unchanged save data.');
const lake = { width: 12, height: 12, tiles: Array(144).fill('grass') };
for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) lake.tiles[y*12+x] = 'water';
for (let y = 5; y < 7; y++) for (let x = 5; x < 7; x++) lake.tiles[y*12+x] = 'grass';
const lakeBefore = JSON.stringify(lake), coast = renderer.shoreline(lake, 32);
assert.equal(coast.length, 2, 'Lake boundary and island remain independent closed contours');
assert.ok(coast.every(c => c.points.length > 16 && c.points.every(p => p.every(Number.isFinite))), 'Finite detailed coast geometry');
assert.deepEqual(renderer.shoreline(lake, 32), coast, 'Coast geometry stable across zoom/rebuild');
const corners = { width: 2, height: 2, tiles: ['water','grass','grass','water'] };
assert.equal(renderer.shoreline(corners,32).length,2,'Diagonal-only water cells stay separate');
assert.equal(renderer.shoreline({width:1,height:1,tiles:['grass']},32).length,0,'Dry maps have no shoreline');
assert.equal(renderer.shoreline({width:1,height:1,tiles:['water']},32).length,1,'Single water cell and map edges close safely');
const curved = coast[0].points;
assert.ok(curved.some((p,i) => {
  const q = curved[(i+1)%curved.length];
  return Math.abs(p[0]-q[0]) > .1 && Math.abs(p[1]-q[1]) > .1;
}), 'Continuous coast contains curved diagonal sections');
assert.equal(JSON.stringify(lake),lakeBefore,'Coast smoothing never changes playable tiles');
console.log('PASS: continuous stable shore contours, islands, diagonal topology, small ponds, map edges, unchanged map.');
console.log('PASS: deterministic variant placement, positive scales, cache reuse/budget, max zoom detail, unchanged map, three castle states.');
