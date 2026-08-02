// quickmode.js — pantalla de medición a una mano.
// Pensada para usarse de pie en la parcela, con guantes y el listón en la otra
// mano: teclado grande, la estación siguiente siempre a la vista y nada más.

import { P, addPoint, delPoint, touch } from './state.js';
import { $, fmtM, fmtZ, toast, uid } from './util.js';

let wakeLock = null;
let buffer = '';
let mode = 'reading';        // 'reading' = lectura en la mira (cm) · 'z' = cota directa (m)
let pointType = 'grid';
let lastAction = null;       // para deshacer
let onCloseCb = null;

/* ── referencia de la manguera ──────────────────────────────────────────
   Z = refOffset + (refReading − lectura) / 100
   refOffset es la cota del punto donde está apoyado el extremo fijo, lo que
   permite mover la manguera sin perder el origen: se arrastra la diferencia. */

const cfg = () => {
  const s = P.cur.settings;
  if (s.refReading === undefined) s.refReading = 100;
  if (s.refOffset === undefined) s.refOffset = 0;
  return s;
};

/** Convierte lo tecleado en cota Z (m), o NaN si aún no hay nada válido. */
function currentZ() {
  const v = parseFloat(buffer.replace(',', '.'));
  if (!Number.isFinite(v)) return NaN;
  if (mode === 'z') return v;
  const s = cfg();
  return s.refOffset + (s.refReading - v) / 100;
}

const station = () => P.cur.pending[0] || null;

/* ── ciclo de vida ── */

export async function openQuick(onClose) {
  onCloseCb = onClose;
  buffer = '';
  lastAction = null;
  $('#quick').classList.remove('hidden');
  document.body.classList.add('quick-open');
  render();
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* el navegador puede negarlo; no es crítico */ }
  document.addEventListener('visibilitychange', reacquire);
}

export function closeQuick() {
  $('#quick').classList.add('hidden');
  document.body.classList.remove('quick-open');
  document.removeEventListener('visibilitychange', reacquire);
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  onCloseCb?.();
}

async function reacquire() {
  if (document.visibilityState === 'visible' && !wakeLock && 'wakeLock' in navigator) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignorado */ }
  }
}

/* ── acciones ── */

function press(key) {
  if (key === 'del') buffer = buffer.slice(0, -1);
  else if (key === 'sign') buffer = buffer.startsWith('-') ? buffer.slice(1) : '-' + buffer;
  else if (key === ',') { if (!buffer.includes(',')) buffer += buffer ? ',' : '0,'; }
  else if (buffer.replace(/[-,]/g, '').length < 6) buffer += key;
  render();
}

function save() {
  const z = currentZ();
  if (!Number.isFinite(z)) { toast('Introduce la lectura'); return; }
  const st = station();
  if (!st) { toast('No quedan estaciones pendientes'); return; }

  const pt = addPoint({
    x: st.x, y: st.y, z,
    label: st.label, type: pointType,
    method: mode === 'reading' ? 'hose' : 'est',
  });
  lastAction = { pointId: pt.id, station: st };
  buffer = '';
  pointType = 'grid';
  navigator.vibrate?.(35);
  render();
  if (!station()) toast('¡Malla completa! Exporta el proyecto antes de irte.');
}

function skip() {
  const st = station();
  if (!st) return;
  P.cur.pending.push(P.cur.pending.shift());
  touch(false);
  buffer = '';
  render();
  toast(`${st.label} aplazada al final`);
}

function undo() {
  if (!lastAction) { toast('Nada que deshacer'); return; }
  delPoint(lastAction.pointId);
  P.cur.pending.unshift(lastAction.station);
  lastAction = null;
  touch(false);
  buffer = '';
  render();
  toast('Última cota deshecha');
}

/* ── pintado ── */

function render() {
  const st = station();
  const done = P.cur.points.length;
  const total = done + P.cur.pending.length;
  const z = currentZ();
  const s = cfg();

  $('#q-station').textContent = st ? st.label : '—';
  $('#q-progress').textContent = total ? `${done} de ${total}` : `${done} cotas`;
  $('#q-xy').textContent = st ? `X ${fmtM(st.x)}   ·   Y ${fmtM(st.y)}` : 'Genera la malla en la pestaña Cotas';

  $('#q-buffer').textContent = buffer || '—';
  $('#q-unit').textContent = mode === 'reading' ? 'cm en la mira' : 'metros de cota';
  $('#q-result').textContent = Number.isFinite(z) ? fmtZ(z) : '—';
  $('#q-result').classList.toggle('neg', Number.isFinite(z) && z < 0);

  $('#q-ref').textContent = mode === 'reading'
    ? `ref ${fmtM(s.refReading, 1)} cm · origen ${fmtZ(s.refOffset)} m`
    : 'entrada directa de cota';

  $('#q-mode').textContent = mode === 'reading' ? 'Lectura' : 'Cota Z';
  $('#q-break').classList.toggle('on', pointType === 'break');
  $('#q-save').disabled = !st || !Number.isFinite(z);
  $('#q-undo').disabled = !lastAction;

  // Siguientes estaciones, para saber hacia dónde caminar
  // Con coma decimal, "4,0,0,0" es ilegible: se etiquetan los dos ejes.
  $('#q-next').innerHTML = P.cur.pending.slice(1, 4)
    .map(p => `<span>${p.label} · X${fmtM(p.x, 1)} Y${fmtM(p.y, 1)}</span>`).join('')
    || '<span>última estación</span>';
}

/* ── enlazado de la interfaz (una sola vez) ── */

export function initQuick() {
  const pad = $('#q-pad');
  pad.innerHTML = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'del']
    .map(k => `<button class="q-key${k === 'del' ? ' wide-icon' : ''}" data-k="${k}">${k === 'del' ? '⌫' : k}</button>`)
    .join('');
  pad.addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (b) press(b.dataset.k);
  });

  $('#q-close').addEventListener('click', closeQuick);
  $('#q-save').addEventListener('click', save);
  $('#q-skip').addEventListener('click', skip);
  $('#q-undo').addEventListener('click', undo);
  $('#q-sign').addEventListener('click', () => press('sign'));

  $('#q-break').addEventListener('click', () => {
    pointType = pointType === 'break' ? 'grid' : 'break';
    render();
  });

  $('#q-mode').addEventListener('click', () => {
    mode = mode === 'reading' ? 'z' : 'reading';
    buffer = '';
    render();
  });

  // Ajuste de la referencia de la manguera
  $('#q-ref').addEventListener('click', () => {
    const s = cfg();
    const r = prompt('Lectura de referencia en la mira (cm):', String(s.refReading));
    if (r === null) return;
    const rv = parseFloat(r.replace(',', '.'));
    if (Number.isFinite(rv)) s.refReading = rv;

    const o = prompt('Cota del punto donde apoya el extremo fijo (m).\n' +
                     'Déjalo en 0 salvo que hayas movido la manguera.', String(s.refOffset));
    if (o !== null) {
      const ov = parseFloat(o.replace(',', '.'));
      if (Number.isFinite(ov)) s.refOffset = ov;
    }
    touch(false);
    render();
  });

  // Teclado físico, útil al revisar datos en el ordenador
  document.addEventListener('keydown', e => {
    if ($('#quick').classList.contains('hidden')) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === ',' || e.key === '.') press(',');
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') save();
    else if (e.key === 'Escape') closeQuick();
    else return;
    e.preventDefault();
  });
}

export const quickRender = render;
