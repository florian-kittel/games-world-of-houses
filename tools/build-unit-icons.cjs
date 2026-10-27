// Prepare portrait copies without stretching the generated faces or weapons.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {createCanvas,loadImage}=require(require.resolve('@napi-rs/canvas',{paths:[process.argv[2]||root]}));
const units=[['spear','Speerträger'],['sword','Schwertkämpfer'],['axe','Axtkämpfer'],['archer','Bogenschütze'],['hero','Held']];
(async function(){
  for(const [key] of units){
    const img=await loadImage(path.join(root,'art-source/cinematic/ui/unit-'+key+'-source.png'));
    const c=createCanvas(256,308),g=c.getContext('2d'),scale=Math.min(256/img.width,308/img.height);
    g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
    g.drawImage(img,(256-img.width*scale)/2,(308-img.height*scale)/2,img.width*scale,img.height*scale);
    fs.writeFileSync(path.join(root,'art-source/cinematic/ui/unit-'+key+'.png'),c.toBuffer('image/png'));
  }
  fs.writeFileSync(path.join(root,'art-source/cinematic/ui/unit-icons.json'),JSON.stringify({tool:'built-in imagegen',
    status:'Integrated in Cinematic unit canvases',prompt:'unit-prompts.json',displaySizes:[[48,58],[36,45],[33,42]],
    icons:units.map(([key,label])=>({key,label,file:'unit-'+key+'.png',source:'unit-'+key+'-source.png',width:256,height:308}))},null,2)+'\n');
  const img=(key,w,h)=>'<img width="'+w+'" height="'+h+'" src="../assets/cinematic/ui/unit-'+key+'.png" alt="'+units.find(u=>u[0]===key)[1]+'">';
  fs.writeFileSync(path.join(root,'docs/unit-icon-preview.html'),`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cinematic · Einheitenbilder</title>
<style>:root{color-scheme:dark}body{margin:0;background:#11191f;color:#deddd4;font:15px/1.55 system-ui,sans-serif}main{max-width:1020px;margin:auto;padding:30px 24px}h1{font:30px Georgia;color:#dec995}h2{font-size:17px;color:#dec995}p,small{color:#acbbc0}img{object-fit:contain;vertical-align:middle;background:#0e171f;border-radius:3px;flex:none}.row{display:flex;gap:10px;align-items:center;padding:10px;background:#1c2931;border-bottom:1px solid #34414a}.row:nth-child(3){background:#29252a}.row:last-child{background:#303329}.row small{display:block;font-size:12px}.soldiers{max-width:430px;border:1px solid #354247}.cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.card{padding:14px 8px;text-align:center;border:1px solid #465052;border-radius:5px;background:#1c2528}.card b{font-size:13px}.sizes{display:flex;align-items:flex-end;justify-content:center;gap:10px;margin:18px 0 6px}.sizes small{display:block;font-size:11px;margin-top:5px}.note{border-left:3px solid #a68c57;padding-left:14px}a{color:#b8d8e8}@media(max-width:800px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>
<main><h1>Cinematic · Einheitenbilder</h1><p>Kopf und Waffe im engen Ausschnitt. Einheitliche Blickrichtung und gedeckte Materialien, mit unterschiedlichen Helmen, Kleidung und Waffensilhouetten.</p>
<h2>Ausbildung · 48 × 58 px</h2><div class="soldiers">${units.map(([key,label])=>'<div class="row">'+img(key,48,58)+'<div><b>'+label+'</b><small>'+({spear:'Offener Helm · Speer',sword:'Geschlossener Helm · Schwert',axe:'Unbedeckter Kopf · Axt',archer:'Kapuze · Bogen und Pfeil',hero:'Stirnreif · Plattenrüstung und Schwert'}[key])+'</small></div></div>').join('')}</div>
<h2>Garnison / Ausbildung / Details</h2><div class="cards">${units.map(([key,label])=>'<article class="card"><b>'+label+'</b><div class="sizes">'+[[33,42],[48,58],[64,77]].map(([w,h])=>'<div>'+img(key,w,h)+'<small>'+w+' × '+h+'</small></div>').join('')+'</div></article>').join('')}</div>
<p class="note">Im Cinematic-Modus in Ausbildung, Versand, Garnison und Kampfberichten eingebunden.</p><p><a href="../index.html">Zum Spiel</a> · <a href="../art-source/cinematic/ui/unit-icons.json">Assets und imagegen-Prompts</a></p></main></html>`);
  console.log('Prepared five 256×308 RGBA unit portraits and actual-size reference page.');
})().catch(error=>{console.error(error);process.exitCode=1;});
