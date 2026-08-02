import { buildSurface, smoothSurface, contours, sampleSurface, polyArea,
         pointInPoly, localToLatLon, latLonToLocal, slopeGrid, profileAlong }
  from '../assets/js/geom.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? '  ok  ' : ' FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
};

// ── superficie sintética: plano inclinado z = -0.03*y + 0.01*x ──
const boundary = [{x:0,y:0},{x:16,y:0},{x:16,y:44},{x:0,y:44}];
const zf = (x,y) => -0.03*y + 0.01*x;
const pts = [];
for (let y=0; y<=44; y+=4) for (let x=0; x<=16; x+=4) pts.push({x,y,z:zf(x,y)});

ok('polyArea 16x44', Math.abs(polyArea(boundary) - 704) < 1e-6, polyArea(boundary));
ok('pointInPoly dentro', pointInPoly(8,22,boundary));
ok('pointInPoly fuera', !pointInPoly(20,22,boundary));

const surf = buildSurface(pts, boundary, {res:0.5});
ok('surface no vacía', !surf.empty, `${surf.nx}x${surf.ny}, ${surf.valid} celdas`);
ok('zmin/zmax plausibles', surf.zmin > -1.4 && surf.zmax < 0.2, `${surf.zmin.toFixed(3)}..${surf.zmax.toFixed(3)}`);

// exactitud de la interpolación en el interior
let maxErr = 0;
for (let y=2; y<=42; y+=2) for (let x=2; x<=14; x+=2) {
  const v = sampleSurface(surf, x, y);
  if (!Number.isNaN(v)) maxErr = Math.max(maxErr, Math.abs(v - zf(x,y)));
}
ok('IDW reproduce el plano (<3 cm)', maxErr < 0.03, `err máx ${(maxErr*100).toFixed(1)} cm`);

// ── curvas de nivel ──
const cont = contours(surf, 0.1);
ok('genera curvas', cont.length >= 8, `${cont.length} niveles`);
const levels = cont.map(c => c.level.toFixed(2)).join(' ');
ok('niveles múltiplos de 0,1', cont.every(c => Math.abs(c.level*10 - Math.round(c.level*10)) < 1e-6), levels);
ok('cada nivel tiene polilíneas', cont.every(c => c.lines.length > 0 && c.lines.every(l => l.length >= 2)));

// En un plano inclinado, cada curva debe ser una sola línea aproximadamente recta
const midC = cont[Math.floor(cont.length/2)];
ok('curva de plano es casi recta', midC.lines.length <= 3, `${midC.lines.length} tramos en z=${midC.level.toFixed(2)}`);
// y todos sus puntos deben estar sobre el nivel
const zErr = Math.max(...midC.lines.flat().map(p => Math.abs(sampleSurface(surf,p.x,p.y) - midC.level)));
ok('puntos de la curva están al nivel', zErr < 0.01, `err ${(zErr*1000).toFixed(1)} mm`);

// ── pendiente ──
const sl = slopeGrid(surf);
const mid = sl.data[Math.floor(surf.ny/2)*surf.nx + Math.floor(surf.nx/2)];
const expected = Math.hypot(0.01, 0.03)*100;
ok('pendiente central correcta', Math.abs(mid - expected) < 0.5, `${mid.toFixed(2)}% vs ${expected.toFixed(2)}%`);

// ── perfil ──
const pr = profileAlong(surf, {x:8,y:1}, {x:8,y:43}, 100);
ok('perfil: desnivel ≈ -1.26 m', Math.abs(pr.drop - (-0.03*42)) < 0.05, `${pr.drop.toFixed(3)} m`);
ok('perfil: pendiente ≈ -3 %', Math.abs(pr.slope + 3) < 0.3, `${pr.slope.toFixed(2)} %`);

// ── geodesia ida y vuelta ──
const anchor = {lat: 40.5321, lon: -3.9876, rot: 37.5};
for (const [x,y] of [[0,0],[15.92,44],[8,22],[-3,10]]) {
  const g = localToLatLon(x,y,anchor);
  const b = latLonToLocal(g.lat,g.lon,anchor);
  const err = Math.hypot(b.x-x, b.y-y);
  ok(`ida y vuelta (${x},${y})`, err < 1e-6, `err ${(err*1000).toFixed(4)} mm`);
}
// con rot=0, +Y debe ir al norte
const g0 = localToLatLon(0, 100, {lat:40, lon:-3, rot:0});
ok('rot=0 → +Y al norte', g0.lat > 40 && Math.abs(g0.lon + 3) < 1e-9, `${g0.lat.toFixed(6)}, ${g0.lon.toFixed(6)}`);
const g90 = localToLatLon(0, 100, {lat:40, lon:-3, rot:90});
ok('rot=90 → +Y al este', g90.lon > -3 && Math.abs(g90.lat - 40) < 1e-9, `${g90.lat.toFixed(6)}, ${g90.lon.toFixed(6)}`);

