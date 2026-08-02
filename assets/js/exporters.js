// exporters.js — salida a formatos reutilizables: CSV, GeoJSON, KML, DXF, SVG, OBJ y ZIP.

import { P, surface, stats } from './state.js';
import { localToLatLon, bbox } from './geom.js';
import { esc, fmtM } from './util.js';
import { blobs } from './store.js';
import { zipSync } from './zip.js';

const nf = (v, d = 3) => Number(v).toFixed(d);

function geo(x, y) {
  const a = P.cur.anchor;
  return a ? localToLatLon(x, y, a) : null;
}

export function fileBase() {
  const n = (P.cur.name || 'parcela').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${n || 'parcela'}-${P.cur.visitDate || ''}`.replace(/-$/, '');
}

/* ───────────────────────────── JSON ───────────────────────────── */

export function toJSON() {
  return JSON.stringify(P.cur, null, 2);
}

/* ───────────────────────────── CSV ───────────────────────────── */

export function toCSV() {
  const a = P.cur.anchor;
  const head = ['etiqueta', 'x_m', 'y_m', 'z_m', 'tipo', 'metodo', 'fecha'];
  if (a) head.push('lat', 'lon');
  const rows = [head.join(',')];

  for (const p of P.cur.points) {
    const r = [p.label, nf(p.x), nf(p.y), nf(p.z), p.type, p.method || '', p.ts];
    if (a) { const g = localToLatLon(p.x, p.y, a); r.push(nf(g.lat, 7), nf(g.lon, 7)); }
    rows.push(r.map(csvCell).join(','));
  }
  return rows.join('\r\n');
}

export function treesCSV() {
  const a = P.cur.anchor;
  const head = ['etiqueta', 'especie', 'x_m', 'y_m', 'diam_tronco_cm', 'diam_copa_m', 'altura_m', 'estado', 'notas'];
  if (a) head.push('lat', 'lon');
  const rows = [head.join(',')];
  for (const t of P.cur.trees) {
    const r = [t.label, t.species, nf(t.x), nf(t.y), t.dbh, t.canopy, t.height, t.health, t.notes];
    if (a) { const g = localToLatLon(t.x, t.y, a); r.push(nf(g.lat, 7), nf(g.lon, 7)); }
    rows.push(r.map(csvCell).join(','));
  }
  return rows.join('\r\n');
}

const csvCell = v => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ─────────────────────────── GeoJSON ─────────────────────────── */

export function toGeoJSON() {
  const p = P.cur;
  const { contours: cont } = surface();
  const feats = [];
  const pos = (x, y) => {
    const g = geo(x, y);
    return g ? [+nf(g.lon, 7), +nf(g.lat, 7)] : [+nf(x), +nf(y)];
  };

  if (p.boundary.length >= 3) {
    feats.push({
      type: 'Feature',
      properties: { tipo: 'parcela', nombre: p.name, area_m2: +nf(stats().area, 2) },
      geometry: { type: 'Polygon', coordinates: [[...p.boundary.map(v => pos(v.x, v.y)), pos(p.boundary[0].x, p.boundary[0].y)]] },
    });
  }

  for (const c of cont) for (const line of c.lines) {
    if (line.length < 2) continue;
    feats.push({
      type: 'Feature',
      properties: { tipo: 'curva_nivel', cota_m: +nf(c.level) },
      geometry: { type: 'LineString', coordinates: line.map(q => pos(q.x, q.y)) },
    });
  }

  for (const q of p.points) feats.push({
    type: 'Feature',
    properties: { tipo: 'cota', etiqueta: q.label, z_m: +nf(q.z), clase: q.type, metodo: q.method },
    geometry: { type: 'Point', coordinates: pos(q.x, q.y) },
  });

  for (const t of p.trees) feats.push({
    type: 'Feature',
    properties: {
      tipo: 'arbol', etiqueta: t.label, especie: t.species, diam_copa_m: t.canopy,
      diam_tronco_cm: t.dbh, altura_m: t.height, estado: t.health, notas: t.notes,
    },
    geometry: { type: 'Point', coordinates: pos(t.x, t.y) },
  });

  for (const ph of p.photos) feats.push({
    type: 'Feature',
    properties: {
      tipo: 'foto', rumbo_local: ph.bearing,
      rumbo_geografico: p.anchor ? (ph.bearing + (p.anchor.rot || 0)) % 360 : null,
      angulo_vision: ph.fov, alcance_m: ph.range, nota: ph.note, archivo: `fotos/${ph.id}.jpg`,
    },
    geometry: { type: 'Point', coordinates: pos(ph.x, ph.y) },
  });

  return JSON.stringify({
    type: 'FeatureCollection',
    name: p.name,
    crs: p.anchor ? undefined : { type: 'name', properties: { name: 'coordenadas locales en metros' } },
    features: feats,
  }, null, 1);
}

/* ───────────────────────────── KML ───────────────────────────── */

export function toKML() {
  const p = P.cur;
  const { contours: cont } = surface();
  const a = p.anchor;
  const cc = (x, y, z = 0) => {
    if (a) { const g = localToLatLon(x, y, a); return `${nf(g.lon, 7)},${nf(g.lat, 7)},${nf(z, 2)}`; }
    return `${nf(x)},${nf(y)},${nf(z, 2)}`;
  };

  // Nota: los colores KML van en orden aabbggrr, no aarrggbb.
  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>${esc(p.name)}</name>
<description>${esc(`Levantamiento ${p.visitDate}. ${p.notes || ''}`)}</description>
<Style id="sCota"><IconStyle><color>ffdea84e</color><scale>0.7</scale></IconStyle></Style>
<Style id="sArbol"><IconStyle><color>ffa0e15e</color><scale>0.9</scale></IconStyle></Style>
<Style id="sFoto"><IconStyle><color>ffea92c7</color><scale>0.9</scale></IconStyle></Style>
<Style id="sCurva"><LineStyle><color>ffbee6ff</color><width>1.4</width></LineStyle></Style>
<Style id="sBorde"><LineStyle><color>ffffffff</color><width>3</width></LineStyle>
<PolyStyle><color>22ffffff</color></PolyStyle></Style>`);

  if (p.boundary.length >= 3) {
    const ring = [...p.boundary, p.boundary[0]].map(v => cc(v.x, v.y)).join(' ');
    parts.push(`<Placemark><name>Parcela</name><styleUrl>#sBorde</styleUrl>
<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
  }

  parts.push('<Folder><name>Curvas de nivel</name>');
  for (const c of cont) for (const line of c.lines) {
    if (line.length < 2) continue;
    parts.push(`<Placemark><name>${nf(c.level, 2)} m</name><styleUrl>#sCurva</styleUrl>
<LineString><coordinates>${line.map(q => cc(q.x, q.y, c.level)).join(' ')}</coordinates></LineString></Placemark>`);
  }
  parts.push('</Folder>');

  parts.push('<Folder><name>Cotas</name>');
  for (const q of p.points) parts.push(
    `<Placemark><name>${esc(q.label)} (${nf(q.z)} m)</name><styleUrl>#sCota</styleUrl>
<Point><coordinates>${cc(q.x, q.y, q.z)}</coordinates></Point></Placemark>`);
  parts.push('</Folder>');

  parts.push('<Folder><name>Árboles</name>');
  for (const t of p.trees) parts.push(
    `<Placemark><name>${esc(t.label + ' · ' + t.species)}</name><styleUrl>#sArbol</styleUrl>
<description>${esc(`Copa ${t.canopy} m · tronco ${t.dbh} cm · altura ${t.height} m · ${t.health}. ${t.notes || ''}`)}</description>
<Point><coordinates>${cc(t.x, t.y)}</coordinates></Point></Placemark>`);
  parts.push('</Folder>');

  parts.push('<Folder><name>Fotos</name>');
  for (const ph of p.photos) {
    const trueB = a ? (ph.bearing + (a.rot || 0)) % 360 : ph.bearing;
    parts.push(`<Placemark><name>Foto ${esc(ph.note || ph.id)}</name><styleUrl>#sFoto</styleUrl>
<description>${esc(`Rumbo ${nf(trueB, 0)}° · visión ${ph.fov}° · alcance ${ph.range} m`)}</description>
<Point><coordinates>${cc(ph.x, ph.y)}</coordinates></Point></Placemark>`);
  }
  parts.push('</Folder>');

  parts.push('</Document></kml>');
  return parts.join('\n');
}

/* ───────────────────────────── DXF ───────────────────────────── */
// DXF R12 mínimo: polilíneas 3D para curvas, puntos y textos. Lo abre AutoCAD,
// LibreCAD, QCAD, SketchUp (con extensión) y la mayoría de CAD.

export function toDXF() {
  const p = P.cur;
  const { contours: cont } = surface();
  const o = [];
  const g = (code, val) => { o.push(String(code)); o.push(String(val)); };

  g(0, 'SECTION'); g(2, 'HEADER'); g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER');
  const layers = [['BORDE', 7], ['CURVAS', 4], ['CURVAS_MAESTRAS', 2], ['COTAS', 1], ['ARBOLES', 3], ['FOTOS', 6], ['TEXTO', 8]];
  g(70, layers.length);
  for (const [name, color] of layers) {
    g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');

  if (p.boundary.length >= 3) {
    polyline(g, [...p.boundary.map(v => ({ ...v, z: 0 })), { ...p.boundary[0], z: 0 }], 'BORDE', true);
  }

  const interval = p.settings.contourInterval;
  for (const c of cont) {
    const master = Math.abs(Math.round(c.level / interval) % 5) === 0;
    for (const line of c.lines) {
      if (line.length < 2) continue;
      polyline(g, line.map(q => ({ x: q.x, y: q.y, z: c.level })), master ? 'CURVAS_MAESTRAS' : 'CURVAS', false);
    }
  }

  for (const q of p.points) {
    g(0, 'POINT'); g(8, 'COTAS'); g(10, nf(q.x)); g(20, nf(q.y)); g(30, nf(q.z));
    text(g, q.x + 0.15, q.y + 0.15, q.z, 0.25, `${q.label} ${nf(q.z, 3)}`, 'TEXTO');
  }

  for (const t of p.trees) {
    g(0, 'CIRCLE'); g(8, 'ARBOLES'); g(10, nf(t.x)); g(20, nf(t.y)); g(30, 0); g(40, nf((t.canopy || 3) / 2));
    g(0, 'POINT'); g(8, 'ARBOLES'); g(10, nf(t.x)); g(20, nf(t.y)); g(30, 0);
    text(g, t.x + 0.2, t.y - 0.4, 0, 0.3, `${t.label} ${t.species}`, 'TEXTO');
  }

  for (const ph of p.photos) {
    const dir = ph.bearing * Math.PI / 180, half = (ph.fov || 70) / 2 * Math.PI / 180;
    const arm = s => ({
      x: ph.x + Math.sin(dir + s * half) * (ph.range || 25),
      y: ph.y + Math.cos(dir + s * half) * (ph.range || 25), z: 0,
    });
    polyline(g, [arm(-1), { x: ph.x, y: ph.y, z: 0 }, arm(1)], 'FOTOS', false);
  }

  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\r\n');
}

function polyline(g, pts, layer, closed) {
  g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, (closed ? 1 : 0) | 8);
  g(10, 0); g(20, 0); g(30, 0);
  for (const q of pts) {
    g(0, 'VERTEX'); g(8, layer); g(70, 32);
    g(10, nf(q.x)); g(20, nf(q.y)); g(30, nf(q.z || 0));
  }
  g(0, 'SEQEND'); g(8, layer);
}

function text(g, x, y, z, h, s, layer) {
  g(0, 'TEXT'); g(8, layer);
  g(10, nf(x)); g(20, nf(y)); g(30, nf(z));
  g(40, nf(h, 2)); g(1, String(s).slice(0, 250));
}

/* ───────────────────────────── SVG ───────────────────────────── */

export function toSVG() {
  const p = P.cur;
  const { contours: cont } = surface();
  const st = stats();
  const bb = p.boundary.length >= 3 ? bbox(p.boundary) : st.bb;
  const pad = 2.5;
  const W = bb.w + pad * 2, H = bb.h + pad * 2;
  const S = 40;                                   // px por metro en el SVG
  const X = x => nf((x - bb.x0 + pad) * S, 1);
  const Y = y => nf((bb.y1 - y + pad) * S, 1);    // invierte Y

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${nf(W * S, 0)}" height="${nf(H * S + 90, 0)}" viewBox="0 0 ${nf(W * S, 0)} ${nf(H * S + 90, 0)}" font-family="system-ui,sans-serif">`);
  o.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // malla métrica
  o.push('<g stroke="#e8edf2" stroke-width="0.8">');
  for (let x = Math.ceil(bb.x0); x <= bb.x1; x++) o.push(`<line x1="${X(x)}" y1="${Y(bb.y1)}" x2="${X(x)}" y2="${Y(bb.y0)}"/>`);
  for (let y = Math.ceil(bb.y0); y <= bb.y1; y++) o.push(`<line x1="${X(bb.x0)}" y1="${Y(y)}" x2="${X(bb.x1)}" y2="${Y(y)}"/>`);
  o.push('</g>');

  if (p.boundary.length >= 3) {
    o.push(`<polygon points="${p.boundary.map(v => `${X(v.x)},${Y(v.y)}`).join(' ')}" fill="#fbfcfd" stroke="#222" stroke-width="2"/>`);
  }

  const interval = p.settings.contourInterval;
  for (const c of cont) {
    const master = Math.abs(Math.round(c.level / interval) % 5) === 0;
    for (const line of c.lines) {
      if (line.length < 2) continue;
      o.push(`<polyline points="${line.map(q => `${X(q.x)},${Y(q.y)}`).join(' ')}" fill="none" stroke="${master ? '#8a6d3b' : '#c3a97a'}" stroke-width="${master ? 1.5 : 0.8}"/>`);
    }
    if (master) {
      const line = c.lines.find(l => l.length > 10);
      if (line) {
        const m = line[Math.floor(line.length / 2)];
        o.push(`<text x="${X(m.x)}" y="${Y(m.y)}" font-size="10" fill="#8a6d3b" text-anchor="middle">${nf(c.level, 2)}</text>`);
      }
    }
  }

  for (const t of p.trees) {
    o.push(`<circle cx="${X(t.x)}" cy="${Y(t.y)}" r="${nf((t.canopy || 3) / 2 * S, 1)}" fill="#4aa86822" stroke="#4aa868" stroke-dasharray="4 3"/>`);
    o.push(`<circle cx="${X(t.x)}" cy="${Y(t.y)}" r="3" fill="#2f7d4a"/>`);
    o.push(`<text x="${X(t.x)}" y="${nf(+Y(t.y) + 14, 1)}" font-size="9" fill="#2f7d4a" text-anchor="middle">${esc(t.species)}</text>`);
  }

  for (const q of p.points) {
    o.push(`<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="2.6" fill="#1f6feb"/>`);
    o.push(`<text x="${X(q.x)}" y="${nf(+Y(q.y) - 6, 1)}" font-size="8.5" fill="#1f3d63" text-anchor="middle">${nf(q.z, 3)}</text>`);
  }

  for (const ph of p.photos) {
    const dir = ph.bearing * Math.PI / 180, half = (ph.fov || 70) / 2 * Math.PI / 180;
    const a1 = { x: ph.x + Math.sin(dir - half) * ph.range, y: ph.y + Math.cos(dir - half) * ph.range };
    const a2 = { x: ph.x + Math.sin(dir + half) * ph.range, y: ph.y + Math.cos(dir + half) * ph.range };
    o.push(`<polygon points="${X(ph.x)},${Y(ph.y)} ${X(a1.x)},${Y(a1.y)} ${X(a2.x)},${Y(a2.y)}" fill="#c792ea22" stroke="#8e5fb0" stroke-width="0.7"/>`);
    o.push(`<circle cx="${X(ph.x)}" cy="${Y(ph.y)}" r="3.2" fill="#8e5fb0"/>`);
  }

  // cajetín
  const by = nf(H * S + 12, 0);
  o.push(`<g font-size="12" fill="#222">
<text x="10" y="${by}" font-weight="700">${esc(p.name)} — levantamiento ${esc(p.visitDate)}</text>
<text x="10" y="${nf(+by + 18, 0)}" font-size="10.5" fill="#555">Superficie ${fmtM(st.area, 1)} m² · desnivel ${fmtM(st.drop, 2)} m · pendiente media ${fmtM(st.meanSlope, 1)} % · curvas cada ${fmtM(interval, 2)} m</text>
<text x="10" y="${nf(+by + 34, 0)}" font-size="10.5" fill="#555">${st.nPoints} cotas · ${st.nTrees} árboles · ${st.nPhotos} fotos · escala 1:${nf(100 / S * 100, 0)} a tamaño real${p.anchor ? ` · anclado en ${nf(p.anchor.lat, 6)}, ${nf(p.anchor.lon, 6)}` : ''}</text>
<text x="10" y="${nf(+by + 50, 0)}" font-size="10" fill="#888">${esc(p.notes || '')}</text>
</g>`);

  // barra de escala: 5 m
  const sbx = nf(W * S - 5 * S - 16, 1), sby = nf(H * S + 26, 1);
  o.push(`<g stroke="#222" stroke-width="1.6" fill="none">
<path d="M${sbx} ${nf(+sby - 5, 1)} L${sbx} ${sby} L${nf(+sbx + 5 * S, 1)} ${sby} L${nf(+sbx + 5 * S, 1)} ${nf(+sby - 5, 1)}"/></g>
<text x="${nf(+sbx + 2.5 * S, 1)}" y="${nf(+sby - 8, 1)}" font-size="10" fill="#222" text-anchor="middle">5 m</text>`);

  o.push('</svg>');
  return o.join('\n');
}

