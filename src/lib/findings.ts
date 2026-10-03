import { fmtDuration, fmtKm, fmtMeters, fmtNumber, fmtPercent, fmtShortDuration, fmtTime } from './format.ts'
import { FLAT_GRADE_PCT, type Slope } from './elevation.ts'
import type { Episode, SpeedingSummary } from './speeding.ts'
import type { StopSummary } from './stops.ts'
import type { PairAnalysis, Thresholds, VehicleSummary } from './types.ts'

interface Input {
  pair: PairAnalysis | null
  summaries: VehicleSummary[]
  speeding: SpeedingSummary[]
  stops: StopSummary[]
  thresholds: Thresholds
  /** Pendiente de cada episodio, solo si se consultó la altitud. */
  slopes: Map<Episode, Slope> | null
}

/** Umbral en palabras: «3 min» y no «3 min 00 s». */
const span = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`)

const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`

/**
 * Hallazgos en lenguaje llano para quien lee el reporte sin entrar al detalle.
 * Cada frase sale de una cifra del análisis; ninguna afirma una causa que el archivo no pueda demostrar.
 */
export function buildFindings({ pair, summaries, speeding, stops, thresholds: th, slopes }: Input): string[] {
  const out: string[] = []
  const limit = `${fmtNumber(th.speedLimitKmh)} km/h`

  if (pair && pair.movingMinutes > 0) {
    out.push(
      `Viajaron dentro de la banda de convoy el ${fmtPercent(pair.share.enBanda)} del tiempo en movimiento y superaron la distancia crítica de ${fmtMeters(th.criticalM)} el ${fmtPercent(pair.share.critico)}. La separación máxima fue de ${fmtKm(pair.maxKm, 2)}.`,
    )
  }

  const withExcess = speeding.filter((s) => s.episodes.length > 0)
  if (withExcess.length === 0) {
    out.push(`Ninguna unidad superó el límite de ${limit}.`)
  } else {
    // Una unidad con solo registros sueltos no acumula distancia medible sobre el límite.
    const measurable = withExcess.filter((s) => s.kmOver >= 0.5)
    if (measurable.length > 0) {
      out.push(
        `${list(
          measurable.map(
            (s) => `${s.plate} recorrió ${fmtKm(s.kmOver, 0)} sobre ${limit} (${fmtPercent((s.kmOver / (s.routeKm || 1)) * 100)} de su recorrido)`,
          ),
        )}.`,
      )
    } else {
      const records = withExcess.reduce((sum, s) => sum + s.episodes.length, 0)
      out.push(
        `Los excesos sobre ${limit} fueron registros sueltos, sin duración medible: ${records} en total (${list(withExcess.map((s) => s.plate))}).`,
      )
    }

    const longest = withExcess
      .map((s) => s.longest)
      .filter((e): e is Episode => e !== null && e.records > 1)
      .sort((a, b) => b.durationMs - a.durationMs)[0]
    const prolonged = withExcess.reduce((sum, s) => sum + s.byKind.prolongado, 0)
    if (longest && prolonged > 0) {
      out.push(
        `${prolonged === 1 ? 'Un exceso duró' : `${prolonged} excesos duraron`} ${span(th.longS)} o más, demasiado para un adelantamiento. El más largo fue de ${longest.plate} a las ${fmtTime(longest.startT)}: ${fmtShortDuration(longest.durationMs)} y ${fmtKm(longest.km)} seguidos, con un máximo de ${fmtNumber(longest.maxSpeed)} km/h.`,
      )
    }

    if (pair && speeding.length === 2) {
      const [a, b] = speeding
      const together = a.episodes.filter((e) => e.withOther).length
      if (a.episodes.length > 0 && together / a.episodes.length >= 0.5) {
        out.push(
          `En ${together} de los ${a.episodes.length} excesos de ${a.plate}, ${b.plate} también iba sobre el límite: el patrón corresponde al ritmo de marcha del convoy y no a maniobras aisladas.`,
        )
      }
    }

    if (slopes) {
      const long = withExcess.flatMap((s) => s.episodes).filter((e) => e.kind === 'prolongado' || e.kind === 'sostenido')
      const downhill = long.filter((e) => slopes.get(e) === 'Bajada').length
      if (long.length > 0) {
        out.push(
          downhill === 0
            ? `Ninguno de los ${long.length} excesos sostenidos o prolongados ocurrió en bajada (pendiente media de ${FLAT_GRADE_PCT}% o más): el terreno no los explica.`
            : `${downhill} de los ${long.length} excesos sostenidos o prolongados ocurrieron en bajada (pendiente media de ${FLAT_GRADE_PCT}% o más); los ${long.length - downhill} restantes, en terreno plano o en subida.`,
        )
      }
    }
  }

  const withStops = stops.filter((s) => s.stops.length > 0)
  if (withStops.length > 0) {
    const longest = withStops.map((s) => s.longest!).sort((a, b) => b.durationMs - a.durationMs)[0]
    const apart = withStops.flatMap((s) => s.stops).filter((s) => s.other === 'enMovimiento' || s.other === 'otroLugar').length
    out.push(
      `${list(
        withStops.map(
          (s) => `${s.plate} hizo ${s.stops.length} ${s.stops.length === 1 ? 'parada' : 'paradas'} de ${fmtNumber(th.minStopMin)} min o más (${fmtDuration(s.totalMs)} en total)`,
        ),
      )}. La más larga fue de ${longest.plate} a las ${fmtTime(longest.startT)}: ${fmtDuration(longest.durationMs)}${longest.ref ? ` en ${longest.ref}` : ''}.${
        pair ? (apart === 0 ? ' Todas las paradas fueron en conjunto.' : ` ${apart === 1 ? 'Una parada no fue' : `${apart} paradas no fueron`} en conjunto.`) : ''
      }`,
    )
  }

  const top = summaries.reduce((max, s) => Math.max(max, s.maxSpeed), 0)
  if (top > th.speedLimitKmh) {
    const who = summaries.filter((s) => s.maxSpeed === top).map((s) => s.plate)
    out.push(`La velocidad máxima registrada fue de ${fmtNumber(top)} km/h (${list(who)}).`)
  }

  for (const s of summaries) {
    for (const e of s.events) {
      if (/^ignici/i.test(e.type)) continue
      out.push(
        `${s.plate} registró ${fmtNumber(e.count)} ${e.count === 1 ? 'evento' : 'eventos'} de «${e.type}» entre las ${fmtTime(e.firstT)} y las ${fmtTime(e.lastT)}.`,
      )
    }
  }

  return out
}
