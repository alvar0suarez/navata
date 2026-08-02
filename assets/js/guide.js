// guide.js — metodología de campo. Se muestra dentro de la app (y funciona sin conexión).

export const GUIDE_HTML = `
<div class="card">
  <h2 style="margin-top:0">Cómo levantar la parcela en una mañana</h2>
  <p class="hint">Objetivo: curvas de nivel con error de ±5 cm, sin instrumental caro. Material total: menos de 30 €.</p>
</div>

<h2>1. Material</h2>
<table>
  <tr><th>Elemento</th><th>Para qué</th><th>Coste</th></tr>
  <tr><td>Manguera transparente Ø8–10 mm, 25–30 m</td><td>Nivel de agua: el instrumento principal</td><td>10–15 €</td></tr>
  <tr><td>Listón de 2 m marcado en cm (o flexómetro pegado a un palo)</td><td>Mira de lectura</td><td>3–5 €</td></tr>
  <tr><td>Cinta métrica de 30–50 m</td><td>Medir X e Y</td><td>8–12 €</td></tr>
  <tr><td>Cuerda de 50 m + 6 estacas</td><td>Alinear filas de la malla</td><td>5 €</td></tr>
  <tr><td>Rotulador, cinta de pintor, botella de agua</td><td>Marcar y llenar</td><td>2 €</td></tr>
</table>
<div class="callout">
  <strong>Truco de las marcas.</strong> Marca la cuerda cada metro con cinta de colores antes de salir de casa
  (un color distinto cada 5 m). En campo, tender la cuerda ya te da todas las estaciones de una fila sin
  volver a medir con la cinta. Ahorra la mitad del tiempo.
</div>

<h2>2. Montar el sistema de coordenadas</h2>
<ol>
  <li>Elige una <strong>esquina de la parcela junto a la calle</strong> como origen <code>(0,0)</code>. Clava una estaca; será tu referencia para siempre.</li>
  <li>El eje <strong>X</strong> corre a lo largo del frente de la calle. El eje <strong>Y</strong> entra hacia el fondo de la parcela.</li>
  <li>Tiende la cinta larga por el frente y anota el ancho real. Repite por el lateral para el fondo. Introduce ambos en <em>Datos ▸ Crear borde rectangular</em>.</li>
  <li>Si la parcela no es rectangular, usa <em>Datos ▸ Parcela irregular por trilateración</em>.</li>
</ol>
<div class="callout warn">
  <strong>Los cuatro lados no bastan.</strong> A diferencia de un triángulo, un cuadrilátero con los
  cuatro lados fijos sigue siendo articulado: se deforma como una tijera de pantógrafo. Con
  16 · 44 · 16 · 44 tanto vale un rectángulo como un rombo aplastado. Mide también <strong>una
  diagonal</strong>, que lo parte en dos triángulos —y un triángulo sí queda determinado por sus tres
  lados—. Si mides <strong>las dos diagonales</strong>, la app usa la segunda para comprobar el cierre
  y te avisa si alguna cinta se fue.
</div>
<div class="callout">
  <strong>Cómo medir una diagonal larga sin ayuda.</strong> Clava la punta de la cinta en la esquina
  con un destornillador o una estaca y tira desde la opuesta. Si la cinta no llega, mide en dos
  tramos con un jalón intermedio <em>alineado a ojo</em> entre las dos esquinas: mirando desde una
  esquina, el jalón debe tapar exactamente a la otra.
</div>
<div class="callout warn">
  <strong>Escuadra sin escuadra.</strong> Para comprobar que X e Y son perpendiculares usa el 3-4-5:
  marca 3 m sobre un eje, 4 m sobre el otro; la diagonal entre ambas marcas debe medir exactamente 5 m.
  Si mide más, el ángulo se ha abierto; si mide menos, se ha cerrado.
</div>

<h2>3. El nivel de manguera, paso a paso</h2>
<p>Es el método más preciso por euro invertido. El agua en un tubo abierto por los dos extremos siempre se
queda al mismo nivel: eso es un plano horizontal perfecto, sin electrónica y sin errores de calibración.</p>
<ol>
  <li><strong>Llena la manguera</strong> desde un grifo, con los dos extremos hacia arriba. Golpéala mientras se llena para expulsar burbujas: <em>una burbuja es un error de varios centímetros</em>.</li>
  <li><strong>Fija el extremo A</strong> a la estaca de referencia, atado a un palo vertical. Marca en el palo la altura donde se queda el agua: esa es tu <strong>lectura de referencia L<sub>ref</sub></strong>. Anótala (por ejemplo 100,0 cm).</li>
  <li><strong>Lleva el extremo B</strong> al punto que quieres medir, sujeto al listón apoyado en el suelo. Espera 3–4 segundos a que el agua se estabilice y lee <strong>L<sub>punto</sub></strong>.</li>
  <li><strong>La cota es</strong> <code>Z = L<sub>ref</sub> − L<sub>punto</sub></code>. Si el agua sube en el listón, el punto está más bajo; si baja, más alto. La calculadora de la pestaña <em>Cotas</em> hace esta resta por ti.</li>
</ol>
<div class="callout">
  <strong>Alcance.</strong> Con 25 m de manguera cubres una parcela de 16 × 44 m desde dos posiciones del
  extremo A. Cuando muevas el extremo A, mide antes la cota del punto nuevo desde el viejo: ese punto se
  convierte en tu nuevo cero y arrastras la diferencia. Anótalo como cota de tipo <em>Referencia</em>.
</div>

<h3>Precisión que puedes esperar</h3>
<table>
  <tr><th>Método</th><th>Error típico</th><th>Ritmo</th></tr>
  <tr><td>Manguera de agua</td><td>±5–10 mm</td><td>1–2 min/punto</td></tr>
  <tr><td>Cuerda tensa + nivel de burbuja colgante</td><td>±2–3 cm en 10 m</td><td>1 min/punto</td></tr>
  <tr><td>Listón de 2 m + nivel, encadenado</td><td>±1 cm por tramo, <em>acumulativo</em></td><td>lento</td></tr>
  <tr><td>Nivel láser rotativo (alquiler ~20 €/día)</td><td>±3 mm</td><td>20 s/punto</td></tr>
  <tr><td>GPS de móvil (altitud)</td><td>±3–10 <strong>m</strong></td><td>inservible para esto</td></tr>
</table>
<p class="hint">Con el objetivo de ±5 cm, la manguera va sobrada. El GPS del móvil sirve para situar la parcela
en el mundo, nunca para las alturas.</p>

<h2>4. Cuántos puntos medir</h2>
<p>La tentación es hacer una malla de 1 × 1 m. En 16 × 44 m eso son <strong>704 puntos</strong>: dos días de trabajo
y una precisión que no vas a aprovechar. Para un terreno de pendiente regular:</p>
<table>
  <tr><th>Malla</th><th>Puntos en 16×44 m</th><th>Tiempo</th><th>Recomendado para</th></tr>
  <tr><td>1 × 1 m</td><td>704</td><td>16 h</td><td>solo zonas críticas puntuales</td></tr>
  <tr><td>2 × 2 m</td><td>~200</td><td>4–5 h</td><td>si vas a mover tierra con precisión</td></tr>
  <tr><td><strong>4 × 4 m</strong></td><td><strong>~60</strong></td><td><strong>1,5–2 h</strong></td><td><strong>primera visita: esto es lo tuyo</strong></td></tr>
  <tr><td>5 × 5 m</td><td>~40</td><td>1 h</td><td>reconocimiento rápido</td></tr>
</table>
<div class="callout">
  <strong>Lo que de verdad marca la diferencia no es la densidad de la malla, sino los puntos de quiebre.</strong>
  Mide siempre, además de la malla: las cuatro esquinas, el bordillo y el eje de la calle, la parte alta y
  la baja de cualquier talud, el fondo de las vaguadas, la base de cada árbol, arquetas y pozos, y cualquier
  cambio brusco de pendiente. Márcalos como tipo <em>Quiebre</em>. Diez puntos de quiebre valen más que
  cien puntos de malla.
</div>

<h2>5. Orden de recorrido</h2>
<p>Genera la malla en <em>Cotas ▸ Generador de malla</em> con recorrido en <strong>serpiente</strong>: haces una fila
de ida y la siguiente de vuelta, sin cruzar la parcela en vacío. La app te marca en verde la siguiente
estación pendiente y la va tachando conforme mides.</p>
<p>La malla no es un simple retículo recortado: además de los nudos, cada fila incluye los
<strong>puntos donde corta el borde</strong>, y las <strong>esquinas</strong> van las primeras de la
cola (<code>E1…E4</code>). Sin eso, en una parcela con lados inclinados las franjas laterales
quedarían sin medir y sus curvas de nivel serían pura invención del interpolador.</p>
<ol>
  <li>Tiende la cuerda marcada sobre la fila <code>Y = 0</code> y mide todos sus puntos.</li>
  <li>Mueve la cuerda 4 m en Y (mide esos 4 m con la cinta en los dos extremos, no a ojo).</li>
  <li>Repite. Cada 3–4 filas, vuelve a medir un punto ya conocido para <strong>comprobar el cierre</strong>: si
      la lectura difiere más de 2 cm, hay una burbuja en la manguera o el listón no estaba vertical.</li>
</ol>

<h2>6. Modo de medición rápida</h2>
<p>Con guantes puestos y el listón en una mano, rellenar formularios es inviable. El botón
<strong>⚡ Modo medición rápida</strong> de la pestaña <em>Cotas</em> abre una pantalla completa con
teclado grande donde solo tecleas la lectura de la mira y pulsas <em>Guardar</em>: la app calcula la
cota, la asigna a la estación correcta y salta a la siguiente. Mantiene la pantalla encendida.</p>
<ul>
  <li><strong>Lectura / Cota Z</strong> — el botón de arriba a la derecha alterna entre teclear
      centímetros en la mira (la app resta) o meter la cota directamente en metros.</li>
  <li><strong>ref … · origen …</strong> — toca esa línea para fijar la lectura de referencia.
      Cuando muevas la manguera, pon en <em>origen</em> la cota del punto donde apoya ahora el
      extremo fijo y vuelve a leer la referencia: así arrastras el cero sin perderlo.</li>
  <li><strong>Quiebre</strong> marca el punto como línea de rotura; <strong>Saltar</strong> manda
      la estación al final (útil si hay un coche encima); <strong>Deshacer</strong> retira la
      última cota y devuelve su estación a la cola.</li>
</ul>

<h2>7. Fotografías orientadas</h2>
<p>Cada foto se guarda con la posición desde la que la hiciste y el rumbo hacia el que mirabas, y aparece en
el plano como un cono. El indicador de <strong>cobertura</strong> te dice qué porcentaje de la parcela ha
entrado en el encuadre de alguna foto, y el botón <em>Sugerir siguiente estación</em> calcula desde dónde y
hacia dónde disparar para ganar el mayor terreno no cubierto.</p>
<ol>
  <li>Selecciona la herramienta 📷 en el mapa y toca dónde estás.</li>
  <li>Activa <em>Usar brújula del dispositivo</em>: el rumbo se rellena solo al apuntar con el móvil.</li>
  <li>Dispara. Repite hasta que la barra de cobertura llegue al 100 %.</li>
</ol>
<div class="callout warn">
  Para que la brújula dé rumbos geográficos correctos, primero rellena el <strong>anclaje</strong> en
  <em>Datos ▸ Anclaje geográfico</em>: el rumbo del eje +Y respecto al norte. Si no lo sabes, ponte sobre el
  eje Y mirando hacia el fondo de la parcela y lee la brújula del móvil: ese número es el rumbo del eje +Y.
</div>

<h2>8. Al terminar el día</h2>
<ol>
  <li>Comprueba en <em>Datos</em> que el desnivel total y la pendiente media tienen sentido con lo que has visto.</li>
  <li>Exporta <strong>Todo + fotos (.zip)</strong>. Ese archivo es el respaldo completo.</li>
  <li>Sube el <code>proyecto.json</code> al repositorio para no perderlo y poder seguir desde otro dispositivo.</li>
</ol>
<div class="callout">
  <strong>Los datos viven en este dispositivo.</strong> La app funciona entera sin cobertura, pero si borras
  los datos del navegador se pierden. Exporta el .json antes de irte de la parcela.
</div>

<h2>9. Chuleta de campo</h2>
<table>
  <tr><th>Duda</th><th>Respuesta</th></tr>
  <tr><td>¿El agua sube en el listón?</td><td>El punto está <strong>más bajo</strong> que la referencia. Z negativa.</td></tr>
  <tr><td>¿Pendiente en %?</td><td>Desnivel ÷ distancia × 100. 44 m con 1,3 m de caída = 3,0 %.</td></tr>
  <tr><td>¿Qué es una pendiente cómoda?</td><td>&lt;2 % se pisa sin notarla · 2–6 % se nota · 6–12 % cansa · &gt;15 % exige bancales.</td></tr>
  <tr><td>¿Hacia dónde desagua?</td><td>Perpendicular a las curvas de nivel, de cota alta a cota baja. Usa la capa 📐 de pendiente.</td></tr>
  <tr><td>¿Cuánta tierra para nivelar?</td><td>Superficie × diferencia media de cota. La vista 3D te ayuda a estimarlo.</td></tr>
</table>
`;
