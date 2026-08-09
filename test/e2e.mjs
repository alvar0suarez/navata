import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || 'test/screenshots';
mkdirSync(OUT, { recursive: true });
const URL = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });

const step = async (name, fn) => {
  const before = errors.length;
  try { await fn(); } catch (e) { errors.push(`step "${name}": ${e.message}`); }
  const nw = errors.slice(before);
  console.log(`${nw.length ? 'FAIL' : ' ok '}  ${name}${nw.length ? '\n       ' + nw.join('\n       ') : ''}`);
};

await step('carga inicial', async () => {
  // Con el borde de la parcela ya puesto, la app arranca donde se trabaja.
  await page.waitForSelector('#view-points.active', { timeout: 3000 });
  const st = await page.evaluate(async () => {
    const { stats } = await import('./assets/js/state.js');
    return stats();
  });
  if (Math.abs(st.area - 465) > 0.01) throw new Error('superficie inesperada: ' + st.area);
  console.log(`       parcela por defecto: ${st.area} m²`);
});

await step('cargar proyecto de ejemplo', async () => {
  await page.click('[data-view="data"]');
  await page.waitForTimeout(300);
  page.once('dialog', d => d.accept());
  await page.click('#d-demo');
  await page.waitForSelector('#view-map.active', { timeout: 3000 });
  await page.waitForTimeout(600);
});

await step('estadísticas coherentes', async () => {
  const sub = await page.textContent('#project-sub');
  if (!/m² · \d+ cotas/.test(sub)) throw new Error('subtítulo inesperado: ' + sub);
  console.log('       ' + sub);
});

await step('activar capas de relieve', async () => {
  await page.click('[data-layer="hypso"]');
  await page.click('[data-layer="hillshade"]');
  await page.waitForTimeout(400);
});
await page.screenshot({ path: `${OUT}/01-mapa.png` });

await step('capa de pendiente', async () => {
  await page.click('[data-layer="slope"]');
  await page.waitForTimeout(400);
});
await page.screenshot({ path: `${OUT}/02-pendiente.png` });
await page.click('[data-layer="slope"]');
await page.click('[data-layer="hypso"]');

await step('herramienta de perfil', async () => {
  await page.click('[data-tool="profile"]');
  const box = await page.locator('#map-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const stats = await page.textContent('#profile-stats');
  if (!/m · Δ/.test(stats)) throw new Error('perfil sin datos: ' + stats);
  console.log('       perfil: ' + stats);
});
await page.screenshot({ path: `${OUT}/03-perfil.png` });

await step('añadir cota tocando el mapa', async () => {
  await page.click('#profile-close');
  await page.click('[data-tool="point"]');
  const box = await page.locator('#map-canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.waitForSelector('#view-points.active', { timeout: 2000 });
  await page.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
  await page.waitForTimeout(200);
  await page.fill('#p-z', '-0.42');
  await page.click('#p-add');
  await page.waitForTimeout(300);
  const n = await page.textContent('#pt-count');
  console.log('       cotas ahora: ' + n);
});

await step('calculadora de manguera', async () => {
  await page.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});
  await page.waitForTimeout(150);
  await page.fill('#h-ref', '100');
  await page.fill('#h-pt', '137.5');
  await page.waitForTimeout(150);
  const out = await page.inputValue('#h-out');
  if (out !== '−0,375') throw new Error('resultado inesperado: ' + out);
  console.log('       L_ref 100 cm, L_pt 137,5 cm → ' + out + ' m');
  await page.click('#h-use');
  const z = await page.inputValue('#p-z');
  if (z !== '-0.375') throw new Error('no copió Z: ' + z);
});

await step('generador de malla', async () => {
  await page.click('[data-view="points"]');
await page.evaluate(()=>{const d=document.querySelector('#more-points'); if(d) d.open=true;});

  await page.fill('#g-dx', '4'); await page.fill('#g-dy', '4');
  await page.click('#g-make');
  await page.waitForTimeout(400);
});

await step('añadir árbol', async () => {
  await page.click('[data-view="trees"]');
  await page.fill('#t-x', '9'); await page.fill('#t-y', '25');
  await page.fill('#t-species', 'Nogal'); await page.fill('#t-canopy', '6');
  await page.fill('#t-height', '7');
  await page.click('#t-add');
  await page.waitForTimeout(200);
  const n = await page.textContent('#t-count');
  if (n !== '5') throw new Error('esperaba 5 árboles, hay ' + n);
});

