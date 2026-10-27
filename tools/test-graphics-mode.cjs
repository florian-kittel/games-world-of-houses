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
    assets: { 'cine_grass-01': 'assets/cinematic/map/grass-01.png' },
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
  const drawing = { fills: 0, fillRect() { this.fills++; }, drawImage(...args) { draws.push(args); }, save() {}, restore() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/atlas.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/sprites.js'), 'utf8'), context);
  return { sprites: woh.Sprites, draws, calls, stored, drawing };
}
(async function () {
  // Existing castle-menu canvases must be cleared and redrawn on mode changes.
  for (const pixelRatio of [1, 2]) {
    let mode = 'classic', width = 40, height = 40;
    const context = { pixels: [], transform: 1, scale(x) { this.transform *= x; } };
    const canvas = {
      get width() { return width; },
      set width(value) { width = value; context.pixels = []; context.transform = 1; },
      get height() { return height; },
      set height(value) { height = value; context.pixels = []; context.transform = 1; },
      getContext() { return context; },
      getAttribute() { return 'townhall'; }
    };
    const woh = { Config: {}, Sprites: {
      getGraphicsMode() { return mode; },
      setGraphicsMode(value) { const changed = mode !== value; mode = value; return changed; },
      drawBuildingIcon(ctx) { ctx.pixels.push(mode); }
    } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'), {
      window: { WOH: woh, devicePixelRatio: pixelRatio },
      document: {
        body: { setAttribute() {} },
        querySelector() { return null; },
        querySelectorAll(selector) { return selector === 'canvas[data-bld]' ? [canvas] : []; }
      }
    });
    for (const next of ['cinematic', 'classic', 'cinematic', 'classic']) {
      woh.UI.setGraphicsMode(next);
      assert.deepEqual(context.pixels, [next], 'No previous-mode pixels remain in the castle menu');
      assert.equal(width, next === 'classic' ? 40 : 40 * pixelRatio);
      assert.equal(height, width);
      assert.equal(context.transform, next === 'classic' ? 1 : pixelRatio);
      assert.equal(context.imageSmoothingEnabled, next === 'cinematic');
    }
  }
  console.log('PASS: castle-menu mode changes clear previous images and reset resolution/transforms at DPR 1 and 2.');
  const test = setup();
  const map = { width: 3, height: 3, tiles: Array(9).fill('grass') };
  await test.sprites.loadAssets();
  assert.equal(test.sprites.getGraphicsMode(), 'cinematic');
  for(const key of ['spear','sword','axe','archer','hero']) {
    test.sprites.drawUnitIcon(test.drawing,0,0,4,key,30,36);
    assert.equal(test.draws.at(-1)[0].url,'assets/cinematic/ui/unit-'+key+'.png','Correct unit portrait '+key);
    assert.deepEqual(test.draws.at(-1).slice(1),[0,0,30,36],'Full portrait slot');
  }
  for(const key of ['food','wood','stone','iron','population']) {
    test.sprites.drawResourceIcon(test.drawing,0,0,18/16,key);
    assert.equal(test.draws.at(-1)[0].url,'assets/cinematic/ui/resource-'+key+'.png','Cinematic resource '+key);
    assert.deepEqual(test.draws.at(-1).slice(1),[0,0,18,18]);
  }
  const menuIcons = {
    townhall:'townhall-building-v3', woodcutter:'woodcutter-close-v3', quarry:'quarry-close-v3',
    mine:'ironmine-right-angle-v5', farm:'farm-aligned-v4', warehouse:'warehouse-building-v3',
    barracks:'barracks-aligned-v4', range:'range-aligned-v4', wall:'wall-aligned-v4', tower:'tower-aligned-v4'
  };
  const sw = { self: { addEventListener() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),sw);
  for (const [key,id] of Object.entries(menuIcons)) {
    test.sprites.drawBuildingIcon(test.drawing,0,0,40/12,key);
    assert.equal(test.draws.at(-1)[0].url,'assets/cinematic/ui/'+id+'.png','Approved icon for '+key);
    assert.deepEqual(test.draws.at(-1).slice(1),[0,0,40,40],'Use entire menu slot');
    const bytes = fs.readFileSync(path.join(root,'assets/cinematic/ui',id+'.png'));
    assert.equal(bytes.readUInt32BE(16),256); assert.equal(bytes[25],6,'RGBA icon');
    assert.ok(sw.ASSETS.includes('./assets/cinematic/ui/'+id+'.png'),'Offline icon '+key);
  }
  assert.equal(test.sprites.buildTerrainCanvas(map), 'cinematic-terrain');
  test.sprites.drawStructure(test.drawing, 16, 16, 32, 'castle', 2);
  assert.deepEqual(test.calls.at(-1), ['structure', 'castle', 2]);
  assert.equal(test.sprites.setGraphicsMode('classic'), true);
  const oldUnitDraws=test.draws.length,oldUnitFills=test.drawing.fills;
  for(const key of ['spear','sword','axe','archer','hero']) test.sprites.drawUnitIcon(test.drawing,3,0,4,key);
  assert.equal(test.draws.length,oldUnitDraws,'Classic keeps procedural soldiers');
  assert.ok(test.drawing.fills>oldUnitFills);
  test.sprites.drawResourceIcon(test.drawing,0,0,1,'wood');
  assert.equal(test.draws.at(-1)[0].url,'assets/tileset2.png','Classic resource uses its original atlas');
  const beforeClassicIcons = test.draws.length, beforeClassicFills = test.drawing.fills;
  for (const key of Object.keys(menuIcons)) test.sprites.drawBuildingIcon(test.drawing,2,2,3,key);
  assert.equal(test.draws.length,beforeClassicIcons,'Classic keeps procedural icons');
  assert.ok(test.drawing.fills>beforeClassicFills,'Classic icons still render');
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
  const beforeFallback = missing.drawing.fills;
  missing.sprites.drawBuildingIcon(missing.drawing,0,0,40/12,'mine');
  assert.ok(missing.drawing.fills>beforeFallback,'Missing UI icon falls back to procedural drawing');
  missing.sprites.drawResourceIcon(missing.drawing,0,0,1,'iron');
  assert.equal(missing.draws.at(-1)[0].url,'assets/tileset2.png','Missing resource falls back to atlas');
  const popFills=missing.drawing.fills;
  missing.sprites.drawResourceIcon(missing.drawing,0,0,1,'population');
  assert.ok(missing.drawing.fills>popFills,'Population retains visible flag fallback');
  const fallbackUnitFills=missing.drawing.fills;
  missing.sprites.drawUnitIcon(missing.drawing,0,0,4,'archer',30,36);
  assert.ok(missing.drawing.fills>fallbackUnitFills,'Missing portrait uses procedural fallback');
  console.log('PASS: five Cinematic soldiers, correct slots, Classic and missing-portrait fallback.');
  console.log('PASS: all five Cinematic resources, original Classic icons, missing resource/population fallback.');
  console.log('PASS: all ten approved construction icons, 40px fit, RGBA/offline assets, Classic and missing-image fallback.');
  console.log('PASS: Classic/Cinematic routing, three castle drawings, persistence, invalid/blocked storage, missing-asset fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
