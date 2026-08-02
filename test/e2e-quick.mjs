import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.SHOT_DIR || 'test/screenshots';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport:{width:412,height:870}, deviceScaleFactor:2 });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
const ok=(n,c,x='')=>console.log((c?' ok  ':'FAIL ')+n+(x?' — '+x:''))||(c?0:errs.push(n));

await p.goto((process.env.APP_URL || 'http://127.0.0.1:8899/index.html'),{waitUntil:'networkidle'});
p.on('dialog', d => d.accept());

// parcela de prueba + malla
await p.click('[data-view="data"]'); await p.waitForTimeout(300);
await p.fill('#d-w','15.92'); await p.fill('#d-h','44');
await p.click('#d-rect'); await p.waitForTimeout(600);
await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});

await p.fill('#g-dx','4'); await p.fill('#g-dy','4');
await p.click('#g-make'); await p.waitForTimeout(500);
const pend = await p.evaluate(async()=>(await import('./assets/js/state.js')).P.cur.pending.length);
ok('malla generada cubre el borde', pend===60, pend+' estaciones');

await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});

await p.click('#hero-go'); await p.waitForTimeout(400);
ok('abre modo rápido', await p.locator('#quick').isVisible());
console.log('     estación: '+await p.textContent('#q-station')+' · '+await p.textContent('#q-xy'));

// esta suite comprueba el método de la manguera
await p.click('#q-mode'); await p.waitForTimeout(300);
await p.click('[data-modo="manguera"]'); await p.waitForTimeout(250);
await p.click('#cfg-ok'); await p.waitForTimeout(250);
ok('modo manguera seleccionado', (await p.textContent('#q-mode'))==='Manguera');

// L_ref por defecto 100 cm; lectura 137,5 → Z = -0,375
for (const k of ['1','3','7',',','5']) await p.click(`[data-k="${k}"]`);
await p.waitForTimeout(150);
const z1 = await p.textContent('#q-result');
ok('cálculo desde la manguera', z1==='−0,375', `lectura 137,5 cm → ${z1} m`);
await p.screenshot({path:`${OUT}/10-rapido.png`});

await p.click('#q-save'); await p.waitForTimeout(300);
const st2 = await p.evaluate(async()=>{
  const {P}=await import('./assets/js/state.js');
  return {n:P.cur.points.length, z:P.cur.points[0].z, lbl:P.cur.points[0].label,
          pend:P.cur.pending.length, next:P.cur.pending[0].label};
});
ok('guarda y avanza', st2.n===1 && Math.abs(st2.z+0.375)<1e-9 && st2.pend===pend-1,
   `${st2.lbl} z=${st2.z} · siguiente ${st2.next}`);
ok('el buffer se limpia', (await p.textContent('#q-buffer'))==='—');

// saltar
const before = await p.textContent('#q-station');
await p.click('#q-skip'); await p.waitForTimeout(250);
const after = await p.textContent('#q-station');
ok('saltar estación', before!==after, `${before} → ${after}`);

// deshacer (deshace la cota guardada, no el salto)
await p.click('#q-undo'); await p.waitForTimeout(300);
const st3 = await p.evaluate(async()=>{
  const {P}=await import('./assets/js/state.js');
  return {n:P.cur.points.length, pend:P.cur.pending.length};
});
ok('deshacer', st3.n===0 && st3.pend===pend, `${st3.n} cotas, ${st3.pend} pendientes`);

// modo cota directa
await p.click('#q-mode'); await p.waitForTimeout(300);
await p.click('[data-modo="z"]'); await p.waitForTimeout(250);
await p.click('#cfg-ok'); await p.waitForTimeout(250);
ok('cambia a cota directa', (await p.textContent('#q-mode'))==='Cota Z');
await p.click('[data-k="0"]'); await p.click('[data-k=","]'); await p.click('[data-k="4"]');
await p.click('#q-sign'); await p.waitForTimeout(200);
ok('signo negativo', (await p.textContent('#q-result'))==='−0,400', await p.textContent('#q-result'));
await p.click('#q-save'); await p.waitForTimeout(300);

// tipo quiebre
await p.click('#q-break');
await p.click('[data-k="1"]'); await p.click('[data-k="2"]');
await p.click('#q-save'); await p.waitForTimeout(300);
const types = await p.evaluate(async()=>(await import('./assets/js/state.js')).P.cur.points.map(q=>q.type));
ok('marca punto de quiebre', types.includes('break'), types.join(','));

// teclado físico
await p.keyboard.type('55'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
const n4 = await p.evaluate(async()=>(await import('./assets/js/state.js')).P.cur.points.length);
ok('teclado físico', n4===3, n4+' cotas');

// cerrar y comprobar que el mapa refleja las cotas
await p.click('#q-close'); await p.waitForTimeout(400);
ok('cierra el modo', await p.locator('#quick').isHidden());
await p.click('[data-view="map"]'); await p.waitForTimeout(500);
await p.click('[data-layer="hypso"]'); await p.waitForTimeout(500);
await p.screenshot({path:`${OUT}/11-tras-rapido.png`});

await b.close();
console.log(errs.length?'\nPROBLEMAS:\n - '+errs.join('\n - '):'\nSin errores');
process.exit(errs.length?1:0);