/* ───────────────────────────── OBJ ───────────────────────────── */

export function toOBJ() {
  const { surf } = surface();
  if (surf.empty) return '# sin datos de elevación\n';
  const { nx, ny, res, x0, y0, z } = surf;
  const step = Math.max(1, Math.round(Math.max(nx, ny) / 220));

  const idx = new Int32Array(nx * ny).fill(-1);
  const v = ['# Navata — malla del terreno (metros)', `# ${P.cur.name} · ${P.cur.visitDate}`];
  let n = 0;
  for (let j = 0; j < ny; j += step) {
    for (let i = 0; i < nx; i += step) {
      const k = j * nx + i;
      if (Number.isNaN(z[k])) continue;
      v.push(`v ${nf(x0 + i * res)} ${nf(z[k])} ${nf(-(y0 + j * res))}`);  // Y arriba, Z hacia el sur
      idx[k] = ++n;
    }
  }
  const f = [];
  for (let j = 0; j + step < ny; j += step) {
    for (let i = 0; i + step < nx; i += step) {
      const a = idx[j * nx + i], b = idx[j * nx + i + step];
      const c = idx[(j + step) * nx + i + step], d = idx[(j + step) * nx + i];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      f.push(`f ${a} ${b} ${c}`, `f ${a} ${c} ${d}`);
    }
  }
  return v.concat(f).join('\n') + '\n';
}

