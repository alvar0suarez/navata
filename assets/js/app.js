// app.js — arranque, interacción y pegamento entre módulos.

import { $, $$, toast, download, fmtM, fmtZ, clamp, norm360, rad, uid, debounce, today } from './util.js';
import { P, surface, stats, onChange, touch, addPoint, delPoint, addTree, delTree,
         delPhoto, makeGrid, makeRect, replaceProject, emptyProject,
         mergeProject, describeProject } from './state.js';
import { blobURL, blobs, clearProject, listSnapshots, clearSnapshots } from './store.js';
import { profileAlong, bbox, latLonToLocal, sampleSurface, distToSeg, polyArea,
         quadFromSides, quadFromSidesSquare, quadFromSidesTrapezoid,
         quadFromSidesAndEdge, quadFlex } from './geom.js';
import * as R from './render2d.js';
import { draw3d, cam, setCamPreset } from './render3d.js';
import { coverageGrid, suggestStation } from './coverage.js';
import { ingest, startCompass, stopCompass, trueToLocal } from './photos.js';
import * as EX from './exporters.js';
import { GUIDE_HTML } from './guide.js';
import { initQuick, openQuick, quickRender, openQuickCfg } from './quickmode.js';

/* ═══════════════════ estado de interfaz ═══════════════════ */

const ui = {
  view: 'map',
  tool: 'pan',
  profileLine: null,
  profileDrag: null,
  drag: null,
  compassOn: false,
  compassRot: 0,
};

const canvas = $('#map-canvas');
const c3d = $('#canvas-3d');

/* ═══════════════════ navegación ═══════════════════ */

$$('#tabbar .tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

function setView(v) {
  ui.view = v;
  $$('#tabbar .tab').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  if (v === 'map') requestDraw();
  if (v === '3d') draw3dSafe();
  if (v === 'photos') renderPhotos();
  if (v === 'points') renderHero();
  if (v === 'data') { fillDataForm(); renderSnapshots(); }
}

/* ═══════════════════ dibujo del mapa ═══════════════════ */

let drawQueued = false;
function requestDraw() {
  if (drawQueued || ui.view !== 'map') return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    // El encaje solo puede calcularse con el canvas ya visible y medido.
    if (R.needsFit()) R.fitView(canvas);
    R.draw(canvas, ui);
    updateHud();
  });
}

function updateHud() {
  const st = stats();
  $('#hud-scale').textContent =
    `${st.nPoints} cotas · Δ ${fmtM(st.drop, 2)} m · ${fmtM(st.meanSlope, 1)} %`;
}

/* ═══════════════════ gestos sobre el mapa ═══════════════════ */

const pointers = new Map();
let pinch = null;

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, scale: R.view.scale };
    ui.drag = null;
    return;
  }

  const wx = R.s2wx(e.offsetX), wy = R.s2wy(e.offsetY);

  if (ui.tool === 'boundary') {
    const hit = R.hitTest(e.offsetX, e.offsetY, 18);
    if (hit && hit.kind === 'vertex') { ui.drag = { kind: 'vertex', index: hit.index }; return; }
  }
  if (ui.tool === 'profile') {
    if (ui.profileLine) {
      const da = Math.hypot(R.w2sx(ui.profileLine.a.x) - e.offsetX, R.w2sy(ui.profileLine.a.y) - e.offsetY);
      const db = Math.hypot(R.w2sx(ui.profileLine.b.x) - e.offsetX, R.w2sy(ui.profileLine.b.y) - e.offsetY);
      if (Math.min(da, db) < 22) { ui.drag = { kind: 'profile', end: da < db ? 'a' : 'b' }; return; }
    }
    ui.profileLine = { a: { x: wx, y: wy }, b: { x: wx, y: wy } };
    ui.drag = { kind: 'profile', end: 'b' };
    $('#profile-panel').classList.remove('hidden');
    return;
  }

  ui.drag = { kind: 'pan', x: e.offsetX, y: e.offsetY, tx: R.view.tx, ty: R.view.ty, moved: 0 };
});

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });

  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const ns = clamp(pinch.scale * (d / pinch.d), 0.5, 400);
    zoomAt(pinch.cx, pinch.cy, ns);
    R.view.tx += cx - pinch.cx; R.view.ty += cy - pinch.cy;
    pinch.cx = cx; pinch.cy = cy; pinch.d = d; pinch.scale = R.view.scale;
    requestDraw();
    return;
  }

  const d = ui.drag;
  if (!d) return;

  if (d.kind === 'pan') {
    R.view.tx = d.tx + (e.offsetX - d.x);
    R.view.ty = d.ty + (e.offsetY - d.y);
    d.moved = Math.max(d.moved, Math.hypot(e.offsetX - d.x, e.offsetY - d.y));
  } else if (d.kind === 'vertex') {
    P.cur.boundary[d.index] = { x: snap(R.s2wx(e.offsetX)), y: snap(R.s2wy(e.offsetY)) };
    touch();
  } else if (d.kind === 'profile') {
    ui.profileLine[d.end] = { x: R.s2wx(e.offsetX), y: R.s2wy(e.offsetY) };
    drawProfile();
  }
  requestDraw();
});

const endPointer = e => {
  const d = ui.drag;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;

  if (d && d.kind === 'pan' && d.moved < 6) handleTap(e.offsetX, e.offsetY);
  ui.drag = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinch = null; ui.drag = null; });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.offsetX, e.offsetY, clamp(R.view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.5, 400));
  requestDraw();
}, { passive: false });

function zoomAt(sx, sy, newScale) {
  const wx = R.s2wx(sx), wy = R.s2wy(sy);
  R.view.scale = newScale;
  R.view.tx = sx - wx * R.view.scale;
  R.view.ty = sy + wy * R.view.scale;
}

const snap = v => Math.round(v * 100) / 100;

function handleTap(sx, sy) {
  const wx = snap(R.s2wx(sx)), wy = snap(R.s2wy(sy));

  if (ui.tool === 'pan') {
    const hit = R.hitTest(sx, sy, 18);
    if (hit) showInfo(hit);
    return;
  }
  if (ui.tool === 'point') {
    $('#p-x').value = wx; $('#p-y').value = wy;
    setView('points');
    $('#p-z').focus();
    toast(`Estación en X ${fmtM(wx)} · Y ${fmtM(wy)}`);
    return;
  }
  if (ui.tool === 'tree') {
    $('#t-x').value = wx; $('#t-y').value = wy;
    setView('trees');
    $('#t-species').focus();
    return;
  }
  if (ui.tool === 'photo') {
    $('#f-x').value = wx; $('#f-y').value = wy;
    setView('photos');
    toast('Estación de foto colocada. Orienta y dispara.');
    return;
  }
  if (ui.tool === 'boundary') {
    const edge = R.hitEdge(sx, sy, 20);
    const hit = R.hitTest(sx, sy, 18);
    if (hit && hit.kind === 'vertex') {
      if (P.cur.boundary.length > 3 && confirm('¿Eliminar este vértice?')) {
        P.cur.boundary.splice(hit.index, 1);
        if (P.cur.streetEdge >= P.cur.boundary.length) P.cur.streetEdge = -1;
        touch();
      }
    } else if (edge >= 0) {
      // inserta un vértice en la arista tocada
      P.cur.boundary.splice(edge + 1, 0, { x: wx, y: wy });
      touch();
      toast('Vértice añadido');
    } else {
      P.cur.boundary.push({ x: wx, y: wy });
      touch();
    }
    requestDraw();
  }
}

