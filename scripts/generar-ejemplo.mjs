// Genera public/ejemplo/reporte-ejemplo.xlsx con datos FICTICIOS, en el mismo formato
// que el reporte "Detallado (varios vehiculos)" de la plataforma GPS.
// Las placas, la empresa y los tiempos son inventados; el trazo une puntos de paso
// aproximados con líneas rectas, por lo que no sigue la carretera con exactitud.
import { mkdirSync, writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

const OUT_DIR = 'public/ejemplo'
const OUT_FILE = `${OUT_DIR}/reporte-ejemplo.xlsx`
const DAY = '15/01/2026'
const DAY_SERIAL = 46037

// Puntos de paso [lat, lon, referencia] de una ruta costera ficticia de unos 190 km.
const WAYPOINTS = [
  [-8.11, -79.03, 'PATIO DE SALIDA'],
  [-7.84, -79.15, 'KM 30 CARRETERA NORTE'],
  [-7.73, -79.3, 'KM 45 CARRETERA NORTE'],
  [-7.55, -79.42, 'PEAJE NORTE'],
  [-7.43, -79.5, 'KM 85 CARRETERA NORTE'],
  [-7.25, -79.47, 'KM 115 CARRETERA NORTE'],
  [-7.0, -79.62, 'KM 148 CARRETERA NORTE'],
  [-6.87, -79.8, 'KM 170 CARRETERA NORTE'],
  [-6.77, -79.84, 'ALMACEN DE DESTINO'],
]

const RAD = Math.PI / 180
const km = (a, b) => {
  const x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD)
  const y = (b[0] - a[0]) * RAD
  return Math.hypot(x, y) * 6371
}

const cumulative = [0]
for (let i = 1; i < WAYPOINTS.length; i++) cumulative.push(cumulative[i - 1] + km(WAYPOINTS[i - 1], WAYPOINTS[i]))
const TOTAL_KM = cumulative[cumulative.length - 1]

function positionAt(distanceKm) {
  const d = Math.max(0, Math.min(TOTAL_KM, distanceKm))
  let i = 1
  while (i < cumulative.length - 1 && cumulative[i] < d) i++
  const w = (d - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1])
  const a = WAYPOINTS[i - 1]
  const b = WAYPOINTS[i]
  return { lat: a[0] + (b[0] - a[0]) * w, lon: a[1] + (b[1] - a[1]) * w, ref: (w < 0.5 ? a : b)[2] }
}

// Generador determinista: el archivo sale idéntico en cada ejecución.
let seed = 20260115
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

const START = 6 * 3600 // segundos desde medianoche: el reporte arranca a las 06:00
const END = 13 * 3600
const DEPARTURE = 6.5 * 3600
const STOPS = [{ at: 92, seconds: 15 * 60 }]

// Recorrido de la unidad que va adelante, segundo a segundo: distancia acumulada en km.
const lead = []
{
  let d = 0
  let stoppedUntil = DEPARTURE
  let cruise = 68
  const pending = [...STOPS]
  for (let t = START; t <= END; t++) {
    if (t % 60 === 0) cruise = 62 + random() * 12
    if (t >= stoppedUntil && d < TOTAL_KM) {
      d = Math.min(TOTAL_KM, d + cruise / 3600)
      if (pending.length > 0 && d >= pending[0].at) stoppedUntil = t + pending.shift().seconds
    }
    lead.push(d)
  }
}
const leadAt = (t) => lead[Math.max(0, Math.min(lead.length - 1, Math.round(t - START)))]

// La segunda unidad sigue a la primera con un retraso en segundos. El retraso crece en dos
// ventanas del viaje: ahí el convoy se abre y después se vuelve a cerrar.
const OPENINGS = [
  { from: 7.3 * 3600, to: 8.0 * 3600, extra: 105 },
  { from: 8.5 * 3600, to: 8.9 * 3600, extra: 50 },
]
function lagAt(t) {
  let lag = 12
  for (const o of OPENINGS) {
    if (t > o.from && t < o.to) lag += o.extra * Math.sin((Math.PI * (t - o.from)) / (o.to - o.from))
  }
  return lag
}

function report({ plate, interval, odoStart, distanceAt, events }) {
  const rows = []
  const pending = [...events]
  let t = START
  while (t <= END) {
    const d = distanceAt(t)
    const speed = Math.round((distanceAt(t) - distanceAt(t - 10)) * 360)
    const p = positionAt(d)
    // Cada evento se registra una sola vez, en la primera posición posterior a su hora.
    const event = pending.length > 0 && t >= pending[0].t ? pending.shift().name : 'Posicion Automatica'
    rows.push([
      plate, '', '', 'FLOTA DEMO', DAY_SERIAL, t / 86400, event,
      Math.round((odoStart + d) * 100) / 100, speed, '',
      Math.round((p.lat + (random() - 0.5) * 0.0001) * 1e6) / 1e6,
      Math.round((p.lon + (random() - 0.5) * 0.0001) * 1e6) / 1e6,
      18 + Math.floor(random() * 4), p.ref, '', 'ZONA NORTE', '', 'Mapa',
    ])
    // Detenida, la unidad reporta con menos frecuencia.
    t += speed > 0 ? interval : interval * 5
  }
  return rows
}

const rows = [
  ['Reportar nombre', 'Entre', 'Y', 'Creada', 'Para', 'Creado por'],
  ['Detallado (varios vehiculos)', `${DAY} 00:00:00`, `${DAY} 23:59:59`, '16/01/2026 08:00:00', 'EMPRESA DEMO', 'EMPRESA DEMO'],
  [],
  ['Matricula', 'Alias', 'Conductor', 'Groupo', 'Fecha', 'Hora', 'Evento', 'Odom.', 'Vel.', 'Vel.Cer', 'Latitud', 'Longitud', 'Nro. Sat', 'Ref 1.', 'Ref 2.', 'Ref 3.', 'Cercos', 'Mapa'],
  ...report({ plate: 'DEM-101', interval: 45, odoStart: 120500, distanceAt: leadAt, events: [] }),
  ...report({
    plate: 'DEM-202', interval: 60, odoStart: 48210, distanceAt: (t) => leadAt(t - lagAt(t)),
    events: [{ t: DEPARTURE, name: 'Ignicion Encendido' }, { t: 12.5 * 3600, name: 'Ignicion Apagado' }],
  }),
]

const sheet = XLSX.utils.aoa_to_sheet(rows)

// Fecha (columna E) y hora (columna F) se guardan como números de Excel, igual que en el reporte real,
// y se muestran con formato dd/mm/aaaa y hh:mm:ss.
const FIRST_DATA_ROW = 4
for (let r = FIRST_DATA_ROW; r < rows.length; r++) {
  const date = sheet[XLSX.utils.encode_cell({ r, c: 4 })]
  const time = sheet[XLSX.utils.encode_cell({ r, c: 5 })]
  if (date) date.z = 'dd/mm/yyyy'
  if (time) time.z = 'hh:mm:ss'
}
const book = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book, sheet, 'Detallado -varios vehiculos-')
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
console.log(`Ejemplo generado: ${OUT_FILE} (${rows.length - 4} posiciones, ${TOTAL_KM.toFixed(0)} km de ruta)`)
