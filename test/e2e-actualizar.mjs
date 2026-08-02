// Actualización de la app instalada: detectar una versión nueva, avisar,
// aplicarla al aceptar y conservar los datos medidos.
import { chromium } from 'playwright';
import { mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
const OUT = process.env.SHOT_DIR || 'test/screenshots';
mkdirSync(OUT, { recursive: true });

// Copia servible del sitio, para poder "publicar" una versión nueva a mitad
const DIR = '/tmp/navata-update-test';
rmSync(DIR, { recursive: true, force: true });
for (const d of ['index.html','sw.js','manifest.webmanifest','assets'])
  cpSync(d, `${DIR}/${d}`, { recursive: true });

const PORT = 8907;
const srv = spawn('python3', ['-m','http.server',String(PORT)], { cwd: DIR, stdio:'ignore' });
await new Promise(r => setTimeout(r, 1200));

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({viewport:{width:412,height:900},deviceScaleFactor:2});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
const ok=(n,c,x='')=>{console.log((c?' ok  ':'FAIL ')+n+(x?' — '+x:'')); if(!c)errs.push(n);};
const URLBASE = `http://127.0.0.1:${PORT}/`;

await p.goto(URLBASE+'index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(2500);
ok('service worker instalado', await p.evaluate(()=>navigator.serviceWorker.getRegistrations().then(r=>r.length>0)));
ok('muestra la versión', /\d{4}\.\d{2}\.\d{2}/.test(await p.textContent('#d-version').catch(()=>'')) ||
   /\d{4}\.\d{2}\.\d{2}/.test(await p.evaluate(()=>document.querySelector('#d-version').textContent)),
   await p.evaluate(()=>document.querySelector('#d-version').textContent));
ok('sin aviso al instalar por primera vez', await p.locator('#update-bar').isHidden());

// mide algo, para comprobar después que sobrevive
await p.click('[data-view="points"]'); await p.waitForTimeout(300);
await p.click('#hero-go'); await p.waitForTimeout(600);   // genera malla
await p.click('#hero-go'); await p.waitForTimeout(500);   // entra a medir
for (const L of ['112','127']) { for (const k of L.split('')) await p.click(`[data-k="${k}"]`);
  await p.click('#q-save'); await p.waitForTimeout(120); }
await p.click('#q-close'); await p.waitForTimeout(400);
const antes = await p.evaluate(async()=>{
  const {P,stats}=await import('./assets/js/state.js');
  return {n:P.cur.points.length, drop:stats().drop};
});
ok('hay datos medidos', antes.n===2, `${antes.n} cotas, Δ ${antes.drop.toFixed(3)} m`);

// ── se publica una versión nueva ──
let sw = readFileSync(`${DIR}/sw.js`,'utf8');
sw = sw.replace(/const VERSION = '[^']+'/, "const VERSION = '9999.99.99-test'");
writeFileSync(`${DIR}/sw.js`, sw);

await p.evaluate(()=>navigator.serviceWorker.getRegistration().then(r=>r.update()));
await p.waitForSelector('#update-bar:not(.hidden)', { timeout: 15000 });
ok('avisa de la versión nueva', await p.locator('#update-bar').isVisible());
ok('dice que los datos están a salvo', /no se tocan/.test(await p.textContent('#update-bar')));
await p.screenshot({path:`${OUT}/30-actualizar.png`});

// "Ahora no" la esconde sin aplicar
await p.click('#update-later'); await p.waitForTimeout(300);
ok('se puede posponer', await p.locator('#update-bar').isHidden());

// y vuelve a salir al comprobar de nuevo
await p.click('[data-view="data"]'); await p.waitForTimeout(300);
await p.click('#d-check-update');
await p.waitForSelector('#update-bar:not(.hidden)', { timeout: 15000 });
ok('el botón de Datos la encuentra', await p.locator('#update-bar').isVisible());

// aceptar: aplica y recarga
const navegado = p.waitForNavigation({ timeout: 20000 }).catch(()=>null);
await p.click('#update-go');
await navegado;
await p.waitForTimeout(2500);
const version = await p.evaluate(()=>new Promise(res=>{
  navigator.serviceWorker.ready.then(reg=>{
    const ch = new MessageChannel();
    navigator.serviceWorker.addEventListener('message', e=>res(e.data?.version), {once:true});
    reg.active.postMessage('VERSION');
    setTimeout(()=>res('(sin respuesta)'), 3000);
  });
}));
ok('el service worker nuevo está al mando', version==='9999.99.99-test', String(version));

const despues = await p.evaluate(async()=>{
  const {P,stats}=await import('./assets/js/state.js');
  return {n:P.cur.points.length, drop:stats().drop};
});
ok('los datos medidos sobreviven',
   despues.n===antes.n && Math.abs(despues.drop-antes.drop)<1e-9,
   `${despues.n} cotas, Δ ${despues.drop.toFixed(3)} m`);
ok('el aviso desaparece tras actualizar', await p.locator('#update-bar').isHidden());

await b.close();
srv.kill();
console.log(errs.length?'\nPROBLEMAS:\n - '+errs.join('\n - '):'\nSin errores');
process.exit(errs.length?1:0);
