// Usage: node tools/test-map-actions.cjs <path to node_modules>
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
    const page = await browser.newPage({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#btn-new').waitFor();
    await page.evaluate(() => {
      const draw = WOH.Sprites.drawResourceStructure;
      WOH.Sprites.drawResourceStructure = (ctx, x, y, ...args) => {
        const matrix = ctx.getTransform();
        const canvas = ctx.canvas;
        const rect = canvas.getBoundingClientRect();
        window.targetPoint = {
          x: rect.left + (matrix.a * x + matrix.c * y + matrix.e) * rect.width / canvas.width,
          y: rect.top + (matrix.b * x + matrix.d * y + matrix.f) * rect.height / canvas.height
        };
        return draw(ctx, x, y, ...args);
      };
      const original = WOH.Game.newGame;
      WOH.Game.newGame = (...args) => {
        const state = original(...args);
        const own = state.villages[state.playerVillageId];
        own.x = 20; own.y = 20;
        const target = state.structures.find(s => !s.ownerHouseId);
        target.x = 22; target.y = 20;
        state.structures = [target];
        state.speedMultiplier = 0;
        window.testState = state;
        return state;
      };
    });
    await page.locator('#btn-new').click();
    await page.waitForFunction(() => document.querySelector('#topbar').children.length > 0);
    await page.waitForFunction(() => !!window.targetPoint);
    await page.waitForTimeout(500); // Allow the wrapped mobile HUD to resize the canvas.
    const { x, y } = await page.evaluate(() => targetPoint);
    await page.touchscreen.tap(x, y);
    assert.equal(await page.locator('#sidebar.open').count(), 0, 'Single tap selects without opening');
    await page.waitForTimeout(80);
    await page.touchscreen.tap(x, y);
    await page.locator('#sidebar.open').waitFor();
    await page.locator('#sidebar .gather-btn').waitFor({ state: 'visible' });
    assert.ok(await page.locator('#sidebar .capture-btn').isVisible(), 'Conquest action is visible');
    await page.locator('#sidebar-toggle').click();
    await page.waitForTimeout(500);
    await page.mouse.dblclick(x, y);
    await page.locator('#sidebar.open').waitFor();
    assert.ok(await page.locator('#sidebar .gather-btn').isVisible(), 'Double click opens actions');
    await page.locator('#sidebar-toggle').click();
    await page.waitForTimeout(500);
    const input = await page.context().newCDPSession(page);
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.equal(await page.locator('#sidebar.open').count(), 0, 'Cancelled touch never opens actions');
    assert.deepEqual(errors, [], 'No browser errors');
    console.log('PASS: mobile double tap, double click, visible gathering/conquest actions, single selection and cancelled touch');
    await page.close();

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    desktop.setDefaultTimeout(8000);
    await desktop.goto(`http://127.0.0.1:${server.address().port}/`);
    await desktop.locator('#btn-new').waitFor();
    await desktop.evaluate(() => {
      window.prematureOpens = 0;
      document.querySelector('#map-canvas').addEventListener('pointerup', e => {
        if (e.pointerType === 'mouse' && document.querySelector('#village-overlay').style.display !== 'none') prematureOpens++;
      });
      const draw = WOH.Sprites.drawVillageMarker;
      WOH.Sprites.drawVillageMarker = (ctx, x, y, size, house, options) => {
        if (options.player) {
          const m = ctx.getTransform(), rect = ctx.canvas.getBoundingClientRect();
          window.castlePoint = {
            x: rect.left + (m.a * x + m.c * y + m.e) * rect.width / ctx.canvas.width,
            y: rect.top + (m.b * x + m.d * y + m.f) * rect.height / ctx.canvas.height
          };
        }
        return draw(ctx, x, y, size, house, options);
      };
    });
    await desktop.locator('#btn-new').click();
    await desktop.waitForFunction(() => !!window.castlePoint);
    await desktop.waitForTimeout(500);
    for (let attempt = 0; attempt < 3; attempt++) {
      const point = await desktop.evaluate(() => castlePoint);
      await desktop.mouse.click(point.x, point.y);
      assert.equal(await desktop.locator('#village-overlay').isVisible(), false, 'Selecting a castle must not open it prematurely');
      await desktop.mouse.dblclick(point.x, point.y, { delay: 100 });
      await desktop.locator('#village-overlay').waitFor({ state: 'visible' });
      await desktop.locator('#overlay-close').click();
    }
    assert.equal(await desktop.evaluate(() => prematureOpens), 0, 'Mouse opening must wait for native dblclick');
    console.log('PASS: desktop double click repeatedly opens an already selected castle without premature opening');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
