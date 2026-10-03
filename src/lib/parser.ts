import * as XLSX from 'xlsx'
import type { GpsPoint, ParsedReport, ReportMeta, Vehicle } from './types.ts'

/** Error de formato con un mensaje pensado para mostrarse tal cual a la persona usuaria. */
export class FormatError extends Error {}

const REQUIRED = {
  matricula: 'Matricula',
  fecha: 'Fecha',
  hora: 'Hora',
  vel: 'Vel.',
  latitud: 'Latitud',
  longitud: 'Longitud',
} as const

const MS_PER_DAY = 86400000
// Días entre el origen de fechas de Excel (30/12/1899) y el de Unix (01/01/1970).
const EXCEL_EPOCH_OFFSET = 25569

const normalize = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

// Caracteres de Windows-1252 en el rango 0x80-0x9F, que no coinciden con Latin-1.
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

/**
 * Repara texto UTF-8 que la plataforma de origen guardó como si fuera Windows-1252
 * (tildes y eñes convertidas en dos símbolos). Si el texto no tiene ese patrón, lo devuelve intacto.
 */
export function fixEncoding(text: string): string {
  if (!/[ÃÂ]/.test(text)) return text
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const byte = code < 256 ? code : CP1252[text[i]]
    if (byte === undefined) return text
    bytes[i] = byte
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return text
  }
}

const text = (value: unknown) => (value === null || value === undefined ? '' : fixEncoding(String(value).trim()))

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const n = Number(value.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Fecha como número de serie de Excel o como texto dd/mm/aaaa. Devuelve días desde el origen de Excel. */
function toSerialDay(value: unknown): number | null {
  if (typeof value === 'number') return value
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(value ?? '').trim())
  if (!m) return null
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) / MS_PER_DAY + EXCEL_EPOCH_OFFSET
}

/** Hora como fracción de día de Excel o como texto hh:mm:ss. Devuelve fracción de día. */
function toDayFraction(value: unknown): number | null {
  if (typeof value === 'number') return value
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value ?? '').trim())
  if (!m) return null
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86400
}

function toTimestamp(fecha: unknown, hora: unknown): number | null {
  const day = toSerialDay(fecha)
  if (day === null) return null
  const fraction = toDayFraction(hora) ?? day - Math.floor(day)
  const ms = (Math.floor(day) - EXCEL_EPOCH_OFFSET + fraction) * MS_PER_DAY
  return Math.round(ms / 1000) * 1000
}

function readMeta(rows: unknown[][]): ReportMeta {
  const meta: ReportMeta = { name: '', from: '', to: '', created: '', account: '' }
  const i = rows.findIndex((r) => normalize(r?.[0]) === 'reportarnombre')
  const values = i >= 0 ? rows[i + 1] : undefined
  if (!values) return meta
  // Las fechas de la cabecera pueden venir como texto o como número de serie.
  const dateText = (v: unknown) => {
    if (typeof v !== 'number') return text(v)
    const d = new Date(Math.round((v - EXCEL_EPOCH_OFFSET) * MS_PER_DAY))
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  }
  return {
    name: text(values[0]),
    from: dateText(values[1]),
    to: dateText(values[2]),
    created: dateText(values[3]),
    account: text(values[4]),
  }
}

export function parseReport(data: ArrayBuffer): ParsedReport {
  let rows: unknown[][]
  try {
    const workbook = XLSX.read(data, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })
  } catch {
    throw new FormatError('No se pudo abrir el archivo. Verifica que sea un Excel (.xlsx) sin contraseña.')
  }

  const headerIndex = rows.findIndex((r) => {
    const names = (r ?? []).map(normalize)
    return names.includes('matricula') && names.includes('latitud')
  })
  if (headerIndex < 0) {
    throw new FormatError(
      'No se encontró la fila de cabeceras con "Matricula" y "Latitud". El archivo debe ser el reporte "Detallado (varios vehículos)".',
    )
  }

  const header = rows[headerIndex].map(normalize)
  const col = (name: string) => header.indexOf(normalize(name))
  const missing = Object.values(REQUIRED).filter((name) => col(name) < 0)
  if (missing.length > 0) {
    throw new FormatError(`Faltan columnas obligatorias en el reporte: ${missing.join(', ')}.`)
  }

  const c = {
    plate: col('Matricula'),
    date: col('Fecha'),
    time: col('Hora'),
    event: col('Evento'),
    odo: col('Odom.'),
    speed: col('Vel.'),
    lat: col('Latitud'),
    lon: col('Longitud'),
    ref: col('Ref 1.'),
    zone: col('Ref 3.'),
  }

  const byPlate = new Map<string, GpsPoint[]>()
  let skipped = 0
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((v) => v === null || v === '')) continue
    const plate = text(r[c.plate])
    const t = toTimestamp(r[c.date], r[c.time])
    const lat = toNumber(r[c.lat])
    const lon = toNumber(r[c.lon])
    // Una posición 0,0 es un GPS sin fijar, no una ubicación real.
    if (!plate || t === null || lat === null || lon === null || (lat === 0 && lon === 0)) {
      skipped++
      continue
    }
    const point: GpsPoint = {
      t,
      lat,
      lon,
      speed: toNumber(r[c.speed]) ?? 0,
      odo: c.odo >= 0 ? toNumber(r[c.odo]) : null,
      event: c.event >= 0 ? text(r[c.event]) : '',
      ref: c.ref >= 0 ? text(r[c.ref]) : '',
      zone: c.zone >= 0 ? text(r[c.zone]) : '',
    }
    const list = byPlate.get(plate)
    if (list) list.push(point)
    else byPlate.set(plate, [point])
  }

  if (byPlate.size === 0) {
    throw new FormatError('El reporte no contiene posiciones GPS válidas.')
  }

  const vehicles: Vehicle[] = [...byPlate.entries()]
    .map(([plate, points]) => ({ plate, points: points.sort((a, b) => a.t - b.t) }))
    .sort((a, b) => a.plate.localeCompare(b.plate))

  const warnings: string[] = []
  if (skipped > 0) {
    warnings.push(`Se omitieron ${skipped} filas sin matrícula, fecha u posición válida.`)
  }

  return { meta: readMeta(rows), vehicles, warnings }
}
