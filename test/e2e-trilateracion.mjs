import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.SHOT_DIR || 'test/screenshots';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await (await b.newContext({viewport:{width:412,height:870},deviceScaleFactor:2})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
p.on('dialog', d => d.accept());
const ok=(n,c,x='')=>{console.log((c?' ok  ':'FAIL ')+n+(x?' — '+x:'')); if(!c)errs.push(n);};

await p.goto((process.env.APP_URL || 'http://127.0.0.1:8899/index.html'),{waitUntil:'networkidle'});
await p.click('[data-view="data"]'); await p.waitForTimeout(300);

// trapecio irregular con diagonal de control correcta
const V=[[0,0],[16,0],[14,40],[2,38]];
const d=(i,j)=>Math.hypot(V[i][0]-V[j][0],V[i][1]-V[j][1]);
for (const [id,v] of [['a',d(0,1)],['b',d(1,2)],['c',d(2,3)],['d',d(3,0)],['p',d(0,2)],['q',d(1,3)]])
  await p.fill('#tri-'+id, v.toFixed(3));
await p.click('#tri-build'); await p.waitForTimeout(700);

const st = await p.evaluate(async()=>{
  const {P,stats}=await import('./assets/js/state.js');
  return {poly:P.cur.boundary, street:P.cur.streetEdge, area:stats().area};
});
ok('construye el borde', st.poly.length===4, JSON.stringify(st.poly));
ok('área correcta', Math.abs(st.area-546)<0.05, st.area.toFixed(2)+' m²');
ok('marca el lado de la calle', st.street===0, 'lado '+st.street);
await p.click('[data-view="data"]'); await p.waitForTimeout(300);
const info = await p.textContent('#tri-info');
ok('informa del cierre', /consistentes/.test(info), info.slice(0,110));
await p.screenshot({path:`${OUT}/12-trilateracion.png`});

// caso con desajuste
await p.fill('#tri-q', (d(1,3)+0.30).toFixed(3));
await p.click('#tri-build'); await p.waitForTimeout(600);
await p.click('[data-view="data"]'); await p.waitForTimeout(300);
const w = await p.textContent('#tri-info');
ok('avisa del desajuste', /⚠/.test(w) && /2[0-9],[0-9] cm|30,0 cm/.test(w), w.slice(0,140));

// medida imposible
await p.fill('#tri-p','90');
await p.click('#tri-build'); await p.waitForTimeout(500);
const e = await p.textContent('#tri-info');
ok('rechaza medidas imposibles', /no cierra/.test(e), e.slice(0,90));

// el borde no debe haber cambiado tras el rechazo
const st2 = await p.evaluate(async()=>(await import('./assets/js/state.js')).P.cur.boundary.length);
ok('no toca el borde si falla', st2===4, st2+' vértices');

// malla sobre la parcela irregular
await p.click('[data-view="points"]'); await p.waitForTimeout(200);
await p.fill('#g-dx','4'); await p.fill('#g-dy','4');
await p.click('#g-make'); await p.waitForTimeout(600);
const n = await p.evaluate(async()=>(await import('./assets/js/state.js')).P.cur.pending.length);
ok('genera malla dentro del borde irregular', n>30 && n<70, n+' estaciones');
await p.click('[data-view="map"]'); await p.waitForTimeout(500);
await p.screenshot({path:`${OUT}/13-malla-irregular.png`});

await b.close();
console.log(errs.length?'\nPROBLEMAS:\n - '+errs.join('\n - '):'\nSin errores');
process.exit(errs.length?1:0);
