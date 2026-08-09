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
console.log('     '+(await p.textContent('#stats')).replace(/\s+/g,' ').trim().slice(0,110));
await p.click('#reset'); await p.waitForTimeout(400);

// cota bajo el puntero
ok('la lectura arranca oculta', !(await p.locator('#lectura').evaluate(e=>e.classList.contains('on'))));
const caja = await p.locator('#plano').boundingBox();
await p.mouse.move(caja.x+caja.width/2, caja.y+caja.height/2);
await p.waitForTimeout(300);
const lect = (await p.textContent('#lectura')).replace(/\s+/g,' ').trim();
ok('sale la cota al pasar por encima',
   await p.locator('#lectura').evaluate(e=>e.classList.contains('on')), lect);
ok('la cota leída es un número en metros', /[-−+]?\d+,\d\d m/.test(lect), lect);
ok('dice dónde está', /de la calle/.test(lect) && /linde izquierdo/.test(lect));
const centro = await p.locator('#plano').screenshot();
ok('el cursor se dibuja sobre el plano', !centro.equals(despues));
await p.screenshot({path:(process.env.SHOT_DIR||'test/screenshots')+'/34-revision-cota.png'});
await p.mouse.move(caja.x+caja.width/2, caja.y+caja.height+60);
await p.waitForTimeout(300);
ok('se esconde al salir del plano',
   !(await p.locator('#lectura').evaluate(e=>e.classList.contains('on'))));

// informe autocontenido
const dlInf = p.waitForEvent('download');
await p.click('#informe');
const fi = await dlInf;
ok('descarga el informe', /\.html$/.test(fi.suggestedFilename()), fi.suggestedFilename());
const cuerpo = (await (await import('node:fs/promises')).readFile(await fi.path(),'utf8'));
ok('el informe lleva los dibujos dentro',
   (cuerpo.match(/src="data:image\/png;base64,/g)||[]).length===5,
   String((cuerpo.match(/src="data:image\/png;base64,/g)||[]).length)+' imágenes');
ok('el informe lleva las 28 cotas', (cuerpo.match(/<td class="c/g)||[]).length===28,
   String((cuerpo.match(/<td class="c/g)||[]).length));
ok('el informe no depende de la red', !/https?:\/\//.test(cuerpo));
ok('el informe se imprime', cuerpo.includes('window.print()') && cuerpo.includes('@media print'));

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