// ── superficie con una vaguada: la curva debe cerrarse ──
const bowl = [];
for (let y=0;y<=20;y+=2) for (let x=0;x<=20;x+=2)
  bowl.push({x,y,z: -Math.exp(-(((x-10)**2)+((y-10)**2))/40)});
const s2 = buildSurface(bowl, [{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}], {res:0.4});
smoothSurface(s2,1);
const c2 = contours(s2, 0.1);
const closed = c2.find(c => c.level < -0.4);
if (closed) {
  const l = closed.lines[0];
  const gap = Math.hypot(l[0].x-l[l.length-1].x, l[0].y-l[l.length-1].y);
  ok('curva de depresión se cierra', gap < 0.6, `hueco ${gap.toFixed(3)} m, ${l.length} vértices`);
} else ok('curva de depresión se cierra', false, 'no se encontró nivel < -0.4');

// ── trilateración del cuadrilátero ──
import { quadFromSides, quadFromSidesSquare, polyArea as pa2 } from '../assets/js/geom.js';

{
  // Rectángulo 15,92 × 44: diagonal = √(15,92² + 44²)
  const diag = Math.hypot(15.92, 44);
  const r = quadFromSides(15.92, 44, 15.92, 44, diag, diag);
  ok('rectángulo: cierra', r.ok, r.ok ? '' : r.error);
  if (r.ok) {
    ok('rectángulo: área 700,5 m²', Math.abs(pa2(r.poly) - 15.92 * 44) < 0.01, pa2(r.poly).toFixed(2));
    ok('rectángulo: segunda diagonal cuadra', Math.abs(r.check) < 1e-6, (r.check * 100).toFixed(3) + ' cm');
    const ys = r.poly.map(v => v.y);
    ok('rectángulo: crece hacia +Y', Math.min(...ys) > -1e-6 && Math.max(...ys) > 40);
  }

  // Trapecio real: frente 16, fondo 12, laterales distintos
  const V = [{x:0,y:0},{x:16,y:0},{x:14,y:40},{x:2,y:38}];
  const dist = (i,j) => Math.hypot(V[i].x-V[j].x, V[i].y-V[j].y);
  const t = quadFromSides(dist(0,1), dist(1,2), dist(2,3), dist(3,0), dist(0,2), dist(1,3));
  ok('trapecio: cierra', t.ok, t.ok ? '' : t.error);
  if (t.ok) {
    ok('trapecio: reproduce el área', Math.abs(pa2(t.poly) - pa2(V)) < 0.01,
       `${pa2(t.poly).toFixed(2)} vs ${pa2(V).toFixed(2)} m²`);
    ok('trapecio: diagonal de control exacta', Math.abs(t.check) < 1e-6, (t.check*1000).toFixed(3)+' mm');
    // cada vértice debe coincidir con el original
    let e = 0;
    for (let i = 0; i < 4; i++) e = Math.max(e, Math.hypot(t.poly[i].x - V[i].x, t.poly[i].y - V[i].y));
    ok('trapecio: vértices exactos', e < 1e-9, (e*1000).toFixed(6)+' mm');
  }

  // Medida mal tomada: la diagonal se pasa de largo
  const bad = quadFromSides(16, 44, 16, 44, 90, null);
  ok('detecta diagonal imposible', !bad.ok, bad.ok ? 'la aceptó' : bad.error.slice(0, 60));

  // Discrepancia de cierre: la segunda diagonal 30 cm larga
  const warn = quadFromSides(15.92, 44, 15.92, 44, diag, diag + 0.30);
  ok('detecta desajuste de cierre', warn.ok && Math.abs(warn.check + 0.30) < 1e-6,
     warn.ok ? (warn.check*100).toFixed(1)+' cm' : warn.error);

  // Sin diagonal, a escuadra
  const sq = quadFromSidesSquare(15.92, 44, 15.92, 44);
  ok('a escuadra: rectángulo', sq.ok && Math.abs(pa2(sq.poly) - 700.48) < 0.01,
     sq.ok ? pa2(sq.poly).toFixed(2)+' m²' : sq.error);
}

console.log(fails ? `\n${fails} PRUEBAS FALLIDAS` : '\nTodas las pruebas pasan');
process.exit(fails ? 1 : 0);
