import { useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { alertPoints } from '../lib/analysis.ts'
import { FLAT_GRADE_PCT, slopeOf, type ElevationProfile } from '../lib/elevation.ts'
import {
  fmtDateTime,
  fmtGrade,
  fmtKm,
  fmtNumber,
  fmtPercent,
  fmtShortDuration,
  fmtTime,
  hourTicks,
} from '../lib/format.ts'
import {
  EPISODE_KINDS,
  EPISODE_PREVIEW,
  KIND_COLORS,
  KIND_SHORT,
  drivingWindow,
  kindLabel,
  overLimitColor,
  speedBands,
  type Episode,
  type SpeedingSummary,
} from '../lib/speeding.ts'
import type { Thresholds, Vehicle } from '../lib/types.ts'
import { elevationOption } from './chartOptions.ts'
import { EChart, type CapturedImage, type ImageHandle } from './EChart.tsx'
import { RouteMap, type MapDot, type MapSegment } from './RouteMap.tsx'

export const EVENT_COLOR = '#7a4fd6'
const BASE_ROUTE_COLOR = '#b4bfcf'
/** Mismo criterio que al armar episodios: un hueco mayor corta el tramo. */
const SEGMENT_GAP_MS = 3 * 60_000

export interface ElevationState {
  status: 'idle' | 'loading' | 'error' | 'ready'
  error: string | null
  profiles: Map<string, ElevationProfile>
}

export interface SpeedingImages {
  maps: { plate: string; image: CapturedImage | null }[]
  elevation: { plate: string; image: CapturedImage | null }[]
}

export interface SpeedingHandle {
  getImages(): SpeedingImages
}

interface Props {
  vehicles: Vehicle[]
  speeding: SpeedingSummary[]
  colorOf: (plate: string) => string
  thresholds: Thresholds
  elevation: ElevationState
  grades: Map<Episode, number> | null
  onElevation: () => void
  ref?: Ref<SpeedingHandle>
}

function Timeline({ vehicles, speeding, colorOf, thresholds }: Pick<Props, 'vehicles' | 'speeding' | 'colorOf' | 'thresholds'>) {
  const window = useMemo(() => drivingWindow(vehicles), [vehicles])
  const events = useMemo(() => vehicles.map(alertPoints), [vehicles])
  if (!window) return null
  const [from, to] = window
  const span = to - from
  const left = (t: number) => `${((t - from) / span) * 100}%`
  const eventTypes = [...new Set(events.flat().map((p) => p.event))]

  return (
    <div className="timeline">
      {speeding.map((s, i) => (
        <div key={s.plate} className="timeline-row">
          <span className="timeline-label">
            <i className="swatch" style={{ background: colorOf(s.plate) }} />
            {s.plate}
          </span>
          <div className="timeline-tracks">
            <div className="timeline-track" role="img" aria-label={`Excesos de velocidad de ${s.plate}`}>
              {s.episodes.map((e) => (
                <span
                  key={e.startT}
                  style={{
                    left: left(e.startT),
                    width: `max(${(e.durationMs / span) * 100}%, 3px)`,
                    background: KIND_COLORS[e.kind],
                  }}
                  title={`${fmtTime(e.startT)}: ${KIND_SHORT[e.kind].toLowerCase()}, ${
                    e.records === 1 ? 'un registro' : fmtShortDuration(e.durationMs)
                  }, máximo ${fmtNumber(e.maxSpeed)} km/h`}
                />
              ))}
            </div>
            {events[i].length > 0 && (
              <div className="timeline-events" role="img" aria-label={`Eventos de ${s.plate}`}>
                {events[i].map((p) => (
                  <span key={p.t} style={{ left: left(p.t) }} title={`${fmtTime(p.t)}: ${p.event}`} />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="timeline-row">
        <span className="timeline-label" />
        <div className="strip-axis" aria-hidden="true">
          {hourTicks(from, to).map((t) => (
            <span key={t} style={{ left: left(t) }}>
              {fmtTime(t)}
            </span>
          ))}
        </div>
      </div>
      <ul className="strip-legend">
        {EPISODE_KINDS.map((kind) => (
          <li key={kind}>
            <i style={{ background: KIND_COLORS[kind] }} />
            <span>{kindLabel(kind, thresholds)}</span>
          </li>
        ))}
        {eventTypes.map((type) => (
          <li key={type}>
            <i className="key-tick" style={{ background: EVENT_COLOR }} />
            <span>Evento: {type}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BandBars({ speeding, limit }: { speeding: SpeedingSummary[]; limit: number }) {
  const bands = speedBands(limit)
  return (
    <div className="bands">
      {speeding.map((s) => (
        <div key={s.plate} className="bands-row">
          <span className="timeline-label">{s.plate}</span>
          <div className="bands-bar" role="img" aria-label={`Distribución de velocidad de ${s.plate}`}>
            {bands.map((band, i) =>
              s.bandShare[i] > 0 ? (
                <span
                  key={band.label}
                  className={i >= 3 ? 'on-dark' : undefined}
                  style={{ flexGrow: s.bandShare[i], background: band.color }}
                  title={`${band.label}: ${fmtPercent(s.bandShare[i])}`}
                >
                  {s.bandShare[i] >= 7 ? fmtPercent(s.bandShare[i]) : ''}
                </span>
              ) : null,
            )}
          </div>
        </div>
      ))}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Vehículo</th>
              {bands.map((band) => (
                <th key={band.label} className="num">
                  <i className="swatch square" style={{ background: band.color }} />
                  {band.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {speeding.map((s) => (
              <tr key={s.plate}>
                <th scope="row">{s.plate}</th>
                {bands.map((band, i) => (
                  <td key={band.label} className="num">
                    {fmtPercent(s.bandShare[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Tramos y puntos en exceso de una unidad, coloreados por cuánto superan el límite. */
function overlays(vehicle: Vehicle, summary: SpeedingSummary, limit: number): { segments: MapSegment[]; dots: MapDot[] } {
  const pts = vehicle.points
  const segments: MapSegment[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const color = overLimitColor(Math.max(a.speed, b.speed), limit)
    if (a.speed > limit && b.speed > limit && b.t - a.t <= SEGMENT_GAP_MS && color) {
      segments.push({ coords: [[a.lon, a.lat], [b.lon, b.lat]], color })
    }
  }
  const dots = summary.episodes
    .filter((e) => e.records === 1)
    .map((e) => {
      const p = pts[e.startIdx]
      return {
        lon: p.lon,
        lat: p.lat,
        color: overLimitColor(p.speed, limit) ?? KIND_COLORS.puntual,
        text: `${fmtTime(p.t)}: ${fmtNumber(p.speed)} km/h`,
      }
    })
  return { segments, dots }
}

export function SpeedingSection({ vehicles, speeding, colorOf, thresholds, elevation, grades, onElevation, ref }: Props) {
  const [showAll, setShowAll] = useState(false)
  const mapRefs = useRef<(ImageHandle | null)[]>([])
  const chartRefs = useRef<(ImageHandle | null)[]>([])
  const limit = thresholds.speedLimitKmh
  const bands = speedBands(limit)

  const maps = useMemo(
    () =>
      vehicles.map((vehicle, i) => ({
        vehicle,
        routes: [{ vehicle, color: BASE_ROUTE_COLOR, width: 3 }],
        ...overlays(vehicle, speeding[i], limit),
      })),
    [vehicles, speeding, limit],
  )

  const episodes = useMemo(
    () => speeding.flatMap((s) => s.episodes).sort((a, b) => b.durationMs - a.durationMs || b.maxSpeed - a.maxSpeed),
    [speeding],
  )

  const maxMeters = useMemo(() => {
    let max = 0
    for (const profile of elevation.profiles.values()) for (const m of profile.meters) max = Math.max(max, m)
    return max
  }, [elevation.profiles])
  const elevationCharts = useMemo(
    () =>
      vehicles.map((v, i) => {
        const profile = elevation.profiles.get(v.plate)
        return profile ? elevationOption(profile, speeding[i], maxMeters) : null
      }),
    [vehicles, elevation.profiles, speeding, maxMeters],
  )

  useImperativeHandle(ref, () => ({
    getImages: () => ({
      maps: vehicles.map((v, i) => ({ plate: v.plate, image: mapRefs.current[i]?.getImage() ?? null })),
      elevation: vehicles
        .map((v, i) => ({ plate: v.plate, image: chartRefs.current[i]?.getImage() ?? null }))
        .filter((_, i) => elevationCharts[i] !== null),
    }),
  }))

  const hasPair = vehicles.length === 2
  const total = episodes.length

  return (
    <section>
      <h2>
        Excesos de velocidad <span>sobre {fmtNumber(limit)} km/h</span>
      </h2>

      {total === 0 ? (
        <p className="hint">Ninguna unidad superó el límite en el periodo analizado.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Vehículo</th>
                  <th className="num">Episodios</th>
                  {EPISODE_KINDS.map((kind) => (
                    <th key={kind} className="num">
                      {KIND_SHORT[kind]}
                    </th>
                  ))}
                  <th className="num">Distancia en exceso</th>
                  <th className="num">Parte del recorrido</th>
                  <th>Exceso más largo</th>
                </tr>
              </thead>
              <tbody>
                {speeding.map((s) => (
                  <tr key={s.plate}>
                    <th scope="row">
                      <i className="swatch" style={{ background: colorOf(s.plate) }} />
                      {s.plate}
                    </th>
                    <td className="num">{s.episodes.length}</td>
                    {EPISODE_KINDS.map((kind) => (
                      <td key={kind} className="num">
                        {s.byKind[kind]}
                      </td>
                    ))}
                    <td className="num">{fmtKm(s.kmOver)}</td>
                    <td className="num">{fmtPercent((s.kmOver / (s.routeKm || 1)) * 100)}</td>
                    <td>
                      {s.longest && s.longest.records > 1
                        ? `${fmtShortDuration(s.longest.durationMs)} a las ${fmtTime(s.longest.startT)}`
                        : 'Solo registros sueltos'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Cuándo ocurrieron</h3>
          <p className="hint">
            Cada barra es un exceso; su ancho es lo que duró. Un exceso breve es compatible con un adelantamiento; uno
            prolongado no. El archivo no indica el motivo: la clasificación es por duración.
          </p>
          <Timeline vehicles={vehicles} speeding={speeding} colorOf={colorOf} thresholds={thresholds} />

          <h3>A qué velocidad se condujo</h3>
          <p className="hint">Porcentaje del tiempo en movimiento que cada unidad pasó en cada rango.</p>
          <BandBars speeding={speeding} limit={limit} />

          <h3>Dónde ocurrieron</h3>
          <div className={`map-grid${hasPair ? ' is-pair' : ''}`}>
            {maps.map((m, i) => (
              <figure key={m.vehicle.plate}>
                <figcaption>{m.vehicle.plate}</figcaption>
                <RouteMap
                  ref={(handle) => {
                    mapRefs.current[i] = handle
                  }}
                  routes={m.routes}
                  segments={m.segments}
                  dots={m.dots}
                  height={400}
                  label={`Mapa de excesos de velocidad de ${m.vehicle.plate}`}
                />
              </figure>
            ))}
          </div>
          <ul className="strip-legend">
            <li>
              <i className="key-line" style={{ background: BASE_ROUTE_COLOR }} />
              <span>Dentro del límite</span>
            </li>
            {bands.slice(2).map((band) => (
              <li key={band.label}>
                <i className="key-line" style={{ background: band.color }} />
                <span>{band.label}</span>
              </li>
            ))}
          </ul>

          <h3>Pendiente del terreno</h3>
          {elevation.status === 'ready' ? (
            <>
              <p className="hint">
                Perfil de altitud del recorrido, con los excesos de más de un registro marcados encima. Se considera
                bajada o subida una pendiente media de {FLAT_GRADE_PCT}% o más. Altitud obtenida de Open-Meteo.
              </p>
              {vehicles.map((v, i) =>
                elevationCharts[i] ? (
                  <figure key={v.plate}>
                    <figcaption>{v.plate}</figcaption>
                    <EChart
                      ref={(handle) => {
                        chartRefs.current[i] = handle
                      }}
                      option={elevationCharts[i]}
                      height={220}
                      label={`Perfil de altitud del recorrido de ${v.plate}`}
                    />
                  </figure>
                ) : null,
              )}
            </>
          ) : (
            <div className="optin">
              <p>
                El reporte GPS no incluye la altitud. Para saber si un exceso ocurrió en bajada, la aplicación puede
                consultarla a Open-Meteo, un servicio externo y gratuito. Al hacerlo se envían las coordenadas del
                recorrido a ese servicio; el archivo de Excel no se envía.
              </p>
              <button type="button" className="btn btn-secondary" disabled={elevation.status === 'loading'} onClick={onElevation}>
                {elevation.status === 'loading' ? 'Consultando altitud…' : 'Consultar altitud'}
              </button>
              {elevation.error && (
                <p className="error" role="alert">
                  {elevation.error}
                </p>
              )}
            </div>
          )}

          <h3>
            Detalle de episodios <span>{total} en total, del más largo al más corto</span>
          </h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Vehículo</th>
                  <th>Inicio</th>
                  <th className="num">Duración</th>
                  <th className="num">Vel. máxima</th>
                  <th className="num">Distancia</th>
                  <th>Tipo</th>
                  {hasPair && <th>La otra unidad</th>}
                  {grades && <th>Pendiente</th>}
                  <th>Lugar</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? episodes : episodes.slice(0, EPISODE_PREVIEW)).map((e) => {
                  const grade = grades?.get(e)
                  return (
                    <tr key={`${e.plate}-${e.startT}`}>
                      <th scope="row">
                        <i className="swatch" style={{ background: colorOf(e.plate) }} />
                        {e.plate}
                      </th>
                      <td>{fmtDateTime(e.startT)}</td>
                      <td className="num">{e.records === 1 ? 'Un registro' : fmtShortDuration(e.durationMs)}</td>
                      <td className="num">{fmtNumber(e.maxSpeed)} km/h</td>
                      <td className="num">{e.records === 1 ? '' : fmtKm(e.km)}</td>
                      <td>
                        <i className="swatch square" style={{ background: KIND_COLORS[e.kind] }} />
                        {KIND_SHORT[e.kind]}
                      </td>
                      {hasPair && <td>{e.withOther ? 'También en exceso' : 'Dentro del límite'}</td>}
                      {grades && <td>{grade === undefined ? 'Sin dato' : `${slopeOf(grade)} (${fmtGrade(grade)})`}</td>}
                      <td>{e.ref || 'Sin referencia'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {total > EPISODE_PREVIEW && (
            <button type="button" className="btn-link" onClick={() => setShowAll(!showAll)}>
              {showAll ? `Mostrar solo los ${EPISODE_PREVIEW} más largos` : `Mostrar los ${total} episodios`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
