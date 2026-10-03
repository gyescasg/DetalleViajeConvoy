import type { Episode, SpeedingSummary } from './speeding.ts'
import type { Vehicle } from './types.ts'

// La altitud no viene en el reporte GPS: se consulta a Open-Meteo, un servicio público y gratuito.
// Son las únicas coordenadas exactas que salen del equipo, y solo si la persona usuaria lo pide.
const ENDPOINT = 'https://api.open-meteo.com/v1/elevation'
/** Máximo de coordenadas que el servicio acepta por consulta. */
const BATCH = 100
/**
 * Tope de puntos por unidad. El servicio limita cuántas coordenadas acepta por minuto:
 * con dos unidades, 180 puntos cada una entra con margen.
 */
const MAX_SAMPLES = 180
const MIN_STEP_KM = 0.5
const TIMEOUT_MS = 15_000
/** Tramo mínimo para medir una pendiente: el modelo de terreno tiene una resolución de unos 90 m. */
const MIN_SPAN_KM = 1
/**
 * Pendiente media (en %) a partir de la cual un tramo deja de considerarse plano.
 * Es baja a propósito: un camión cargado gana velocidad en bajadas largas aunque sean suaves.
 */
export const FLAT_GRADE_PCT = 1

export interface ElevationProfile {
  km: number[]
  meters: number[]
  /** Distancia entre muestras de altitud, en km. */
  stepKm: number
}

/** Error con un mensaje pensado para mostrarse tal cual. */
export class ElevationError extends Error {}

export type Slope = 'Bajada' | 'Plano' | 'Subida'

export async function fetchProfile(vehicle: Vehicle, cumKm: number[]): Promise<ElevationProfile> {
  const total = cumKm[cumKm.length - 1]
  const step = Math.max(MIN_STEP_KM, total / MAX_SAMPLES)
  const indices: number[] = []
  let next = 0
  cumKm.forEach((km, i) => {
    if (km >= next || i === cumKm.length - 1) {
      indices.push(i)
      next = km + step
    }
  })

  const meters: number[] = []
  for (let i = 0; i < indices.length; i += BATCH) {
    const chunk = indices.slice(i, i + BATCH).map((j) => vehicle.points[j])
    // Cuatro decimales (unos 11 m) alcanzan para un modelo de terreno de 90 m.
    const query = new URLSearchParams({
      latitude: chunk.map((p) => p.lat.toFixed(4)).join(','),
      longitude: chunk.map((p) => p.lon.toFixed(4)).join(','),
    })
    let response: Response
    try {
      response = await fetch(`${ENDPOINT}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new ElevationError('No se pudo conectar con el servicio de altitud. Revisa la conexión a internet.')
    }
    if (response.status === 429) {
      throw new ElevationError('El servicio de altitud limitó las consultas. Espera un minuto y vuelve a intentarlo.')
    }
    if (!response.ok) throw new ElevationError(`El servicio de altitud respondió con el error ${response.status}.`)
    const body = (await response.json()) as { elevation?: number[] }
    if (!Array.isArray(body.elevation) || body.elevation.length !== chunk.length) {
      throw new ElevationError('El servicio de altitud devolvió una respuesta incompleta.')
    }
    meters.push(...body.elevation)
  }
  return { km: indices.map((j) => cumKm[j]), meters, stepKm: step }
}

function elevationAt(profile: ElevationProfile, km: number): number {
  const { km: xs, meters } = profile
  if (km <= xs[0]) return meters[0]
  const last = xs.length - 1
  if (km >= xs[last]) return meters[last]
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= km) lo = mid
    else hi = mid
  }
  const w = (km - xs[lo]) / (xs[hi] - xs[lo] || 1)
  return meters[lo] + (meters[hi] - meters[lo]) * w
}

/** Pendiente media del episodio en porcentaje: negativa en bajada. */
export function episodeGrade(profile: ElevationProfile, summary: SpeedingSummary, episode: Episode): number {
  let from = summary.cumKm[episode.startIdx]
  let to = summary.cumKm[episode.endIdx]
  // Un episodio más corto que la separación entre muestras se mide sobre el tramo que lo rodea.
  const minSpan = Math.max(MIN_SPAN_KM, profile.stepKm)
  if (to - from < minSpan) {
    const center = (from + to) / 2
    from = Math.max(0, center - minSpan / 2)
    to = from + minSpan
  }
  return ((elevationAt(profile, to) - elevationAt(profile, from)) / ((to - from) * 1000)) * 100
}

export function slopeOf(grade: number): Slope {
  // Se clasifica con el mismo decimal que se muestra, para que la etiqueta y la cifra no se contradigan.
  const shown = Math.round(grade * 10) / 10
  if (shown <= -FLAT_GRADE_PCT) return 'Bajada'
  if (shown >= FLAT_GRADE_PCT) return 'Subida'
  return 'Plano'
}
