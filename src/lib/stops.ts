import { haversineKm } from './geo.ts'
import type { Vehicle } from './types.ts'

/** Por debajo de esta velocidad (km/h) la unidad se considera detenida. */
const STOPPED_KMH = 5
/** Dos detenciones separadas por una maniobra más corta que esto, en el mismo lugar, son una sola parada. */
const MERGE_GAP_MS = 3 * 60_000
const MERGE_KM = 0.3
/** Distancia hasta la cual dos unidades detenidas a la vez se consideran en el mismo lugar. */
const SAME_PLACE_KM = 0.5

export interface Stop {
  plate: string
  startT: number
  endT: number
  durationMs: number
  lat: number
  lon: number
  ref: string
  /** Número del lugar de parada, compartido por las unidades que pararon juntas. Se asigna en `numberPlaces`. */
  place: number
  /** Qué hacía la otra unidad del par durante la parada. Null si no hay par. */
  other: 'juntas' | 'otroLugar' | 'enMovimiento' | null
}

export interface StopSummary {
  plate: string
  /** Primera vez que la unidad se movió, o null si no se movió en todo el periodo. */
  departureT: number | null
  /** Última vez que la unidad se movió. */
  arrivalT: number | null
  /** Paradas en ruta de al menos la duración mínima; no incluye la espera antes de salir ni tras llegar. */
  stops: Stop[]
  totalMs: number
  longest: Stop | null
}

export function findStops(vehicle: Vehicle, minStopMin: number): StopSummary {
  const pts = vehicle.points
  const first = pts.findIndex((p) => p.speed > STOPPED_KMH)
  const empty: StopSummary = { plate: vehicle.plate, departureT: null, arrivalT: null, stops: [], totalMs: 0, longest: null }
  if (first < 0) return empty
  let last = first
  for (let i = pts.length - 1; i > first; i--) {
    if (pts[i].speed > STOPPED_KMH) {
      last = i
      break
    }
  }

  // Entre la salida y la llegada, cada tramo de registros detenidos es una detención candidata.
  const raw: Stop[] = []
  let start = -1
  for (let i = first; i <= last; i++) {
    const stopped = pts[i].speed <= STOPPED_KMH
    if (stopped && start < 0) start = i
    if (!stopped && start >= 0) {
      const a = pts[start]
      raw.push({
        plate: vehicle.plate,
        startT: a.t,
        // La parada termina cuando la unidad vuelve a moverse, no en su último registro detenida.
        endT: pts[i].t,
        durationMs: pts[i].t - a.t,
        lat: a.lat,
        lon: a.lon,
        ref: a.ref || a.zone,
        place: 0,
        other: null,
      })
      start = -1
    }
  }

  const merged: Stop[] = []
  for (const stop of raw) {
    const prev = merged[merged.length - 1]
    if (prev && stop.startT - prev.endT <= MERGE_GAP_MS && haversineKm(prev.lat, prev.lon, stop.lat, stop.lon) <= MERGE_KM) {
      prev.endT = stop.endT
      prev.durationMs = prev.endT - prev.startT
    } else {
      merged.push(stop)
    }
  }

  const stops = merged.filter((s) => s.durationMs >= minStopMin * 60_000)
  return {
    plate: vehicle.plate,
    departureT: pts[first].t,
    arrivalT: pts[last].t,
    stops,
    totalMs: stops.reduce((sum, s) => sum + s.durationMs, 0),
    longest: stops.reduce<Stop | null>((best, s) => (!best || s.durationMs > best.durationMs ? s : best), null),
  }
}

const overlap = (a: Stop, b: Stop) => a.startT < b.endT && b.startT < a.endT
const near = (a: Stop, b: Stop) => haversineKm(a.lat, a.lon, b.lat, b.lon) <= SAME_PLACE_KM

/**
 * Numera los lugares de parada en orden cronológico. Dos unidades detenidas a la vez
 * y a menos de 500 m comparten número: pararon juntas.
 */
export function numberPlaces(summaries: StopSummary[]): Stop[] {
  const all = summaries.flatMap((s) => s.stops).sort((a, b) => a.startT - b.startT)
  let next = 1
  for (const stop of all) {
    const mate = all.find((o) => o.place > 0 && o.plate !== stop.plate && overlap(o, stop) && near(o, stop))
    stop.place = mate ? mate.place : next++
  }
  if (summaries.length === 2) {
    for (const stop of all) {
      const others = all.filter((o) => o.plate !== stop.plate && overlap(o, stop))
      stop.other = others.some((o) => o.place === stop.place) ? 'juntas' : others.length > 0 ? 'otroLugar' : 'enMovimiento'
    }
  }
  return all
}

export const OTHER_LABEL: Record<NonNullable<Stop['other']>, string> = {
  juntas: 'Detenida en el mismo lugar',
  otroLugar: 'Detenida en otro lugar',
  enMovimiento: 'En movimiento',
}
