import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.SHOT_DIR || 'test/screenshots';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({viewport:{width:412,height:900},deviceScaleFactor:2});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
const ok=(n,c,x='')=>{console.log((c?' ok  ':'FAIL ')+n+(x?' — '+x:'')); if(!c)errs.push(n);};

const BASE = (process.env.APP_URL || 'http://127.0.0.1:8899/index.html').replace(/[^/]*$/,'');
await p.goto(BASE+'procedimiento.html',{waitUntil:'networkidle'});
await p.waitForTimeout(400);
ok('la página carga', (await p.title()).includes('tú solo'), await p.title());
const t = await p.textContent('body');
for (const [q,re] of [['garrafa',/garrafa/i],['40 m de tubo',/40 m/],['láser alternativo',/rotativo/],
                      ['presupuesto',/Total: \d+–\d+ €/],['tabla de error',/±1,1 cm/],['flecha de la cuerda',/flecha|pandea/i],['método de la cuerda',/tendido/]])
  ok('contiene '+q, re.test(t));
ok('sin desbordamiento horizontal',
   await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),
   await p.evaluate(()=>document.documentElement.scrollWidth+' vs '+window.innerWidth));
await p.screenshot({path:`${OUT}/17-procedimiento.png`, fullPage:false});

// el enlace desde la guía de la app
await p.goto(BASE+'index.html',{waitUntil:'networkidle'});
await p.click('[data-view="guide"]'); await p.waitForTimeout(400);
const href = await p.getAttribute('#guide-content a[href="procedimiento.html"]','href');
ok('la app enlaza la página', href==='procedimiento.html', String(href));
await p.click('#guide-content a[href="procedimiento.html"]'); await p.waitForTimeout(600);
ok('el enlace navega', p.url().endsWith('procedimiento.html'), p.url());

// versión impresa: la caja verde lleva fondo oscuro fijo y hay que anularlo en papel
await p.goto(BASE+'procedimiento.html',{waitUntil:'networkidle'});
await p.emulateMedia({media:'print'});
await p.waitForTimeout(300);
const bg = await p.evaluate(()=>getComputedStyle(document.querySelector('.box.key')).backgroundColor);
const lum = bg.match(/\d+/g).slice(0,3).reduce((a,v)=>a+ +v,0)/3;
ok('la caja clave se imprime legible', lum>200, bg);
await p.pdf({path:`${OUT}/procedimiento.pdf`, format:'A4', printBackground:true,
             margin:{top:'14mm',bottom:'14mm',left:'14mm',right:'14mm'}});
await b.close();
console.log(errs.length?'\nPROBLEMAS:\n - '+errs.join('\n - '):'\nSin errores');
process.exit(errs.length?1:0);
