// Copia de seguridad: exportar a .json, volver a cargarlo (sustituyendo o
// combinando) y restaurar una copia automática.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const OUT = process.env.SHOT_DIR || 'test/screenshots';
mkdirSync(OUT, { recursive: true });
const BASE = (process.env.APP_URL || 'http://127.0.0.1:8899/index.html').replace(/[^/]*$/,'');

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await (await b.newContext({viewport:{width:412,height:900},deviceScaleFactor:2})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
p.on('dialog',d=>d.accept());
const ok=(n,c,x='')=>{console.log((c?' ok  ':'FAIL ')+n+(x?' — '+x:'')); if(!c)errs.push(n);};
const st = () => p.evaluate(async()=>{
  const {P,stats}=await import('./assets/js/state.js');
  return {...stats(), pend:P.cur.pending.length, labels:P.cur.points.map(q=>q.label)};
});

await p.goto(BASE+'index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(600);

// mide unas cuantas cotas
await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
 await p.waitForTimeout(250);
await p.click('#g-make'); await p.waitForTimeout(600);
await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
 await p.waitForTimeout(200);
await p.click('#hero-go'); await p.waitForTimeout(400);
// lecturas distintas en cada estación, para que el desnivel sea real y la
// comprobación de la restauración signifique algo
const lecturas = ['104','112','127','133','098','141','119','156'];
for (const L of lecturas){
  for (const k of L.split('')) await p.click(`[data-k="${k}"]`);
  await p.click('#q-save'); await p.waitForTimeout(90);
}
await p.click('#q-close'); await p.waitForTimeout(400);
const original = await st();
ok('hay datos que salvar', original.nPoints===8 && original.pend===40 && original.drop>0.5,
   `${original.nPoints} cotas, ${original.pend} pendientes, Δ ${original.drop.toFixed(3)} m`);

// ── exportar ──
await p.click('[data-view="data"]'); await p.waitForTimeout(400);
const dl = p.waitForEvent('download');
await p.click('#bk-save');
const file = await dl;
const ruta = join(tmpdir(), 'navata-copia.json');
await file.saveAs(ruta);
const json = JSON.parse(await (await import('node:fs/promises')).readFile(ruta,'utf8'));
ok('el .json contiene las alturas', json.points.length===8 && json.points.every(q=>Number.isFinite(q.z)),
   json.points.length+' cotas con Z');
ok('el .json contiene la malla pendiente', json.pending.length===40 &&
   json.pending.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y)&&Number.isFinite(q.d)),
   json.pending.length+' estaciones con posición en el tendido');
ok('el .json contiene el borde y los ajustes',
   json.boundary.length===4 && json.settings.gridDx===3 && json.settings.gridDy===5);
ok('nombre de fichero con fecha', /navata.*\d{4}-\d{2}-\d{2}\.json/.test(file.suggestedFilename()),
   file.suggestedFilename());

// ── borrar todo y restaurar desde el fichero ──
await p.click('#pt-del-all').catch(()=>{});
await p.click('[data-view="points"]');
await p.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
 await p.waitForTimeout(200);
await p.click('#pt-del-all'); await p.waitForTimeout(500);
ok('se ha vaciado', (await st()).nPoints===0);

await p.click('[data-view="data"]'); await p.waitForTimeout(300);
await p.setInputFiles('#bk-load', ruta); await p.waitForTimeout(600);
ok('enseña qué trae el fichero', await p.locator('#modal').isVisible());
const tabla = (await p.textContent('#modal-body')).replace(/\s+/g,' ');
ok('compara fichero contra teléfono', /En el fichero/.test(tabla) && /Ahora aquí/.test(tabla), tabla.slice(0,120));
await p.screenshot({path:`${OUT}/24-importar.png`});

await p.click('#imp-replace'); await p.waitForTimeout(700);
const rest = await st();
ok('restaura las alturas exactas',
   rest.nPoints===8 && Math.abs(rest.drop-original.drop)<1e-9 && Math.abs(rest.zmin-original.zmin)<1e-9,
   `${rest.nPoints} cotas, Δ ${rest.drop.toFixed(3)} m (original ${original.drop.toFixed(3)}), mín ${rest.zmin.toFixed(3)}`);
ok('restaura la malla pendiente', rest.pend===40, rest.pend+'');

// ── combinar: cargar el mismo fichero no debe duplicar nada ──
await p.click('[data-view="data"]'); await p.waitForTimeout(300);
await p.setInputFiles('#bk-load', ruta); await p.waitForTimeout(600);
await p.click('#imp-merge'); await p.waitForTimeout(700);
const merged = await st();
ok('combinar no duplica', merged.nPoints===8, merged.nPoints+' cotas');

// ── combinar de verdad: fichero con una cota que aquí no está ──
const extra = structuredClone(json);
extra.points = [{id:'zzz1', x:9, y:15, z:-0.75, label:'X1', type:'grid', method:'line', ts:''}];
extra.pending = [];
const ruta2 = join(tmpdir(),'navata-extra.json');
writeFileSync(ruta2, JSON.stringify(extra));
await p.click('[data-view="data"]'); await p.waitForTimeout(300);
await p.setInputFiles('#bk-load', ruta2); await p.waitForTimeout(600);
await p.click('#imp-merge'); await p.waitForTimeout(700);
const m2 = await st();
ok('combinar añade lo que falta', m2.nPoints===9 && m2.labels.includes('X1'),
   `${m2.nPoints} cotas, incluye X1: ${m2.labels.includes('X1')}`);

// ── copias automáticas ──
await p.click('[data-view="data"]'); await p.waitForTimeout(300);
await p.click('#bk-auto summary'); await p.waitForTimeout(400);
const snaps = await p.evaluate(async()=>(await import('./assets/js/store.js')).listSnapshots().length);
ok('guarda copias automáticas', snaps>0, snaps+' copias');
const filas = await p.locator('#bk-list [data-snap]').count();
ok('las lista con botón de restaurar', filas===snaps, filas+' filas');
await p.screenshot({path:`${OUT}/25-copias.png`});

await b.close();
console.log(errs.length?'\nPROBLEMAS:\n - '+errs.join('\n - '):'\nSin errores');
process.exit(errs.length?1:0);
