// store.js — persistencia local. El proyecto (ligero) va en localStorage;
// las fotos (pesadas) en IndexedDB. Todo funciona sin conexión.

const DB_NAME = 'navata';
const DB_VER = 1;
const STORE = 'blobs';
const LS_KEY = 'navata.project.v1';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const blobs = {
  put: (key, blob) => tx('readwrite', s => s.put(blob, key)).then(() => key),
  get: key => tx('readonly', s => s.get(key)),
  del: key => tx('readwrite', s => s.delete(key)),
  keys: () => tx('readonly', s => s.getAllKeys()),
  clear: () => tx('readwrite', s => s.clear()),
};

/* ── proyecto ── */

export function loadProject() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveProject(p) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
    return true;
  } catch (e) {
    console.warn('No se pudo guardar el proyecto', e);
    return false;
  }
}

export function clearProject() {
  localStorage.removeItem(LS_KEY);
}

/* ── caché de object URLs para miniaturas ── */
const urlCache = new Map();

export async function blobURL(key) {
  if (!key) return null;
  if (urlCache.has(key)) return urlCache.get(key);
  const b = await blobs.get(key);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urlCache.set(key, u);
  return u;
}

export function revokeURL(key) {
  const u = urlCache.get(key);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(key); }
}
