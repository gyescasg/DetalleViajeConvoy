# Reporte GPS

Aplicación web que analiza el reporte de posiciones de una plataforma GPS y responde dos preguntas sobre un viaje:
si las unidades hicieron el mismo recorrido y qué distancia mantuvieron entre sí.

Todo se procesa en el navegador. El archivo no se envía a ningún servidor ni se guarda en una base de datos.
La única excepción es opcional: la consulta de altitud, que envía coordenadas del recorrido a un servicio externo
solo si se pulsa su botón.

## Qué hace

- Lee el Excel del reporte y detecta cuántos vehículos contiene.
- Muestra una tabla resumen por vehículo: recorrido, tiempo en movimiento y detenido, velocidades y excesos.
- Dibuja el recorrido de cada unidad en un mapa y marca los puntos de mayor separación.
- Grafica la separación entre dos unidades minuto a minuto y la clasifica según umbrales de convoy.
- Redacta los hallazgos principales en lenguaje llano, al inicio de la pantalla y del PDF.
- Analiza los excesos de velocidad: cuánto duró cada uno, cuándo y dónde ocurrió, y si la otra unidad también iba en exceso.
- Identifica las paradas prolongadas en ruta: dónde, cuándo, cuánto duraron y si las unidades pararon juntas.
- Opcionalmente consulta la altitud del recorrido para saber si un exceso ocurrió en bajada.
- Lista los eventos que registró el equipo GPS y los ubica en el mapa y en la línea de tiempo.
- Exporta el análisis a un PDF, con nombre y logo de la empresa si se cargan.

## Requisitos

- Node.js 20 o superior.
- Un navegador actual (Chrome, Edge o Firefox).
- Conexión a internet para el mapa base y las tipografías. Sin conexión la aplicación funciona igual,
  pero el mapa muestra los recorridos sobre un fondo liso.

## Cómo ejecutarlo

```bash
npm install
npm run dev
```

Abre la dirección que indica la consola (por defecto `http://localhost:5173`).

Para generar el sitio estático, listo para publicar en cualquier alojamiento de archivos:

```bash
npm run build
```

El resultado queda en `dist/`.

## Cómo usarlo

1. Exporta desde la plataforma GPS el reporte «Detallado (varios vehículos)» a Excel.
2. Arrastra el archivo a la pantalla de carga, o usa «Probar con datos de ejemplo».
   Con «Descargar plantilla de Excel» obtienes un archivo ficticio con el formato exacto que la aplicación espera.
3. Revisa los umbrales del panel izquierdo y cámbialos si tu operación usa otros.
4. Si quieres que el PDF lleve marca, escribe el nombre de la empresa y elige el logo.
5. Pulsa «Exportar PDF».

Cuando el reporte tiene más de dos vehículos, el panel permite elegir qué par comparar.

## Archivo de origen

La aplicación lee un único formato: el reporte «Detallado (varios vehículos)», tal como lo exporta la plataforma, sin modificar.
Las columnas, sus tipos y cuáles son obligatorias están documentadas en [docs/formato-excel.md](docs/formato-excel.md).

Si el archivo no tiene ese formato, la pantalla de carga indica qué columna falta.

## Umbrales

Vienen precargados con valores sugeridos y se pueden cambiar antes de exportar:

| Umbral | Valor sugerido | Qué significa |
|---|---|---|
| Banda de convoy, mínimo | 100 m | Por debajo, las unidades van demasiado cerca para frenar con margen |
| Banda de convoy, máximo | 300 m | Hasta aquí se mantiene el contacto visual |
| Alerta | 500 m | El convoy empezó a abrirse |
| Crítico | 1 km | Las unidades ya no viajan como convoy |
| Límite de velocidad | 80 km/h | Los registros por encima cuentan como exceso |
| Exceso breve, hasta | 60 s | Un exceso más corto es compatible con un adelantamiento |
| Exceso prolongado, desde | 180 s | Un exceso así de largo ya no es una maniobra puntual |
| Parada prolongada, desde | 10 min | Las detenciones más cortas (peajes, semáforos, tráfico) no se listan |

