// High-quality size copies and actual-size reference page for generated icons.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname,'..');
const {createCanvas,loadImage} = require(require.resolve('@napi-rs/canvas',{paths:[process.argv[2]||root]}));
const icons = [['food','Nahrung'],['wood','Holz'],['stone','Stein'],['iron','Eisen'],['population','Bevölkerung']];
(async function(){
  for(const [key] of icons){
    const image = await loadImage(path.join(root,'art-source/cinematic/ui/resource-'+key+'-source.png'));
    const c=createCanvas(256,256),g=c.getContext('2d');
    g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(image,0,0,256,256);
    fs.writeFileSync(path.join(root,'art-source/cinematic/ui/resource-'+key+'.png'),c.toBuffer('image/png'));
  }
  const manifest={tool:'built-in imagegen',status:'Integrated in Cinematic HUD and all resource-cost canvases',prompt:'resource-prompts.json',
    icons:icons.map(([key,label])=>({key,label,file:'resource-'+key+'.png',source:'resource-'+key+'-source.png',pixels:256}))};
  fs.writeFileSync(path.join(root,'art-source/cinematic/ui/resource-icons.json'),JSON.stringify(manifest,null,2)+'\n');
  const img=(key,size)=>'<img width="'+size+'" height="'+size+'" src="../assets/cinematic/ui/resource-'+key+'.png" alt="'+icons.find(i=>i[0]===key)[1]+'">';
  fs.writeFileSync(path.join(root,'docs/resource-icon-preview.html'),`<!doctype html>
<html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cinematic · Ressourcensymbole</title>
<style>:root{color-scheme:dark}body{margin:0;background:#11191f;color:#deddd4;font:15px/1.55 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:30px 24px}h1{font:30px Georgia;color:#dec995}h2{font-size:17px;color:#dec995}p,small{color:#acbbc0}img{object-fit:contain;vertical-align:middle;flex:none}.hud{display:flex;gap:25px;align-items:center;flex-wrap:wrap;background:#182329;border:1px solid #354247;border-radius:6px;padding:18px}.hud span,.costs span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.hud small{font-size:12px}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:22px 0}.card{padding:18px 12px;text-align:center;background:#1c2528;border:1px solid #465052;border-radius:5px}.sizes{display:flex;align-items:center;justify-content:center;gap:14px;min-height:90px}.size small{display:block;font-size:11px}.costs{display:flex;gap:16px;background:#1c2528;border:1px solid #465052;padding:14px;border-radius:5px;font-size:13px}.labels{font-size:13px;color:#dec995}a{color:#b8d8e8}@media(max-width:700px){.cards{grid-template-columns:repeat(2,1fr)}}</style>
<main><h1>Cinematic · Ressourcensymbole</h1><p>Fünf Symbole für Kopfzeile, Baukosten und Ausbildung. Oben 18 Pixel, in Kostenzeilen 13 Pixel.</p>
<h2>Kopfzeile · 18 px</h2><div class="hud">${icons.map(([key],i)=>'<span>'+img(key,18)+' '+['3.946','2.226','3.063','361','34'][i]+(key==='population'?'<small>/102</small>':'<small>/4.500 · +'+['1.3','3.5','2.0','1.0'][i]+'/s</small>')+'</span>').join('')}</div>
<h2>Symbole · 13 / 18 / 64 px</h2><div class="cards">${icons.map(([key,label])=>'<article class="card"><b>'+label+'</b><div class="sizes">'+[13,18,64].map(size=>'<div class="size">'+img(key,size)+'<small>'+size+' px</small></div>').join('')+'</div></article>').join('')}</div>
<h2>Bau- und Ausbildungskosten · 13 px</h2><div class="costs">${[['wood','260'],['stone','100'],['iron','80'],['food','30'],['wood','160'],['iron','60']].map(([key,value])=>'<span>'+img(key,13)+value+'</span>').join('')}</div>
<p><a href="../index.html">Zum Spiel</a> · <a href="../art-source/cinematic/ui/resource-icons.json">Assets und Generierungsprompts</a></p></main></html>`);
  console.log('Prepared five 256px RGBA resource icons and actual-size reference page.');
})().catch(error=>{console.error(error);process.exitCode=1;});
