// quickmode.js — pantalla de medición a una mano.
// Pensada para usarse de pie en la parcela, con guantes y la cinta en la otra
// mano: teclado grande, la estación siguiente siempre a la vista y nada más.

import { P, addPoint, delPoint, touch } from './state.js';
import { $, $$, fmtM, fmtZ, toast } from './util.js';

let wakeLock = null;
let buffer = '';
let pointType = 'grid';
let lastAction = null;       // para deshacer
let onCloseCb = null;

const cfg = () => P.cur.settings;

/* ── los tres modos de entrada ────────────────────────────────────────────
   cuerda   — tecleas la caída desde la cuerda nivelada hasta el suelo (cm).
              Z = altura de la cuerda − caída.
   manguera — tecleas la lectura en la mira (cm).
              Z = origen + (lectura de referencia − lectura) / 100.
   z        — tecleas la cota directamente en metros.                        */

const MODOS = {
  cuerda:   { etiqueta: 'Cuerda',   unidad: 'cm de caída desde la cuerda' },
  manguera: { etiqueta: 'Manguera', unidad: 'cm en la mira' },
  z:        { etiqueta: 'Cota Z',   unidad: 'metros de cota' },
};

/**
 * Flecha de la cuerda en el punto actual, en metros.
 *
 * Una cuerda tendida no es una recta: cuelga formando una catenaria que a
 * efectos prácticos es una parábola, máxima en el centro y nula en los apoyos.
 * Sobre 32 m, una cuerda de obra tirando fuerte pandea 7,7 cm en el centro,
 * más que todo el margen de error del levantamiento, así que hay que restarla.
 */
function flecha(st) {
  const F = (cfg().flechaCuerda || 0) / 100;
  if (!F || !st || !(st.L > 0)) return 0;
  const t = Math.min(Math.max(st.d / st.L, 0), 1);
  return 4 * F * t * (1 - t);
}

/** Convierte lo tecleado en cota Z (m), o NaN si aún no hay nada válido. */
function currentZ() {
  const v = parseFloat(buffer.replace(',', '.'));
  if (!Number.isFinite(v)) return NaN;
  const s = cfg();
  if (s.metodo === 'z') return v;
  // La cuerda real está `flecha` por debajo de la línea entre los dos apoyos
  if (s.metodo === 'cuerda') return s.alturaCuerda - flecha(station()) - v / 100;
  return s.refOffset + (s.refReading - v) / 100;
}

const station = () => P.cur.pending[0] || null;

/** Línea (tendido de cuerda) de la última cota guardada, para detectar el cambio. */
let lastLine = null;

/* ── ciclo de vida ── */

export async function openQuick(onClose) {
  onCloseCb = onClose;
  buffer = '';
  lastAction = null;
  lastLine = null;
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
  if (!Number.isFinite(z)) { toast('Introduce la medida'); return; }
  const st = station();
  if (!st) { toast('No quedan estaciones pendientes'); return; }

  const metodos = { cuerda: 'line', manguera: 'hose', z: 'est' };
  const pt = addPoint({
    x: st.x, y: st.y, z,
    label: st.label, type: pointType,
    method: metodos[cfg().metodo] || 'line',
  });
  lastAction = { pointId: pt.id, station: st, line: lastLine };
  lastLine = st.line ?? null;
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
  lastLine = lastAction.line;
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
  const modo = MODOS[s.metodo] || MODOS.cuerda;

  $('#q-station').textContent = st ? st.label : '—';
  $('#q-progress').textContent = total ? `${done} de ${total}` : `${done} cotas`;
  $('#q-xy').textContent = st ? `X ${fmtM(st.x)}   ·   Y ${fmtM(st.y)}` : 'Genera la malla en la pestaña Cotas';

  $('#q-buffer').textContent = buffer || '—';
  $('#q-unit').textContent = modo.unidad;
  $('#q-result').textContent = Number.isFinite(z) ? fmtZ(z) : '—';
  $('#q-result').classList.toggle('neg', Number.isFinite(z) && z < 0);
  $('#q-mode').textContent = modo.etiqueta;

  const fl = flecha(st);
  $('#q-ref').textContent =
    s.metodo === 'cuerda'
      ? `cuerda a ${fmtZ(s.alturaCuerda)} m` +
        (s.flechaCuerda ? ` · flecha ${fmtM(s.flechaCuerda, 1)} cm → aquí ${fmtM(fl * 100, 1)} cm` : ' · sin corregir la flecha')
    : s.metodo === 'manguera' ? `ref ${fmtM(s.refReading, 1)} cm · origen ${fmtZ(s.refOffset)} m`
    : 'entrada directa de cota';
  $('#q-ref').classList.toggle('warn', s.metodo === 'cuerda' && !s.flechaCuerda);

  // Aviso de cambio de tendido: es el momento de volver a nivelar la cuerda y
  // de decirle a la app a qué altura ha quedado. Olvidarlo desplaza toda la
  // línea, y en el plano se ve como un escalón que no existe.
  const nuevaLinea = s.metodo === 'cuerda' && st && st.line >= 0 && lastLine !== null && st.line !== lastLine;
  $('#q-newline').classList.toggle('hidden', !nuevaLinea);
  if (nuevaLinea) $('#q-newline-txt').textContent =
    `Línea ${st.line + 1}${s.nLines ? ' de ' + s.nLines : ''} · X = ${fmtM(st.x)} m`;

  $('#q-break').classList.toggle('on', pointType === 'break');
  $('#q-save').disabled = !st || !Number.isFinite(z);
  $('#q-undo').disabled = !lastAction;

  // Siguientes estaciones, para saber hacia dónde caminar.
  // Con coma decimal, "4,0,0,0" es ilegible: se etiquetan los dos ejes.
  $('#q-next').innerHTML = P.cur.pending.slice(1, 4)
    .map(p => `<span>${p.label} · X${fmtM(p.x, 1)} Y${fmtM(p.y, 1)}</span>`).join('')
    || '<span>última estación</span>';
}

