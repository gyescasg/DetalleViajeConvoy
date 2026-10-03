import { distToSegmentKm, haversineKm } from './geo.ts'
import type {
  ConvoyState,
  EventSummary,
  GpsPoint,
  PairAnalysis,
  Peak,
  RouteDeviation,
  Sample,
  Thresholds,
  Vehicle,
  VehicleSummary,
} from './types.ts'

/** Paso de la línea de tiempo común sobre la que se compara a las dos unidades. */
const STEP_MS = 60_000
/** Hueco máximo entre dos posiciones para interpolar; por encima se considera "sin dato". */
const MAX_GAP_MS = 15 * 60_000
/** Por debajo de esta velocidad (km/h) una unidad se considera detenida. */
const MOVING_KMH = 5
/** Desplazamientos menores con velocidad cero son ruido del GPS, no recorrido. */
const JITTER_KM = 0.02
/** Ventana, en minutos a cada lado, dentro de la cual un pico debe ser el máximo. */
const PEAK_WINDOW = 20
const MAX_PEAKS = 10
/** Tope de puntos para comparar trazas, así un reporte de varios días no bloquea el navegador. */
const DEVIATION_SAMPLE = 800
/** Desvío (percentil 95) hasta el cual se considera que ambas unidades siguieron la misma ruta. */
const SAME_ROUTE_P95_M = 500

const isAutomatic = (event: string) =>
  event === '' ||
  event
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .startsWith('posicion')

/** Posiciones con un evento que merece atención: ni posición automática ni encendido o apagado del motor. */
export function alertPoints(vehicle: Vehicle): GpsPoint[] {
  return vehicle.points.filter((p) => !isAutomatic(p.event) && !/^ignici/i.test(p.event))
}

export function summarizeVehicle(vehicle: Vehicle, speedLimitKmh: number): VehicleSummary {
  const pts = vehicle.points
  let gpsKm = 0
  let movingKm = 0
  let movingMs = 0
  let stoppedMs = 0
  let speedingMs = 0

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dt = b.t - a.t
    const km = haversineKm(a.lat, a.lon, b.lat, b.lon)
    const jitter = km < JITTER_KM && a.speed === 0 && b.speed === 0
    if (!jitter) gpsKm += km
    // Un hueco largo sin señal no se puede atribuir ni a movimiento ni a detención.
    if (dt <= 0 || dt > MAX_GAP_MS) continue
    if (!jitter && (km / dt) * 3_600_000 > MOVING_KMH) {
      movingMs += dt
      movingKm += km
    } else {
      stoppedMs += dt
    }
    if (a.speed > speedLimitKmh) speedingMs += Math.min(dt, 2 * STEP_MS)
  }

  const events = new Map<string, EventSummary>()
  for (const p of pts) {
    if (isAutomatic(p.event)) continue
    const e = events.get(p.event)
    if (e) {
      e.count++
      e.lastT = p.t
    } else {
      events.set(p.event, { type: p.event, count: 1, firstT: p.t, lastT: p.t, firstRef: p.ref })
    }
  }

  const odos = pts.map((p) => p.odo).filter((o): o is number => o !== null)
  const odoDelta = odos.length > 1 ? odos[odos.length - 1] - odos[0] : 0
  const first = pts[0]
  const last = pts[pts.length - 1]

  return {
    plate: vehicle.plate,
    points: pts.length,
    startT: first.t,
    endT: last.t,
    startRef: first.ref || first.zone,
    endRef: last.ref || last.zone,
    gpsKm,
    // Un odómetro que no avanza mientras el GPS sí lo hace no está reportando: se informa como sin dato.
    odoKm: odoDelta > 0 ? odoDelta : null,
    maxSpeed: pts.reduce((max, p) => Math.max(max, p.speed), 0),
    avgMovingSpeed: movingMs > 0 ? movingKm / (movingMs / 3_600_000) : 0,
    movingMs,
    stoppedMs,
    speedingPoints: pts.filter((p) => p.speed > speedLimitKmh).length,
    speedingMs,
    events: [...events.values()].sort((a, b) => b.count - a.count),
  }
}

interface Position {
  lat: number
  lon: number
  speed: number
  ref: string
}

/** Posición estimada en el instante t, interpolando entre las dos posiciones reales que lo rodean. */
function positionAt(pts: GpsPoint[], t: number): Position | null {
  let lo = 0
  let hi = pts.length - 1
  if (t < pts[lo].t || t > pts[hi].t) return null
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = pts[lo]
  const b = pts[hi]
  const span = b.t - a.t
  if (span > MAX_GAP_MS) return null
  const w = span === 0 ? 0 : (t - a.t) / span
  return {
    lat: a.lat + (b.lat - a.lat) * w,
    lon: a.lon + (b.lon - a.lon) * w,
    speed: a.speed + (b.speed - a.speed) * w,
    ref: (w < 0.5 ? a : b).ref,
  }
}

