// Usage: node tools/test-new-world.cjs <path to node_modules>
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
    for (const fallback of [false, true]) {
      for (const result of ['defeat', 'victory']) {
        const page = await browser.newPage({ serviceWorkers: 'block' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (fallback) await page.addInitScript(() => { delete window.indexedDB; });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.locator('#btn-new').waitFor();
        // Capture the actual game state while keeping the real bootstrap and UI.
        await page.evaluate(() => {
          const original = WOH.Game.newGame;
          WOH.Game.newGame = (...args) => (window.testState = original(...args));
        });
        await page.locator('#btn-new').click();
        await page.waitForFunction(() => document.querySelector('#topbar').children.length > 0);
        // Ordinary tab hiding still saves an active game.
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(async () => !!(await WOH.Persistence.load()));
        await page.reload();
        await page.locator('#btn-continue').waitFor();
        await page.evaluate(() => {
          const bind = WOH.UI.bind;
          WOH.UI.bind = state => { window.testState = state; return bind(state); };
        });
        await page.locator('#btn-continue').click();
        await page.waitForFunction(() => document.querySelector('#topbar').children.length > 0);
        // Finish the resumed state, so unload saves the same result.
        await page.evaluate(async result => {
          testState.gameOver = result;
          await WOH.Persistence.save(testState);
        }, result);
        await page.reload();
        await page.locator('#btn-new').waitFor();
        assert.equal(await page.locator('#btn-continue').count(), 0, 'Finished saves cannot be continued');
        // Begin another game and end it while its lifecycle saving is installed.
        await page.evaluate(() => {
          const original = WOH.Game.newGame;
          WOH.Game.newGame = (...args) => (window.testState = original(...args));
        });
        await page.locator('#btn-new').click();
        await page.waitForFunction(() => document.querySelector('#topbar').children.length > 0);
        await page.evaluate(async result => {
          testState.gameOver = result;
          await WOH.Persistence.save(testState);
          // Force unload + tab-hide events while deletion is still pending.
          const clear = WOH.Persistence.clear;
          WOH.Persistence.clear = async () => {
            await clear();
            window.dispatchEvent(new Event('beforeunload'));
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
            await new Promise(resolve => setTimeout(resolve, 100));
          };
        }, result);
        await page.locator('#end-new').click();
        await page.locator('#btn-new').waitFor();
        assert.equal(await page.locator('#btn-continue').count(), 0, 'New world must not restore the finished save');
        assert.equal(await page.evaluate(() => WOH.Persistence.load()), null, 'Save stays deleted after reload');
        await page.locator('#btn-new').click();
        await page.waitForFunction(() => document.querySelector('#topbar').children.length > 0);
        assert.equal(await page.locator('#end-screen').count(), 0, 'Fresh world has no end screen');
        assert.deepEqual(errors, []);
        console.log(`PASS: ${result}, ${fallback ? 'localStorage' : 'IndexedDB'} — active resume, finished menu, lifecycle deletion race, fresh world`);
        await page.close();
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
