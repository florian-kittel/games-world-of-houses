/* Render the real assets without a browser, and check fractional-scale chunk
 * edges. Usage: node tools/render-cinematic-check.cjs <bundled node_modules> */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const { createCanvas, loadImage } = require(require.resolve('@napi-rs/canvas', { paths: [process.argv[2] || root] }));
const sandbox = { window: { WOH: { Config: { MAP: { tileSize: 32 } } } },
  document: { createElement() { return createCanvas(1, 1); } } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/cinematic-v2.js'), 'utf8'), sandbox);
const renderer = sandbox.window.WOH.Cinematic;
(async function () {
  const images = {};
  const sw = { self: { addEventListener() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), sw);
  for (const [key, file] of Object.entries(renderer.assets)) {
    assert.ok(fs.existsSync(path.join(root, file)), 'Missing active asset: ' + file);
    images[key] = await loadImage(path.join(root, file));
    assert.equal(images[key].width, /cine_(grass|field|water)-/.test(key) ? 768 : 512, 'Bounded runtime resolution: ' + file);
    assert.ok(sw.ASSETS.includes('./' + file), 'Offline cache includes ' + file);
    if (!/cine_(grass|field|water)-/.test(key))
      assert.equal(fs.readFileSync(path.join(root, file))[25], 6, 'RGBA cutout: ' + file);
  }
  const flat = renderer.terrain({ width: 16, height: 16, tiles: Array(256).fill('grass') }, images);
  const edgeCanvas = createCanvas(800, 800), edgeCtx = edgeCanvas.getContext('2d');
  edgeCtx.scale(1.5625, 1.5625);
  flat.draw(edgeCtx, { x: 0, y: 0, width: 512, height: 512, zoom: 1.25, pixelRatio: 1.25 });
  const pixels = edgeCtx.getImageData(0, 0, 800, 800).data;
  function lineMean(axis, pos) {
    let sum = 0;
    for (let i = 10; i < 790; i++) {
      const offset = axis === 'x' ? (i * 800 + pos) * 4 : (pos * 800 + i) * 4;
      assert.equal(pixels[offset + 3], 255, 'Opaque interior');
      sum += pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
    }
    return sum / 780;
  }
  const edgeRatios = ['x', 'y'].map(axis => {
    const neighbours = (lineMean(axis, 397) + lineMean(axis, 403)) / 2;
    const ratio = lineMean(axis, 400) / neighbours;
    assert.ok(ratio > .9, 'No dark chunk hairline along ' + axis); return ratio;
  });
  const fields = renderer.terrain({ width: 16, height: 16, tiles: Array(256).fill('field') }, images);
  const fieldCanvas = createCanvas(800, 800), fieldCtx = fieldCanvas.getContext('2d');
  fieldCtx.scale(1.5625, 1.5625);
  fields.draw(fieldCtx, { x: 0, y: 0, width: 512, height: 512, zoom: 1.25, pixelRatio: 1.25 });
  const fieldPixels = fieldCtx.getImageData(0, 0, 800, 800).data;
  let minimumSoilRatio = Infinity;
  // Four feathered tiles meet here; undersized splats previously left a regular
  // green dot at every junction, despite having no hard rectangular seams.
  for (let y = 100; y < 750; y += 50) for (let x = 100; x < 750; x += 50) {
    let red = 0, green = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const k = ((y + dy) * 800 + x + dx) * 4;
      red += fieldPixels[k]; green += fieldPixels[k + 1];
    }
    minimumSoilRatio = Math.min(minimumSoilRatio, red / green);
  }
  assert.ok(minimumSoilRatio > 1.05, 'Soil covers interior field junctions without green grid holes');
  const map = { width: 24, height: 18, tiles: Array(24 * 18).fill('grass') };
  for (let y = 0; y < 18; y++) for (let x = 0; x < 24; x++) {
    if (x < 10 && y < 10 && x > 0 && y > 0) map.tiles[y * 24 + x] = 'forest';
    if (x > 12 && y < 10 && x < 23 && y > 0) map.tiles[y * 24 + x] = 'mountain';
    if (x < 9 && y > 12) map.tiles[y * 24 + x] = 'field';
    if (x > 17 && y > 12) map.tiles[y * 24 + x] = 'water';
  }
  const c = createCanvas(1536, 1152), ctx = c.getContext('2d'); ctx.scale(2, 2);
  renderer.terrain(map, images).draw(ctx, { x: 0, y: 0, width: 768, height: 576, zoom: 2, pixelRatio: 1 });
  ['castle', 'woodcutter', 'ironmine', 'stonemine', 'farmstead', 'sheepfarm'].forEach((type, i) =>
    renderer.structure(ctx, images, 58 + i * 125, 380, 48, type, 0));
  const out = path.resolve(root, process.argv[3] || 'docs/previews'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'cinematic-v2-repeat.png'), c.toBuffer('image/png'));
  fs.writeFileSync(path.join(out, 'cinematic-v2-chunk-edges.png'), edgeCanvas.toBuffer('image/png'));
  const stages = createCanvas(1440, 600), stageCtx = stages.getContext('2d');
  stageCtx.fillStyle = '#30392c'; stageCtx.fillRect(0, 0, 1440, 600);
  stageCtx.fillStyle = '#e8d7a0'; stageCtx.textAlign = 'center'; stageCtx.font = '28px sans-serif';
  stageCtx.fillText('Cinematic · Burgen in Draufsicht', 720, 48);
  for (let tier = 0; tier < 3; tier++) {
    renderer.structure(stageCtx, images, 240 + tier * 480, 420, 200, 'castle', tier);
    stageCtx.fillText('Halle ' + ['1–2', '3–4', '5–6'][tier], 240 + tier * 480, 560);
  }
  fs.writeFileSync(path.join(out, 'cinematic-castle-stages.png'), stages.toBuffer('image/png'));
  const mineralPreview = createCanvas(1536, 720), mp = mineralPreview.getContext('2d');
  mp.fillStyle = '#17201b'; mp.fillRect(0, 0, 1536, 720);
  const patch = { width: 8, height: 10, tiles: Array(80).fill('grass') };
  for (let y = 1; y < 9; y++) for (let x = 1; x < 7; x++) patch.tiles[y * 8 + x] = 'mountain';
  for (let y = 6; y < 9; y++) for (let x = 3; x < 6; x++) patch.tiles[y * 8 + x] = 'grass';
  ['normal', 'ironmine', 'stonemine'].forEach((type, i) => {
    mp.save(); mp.translate(i * 512, 56); mp.scale(2, 2);
    const sites = type === 'normal' ? [] : [{ type, x: 4, y: 6 }];
    renderer.terrain(patch, images, sites).draw(mp, { x: 0, y: 0, width: 256, height: 320, zoom: 2, pixelRatio: 1 });
    if (sites.length) renderer.structure(mp, images, 144, 208, 42, type, 0);
    mp.restore(); mp.fillStyle = '#e8d7a0'; mp.textAlign = 'center'; mp.font = '22px sans-serif';
    mp.fillText(['Normales Gebirge', 'Erzmine · dunkle Erzfelsen', 'Steinbruch · heller Kalkstein'][i], i * 512 + 256, 34);
  });
  fs.writeFileSync(path.join(out, 'cinematic-mineral-rocks.png'), mineralPreview.toBuffer('image/png'));
  const shoreMap = { width: 24, height: 18, tiles: Array(432).fill('grass') };
  for (let y = 0; y < 18; y++) for (let x = 0; x < 24; x++) {
    if (((x-12)/9)**2+((y-8.5)/6.8)**2 < 1) shoreMap.tiles[y*24+x] = 'water';
    if (x >= 17 && y >= 4 && y <= 7) shoreMap.tiles[y*24+x] = 'grass';
    if (x >= 10 && x <= 11 && y >= 8 && y <= 9) shoreMap.tiles[y*24+x] = 'grass';
    if (x >= 1 && x <= 2 && y >= 1 && y <= 2) shoreMap.tiles[y*24+x] = 'water';
  }
  const coastImage = createCanvas(1536,1152), coastCtx = coastImage.getContext('2d'); coastCtx.scale(2,2);
  renderer.terrain(shoreMap,images).draw(coastCtx,{x:0,y:0,width:768,height:576,zoom:2,pixelRatio:1});
  fs.writeFileSync(path.join(out,'cinematic-shorelines.png'),coastImage.toBuffer('image/png'));
  // Water/land centres stay legible, including the island; only the bank moves.
  const coastPixels = coastCtx.getImageData(0,0,1536,1152).data;
  for (let y=1;y<17;y++) for(let x=1;x<23;x++) {
    const k = (((y*32+16)*2)*1536+(x*32+16)*2)*4;
    assert.equal(coastPixels[k+3],255,'No transparent coast/chunk gaps');
    const blue = coastPixels[k+2], red = coastPixels[k];
    if (shoreMap.tiles[y*24+x]==='water') assert.ok(blue>red,'Water tile centre preserved');
    else assert.ok(red>blue,'Land/island tile centre preserved');
  }
  console.log(JSON.stringify({ activeAssets: Object.keys(images).length, edgeRatios, minimumSoilRatio, output: 'docs/previews/cinematic-v2-repeat.png' }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
