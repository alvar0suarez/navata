// Recorrido completo del método de la cuerda nivelada:
// líneas a lo largo cada 3 m, puntos cada 5 m, y la caída medida con la cinta.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.SHOT_DIR || 'test/screenshots';
mkdirSync(OUT, { recursive: true });
const BASE = (process.env.APP_URL || 'http://127.0.0.1:8899/index.html').replace(/[^/]*$/,'');

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await (await b.newContext({viewport:{width:412,height:900},deviceScaleFactor:2})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
const ok=(n,c,x='')=>{console.log((c?' ok  ':'FAIL ')+n+(x?' — '+x:'')); if(!c)errs.push(n);};
const state = () => p.evaluate(async()=>{
  const {P}=await import('./assets/js/state.js');
  return {pts:P.cur.points, pend:P.cur.pending, s:P.cur.settings};
});

await p.goto(BASE+'index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(600);

// ── malla 3 × 5 recorrida a lo largo ──
await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
 await p.waitForTimeout(300);
ok('paso por defecto 3 × 5',
   await p.inputValue('#g-dx')==='3' && await p.inputValue('#g-dy')==='5',
   `${await p.inputValue('#g-dx')} × ${await p.inputValue('#g-dy')}`);
ok('recorrido por líneas a lo largo', await p.inputValue('#g-order')==='cols');

await p.click('#g-make'); await p.waitForTimeout(700);
await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
 await p.waitForTimeout(200);
let st = await state();
const malla = st.pend.filter(q=>q.label.startsWith('M'));
ok('genera 42 estaciones', st.pend.length===42, st.pend.length+' ('+malla.length+' de malla + esquinas)');

const xs=[...new Set(malla.map(q=>q.x))].sort((a,b)=>a-b);
const ys=[...new Set(malla.map(q=>q.y))].sort((a,b)=>a-b);
ok('6 líneas de cuerda', xs.length===6, 'X = '+xs.join(', '));
ok('la última línea llega al borde', xs[xs.length-1]===15.5, String(xs[xs.length-1]));
ok('7 puntos por línea', ys.length===7, 'Y = '+ys.join(', '));
ok('la última fila llega al fondo', ys[ys.length-1]===30, String(ys[ys.length-1]));

// cada línea se recorre entera antes de pasar a la siguiente
const secuencia = malla.map(q=>q.x);
let saltos=0;
for(let i=1;i<secuencia.length;i++) if(secuencia[i]!==secuencia[i-1]) saltos++;
ok('cada línea se recorre entera', saltos===5, saltos+' cambios de línea en '+malla.length+' estaciones');

// y en serpiente: la línea 1 de menor a mayor Y, la 2 al revés
const l0=malla.filter(q=>q.x===xs[0]).map(q=>q.y);
const l1=malla.filter(q=>q.x===xs[1]).map(q=>q.y);
ok('serpiente entre líneas', l0[0]<l0[l0.length-1] && l1[0]>l1[l1.length-1],
   `L1 ${l0[0]}→${l0[l0.length-1]} · L2 ${l1[0]}→${l1[l1.length-1]}`);

await p.click('[data-view="map"]'); await p.waitForTimeout(500);
await p.screenshot({path:`${OUT}/19-malla-cuerda.png`});

// ── medir con la cuerda ──
await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
 await p.waitForTimeout(200);
await p.click('#hero-go'); await p.waitForTimeout(500);
ok('arranca en modo cuerda', (await p.textContent('#q-mode'))==='Cuerda', await p.textContent('#q-mode'));
ok('pide la caída', /caída/.test(await p.textContent('#q-unit')), await p.textContent('#q-unit'));

// cuerda a 1,000 m; caída de 137,5 cm → Z = 1,000 − 1,375 = −0,375
for (const k of ['1','3','7',',','5']) await p.click(`[data-k="${k}"]`);
await p.waitForTimeout(150);
ok('Z = altura de cuerda − caída', (await p.textContent('#q-result'))==='−0,375',
   'cuerda 1,000 m, caída 137,5 cm → '+await p.textContent('#q-result'));
await p.screenshot({path:`${OUT}/20-modo-cuerda.png`});
await p.click('#q-save'); await p.waitForTimeout(300);

// ── el panel de ajustes y la calculadora de altura de cuerda ──
await p.click('#q-ref'); await p.waitForTimeout(350);
ok('abre el panel de ajustes', await p.locator('#q-cfg').isVisible());
await p.fill('#cfg-zbase','-0.375'); await p.fill('#cfg-sobre','120');
await p.waitForTimeout(200);
ok('calcula la altura desde un punto conocido',
   /\+0,825/.test(await p.textContent('#cfg-calc')), await p.textContent('#cfg-calc'));
await p.click('#cfg-usar'); await p.waitForTimeout(300);
st = await state();
ok('aplica la altura calculada', Math.abs(st.s.alturaCuerda-0.825)<1e-9, String(st.s.alturaCuerda));
await p.screenshot({path:`${OUT}/21-ajustes-cuerda.png`});
await p.click('#cfg-ok'); await p.waitForTimeout(250);

// con la nueva altura: caída 100 cm → Z = 0,825 − 1,000 = −0,175
for (const k of ['1','0','0']) await p.click(`[data-k="${k}"]`);
await p.waitForTimeout(150);
ok('usa la altura nueva', (await p.textContent('#q-result'))==='−0,175', await p.textContent('#q-result'));
await p.click('#q-save'); await p.waitForTimeout(300);

// ── aviso al cambiar de tendido ──
// se salta hasta agotar la primera línea y comprobar que avisa
let avisos=0;
for (let i=0;i<12;i++){
  const vis = await p.locator('#q-newline').isVisible();
  if (vis) { avisos++; break; }
  await p.click('[data-k="5"]'); await p.click('[data-k="0"]');
  await p.click('#q-save'); await p.waitForTimeout(120);
}
ok('avisa al empezar un tendido nuevo', avisos===1,
   avisos? await p.textContent('#q-newline-txt') : 'no avisó en 12 estaciones');
await p.screenshot({path:`${OUT}/22-aviso-linea.png`});

// ── corrección de la flecha de la cuerda ──
// Con cuerda a 1,000 m, flecha 8 cm y caída 100 cm:
//   centro del tendido (t=0,5) → flecha local 8 cm → Z = 1,000 − 0,080 − 1,000 = −0,080
//   apoyo (t=0)                → flecha local 0    → Z = 1,000 − 0      − 1,000 =  0,000
await p.click('#q-ref'); await p.waitForTimeout(300);
await p.fill('#cfg-altura','1');
await p.fill('#cfg-flecha','8'); await p.waitForTimeout(200);
await p.click('#cfg-ok'); await p.waitForTimeout(250);

const zEn = async (d,L) => {
  await p.evaluate(({d,L})=>{
    const q = window.__nvPending || null;
  }, {d,L});
  return null;
};
// coloca a mano una estación en el centro del tendido y otra en el apoyo
const probar = async (d,L,teclas) => {
  await p.evaluate(({d,L})=>import('./assets/js/state.js').then(({P,touch})=>{
    P.cur.pending[0] = {...P.cur.pending[0], d, L}; touch(false);
  }), {d,L});
  for (const k of teclas) await p.click(`[data-k="${k}"]`);
  await p.waitForTimeout(200);
  const z = await p.textContent('#q-result');
  for (let i=0;i<teclas.length;i++) await p.click('[data-k="del"]');
  await p.waitForTimeout(150);
  return z;
};
ok('flecha máxima en el centro', await probar(16,32,['1','0','0'])==='−0,080',
   'd=16 de 32, caída 100 cm → '+await probar(16,32,['1','0','0']));
ok('flecha nula en el apoyo', await probar(0,32,['1','0','0'])==='+0,000',
   'd=0 → '+await probar(0,32,['1','0','0']));
ok('flecha parabólica a un cuarto', await probar(8,32,['1','0','0'])==='−0,060',
   'd=8 de 32 → '+await probar(8,32,['1','0','0'])+' (3/4 de la flecha máxima)');

// calibrar la flecha desde una cota conocida
await p.click('#q-ref'); await p.waitForTimeout(300);
await p.fill('#cfg-fz','-0.08'); await p.fill('#cfg-fc','100'); await p.waitForTimeout(200);
ok('calibra la flecha', /8,0 cm/.test(await p.textContent('#cfg-fcalc')), await p.textContent('#cfg-fcalc'));
await p.click('#cfg-fusar'); await p.waitForTimeout(300);
await p.click('#cfg-ok'); await p.waitForTimeout(250);

// ── cambiar a manguera y volver ──
await p.click('#q-mode'); await p.waitForTimeout(300);
await p.click('[data-modo="manguera"]'); await p.waitForTimeout(300);
await p.click('#cfg-ok'); await p.waitForTimeout(250);
ok('cambia a manguera', (await p.textContent('#q-mode'))==='Manguera');
for (const k of ['1','3','7',',','5']) await p.click(`[data-k="${k}"]`);
await p.waitForTimeout(150);
ok('fórmula de manguera intacta', (await p.textContent('#q-result'))==='−0,375', await p.textContent('#q-result'));

await b.close();
console.log(errs.length?'\nPROBLEMAS:\n - '+errs.join('\n - '):'\nSin errores');
process.exit(errs.length?1:0);
