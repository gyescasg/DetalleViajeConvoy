import { fmtMeters } from './format.ts'
import type { ConvoyState, Sample, Thresholds } from './types.ts'

/** Colores por rol: la unidad A siempre es azul y la B siempre naranja, sin importar el orden del archivo. */
export const VEHICLE_COLORS = { a: '#1f5fd1', b: '#e2622a', other: '#9aa6b8' } as const

/** Estados que describen la disciplina de convoy, de mejor a peor. */
export const MOVING_STATES: ConvoyState[] = ['muyCerca', 'enBanda', 'abierto', 'alerta', 'critico']

export const STATE_ORDER: ConvoyState[] = [...MOVING_STATES, 'detenidas', 'sinDato']

export const STATE_COLORS: Record<ConvoyState, string> = {
  muyCerca: '#7b8fb5',
  enBanda: '#1e9e55',
  abierto: '#f2b51d',
  alerta: '#ec7a3c',
  critico: '#d03b3b',
  detenidas: '#dde3ec',
  sinDato: '#ffffff',
}

export function stateLabel(state: ConvoyState, th: Thresholds): string {
  switch (state) {
    case 'muyCerca':
      return `Muy cerca, menos de ${fmtMeters(th.bandMinM)}`
    case 'enBanda':
      return `En banda, de ${fmtMeters(th.bandMinM)} a ${fmtMeters(th.bandMaxM)}`
    case 'abierto':
      return `Abierto, de ${fmtMeters(th.bandMaxM)} a ${fmtMeters(th.alertM)}`
    case 'alerta':
      return `Alerta, de ${fmtMeters(th.alertM)} a ${fmtMeters(th.criticalM)}`
    case 'critico':
      return `Crítico, más de ${fmtMeters(th.criticalM)}`
    case 'detenidas':
      return 'Ambas detenidas'
    case 'sinDato':
      return 'Sin dato'
  }
}

export const STATE_SHORT: Record<ConvoyState, string> = {
  muyCerca: 'Muy cerca',
  enBanda: 'En banda',
  abierto: 'Abierto',
  alerta: 'Alerta',
  critico: 'Crítico',
  detenidas: 'Ambas detenidas',
  sinDato: 'Sin dato',
}

export interface StateRun {
  state: ConvoyState
  fromT: number
  toT: number
  count: number
}

/** Agrupa muestras consecutivas con el mismo estado, para dibujar la tira de convoy. */
export function stateRuns(samples: Sample[]): StateRun[] {
  const runs: StateRun[] = []
  for (const s of samples) {
    const last = runs[runs.length - 1]
    if (last && last.state === s.state) {
      last.toT = s.t
      last.count++
    } else {
      runs.push({ state: s.state, fromT: s.t, toT: s.t, count: 1 })
    }
  }
  return runs
}

/** Los umbrales solo tienen sentido si crecen de la banda mínima a la distancia crítica. */
export function thresholdsError(th: Thresholds): string | null {
  const values = [th.bandMinM, th.bandMaxM, th.alertM, th.criticalM, th.speedLimitKmh, th.briefS, th.longS, th.minStopMin]
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return 'Todos los valores deben ser mayores que cero.'
  if (!(th.bandMinM < th.bandMaxM && th.bandMaxM <= th.alertM && th.alertM < th.criticalM)) {
    return 'Las distancias deben ir de menor a mayor: banda mínima, banda máxima, alerta y crítico.'
  }
  if (!(th.briefS < th.longS)) return 'El exceso breve debe durar menos que el prolongado.'
  return null
}
