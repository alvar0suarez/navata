// state.js — modelo de datos del proyecto y superficie derivada (con caché).

import { uid, today, debounce } from './util.js';
import { loadProject, saveProject, blobs, pushSnapshot } from './store.js';
import { buildSurface, smoothSurface, contours, bbox, polyArea, polyPerimeter,
         pointInPoly, distToPoly } from './geom.js';

export const SCHEMA = 1;

/**
 * Medidas de la parcela tomadas en campo: 15,50 m de frente a la calle por
 * 30 m de fondo. El proyecto arranca con este borde ya puesto para no tener que
 * teclearlo estando allí.
 *
 * Se registra como rectángulo porque es lo que se midió. Si las esquinas no
 * salen a escuadra, se corrigen los vértices con la herramienta ⬡ del mapa o se
 * rehace el borde en Datos con los cuatro lados.
 */
export const PARCELA = { ancho: 15.5, fondo: 30 };

const bordePorDefecto = () => [
  { x: 0, y: 0 },
  { x: PARCELA.ancho, y: 0 },
  { x: PARCELA.ancho, y: PARCELA.fondo },
  { x: 0, y: PARCELA.fondo },
];

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
    boundary: bordePorDefecto(),  // [{x,y}]
    boundaryAssumed: null,        // texto de la hipótesis si el borde no está medido del todo
    streetEdge: 0,                // índice de arista que da a la calle (el frente, y=0)
    points: [],                   // {id,x,y,z,label,type,method,ts}
    pending: [],                  // estaciones de malla aún sin medir {id,x,y,label}
    trees: [],                    // {id,x,y,species,dbh,canopy,height,health,notes,ts}
    photos: [],                   // {id,x,y,bearing,fov,range,key,thumb,w,h,note,ts}
    settings: {
      contourInterval: 0.1,
      // Método de la cuerda nivelada: líneas a lo largo cada 3 m, puntos cada 5 m
      gridDx: 3, gridDy: 5, gridOrder: 'cols', nLines: 0,
      metodo: 'cuerda',           // 'cuerda' | 'manguera' | 'z'
      alturaCuerda: 1,            // altura de la cuerda sobre el cero, en metros
      flechaCuerda: 0,            // pandeo en el centro del tendido, en cm
      refReading: 100, refOffset: 0,
      res: 0.25, idwPower: 2.2,
    },
  };
}

export const P = { cur: loadProject() || emptyProject() };

// Migración suave por si el esquema crece
(function migrate() {
  const p = P.cur;
  const d = emptyProject();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  p.settings = Object.assign({}, d.settings, p.settings);
  // Si se abrió la app antes de conocerse las medidas, el proyecto guardado está
  // vacío: adopta el borde real en lugar de obligar a teclearlo.
  if (!p.boundary.length && !p.points.length && !p.pending.length) {
    p.boundary = bordePorDefecto();
    p.streetEdge = 0;
  }
})();

const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

