// Formateo manual: la salida no depende del idioma ni de la zona horaria del equipo.

const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/**
 * Escapa texto que viene del Excel antes de insertarlo en HTML. Un archivo de terceros puede traer
 * etiquetas en la matrícula o en una referencia, y los tooltips de los gráficos se pintan como HTML.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch])
}

const pad = (n: number) => String(n).padStart(2, '0')

export function fmtNumber(value: number, decimals = 0): string {
  const [int, dec] = Math.abs(value).toFixed(decimals).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (value < 0 ? '-' : '') + grouped + (dec ? ',' + dec : '')
}

export function fmtKm(km: number | null, decimals = 1): string {
  return km === null ? 'Sin dato' : `${fmtNumber(km, decimals)} km`
}

/** Separación: metros por debajo de 1 km, kilómetros desde ahí. */
export function fmtSeparation(km: number | null): string {
  if (km === null) return 'Sin dato'
  return km < 1 ? `${fmtNumber(Math.round(km * 1000))} m` : `${fmtNumber(km, 2)} km`
}

export function fmtMeters(m: number): string {
  return m < 1000 ? `${fmtNumber(Math.round(m))} m` : `${fmtNumber(m / 1000, m % 1000 === 0 ? 0 : 1)} km`
}

export function fmtTime(t: number): string {
  const d = new Date(t)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export function fmtDate(t: number): string {
  const d = new Date(t)
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

export function fmtDateTime(t: number): string {
  return `${fmtDate(t)} ${fmtTime(t)}`
}

export function fmtDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h ${pad(m)} min` : `${m} min`
}

const HOUR = 3_600_000

/** Marcas de hora repartidas para que entren unas nueve etiquetas, sea cual sea la duración del periodo. */
export function hourTicks(start: number, end: number): number[] {
  const span = end - start
  const step = [1, 2, 3, 6, 12, 24].find((h) => span / (h * HOUR) <= 9) ?? 24
  const ticks: number[] = []
  for (let t = Math.ceil(start / (step * HOUR)) * step * HOUR; t <= end; t += step * HOUR) ticks.push(t)
  return ticks
}

/** Duración corta, con segundos: los excesos de velocidad suelen durar menos de un minuto. */
export function fmtShortDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const m = Math.floor(seconds / 60)
  return m >= 60 ? fmtDuration(ms) : `${m} min ${pad(seconds % 60)} s`
}

/** Pendiente con signo; un valor que redondea a cero se muestra sin signo. */
export function fmtGrade(grade: number): string {
  const shown = Math.round(grade * 10) / 10
  return `${shown > 0 ? '+' : ''}${fmtNumber(shown === 0 ? 0 : shown, 1)}%`
}

export function fmtPercent(value: number): string {
  return `${fmtNumber(value, value > 0 && value < 10 ? 1 : 0)}%`
}