await step('foto sintética con rumbo', async () => {
  await page.click('[data-view="photos"]');
  await page.fill('#f-x', '8'); await page.fill('#f-y', '4');
  await page.fill('#f-bearing', '15'); await page.fill('#f-range', '30');
  await page.fill('#f-note', 'Desde la calle hacia el fondo');
  // genera un JPEG en memoria y lo inyecta en el input de archivo
  const buf = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 600);
    grd.addColorStop(0, '#7fb2d9'); grd.addColorStop(0.55, '#c9d9a0'); grd.addColorStop(1, '#6b7f42');
    g.fillStyle = grd; g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#3d5c2a';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(90 + i * 130, 330 + (i % 3) * 30, 46, 0, 7); g.fill(); }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.setInputFiles('#f-file', { name: 'campo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(buf) });
  await page.waitForTimeout(900);
  const n = await page.textContent('#f-count');
  if (n !== '1') throw new Error('foto no registrada, count=' + n);
  const pct = await page.textContent('#cov-pct');
  console.log('       cobertura tras 1 foto: ' + pct);
});

await step('sugerir siguiente estación', async () => {
  await page.click('#cov-suggest');
  await page.waitForTimeout(700);
  const s = await page.textContent('#cov-suggestion');
  if (!/Colócate en/.test(s)) throw new Error('sin sugerencia: ' + s);
  console.log('       ' + s.replace(/\s+/g, ' ').trim());
});
await page.screenshot({ path: `${OUT}/04-fotos.png` });

await step('capa de cobertura en el mapa', async () => {
  await page.click('[data-view="map"]');
  await page.click('[data-layer="coverage"]');
  await page.waitForTimeout(500);
});
await page.screenshot({ path: `${OUT}/05-cobertura.png` });
await page.click('[data-layer="coverage"]');

await step('vista 3D', async () => {
  await page.click('[data-view="3d"]');
  await page.waitForTimeout(700);
  const hidden = await page.locator('#c3d-empty').evaluate(e => e.classList.contains('hidden'));
  if (!hidden) throw new Error('la malla 3D no se generó');
  // órbita
  const box = await page.locator('#canvas-3d').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 - 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
});
await page.screenshot({ path: `${OUT}/06-3d.png` });

await step('exportadores producen contenido válido', async () => {
  const res = await page.evaluate(async () => {
    const EX = await import('./assets/js/exporters.js');
    const out = {};
    out.json = EX.toJSON().length;
    out.csv = EX.toCSV().split('\r\n').length;
    out.geojson = JSON.parse(EX.toGeoJSON()).features.length;
    out.kml = EX.toKML();
    out.dxf = EX.toDXF();
    out.svg = EX.toSVG();
    out.obj = EX.toOBJ();
    const zip = await EX.toBundle();
    return {
      jsonBytes: out.json, csvRows: out.csv, geoFeatures: out.geojson,
      kmlBytes: out.kml.length, kmlOk: out.kml.startsWith('<?xml') && out.kml.trim().endsWith('</kml>'),
      dxfOk: out.dxf.startsWith('0\r\nSECTION') && out.dxf.trim().endsWith('EOF'),
      dxfBytes: out.dxf.length,
      svgOk: out.svg.startsWith('<svg') && out.svg.trim().endsWith('</svg>'), svgBytes: out.svg.length,
      objVerts: (out.obj.match(/^v /gm) || []).length, objFaces: (out.obj.match(/^f /gm) || []).length,
      zipBytes: zip.size,
    };
  });
  console.log('       ' + JSON.stringify(res));
  if (!res.kmlOk) throw new Error('KML malformado');
  if (!res.dxfOk) throw new Error('DXF malformado');
  if (!res.svgOk) throw new Error('SVG malformado');
  if (res.geoFeatures < 20) throw new Error('GeoJSON con pocas entidades');
  if (res.objVerts < 100 || res.objFaces < 100) throw new Error('OBJ vacío');
  if (res.zipBytes < 5000) throw new Error('ZIP demasiado pequeño');
});

await step('persistencia tras recargar', async () => {
  const before = await page.textContent('#pt-count').catch(() => null);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem('navata.project.v1')));
  if (!n || n.trees.length !== 5) throw new Error('no se recuperó el proyecto');
  console.log(`       recuperado: ${n.points.length} cotas, ${n.trees.length} árboles, ${n.photos.length} fotos`);
});

await step('guía cargada', async () => {
  await page.click('[data-view="guide"]');
  await page.waitForTimeout(300);
  const t = await page.textContent('#guide-content');
  if (!/nivel de manguera/i.test(t)) throw new Error('guía vacía');
});


// Vista de escritorio
const wide = await ctx.newPage();
wide.on('pageerror', e => errors.push('desktop pageerror: ' + e.message));
await wide.setViewportSize({ width: 1280, height: 820 });
await wide.goto(URL, { waitUntil: 'networkidle' });
await wide.waitForTimeout(900);
await wide.click('[data-view="map"]');
await wide.waitForTimeout(400);
await wide.click('[data-layer="hypso"]');
await wide.click('[data-layer="hillshade"]');
await wide.waitForTimeout(600);
await wide.screenshot({ path: `${OUT}/07-escritorio.png` });

await browser.close();

console.log('\n' + (errors.length ? `${errors.length} PROBLEMAS:\n - ` + errors.join('\n - ') : 'Sin errores de consola'));
process.exit(errors.length ? 1 : 0);