const persist = debounce(() => {
  P.cur.updatedAt = new Date().toISOString();
  const ok = saveProject(P.cur);
  pushSnapshot(P.cur);
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
  P.cur = normalize(p);
  touch();
}

/** Rellena los campos que falten para que un proyecto de otra versión encaje. */
function normalize(p) {
  const d = emptyProject();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  p.settings = Object.assign({}, d.settings, p.settings);
  return p;
}

/** Resumen de un proyecto, para enseñar qué trae un fichero antes de cargarlo. */
export function describeProject(p) {
  const zs = (p.points || []).filter(q => Number.isFinite(q.z)).map(q => q.z);
  return {
    name: p.name || 'sin nombre',
    visitDate: p.visitDate || '—',
    updatedAt: p.updatedAt || null,
    nPoints: (p.points || []).length,
    nPending: (p.pending || []).length,
    nTrees: (p.trees || []).length,
    nPhotos: (p.photos || []).length,
    drop: zs.length ? Math.max(...zs) - Math.min(...zs) : 0,
    area: (p.boundary || []).length >= 3 ? polyArea(p.boundary) : 0,
  };
}

/**
 * Combina un proyecto importado con el actual en vez de sustituirlo.
 *
 * Sirve para juntar dos jornadas o dos teléfonos: las cotas del fichero se
 * añaden a las que ya hay, y las estaciones que resulten medidas se retiran de
 * la cola de pendientes. Nada se pisa: ante un choque, manda lo que ya estaba.
 *
 * @returns {{cotas:number, arboles:number, fotos:number, descartadas:number}}
 */
export function mergeProject(inc) {
  const p = P.cur;
  const q = normalize(structuredClone(inc));
  const res = { cotas: 0, arboles: 0, fotos: 0, descartadas: 0 };

  const yaEsta = (arr, o, dist) =>
    arr.some(a => a.id === o.id || Math.hypot(a.x - o.x, a.y - o.y) < dist);

  for (const pt of q.points) {
    if (yaEsta(p.points, pt, 0.3)) { res.descartadas++; continue; }
    // Etiqueta única: dos jornadas pueden traer ambas un "M7"
    let label = pt.label;
    if (p.points.some(a => a.label === label)) label = nextLabel(p.points, 'I');
    p.points.push({ ...pt, label });
    res.cotas++;
  }
  for (const t of q.trees) {
    if (yaEsta(p.trees, t, 0.5)) continue;
    p.trees.push({ ...t, label: p.trees.some(a => a.label === t.label) ? nextLabel(p.trees, 'A') : t.label });
    res.arboles++;
  }
  for (const f of q.photos) {
    if (p.photos.some(a => a.id === f.id)) continue;
    p.photos.push(f);
    res.fotos++;
  }

  // Si aquí no había malla, se adopta la del fichero
  if (!p.pending.length && q.pending.length) p.pending = q.pending;
  // Y se retiran las estaciones que hayan quedado medidas
  const tol = Math.min(p.settings.gridDx || 3, p.settings.gridDy || 5) * 0.4;
  p.pending = p.pending.filter(st => !p.points.some(pt => Math.hypot(pt.x - st.x, pt.y - st.y) < tol));

  if (p.boundary.length < 3 && q.boundary.length >= 3) {
    p.boundary = q.boundary;
    p.streetEdge = q.streetEdge;
    p.boundaryAssumed = q.boundaryAssumed;
  }
  touch();
  return res;
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

/**
 * Genera las estaciones de malla dentro del borde, en orden de recorrido.
 *
 * `order`:
 *   'cols'    — serpiente por líneas a lo largo (columnas de X constante).
 *               Es el orden del método de la cuerda nivelada: cada línea es un
 *               tendido, se recorre entera y luego se mueven los palos.
 *   'boustro' — serpiente por filas a lo ancho.
 *   'rows'    — filas, siempre en el mismo sentido.
 */
export function makeGrid(dx, dy, order = 'cols') {
  const p = P.cur;
  if (p.boundary.length < 3) return 0;
  const bb = bbox(p.boundary);
  // Tolerancia hacia dentro: acepta también puntos justo sobre el borde.
  const inPoly = (x, y) => pointInPoly(x, y, p.boundary) || distToPoly(x, y, p.boundary) < 0.02;

  // Posiciones de cada eje. El último paso rara vez cae justo en el borde: si
  // sobra bastante se añade el borde como posición extra, y si sobra poco se
  // desplaza la última hasta él. Sin esto quedaría una franja sin medir cuyas
  // curvas de nivel serían pura extrapolación, o dos líneas a medio metro.
  const axis = (min, max, step) => {
    const out = [];
    for (let v = min; v <= max + 1e-9; v += step) out.push(v);
    const rest = max - out[out.length - 1];
    if (rest > step * 0.35) out.push(max);
    else if (rest > 1e-6) out[out.length - 1] = max;
    return out;
  };
  const xs = axis(bb.x0, bb.x1, dx);
  const ys = axis(bb.y0, bb.y1, dy);

  const byCols = order === 'cols';
  // Eje que recorre cada línea y eje que separa una línea de la siguiente
  const lineAt = byCols ? xs : ys;       // posición de cada línea
  const alongAt = byCols ? ys : xs;      // posiciones dentro de la línea
  const stepAlong = byCols ? dy : dx;

  const lines = [];
  for (let i = 0; i < lineAt.length; i++) {
    const v = lineAt[i];
    // Cortes de la línea con el borde: en una parcela inclinada la malla
    // rectangular deja fuera las franjas laterales, que son justo donde hace
    // falta saber la cota para replantear un cierre o un muro.
    const crossings = edgeCrossings(v, p.boundary, byCols ? 'x' : 'y');
    const line = crossings.map(w => (byCols ? { x: v, y: w } : { x: w, y: v }));

    for (const w of alongAt) {
      const pt = byCols ? { x: v, y: w } : { x: w, y: v };
      if (!inPoly(pt.x, pt.y)) continue;
      const key = byCols ? 'y' : 'x';
      if (line.some(c => Math.abs(c[key] - w) < stepAlong * 0.3)) continue;
      line.push(pt);
    }

    const key = byCols ? 'y' : 'x';
    line.sort((a, b) => a[key] - b[key]);

    // Extremos del tendido: hacen falta para corregir la flecha de la cuerda,
    // que es una parábola entre los dos apoyos.
    const lo = crossings.length ? crossings[0] : line[0]?.[key];
    const hi = crossings.length ? crossings[crossings.length - 1] : line[line.length - 1]?.[key];
    const span = (hi ?? 0) - (lo ?? 0);

    if (order !== 'rows' && i % 2 === 1) line.reverse();
    lines.push(line.map(pt => ({ ...pt, line: i, d: pt[key] - (lo ?? 0), L: span })));
  }

  const done = p.points;
  const tol = Math.min(dx, dy) * 0.4;
  const list = [];
  const push = (x, y, label, line, d = 0, L = 0) => {
    if (done.some(q => Math.hypot(q.x - x, q.y - y) < tol)) return;
    if (list.some(q => Math.hypot(q.x - x, q.y - y) < tol)) return;
    list.push({ id: uid(), x, y, label, line, d, L });
  };

  // Las esquinas van primero: fijan el marco de la parcela y conviene tenerlas
  // medidas antes de empezar a recorrer la malla.
  p.boundary.forEach((v, i) => push(v.x, v.y, 'E' + (i + 1), -1));

  let n = 1;
  for (const line of lines) for (const c of line) push(c.x, c.y, 'M' + (n++), c.line, c.d, c.L);
  p.pending = list;
  p.settings.gridDx = dx; p.settings.gridDy = dy; p.settings.gridOrder = order;
  p.settings.nLines = lineAt.length;
  touch(false);
  return list.length;
}

/**
 * Cortes del borde con una recta paralela a un eje.
 * `along='x'` → recta vertical x = v, devuelve las Y.
 * `along='y'` → recta horizontal y = v, devuelve las X.
 */
function edgeCrossings(v, poly, along) {
  const out = [];
  const fixed = along === 'x' ? 'x' : 'y';
  const free = along === 'x' ? 'y' : 'x';
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if (Math.abs(b[fixed] - a[fixed]) < 1e-9) continue;    // arista paralela a la recta
    const t = (v - a[fixed]) / (b[fixed] - a[fixed]);
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    out.push(a[free] + (b[free] - a[free]) * t);
  }
  out.sort((p, q) => p - q);
  // Elimina duplicados en los vértices, donde coinciden dos aristas
  return out.filter((w, i) => i === 0 || w - out[i - 1] > 1e-6);
}

export function makeRect(w, h) {
  P.cur.boundary = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  if (P.cur.streetEdge < 0) P.cur.streetEdge = 0;   // por defecto, la calle es el lado y=0
  touch();
}
