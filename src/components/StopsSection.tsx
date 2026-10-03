import { useMemo, type Ref } from 'react'
import { fmtDateTime, fmtDuration, fmtNumber, fmtTime, hourTicks } from '../lib/format.ts'
import { drivingWindow } from '../lib/speeding.ts'
import { OTHER_LABEL, type Stop, type StopSummary } from '../lib/stops.ts'
import type { Vehicle } from '../lib/types.ts'
import type { ImageHandle } from './EChart.tsx'
import { RouteMap, type MapMarker, type MapRoute } from './RouteMap.tsx'

/** Marcador de un lugar donde pararon ambas unidades. */
export const SHARED_STOP_COLOR = '#16233b'

interface Props {
  vehicles: Vehicle[]
  summaries: StopSummary[]
  /** Todas las paradas, en orden cronológico y con su lugar numerado. */
  stops: Stop[]
  colorOf: (plate: string) => string
  minStopMin: number
  mapRef?: Ref<ImageHandle>
}

/** Un marcador por lugar: del color de la unidad si paró sola, oscuro si pararon las dos. */
export function stopMarkers(stops: Stop[], colorOf: (plate: string) => string): MapMarker[] {
  const places = new Map<number, Stop[]>()
  for (const stop of stops) places.set(stop.place, [...(places.get(stop.place) ?? []), stop])
  return [...places.entries()].map(([place, group]) => {
    const plates = [...new Set(group.map((s) => s.plate))]
    const longest = group.reduce((a, b) => (b.durationMs > a.durationMs ? b : a))
    return {
      lon: longest.lon,
      lat: longest.lat,
      n: place,
      color: plates.length > 1 ? SHARED_STOP_COLOR : colorOf(plates[0]),
      text: `Parada ${place}: ${group
        .map((s) => `${s.plate} ${fmtTime(s.startT)} a ${fmtTime(s.endT)} (${fmtDuration(s.durationMs)})`)
        .join('; ')}`,
    }
  })
}

export function StopsSection({ vehicles, summaries, stops, colorOf, minStopMin, mapRef }: Props) {
  const window = useMemo(() => drivingWindow(vehicles), [vehicles])
  const routes = useMemo<MapRoute[]>(
    () => vehicles.map((vehicle, i) => ({ vehicle, color: colorOf(vehicle.plate), width: i === 0 ? 6 : 2.5 })),
    [vehicles, colorOf],
  )
  const markers = useMemo(() => stopMarkers(stops, colorOf), [stops, colorOf])
  const hasPair = vehicles.length === 2
  const hasShared = markers.some((m) => m.color === SHARED_STOP_COLOR)

  return (
    <section>
      <h2>
        Paradas en ruta <span>de {fmtNumber(minStopMin)} min o más</span>
      </h2>
      <p className="hint">
        Detenciones entre la salida y la llegada. No se cuenta el tiempo estacionado antes de salir ni después de
        llegar. El reporte indica dónde y cuánto se detuvo cada unidad, no el motivo.
      </p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Vehículo</th>
              <th>Salida</th>
              <th>Llegada</th>
              <th className="num">Paradas</th>
              <th className="num">Tiempo detenido en ruta</th>
              <th>Parada más larga</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr key={s.plate}>
                <th scope="row">
                  <i className="swatch" style={{ background: colorOf(s.plate) }} />
                  {s.plate}
                </th>
                <td>{s.departureT === null ? 'No se movió' : fmtDateTime(s.departureT)}</td>
                <td>{s.arrivalT === null ? '' : fmtDateTime(s.arrivalT)}</td>
                <td className="num">{s.stops.length}</td>
                <td className="num">{fmtDuration(s.totalMs)}</td>
                <td>
                  {s.longest
                    ? `${fmtDuration(s.longest.durationMs)} a las ${fmtTime(s.longest.startT)}`
                    : 'Sin paradas prolongadas'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {stops.length > 0 && (
        <>
          {window && (
            <div className="timeline">
              {summaries.map((s) => (
                <div key={s.plate} className="timeline-row">
                  <span className="timeline-label">
                    <i className="swatch" style={{ background: colorOf(s.plate) }} />
                    {s.plate}
                  </span>
                  <div className="timeline-track" role="img" aria-label={`Paradas de ${s.plate}`}>
                    {s.stops.map((stop) => (
                      <span
                        key={stop.startT}
                        className="stop-bar"
                        style={{
                          left: `${((stop.startT - window[0]) / (window[1] - window[0])) * 100}%`,
                          width: `max(${(stop.durationMs / (window[1] - window[0])) * 100}%, 3px)`,
                        }}
                        title={`Parada ${stop.place}: ${fmtTime(stop.startT)} a ${fmtTime(stop.endT)}, ${fmtDuration(stop.durationMs)}`}
                      >
                        {stop.place}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div className="timeline-row">
                <span className="timeline-label" />
                <div className="strip-axis" aria-hidden="true">
                  {hourTicks(window[0], window[1]).map((t) => (
                    <span key={t} style={{ left: `${((t - window[0]) / (window[1] - window[0])) * 100}%` }}>
                      {fmtTime(t)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <h3>Dónde pararon</h3>
          <RouteMap ref={mapRef} routes={routes} markers={markers} height={460} label="Mapa con los lugares de parada" />
          <ul className="map-legend">
            {vehicles.map((v) => (
              <li key={v.plate}>
                <i className="key-line" style={{ background: colorOf(v.plate) }} />
                {v.plate}
              </li>
            ))}
            {hasShared && (
              <li>
                <i className="peak-badge">1</i>
                Pararon las dos unidades
              </li>
            )}
            {hasPair &&
              vehicles
                .filter((v) => markers.some((m) => m.color === colorOf(v.plate)))
                .map((v) => (
                  <li key={v.plate}>
                    <i className="peak-badge" style={{ background: colorOf(v.plate) }}>
                      1
                    </i>
                    Paró solo {v.plate}
                  </li>
                ))}
          </ul>

          <h3>
            Detalle de paradas <span>{stops.length} en total, en orden cronológico</span>
          </h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="num">Lugar</th>
                  <th>Vehículo</th>
                  <th>Desde</th>
                  <th>Hasta</th>
                  <th className="num">Duración</th>
                  {hasPair && <th>La otra unidad</th>}
                  <th>Dónde</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((stop) => (
                  <tr key={`${stop.plate}-${stop.startT}`}>
                    <td className="num">
                      <span className="peak-badge">{stop.place}</span>
                    </td>
                    <th scope="row">
                      <i className="swatch" style={{ background: colorOf(stop.plate) }} />
                      {stop.plate}
                    </th>
                    <td>{fmtDateTime(stop.startT)}</td>
                    <td>{fmtTime(stop.endT)}</td>
                    <td className="num strong">{fmtDuration(stop.durationMs)}</td>
                    {hasPair && <td>{stop.other ? OTHER_LABEL[stop.other] : ''}</td>}
                    <td>{stop.ref || 'Sin referencia'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
