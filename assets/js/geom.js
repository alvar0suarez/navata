// geom.js — geometría, interpolación de superficie y curvas de nivel.
// Todo en coordenadas locales: X e Y en metros, Z en metros relativos al datum.

import { clamp } from './util.js';

/* ───────────────────────── polígonos ───────────────────────── */

export function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function polyPerimeter(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    s += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return s;
}

export function bbox(pts) {
  if (!pts.length) return { x0: 0, y0: 0, x1: 1, y1: 1, w: 1, h: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Ray casting. Devuelve true si (x,y) está dentro del polígono. */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Distancia mínima de un punto a un segmento. */
export function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distToPoly(x, y, poly) {
  let d = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    d = Math.min(d, distToSeg(x, y, p.x, p.y, q.x, q.y));
  }
  return d;
}

/* ───────────────────── trilateración de la parcela ───────────────────── */

/** Intersección de dos circunferencias. Devuelve [p1, p2] o null si no se cortan. */
export function intersectCircles(c0, r0, c1, r1) {
  const dx = c1.x - c0.x, dy = c1.y - c0.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return null;                       // concéntricas
  if (d > r0 + r1 + 1e-9) return null;             // demasiado separadas
  if (d < Math.abs(r0 - r1) - 1e-9) return null;   // una dentro de la otra
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h2 = r0 * r0 - a * a;
  const h = Math.sqrt(Math.max(h2, 0));
  const mx = c0.x + a * dx / d, my = c0.y + a * dy / d;
  return [
    { x: mx + h * dy / d, y: my - h * dx / d },
    { x: mx - h * dy / d, y: my + h * dx / d },
  ];
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * Reconstruye un cuadrilátero a partir de sus cuatro lados y una diagonal.
 *
 * Los cuatro lados NO bastan: un cuadrilátero con lados fijos sigue siendo
 * articulado. La diagonal p lo parte en dos triángulos, y un triángulo sí queda
 * determinado por sus tres lados.
 *
 * Vértices: V0 en el origen, V1 sobre el eje +X (el lado `a` es el frente de la
 * calle). La parcela crece hacia +Y.
 *
 *   a = V0→V1 (calle) · b = V1→V2 · c = V2→V3 · d = V3→V0 · p = V0→V2
 *
 * @param {number} [q] segunda diagonal V1→V3; si se pasa, se usa para comprobar
 *                     el cierre y se devuelve el desajuste en `check`.
 * @returns {{ok:true, poly:Array, check:?number}|{ok:false, error:string}}
 */
export function quadFromSides(a, b, c, d, p, q) {
  const vals = { a, b, c, d, p };
  for (const [k, v] of Object.entries(vals)) {
    if (!Number.isFinite(v) || v <= 0) return { ok: false, error: `Falta la medida ${k} o no es válida.` };
  }
  const tri = (x, y, z, names) => {
    if (x + y <= z + 1e-9 || y + z <= x + 1e-9 || x + z <= y + 1e-9)
      return `El triángulo ${names} no cierra: ${x} + ${y} + ${z} incumple la desigualdad triangular. Repasa esas tres medidas.`;
    return null;
  };
  const e1 = tri(a, b, p, 'calle–lateral–diagonal');
  if (e1) return { ok: false, error: e1 };
  const e2 = tri(p, c, d, 'diagonal–fondo–lateral');
  if (e2) return { ok: false, error: e2 };

  const V0 = { x: 0, y: 0 }, V1 = { x: a, y: 0 };

  const s2 = intersectCircles(V0, p, V1, b);
  if (!s2) return { ok: false, error: 'La diagonal no es compatible con los lados: revisa las medidas.' };
  const V2 = s2[0].y > s2[1].y ? s2[0] : s2[1];        // la parcela crece hacia +Y

  const s3 = intersectCircles(V0, d, V2, c);
  if (!s3) return { ok: false, error: 'El lado del fondo no cierra con la diagonal: revisa las medidas.' };
  // V3 debe caer al otro lado de la diagonal V0–V2 que V1, o el polígono se cruza.
  const sideOfV1 = Math.sign(cross(V0, V2, V1));
  let V3 = s3.find(s => Math.sign(cross(V0, V2, s)) === -sideOfV1) || s3[0];

  const poly = [V0, V1, V2, V3];

  // Orientación antihoraria, para que las áreas y los normales salgan coherentes
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const u = poly[i], v = poly[(i + 1) % 4];
    area += u.x * v.y - v.x * u.y;
  }
  if (area < 0) { poly.reverse(); poly.unshift(poly.pop()); }

  let check = null;
  if (Number.isFinite(q) && q > 0) {
    const i1 = poly.findIndex(v => v === V1), i3 = poly.findIndex(v => v === V3);
    check = Math.hypot(poly[i1].x - poly[i3].x, poly[i1].y - poly[i3].y) - q;
  }
  return { ok: true, poly, check };
}

/**
 * Variante sin diagonal: se supone ángulo recto en la esquina del origen.
 * Menos fiable —una parcela real rara vez está a escuadra— pero sirve cuando no
 * se ha podido medir ninguna diagonal.
 */
export function quadFromSidesSquare(a, b, c, d) {
  for (const v of [a, b, c, d]) if (!Number.isFinite(v) || v <= 0)
    return { ok: false, error: 'Faltan medidas o no son válidas.' };
  const V0 = { x: 0, y: 0 }, V1 = { x: a, y: 0 }, V3 = { x: 0, y: d };
  const s = intersectCircles(V1, b, V3, c);
  if (!s) return { ok: false, error: 'Con la esquina a escuadra esos cuatro lados no cierran.' };
  const V2 = s[0].y > s[1].y ? s[0] : s[1];
  return { ok: true, poly: [V0, V1, V2, V3], check: null, assumption: 'escuadra' };
}

/**
 * Variante sin diagonal: se supone el fondo paralelo a la calle (trapecio).
 * Suele ajustar mejor que la escuadra en parcelas de una manzana, donde los
 * fondos siguen la línea de la calle de detrás.
 */
export function quadFromSidesTrapezoid(a, b, c, d) {
  for (const v of [a, b, c, d]) if (!Number.isFinite(v) || v <= 0)
    return { ok: false, error: 'Faltan medidas o no son válidas.' };
  if (Math.abs(c - a) < 1e-6) {
    if (Math.abs(b - d) > 0.02)
      return { ok: false, error: 'Si el fondo mide igual que el frente, el trapecio obliga a que los dos laterales sean iguales, y no lo son. Usa la escuadra o mide una diagonal.' };
    // Paralelogramo: queda indeterminado, se recurre a la escuadra
    return quadFromSidesSquare(a, b, c, d);
  }
  // V3 = (t, h) · V2 = (t + c, h) con el fondo paralelo al frente
  const t = (b * b - d * d - (c - a) * (c - a)) / (2 * (c - a));
  const h2 = d * d - t * t;
  if (h2 <= 0) return { ok: false, error: 'Con el fondo paralelo a la calle esos cuatro lados no cierran.' };
  const h = Math.sqrt(h2);
  return {
    ok: true,
    poly: [{ x: 0, y: 0 }, { x: a, y: 0 }, { x: t + c, y: h }, { x: t, y: h }],
    check: null, assumption: 'fondo paralelo',
  };
}

/** ¿Se cortan los segmentos pq y rs? Usado para descartar polígonos cruzados. */
function segsCross(p, q, r, s) {
  const d1 = cross(r, s, p), d2 = cross(r, s, q);
  const d3 = cross(p, q, r), d4 = cross(p, q, s);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Cuadrilátero de la familia correspondiente a un ángulo θ en la esquina del
 * origen (entre el frente A y el lateral D). Null si con ese ángulo no cierra
 * o el polígono se cruza.
 */
export function quadAtTheta(a, b, c, d, theta) {
  const V0 = { x: 0, y: 0 }, V1 = { x: a, y: 0 };
  const V3 = { x: d * Math.cos(theta), y: d * Math.sin(theta) };
  const sols = intersectCircles(V1, b, V3, c);
  if (!sols) return null;
  for (const V2 of [sols[0], sols[1]]) {
    if (segsCross(V0, V1, V2, V3) || segsCross(V1, V2, V3, V0)) continue;
    if (V2.y <= 0) continue;                       // la parcela crece hacia +Y
    const poly = [V0, V1, V2, V3];
    if (polyArea(poly) < 1e-6) continue;
    return poly;
  }
  return null;
}

/**
 * Determina la forma con los cuatro lados más UNA distancia medida sobre el
 * terreno: al recorrer una fila de la malla, lo que mide la cinta desde el eje
 * Y hasta la valla.
 *
 * Es el sustituto barato de la diagonal. La familia de cuadriláteros compatible
 * con cuatro lados tiene un solo grado de libertad, así que un único dato extra
 * basta para fijarla — y ese dato se toma sin desviarse del recorrido.
 *
 * @param {number} y   distancia desde la calle a la que se hizo la medida
 * @param {number} x   distancia medida desde el eje Y hasta la valla
 * @param {'izq'|'der'} side  valla medida
 */
export function quadFromSidesAndEdge(a, b, c, d, y, x, side) {
  for (const v of [a, b, c, d, y, x]) if (!Number.isFinite(v))
    return { ok: false, error: 'Faltan medidas o no son válidas.' };
  if (y <= 0) return { ok: false, error: 'La distancia desde la calle debe ser mayor que cero.' };

  // Corte de la fila `y` con el lateral elegido: izquierda = V3→V0, derecha = V1→V2
  const crossing = poly => {
    const [V0, V1, V2, V3] = poly;
    const [p, q] = side === 'izq' ? [V3, V0] : [V1, V2];
    if (Math.abs(q.y - p.y) < 1e-9) return null;
    const t = (y - p.y) / (q.y - p.y);
    if (t < -1e-6 || t > 1 + 1e-6) return null;    // la fila no corta ese lado
    return p.x + (q.x - p.x) * t;
  };

  const err = th => {
    const poly = quadAtTheta(a, b, c, d, th);
    if (!poly) return null;
    const cx = crossing(poly);
    return cx === null ? null : Math.abs(cx - x);
  };

  // Barrido grueso y afinado local
  let best = null;
  const N = 1440;
  for (let k = 1; k < N; k++) {
    const th = Math.PI * k / N;
    const e = err(th);
    if (e !== null && (!best || e < best.e)) best = { th, e };
  }
  if (!best) return { ok: false, error: 'Ninguna forma compatible con esos lados alcanza esa medida. Repasa los números.' };

  let step = Math.PI / N;
  for (let it = 0; it < 60; it++) {
    step /= 2;
    for (const th of [best.th - step, best.th + step]) {
      const e = err(th);
      if (e !== null && e < best.e) best = { th, e };
    }
  }

  if (best.e > 0.05) {
    return { ok: false, error: `Con esos cuatro lados, lo más cerca que se llega de tu medida es ${(best.e * 100).toFixed(0)} cm. Alguna cinta no cuadra: repasa los lados o la distancia a la valla.` };
  }
  const poly = quadAtTheta(a, b, c, d, best.th);
  if (!poly) return { ok: false, error: 'No se pudo cerrar la figura.' };
  return { ok: true, poly, check: null, assumption: null, residual: best.e };
}

/**
 * Recorre toda la familia de cuadriláteros compatibles con cuatro lados dados.
 *
 * Con los lados fijos el cuadrilátero sigue teniendo un grado de libertad: se
 * abre y se cierra como una tijera. Barriendo el ángulo de la esquina del
 * origen se obtiene el abanico completo de formas posibles, y con él una medida
 * honesta de cuánta incertidumbre queda por no haber medido la diagonal.
 *
 * @returns {{ok:true, areaMin, areaMax, spread:number, diagMin, diagMax}|{ok:false, error}}
 */
export function quadFlex(a, b, c, d, samples = 720) {
  for (const v of [a, b, c, d]) if (!Number.isFinite(v) || v <= 0)
    return { ok: false, error: 'Faltan medidas.' };

  let areaMin = Infinity, areaMax = -Infinity;
  let diagMin = Infinity, diagMax = -Infinity;
  const v2s = [], v3s = [];

  for (let k = 1; k < samples; k++) {
    const th = Math.PI * k / samples;
    const V0 = { x: 0, y: 0 }, V1 = { x: a, y: 0 };
    const V3 = { x: d * Math.cos(th), y: d * Math.sin(th) };
    const sols = intersectCircles(V1, b, V3, c);
    if (!sols) continue;

    for (const V2 of sols) {
      const poly = [V0, V1, V2, V3];
      // descarta polígonos cruzados: los lados no contiguos no deben cortarse
      if (segsCross(V0, V1, V2, V3) || segsCross(V1, V2, V3, V0)) continue;
      const ar = polyArea(poly);
      if (ar < 1e-6) continue;
      const diag = Math.hypot(V2.x, V2.y);
      if (ar < areaMin) areaMin = ar;
      if (ar > areaMax) areaMax = ar;
      if (diag < diagMin) diagMin = diag;
      if (diag > diagMax) diagMax = diag;
      v2s.push(V2); v3s.push(V3);
    }
  }
  if (!v2s.length) return { ok: false, error: 'Esos cuatro lados no cierran ninguna figura.' };

  // Cuánto puede desplazarse cada esquina del fondo entre los extremos
  const spreadOf = arr => {
    let m = 0;
    for (let i = 0; i < arr.length; i++) {
      m = Math.max(m, Math.hypot(arr[i].x - arr[0].x, arr[i].y - arr[0].y));
      m = Math.max(m, Math.hypot(arr[i].x - arr[arr.length - 1].x, arr[i].y - arr[arr.length - 1].y));
    }
    return m;
  };
  return {
    ok: true, areaMin, areaMax,
    spread: Math.max(spreadOf(v2s), spreadOf(v3s)),
    diagMin, diagMax,
  };
}

/* ───────────────────── interpolación de superficie ───────────────────── */

/**
 * Ajusta un spline de placa delgada (thin-plate spline) a las cotas.
 * Es la superficie más suave que pasa por todos los puntos, así que —a diferencia
 * del IDW— no genera los "ojos de buey" que estropean el cálculo de pendientes.
 *
 * Resuelve el sistema  [A P; Pᵀ 0]·[w; c] = [z; 0]  con  φ(r) = r²·ln(r).
 * @returns función evaluadora (x,y) → z, o null si el sistema es singular.
 */
export function fitTPS(pts, lambda = 0) {
  const n = pts.length;
  if (n < 3) return null;
  const m = n + 3;

  const M = Array.from({ length: m }, () => new Float64Array(m + 1));
  const phi = r2 => (r2 <= 1e-12 ? 0 : 0.5 * r2 * Math.log(r2));   // r²·ln r = ½·r²·ln(r²)

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      M[i][j] = phi(dx * dx + dy * dy);
    }
    M[i][i] += lambda;
    M[i][n] = 1; M[i][n + 1] = pts[i].x; M[i][n + 2] = pts[i].y;
    M[n][i] = 1; M[n + 1][i] = pts[i].x; M[n + 2][i] = pts[i].y;
    M[i][m] = pts[i].z;
  }

  // Eliminación gaussiana con pivoteo parcial
  for (let c = 0; c < m; c++) {
    let piv = c, best = Math.abs(M[c][c]);
    for (let r = c + 1; r < m; r++) {
      const v = Math.abs(M[r][c]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-12) return null;                     // singular: puntos alineados o repetidos
    if (piv !== c) { const t = M[c]; M[c] = M[piv]; M[piv] = t; }
    const d = M[c][c];
    for (let r = c + 1; r < m; r++) {
      const f = M[r][c] / d;
      if (f === 0) continue;
      for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
    }
  }
  const sol = new Float64Array(m);
  for (let r = m - 1; r >= 0; r--) {
    let s = M[r][m];
    for (let k = r + 1; k < m; k++) s -= M[r][k] * sol[k];
    sol[r] = s / M[r][r];
  }
  if (!sol.every(Number.isFinite)) return null;

  const xs = Float64Array.from(pts, p => p.x);
  const ys = Float64Array.from(pts, p => p.y);
  const a0 = sol[n], a1 = sol[n + 1], a2 = sol[n + 2];

  return (x, y) => {
    let s = a0 + a1 * x + a2 * y;
    for (let i = 0; i < n; i++) {
      const dx = x - xs[i], dy = y - ys[i];
      const r2 = dx * dx + dy * dy;
      if (r2 > 1e-12) s += sol[i] * 0.5 * r2 * Math.log(r2);
    }
    return s;
  };
}

/**
 * Construye una rejilla regular de elevaciones a partir de cotas dispersas.
 * Usa spline de placa delgada cuando el número de puntos lo permite y recurre
 * a IDW (inverso de la distancia) en conjuntos grandes o casos degenerados.
 * Las celdas fuera del borde quedan NaN.
 *
 * @returns {{nx,ny,res,x0,y0,z:Float32Array,zmin,zmax,valid:number,method:string}}
 */
export function buildSurface(points, boundary, opts = {}) {
  const res = opts.res || 0.25;
  const power = opts.power ?? 2.2;
  const k = opts.k ?? 8;
  const pad = opts.pad ?? 0;

  const pts = points.filter(p => Number.isFinite(p.z));
  const src = boundary.length >= 3 ? boundary : pts;
  const bb = bbox(src);
  const x0 = bb.x0 - pad, y0 = bb.y0 - pad;
  const nx = Math.max(2, Math.ceil((bb.w + 2 * pad) / res) + 1);
  const ny = Math.max(2, Math.ceil((bb.h + 2 * pad) / res) + 1);

  const z = new Float32Array(nx * ny).fill(NaN);
  const surf = { nx, ny, res, x0, y0, z, zmin: 0, zmax: 0, valid: 0, empty: true, method: 'ninguno' };
  if (pts.length === 0) return surf;

  const clip = boundary.length >= 3;
  let zmin = Infinity, zmax = -Infinity, valid = 0;

  // El TPS es O(n³) al resolver y O(n) por celda: por encima de ~350 cotas
  // deja de compensar y se recurre a IDW.
  const maxTPS = opts.maxTPS ?? 350;
  const tps = pts.length <= maxTPS
    ? fitTPS(pts, opts.lambda ?? 1e-4 * Math.max(bb.w, bb.h) ** 2)
    : null;

  // Cota de seguridad: el TPS extrapola con tendencia lineal fuera de la nube de
  // puntos y puede dispararse en las esquinas sin medir.
  const dz = pts.reduce((a, p) => Math.max(a, p.z), -Infinity) - pts.reduce((a, p) => Math.min(a, p.z), Infinity);
  const guardLo = Math.min(...pts.map(p => p.z)) - (dz * 0.4 + 0.25);
  const guardHi = Math.max(...pts.map(p => p.z)) + (dz * 0.4 + 0.25);

  // Buffer reutilizable para los k vecinos más cercanos (distancia², índice)
  const nd = new Float64Array(k), ni = new Int32Array(k);

  for (let j = 0; j < ny; j++) {
    const wy = y0 + j * res;
    for (let i = 0; i < nx; i++) {
      const wx = x0 + i * res;
      if (clip && !pointInPoly(wx, wy, boundary)) continue;

      let v;
      if (tps) {
        v = clamp(tps(wx, wy), guardLo, guardHi);
      } else {
        let cnt = 0, exact = -1;
        for (let s = 0; s < pts.length; s++) {
          const dx = wx - pts[s].x, dy = wy - pts[s].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 1e-9) { exact = s; break; }
          if (cnt < k) {
            // inserción ordenada
            let m = cnt++;
            while (m > 0 && nd[m - 1] > d2) { nd[m] = nd[m - 1]; ni[m] = ni[m - 1]; m--; }
            nd[m] = d2; ni[m] = s;
          } else if (d2 < nd[k - 1]) {
            let m = k - 1;
            while (m > 0 && nd[m - 1] > d2) { nd[m] = nd[m - 1]; ni[m] = ni[m - 1]; m--; }
            nd[m] = d2; ni[m] = s;
          }
        }
        if (exact >= 0) {
          v = pts[exact].z;
        } else {
          let num = 0, den = 0;
          for (let m = 0; m < cnt; m++) {
            const w = 1 / Math.pow(nd[m], power / 2);
            num += w * pts[ni[m]].z;
            den += w;
          }
          v = num / den;
        }
      }

      z[j * nx + i] = v;
      if (v < zmin) zmin = v;
      if (v > zmax) zmax = v;
      valid++;
    }
  }

  if (!valid) return surf;
  surf.zmin = zmin; surf.zmax = zmax; surf.valid = valid; surf.empty = false;
  surf.method = tps ? 'spline de placa delgada' : 'IDW';
  return surf;
}

