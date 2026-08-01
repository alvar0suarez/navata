// render2d.js — dibujo del plano: relieve, curvas de nivel, cotas, árboles y conos de foto.

import { P, surface } from './state.js';
import { hypsoColor, slopeColor, hillshade, slopeGrid, bbox, pointInPoly } from './geom.js';
import { clamp, rad, fmtZ } from './util.js';
import { coverageGrid } from './coverage.js';

export const view = { scale: 20, tx: 0, ty: 0, dpr: 1 };
export const layers = {
  hypso: false, hillshade: false, contours: true, slope: false,
  coverage: false, grid: true, labels: true,
};

let raster = null;        // ImageData cacheada del relieve
let rasterKey = '';

/* ── transformaciones mundo ↔ pantalla ── */
// El eje Y del mundo apunta hacia arriba; el del canvas hacia abajo.
export const w2sx = x => x * view.scale + view.tx;
export const w2sy = y => -y * view.scale + view.ty;
export const s2wx = sx => (sx - view.tx) / view.scale;
export const s2wy = sy => -(sy - view.ty) / view.scale;

let pendingFit = true;
/** true si aún no se ha podido encajar la vista (el canvas estaba oculto). */
export const needsFit = () => pendingFit;

export function fitView(canvas) {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  // Si la pestaña del mapa está oculta el canvas mide 0: se aplaza el encaje.
  if (cw < 2 || ch < 2) { pendingFit = true; return false; }

  const p = P.cur;
  const src = p.boundary.length >= 3 ? p.boundary
            : (p.points.length ? p.points : [{ x: 0, y: 0 }, { x: 16, y: 44 }]);
  const bb = bbox(src);
  const pad = 58;    // deja sitio a las etiquetas de cota y a la acotación de lados
  const sx = (cw - pad * 2) / Math.max(bb.w, 0.5);
  const sy = (ch - pad * 2) / Math.max(bb.h, 0.5);
  view.scale = clamp(Math.min(sx, sy), 0.5, 400);
  view.tx = cw / 2 - (bb.x0 + bb.w / 2) * view.scale;
  view.ty = ch / 2 + (bb.y0 + bb.h / 2) * view.scale;
  pendingFit = false;
  return true;
}

export function invalidateRaster() { raster = null; rasterKey = ''; }

/* ── raster de relieve ── */

function buildRaster(surf) {
  const key = [surf.nx, surf.ny, surf.zmin.toFixed(4), surf.zmax.toFixed(4),
               layers.hypso, layers.hillshade, layers.slope, layers.coverage,
               P.cur.photos.length].join('|');
  if (raster && rasterKey === key) return raster;

  const { nx, ny, z } = surf;
  const img = new ImageData(nx, ny);
  const d = img.data;
  const span = Math.max(surf.zmax - surf.zmin, 1e-4);
  const hs = layers.hillshade ? hillshade(surf, 3) : null;
  const sl = layers.slope ? slopeGrid(surf) : null;
  const cov = layers.coverage ? coverageGrid(surf, P.cur.photos) : null;

  for (let j = 0; j < ny; j++) {
    // Voltea verticalmente: la fila 0 del raster es la Y máxima en pantalla.
    const srcRow = ny - 1 - j;
    for (let i = 0; i < nx; i++) {
      const si = srcRow * nx + i;
      const di = (j * nx + i) * 4;
      const v = z[si];
      if (Number.isNaN(v)) { d[di + 3] = 0; continue; }

      let c;
      if (layers.slope && sl) c = slopeColor(sl.data[si] || 0);
      else if (layers.hypso) c = hypsoColor((v - surf.zmin) / span);
      else c = [40, 52, 66];

      let a = (layers.hypso || layers.slope) ? 235 : (layers.hillshade ? 170 : 0);

      if (hs) {
        const s = hs[si];
        const f = Number.isNaN(s) ? 1 : 0.45 + 0.75 * s;
        c = [clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255)];
        if (a === 0) a = 150;
      }

      if (cov) {
        const seen = cov.data[si] > 0;
        if (seen) { c = [c[0] * 0.55 + 40, c[1] * 0.55 + 110, c[2] * 0.55 + 70]; }
        else { c = [c[0] * 0.5 + 90, c[1] * 0.5 + 20, c[2] * 0.5 + 30]; }
        a = Math.max(a, 190);
      }

      d[di] = c[0]; d[di + 1] = c[1]; d[di + 2] = c[2]; d[di + 3] = a;
    }
  }

  raster = { img, nx, ny, x0: surf.x0, y0: surf.y0, res: surf.res };
  rasterKey = key;
  return raster;
}

