// Utilidades generales
export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp  = (a, b, t) => a + (b - a) * t;
export const uid   = () => Math.random().toString(36).slice(2, 10);

export const deg = r => r * 180 / Math.PI;
export const rad = d => d * Math.PI / 180;

/** Normaliza un ángulo a [0,360) */
export const norm360 = d => ((d % 360) + 360) % 360;

/** Formatea metros con signo explícito, 3 decimales */
export function fmtZ(z) {
  if (z === null || z === undefined || Number.isNaN(z)) return '—';
  const s = z >= 0 ? '+' : '−';
  return s + Math.abs(z).toFixed(3).replace('.', ',');
}
export const fmtM = (v, d = 2) => v.toFixed(d).replace('.', ',');

export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Escape para XML/HTML en exportadores */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