/** Suavizado ligero (media 3×3 respetando NaN). Reduce el efecto "ojo de buey" del IDW. */
export function smoothSurface(surf, passes = 1) {
  const { nx, ny } = surf;
  for (let p = 0; p < passes; p++) {
    const out = Float32Array.from(surf.z);
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const idx = j * nx + i;
        if (Number.isNaN(surf.z[idx])) continue;
        let s = 0, c = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const v = surf.z[(j + dj) * nx + (i + di)];
          if (!Number.isNaN(v)) { const w = (di === 0 && dj === 0) ? 4 : 1; s += v * w; c += w; }
        }
        out[idx] = s / c;
      }
    }
    surf.z = out;
  }
  return surf;
}

/** Muestrea la superficie en coordenadas del mundo (bilineal). NaN si fuera. */
export function sampleSurface(surf, wx, wy) {
  const { nx, ny, res, x0, y0, z } = surf;
  const fx = (wx - x0) / res, fy = (wy - y0) / res;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return NaN;
  const tx = fx - i, ty = fy - j;
  const a = z[j * nx + i], b = z[j * nx + i + 1];
  const c = z[(j + 1) * nx + i], d = z[(j + 1) * nx + i + 1];
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) {
    // Cerca del borde: vecino más próximo válido de los cuatro
    const cands = [[a, (1 - tx) * (1 - ty)], [b, tx * (1 - ty)], [c, (1 - tx) * ty], [d, tx * ty]]
      .filter(v => !Number.isNaN(v[0]));
    if (!cands.length) return NaN;
    let num = 0, den = 0;
    for (const [v, w] of cands) { num += v * w; den += w; }
    return den > 1e-6 ? num / den : cands[0][0];
  }
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/* ───────────────────────── curvas de nivel ───────────────────────── */