function showInfo(hit) {
  const o = hit.obj;
  if (hit.kind === 'photo') { openPhoto(o.id); return; }

  if (hit.kind === 'pending') {
    $('#p-x').value = fmtNum(o.x); $('#p-y').value = fmtNum(o.y);
    setView('points'); $('#p-z').focus();
    toast(`Estación ${o.label} lista para medir`);
    return;
  }

  const isPoint = hit.kind === 'point';
  if (!isPoint && hit.kind !== 'tree') return;

  const title = isPoint
    ? `${escapeHTML(o.label)} · ${typeLabel(o.type)}`
    : `${escapeHTML(o.label)} · ${escapeHTML(o.species)}`;

  const rows = isPoint ? [
    ['Cota Z', fmtZ(o.z) + ' m'],
    ['Posición', `X ${fmtM(o.x)} · Y ${fmtM(o.y)}`],
    ['Método', methodLabel(o.method)],
    ['Distancia a la calle', streetDistance(o)],
  ] : [
    ['Posición', `X ${fmtM(o.x)} · Y ${fmtM(o.y)}`],
    ['Ø copa', fmtM(+o.canopy || 0, 1) + ' m'],
    ['Ø tronco', o.dbh ? fmtM(+o.dbh, 0) + ' cm' : '—'],
    ['Altura', o.height ? fmtM(+o.height, 1) + ' m' : '—'],
    ['Estado', o.health || '—'],
    ['Terreno', fmtZ(sampleSurface(surface().surf, o.x, o.y)) + ' m'],
    ['Notas', escapeHTML(o.notes) || '—'],
  ];

  $('#modal-body').innerHTML = `
    <h2 style="margin:0 0 10px;font-size:15px">${title}</h2>
    <div class="stats">${rows.map(([k, v]) =>
      `<div class="stat"><b style="font-size:14px">${v}</b><span>${k}</span></div>`).join('')}</div>
    <div class="btn-row" style="margin-top:14px">
      <button id="mi-close" class="primary">Cerrar</button>
      <button id="mi-del" class="danger">Eliminar</button>
    </div>`;
  $('#modal').classList.remove('hidden');
  $('#mi-close').addEventListener('click', () => $('#modal').classList.add('hidden'));
  $('#mi-del').addEventListener('click', () => {
    isPoint ? delPoint(o.id) : delTree(o.id);
    $('#modal').classList.add('hidden');
    toast('Eliminado');
  });
}

/** Distancia perpendicular al lado marcado como calle. */
function streetDistance(o) {
  const p = P.cur;
  if (p.streetEdge < 0 || p.boundary.length < 3) return '—';
  const a = p.boundary[p.streetEdge], b = p.boundary[(p.streetEdge + 1) % p.boundary.length];
  return fmtM(distToSeg(o.x, o.y, a.x, a.y, b.x, b.y)) + ' m';
}

/* ── barras de herramientas ── */

$$('.tool-btn').forEach(b => b.addEventListener('click', () => {
  ui.tool = b.dataset.tool;
  $$('.tool-btn').forEach(x => x.classList.toggle('active', x === b));
  if (ui.tool !== 'profile') $('#profile-panel').classList.add('hidden');
  requestDraw();
}));

$$('.layer-btn[data-layer]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.layer;
  R.layers[k] = !R.layers[k];
  // hipsométrico y pendiente son excluyentes
  if (k === 'hypso' && R.layers.hypso) R.layers.slope = false;
  if (k === 'slope' && R.layers.slope) R.layers.hypso = false;
  $$('.layer-btn[data-layer]').forEach(x => x.classList.toggle('active', R.layers[x.dataset.layer]));
  R.invalidateRaster();
  requestDraw();
}));

$('#btn-fit').addEventListener('click', () => { R.fitView(canvas); requestDraw(); });

/* ═══════════════════ perfil ═══════════════════ */

$('#profile-close').addEventListener('click', () => {
  $('#profile-panel').classList.add('hidden');
  ui.profileLine = null;
  requestDraw();
});

function drawProfile() {
  if (!ui.profileLine) return;
  const { surf } = surface();
  const pr = profileAlong(surf, ui.profileLine.a, ui.profileLine.b, 180);
  const cv = $('#profile-canvas');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const valid = pr.pts.filter(p => !Number.isNaN(p.z));
  $('#profile-stats').textContent = valid.length < 2 ? 'traza una línea sobre la parcela'
    : `${fmtM(pr.len, 1)} m · Δ ${fmtZ(pr.drop)} m · ${fmtM(pr.slope, 1)} %`;
  if (valid.length < 2) return;

  const pad = { l: 34, r: 8, t: 8, b: 16 };
  const zr = Math.max(pr.zmax - pr.zmin, 0.1);
  const X = d => pad.l + d / pr.len * (w - pad.l - pad.r);
  const Y = z => h - pad.b - (z - pr.zmin) / zr * (h - pad.t - pad.b);

  // rejilla horizontal
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  ctx.font = '9px system-ui'; ctx.fillStyle = '#9aa7b4';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const stepZ = niceStep(zr / 4);
  for (let z = Math.ceil(pr.zmin / stepZ) * stepZ; z <= pr.zmax; z += stepZ) {
    const y = Y(z);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(z.toFixed(2).replace('.', ','), pad.l - 4, y);
  }

  // relleno del terreno
  ctx.beginPath();
  ctx.moveTo(X(valid[0].d), h - pad.b);
  for (const p of valid) ctx.lineTo(X(p.d), Y(p.z));
  ctx.lineTo(X(valid[valid.length - 1].d), h - pad.b);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  g.addColorStop(0, 'rgba(94,225,160,0.35)'); g.addColorStop(1, 'rgba(94,225,160,0.03)');
  ctx.fillStyle = g; ctx.fill();

  ctx.beginPath();
  valid.forEach((p, i) => i ? ctx.lineTo(X(p.d), Y(p.z)) : ctx.moveTo(X(p.d), Y(p.z)));
  ctx.strokeStyle = '#5ee1a0'; ctx.lineWidth = 2; ctx.stroke();

  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#9aa7b4';
  ctx.fillText('0', pad.l, h - 3);
  ctx.fillText(fmtM(pr.len, 1) + ' m', w - pad.r, h - 3);
}

function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-4))));
  return [1, 2, 5, 10].map(m => m * pow).find(v => v >= raw) || pow * 10;
}

/* ═══════════════════ cotas ═══════════════════ */

$('#p-add').addEventListener('click', () => submitPoint(false));
$('#p-next').addEventListener('click', () => submitPoint(true));

function submitPoint(advance) {
  const x = parseFloat($('#p-x').value), y = parseFloat($('#p-y').value), z = parseFloat($('#p-z').value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) { toast('Faltan las coordenadas X e Y'); return; }
  if (!Number.isFinite(z)) { toast('Falta la cota Z'); return; }
  addPoint({
    x, y, z,
    label: $('#p-label').value.trim(),
    type: $('#p-type').value,
    method: $('#p-method').value,
  });
  $('#p-z').value = ''; $('#p-label').value = '';
  toast(`Cota guardada · ${fmtZ(z)} m`);

  if (advance && P.cur.pending.length) {
    const n = P.cur.pending[0];
    $('#p-x').value = fmtNum(n.x); $('#p-y').value = fmtNum(n.y);
    $('#p-z').focus();
  }
}

