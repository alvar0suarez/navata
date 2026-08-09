import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.SHOT_DIR || 'test/screenshots';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await (await b.newContext({viewport:{width:412,height:900},deviceScaleFactor:2})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
const ok=(n,c,x='')=>{console.log((c?' ok  ':'FAIL ')+n+(x?' — '+x:'')); if(!c)errs.push(n);};

// primera apertura, sin nada guardado
await p.goto((process.env.APP_URL || 'http://127.0.0.1:8899/index.html'),{waitUntil:'networkidle'});
await p.waitForTimeout(800);

// La app abre por donde se trabaja, no en el mapa
ok('abre en la pantalla de medir', await p.locator('#view-points').isVisible(),
   await p.locator('.view.active').getAttribute('id'));
ok('el botón principal invita a empezar', /Preparar y medir|Empezar a medir/.test(await p.textContent('#hero-go-title')),
   (await p.textContent('#hero-go-title')).trim());
const st = await p.evaluate(async()=>{
  const {P,stats}=await import('./assets/js/state.js');
  return {poly:P.cur.boundary, street:P.cur.streetEdge, ...stats()};
});
ok('borde ya creado', st.poly.length===4, JSON.stringify(st.poly));
ok('superficie 465 m²', Math.abs(st.area-465)<0.01, st.area.toFixed(2)+' m²');
ok('perímetro 91 m', Math.abs(st.perim-91)<0.01, st.perim.toFixed(2)+' m');
ok('la calle es el frente', st.street===0);
console.log('     '+await p.textContent('#project-sub'));
await p.screenshot({path:`${OUT}/15-parcela-real.png`});

// malla
await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
 await p.waitForTimeout(300);
await p.click('#g-make'); await p.waitForTimeout(600);
await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
 await p.waitForTimeout(200);
console.log('     '+await p.textContent('#g-info'));
const n = await p.evaluate(async()=>(await import('./assets/js/state.js')).P.cur.pending.length);
ok('malla generada', n>=40 && n<=48, n+' estaciones');

// las 4 esquinas primero
const first = await p.evaluate(async()=>(await import('./assets/js/state.js')).P.cur.pending.slice(0,5).map(q=>q.label+'('+q.x+','+q.y+')'));
ok('las esquinas van primero', first.slice(0,4).every(l=>l.startsWith('E')), first.join(' '));

await p.click('[data-view="map"]'); await p.waitForTimeout(500);
await p.screenshot({path:`${OUT}/16-malla-real.png`});

// persiste al recargar
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(700);
const st2 = await p.evaluate(async()=>{
  const {P,stats}=await import('./assets/js/state.js');
  return {n:P.cur.boundary.length, area:stats().area, pend:P.cur.pending.length};
});
ok('persiste tras recargar', st2.n===4 && Math.abs(st2.area-465)<0.01 && st2.pend>=40,
   `${st2.area.toFixed(1)} m², ${st2.pend} pendientes`);

await b.close();
console.log(errs.length?'\nPROBLEMAS:\n - '+errs.join('\n - '):'\nSin errores');
process.exit(errs.length?1:0);
