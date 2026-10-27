// Usage: node tools/test-game-loop.cjs <path to node_modules>
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Drive the real bootstrap/loop deterministically at 60 FPS.
    await page.addInitScript(() => {
      window.requestAnimationFrame = fn => { window.nextFrame = fn; return 1; };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#btn-new').waitFor();
    await page.evaluate(() => {
      const original = WOH.Game.newGame;
      WOH.Game.newGame = (...args) => {
        const state = window.testState = original(...args);
        state.speedMultiplier = 1;
        state.ai = {};
        const v = state.villages[state.playerVillageId];
        v.buildings.barracks = 1;
        v.buildQueue = [{ key: 'townhall', target: 2, timeLeft: 20 }];
        return state;
      };
    });
    await page.locator('#btn-new').click();
    await page.waitForFunction(() => !!window.nextFrame);
    await page.evaluate(() => {
      window.now = performance.now();
      window.frames = count => { for (let i = 0; i < count; i++) { now += 1000 / 60; nextFrame(now); } };
      window.calls = { ticks: 0, production: 0, icons: 0 };
      const tick = WOH.Game.tick;
      WOH.Game.tick = (...args) => { calls.ticks++; return tick(...args); };
      const production = WOH.Village.productionPerSec;
      WOH.Village.productionPerSec = (...args) => { calls.production++; return production(...args); };
      for (const name of ['drawResourceIcon', 'drawUnitIcon', 'drawBuildingIcon']) {
        const original = WOH.Sprites[name];
        WOH.Sprites[name] = (...args) => { calls.icons++; return original(...args); };
      }
      frames(1);
    });
    await page.getByRole('button', { name: '⌂ Burg verwalten', exact: true }).click();
    const counter = page.locator('#village-body .qi-meta').first();
    const before = await counter.textContent();
    // A focused button formerly froze the entire village panel.
    await page.locator('#village-body .burg-tab[data-burg-tab="buildings"]').focus();
    await page.evaluate(() => { calls.ticks = 0; calls.icons = 0; frames(120); });
    assert.notEqual(await counter.textContent(), before, 'Counter updates with a focused button');
    const metrics = await page.evaluate(() => ({ ...calls, time: testState.gameTime }));
    assert.ok(metrics.ticks >= 14 && metrics.ticks <= 16, `Simulation bounded to 8 Hz: ${metrics.ticks} ticks/2s`);
    assert.equal(metrics.icons, 0, 'Unchanged panel icons are never repainted');

    const input = page.locator('#village-body input.train-n').first();
    await input.fill('17');
    const focusedCounter = await counter.textContent();
    await page.evaluate(() => frames(120));
    assert.equal(await input.inputValue(), '17', 'Typed quantity survives live updates');
    assert.ok(await input.evaluate(el => document.activeElement === el), 'Input retains focus');
    assert.notEqual(await counter.textContent(), focusedCounter, 'Counter also updates during input');

    await page.locator('[data-speed="8"]').click();
    const speedStart = await page.evaluate(() => testState.gameTime);
    await page.evaluate(() => frames(60));
    const speedElapsed = await page.evaluate(() => testState.gameTime) - speedStart;
    assert.ok(speedElapsed >= 7 && speedElapsed <= 8.01, `8x time is preserved: ${speedElapsed}`);
    await page.locator('[data-speed="0"]').click();
    const paused = await page.evaluate(() => { calls.production = 0; return testState.gameTime; });
    await page.evaluate(() => { frames(1); calls.production = 0; frames(120); });
    assert.equal(await page.evaluate(() => testState.gameTime), paused, 'Pause never accumulates simulation time');
    assert.equal(await page.evaluate(() => calls.production), 0, 'Paused HUD never recalculates production');
    await page.locator('[data-speed="1"]').click();
    const resumed = await page.evaluate(() => testState.gameTime);
    await page.evaluate(() => frames(60));
    assert.ok(await page.evaluate(() => testState.gameTime) - resumed < 1.01, 'Resume does not catch up paused time');

    // Large ticks must carry remaining time into the next queue entry.
    await page.evaluate(() => {
      const v = testState.villages[testState.playerVillageId];
      v.buildQueue = [
        { key: 'townhall', target: 2, timeLeft: 0.25 },
        { key: 'woodcutter', target: 2, timeLeft: 2 }
      ];
      v.trainingQueue = [
        { unit: 'spear', remaining: 1, perTime: 1, timeLeft: 0.25 },
        { unit: 'sword', remaining: 3, perTime: 1, timeLeft: 1 }
      ];
      WOH.Game.tick(testState, 1500);
    });
    const queues = await page.evaluate(() => {
      const v = testState.villages[testState.playerVillageId];
      return { build: v.buildQueue, train: v.trainingQueue };
    });
    assert.equal(queues.build.length, 1);
    assert.equal(queues.build[0].timeLeft, 0.75);
    assert.equal(queues.train[0].remaining, 2);
    assert.equal(queues.train[0].timeLeft, 0.75);
    assert.deepEqual(errors, [], 'No browser exceptions');
    console.log('PASS: 60 FPS rendering, <=8 Hz simulation, focused counters, stable inputs, cached icons, 8x/pause/resume, queue overflow.');
    console.log(JSON.stringify(metrics));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