/* ───────────────────────────── ZIP ───────────────────────────── */

export async function toBundle() {
  const p = P.cur;
  const files = [];
  const enc = new TextEncoder();
  const add = (name, str) => files.push({ name, data: enc.encode(str) });

  add('proyecto.json', toJSON());
  add('cotas.csv', toCSV());
  add('arboles.csv', treesCSV());
  add('parcela.geojson', toGeoJSON());
  add('parcela.kml', toKML());
  add('curvas.dxf', toDXF());
  add('plano.svg', toSVG());
  add('terreno.obj', toOBJ());
  add('LEEME.txt', readme());

  for (const ph of p.photos) {
    const b = await blobs.get(ph.key).catch(() => null);
    if (!b) continue;
    files.push({ name: `fotos/${ph.id}.jpg`, data: new Uint8Array(await b.arrayBuffer()) });
  }
  return zipSync(files);
}

function readme() {
  const p = P.cur, st = stats();
  return `${p.name} — levantamiento topográfico
Fecha de visita: ${p.visitDate}
Generado: ${new Date().toISOString()}

RESUMEN
  Superficie ............ ${fmtM(st.area, 1)} m²
  Perímetro ............. ${fmtM(st.perim, 1)} m
  Cotas medidas ......... ${st.nPoints}
  Desnivel total ........ ${fmtM(st.drop, 3)} m  (de ${fmtM(st.zmin, 3)} a ${fmtM(st.zmax, 3)})
  Pendiente media ....... ${fmtM(st.meanSlope, 1)} %
  Árboles ............... ${st.nTrees}
  Fotos ................. ${st.nPhotos}
  Anclaje geográfico .... ${p.anchor ? `${p.anchor.lat.toFixed(6)}, ${p.anchor.lon.toFixed(6)} (eje +Y a ${p.anchor.rot}° N)` : 'sin anclar (coordenadas locales)'}
  Borde ................. ${p.boundaryAssumed ? `PROVISIONAL — ${p.boundaryAssumed}` : 'medido'}
  Notas ................. ${p.notes || '—'}

CONTENIDO
  proyecto.json   Proyecto completo. Se vuelve a cargar en la app desde Datos ▸ Importar.
  cotas.csv       Cotas medidas: etiqueta, X, Y, Z${p.anchor ? ', lat, lon' : ''}.
  arboles.csv     Inventario de árboles.
  parcela.geojson Borde, curvas de nivel, cotas, árboles y fotos. QGIS, Leaflet, Mapbox.
  parcela.kml     Igual, para Google Earth.
  curvas.dxf      Curvas de nivel en 3D + borde + árboles. AutoCAD, LibreCAD, QCAD.
  terreno.obj     Malla 3D del terreno. Blender, SketchUp, MeshLab.
  plano.svg       Plano vectorial listo para imprimir o editar en Inkscape.
  fotos/          Fotografías; la posición y el rumbo de cada una están en el GeoJSON.

SISTEMA DE COORDENADAS
  X e Y en metros sobre el plano local de la parcela; origen en (0,0).
  Z en metros relativos al punto de referencia (datum), que vale 0,000.
  Rumbos de foto: 0° = eje +Y local, sentido horario.${p.anchor ? `
  El eje +Y apunta a ${p.anchor.rot}° respecto al norte geográfico.` : ''}
`;
}
