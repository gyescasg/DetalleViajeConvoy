import { fmtNumber } from './format.ts'
import { haversineKm } from './geo.ts'
import type { Thresholds, Vehicle } from './types.ts'

/** Dos registros en exceso separados por más de esto no pertenecen al mismo episodio: hubo un hueco de señal. */
const EPISODE_GAP_MS = 3 * 60_000
/** Margen para considerar que dos unidades iban en exceso "al mismo tiempo", dado que no reportan en el mismo instante. */
const SIMULTANEOUS_MS = 2 * 60_000
const MOVING_KMH = 5
/** Episodios que se listan en el detalle antes de pedir «mostrar todos»; el PDF lista los mismos. */
export const EPISODE_PREVIEW = 12

/**
 * Clasificación por duración. Es una inferencia: el archivo no dice por qué se excedió la velocidad,
 * solo cuánto duró. Un exceso breve es compatible con un adelantamiento; uno prolongado no lo es.
 */
export type EpisodeKind = 'puntual' | 'breve' | 'sostenido' | 'prolongado'

export const EPISODE_KINDS: EpisodeKind[] = ['puntual', 'breve', 'sostenido', 'prolongado']

export const KIND_COLORS: Record<EpisodeKind, string> = {
  puntual: '#aab6ca',
  breve: '#f2b51d',
  sostenido: '#ec7a3c',
  prolongado: '#d03b3b',
}

export const KIND_SHORT: Record<EpisodeKind, string> = {
  puntual: 'Puntual',
  breve: 'Breve',
  sostenido: 'Sostenido',
  prolongado: 'Prolongado',
}

