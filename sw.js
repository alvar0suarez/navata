// sw.js — caché para uso sin cobertura en la parcela.
// Estrategia: la app se precarga en la instalación y luego se sirve desde caché,
// refrescándose en segundo plano cuando hay red (stale-while-revalidate).

// Al cambiar esta versión hay que cambiar también APP_VERSION en app.js.
const VERSION = '2026.08.09-5';
const CACHE = 'navata-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './procedimiento.html',
  './revision.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/util.js',
  './assets/js/store.js',
  './assets/js/state.js',
  './assets/js/geom.js',
  './assets/js/render2d.js',
  './assets/js/render3d.js',
  './assets/js/coverage.js',
  './assets/js/photos.js',
  './assets/js/exporters.js',
  './assets/js/zip.js',
  './assets/js/guide.js',
  './assets/js/quickmode.js',
];

self.addEventListener('install', e => {
  // Sin skipWaiting: la versión nueva espera a que el usuario acepte. Cambiar
  // los módulos por debajo de una pantalla ya cargada deja la app a medias
  // entre dos versiones, y eso midiendo en el campo no es aceptable.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .catch(err => console.warn('precarga incompleta', err))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La página pide el relevo cuando el usuario acepta actualizar
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'VERSION') e.source?.postMessage({ version: VERSION });
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