/* ── panel de ajustes ── */

function openCfg() {
  const s = cfg();
  $('#q-cfg').classList.remove('hidden');
  $$('#q-cfg [data-modo]').forEach(b => b.classList.toggle('on', b.dataset.modo === s.metodo));
  $$('#q-cfg .cfg-group').forEach(g => g.classList.toggle('hidden', g.dataset.for !== s.metodo));
  $('#cfg-altura').value = s.alturaCuerda;
  $('#cfg-flecha').value = s.flechaCuerda;
  $('#cfg-ref').value = s.refReading;
  $('#cfg-origen').value = s.refOffset;
  cfgHelper();
  cfgFlechaHelper();
}

const closeCfg = () => $('#q-cfg').classList.add('hidden');

/**
 * Ayuda para fijar la altura de la cuerda sin hacer cuentas: se parte de un
 * punto de cota conocida (el extremo del tendido anterior, o el cero) y se mide
 * con la cinta cuánto queda la cuerda por encima de él.
 */
function cfgHelper() {
  const zBase = parseFloat($('#cfg-zbase').value.replace(',', '.'));
  const sobre = parseFloat($('#cfg-sobre').value.replace(',', '.'));
  if (!Number.isFinite(zBase) || !Number.isFinite(sobre)) { $('#cfg-calc').textContent = ''; return null; }
  const h = zBase + sobre / 100;
  $('#cfg-calc').textContent = `→ cuerda a ${fmtZ(h)} m`;
  return h;
}

/**
 * Calibra la flecha comparando, en el centro del tendido, la cota que da la
 * cuerda con la cota real obtenida por otro medio (la manguera del primer día).
 * Basta hacerlo una vez: la misma cuerda tensada igual pandea igual.
 *
 *   Z_real = altura − F − caída/100   ⟹   F = altura − Z_real − caída/100
 */
function cfgFlechaHelper() {
  const zReal = parseFloat($('#cfg-fz').value.replace(',', '.'));
  const caida = parseFloat($('#cfg-fc').value.replace(',', '.'));
  if (!Number.isFinite(zReal) || !Number.isFinite(caida)) { $('#cfg-fcalc').textContent = ''; return null; }
  const F = (cfg().alturaCuerda - zReal - caida / 100) * 100;
  $('#cfg-fcalc').textContent = `→ flecha ${fmtM(F, 1)} cm`;
  return F;
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

  $('#q-mode').addEventListener('click', openCfg);
  $('#q-ref').addEventListener('click', openCfg);
  $('#q-newline').addEventListener('click', openCfg);
  $('#cfg-close').addEventListener('click', closeCfg);
  $('#q-cfg').addEventListener('click', e => { if (e.target.id === 'q-cfg') closeCfg(); });

  $$('#q-cfg [data-modo]').forEach(b => b.addEventListener('click', () => {
    cfg().metodo = b.dataset.modo;
    buffer = '';
    touch(false);
    openCfg();
    render();
  }));

  const num = (sel, key, factor = 1) => $(sel).addEventListener('input', () => {
    const v = parseFloat($(sel).value.replace(',', '.'));
    if (Number.isFinite(v)) { cfg()[key] = v * factor; touch(false); render(); }
  });
  num('#cfg-altura', 'alturaCuerda');
  num('#cfg-flecha', 'flechaCuerda');
  num('#cfg-ref', 'refReading');
  num('#cfg-origen', 'refOffset');

  $('#cfg-fz').addEventListener('input', cfgFlechaHelper);
  $('#cfg-fc').addEventListener('input', cfgFlechaHelper);
  $('#cfg-fusar').addEventListener('click', () => {
    const F = cfgFlechaHelper();
    if (F === null) { toast('Faltan los dos datos'); return; }
    if (F < -1 || F > 40) { toast('Esa flecha no es creíble: repasa los datos'); return; }
    cfg().flechaCuerda = Math.round(F * 10) / 10;
    touch(false);
    openCfg();
    render();
    toast(`Flecha calibrada en ${fmtM(cfg().flechaCuerda, 1)} cm`);
  });

  $('#cfg-zbase').addEventListener('input', cfgHelper);
  $('#cfg-sobre').addEventListener('input', cfgHelper);
  $('#cfg-usar').addEventListener('click', () => {
    const h = cfgHelper();
    if (h === null) { toast('Faltan los dos datos'); return; }
    cfg().alturaCuerda = h;
    cfg().metodo = 'cuerda';
    touch(false);
    openCfg();
    render();
    toast(`Cuerda fijada en ${fmtZ(h)} m`);
  });

  // Al aceptar la nueva altura, el aviso de cambio de línea deja de tener sentido
  $('#cfg-ok').addEventListener('click', () => {
    lastLine = station()?.line ?? lastLine;
    closeCfg();
    render();
  });

  // Teclado físico, útil al revisar datos en el ordenador
  document.addEventListener('keydown', e => {
    if ($('#quick').classList.contains('hidden')) return;
    if (!$('#q-cfg').classList.contains('hidden')) {
      if (e.key === 'Escape') { closeCfg(); e.preventDefault(); }
      return;
    }
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
