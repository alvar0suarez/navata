# Navata

Aplicación web para levantar el **mapa topográfico de una parcela** con material de
ferretería, y guardar el resultado como un repositorio de información reutilizable.

Está pensada para usarse **en el campo, desde el móvil y sin cobertura**: se instala como
app (PWA), todo se guarda en el propio dispositivo y al terminar se exporta a los formatos
que entienden Google Earth, QGIS, AutoCAD, SketchUp o Blender.

👉 **[Abrir la aplicación](https://alvar0suarez.github.io/navata/)**
> ⚠️ Para que esa dirección funcione hay que activar Pages una vez a mano:
> **Settings → Pages → Source: _GitHub Actions_**. El flujo de despliegue no puede
> hacerlo solo: el `GITHUB_TOKEN` de Actions no tiene permiso para crear el sitio
> (`Resource not accessible by integration`). A partir de ahí cada push despliega solo.
>
> Mientras tanto, la app se puede usar en local con `npm run serve`.

---

## Qué hace

| | |
|---|---|
| **Curvas de nivel** | Interpola las cotas medidas con un *spline de placa delgada* y dibuja las curvas al intervalo que elijas (10 cm por defecto), con curvas maestras acotadas cada 5. |
| **Relieve** | Mapa hipsométrico en color, sombreado analítico y mapa de pendientes en %. |
| **Perfiles** | Traza una línea sobre el plano y obtén la sección con desnivel y pendiente. |
| **Malla de estaciones** | Genera el recorrido de medición en serpiente y te va marcando la siguiente estación pendiente. |
| **Medición rápida** | Pantalla completa con teclado grande: tecleas la lectura de la mira, la app calcula la cota, la asigna a la estación y salta a la siguiente. Mantiene la pantalla encendida. |
| **Árboles** | Posición, especie, diámetro de tronco y copa, altura y estado. |
| **Fotos orientadas** | Cada foto guarda desde dónde y hacia dónde se tomó; se dibujan como conos sobre el plano. |
| **Cobertura fotográfica** | Porcentaje de la parcela que ha entrado en el encuadre de alguna foto, y sugerencia de dónde colocarse para cubrir lo que falta. |
| **Vista 3D** | Modelo del terreno con exageración vertical regulable, árboles y conos de cámara. |
| **Anclaje geográfico** | Ata el origen local a coordenadas reales para exportar con georreferencia. |

## Cómo se mide

📄 **[Lista de la compra y procedimiento paso a paso](https://alvar0suarez.github.io/navata/procedimiento.html)**
— página aparte e imprimible: qué comprar, cuánto cuesta y cómo medir las 45 cotas sin ayuda.

La guía resumida está también **dentro de la app**, en la pestaña *Guía*:

- **Nivel de manguera** (una manguera transparente de 25 m llena de agua, ~12 €): precisión
  de ±5–10 mm, muy por debajo del objetivo de ±5 cm. El agua en un tubo abierto por los dos
  extremos define un plano horizontal perfecto.
- **Malla de 4 × 4 m** para la primera visita: unas 60 estaciones en una parcela de 16 × 44 m,
  entre hora y media y dos horas. Una malla de 1 × 1 m serían 704 puntos y dos días de trabajo,
  con una precisión que no se aprovecha.
- **Puntos de quiebre**: esquinas, bordillo, taludes, vaguadas, base de los árboles y arquetas.
  Diez de estos valen más que cien puntos de malla.

## Sistema de coordenadas

- **X, Y** en metros sobre el plano local. El origen `(0,0)` es una esquina junto a la calle;
  X corre por el frente y Y entra hacia el fondo.
- **Z** en metros **relativos** al punto de referencia (datum), que vale `0,000`.
- **Rumbos de foto**: 0° = eje +Y local, creciendo en sentido horario. Con anclaje geográfico
  se convierten a rumbos respecto al norte.

## Copia de seguridad

Los datos viven en el teléfono. En *Datos* hay una tarjeta arriba del todo:

- **Guardar copia (.json)** — lleva el borde, la malla pendiente con la posición de cada
  estación en su tendido, todas las alturas medidas y los ajustes de medición.
- **Cargar copia** — enseña primero qué trae el fichero frente a lo que ya hay en el
  teléfono, y deja elegir entre **sustituir** o **combinar**. Combinar une dos jornadas o
  dos teléfonos sin pisar nada: ante un choque manda lo que ya estaba, y las estaciones que
  quedan medidas salen de la cola de pendientes.
- **Copias automáticas** — las últimas ocho instantáneas quedan guardadas en el propio
  teléfono, por si algo se borra sin querer. Son independientes del .json que exportes.

Las fotografías no caben en el .json; para llevárselas hay que exportar el `.zip`.

## Exportación

| Formato | Para |
|---|---|
| `.json` | Proyecto completo, se vuelve a cargar en la app |
| `.csv` | Cotas y árboles en hoja de cálculo |
| `.geojson` | QGIS, Leaflet, Mapbox |
| `.kml` | Google Earth |
| `.dxf` | AutoCAD, LibreCAD, QCAD — curvas de nivel en 3D por capas |
| `.svg` | Plano vectorial con cajetín, listo para imprimir o editar en Inkscape |
| `.obj` | Malla 3D para Blender, SketchUp o MeshLab |
| `.zip` | Todo lo anterior **más las fotografías** |

## Desarrollo

No hay compilación ni dependencias en tiempo de ejecución: son módulos ES servidos tal cual.

```bash
python3 -m http.server 8000     # y abrir http://localhost:8000
```

Comprobaciones:

```bash
npm test          # geometría: interpolación, curvas de nivel, pendientes, geodesia
npm run test:e2e  # recorrido completo en navegador (requiere Chromium y el servidor local)
```

### Estructura

```
index.html              interfaz y pestañas
sw.js                   caché para uso sin cobertura
assets/js/
  geom.js               spline de placa delgada, marching squares, pendiente, sombreado, geodesia
  state.js              modelo de datos y superficie derivada (con caché)
  store.js              localStorage (proyecto) + IndexedDB (fotos)
  render2d.js           plano: relieve, curvas, cotas, árboles, conos de foto
  render3d.js           vista 3D sobre canvas 2D (algoritmo del pintor)
  quickmode.js          pantalla de medición a una mano
  coverage.js           cobertura fotográfica y sugerencia de estación
  photos.js             captura, compresión y brújula
  exporters.js          CSV, GeoJSON, KML, DXF, SVG, OBJ, ZIP
  zip.js                escritor ZIP sin dependencias
  guide.js              metodología de campo
```

## La parcela

**15,50 m de frente a la calle × 32 m de fondo — 496 m², 95 m de perímetro.**

El proyecto arranca con ese borde ya creado, así que al abrir la app en la parcela
solo hay que generar la malla y empezar a medir. Con paso de 4 × 4 m salen
**45 estaciones**, algo más de una hora con el nivel de manguera.

Está registrado como rectángulo porque es lo que se midió. Si las esquinas no
resultan estar a escuadra, se corrigen arrastrando los vértices con la herramienta ⬡
del mapa, o se rehace el borde en *Datos* con los cuatro lados y una diagonal.

## Bitácora

- **1 de agosto de 2026** — construcción de la aplicación.
- **2 de agosto de 2026** — primera visita a la parcela y toma de datos.
