// coverage.js — cobertura fotográfica de la parcela.
// Cada foto cubre un sector circular definido por su rumbo, ángulo de visión y alcance.
// Convención de rumbo: 0° mira hacia +Y local y crece en sentido horario.

import { norm360 } from './util.js';

/** Vector unitario de dirección para un rumbo en grados. */
export function bearingVec(b) {
  const r = b * Math.PI / 180;
  return { x: Math.sin(r), y: Math.cos(r) };
}

/** Rumbo (0-360) desde un punto hacia otro. */
export function bearingTo(from, to) {
  return norm360(Math.atan2(to.x - from.x, to.y - from.y) * 180 / Math.PI);
}

/** Diferencia angular con signo, en [-180, 180]. */
export function angDiff(a, b) {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return d;
}

function covers(ph, wx, wy) {
  const dx = wx - ph.x, dy = wy - ph.y;
  const dist = Math.hypot(dx, dy);
  if (dist > (ph.range || 25)) return false;
  if (dist < 0.4) return true;                       // el propio pie de la estación
  const b = Math.atan2(dx, dy) * 180 / Math.PI;
  return Math.abs(angDiff(b, ph.bearing)) <= (ph.fov || 70) / 2;
}

/**
 * Rejilla de cobertura alineada con la superficie.
 * @returns {{data:Uint8Array, total:number, seen:number, pct:number}}
 */
export function coverageGrid(surf, photos) {
  const { nx, ny, res, x0, y0, z } = surf;
  const data = new Uint8Array(nx * ny);
  let total = 0, seen = 0;
  for (let j = 0; j < ny; j++) {
    const wy = y0 + j * res;
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      if (Number.isNaN(z[idx])) continue;             // fuera del borde
      total++;
      const wx = x0 + i * res;
      for (const ph of photos) {
        if (covers(ph, wx, wy)) { data[idx] = 1; seen++; break; }
      }
    }
  }
  return { data, total, seen, pct: total ? seen / total * 100 : 0 };
}

/**
 * Busca la estación (posición + rumbo) que más superficie nueva cubriría.
 * Búsqueda voraz sobre una malla gruesa de posiciones × 16 rumbos.
 */
export function suggestStation(surf, photos, opts = {}) {
  const range = opts.range ?? 25, fov = opts.fov ?? 70;
  const { nx, ny, res, x0, y0, z } = surf;
  if (surf.empty) return null;

  // Submuestreo: como mucho ~40×40 celdas de evaluación y ~14×14 candidatos.
  const evStep = Math.max(1, Math.ceil(Math.max(nx, ny) / 40));
  const caStep = Math.max(1, Math.ceil(Math.max(nx, ny) / 14));

  const cov = coverageGrid(surf, photos);
  const targets = [];
  for (let j = 0; j < ny; j += evStep) {
    for (let i = 0; i < nx; i += evStep) {
      const idx = j * nx + i;
      if (Number.isNaN(z[idx]) || cov.data[idx]) continue;
      targets.push({ x: x0 + i * res, y: y0 + j * res });
    }
  }
  if (!targets.length) return null;

  let best = null;
  for (let j = 0; j < ny; j += caStep) {
    for (let i = 0; i < nx; i += caStep) {
      const idx = j * nx + i;
      if (Number.isNaN(z[idx])) continue;
      const px = x0 + i * res, py = y0 + j * res;

      // Rumbos hacia cada objetivo, agrupados en 16 sectores
      const hist = new Array(16).fill(0);
      for (const t of targets) {
        const dx = t.x - px, dy = t.y - py;
        const d = Math.hypot(dx, dy);
        if (d > range) continue;
        const b = norm360(Math.atan2(dx, dy) * 180 / Math.PI);
        // Reparte el objetivo entre los sectores dentro del campo de visión
        for (let s = 0; s < 16; s++) {
          const sb = s * 22.5;
          if (Math.abs(angDiff(b, sb)) <= fov / 2) hist[s]++;
        }
      }
      for (let s = 0; s < 16; s++) {
        if (!best || hist[s] > best.gain) best = { x: px, y: py, bearing: s * 22.5, gain: hist[s] };
      }
    }
  }
  if (!best || best.gain === 0) return null;
  best.pctGain = best.gain / targets.length * (100 - cov.pct);
  best.remaining = 100 - cov.pct;
  return best;
}