Son una sugerencia general para camiones cargados en carretera, no una norma. Cada operación debe ajustarlos
a su política, a su carga y a la reglamentación de tránsito que le aplique.

## Cómo se calcula

- **Recorrido:** suma de las distancias entre posiciones GPS consecutivas de cada unidad.
- **Separación:** distancia en línea recta entre las dos unidades, calculada cada minuto. Como los equipos no reportan
  en el mismo instante, la posición de cada unidad en ese minuto se estima interpolando entre sus dos posiciones más cercanas.
- **Estado del convoy:** cada minuto se clasifica según los umbrales. Los porcentajes se calculan sobre el tiempo
  en que al menos una unidad está en movimiento; cuando ambas están detenidas la separación no dice nada sobre el convoy.
- **Mismo recorrido:** se mide la distancia de cada posición de una unidad a la traza de la otra. Si el 95% queda
  a menos de 500 m, se considera que siguieron la misma ruta.
- **Puntos de mayor separación:** máximos locales de la separación que superan la distancia de alerta,
  hasta diez por análisis.

## Paradas en ruta

Una parada es un tramo de registros con la unidad detenida (5 km/h o menos) entre su primer y su último movimiento
del periodo. El tiempo estacionado antes de salir y después de llegar no cuenta como parada.

- Solo se listan las paradas que alcanzan la duración mínima configurada.
- Dos detenciones en el mismo lugar separadas por una maniobra de menos de tres minutos se cuentan como una sola.
- Con dos unidades, las paradas simultáneas a menos de 500 m comparten número de lugar: pararon juntas.
  Para cada parada se indica si la otra unidad estaba detenida en el mismo lugar, en otro lugar o en movimiento.
- El reporte indica dónde y cuánto se detuvo cada unidad. No indica el motivo.
- El inicio y el fin de una parada pueden desviarse hasta un intervalo de reporte, que suele ser más largo
  cuando la unidad está detenida.

## Excesos de velocidad

Un exceso es una serie de registros consecutivos por encima del límite. Su duración es el tiempo entre el primer
y el último de esos registros. Se clasifican así:

| Tipo | Criterio | Lectura |
|---|---|---|
| Puntual | Un solo registro | Duración desconocida: pudo durar segundos o casi dos intervalos de reporte |
| Breve | Menos de 60 s | Compatible con un adelantamiento |
| Sostenido | De 60 a 180 s | Más largo que una maniobra habitual |
| Prolongado | 180 s o más | Ritmo de marcha sobre el límite |

La clasificación es una inferencia por duración. El reporte GPS no registra el motivo de un exceso, así que la
aplicación nunca afirma que hubo un adelantamiento: indica si la duración es compatible con uno.

Cuando se comparan dos unidades, cada exceso indica además si la otra unidad también iba sobre el límite
en ese momento (con un margen de dos minutos). Si las dos corren a la vez, el patrón apunta al ritmo del convoy
y no a una maniobra aislada.

### Altitud y pendiente