/**
 * Marching squares. Devuelve [{level, lines:[[{x,y},…], …]}]
 */
export function contours(surf, interval) {
  const out = [];
  if (surf.empty || !(interval > 0)) return out;
  const lo = Math.ceil(surf.zmin / interval) * interval;
  const hi = Math.floor(surf.zmax / interval) * interval;
  const n = Math.round((hi - lo) / interval);
  if (n < 0 || n > 400) return out;              // salvaguarda ante intervalos absurdos
  for (let s = 0; s <= n; s++) {
    const level = lo + s * interval;
    const segs = marchingSquares(surf, level);
    if (segs.length) out.push({ level, lines: joinSegments(segs, surf.res * 0.35) });
  }
  return out;
}

function marchingSquares(surf, L) {
  const { nx, ny, res, x0, y0, z } = surf;
  const segs = [];
  const ip = (za, zb, pa, pb) => {          // interpolación lineal sobre la arista
    const t = (L - za) / (zb - za);
    return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
  };

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const z0 = z[j * nx + i],           // esquina inferior-izquierda
            z1 = z[j * nx + i + 1],       // inferior-derecha
            z2 = z[(j + 1) * nx + i + 1], // superior-derecha
            z3 = z[(j + 1) * nx + i];     // superior-izquierda
      if (Number.isNaN(z0) || Number.isNaN(z1) || Number.isNaN(z2) || Number.isNaN(z3)) continue;

      const idx = (z0 > L ? 1 : 0) | (z1 > L ? 2 : 0) | (z2 > L ? 4 : 0) | (z3 > L ? 8 : 0);
      if (idx === 0 || idx === 15) continue;

      const px = x0 + i * res, py = y0 + j * res;
      const c0 = { x: px, y: py }, c1 = { x: px + res, y: py },
            c2 = { x: px + res, y: py + res }, c3 = { x: px, y: py + res };
      const eB = () => ip(z0, z1, c0, c1);   // arista inferior
      const eR = () => ip(z1, z2, c1, c2);   // derecha
      const eT = () => ip(z3, z2, c3, c2);   // superior
      const eL = () => ip(z0, z3, c0, c3);   // izquierda

      switch (idx) {
        case 1: case 14: segs.push([eL(), eB()]); break;
        case 2: case 13: segs.push([eB(), eR()]); break;
        case 3: case 12: segs.push([eL(), eR()]); break;
        case 4: case 11: segs.push([eR(), eT()]); break;
        case 6: case  9: segs.push([eB(), eT()]); break;
        case 7: case  8: segs.push([eL(), eT()]); break;
        case 5:  // silla: promedio del centro decide la conexión
          if ((z0 + z1 + z2 + z3) / 4 > L) { segs.push([eL(), eT()]); segs.push([eB(), eR()]); }
          else { segs.push([eL(), eB()]); segs.push([eR(), eT()]); }
          break;
        case 10:
          if ((z0 + z1 + z2 + z3) / 4 > L) { segs.push([eL(), eB()]); segs.push([eR(), eT()]); }
          else { segs.push([eL(), eT()]); segs.push([eB(), eR()]); }
          break;
      }
    }
  }
  return segs;
}

