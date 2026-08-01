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

console.log(fails ? `\n${fails} PRUEBAS FALLIDAS` : '\nTodas las pruebas pasan');
process.exit(fails ? 1 : 0);