let offCanvas = null;
function rasterCanvas(r) {
  if (!offCanvas) offCanvas = document.createElement('canvas');
  if (offCanvas.width !== r.nx || offCanvas.height !== r.ny) {
    offCanvas.width = r.nx; offCanvas.height = r.ny;
  }
  offCanvas.getContext('2d').putImageData(r.img, 0, 0);
  return offCanvas;
}

/* ── dibujo principal ── */

export function draw(canvas, ui = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr; canvas.height = ch * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#0a0e13';
  ctx.fillRect(0, 0, cw, ch);

  const p = P.cur;
  const { surf, contours: cont } = surface();

  if (layers.grid) drawMetricGrid(ctx, cw, ch);

  // relieve — cada píxel del raster es un nodo de la rejilla, así que el
  // rectángulo se extiende media celda por cada lado para que los centros cuadren.
  if (!surf.empty && (layers.hypso || layers.hillshade || layers.slope || layers.coverage)) {
    const r = buildRaster(surf);
    const c = rasterCanvas(r);
    const cell = r.res * view.scale;
    const rx = w2sx(r.x0) - cell / 2;
    const ry = w2sy(r.y0 + (r.ny - 1) * r.res) - cell / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, rx, ry, r.nx * cell, r.ny * cell);
  }

  if (layers.contours && cont.length) drawContours(ctx, cont, p.settings.contourInterval);
  if (p.boundary.length >= 2) drawBoundary(ctx, p, ui);
  drawPhotoCones(ctx, p);
  drawPending(ctx, p);
  drawTrees(ctx, p);
  drawPoints(ctx, p);
  if (ui.profileLine) drawProfileLine(ctx, ui.profileLine);

  drawScaleBar(ctx, cw, ch);
  if (p.anchor) drawNorth(ctx, cw, p.anchor.rot || 0);
}

function drawMetricGrid(ctx, cw, ch) {
  // Paso de malla adaptativo: 1, 2, 5, 10, 20, 50 m…
  const target = 42;
  const raw = target / view.scale;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * pow).find(v => v >= raw) || 10 * pow;

  const x0 = Math.floor(s2wx(0) / step) * step, x1 = s2wx(cw);
  const y1 = Math.floor(s2wy(ch) / step) * step, y0 = s2wy(0);

  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += step) { const sx = Math.round(w2sx(x)) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, ch); }
  for (let y = y1; y <= y0; y += step) { const sy = Math.round(w2sy(y)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(cw, sy); }
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.stroke();

  // ejes del origen
  ctx.beginPath();
  ctx.moveTo(Math.round(w2sx(0)) + 0.5, 0); ctx.lineTo(Math.round(w2sx(0)) + 0.5, ch);
  ctx.moveTo(0, Math.round(w2sy(0)) + 0.5); ctx.lineTo(cw, Math.round(w2sy(0)) + 0.5);
  ctx.strokeStyle = 'rgba(78,168,222,0.28)';
  ctx.stroke();
}

function drawContours(ctx, cont, interval) {
  const idxEvery = 5;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const labels = [];

  for (const c of cont) {
    const isIndex = Math.abs(Math.round(c.level / interval) % idxEvery) === 0;
    ctx.beginPath();
    for (const line of c.lines) {
      if (line.length < 2) continue;
      ctx.moveTo(w2sx(line[0].x), w2sy(line[0].y));
      for (let i = 1; i < line.length; i++) ctx.lineTo(w2sx(line[i].x), w2sy(line[i].y));
      if (isIndex && line.length > 24 && view.scale > 6) {
        const m = line[Math.floor(line.length / 2)];
        const n = line[Math.floor(line.length / 2) + 1] || m;
        labels.push({ p: m, a: Math.atan2(-(n.y - m.y), n.x - m.x), t: c.level });
      }
    }
    ctx.strokeStyle = isIndex ? 'rgba(255,236,190,0.92)' : 'rgba(190,214,238,0.5)';
    ctx.lineWidth = isIndex ? 1.7 : 0.9;
    ctx.stroke();
  }

  // etiquetas de cota en las curvas maestras
  ctx.font = '600 10px system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of labels) {
    const sx = w2sx(l.p.x), sy = w2sy(l.p.y);
    let a = l.a;
    if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI;   // texto siempre legible
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(a);
    const txt = fmtZ(l.t);
    const w = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(10,14,19,0.85)';
    ctx.fillRect(-w / 2 - 3, -6.5, w + 6, 13);
    ctx.fillStyle = '#ffecbe';
    ctx.fillText(txt, 0, 0.5);
    ctx.restore();
  }
}