/** Une segmentos sueltos en polilíneas encadenando extremos coincidentes. */
function joinSegments(segs, tol) {
  const key = p => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const map = new Map();
  const push = (k, s) => { if (!map.has(k)) map.set(k, []); map.get(k).push(s); };
  const items = segs.map(s => ({ a: s[0], b: s[1], used: false }));
  for (const s of items) { push(key(s.a), s); push(key(s.b), s); }

  const lines = [];
  for (const s of items) {
    if (s.used) continue;
    s.used = true;
    const line = [s.a, s.b];

    // extiende por el final y luego por el principio
    for (const dir of [1, 0]) {
      for (;;) {
        const end = dir ? line[line.length - 1] : line[0];
        const cand = (map.get(key(end)) || []).find(t => !t.used);
        if (!cand) break;
        cand.used = true;
        const near = Math.hypot(cand.a.x - end.x, cand.a.y - end.y) < tol * 2;
        const nxt = near ? cand.b : cand.a;
        if (dir) line.push(nxt); else line.unshift(nxt);
        if (line.length > 20000) break;
      }
    }
    if (line.length > 1) lines.push(line);
  }
  return lines;
}

/* ───────────────────────── pendiente y sombreado ───────────────────────── */

/** Pendiente en % por celda (gradiente por diferencias centrales). */
export function slopeGrid(surf) {
  const { nx, ny, res, z } = surf;
  const out = new Float32Array(nx * ny).fill(NaN);
  let max = 0;
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const c = z[j * nx + i];
      if (Number.isNaN(c)) continue;
      const l = z[j * nx + i - 1], r = z[j * nx + i + 1];
      const d = z[(j - 1) * nx + i], u = z[(j + 1) * nx + i];
      const dzdx = (Number.isNaN(l) || Number.isNaN(r)) ? 0 : (r - l) / (2 * res);
      const dzdy = (Number.isNaN(d) || Number.isNaN(u)) ? 0 : (u - d) / (2 * res);
      const s = Math.hypot(dzdx, dzdy) * 100;
      out[j * nx + i] = s;
      if (s > max) max = s;
    }
  }
  return { data: out, max };
}

