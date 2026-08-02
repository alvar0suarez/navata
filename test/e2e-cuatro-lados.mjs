import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.SHOT_DIR || 'test/screenshots';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await (await b.newContext({viewport:{width:412,height:900},deviceScaleFactor:2})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
p.on('dialog', d=>d.accept());
const ok=(n,c,x='')=>{console.log((c?' ok  ':'FAIL ')+n+(x?' — '+x:'')); if(!c)errs.push(n);};

await p.goto((process.env.APP_URL || 'http://127.0.0.1:8899/index.html'),{waitUntil:'networkidle'});
await p.click('[data-view="data"]'); await p.waitForTimeout(300);

const before = await p.evaluate(async()=>JSON.stringify((await import('./assets/js/state.js')).P.cur.boundary));

const S = [16, 40.05, 12.17, 38.05];
for (const [i,id] of ['a','b','c','d'].entries()) await p.fill('#tri-'+id, String(S[i]));
await p.click('#tri-build'); await p.waitForTimeout(600);

ok('ofrece las dos hipótesis', await p.locator('#tri-choice').isVisible());
const info = await p.textContent('#tri-info');
ok('cuantifica la incertidumbre', /difieren en .* m² \(\d+ %\)/.test(info), info.slice(0,190));
const sq = await p.textContent('#tri-opt-sq'), tz = await p.textContent('#tri-opt-tz');
ok('muestra el área de cada una', /m²/.test(sq) && /m²/.test(tz), `escuadra ${sq} · trapecio ${tz}`);
await p.screenshot({path:`${OUT}/14-solo-lados.png`});

// el borde no debe cambiar hasta que se elige una hipótesis
const after = await p.evaluate(async()=>JSON.stringify((await import('./assets/js/state.js')).P.cur.boundary));
ok('no decide por su cuenta', after===before, after===before?'borde intacto':'lo cambió: '+after);

await p.click('[data-assume="trap"]'); await p.waitForTimeout(600);
const st = await p.evaluate(async()=>{
  const {P,stats}=await import('./assets/js/state.js');
  return {n:P.cur.boundary.length, area:stats().area, asum:P.cur.boundaryAssumed};
});
ok('aplica la elegida', st.n===4 && Math.abs(st.area-468.5)<1, st.area.toFixed(1)+' m²');
ok('registra la hipótesis', st.asum==='fondo paralelo', String(st.asum));

// ahora con el dato de la valla
await p.click('[data-view="data"]'); await p.waitForTimeout(300);
await p.evaluate(()=>document.querySelector('#tri-alt').open=true);
await p.fill('#tri-ey','19'); await p.fill('#tri-ex','1');
await p.selectOption('#tri-eside','izq');
await p.click('#tri-build'); await p.waitForTimeout(700);
const st2 = await p.evaluate(async()=>{
  const {P,stats}=await import('./assets/js/state.js');
  return {poly:P.cur.boundary, area:stats().area, asum:P.cur.boundaryAssumed};
});
ok('la valla fija la forma exacta', Math.abs(st2.area-546)<0.5, st2.area.toFixed(1)+' m² (real 546,0)');
ok('anota cómo se determinó', /valla izquierda/.test(st2.asum||''), String(st2.asum));
console.log('     vértices: '+JSON.stringify(st2.poly));

await b.close();
console.log(errs.length?'\nPROBLEMAS:\n - '+errs.join('\n - '):'\nSin errores');
process.exit(errs.length?1:0);
