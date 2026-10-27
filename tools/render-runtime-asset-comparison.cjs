// Compare original and runtime exports at maximum in-game physical pixel size.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const { createCanvas, loadImage } = require(require.resolve('@napi-rs/canvas', { paths: [process.argv[2] || root] }));
const report = JSON.parse(fs.readFileSync(path.join(root, 'docs/runtime-assets.json')));
const examples = [['castle-03', 391], ['farmstead-03', 301], ['forest-01', 346], ['rock-ore-01', 375]];
(async () => {
  const c = createCanvas(960, 1680), g = c.getContext('2d');
  g.fillStyle = '#19231a'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#eee'; g.font = '20px sans-serif';
  g.fillText('Original at max zoom / DPR 2', 24, 30);
  g.fillText('512px export at max zoom / DPR 2', 495, 30);
  for (let row = 0; row < examples.length; row++) {
    const [id, width] = examples[row];
    const entry = report.entries.find(e => e.file.endsWith('/' + id + '.png'));
    for (let col = 0; col < 2; col++) {
      const image = await loadImage(path.join(root, col ? entry.file : entry.source));
      const x = col * 480, y = 50 + row * 405;
      g.fillStyle = '#525d3c'; g.fillRect(x + 10, y, 460, 395);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(image, x + (480 - width) / 2, y + 24, width, width * image.height / image.width);
      g.fillStyle = '#eee'; g.font = '17px sans-serif'; g.fillText(id, x + 24, y + 382);
    }
  }
  const output = path.join(root, 'docs/previews/runtime-assets-comparison.png');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, c.toBuffer('image/png'));
  console.log(output);
})().catch(error => { console.error(error); process.exitCode = 1; });