const fmtNum = v => String(Math.round(v * 100) / 100);

// calculadora de manguera
const hoseCalc = () => {
  const a = parseFloat($('#h-ref').value), b = parseFloat($('#h-pt').value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) { $('#h-out').value = ''; return null; }
  const z = (a - b) / 100;
  $('#h-out').value = fmtZ(z);
  return z;
};
$('#h-ref').addEventListener('input', hoseCalc);
$('#h-pt').addEventListener('input', hoseCalc);
$('#h-use').addEventListener('click', () => {
  const z = hoseCalc();
  if (z === null) { toast('Introduce las dos lecturas'); return; }
  $('#p-z').value = z.toFixed(3);
  $('#h-pt').value = '';
  $('#h-pt').focus();
  toast('Z copiada al formulario');
});

$('#g-make').addEventListener('click', () => {
  if (P.cur.boundary.length < 3) { toast('Define primero el borde de la parcela'); return; }
  const n = makeGrid(parseFloat($('#g-dx').value) || 4, parseFloat($('#g-dy').value) || 4, $('#g-order').value);
  $('#g-info').textContent = `${n} estaciones pendientes · ~${Math.round(n * 1.5)} min con manguera`;
  toast(`${n} estaciones generadas`);
  setView('map');
});

/* ═══════════════════ portada de medición ═══════════════════ */

function empezarAMedir() {
  if (!P.cur.pending.length) {
    // Sin malla no hay nada que medir: se genera con los pasos por defecto y
    // se entra directamente, en vez de mandarlo a otra pantalla.
    if (P.cur.boundary.length < 3) { toast('Define primero el borde en Datos'); setView('data'); return; }
    const n = makeGrid(parseFloat($('#g-dx').value) || 3, parseFloat($('#g-dy').value) || 5, $('#g-order').value);
    toast(`${n} estaciones preparadas`);
    renderHero();
    return;
  }
  openQuick(() => { requestDraw(); renderPoints(); renderHero(); });
}

$('#hero-go').addEventListener('click', empezarAMedir);

$('#hero-ref').addEventListener('click', () => {
  // Abre el mismo panel de ajustes de la pantalla de medición, sin salir de aquí
  openQuick(() => { requestDraw(); renderPoints(); renderHero(); });
  openQuickCfg();
});

function renderHero() {
  const p = P.cur, s = p.settings;
  const hechos = p.points.length;
  const quedan = p.pending.length;
  const total = hechos + quedan;
  const st = p.pending[0];

  // Referencia activa
  const esCuerda = s.metodo === 'cuerda';
  $('#hero-ref-txt').textContent = esCuerda
    ? `Cuerda a ${fmtZ(s.alturaCuerda)} m`
    : s.metodo === 'manguera'
      ? `Manguera · ref ${fmtM(s.refReading, 1)} cm`
      : 'Cota directa en metros';
  $('#hero-ref-sub').textContent = esCuerda
    ? (s.flechaCuerda ? `Flecha ${fmtM(s.flechaCuerda, 1)} cm · toca para cambiar`
                      : '⚠ Falta calibrar la flecha · toca para hacerlo')
    : 'Toca para cambiar cómo mides';
  $('#hero-ref').classList.toggle('warn', esCuerda && !s.flechaCuerda);

  // Botón principal
  const go = $('#hero-go');
  go.classList.toggle('setup', !quedan && !hechos);
  if (!quedan && !hechos) {
    $('#hero-go-title').textContent = '▶ Preparar y medir';
    $('#hero-go-next').textContent = `${fmtM(s.gridDx, 0)} × ${fmtM(s.gridDy, 0)} m sobre ${fmtM(stats().area, 0)} m²`;
  } else if (!quedan) {
    $('#hero-go-title').textContent = '✓ Malla completa';
    $('#hero-go-next').textContent = 'Exporta la copia en Datos antes de irte';
  } else {
    $('#hero-go-title').textContent = hechos ? '▶ Seguir midiendo' : '▶ Empezar a medir';
    $('#hero-go-next').textContent = `Siguiente: ${st.label} · X ${fmtM(st.x, 1)} · Y ${fmtM(st.y, 1)}`;
  }

  // Progreso
  const pct = total ? hechos / total * 100 : 0;
  $('#hero-prog-fill').style.width = pct + '%';
  $('#hero-prog-txt').textContent = total ? `${hechos} de ${total}` : 'sin malla';

  // Últimas cotas, para ver de un vistazo que va entrando bien
  $('#hero-last').innerHTML = p.points.slice(-4).reverse()
    .map(q => `<span>${escapeHTML(q.label)} <b class="${q.z < 0 ? 'neg' : ''}">${fmtZ(q.z)}</b></span>`)
    .join('');
}
$('#g-clear').addEventListener('click', () => { P.cur.pending = []; touch(false); $('#g-info').textContent = ''; });

$('#pt-del-all').addEventListener('click', () => {
  if (!P.cur.points.length) return;
  if (confirm(`¿Borrar las ${P.cur.points.length} cotas? No se puede deshacer.`)) { P.cur.points = []; touch(); }
});

let ptSortMode = 0;
$('#pt-sort').addEventListener('click', () => { ptSortMode = (ptSortMode + 1) % 3; renderPoints(); });

function renderPoints() {
  const el = $('#pt-list');
  const p = P.cur;
  $('#pt-count').textContent = p.points.length;

  const list = [...p.points];
  if (ptSortMode === 1) list.sort((a, b) => b.z - a.z);
  else if (ptSortMode === 2) list.sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }));
  else list.reverse();
  $('#pt-sort').textContent = ['Recientes ▾', 'Por cota ▾', 'Por nombre ▾'][ptSortMode];

  const rows = [];
  for (const q of p.pending.slice(0, 3)) {
    rows.push(`<div class="list-item pending"><div class="li-main">
      <div class="li-title">${q.label} · pendiente</div>
      <div class="li-sub">X ${fmtM(q.x)} · Y ${fmtM(q.y)}</div></div>
      <button class="li-act" data-goto="${q.id}">↗</button></div>`);
  }
  for (const q of list) {
    rows.push(`<div class="list-item"><div class="li-main">
      <div class="li-title">${escapeHTML(q.label)} <span class="li-sub">${typeLabel(q.type)}</span></div>
      <div class="li-sub">X ${fmtM(q.x)} · Y ${fmtM(q.y)}</div></div>
      <span class="li-z${q.z < 0 ? ' neg' : ''}">${fmtZ(q.z)}</span>
      <button class="li-act" data-del="${q.id}">✕</button></div>`);
  }
  el.innerHTML = rows.length ? rows.join('') : '<div class="empty">Aún no hay cotas medidas.</div>';

  el.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => delPoint(b.dataset.del)));
  el.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    const q = P.cur.pending.find(x => x.id === b.dataset.goto);
    if (q) { $('#p-x').value = fmtNum(q.x); $('#p-y').value = fmtNum(q.y); $('#p-z').focus(); }
  }));
}