function classify(km: number, speedA: number, speedB: number, th: Thresholds): ConvoyState {
  // Con ambas detenidas la separación no dice nada sobre la disciplina de convoy.
  if (speedA <= MOVING_KMH && speedB <= MOVING_KMH) return 'detenidas'
  const m = km * 1000
  if (m > th.criticalM) return 'critico'
  if (m > th.alertM) return 'alerta'
  if (m > th.bandMaxM) return 'abierto'
  if (m < th.bandMinM) return 'muyCerca'
  return 'enBanda'
}

const quantile = (sorted: number[], q: number) => sorted[Math.round(q * (sorted.length - 1))]

function routeDeviation(a: GpsPoint[], b: GpsPoint[]): number[] {
  const step = Math.max(1, Math.ceil(a.length / DEVIATION_SAMPLE))
  const out: number[] = []
  for (let i = 0; i < a.length; i += step) {
    const p = a[i]
    let best = Infinity
    for (let j = 1; j < b.length; j++) {
      const d = distToSegmentKm(p.lat, p.lon, b[j - 1].lat, b[j - 1].lon, b[j].lat, b[j].lon)
      if (d < best) best = d
    }
    out.push(best * 1000)
  }
  return out
}

function compareRoutes(a: GpsPoint[], b: GpsPoint[]): RouteDeviation | null {
  if (a.length < 2 || b.length < 2) return null
  // Se mide en ambos sentidos: una unidad pudo recorrer un tramo que la otra no.
  const all = [...routeDeviation(a, b), ...routeDeviation(b, a)].sort((x, y) => x - y)
  const p95M = quantile(all, 0.95)
  return { medianM: quantile(all, 0.5), p95M, maxM: all[all.length - 1], sameRoute: p95M <= SAME_ROUTE_P95_M }
}

function findPeaks(a: GpsPoint[], b: GpsPoint[], samples: Sample[], alertM: number): Peak[] {
  const peaks: Peak[] = []
  for (let i = 0; i < samples.length; i++) {
    const km = samples[i].km
    if (km === null || km * 1000 <= alertM) continue
    let isPeak = true
    const from = Math.max(0, i - PEAK_WINDOW)
    const to = Math.min(samples.length - 1, i + PEAK_WINDOW)
    for (let j = from; j <= to && isPeak; j++) {
      const other = samples[j].km
      if (other === null || j === i) continue
      // En una meseta de valores iguales gana la primera muestra.
      if (j < i ? other >= km : other > km) isPeak = false
    }
    if (!isPeak) continue
    const pa = positionAt(a, samples[i].t)
    const pb = positionAt(b, samples[i].t)
    if (!pa || !pb) continue
    peaks.push({
      t: samples[i].t,
      km,
      latA: pa.lat,
      lonA: pa.lon,
      latB: pb.lat,
      lonB: pb.lon,
      speedA: pa.speed,
      speedB: pb.speed,
      refA: pa.ref,
      refB: pb.ref,
    })
  }
  return peaks.sort((x, y) => y.km - x.km).slice(0, MAX_PEAKS)
}

export function analyzePair(vehicleA: Vehicle, vehicleB: Vehicle, th: Thresholds): PairAnalysis {
  const a = vehicleA.points
  const b = vehicleB.points
  const start = Math.ceil(Math.max(a[0].t, b[0].t) / STEP_MS) * STEP_MS
  const end = Math.min(a[a.length - 1].t, b[b.length - 1].t)

  const samples: Sample[] = []
  for (let t = start; t <= end; t += STEP_MS) {
    const pa = positionAt(a, t)
    const pb = positionAt(b, t)
    if (!pa || !pb) {
      samples.push({ t, km: null, speedA: pa?.speed ?? null, speedB: pb?.speed ?? null, state: 'sinDato' })
      continue
    }
    const km = haversineKm(pa.lat, pa.lon, pb.lat, pb.lon)
    samples.push({ t, km, speedA: pa.speed, speedB: pb.speed, state: classify(km, pa.speed, pb.speed, th) })
  }

  const share: Record<ConvoyState, number> = {
    sinDato: 0,
    detenidas: 0,
    muyCerca: 0,
    enBanda: 0,
    abierto: 0,
    alerta: 0,
    critico: 0,
  }
  const moving = samples.filter((s) => s.km !== null && s.state !== 'detenidas')
  for (const s of moving) share[s.state]++
  for (const key of Object.keys(share) as ConvoyState[]) {
    share[key] = moving.length > 0 ? (share[key] / moving.length) * 100 : 0
  }

  const sorted = moving.map((s) => s.km as number).sort((x, y) => x - y)
  const has = sorted.length > 0

  return {
    plateA: vehicleA.plate,
    plateB: vehicleB.plate,
    samples,
    movingMinutes: moving.length,
    medianKm: has ? quantile(sorted, 0.5) : null,
    meanKm: has ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length : null,
    p90Km: has ? quantile(sorted, 0.9) : null,
    maxKm: has ? sorted[sorted.length - 1] : null,
    share,
    peaks: findPeaks(a, b, samples, th.alertM),
    deviation: compareRoutes(a, b),
  }
}