function drawBoundary(ctx, p, ui) {
  const b = p.boundary;
  ctx.beginPath();
  ctx.moveTo(w2sx(b[0].x), w2sy(b[0].y));
  for (let i = 1; i < b.length; i++) ctx.lineTo(w2sx(b[i].x), w2sy(b[i].y));
  if (b.length >= 3) ctx.closePath();
  ctx.strokeStyle = '#e6edf3';
  ctx.lineWidth = 2;
  ctx.stroke();

  // arista de la calle, resaltada
  if (p.streetEdge >= 0 && b.length >= 3 && p.streetEdge < b.length) {
    const a = b[p.streetEdge], c = b[(p.streetEdge + 1) % b.length];
    ctx.beginPath();
    ctx.moveTo(w2sx(a.x), w2sy(a.y)); ctx.lineTo(w2sx(c.x), w2sy(c.y));
    ctx.strokeStyle = '#f0a35e'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.stroke();
    const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
    ctx.font = '600 11px system-ui,sans-serif';
    ctx.fillStyle = '#f0a35e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CALLE', w2sx(mx), w2sy(my) - 12);
  }

  // acotación de cada lado
  if (layers.labels && view.scale > 4 && b.length >= 2) {
    ctx.font = '11px system-ui,sans-serif';
    ctx.fillStyle = '#9aa7b4'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const n = b.length >= 3 ? b.length : b.length - 1;
    for (let i = 0; i < n; i++) {
      const a = b[i], c = b[(i + 1) % b.length];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      if (len < 0.5) continue;
      const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
      // desplaza la etiqueta hacia fuera del polígono
      const nx = -(c.y - a.y) / len, ny = (c.x - a.x) / len;
      const inside = b.length >= 3 && pointInPoly(mx + nx * 0.4, my + ny * 0.4, b);
      const s = inside ? -1 : 1;
      // 24 px hacia fuera: deja pasar por debajo las etiquetas de cota del borde
      const sx = w2sx(mx) + nx * s * 24;
      const sy = w2sy(my) - ny * s * 24;
      const txt = len.toFixed(2).replace('.', ',') + ' m';
      const w = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(10,14,19,0.8)';
      ctx.fillRect(sx - w / 2 - 3, sy - 7, w + 6, 14);
      ctx.fillStyle = '#9aa7b4';
      ctx.fillText(txt, sx, sy);
    }
  }

  // vértices arrastrables en modo borde
  if (ui.tool === 'boundary') {
    for (let i = 0; i < b.length; i++) {
      ctx.beginPath();
      ctx.arc(w2sx(b[i].x), w2sy(b[i].y), 7, 0, Math.PI * 2);
      ctx.fillStyle = '#4ea8de'; ctx.fill();
      ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
}

function drawPoints(ctx, p) {
  // Las etiquetas solo caben si las cotas vecinas están suficientemente separadas.
  const spacing = Math.min(p.settings.gridDx || 4, p.settings.gridDy || 4) * view.scale;
  const showLbl = layers.labels && spacing > 46;
  ctx.font = '600 9.5px system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  for (const q of p.points) {
    const sx = w2sx(q.x), sy = w2sy(q.y);
    const isRef = q.type === 'ref';
    const r = isRef ? 6 : 4.2;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = isRef ? '#f0a35e' : q.type === 'break' ? '#c792ea' : '#4ea8de';
    ctx.fill();
    ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 1.5; ctx.stroke();
    if (isRef) {
      ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.strokeStyle = '#f0a35e'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    if (showLbl) {
      const txt = fmtZ(q.z);
      const w = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(10,14,19,0.78)';
      ctx.fillRect(sx - w / 2 - 2.5, sy - r - 15, w + 5, 12);
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(txt, sx, sy - r - 9);
    }
  }
}

function drawPending(ctx, p) {
  if (!p.pending.length) return;
  ctx.font = '9px system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < p.pending.length; i++) {
    const q = p.pending[i];
    const sx = w2sx(q.x), sy = w2sy(q.y);
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.strokeStyle = i === 0 ? '#5ee1a0' : 'rgba(154,167,180,0.55)';
    ctx.lineWidth = i === 0 ? 2.2 : 1.2;
    ctx.stroke();
    if (i === 0 && view.scale > 5) {
      ctx.fillStyle = '#5ee1a0';
      ctx.fillText('siguiente', sx, sy - 14);
    }
  }
}

function drawTrees(ctx, p) {
  for (const t of p.trees) {
    const sx = w2sx(t.x), sy = w2sy(t.y);
    const rc = Math.max(4, (t.canopy || 3) / 2 * view.scale);
    ctx.beginPath(); ctx.arc(sx, sy, rc, 0, Math.PI * 2);
    ctx.fillStyle = t.health === 'malo' || t.health === 'tocon'
      ? 'rgba(240,163,94,0.14)' : 'rgba(94,225,160,0.14)';
    ctx.fill();
    ctx.strokeStyle = t.health === 'malo' || t.health === 'tocon'
      ? 'rgba(240,163,94,0.6)' : 'rgba(94,225,160,0.6)';
    ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);

    ctx.beginPath(); ctx.arc(sx, sy, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = '#5ee1a0'; ctx.fill();
    ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 1.2; ctx.stroke();

    if (view.scale > 8) {
      ctx.font = '10px system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#5ee1a0';
      ctx.fillText(t.species || 'Árbol', sx, sy + rc + 3);
    }
  }
}

