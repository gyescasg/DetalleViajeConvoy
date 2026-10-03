# Formato del archivo de origen

La aplicación lee el reporte **«Detallado (varios vehículos)»** exportado a Excel (`.xlsx`) desde la plataforma GPS,
sin modificar. Se usa la primera hoja del libro.

Los valores de este documento son ficticios.

## Estructura de la hoja

| Fila | Contenido |
|---|---|
| 1 | Títulos de la cabecera del reporte |
| 2 | Valores de la cabecera del reporte |
| 3 | Vacía |
| 4 | Nombres de las columnas de datos |
| 5 en adelante | Una posición GPS por fila |

La aplicación no depende del número de fila: busca la fila que contiene las columnas `Matricula` y `Latitud`
y toma como datos todo lo que sigue.

## Cabecera del reporte

| Columna | Título | Ejemplo | Uso |
|---|---|---|---|
| A | Reportar nombre | Detallado (varios vehiculos) | Informativo |
| B | Entre | 15/01/2026 00:00:00 | Inicio del periodo, se muestra en pantalla y en el PDF |
| C | Y | 15/01/2026 23:59:59 | Fin del periodo |
| D | Creada | 16/01/2026 08:00:00 | Informativo |
| E | Para | EMPRESA DEMO | Informativo |
| F | Creado por | EMPRESA DEMO | No se usa |

Si la cabecera falta, el análisis funciona igual y el periodo se muestra como no indicado.

## Columnas de datos

| Columna | Nombre | Obligatoria | Tipo | Ejemplo | Uso |
|---|---|---|---|---|---|
| A | Matricula | Sí | Texto | DEM-101 | Identifica al vehículo. Cada valor distinto es un vehículo |
| B | Alias | No | Texto | | No se usa |
| C | Conductor | No | Texto | | No se usa |
| D | Groupo | No | Texto | FLOTA DEMO | No se usa |
| E | Fecha | Sí | Fecha de Excel o texto `dd/mm/aaaa` | 15/01/2026 | Día de la posición |
| F | Hora | Sí | Hora de Excel o texto `hh:mm:ss` | 07:40:15 | Hora de la posición |
| G | Evento | No | Texto | Posicion Automatica | Los valores distintos de «Posicion Automatica» se listan como eventos |
| H | Odom. | No | Número (km) | 120543,7 | Recorrido por odómetro, como referencia |
| I | Vel. | Sí | Número (km/h) | 68 | Velocidad instantánea |
| J | Vel.Cer | No | Número | | No se usa |
| K | Latitud | Sí | Número (grados decimales) | -11,612345 | Posición |
| L | Longitud | Sí | Número (grados decimales) | -77,215432 | Posición |
| M | Nro. Sat | No | Número | 20 | No se usa |
| N | Ref 1. | No | Texto | KM 85 CARRETERA NORTE | Referencia del lugar, se muestra en las tablas |
| O | Ref 2. | No | Texto | | No se usa |
| P | Ref 3. | No | Texto | ZONA NORTE | Se usa como referencia si falta Ref 1. |
| Q | Cercos | No | Texto | | No se usa |
| R | Mapa | No | Enlace | Mapa | No se usa |

Las columnas se reconocen por su nombre, sin distinguir mayúsculas, tildes ni puntos. El orden puede variar.

## Reglas de lectura

- **Fecha y hora.** Se interpretan como hora de reloj del reporte, sin convertir zonas horarias.
- **Filas omitidas.** Se descartan las filas sin matrícula, sin fecha u hora válidas, sin posición o con posición `0, 0`
  (GPS sin fijar). La aplicación avisa cuántas omitió.
- **Orden.** Las posiciones de cada vehículo se ordenan por fecha y hora; no hace falta que el archivo venga ordenado.
- **Decimales.** Se aceptan números con punto o con coma decimal.
- **Texto.** Si las tildes y eñes vienen mal codificadas, se corrigen al leer.

## Errores que puede mostrar la pantalla de carga

| Mensaje | Causa |
|---|---|
| No se pudo abrir el archivo | No es un Excel, está dañado o tiene contraseña |
| No se encontró la fila de cabeceras | El archivo es otro tipo de reporte |
| Faltan columnas obligatorias | El reporte se exportó sin alguna de las columnas marcadas como obligatorias |
| El reporte no contiene posiciones GPS válidas | Todas las filas se descartaron por las reglas de lectura |
