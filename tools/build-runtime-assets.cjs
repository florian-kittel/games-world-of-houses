// Usage: node tools/build-runtime-assets.cjs <bundled node_modules>
// Originals are never overwritten. Only approved runtime images are exported.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { createCanvas, loadImage } = require(require.resolve('@napi-rs/canvas', { paths: [process.argv[2] || root] }));
const context = { window: { WOH: {} } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/cinematic-v2.js'), 'utf8'), context);
const jobs = Object.keys(context.window.WOH.Cinematic.assets).map(key => {
  const id = key.slice(5), ground = /^(grass|field|water)-/.test(id);
  return { source: `art-source/cinematic/v2/${ground ? '' : 'topdown/'}${id}.png`,
    file: `assets/cinematic/map/${id}.png`, width: ground ? 768 : 512 };
});
const ui = ['townhall-building-v3','woodcutter-close-v3','quarry-close-v3','ironmine-right-angle-v5',
  'farm-aligned-v4','warehouse-building-v3','barracks-aligned-v4','range-aligned-v4','wall-aligned-v4','tower-aligned-v4',
  ...['food','wood','stone','iron','population'].map(id => 'resource-' + id),
  ...['spear','sword','axe','archer','hero'].map(id => 'unit-' + id)];
ui.forEach(id => jobs.push({ source: `art-source/cinematic/ui/${id}.png`, file: `assets/cinematic/ui/${id}.png` }));
(async () => {
  const entries = [];
  for (const job of jobs) {
    const source = fs.readFileSync(path.join(root, job.source));
    const image = await loadImage(path.join(root, job.source));
    const width = job.width || image.width, height = Math.round(image.height * width / image.width);
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    const output = canvas.toBuffer('image/png');
    fs.mkdirSync(path.dirname(path.join(root, job.file)), { recursive: true });
    fs.writeFileSync(path.join(root, job.file), output);
    entries.push({ ...job, width, height, sourceBytes: source.length, bytes: output.length,
      sourceSha256: crypto.createHash('sha256').update(source).digest('hex') });
  }
  const report = { format: 'PNG, lossless encoding after high-quality resizing',
    maximumZoom: 3, maximumPixelRatio: 2, entries,
    sourceBytes: entries.reduce((n, e) => n + e.sourceBytes, 0), bytes: entries.reduce((n, e) => n + e.bytes, 0) };
  fs.writeFileSync(path.join(root, 'docs/runtime-assets.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${entries.length} images: ${(report.sourceBytes / 1e6).toFixed(2)} MB -> ${(report.bytes / 1e6).toFixed(2)} MB`);
})().catch(error => { console.error(error); process.exitCode = 1; });