function drawPhotoCones(ctx, p) {
  for (const ph of p.photos) {
    const sx = w2sx(ph.x), sy = w2sy(ph.y);
    const R = (ph.range || 25) * view.scale;
    // bearing = 0 ⇒ mirando hacia +Y; sentido horario.
    const a0 = rad(ph.bearing - ph.fov / 2), a1 = rad(ph.bearing + ph.fov / 2);
    // ángulo de canvas correspondiente (0 = +X pantalla, sentido horario visual)
    const ca0 = -Math.PI / 2 + a0, ca1 = -Math.PI / 2 + a1;

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, R, ca0, ca1);
    ctx.closePath();
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(R, 1));
    g.addColorStop(0, 'rgba(199,146,234,0.34)');
    g.addColorStop(1, 'rgba(199,146,234,0.02)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(199,146,234,0.55)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#c792ea'; ctx.fill();
    ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 1.5; ctx.stroke();
  }
}

function drawProfileLine(ctx, pl) {
  ctx.beginPath();
  ctx.moveTo(w2sx(pl.a.x), w2sy(pl.a.y));
  ctx.lineTo(w2sx(pl.b.x), w2sy(pl.b.y));
  ctx.strokeStyle = '#5ee1a0'; ctx.lineWidth = 2.4; ctx.setLineDash([7, 5]);
  ctx.stroke(); ctx.setLineDash([]);
  for (const q of [pl.a, pl.b]) {
    ctx.beginPath(); ctx.arc(w2sx(q.x), w2sy(q.y), 6, 0, Math.PI * 2);
    ctx.fillStyle = '#5ee1a0'; ctx.fill();
    ctx.strokeStyle = '#0a0e13'; ctx.lineWidth = 2; ctx.stroke();
  }
}

function drawScaleBar(ctx, cw, ch) {
  const targetPx = Math.min(120, cw * 0.3);
  const raw = targetPx / view.scale;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = [1, 2, 5, 10].map(v => v * pow).reverse().find(v => v <= raw) || pow;
  const px = m * view.scale;
  // Junto a la columna de herramientas, fuera de la zona donde caen
  // la acotación del lado inferior y el panel de perfil.
  const x = 62, y = ch - 16;
  ctx.strokeStyle = '#e6edf3'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5);
  ctx.stroke();
  ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const lbl = m >= 1 ? `${m} m` : `${Math.round(m * 100)} cm`;
  const lw = ctx.measureText(lbl).width;
  ctx.fillStyle = 'rgba(10,14,19,0.8)';
  ctx.fillRect(x + px / 2 - lw / 2 - 3, y - 19, lw + 6, 13);
  ctx.fillStyle = '#e6edf3';
  ctx.fillText(lbl, x + px / 2, y - 7);
}

function drawNorth(ctx, cw, rot) {
  // rot = rumbo del eje +Y local respecto al norte. El norte en pantalla está a −rot.
  const cx = cw - 30, cy = 34, a = rad(-rot);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(5, 6); ctx.lineTo(0, 2); ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fillStyle = '#e5646b'; ctx.fill();
  ctx.restore();
  ctx.font = '600 10px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = '#9aa7b4';
  ctx.fillText('N', cx, cy + 8);
}

/* ── pruebas de acierto (hit testing) ── */

export function hitTest(sx, sy, radiusPx = 16) {
  const p = P.cur;
  const near = (o) => Math.hypot(w2sx(o.x) - sx, w2sy(o.y) - sy);
  let best = null;
  const consider = (o, kind) => {
    const d = near(o);
    if (d <= radiusPx && (!best || d < best.d)) best = { d, obj: o, kind };
  };
  p.photos.forEach(o => consider(o, 'photo'));
  p.trees.forEach(o => consider(o, 'tree'));
  p.points.forEach(o => consider(o, 'point'));
  p.pending.forEach(o => consider(o, 'pending'));
  p.boundary.forEach((o, i) => { const d = near(o); if (d <= radiusPx && (!best || d < best.d)) best = { d, obj: o, kind: 'vertex', index: i }; });
  return best;
}

/** Índice de la arista del borde más cercana a un punto de pantalla. */
export function hitEdge(sx, sy, tolPx = 18) {
  const b = P.cur.boundary;
  if (b.length < 2) return -1;
  let best = -1, bd = tolPx;
  for (let i = 0; i < b.length; i++) {
    const a = b[i], c = b[(i + 1) % b.length];
    const d = segDistPx(sx, sy, w2sx(a.x), w2sy(a.y), w2sx(c.x), w2sy(c.y));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function segDistPx(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
