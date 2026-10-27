// Verify deployment inventory, source integrity and supported render resolution.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const report = JSON.parse(fs.readFileSync(path.join(root, 'docs/runtime-assets.json')));
const worker = { self: { addEventListener() {} } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), worker);
const exportedFiles = new Set(report.entries.map(e => e.file));
assert.equal(exportedFiles.size, 52);
for (const e of report.entries) {
  const source = fs.readFileSync(path.join(root, e.source));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), e.sourceSha256, 'Source integrity: ' + e.source);
  const output = fs.readFileSync(path.join(root, e.file));
  assert.equal(output.length, e.bytes);
  assert.equal(output.readUInt32BE(16), e.width);
  assert.equal(output.readUInt32BE(20), e.height);
  assert.ok(worker.ASSETS.includes('./' + e.file), 'Offline export: ' + e.file);
  if (e.file.includes('/map/')) {
    const ground = /\/(grass|field|water)-/.test(e.file);
    assert.equal(e.width, ground ? 768 : 512);
    if (!ground) assert.equal(output[25], 6, 'Preserve alpha');
    const scale = e.file.includes('/castle-') ? 1.1 * 1.85 :
      /\/(forest|rock)-/.test(e.file) ? (e.file.includes('/forest-') ? 1.8 : 1.95) : .95 * 1.65;
    assert.ok(e.width >= 32 * scale * 3 * 2, 'Enough pixels at max zoom and DPR');
  }
}
function walk(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(folder, e.name)) : [path.relative(root, path.join(folder, e.name)).replaceAll('\\', '/')]);
}
for (const file of walk(path.join(root, 'assets/cinematic'))) assert.ok(exportedFiles.has(file), 'No source/study/metadata in runtime directory: ' + file);
for (const url of worker.ASSETS) {
  assert.ok(!url.includes('art-source/'), 'Never precache originals');
  assert.ok(fs.existsSync(path.join(root, url.split('?')[0])), 'Existing offline URL: ' + url);
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [, url] of html.matchAll(/(?:src|href)="((?:js|css)\/[^\"]+)"/g))
  assert.ok(worker.ASSETS.includes('./' + url), 'Exact revision cached: ' + url);
assert.ok(report.bytes < report.sourceBytes * .3, 'Substantial download reduction');
console.log('PASS: 52 bounded runtime images, intact sources, max-zoom resolution, alpha, complete offline inventory and no source files in runtime folder.');
