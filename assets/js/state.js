// state.js — modelo de datos del proyecto y superficie derivada (con caché).

import { uid, today, debounce } from './util.js';
import { loadProject, saveProject, blobs } from './store.js';
import { buildSurface, smoothSurface, contours, bbox, polyArea, polyPerimeter,
         pointInPoly, distToPoly } from './geom.js';

export const SCHEMA = 1;

export function emptyProject() {
  return {
    schema: SCHEMA,
    id: uid(),
    name: 'La Navata',
    place: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    visitDate: today(),
    notes: '',
    anchor: null,                 // {lat, lon, rot}
    boundary: [],                 // [{x,y}]
    boundaryAssumed: null,        // texto de la hipótesis si el borde no está medido del todo
    streetEdge: -1,               // índice de arista que da a la calle
    points: [],                   // {id,x,y,z,label,type,method,ts}
    pending: [],                  // estaciones de malla aún sin medir {id,x,y,label}
    trees: [],                    // {id,x,y,species,dbh,canopy,height,health,notes,ts}
    photos: [],                   // {id,x,y,bearing,fov,range,key,thumb,w,h,note,ts}
    settings: { contourInterval: 0.1, gridDx: 4, gridDy: 4, res: 0.25, idwPower: 2.2 },
  };
}

export const P = { cur: loadProject() || emptyProject() };

// Migración suave por si el esquema crece
(function migrate() {
  const p = P.cur;
  const d = emptyProject();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  p.settings = Object.assign({}, d.settings, p.settings);
})();

const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

const persist = debounce(() => {
  P.cur.updatedAt = new Date().toISOString();
  const ok = saveProject(P.cur);
  document.querySelector('#save-state')?.classList.remove('busy');
  if (!ok) console.warn('almacenamiento lleno');
}, 400);

/** Notifica cambios. `hard` invalida la superficie interpolada. */
export function touch(hard = true) {
  if (hard) _surfCache = null;
  document.querySelector('#save-state')?.classList.add('busy');
  persist();
  for (const fn of listeners) fn(P.cur);
}

export function replaceProject(p) {
  const d = emptyProject();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  p.settings = Object.assign({}, d.settings, p.settings);
  P.cur = p;
  touch();
}

/* ────────────────── superficie derivada, con caché ────────────────── */

let _surfCache = null;

export function surface() {
  if (_surfCache) return _surfCache;
  const p = P.cur;
  const pts = p.points.filter(q => Number.isFinite(q.z));
  const res = p.settings.res || 0.25;
  const surf = buildSurface(pts, p.boundary, { res, power: p.settings.idwPower, k: 10 });
  // El TPS ya es suave por construcción; solo el IDW necesita el filtro.
  if (!surf.empty && surf.method === 'IDW') smoothSurface(surf, 2);
  const cont = surf.empty ? [] : contours(surf, p.settings.contourInterval);
  _surfCache = { surf, contours: cont, nPts: pts.length };
  return _surfCache;
}

/* ────────────────── resumen / estadísticas ────────────────── */

export function stats() {
  const p = P.cur;
  const zs = p.points.filter(q => Number.isFinite(q.z)).map(q => q.z);
  const area = p.boundary.length >= 3 ? polyArea(p.boundary) : 0;
  const perim = p.boundary.length >= 3 ? polyPerimeter(p.boundary) : 0;
  const bb = bbox(p.boundary.length ? p.boundary : p.points);
  const zmin = zs.length ? Math.min(...zs) : 0;
  const zmax = zs.length ? Math.max(...zs) : 0;

  // Pendiente media global: desnivel entre el punto más alto y el más bajo
  // dividido por la distancia horizontal que los separa.
  let meanSlope = 0;
  const measured = p.points.filter(q => Number.isFinite(q.z));
  if (measured.length >= 2) {
    const lo = measured.reduce((a, b) => (b.z < a.z ? b : a));
    const hi = measured.reduce((a, b) => (b.z > a.z ? b : a));
    const d = Math.hypot(hi.x - lo.x, hi.y - lo.y);
    if (d > 0.5) meanSlope = (hi.z - lo.z) / d * 100;
  }

  return {
    nPoints: p.points.length, nPending: p.pending.length,
    nTrees: p.trees.length, nPhotos: p.photos.length,
    area, perim, bb,
    zmin, zmax, drop: zmax - zmin,
    meanSlope,
  };
}

/* ────────────────── operaciones ────────────────── */

export function addPoint(o) {
  const p = P.cur;
  const label = o.label || nextLabel(p.points, 'P');
  const pt = {
    id: uid(), x: +o.x, y: +o.y, z: Number.isFinite(+o.z) ? +o.z : NaN,
    label, type: o.type || 'grid', method: o.method || 'hose',
    ts: new Date().toISOString(),
  };
  if (!Number.isFinite(pt.z)) pt.z = 0;
  p.points.push(pt);
  // Si coincide con una estación pendiente (±0,6 m), la marca como hecha
  const i = p.pending.findIndex(q => Math.hypot(q.x - pt.x, q.y - pt.y) < 0.6);
  if (i >= 0) p.pending.splice(i, 1);
  touch();
  return pt;
}