/** Sombreado analítico estándar (azimut 315°, altura solar 45°). */
export function hillshade(surf, zFactor = 4) {
  const { nx, ny, res, z } = surf;
  const out = new Float32Array(nx * ny).fill(NaN);
  const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180;
  const sinAlt = Math.sin(alt), cosAlt = Math.cos(alt);
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const c = z[j * nx + i];
      if (Number.isNaN(c)) continue;
      const l = z[j * nx + i - 1], r = z[j * nx + i + 1];
      const d = z[(j - 1) * nx + i], u = z[(j + 1) * nx + i];
      const dzdx = ((Number.isNaN(r) ? c : r) - (Number.isNaN(l) ? c : l)) / (2 * res) * zFactor;
      const dzdy = ((Number.isNaN(u) ? c : u) - (Number.isNaN(d) ? c : d)) / (2 * res) * zFactor;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      let v = cosAlt * Math.cos(slope) + sinAlt * Math.sin(slope) * Math.cos(az - aspect);
      out[j * nx + i] = clamp(v, 0, 1);
    }
  }
  return out;
}

/* ───────────────────────── perfil longitudinal ───────────────────────── */

export function profileAlong(surf, a, b, samples = 200) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    pts.push({ d: len * t, x, y, z: sampleSurface(surf, x, y) });
  }
  const valid = pts.filter(p => !Number.isNaN(p.z));
  if (valid.length < 2) return { pts, len, drop: 0, slope: 0, zmin: 0, zmax: 0 };
  const zmin = Math.min(...valid.map(p => p.z)), zmax = Math.max(...valid.map(p => p.z));
  const drop = valid[valid.length - 1].z - valid[0].z;
  const run = valid[valid.length - 1].d - valid[0].d;
  return { pts, len, drop, slope: run > 0 ? drop / run * 100 : 0, zmin, zmax };
}