const typeLabel = t => ({ grid: 'malla', break: 'quiebre', ref: 'referencia', edge: 'borde', feature: 'elemento' }[t] || t);
const methodLabel = m => ({ hose: 'Manguera', line: 'Cuerda + nivel', laser: 'Láser', est: 'Estimado' }[m] || '—');
const escapeHTML = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ═══════════════════ árboles ═══════════════════ */

$('#t-add').addEventListener('click', () => {
  const x = parseFloat($('#t-x').value), y = parseFloat($('#t-y').value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) { toast('Faltan las coordenadas'); return; }
  addTree({
    x, y,
    species: $('#t-species').value.trim() || 'Árbol',
    dbh: $('#t-dbh').value, canopy: $('#t-canopy').value,
    height: $('#t-height').value, health: $('#t-health').value,
    notes: $('#t-notes').value.trim(),
  });
  ['#t-dbh', '#t-height', '#t-notes'].forEach(s => $(s).value = '');
  toast('Árbol añadido');
});

$('#t-del-all').addEventListener('click', () => {
  if (P.cur.trees.length && confirm(`¿Borrar los ${P.cur.trees.length} árboles?`)) { P.cur.trees = []; touch(false); }
});

function renderTrees() {
  const el = $('#t-list');
  $('#t-count').textContent = P.cur.trees.length;
  el.innerHTML = P.cur.trees.length ? P.cur.trees.map(t =>
    `<div class="list-item"><div class="li-main">
      <div class="li-title">${escapeHTML(t.label)} · ${escapeHTML(t.species)}</div>
      <div class="li-sub">X ${fmtM(t.x)} · Y ${fmtM(t.y)} · copa ${t.canopy} m${t.dbh ? ` · tronco ${t.dbh} cm` : ''} · ${t.health}</div>
    </div><button class="li-act" data-del="${t.id}">✕</button></div>`).join('')
    : '<div class="empty">Sin árboles registrados.</div>';
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delTree(b.dataset.del)));
}

/* ═══════════════════ fotos y brújula ═══════════════════ */

const compassEl = $('#compass');

(function buildCompassTicks() {
  const g = $('#compass-ticks');
  let s = '';
  for (let a = 0; a < 360; a += 15) {
    const r0 = a % 45 === 0 ? 34 : 39, r1 = 44;
    const rr = rad(a);
    s += `<line class="c-tick" x1="${(Math.sin(rr) * r0).toFixed(2)}" y1="${(-Math.cos(rr) * r0).toFixed(2)}"
          x2="${(Math.sin(rr) * r1).toFixed(2)}" y2="${(-Math.cos(rr) * r1).toFixed(2)}"/>`;
  }
  for (const [a, t] of [[0, '+Y'], [90, '+X'], [180, '−Y'], [270, '−X']]) {
    const rr = rad(a);
    s += `<text class="c-lbl" x="${(Math.sin(rr) * 26).toFixed(1)}" y="${(-Math.cos(rr) * 26).toFixed(1)}">${t}</text>`;
  }
  g.innerHTML = s;
})();

function updateCompass() {
  const b = parseFloat($('#f-bearing').value) || 0;
  const fov = parseFloat($('#f-fov').value) || 70;
  const a = rad(b);
  compassEl.querySelector('.c-needle').setAttribute('x2', (Math.sin(a) * 40).toFixed(2));
  compassEl.querySelector('.c-needle').setAttribute('y2', (-Math.cos(a) * 40).toFixed(2));
  const a0 = rad(b - fov / 2), a1 = rad(b + fov / 2), R2 = 42;
  const p0 = [Math.sin(a0) * R2, -Math.cos(a0) * R2];
  const p1 = [Math.sin(a1) * R2, -Math.cos(a1) * R2];
  const large = fov > 180 ? 1 : 0;
  compassEl.querySelector('.c-cone').setAttribute('d',
    `M0 0 L${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${R2} ${R2} 0 ${large} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)} Z`);
}
$('#f-bearing').addEventListener('input', updateCompass);
$('#f-fov').addEventListener('input', updateCompass);

// arrastrar el dial
let dialDrag = false;
const dialSet = e => {
  const r = compassEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const t = e.touches ? e.touches[0] : e;
  const b = norm360(Math.atan2(t.clientX - cx, -(t.clientY - cy)) * 180 / Math.PI);
  $('#f-bearing').value = Math.round(b);
  updateCompass();
};
compassEl.addEventListener('pointerdown', e => { dialDrag = true; compassEl.setPointerCapture(e.pointerId); dialSet(e); });
compassEl.addEventListener('pointermove', e => { if (dialDrag) dialSet(e); });
compassEl.addEventListener('pointerup', () => { dialDrag = false; });

$('#f-usecompass').addEventListener('change', async e => {
  if (e.target.checked) {
    const ok = await startCompass((headingN, absolute) => {
      const local = trueToLocal(headingN, P.cur.anchor?.rot || 0);
      $('#f-bearing').value = Math.round(local);
      updateCompass();
      $('#compass-status').textContent =
        `Brújula: ${Math.round(headingN)}° N${absolute ? '' : ' (relativa)'} → ${Math.round(local)}° local`;
    });
    if (!ok) e.target.checked = false;
    ui.compassOn = ok;
  } else {
    stopCompass(); ui.compassOn = false;
    $('#compass-status').textContent = '';
  }
});

async function handleFiles(files) {
  const meta = {
    x: $('#f-x').value, y: $('#f-y').value,
    bearing: $('#f-bearing').value, fov: $('#f-fov').value,
    range: $('#f-range').value, note: $('#f-note').value.trim(),
  };
  if (!Number.isFinite(parseFloat(meta.x)) || !Number.isFinite(parseFloat(meta.y))) {
    toast('Coloca antes la estación en el mapa (herramienta 📷)');
    return;
  }
  for (const f of files) {
    try {
      const rec = await ingest(f, meta);
      P.cur.photos.push(rec);
    } catch (err) {
      console.error(err);
      toast('No se pudo procesar la imagen');
    }
  }
  $('#f-note').value = '';
  touch(false);
  renderPhotos();
  toast(`${files.length} foto${files.length > 1 ? 's' : ''} guardada${files.length > 1 ? 's' : ''}`);
}

$('#f-capture').addEventListener('change', e => { handleFiles([...e.target.files]); e.target.value = ''; });
$('#f-file').addEventListener('change', e => { handleFiles([...e.target.files]); e.target.value = ''; });

$('#f-del-all').addEventListener('click', async () => {
  if (!P.cur.photos.length) return;
  if (!confirm(`¿Borrar las ${P.cur.photos.length} fotos?`)) return;
  for (const ph of [...P.cur.photos]) await delPhoto(ph.id);
  renderPhotos();
});

async function renderPhotos() {
  const grid = $('#f-grid');
  $('#f-count').textContent = P.cur.photos.length;
  if (!P.cur.photos.length) {
    grid.innerHTML = '<div class="empty">Sin fotografías todavía.</div>';
  } else {
    grid.innerHTML = P.cur.photos.map(ph => `
      <div class="photo-cell" data-id="${ph.id}">
        <img alt="${escapeHTML(ph.note || 'foto')}" data-key="${ph.thumb}">
        <button class="pc-del" data-del="${ph.id}">✕</button>
        <div class="pc-meta">${Math.round(ph.bearing)}° · ${fmtM(ph.x, 1)},${fmtM(ph.y, 1)}</div>
      </div>`).join('');
    for (const img of grid.querySelectorAll('img[data-key]')) {
      const u = await blobURL(img.dataset.key);
      if (u) img.src = u;
    }
    grid.querySelectorAll('.pc-del').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      await delPhoto(b.dataset.del);
      renderPhotos();
    }));
    grid.querySelectorAll('.photo-cell').forEach(c =>
      c.addEventListener('click', () => openPhoto(c.dataset.id)));
  }
  updateCoverage();
}

