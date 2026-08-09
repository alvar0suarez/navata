import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync(process.env.SHOT_DIR || 'test/screenshots', { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({viewport:{width:1200,height:1500},deviceScaleFactor:2});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto((process.env.APP_URL || 'http://127.0.0.1:8899/index.html').replace(/[^/]*$/,'')+'revision.html',{waitUntil:'networkidle'});
await p.waitForTimeout(1200);
const ok=(n,c,x='')=>{console.log((c?' ok  ':'FAIL ')+n+(x?' — '+x:''));if(!c)errs.push(n)};
ok('carga', (await p.title()).includes('Revisar'));
ok('28 casillas editables', await p.locator('#tabla input').count()===28, String(await p.locator('#tabla input').count()));
console.log('     '+(await p.textContent('#stats')).replace(/\s+/g,' ').trim().slice(0,150));
await p.screenshot({path:(process.env.SHOT_DIR||'test/screenshots')+'/33-revision.png', fullPage:false});

// editar una celda y ver que el plano cambia
const antes = await p.locator('#plano').screenshot();
await p.fill('#tabla input[data-i="2"][data-j="0"]','-0.33');
await p.waitForTimeout(600);
const despues = await p.locator('#plano').screenshot();
ok('el plano reacciona al editar', !antes.equals(despues));
console.log('     tras corregir el +0,53: '+(await p.textContent('#stats')).replace(/\s+/g,' ').trim().slice(0,110));

// botón de hipótesis
await p.click('#reset'); await p.waitForTimeout(400);
await p.click('#hipotesis'); await p.waitForTimeout(600);
const v = await p.inputValue('#tabla input[data-i="2"][data-j="0"]');
ok('la hipótesis baja el bloque', v==='-0.33', '+0,53 → '+v);
await p.screenshot({path:(process.env.SHOT_DIR||'test/screenshots')+'/34-revision-hipotesis.png'});

// mover una línea entera
await p.click('#reset'); await p.waitForTimeout(300);
await p.click('[data-off="0"][data-d="-0.05"]'); await p.waitForTimeout(400);
ok('mueve la línea entera', (await p.inputValue('#tabla input[data-i="0"][data-j="0"]'))==='-0.05',
   'fondo L4 → '+await p.inputValue('#tabla input[data-i="0"][data-j="0"]'));

// descarga
await p.click('#reset'); await p.waitForTimeout(300);
const dl = p.waitForEvent('download');
await p.click('#descargar');
const f = await dl;
ok('descarga el proyecto', /\.json$/.test(f.suggestedFilename()), f.suggestedFilename());

// móvil
const m = await (await b.newContext({viewport:{width:412,height:900},deviceScaleFactor:2})).newPage();
await m.goto((process.env.APP_URL || 'http://127.0.0.1:8899/index.html').replace(/[^/]*$/,'')+'revision.html',{waitUntil:'networkidle'});
await m.waitForTimeout(1000);
ok('sin desbordamiento en móvil',
   await m.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),
   await m.evaluate(()=>document.documentElement.scrollWidth+' vs '+window.innerWidth));
await m.screenshot({path:(process.env.SHOT_DIR||'test/screenshots')+'/35-revision-movil.png'});
await b.close();
console.log(errs.length?'\nPROBLEMAS:\n - '+errs.join('\n - '):'\nSin errores');
process.exit(errs.length?1:0);