/* ───────────────────────── rampa de color hipsométrica ───────────────────────── */

const RAMP = [
  [0.00, [ 33,  86,  60]],
  [0.22, [ 74, 134,  62]],
  [0.42, [148, 174,  72]],
  [0.60, [214, 196, 105]],
  [0.78, [206, 152,  86]],
  [1.00, [232, 226, 214]],
];

export function hypsoColor(t) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export function slopeColor(pct) {
  // 0 % verde · 10 % amarillo · 25 % naranja · 40 %+ rojo
  const stops = [[0, [46, 160, 100]], [10, [214, 196, 105]], [25, [224, 148, 72]], [40, [220, 74, 78]]];
  if (pct <= 0) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (pct <= stops[i][0]) {
      const [p0, c0] = stops[i - 1], [p1, c1] = stops[i];
      const f = (pct - p0) / (p1 - p0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/* ───────────────────────── geodesia local ───────────────────────── */

/**
 * Convierte coordenadas locales (m) a lat/lon usando el anclaje.
 * anchor = {lat, lon, rot} donde rot = rumbo del eje +Y respecto al norte geográfico.
 */
export function localToLatLon(x, y, anchor) {
  const r = (anchor.rot || 0) * Math.PI / 180;
  // Rota el sistema local para alinear +Y con el rumbo indicado
  const north = y * Math.cos(r) - x * Math.sin(r);
  const east  = y * Math.sin(r) + x * Math.cos(r);
  const lat = anchor.lat + north / 111320;
  const lon = anchor.lon + east / (111320 * Math.cos(anchor.lat * Math.PI / 180));
  return { lat, lon };
}

export function latLonToLocal(lat, lon, anchor) {
  const north = (lat - anchor.lat) * 111320;
  const east = (lon - anchor.lon) * 111320 * Math.cos(anchor.lat * Math.PI / 180);
  const r = -(anchor.rot || 0) * Math.PI / 180;
  const y = north * Math.cos(r) - east * Math.sin(r);
  const x = north * Math.sin(r) + east * Math.cos(r);
  return { x, y };
}