El reporte GPS no trae altitud. El botón «Consultar altitud» la pide a [Open-Meteo](https://open-meteo.com),
un servicio externo y gratuito, y con ella calcula la pendiente media de cada exceso.

- **Son las únicas coordenadas exactas que salen del equipo**, y solo al pulsar el botón: se envían coordenadas del recorrido
  (hasta 180 puntos por unidad, redondeadas a cuatro decimales). No se envían placas, horas ni velocidades.
- Se considera bajada o subida una pendiente media de 1% o más. El umbral es bajo porque un camión cargado
  gana velocidad en bajadas largas aunque sean suaves.
- La pendiente es el promedio de todo el exceso. Un exceso largo puede incluir una bajada corta y figurar como plano.
- El modelo de terreno tiene una resolución de unos 90 m y las muestras se toman cada pocos kilómetros:
  sirve para pendientes de carretera, no para rampas cortas.
- El servicio limita las consultas por minuto. Si responde que hay demasiadas, espera un minuto y vuelve a intentarlo.

## Limitaciones conocidas

Conviene tenerlas presentes antes de sacar conclusiones del reporte.

- **Precisión de la separación.** Un equipo GPS reporta una posición cada varias decenas de segundos. A velocidad de
  carretera, eso deja un margen de error de cientos de metros en la separación. El análisis sirve para detectar que el
  convoy se abrió; no sirve para auditar si las unidades iban a 80 o a 150 m.
- **Distancia en línea recta.** La separación no sigue la carretera. En tramos con curvas cerradas es menor que la
  distancia real por la vía.
- **Huecos de señal.** Si una unidad pasa más de 15 minutos sin reportar, ese tramo se marca como «Sin dato» en lugar
  de inventar posiciones. Los equipos suelen reportar con menos frecuencia cuando el vehículo está detenido.
- **Odómetro.** Algunos equipos no reportan el odómetro o lo dejan fijo. En ese caso la tabla muestra «Odómetro sin dato»
  y el recorrido se toma del GPS.
- **Texto mal codificado.** Algunas plataformas exportan tildes y eñes como símbolos extraños. La aplicación los corrige
  al leer; si el texto de origen está dañado de otra forma, se muestra tal cual.
- **Duración de los excesos.** Con un registro cada varias decenas de segundos, la duración real de un exceso puede
  ser hasta un intervalo de reporte más larga por cada extremo. Un exceso de un solo registro no tiene duración conocida.
- **Mapa base.** Depende de un servicio externo y gratuito (OpenFreeMap, con datos de OpenStreetMap). Si no responde,
  el mapa muestra los recorridos sobre un fondo liso.
- **Mapa en el PDF.** El mapa se copia al PDF como imagen. Si el navegador no permite la copia, el PDF se genera igual
  y la aplicación avisa qué elemento no se pudo incluir.
- **Lectura de Excel.** Se usa SheetJS instalado desde su sitio oficial, porque la versión del registro de npm quedó
  desactualizada y tiene vulnerabilidades conocidas. No cambies esa dependencia por `npm install xlsx`.
- **Archivos grandes.** Está pensada para reportes de uno o pocos días. Con decenas de miles de posiciones el análisis
  sigue funcionando, pero tarda más.

## Datos y privacidad

El archivo de Excel nunca sale del equipo. Sí hay tres conexiones a servicios externos, y cada una revela algo:

| Servicio | Para qué | Qué recibe |
|---|---|---|
| Google Fonts | Tipografías de la interfaz | La dirección IP |
| OpenFreeMap | Mapa base | La dirección IP y la zona aproximada que muestra el mapa, que es la del recorrido |
| Open-Meteo | Altitud, solo al pulsar el botón | La dirección IP y coordenadas del recorrido |

Ninguno recibe placas, horas, velocidades ni el nombre de la empresa.

La aplicación muestra como HTML algunos textos del Excel, y los escapa antes de hacerlo. Aun así, conviene cargar
solo archivos exportados por tu propia plataforma GPS.

Los reportes reales contienen placas y rutas. El archivo `.gitignore` excluye del control de versiones los Excel,
otros formatos de datos, los PDF exportados y las capturas,
salvo el ejemplo ficticio de `public/ejemplo/`.

El ejemplo se genera con:

```bash
npm run ejemplo
```

Sus placas, su empresa y sus tiempos son inventados, y el trazo une puntos de paso aproximados con líneas rectas.

## Estructura

```
src/lib/         Lectura del Excel y cálculos (sin interfaz)
src/components/  Pantallas, mapa y gráficos
src/report/      Generación del PDF
scripts/         Generador del archivo de ejemplo
docs/            Formato del archivo de origen
```

## Licencia

[MIT](LICENSE).

## Tecnología

Vite, React y TypeScript. SheetJS para leer el Excel, MapLibre para el mapa, ECharts para los gráficos y jsPDF para el reporte.
