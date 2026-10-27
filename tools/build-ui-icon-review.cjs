// Review-only thumbnails; semantic artwork is generated with built-in imagegen.
// Usage: node tools/build-ui-icon-review.cjs <bundled node_modules>
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { createCanvas, loadImage } = require(require.resolve('@napi-rs/canvas', { paths: [process.argv[2] || root] }));
const icons = [
  ['woodcutter-close-v3','Holzfäller','activity','Axt und Holz, enger Ausschnitt'],
  ['quarry-close-v3','Steinbruch','activity','Hammer, Meißel und Kalkstein'],
  ['ironmine-right-angle-v5','Eisenmine','activity','Kopf und Stiel im rechten Winkel'],
  ['warehouse-building-v3','Lager','building','Referenz für Richtung und Perspektive'],
  ['farm-aligned-v4','Bauernhof','building','Hofgebäude mit Reetdach'],
  ['townhall-building-v3','Halle','building','Eingang der Burghalle'],
  ['barracks-aligned-v4','Kaserne','building','Unterkunft mit militärischen Merkmalen'],
  ['range-aligned-v4','Schießplatz','building','Überdachter Schießstand mit Zielscheibe'],
  ['wall-aligned-v4','Palisade','building','Abschnitt der Holzbefestigung'],
  ['tower-aligned-v4','Wachturm','building','Zinnen und Ausguck']
];
(async function () {
  for (const [id] of icons) {
    const img = await loadImage(path.join(root,'art-source/cinematic/ui',id+'-source.png'));
    const c = createCanvas(256,256), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img,0,0,256,256);
    fs.writeFileSync(path.join(root,'art-source/cinematic/ui',id+'.png'),c.toBuffer('image/png'));
  }
  const manifest = { status: 'Approved and integrated into Cinematic construction menu', tool: 'built-in imagegen',
    displayPixels: 40, cameraReference: 'warehouse-building-v3',
    camera: 'Front facade on right, left wall receding left, slightly upward view',
    prompts: ['construction-v3-prompts.json','construction-v4-corrections.json','building-alignment-v4-prompts.json','ironmine-right-angle-v5-prompt.json'],
    icons: icons.map(([id,label,kind,note]) => ({id,label,kind,note,file:id+'.png',source:id+'-source.png'})) };
  fs.writeFileSync(path.join(root,'art-source/cinematic/ui/construction-review.json'),JSON.stringify(manifest,null,2)+'\n');
  const cards = kind => icons.filter(row=>row[2]===kind).map(([id,label,_,note])=>
    `<article${id===manifest.cameraReference?' class="reference"':''}><img class="icon" width="40" height="40" src="../assets/cinematic/ui/${id}.png" alt="${label}"><div><b>${label}</b><small>${note}</small></div></article>`).join('\n');
  let html = fs.readFileSync(path.join(root,'docs/construction-icon-pilot.html'),'utf8');
  html = html.replace(/Entwurf [34]/g,'Entwurf 5');
  html = html.replace(/<h2>Tätigkeiten[\s\S]*?<h2>Vorher \/ neuer Ausschnitt/,
    '<h2>Tätigkeiten · enger Ausschnitt</h2><div class="cards">'+cards('activity')+'</div>\n'+
    '<h2>Gebäude · Perspektive wie beim Lager</h2><div class="cards">'+cards('building')+'</div>\n<h2>Vorher / neuer Ausschnitt');
  html = html.replace(/ironmine-(?:close-v3|corrected-v4)\.png/g,'ironmine-right-angle-v5.png');
  html = html.replace('Nähere Werkzeugdetails und typgerechte Gebäudeansichten in gedeckten Farben.',
    'Das Lager ist die feste Perspektivreferenz: Hauptfassade rechts, Seitenwand nach links zurücklaufend. Dazu nähere Werkzeugdetails und ein korrigierter Spitzhackenschaft.');
  if (!html.includes('article.reference{')) html = html.replace('article{','article.reference{border-color:#a68c57}article{');
  html = html.replace('href="../art-source/cinematic/ui/construction-v3-prompts.json"','href="../art-source/cinematic/ui/construction-review.json"');
  html = html.replace('Entwürfe zur Stilbeurteilung. Noch nicht im Spiel eingebunden.','Freigegeben und im Cinematic-Baumenü eingebunden.');
  fs.writeFileSync(path.join(root,'docs/construction-icon-pilot.html'),html);
  console.log('Prepared '+icons.length+' approved RGBA construction icons.');
})().catch(error=>{console.error(error);process.exitCode=1;});