export function nextLabel(arr, prefix) {
  let n = 1;
  const used = new Set(arr.map(a => a.label));
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

export function delPoint(id) {
  P.cur.points = P.cur.points.filter(p => p.id !== id);
  touch();
}

export function addTree(o) {
  const t = {
    id: uid(), x: +o.x, y: +o.y,
    species: o.species || 'Árbol',
    dbh: +o.dbh || 0, canopy: +o.canopy || 3, height: +o.height || 0,
    health: o.health || 'bueno', notes: o.notes || '',
    label: nextLabel(P.cur.trees, 'A'),
    ts: new Date().toISOString(),
  };
  P.cur.trees.push(t);
  touch(false);
  return t;
}

export function delTree(id) {
  P.cur.trees = P.cur.trees.filter(t => t.id !== id);
  touch(false);
}

export async function delPhoto(id) {
  const ph = P.cur.photos.find(p => p.id === id);
  if (ph) {
    if (ph.key) await blobs.del(ph.key).catch(() => {});
    if (ph.thumb) await blobs.del(ph.thumb).catch(() => {});
  }
  P.cur.photos = P.cur.photos.filter(p => p.id !== id);
  touch(false);
}

/** Genera estaciones de malla dentro del borde, en orden de recorrido. */
export function makeGrid(dx, dy, order = 'boustro') {
  const p = P.cur;
  if (p.boundary.length < 3) return 0;
  const bb = bbox(p.boundary);
  // Tolerancia hacia dentro: acepta también puntos justo sobre el borde.
  const inPoly = (x, y) => pointInPoly(x, y, p.boundary) || distToPoly(x, y, p.boundary) < 0.02;

  // Posiciones de cada eje. Si el último paso no llega al borde se añade el
  // borde mismo: sin esa columna, toda la franja del lado largo quedaría sin
  // medir y las curvas de nivel ahí serían pura extrapolación.
  const axis = (min, max, step) => {
    const out = [];
    for (let v = min; v <= max + 1e-9; v += step) out.push(v);
    if (max - out[out.length - 1] > step * 0.25) out.push(max);
    return out;
  };
  const xs = axis(bb.x0, bb.x1, dx);
  const ys = axis(bb.y0, bb.y1, dy);

  const rows = [];
  for (let j = 0; j < ys.length; j++) {
    const y = ys[j];
    // Los cortes de la fila con el borde: en una parcela inclinada la malla
    // rectangular deja fuera las franjas laterales, que son justo donde hace
    // falta saber la cota para replantear un cierre o un muro.
    const row = rowEdges(y, p.boundary).map(x => ({ x, y }));
    for (const x of xs) {
      if (!inPoly(x, y)) continue;
      if (row.some(c => Math.abs(c.x - x) < dx * 0.3)) continue;   // ya cubierto por el corte
      row.push({ x, y });
    }
    row.sort((a, b) => a.x - b.x);
    if (order === 'boustro' && j % 2 === 1) row.reverse();
    rows.push(row);
  }

  const done = p.points;
  const tol = Math.min(dx, dy) * 0.4;
  const list = [];
  const push = (x, y, label) => {
    if (done.some(d => Math.hypot(d.x - x, d.y - y) < tol)) return;
    if (list.some(d => Math.hypot(d.x - x, d.y - y) < tol)) return;
    list.push({ id: uid(), x, y, label });
  };

  // Las esquinas van primero: fijan el marco de la parcela y conviene tenerlas
  // medidas antes de empezar a recorrer la malla.
  p.boundary.forEach((v, i) => push(v.x, v.y, 'E' + (i + 1)));

  let n = 1;
  for (const row of rows) for (const c of row) push(c.x, c.y, 'M' + (n++));
  p.pending = list;
  p.settings.gridDx = dx; p.settings.gridDy = dy;
  touch(false);
  return list.length;
}

/** Coordenadas X donde la horizontal y = `y` corta el borde del polígono. */
function rowEdges(y, poly) {
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if (Math.abs(b.y - a.y) < 1e-9) continue;              // arista horizontal
    const t = (y - a.y) / (b.y - a.y);
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    out.push(a.x + (b.x - a.x) * t);
  }
  out.sort((p, q) => p - q);
  // Elimina duplicados en los vértices, donde coinciden dos aristas
  return out.filter((v, i) => i === 0 || v - out[i - 1] > 1e-6);
}

export function makeRect(w, h) {
  P.cur.boundary = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  if (P.cur.streetEdge < 0) P.cur.streetEdge = 0;   // por defecto, la calle es el lado y=0
  touch();
}
