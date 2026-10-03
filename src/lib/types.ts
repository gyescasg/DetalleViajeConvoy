export interface GpsPoint {
  /** Milisegundos de "hora de reloj" del reporte, guardados como UTC para no depender de la zona horaria del equipo. */
  t: number
  lat: number
  lon: number
  speed: number
  odo: number | null
  event: string
  ref: string
  zone: string
}

export interface Vehicle {
  plate: string
  points: GpsPoint[]
}

export interface ReportMeta {
  name: string
  from: string
  to: string
  created: string
  account: string
}

export interface ParsedReport {
  meta: ReportMeta
  vehicles: Vehicle[]
  warnings: string[]
}

export interface Thresholds {
  bandMinM: number
  bandMaxM: number
  alertM: number
  criticalM: number
  speedLimitKmh: number
  /** Un exceso más corto que esto (segundos) es compatible con un adelantamiento. */
  briefS: number
  /** Un exceso desde esta duración (segundos) se considera prolongado. */
  longS: number
  /** Duración mínima (minutos) para que una detención cuente como parada prolongada. */
  minStopMin: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  bandMinM: 100,
  bandMaxM: 300,
  alertM: 500,
  criticalM: 1000,
  speedLimitKmh: 80,
  briefS: 60,
  longS: 180,
  minStopMin: 10,
}

export interface EventSummary {
  type: string
  count: number
  firstT: number
  lastT: number
  firstRef: string
}

export interface VehicleSummary {
  plate: string
  points: number
  startT: number
  endT: number
  startRef: string
  endRef: string
  gpsKm: number
  odoKm: number | null
  maxSpeed: number
  avgMovingSpeed: number
  movingMs: number
  stoppedMs: number
  speedingPoints: number
  speedingMs: number
  events: EventSummary[]
}

export type ConvoyState = 'sinDato' | 'detenidas' | 'muyCerca' | 'enBanda' | 'abierto' | 'alerta' | 'critico'

export interface Sample {
  t: number
  /** Separación en km; null cuando alguna unidad no tiene señal cercana. */
  km: number | null
  speedA: number | null
  speedB: number | null
  state: ConvoyState
}

export interface Peak {
  t: number
  km: number
  latA: number
  lonA: number
  latB: number
  lonB: number
  speedA: number
  speedB: number
  refA: string
  refB: string
}

export interface RouteDeviation {
  medianM: number
  p95M: number
  maxM: number
  sameRoute: boolean
}

export interface PairAnalysis {
  plateA: string
  plateB: string
  samples: Sample[]
  movingMinutes: number
  medianKm: number | null
  meanKm: number | null
  p90Km: number | null
  maxKm: number | null
  /** Porcentaje del tiempo en movimiento por estado. */
  share: Record<ConvoyState, number>
  peaks: Peak[]
  deviation: RouteDeviation | null
}