async function openPhoto(id) {
  const ph = P.cur.photos.find(p => p.id === id);
  if (!ph) return;
  const u = await blobURL(ph.key);
  const trueB = P.cur.anchor ? norm360(ph.bearing + (P.cur.anchor.rot || 0)) : null;
  $('#modal-body').innerHTML = `
    ${u ? `<img src="${u}" alt="">` : '<p>Imagen no disponible</p>'}
    <p style="margin:10px 0 4px;font-weight:600">${escapeHTML(ph.note || 'Sin nota')}</p>
    <p class="hint" style="margin:0">Estación X ${fmtM(ph.x)} · Y ${fmtM(ph.y)} — rumbo local ${Math.round(ph.bearing)}°${trueB !== null ? ` (${Math.round(trueB)}° N)` : ''} · visión ${ph.fov}° · alcance ${ph.range} m</p>
    <p class="hint" style="margin:2px 0 12px">${new Date(ph.ts).toLocaleString('es-ES')}</p>
    <div class="btn-row"><button id="modal-close" class="primary">Cerrar</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#modal-close').addEventListener('click', () => $('#modal').classList.add('hidden'));
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });

function updateCoverage() {
  const { surf } = surface();
  if (surf.empty || !P.cur.photos.length) {
    $('#cov-pct').textContent = '0%';
    $('#cov-fill').style.width = '0%';
    return;
  }
  const c = coverageGrid(surf, P.cur.photos);
  $('#cov-pct').textContent = Math.round(c.pct) + '%';
  $('#cov-fill').style.width = c.pct.toFixed(1) + '%';
  $('#cov-hint').textContent = c.pct >= 99.5
    ? '✓ Parcela fotografiada al completo.'
    : `Queda por cubrir ${fmtM(surf.res * surf.res * (c.total - c.seen), 0)} m² de los ${fmtM(surf.res * surf.res * c.total, 0)} m² medidos.`;
}

$('#cov-suggest').addEventListener('click', () => {
  const { surf } = surface();
  if (surf.empty) { toast('Necesitas cotas para delimitar la superficie'); return; }
  const s = suggestStation(surf, P.cur.photos, {
    range: parseFloat($('#f-range').value) || 25,
    fov: parseFloat($('#f-fov').value) || 70,
  });
  if (!s) { $('#cov-suggestion').textContent = 'No queda superficie por cubrir con ese alcance.'; return; }
  $('#f-x').value = fmtNum(s.x); $('#f-y').value = fmtNum(s.y); $('#f-bearing').value = Math.round(s.bearing);
  updateCompass();
  $('#cov-suggestion').innerHTML =
    `Colócate en <b>X ${fmtM(s.x, 1)} · Y ${fmtM(s.y, 1)}</b> mirando a <b>${Math.round(s.bearing)}°</b> locales` +
    (P.cur.anchor ? ` (${Math.round(norm360(s.bearing + (P.cur.anchor.rot || 0)))}° geográficos)` : '') +
    `. Ya está cargado en el formulario.`;
  requestDraw();
});

/* ═══════════════════ vista 3D ═══════════════════ */

function draw3dSafe() {
  const ok = draw3d(c3d);
  $('#c3d-empty').classList.toggle('hidden', ok);
}

$('#ex-range').addEventListener('input', e => {
  cam.exag = parseFloat(e.target.value);
  $('#ex-val').textContent = cam.exag + '×';
  draw3dSafe();
});
$$('#c3d-controls [data-cam]').forEach(b => b.addEventListener('click', () => {
  setCamPreset(b.dataset.cam); draw3dSafe();
}));

let d3 = null;
c3d.addEventListener('pointerdown', e => {
  c3d.setPointerCapture(e.pointerId);
  d3 = { x: e.offsetX, y: e.offsetY, yaw: cam.yaw, pitch: cam.pitch };
});
c3d.addEventListener('pointermove', e => {
  if (!d3) return;
  cam.yaw = d3.yaw + (e.offsetX - d3.x) * 0.4;
  cam.pitch = clamp(d3.pitch + (e.offsetY - d3.y) * 0.3, -5, 88);
  draw3dSafe();
});
c3d.addEventListener('pointerup', () => { d3 = null; });
c3d.addEventListener('wheel', e => {
  e.preventDefault();
  cam.dist = clamp(cam.dist * (e.deltaY < 0 ? 0.9 : 1.1), 0.6, 6);
  draw3dSafe();
}, { passive: false });

/* ═══════════════════ pestaña de datos ═══════════════════ */

function fillDataForm() {
  const p = P.cur;
  $('#d-name').value = p.name;
  $('#d-place').value = p.place || '';
  $('#d-visit').value = p.visitDate || today();
  $('#d-notes').value = p.notes || '';
  $('#d-ci').value = p.settings.contourInterval;
  if (p.boundary.length >= 3) {
    const bb = bbox(p.boundary);
    $('#d-w').value = fmtNum(bb.w); $('#d-h').value = fmtNum(bb.h);
  }
  // selector de la arista que da a la calle
  const sel = $('#d-street');
  sel.innerHTML = '<option value="-1">— ninguno —</option>' + p.boundary.map((v, i) => {
    const c = p.boundary[(i + 1) % p.boundary.length];
    return `<option value="${i}">Lado ${i + 1} · ${fmtM(Math.hypot(c.x - v.x, c.y - v.y))} m</option>`;
  }).join('');
  sel.value = String(p.streetEdge);

  if (p.anchor) {
    $('#a-lat').value = p.anchor.lat; $('#a-lon').value = p.anchor.lon; $('#a-rot').value = p.anchor.rot || 0;
    $('#a-status').textContent = `Anclado. El eje +Y apunta a ${p.anchor.rot || 0}° del norte.`;
  } else {
    $('#a-status').textContent = 'Sin anclar: las exportaciones usan metros locales.';
  }

  const st = stats();
  $('#d-summary').innerHTML = [
    ['Superficie', fmtM(st.area, 1) + ' m²'],
    ['Perímetro', fmtM(st.perim, 1) + ' m'],
    ['Cotas', st.nPoints],
    ['Desnivel', fmtM(st.drop, 3) + ' m'],
    ['Pendiente media', fmtM(st.meanSlope, 1) + ' %'],
    ['Cota mín.', fmtZ(st.zmin)],
    ['Cota máx.', fmtZ(st.zmax)],
    ['Árboles', st.nTrees],
    ['Fotos', st.nPhotos],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
}

const bindField = (sel, fn, hard = false) =>
  $(sel).addEventListener('change', e => { fn(e.target.value); touch(hard); });

bindField('#d-name', v => { P.cur.name = v.trim() || 'Parcela'; }, false);
bindField('#d-place', v => { P.cur.place = v.trim(); }, false);
bindField('#d-visit', v => { P.cur.visitDate = v; }, false);
bindField('#d-notes', v => { P.cur.notes = v; }, false);
bindField('#d-ci', v => { P.cur.settings.contourInterval = Math.max(0.01, parseFloat(v) || 0.1); }, true);
bindField('#d-street', v => { P.cur.streetEdge = parseInt(v, 10); }, false);

$('#d-rect').addEventListener('click', () => {
  const w = parseFloat($('#d-w').value), h = parseFloat($('#d-h').value);
  if (!(w > 0) || !(h > 0)) { toast('Dimensiones no válidas'); return; }
  if (P.cur.boundary.length && !confirm('¿Sustituir el borde actual por un rectángulo?')) return;
  makeRect(w, h);
  R.fitView(canvas);
  setView('map');
  toast(`Parcela de ${fmtM(w)} × ${fmtM(h)} m — ${fmtM(w * h, 1)} m²`);
});

/* ── parcela irregular por trilateración ── */

function applyQuad(res) {
  const info = $('#tri-info');
  if (!res.ok) {
    info.className = 'hint tri-bad';
    info.textContent = res.error;
    return;
  }
  if (P.cur.boundary.length && !confirm('Se sustituirá el borde actual. ¿Continuar?')) return;

  P.cur.boundary = res.poly.map(v => ({ x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000 }));
  // El lado A (frente a la calle) es el que arranca en el origen.
  P.cur.streetEdge = P.cur.boundary.findIndex(v => Math.abs(v.x) < 1e-6 && Math.abs(v.y) < 1e-6);
  if (P.cur.streetEdge < 0) P.cur.streetEdge = 0;
  // Queda registrado si el borde es medido o supuesto: dentro de un año nadie
  // se acuerda de con qué hipótesis se dibujó.
  P.cur.boundaryAssumed = res.assumption || null;
  touch();
  R.fitView(canvas);

  const st = stats();
  let msg = `Parcela cerrada: ${fmtM(st.area, 1)} m², perímetro ${fmtM(st.perim, 1)} m.`;
  if (res.assumption) msg += ` Borde provisional (${res.assumption}).`;
  if (res.check !== null && res.check !== undefined) {
    const cm = Math.abs(res.check) * 100;
    const medida = parseFloat($('#tri-q').value);
    msg += cm <= 5
      ? ` La segunda diagonal cuadra con ${fmtM(cm, 1)} cm de diferencia: las medidas son consistentes.`
      : ` ⚠ La segunda diagonal se desvía ${fmtM(cm, 1)} cm: has medido ${fmtM(medida, 2)} m y con el resto de lados salen ${fmtM(medida + res.check, 2)} m. Repasa las cintas antes de fiarte del plano.`;
  } else {
    msg += ' Sin segunda diagonal no hay forma de comprobar el cierre.';
  }
  info.className = 'hint ' + (res.check === null || res.check === undefined || Math.abs(res.check) <= 0.05 ? 'tri-ok' : 'tri-bad');
  info.textContent = msg;
  toast('Parcela construida');
  setView('map');
}

const triVal = id => parseFloat($('#tri-' + id).value);

$('#tri-build').addEventListener('click', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(triVal);
  const p = triVal('p'), ey = triVal('ey'), ex = triVal('ex');
  $('#tri-choice').classList.add('hidden');

  if (Number.isFinite(p) && p > 0) {
    applyQuad(quadFromSides(a, b, c, d, p, triVal('q')));
    return;
  }
  if (Number.isFinite(ey) && Number.isFinite(ex)) {
    const r = quadFromSidesAndEdge(a, b, c, d, ey, ex, $('#tri-eside').value);
    if (r.ok) r.assumption = `ajustada con la valla ${$('#tri-eside').value === 'izq' ? 'izquierda' : 'derecha'} a ${fmtM(ey)} m de la calle`;
    applyQuad(r);
    return;
  }
  offerAssumptions(a, b, c, d);
});

/**
 * Sin diagonal la forma queda indeterminada. En vez de elegir por él una
 * suposición cualquiera, se le enseñan las dos razonables y cuánto difieren:
 * ese número es la incertidumbre que está aceptando.
 */
function offerAssumptions(a, b, c, d) {
  const info = $('#tri-info');
  const sq = quadFromSidesSquare(a, b, c, d);
  const tz = quadFromSidesTrapezoid(a, b, c, d);
  const flex = quadFlex(a, b, c, d);

  if (!sq.ok && !tz.ok) {
    info.className = 'hint tri-bad';
    info.textContent = sq.ok === false ? sq.error : tz.error;
    return;
  }

  triCandidates = { square: sq, trap: tz };
  const areaSq = sq.ok ? polyArea(sq.poly) : null;
  const areaTz = tz.ok ? polyArea(tz.poly) : null;

  $('#tri-opt-sq').textContent = areaSq !== null ? `${fmtM(areaSq, 1)} m²` : 'no cierra';
  $('#tri-opt-tz').textContent = areaTz !== null ? `${fmtM(areaTz, 1)} m²` : 'no cierra';
  $$('.tri-opt').forEach(b2 => {
    const okThis = b2.dataset.assume === 'square' ? sq.ok : tz.ok;
    b2.disabled = !okThis;
    b2.style.opacity = okThis ? '' : '.4';
  });

  let msg = 'Sin diagonal, los cuatro lados no fijan la forma: el cuadrilátero sigue articulado. ';
  if (areaSq !== null && areaTz !== null) {
    const diff = Math.abs(areaSq - areaTz);
    const pct = diff / Math.max(areaSq, areaTz) * 100;
    const corner = Math.max(
      Math.hypot(sq.poly[2].x - tz.poly[2].x, sq.poly[2].y - tz.poly[2].y),
      Math.hypot(sq.poly[3].x - tz.poly[3].x, sq.poly[3].y - tz.poly[3].y));
    msg += `Estas dos hipótesis, ambas razonables, difieren en ${fmtM(diff, 1)} m² (${fmtM(pct, 0)} %) ` +
           `y las esquinas del fondo se separan ${fmtM(corner, 1)} m entre una y otra.`;
  }
  if (flex.ok) msg += ` El rango completo de formas posibles va de ${fmtM(flex.areaMin, 0)} a ${fmtM(flex.areaMax, 0)} m².`;
  msg += ' Elige una para seguir; podrás corregirlo luego sin repetir ninguna cota.';

  info.className = 'hint tri-warn';
  info.textContent = msg;
  $('#tri-choice').classList.remove('hidden');
  // La salida buena —una sola distancia a la valla— no puede quedar escondida
  // justo cuando es cuando hace falta.
  $('#tri-alt').open = true;
}

let triCandidates = null;
$$('.tri-opt').forEach(b => b.addEventListener('click', () => {
  if (!triCandidates) return;
  const r = b.dataset.assume === 'square' ? triCandidates.square : triCandidates.trap;
  if (!r?.ok) return;
  $('#tri-choice').classList.add('hidden');
  applyQuad(r);
}));

$('#a-here').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('Sin geolocalización'); return; }
  $('#a-status').textContent = 'Obteniendo posición…';
  navigator.geolocation.getCurrentPosition(pos => {
    P.cur.anchor = {
      lat: pos.coords.latitude, lon: pos.coords.longitude,
      rot: parseFloat($('#a-rot').value) || 0,
    };
    touch(false);
    fillDataForm();
    $('#a-status').textContent = `Anclado con ±${Math.round(pos.coords.accuracy)} m de precisión GPS.`;
    toast('Origen anclado');
  }, err => { $('#a-status').textContent = 'No se pudo obtener la posición: ' + err.message; },
     { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
});

['#a-lat', '#a-lon', '#a-rot'].forEach(s => $(s).addEventListener('change', () => {
  const lat = parseFloat($('#a-lat').value), lon = parseFloat($('#a-lon').value);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    P.cur.anchor = { lat, lon, rot: parseFloat($('#a-rot').value) || 0 };
    touch(false);
    fillDataForm();
  }
}));

$('#a-clear').addEventListener('click', () => { P.cur.anchor = null; touch(false); fillDataForm(); });

$('#btn-gps').addEventListener('click', () => {
  if (!P.cur.anchor) { toast('Ancla primero el origen en Datos'); setView('data'); return; }
  if (!navigator.geolocation) { toast('Sin geolocalización'); return; }
  toast('Localizando…');
  navigator.geolocation.getCurrentPosition(pos => {
    const l = latLonToLocal(pos.coords.latitude, pos.coords.longitude, P.cur.anchor);
    $('#hud-coords').textContent = `Estás en X ${fmtM(l.x)} · Y ${fmtM(l.y)} (±${Math.round(pos.coords.accuracy)} m)`;
    ['#p-x', '#f-x'].forEach(s => $(s).value = fmtNum(l.x));
    ['#p-y', '#f-y'].forEach(s => $(s).value = fmtNum(l.y));
    toast(`X ${fmtM(l.x)} · Y ${fmtM(l.y)} — precisión GPS ±${Math.round(pos.coords.accuracy)} m`);
  }, err => toast('GPS: ' + err.message), { enableHighAccuracy: true, timeout: 15000 });
});

/* ── exportación ── */

$$('.export-grid button').forEach(b => b.addEventListener('click', async () => {
  const base = EX.fileBase();
  try {
    switch (b.dataset.exp) {
      case 'json':    download(`${base}.json`, EX.toJSON(), 'application/json'); break;
      case 'csv':     download(`${base}-cotas.csv`, '﻿' + EX.toCSV(), 'text/csv'); break;
      case 'geojson': download(`${base}.geojson`, EX.toGeoJSON(), 'application/geo+json'); break;
      case 'kml':     download(`${base}.kml`, EX.toKML(), 'application/vnd.google-earth.kml+xml'); break;
      case 'dxf':     download(`${base}.dxf`, EX.toDXF(), 'application/dxf'); break;
      case 'svg':     download(`${base}.svg`, EX.toSVG(), 'image/svg+xml'); break;
      case 'obj':     download(`${base}.obj`, EX.toOBJ(), 'model/obj'); break;
      case 'bundle':
        toast('Empaquetando…');
        download(`${base}.zip`, await EX.toBundle()); break;
    }
    if (b.dataset.exp !== 'bundle') toast('Archivo generado');
  } catch (e) {
    console.error(e);
    toast('Error al exportar: ' + e.message);
  }
}));

/* ── copia de seguridad ── */

$('#bk-save').addEventListener('click', () => {
  download(`${EX.fileBase()}.json`, EX.toJSON(), 'application/json');
  const st = stats();
  $('#bk-state').textContent = `${st.nPoints} cotas guardadas`;
  toast('Copia guardada en Descargas');
});

/**
 * Carga un .json. En vez de machacar sin más, enseña qué trae el fichero y deja
 * elegir entre sustituir o combinar: una jornada de campo no se puede repetir.
 */
async function handleImport(file) {
  let p;
  try {
    p = JSON.parse(await file.text());
    if (!p || !Array.isArray(p.points)) throw new Error('No parece un proyecto de Navata');
  } catch (err) { toast('Error: ' + err.message); return; }

  const inc = describeProject(p);
  const act = stats();
  const fila = (k, a, b) => `<tr><td>${k}</td><td class="n">${a}</td><td class="n">${b}</td></tr>`;

  $('#modal-body').innerHTML = `
    <h2 style="margin:0 0 4px;font-size:15px">${escapeHTML(inc.name)}</h2>
    <p class="hint" style="margin:0 0 12px">Visita del ${escapeHTML(inc.visitDate)}${
      inc.updatedAt ? ` · guardado el ${new Date(inc.updatedAt).toLocaleString('es-ES')}` : ''}</p>
    <table class="cmp">
      <thead><tr><th></th><th class="n">En el fichero</th><th class="n">Ahora aquí</th></tr></thead>
      <tbody>
        ${fila('Cotas medidas', inc.nPoints, act.nPoints)}
        ${fila('Estaciones pendientes', inc.nPending, act.nPending)}
        ${fila('Árboles', inc.nTrees, act.nTrees)}
        ${fila('Fotos', inc.nPhotos, act.nPhotos)}
        ${fila('Desnivel', fmtM(inc.drop, 2) + ' m', fmtM(act.drop, 2) + ' m')}
        ${fila('Superficie', fmtM(inc.area, 1) + ' m²', fmtM(act.area, 1) + ' m²')}
      </tbody>
    </table>
    ${inc.nPhotos ? '<p class="hint">Las fotografías no viajan dentro del .json. Si cargas este fichero en otro teléfono, sus fotos aparecerán sin imagen.</p>' : ''}
    <div class="btn-row" style="margin-top:14px">
      <button id="imp-merge" class="primary">Combinar con lo que hay</button>
      <button id="imp-replace" class="danger">Sustituir todo</button>
    </div>
    <div class="btn-row"><button id="imp-cancel" class="ghost">Cancelar</button></div>`;
  $('#modal').classList.remove('hidden');

  const cerrar = () => $('#modal').classList.add('hidden');
  $('#imp-cancel').addEventListener('click', cerrar);

  $('#imp-merge').addEventListener('click', () => {
    const r = mergeProject(p);
    cerrar();
    R.fitView(canvas);
    setView('map');
    toast(`Combinado: ${r.cotas} cotas nuevas` +
      (r.descartadas ? `, ${r.descartadas} ya estaban` : '') +
      (r.arboles ? `, ${r.arboles} árboles` : ''));
  });

  $('#imp-replace').addEventListener('click', () => {
    if (!confirm('Se perderá todo lo medido en este teléfono. ¿Seguro?')) return;
    replaceProject(p);
    cerrar();
    R.fitView(canvas);
    setView('map');
    toast('Proyecto sustituido');
  });
}

for (const sel of ['#bk-load', '#d-import']) {
  $(sel).addEventListener('change', async e => {
    if (e.target.files[0]) await handleImport(e.target.files[0]);
    e.target.value = '';
  });
}

/* ── copias automáticas ── */

function renderSnapshots() {
  const snaps = listSnapshots();
  const el = $('#bk-list');
  $('#bk-state').textContent = snaps.length ? `${snaps.length} copias autom.` : 'sin copias';
  if (!snaps.length) {
    el.innerHTML = '<div class="empty">Se irán guardando solas conforme midas.</div>';
    return;
  }
  el.innerHTML = snaps.map((s, i) => `
    <div class="list-item">
      <div class="li-main">
        <div class="li-title">${new Date(s.t).toLocaleString('es-ES')}</div>
        <div class="li-sub">${s.nPoints} cotas · ${s.nTrees} árboles · ${s.nPhotos} fotos</div>
      </div>
      <button class="li-act" data-snap="${i}">Restaurar</button>
    </div>`).join('');

  el.querySelectorAll('[data-snap]').forEach(b => b.addEventListener('click', () => {
    const s = listSnapshots()[+b.dataset.snap];
    if (!s) return;
    if (!confirm(`Volver al estado del ${new Date(s.t).toLocaleString('es-ES')} (${s.nPoints} cotas).\n` +
                 'Lo medido después se perderá. ¿Seguro?')) return;
    try {
      replaceProject(JSON.parse(s.data));
      R.fitView(canvas);
      setView('map');
      toast('Copia restaurada');
    } catch { toast('Esa copia está dañada'); }
  }));
}

$('#bk-auto').addEventListener('toggle', () => { if ($('#bk-auto').open) renderSnapshots(); });

$('#d-reset').addEventListener('click', async () => {
  if (!confirm('Se borrarán todas las cotas, árboles y fotos de este dispositivo. ¿Seguro?')) return;
  await blobs.clear().catch(() => {});
  clearProject();
  clearSnapshots();
  replaceProject(emptyProject());
  R.fitView(canvas);
  toast('Proyecto nuevo');
  setView('data');
});

$('#d-demo').addEventListener('click', () => {
  if (P.cur.points.length && !confirm('Se sustituirá el proyecto actual. ¿Continuar?')) return;
  replaceProject(demoProject());
  R.fitView(canvas);
  setView('map');
  toast('Ejemplo cargado: parcela de 15,92 × 44 m');
});

/** Parcela sintética con pendiente hacia la calle, para probar la app sin datos reales. */
function demoProject() {
  const p = emptyProject();
  p.name = 'Ejemplo · 15,50 × 32 m';
  p.notes = 'Datos sintéticos de demostración. Bórralos antes de medir de verdad.';
  p.streetEdge = 0;
  const W = 15.5, H = 32;
  const zAt = (x, y) =>
    -0.032 * y                                  // caída general hacia el fondo
    + 0.018 * x                                 // ligero peralte lateral
    - 0.5 * Math.exp(-(((x - 11) ** 2) / 12 + ((y - 22) ** 2) / 40))   // vaguada
    + 0.28 * Math.exp(-(((x - 4) ** 2) / 10 + ((y - 9) ** 2) / 30));   // loma
  for (let y = 0; y <= H; y += 4) {
    for (let x = 0; x <= W; x += 4) {
      const xx = Math.min(x, W);
      p.points.push({
        id: uid(), x: xx, y, z: Math.round(zAt(xx, y) * 1000) / 1000,
        label: `M${p.points.length + 1}`, type: y === 0 && xx === 0 ? 'ref' : 'grid',
        method: 'hose', ts: new Date().toISOString(),
      });
    }
  }
  p.points[0].z = 0;
  p.trees = [
    { id: uid(), x: 3.5, y: 6, species: 'Olivo', dbh: 42, canopy: 5, height: 4.5, health: 'bueno', notes: '', label: 'A1', ts: '' },
    { id: uid(), x: 12, y: 14, species: 'Higuera', dbh: 26, canopy: 4, height: 3.5, health: 'bueno', notes: '', label: 'A2', ts: '' },
    { id: uid(), x: 6.5, y: 24, species: 'Almendro', dbh: 18, canopy: 3, height: 3, health: 'regular', notes: 'ramas secas', label: 'A3', ts: '' },
    { id: uid(), x: 13, y: 29, species: 'Encina', dbh: 55, canopy: 7, height: 6, health: 'bueno', notes: '', label: 'A4', ts: '' },
  ];
  return p;
}

/* ═══════════════════ menú de proyecto ═══════════════════ */

$('#btn-menu').addEventListener('click', () => setView('data'));

/* ═══════════════════ reacción a cambios ═══════════════════ */

onChange(() => {
  R.invalidateRaster();
  requestDraw();
  renderPoints();
  renderTrees();
  renderHero();
  if (!$('#quick').classList.contains('hidden')) quickRender();
  const st = stats();
  $('#project-name').textContent = P.cur.name;
  $('#project-sub').textContent = st.area
    ? `${fmtM(st.area, 1)} m² · ${st.nPoints} cotas · Δ ${fmtM(st.drop, 2)} m`
    : `${st.nPoints} cotas · define el borde en Datos`;
  if (ui.view === 'data') fillDataForm();
  if (ui.view === '3d') draw3dSafe();
  if (ui.view === 'photos') updateCoverage();
  if (ui.profileLine) drawProfile();
});

window.addEventListener('resize', debounce(() => {
  requestDraw();
  if (ui.view === '3d') draw3dSafe();
  if (ui.profileLine) drawProfile();
}, 120));

/* ═══════════════════ arranque ═══════════════════ */

$('#guide-content').innerHTML = GUIDE_HTML;
initQuick();
updateCompass();
// Mientras no haya medidas, la fecha de visita sigue al día actual: así el
// proyecto preparado en casa queda fechado el día que se pisa la parcela.
if (!P.cur.visitDate || !P.cur.points.length) P.cur.visitDate = today();

// La app abre por donde se trabaja: si hay parcela, en la pantalla de medir.
// Solo manda a Datos cuando falta lo básico y no hay nada que medir.
if (P.cur.boundary.length >= 3) setView('points');
else setView('data');

touch(true);
R.fitView(canvas);
requestDraw();
renderPhotos();

/* ═══════════════════ actualizaciones ═══════════════════
   La app se instala en el móvil y se sirve desde caché, así que sin esto una
   versión nueva podía tardar días en aparecer, o peor: quedarse a medias entre
   dos. Aquí se detecta, se avisa y se aplica cuando el usuario lo acepta. */

// Debe coincidir con VERSION en sw.js
const APP_VERSION = '2026.08.02-4';

let swReg = null;
let recargando = false;

function mostrarActualizacion(worker) {
  const el = $('#update-bar');
  el.classList.remove('hidden');
  $('#update-go').onclick = () => {
    $('#update-go').textContent = 'Actualizando…';
    worker.postMessage('SKIP_WAITING');
  };
  $('#update-later').onclick = () => el.classList.add('hidden');
}

async function buscarActualizacion(avisarSiNoHay = false) {
  if (!swReg) { if (avisarSiNoHay) toast('Sin service worker: recarga la página'); return; }
  try {
    await swReg.update();
    if (swReg.waiting) { mostrarActualizacion(swReg.waiting); return; }
    if (avisarSiNoHay) toast(`Ya tienes la última versión (${APP_VERSION})`);
  } catch {
    if (avisarSiNoHay) toast('No se pudo comprobar: ¿estás sin cobertura?');
  }
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // La ruta se resuelve contra el documento, así funciona igual en la raíz del
  // dominio que bajo un subdirectorio de GitHub Pages.
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI))
    .then(reg => {
      swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) mostrarActualizacion(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          // Solo se avisa si ya había una versión corriendo: en la primera
          // instalación no hay nada que actualizar.
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) mostrarActualizacion(nuevo);
        });
      });
    })
    .catch(err => console.warn('SW no registrado:', err));

  // Cuando el trabajador nuevo toma el control, se recarga una sola vez
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });

  // Al volver a la app se mira si hay algo nuevo, sin molestar si no lo hay
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') buscarActualizacion(false);
  });
}

$('#d-version').textContent = APP_VERSION;
$('#d-check-update').addEventListener('click', () => {
  toast('Comprobando…');
  buscarActualizacion(true);
});
