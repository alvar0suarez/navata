// render3d.js — vista 3D del terreno sobre canvas 2D (algoritmo del pintor).
// Sin dependencias externas: proyección en perspectiva + quads ordenados por profundidad.

import { P, surface } from './state.js';
import { hypsoColor, bbox } from './geom.js';
import { clamp, rad } from './util.js';

export const cam = { yaw: -35, pitch: 32, dist: 1.7, exag: 3 };

/** Rota un punto centrado en la escena al sistema de la cámara. */
function toCamera(p, c) {
  const cy = Math.cos(rad(c.yaw)), sy = Math.sin(rad(c.yaw));
  const cp = Math.cos(rad(c.pitch)), sp = Math.sin(rad(c.pitch));
  const x1 = p.x * cy - p.y * sy;
  const y1 = p.x * sy + p.y * cy;
  return { u: x1, v: y1 * cp - p.z * sp, w: y1 * sp + p.z * cp };
}

function project(p, c, cw, ch) {
  const { u, v, w } = toCamera(p, c);
  // La cámara está en −v mirando hacia +v: la profundidad crece con v.
  const depth = c.camDist + v;
  if (depth < 0.05) return null;
  const f = c.focal / depth;
  return { sx: cw / 2 + u * f - c.shiftX, sy: ch / 2 - w * f + c.shiftY, depth };
}

/**
 * Elige distancia focal y desplazamiento para que la caja envolvente de la
 * escena llene y quede centrada en el encuadre, sea cual sea la orientación.
 * La caja es asimétrica en vertical porque los árboles solo crecen hacia arriba.
 */
function autoFrame(c, cw, ch, hw, hh, zDown, zUp) {
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [-zDown, zUp]) {
    const p = toCamera({ x: sx * hw, y: sy * hh, z }, c);
    const depth = c.camDist + p.v;
    if (depth < 0.05) continue;
    const u = p.u / depth, w = p.w / depth;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (w < w0) w0 = w; if (w > w1) w1 = w;
  }
  if (!Number.isFinite(u0)) return { focal: Math.min(cw, ch), shiftX: 0, shiftY: 0 };
  const focal = Math.min(
    cw * 0.9 / Math.max(u1 - u0, 1e-6),
    ch * 0.86 / Math.max(w1 - w0, 1e-6),
  );
  return { focal, shiftX: (u0 + u1) / 2 * focal, shiftY: (w0 + w1) / 2 * focal };
}

