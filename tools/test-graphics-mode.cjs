// Dependency-free checks for renderer selection and device preference handling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function setup(saved, blocked, missingCinematic) {
  const draws = [], calls = [], stored = new Map();
  if (saved !== undefined) stored.set('woh.graphicsMode', saved);
  const woh = { Config: { MAP: { tileSize: 32 } }, Cinematic: {
    assets: { 'cine_grass-01': 'assets/cinematic/v2/grass-01.png' },
    isReady(images) { return !!images['cine_grass-01']; },
    terrain(map) { calls.push(['terrain', map]); return 'cinematic-terrain'; },
    structure(ctx, atlas, x, y, size, type, tier) {
      if (!atlas['cine_grass-01']) return null;
      calls.push(['structure', type, tier]); return { dx: x, dy: y, s: size };
    }
  } };
  const context = { window: { WOH: woh, localStorage: {
    getItem(key) { if (blocked) throw Error('blocked'); return stored.get(key); },
    setItem(key, value) { if (blocked) throw Error('blocked'); stored.set(key, value); }
  } }, Image: class {
    set src(url) {
      this.url = url;
      if (missingCinematic && url.includes('cinematic/')) this.onerror(); else this.onload();
    }
  }, document: { createElement(tag) {
    assert.equal(tag, 'canvas');
    return { width: 0, height: 0, getContext() { return drawing; } };
  } } };
  const drawing = { fillRect() {}, drawImage(...args) { draws.push(args); } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/atlas.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/sprites.js'), 'utf8'), context);
  return { sprites: woh.Sprites, draws, calls, stored, drawing };
}
(async function () {
  const test = setup();
  const map = { width: 3, height: 3, tiles: Array(9).fill('grass') };
  await test.sprites.loadAssets();
  assert.equal(test.sprites.getGraphicsMode(), 'cinematic');
  assert.equal(test.sprites.buildTerrainCanvas(map), 'cinematic-terrain');
  test.sprites.drawStructure(test.drawing, 16, 16, 32, 'castle', 2);
  assert.deepEqual(test.calls.at(-1), ['structure', 'castle', 2]);
  assert.equal(test.sprites.setGraphicsMode('classic'), true);
  assert.equal(test.stored.get('woh.graphicsMode'), 'classic');
  const terrain = test.sprites.buildTerrainCanvas(map);
  assert.equal(terrain.width, 96);
  assert.equal(terrain.height, 96);
  assert.equal(test.calls.filter(c => c[0] === 'terrain').length, 1);
  // Classic must select distinct original drawings, rather than scale one image.
  for (let tier = 0; tier < 3; tier++) {
    test.sprites.drawStructure(test.drawing, 16, 16, 32, 'castle', tier);
    const draw = test.draws.at(-1);
    assert.equal(draw[0].url, 'assets/tileset2.png');
    assert.equal(draw[1], 8 * 16);
    assert.equal(draw[2], (5 + tier) * 16);
  }
  assert.equal(test.sprites.setGraphicsMode('unknown'), false);
  assert.equal(test.sprites.getGraphicsMode(), 'classic');
  assert.equal(setup(test.stored.get('woh.graphicsMode')).sprites.getGraphicsMode(), 'classic');
  assert.equal(test.sprites.setGraphicsMode('cinematic'), true);
  assert.equal(test.sprites.buildTerrainCanvas(map), 'cinematic-terrain');
  assert.equal(test.stored.get('woh.graphicsMode'), 'cinematic');
  assert.equal(test.sprites.setGraphicsMode('cinematic'), false);
  assert.equal(setup('invalid').sprites.getGraphicsMode(), 'cinematic');
  const privateSession = setup('classic', true);
  assert.equal(privateSession.sprites.getGraphicsMode(), 'cinematic');
  assert.equal(privateSession.sprites.setGraphicsMode('classic'), true);
  assert.equal(privateSession.sprites.getGraphicsMode(), 'classic');
  const missing = setup(undefined, false, true);
  await missing.sprites.loadAssets();
  assert.equal(missing.sprites.buildTerrainCanvas(map).width, 96);
  missing.sprites.drawStructure(missing.drawing, 16, 16, 32, 'castle', 2);
  assert.equal(missing.draws.at(-1)[2], 7 * 16);
  console.log('PASS: Classic/Cinematic routing, three castle drawings, persistence, invalid/blocked storage, missing-asset fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
