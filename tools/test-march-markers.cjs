// Usage: node tools/test-march-markers.cjs <path to node_modules>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(path.join(process.argv[2], 'playwright'));
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(error ? '' : data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.requestAnimationFrame = callback => { window.nextFrame = callback; return 1; };
      localStorage.setItem('woh.graphicsMode', 'cinematic');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#btn-new').waitFor();
    await page.evaluate(() => {
      const original = WOH.Game.newGame;
      WOH.Game.newGame = (...args) => {
        const state = window.testState = original(...args);
        state.speedMultiplier = 0;
        state.ai = {};
        const own = state.villages[state.playerVillageId];
        const other = Object.values(state.villages).find(v => v.id !== own.id);
        other.x = own.x + 2; other.y = own.y;
        other.houseId = own.houseId;
        const building = state.structures[0];
        building.x = own.x; building.y = own.y + 2;
        building.ownerHouseId = own.houseId;
        window.destinations = [other.id, building.id];
        own.units.spear = 100;
        own.resources.wood = 1000;
        return state;
      };
      window.markerCalls = [];
      const draw = WOH.Sprites.drawAttackMarker;
      WOH.Sprites.drawAttackMarker = (...args) => {
        markerCalls.push({ house: args[3].id, returning: args[6], kind: args[7] });
        return draw(...args);
      };
    });
    await page.locator('#btn-new').click();
    const result = await page.evaluate(() => {
      const state = testState;
      const sent = [];
      for (const to of destinations) {
        sent.push(WOH.Game.sendArmy(state, state.playerVillageId, to, { spear: 5 }, 'support'));
      }
      sent.push(WOH.Game.sendArmy(state, state.playerVillageId, destinations[0], {}, 'support', { wood: 100 }));
      markerCalls.length = 0;
      nextFrame(performance.now() + 16);
      return { sent, markers: markerCalls, house: state.playerHouseId };
    });
    assert.ok(result.sent.every(r => r.ok), JSON.stringify(result.sent));
    assert.equal(result.markers.filter(m => m.kind === 'support').length, 2, 'Castle AND building support render shields');
    assert.equal(result.markers.filter(m => m.kind === 'supply').length, 1, 'Resource convoy renders a shield');
    assert.ok(result.markers.every(m => m.house === result.house), 'Sender house crest');
    const pulses = await page.evaluate(() => {
      const results = {};
      for (const kind of ['supply', 'support']) {
        results[kind] = [0, .45].map(time => {
          const ctx = document.createElement('canvas').getContext('2d');
          const rings = [], radii = [];
          const stroke = ctx.stroke.bind(ctx), arc = ctx.arc.bind(ctx);
          ctx.stroke = () => { rings.push(ctx.strokeStyle); stroke(); };
          ctx.arc = (...args) => { radii.push(args[2]); arc(...args); };
          WOH.Sprites.drawAttackMarker(ctx, 50, 50, testState.houses[testState.playerHouseId], time, 0, false, kind);
          return { rings, radii };
        });
      }
      WOH.UI.setGraphicsMode('classic');
      markerCalls.length = 0;
      nextFrame(performance.now() + 32);
      results.classicMarkers = markerCalls.length;
      return results;
    });
    for (const [kind, color] of [['supply', '#c8a24a'], ['support', '#5aa0d8']]) {
      assert.ok(pulses[kind][0].rings.includes(color), kind + ' border colour');
      assert.notDeepEqual(pulses[kind][0].radii, pulses[kind][1].radii, kind + ' expanding pulse');
    }
    assert.equal(pulses.classicMarkers, 0, 'Classic retains its original markers');
    assert.deepEqual(errors, []);
    console.log('PASS: real support to castle/building and goods convoy render house shields, blue/yellow animated pulses, Classic unchanged.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