export function draw3d(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr; canvas.height = ch * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // cielo
  const sky = ctx.createLinearGradient(0, 0, 0, ch);
  sky.addColorStop(0, '#0f1720'); sky.addColorStop(1, '#080b10');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, cw, ch);

  const p = P.cur;
  const { surf } = surface();
  if (surf.empty) return false;

  const bb = bbox(p.boundary.length >= 3 ? p.boundary : p.points);
  const cx = bb.x0 + bb.w / 2, cyy = bb.y0 + bb.h / 2;
  const cz = (surf.zmin + surf.zmax) / 2;
  const size = Math.max(bb.w, bb.h, 1);

  const c = Object.assign({}, cam, { camDist: size * cam.dist, focal: 1, shiftX: 0, shiftY: 0 });
  // La exageración se aplica solo al relieve. Lo que se levanta sobre el suelo
  // (árboles, trípode de la cámara) va a escala real: si no, un olivo de 6 m
  // taparía por completo un desnivel de metro y medio.
  const maxTree = p.trees.reduce((a, t) => Math.max(a, t.height || 4), 0);
  const halfRelief = Math.max((surf.zmax - surf.zmin) / 2 * cam.exag, 0.25);
  Object.assign(c, autoFrame(c, cw, ch, bb.w / 2, bb.h / 2, halfRelief, halfRelief + maxTree));

  const toCam = (wx, wy, wz, above = 0) =>
    ({ x: wx - cx, y: wy - cyy, z: (wz - cz) * cam.exag + above });
  const proj = (wx, wy, wz, above = 0) => project(toCam(wx, wy, wz, above), c, cw, ch);

  // ── malla del terreno ──
  const { nx, ny, res, x0, y0, z } = surf;
  const step = Math.max(1, Math.round(Math.max(nx, ny) / 90));   // límite de quads
  const span = Math.max(surf.zmax - surf.zmin, 1e-4);
  const quads = [];

  for (let j = 0; j + step < ny; j += step) {
    for (let i = 0; i + step < nx; i += step) {
      const za = z[j * nx + i], zb = z[j * nx + i + step];
      const zc = z[(j + step) * nx + i + step], zd = z[(j + step) * nx + i];
      if (Number.isNaN(za) || Number.isNaN(zb) || Number.isNaN(zc) || Number.isNaN(zd)) continue;
      const xa = x0 + i * res, xb = x0 + (i + step) * res;
      const ya = y0 + j * res, yb = y0 + (j + step) * res;

      const pa = proj(xa, ya, za), pb = proj(xb, ya, zb),
            pc = proj(xb, yb, zc), pd = proj(xa, yb, zd);
      if (!pa || !pb || !pc || !pd) continue;

      const zm = (za + zb + zc + zd) / 4;
      // sombreado por normal aproximada
      const dzdx = ((zb + zc) - (za + zd)) / (2 * step * res);
      const dzdy = ((zd + zc) - (za + zb)) / (2 * step * res);
      const nlen = Math.hypot(dzdx * cam.exag, dzdy * cam.exag, 1);
      const lum = clamp((-dzdx * 0.5 * cam.exag - dzdy * 0.35 * cam.exag + 0.9) / nlen, 0.25, 1.35);

      const col = hypsoColor((zm - surf.zmin) / span);
      quads.push({
        depth: (pa.depth + pb.depth + pc.depth + pd.depth) / 4,
        pts: [pa, pb, pc, pd],
        fill: `rgb(${Math.round(col[0] * lum)},${Math.round(col[1] * lum)},${Math.round(col[2] * lum)})`,
      });
    }
  }

  quads.sort((a, b) => b.depth - a.depth);
  for (const q of quads) {
    ctx.beginPath();
    ctx.moveTo(q.pts[0].sx, q.pts[0].sy);
    for (let k = 1; k < 4; k++) ctx.lineTo(q.pts[k].sx, q.pts[k].sy);
    ctx.closePath();
    ctx.fillStyle = q.fill;
    ctx.fill();
    ctx.strokeStyle = q.fill;      // sella las costuras entre quads
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // ── borde de la parcela ──
  if (p.boundary.length >= 3) {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= p.boundary.length; i++) {
      const v = p.boundary[i % p.boundary.length];
      const zz = sampleZ(surf, v.x, v.y);
      const q = proj(v.x, v.y, Number.isNaN(zz) ? surf.zmin : zz);
      if (!q) { started = false; continue; }
      if (!started) { ctx.moveTo(q.sx, q.sy); started = true; } else ctx.lineTo(q.sx, q.sy);
    }
    ctx.strokeStyle = 'rgba(230,237,243,0.9)'; ctx.lineWidth = 2; ctx.stroke();
  }

  // ── árboles ──
  const sprites = [];
  for (const t of p.trees) {
    const zz = sampleZ(surf, t.x, t.y);
    if (Number.isNaN(zz)) continue;
    const base = proj(t.x, t.y, zz);
    const h = t.height || 4;
    const top = proj(t.x, t.y, zz, h);
    if (!base || !top) continue;
    // El radio de copa es horizontal: no debe llevar exageración vertical.
    const side = proj(t.x + (t.canopy || 3) / 2, t.y, zz, h);
    const rx = side ? Math.abs(side.sx - top.sx) : 5;
    sprites.push({ depth: base.depth, kind: 'tree', base, top, rx, t });
  }

  // ── estaciones de foto ──
  const inBB = (x, y) => x >= bb.x0 - 0.01 && x <= bb.x1 + 0.01 && y >= bb.y0 - 0.01 && y <= bb.y1 + 0.01;
  for (const ph of p.photos) {
    const zz = sampleZ(surf, ph.x, ph.y);
    if (Number.isNaN(zz)) continue;
    const base = proj(ph.x, ph.y, zz);
    const eye = proj(ph.x, ph.y, zz, 1.6);
    if (!base || !eye) continue;

    const b = rad(ph.bearing), half = rad((ph.fov || 70) / 2);
    // Recorta el cono a la parcela: proyectado entero se saldría del encuadre.
    let r = ph.range || 25;
    const tip = s => ({ x: ph.x + Math.sin(b + s * half) * r, y: ph.y + Math.cos(b + s * half) * r });
    while (r > 1 && !(inBB(tip(-1).x, tip(-1).y) && inBB(tip(1).x, tip(1).y))) r -= 0.5;

    const arms = [-1, 1].map(s => {
      const t = tip(s);
      const tz = sampleZ(surf, t.x, t.y);
      return proj(t.x, t.y, Number.isNaN(tz) ? zz : tz, 0.15);
    });
    sprites.push({ depth: base.depth, kind: 'photo', base, eye, arms });
  }

  sprites.sort((a, b) => b.depth - a.depth);
  for (const s of sprites) {
    if (s.kind === 'tree') {
      const rx = Math.max(3, s.rx);
      ctx.beginPath();
      ctx.moveTo(s.base.sx, s.base.sy); ctx.lineTo(s.top.sx, s.top.sy);
      ctx.strokeStyle = '#6b4f36'; ctx.lineWidth = Math.max(1.2, rx * 0.12); ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(s.top.sx, s.top.sy, rx, rx * 0.82, 0, 0, Math.PI * 2);
      const bad = s.t.health === 'malo' || s.t.health === 'tocon';
      ctx.fillStyle = bad ? 'rgba(200,150,80,0.8)' : 'rgba(74,168,104,0.85)';
      ctx.fill();
    } else {
      if (s.arms[0] && s.arms[1]) {
        ctx.beginPath();
        ctx.moveTo(s.eye.sx, s.eye.sy);
        ctx.lineTo(s.arms[0].sx, s.arms[0].sy);
        ctx.lineTo(s.arms[1].sx, s.arms[1].sy);
        ctx.closePath();
        ctx.fillStyle = 'rgba(199,146,234,0.22)'; ctx.fill();
        ctx.strokeStyle = 'rgba(199,146,234,0.7)'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(s.eye.sx, s.eye.sy, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#c792ea'; ctx.fill();
    }
  }

  // ── leyenda de cotas ──
  ctx.font = '11px system-ui,sans-serif';
  ctx.fillStyle = '#9aa7b4'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`Desnivel ${(surf.zmax - surf.zmin).toFixed(2).replace('.', ',')} m · exageración ${cam.exag}×`, 10, 10);
  return true;
}

/**
 * Cota en la rejilla. Los vértices del borde caen justo sobre el límite del
 * polígono, donde la celda puede estar sin valor: se busca en anillos crecientes.
 */
function sampleZ(surf, wx, wy) {
  const { nx, ny, res, x0, y0, z } = surf;
  const ci = Math.round((wx - x0) / res), cj = Math.round((wy - y0) / res);
  for (let r = 0; r <= 4; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (r > 0 && Math.abs(di) !== r && Math.abs(dj) !== r) continue;   // solo el anillo
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const v = z[j * nx + i];
        if (!Number.isNaN(v)) return v;
      }
    }
  }
  return NaN;
}

export function setCamPreset(name) {
  if (name === 'iso') Object.assign(cam, { yaw: -35, pitch: 32, dist: 1.7 });
  else if (name === 'street') Object.assign(cam, { yaw: 0, pitch: 10, dist: 1.5 });
  else if (name === 'top') Object.assign(cam, { yaw: 0, pitch: 82, dist: 1.5 });
}