const seconds = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`)

export function kindLabel(kind: EpisodeKind, th: Thresholds): string {
  switch (kind) {
    case 'puntual':
      return 'Puntual, un solo registro'
    case 'breve':
      return `Breve, menos de ${seconds(th.briefS)}`
    case 'sostenido':
      return `Sostenido, de ${seconds(th.briefS)} a ${seconds(th.longS)}`
    case 'prolongado':
      return `Prolongado, ${seconds(th.longS)} o más`
  }
}

export interface Episode {
  plate: string
  startIdx: number
  endIdx: number
  startT: number
  endT: number
  /** Tiempo entre el primer y el último registro en exceso. Cero cuando el episodio es un solo registro. */
  durationMs: number
  records: number
  maxSpeed: number
  km: number
  ref: string
  kind: EpisodeKind
  /** La otra unidad del par también iba en exceso. Null cuando no hay par que comparar. */
  withOther: boolean | null
}

export interface SpeedingSummary {
  plate: string
  episodes: Episode[]
  byKind: Record<EpisodeKind, number>
  kmOver: number
  routeKm: number
  msOver: number
  longest: Episode | null
  /** Porcentaje del tiempo en movimiento en cada rango de velocidad (ver speedBands). */
  bandShare: number[]
  /** Kilómetros acumulados en cada posición, para ubicar episodios sobre el perfil de altitud. */
  cumKm: number[]
}

/** Rangos de velocidad relativos al límite: dos por debajo y tres por encima. */
export function speedBands(limit: number): { from: number; to: number; label: string; color: string }[] {
  const edges = [0, Math.max(0, limit - 20), limit, limit + 10, limit + 20, Infinity]
  const colors = ['#d5deeb', '#a9bddb', '#f2b51d', '#ec7a3c', '#d03b3b']
  return colors.map((color, i) => {
    const from = edges[i]
    const to = edges[i + 1]
    const label =
      i === 0
        ? `Hasta ${fmtNumber(to)} km/h`
        : to === Infinity
          ? `Más de ${fmtNumber(from)} km/h`
          : `${fmtNumber(from)} a ${fmtNumber(to)} km/h`
    return { from, to, label, color }
  })
}

/** Color del tramo según cuánto supera el límite; null si no lo supera. */
export function overLimitColor(speed: number, limit: number): string | null {
  if (speed <= limit) return null
  return speedBands(limit).find((b) => speed > b.from && speed <= b.to)?.color ?? null
}

export function analyzeSpeeding(vehicle: Vehicle, th: Thresholds): SpeedingSummary {
  const pts = vehicle.points
  const limit = th.speedLimitKmh
  const bands = speedBands(limit)

  const cumKm = [0]
  const bandMs = bands.map(() => 0)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    cumKm.push(cumKm[i - 1] + haversineKm(a.lat, a.lon, b.lat, b.lon))
    const dt = b.t - a.t
    if (a.speed > MOVING_KMH && dt > 0 && dt <= EPISODE_GAP_MS) {
      // La primera banda incluye su borde inferior; el resto son (desde, hasta].
      const band = bands.findIndex((x, j) => (j === 0 || a.speed > x.from) && a.speed <= x.to)
      bandMs[band] += dt
    }
  }
  const movingMs = bandMs.reduce((sum, v) => sum + v, 0)

  const episodes: Episode[] = []
  let start = -1
  const close = (end: number) => {
    const first = pts[start]
    const last = pts[end]
    const durationMs = last.t - first.t
    const records = end - start + 1
    const kind: EpisodeKind =
      records === 1
        ? 'puntual'
        : durationMs < th.briefS * 1000
          ? 'breve'
          : durationMs < th.longS * 1000
            ? 'sostenido'
            : 'prolongado'
    let maxSpeed = 0
    for (let i = start; i <= end; i++) maxSpeed = Math.max(maxSpeed, pts[i].speed)
    episodes.push({
      plate: vehicle.plate,
      startIdx: start,
      endIdx: end,
      startT: first.t,
      endT: last.t,
      durationMs,
      records,
      maxSpeed,
      km: cumKm[end] - cumKm[start],
      ref: first.ref || first.zone,
      kind,
      withOther: null,
    })
    start = -1
  }
  for (let i = 0; i < pts.length; i++) {
    const over = pts[i].speed > limit
    if (start >= 0 && (!over || pts[i].t - pts[i - 1].t > EPISODE_GAP_MS)) close(i - 1)
    if (over && start < 0) start = i
  }
  if (start >= 0) close(pts.length - 1)

  const byKind: Record<EpisodeKind, number> = { puntual: 0, breve: 0, sostenido: 0, prolongado: 0 }
  for (const e of episodes) byKind[e.kind]++

  return {
    plate: vehicle.plate,
    episodes,
    byKind,
    kmOver: episodes.reduce((sum, e) => sum + e.km, 0),
    routeKm: cumKm[cumKm.length - 1],
    msOver: episodes.reduce((sum, e) => sum + e.durationMs, 0),
    longest: episodes.reduce<Episode | null>((best, e) => (!best || e.durationMs > best.durationMs ? e : best), null),
    bandShare: bandMs.map((ms) => (movingMs > 0 ? (ms / movingMs) * 100 : 0)),
    cumKm,
  }
}

/** Marca en cada episodio si la otra unidad también iba en exceso en ese momento. */
export function markSimultaneous(a: SpeedingSummary, b: SpeedingSummary): void {
  const overlaps = (e: Episode, others: Episode[]) =>
    others.some((o) => o.startT <= e.endT + SIMULTANEOUS_MS && o.endT >= e.startT - SIMULTANEOUS_MS)
  for (const e of a.episodes) e.withOther = overlaps(e, b.episodes)
  for (const e of b.episodes) e.withOther = overlaps(e, a.episodes)
}

/** Ventana del día en la que alguna unidad se movió, para no gastar la línea de tiempo en horas de estacionamiento. */
export function drivingWindow(vehicles: Vehicle[]): [number, number] | null {
  let from = Infinity
  let to = -Infinity
  for (const v of vehicles) {
    for (const p of v.points) {
      if (p.speed <= MOVING_KMH) continue
      if (p.t < from) from = p.t
      if (p.t > to) to = p.t
    }
  }
  if (!(to > from)) return null
  const margin = 15 * 60_000
  return [from - margin, to + margin]
}
