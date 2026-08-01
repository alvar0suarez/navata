// photos.js — captura, compresión y orientación de fotografías.

import { blobs } from './store.js';
import { uid, norm360, toast } from './util.js';

const MAX_FULL = 1600;   // lado mayor de la imagen guardada
const MAX_THUMB = 300;

/** Redimensiona un File/Blob de imagen y devuelve {blob, w, h}. */
async function resize(file, maxSide, quality = 0.82) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Formato de imagen no soportado');
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', quality));
  return { blob, w, h };
}

/** Guarda una foto y devuelve el registro para el proyecto. */
export async function ingest(file, meta) {
  const full = await resize(file, MAX_FULL, 0.82);
  const thumb = await resize(file, MAX_THUMB, 0.7);
  const id = uid();
  const key = 'p_' + id, tkey = 't_' + id;
  await blobs.put(key, full.blob);
  await blobs.put(tkey, thumb.blob);
  return {
    id, key, thumb: tkey,
    x: +meta.x || 0, y: +meta.y || 0,
    bearing: norm360(+meta.bearing || 0),
    fov: +meta.fov || 70,
    range: +meta.range || 25,
    note: meta.note || '',
    w: full.w, h: full.h,
    bytes: full.blob.size,
    ts: new Date().toISOString(),
  };
}

/* ───────────────────── brújula del dispositivo ───────────────────── */

let compassHandler = null;

/**
 * Activa la brújula. `cb(headingTrueNorth)` recibe grados respecto al norte.
 * En iOS requiere permiso explícito tras un gesto del usuario.
 */
export async function startCompass(cb) {
  stopCompass();

  const need = typeof DeviceOrientationEvent !== 'undefined'
    && typeof DeviceOrientationEvent.requestPermission === 'function';
  if (need) {
    const st = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
    if (st !== 'granted') { toast('Permiso de brújula denegado'); return false; }
  }
  if (typeof DeviceOrientationEvent === 'undefined') {
    toast('Este dispositivo no expone brújula');
    return false;
  }

  let got = false;
  compassHandler = e => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') {
      h = e.webkitCompassHeading;                      // iOS: ya respecto al norte
    } else if (e.absolute && typeof e.alpha === 'number') {
      h = norm360(360 - e.alpha);                      // Android con orientación absoluta
    } else if (typeof e.alpha === 'number') {
      h = norm360(360 - e.alpha);                      // relativa: sirve como referencia
    }
    if (h !== null) { got = true; cb(norm360(h), e.absolute !== false); }
  };
  window.addEventListener('deviceorientationabsolute', compassHandler, true);
  window.addEventListener('deviceorientation', compassHandler, true);

  setTimeout(() => { if (!got) toast('Sin señal de brújula: usa el dial manual'); }, 2500);
  return true;
}

export function stopCompass() {
  if (!compassHandler) return;
  window.removeEventListener('deviceorientationabsolute', compassHandler, true);
  window.removeEventListener('deviceorientation', compassHandler, true);
  compassHandler = null;
}

/**
 * Convierte un rumbo geográfico (respecto al norte) al sistema local,
 * donde 0° es el eje +Y de la parcela.
 * anchorRot = rumbo del eje +Y local respecto al norte.
 */
export const trueToLocal = (headingN, anchorRot = 0) => norm360(headingN - anchorRot);
export const localToTrue = (bLocal, anchorRot = 0) => norm360(bLocal + anchorRot);
