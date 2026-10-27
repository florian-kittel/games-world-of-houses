// Usage: node tools/test-mobile-layout.cjs <path to node_modules> [screenshot path]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(path.join(process.argv[2], 'playwright'));
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
  const target = file === root ? path.join(root, 'index.html') : file;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  fs.readFile(target, (error, data) => {
    res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
    res.end(error ? '' : data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const viewport of [{ width: 390, height: 700 }, { width: 428, height: 780 }, { width: 844, height: 390 }, { width: 768, height: 1024 }]) {
      const page = await browser.newPage({ viewport, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('#btn-new').click();
      await page.getByRole('button', { name: '⌂ Burg verwalten', exact: true }).click();
      const inspect = () => page.evaluate(() => {
        const body = document.querySelector('#village-body');
        const grid = document.querySelector('.bld-area .bld-grid');
        const area = grid.parentElement;
        const rect = document.querySelector('#village-overlay .overlay-card').getBoundingClientRect();
        return { bodyWidth: body.clientWidth, scrollWidth: body.scrollWidth, gridWidth: grid.getBoundingClientRect().width,
          areaWidth: area.getBoundingClientRect().width, top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight };
      });
      const initial = await inspect();
      if (process.argv[3] && viewport.width === 390) await page.screenshot({ path: process.argv[3] });
      assert.ok(Math.abs(initial.gridWidth - initial.areaWidth) < 1, JSON.stringify(initial));
      assert.ok(initial.scrollWidth <= initial.bodyWidth + 1, 'No horizontal scrolling of the dialog');
      assert.ok(initial.top >= -1 && initial.bottom <= initial.viewportHeight + 1, 'Dialog fits visible viewport: ' + JSON.stringify(initial));
      await page.locator('#village-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(1200); // Include periodic game-panel refreshes.
      const bottom = await page.locator('#village-body').evaluate(el => {
        const card = el.querySelector('.bld-card:last-child').getBoundingClientRect();
        return { scroll: el.scrollTop, cardBottom: card.bottom, bodyBottom: el.getBoundingClientRect().bottom };
      });
      assert.ok(bottom.scroll > 0, 'Long menu scrolls');
      assert.ok(bottom.cardBottom <= bottom.bodyBottom + 1, 'Final building remains reachable after refresh');
      assert.equal((await inspect()).top, initial.top, 'Dialog header does not move with scrolling');
      if (viewport.width < 600) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height - 100 });
        const resized = await inspect();
        assert.ok(resized.bottom <= resized.viewportHeight + 1, 'Dialog adapts to smaller visible viewport');
      }
      console.log('PASS: mobile castle layout, scrolling and refresh at', viewport);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
