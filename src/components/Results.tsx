import { useCallback, useMemo, useRef, useState } from 'react'
import { alertPoints, analyzePair, summarizeVehicle } from '../lib/analysis.ts'
import { ElevationError, episodeGrade, fetchProfile, slopeOf, type ElevationProfile, type Slope } from '../lib/elevation.ts'
import { buildFindings } from '../lib/findings.ts'
import { fmtDuration, fmtMeters, fmtSeparation, fmtTime } from '../lib/format.ts'
import { analyzeSpeeding, markSimultaneous, type Episode } from '../lib/speeding.ts'
import { VEHICLE_COLORS } from '../lib/states.ts'
import { findStops, numberPlaces } from '../lib/stops.ts'
import { DEFAULT_THRESHOLDS, type ParsedReport, type Thresholds, type Vehicle } from '../lib/types.ts'
import { exportPdf } from '../report/pdf.ts'
import { separationOption, speedOption } from './chartOptions.ts'
import { ConvoyStrip } from './ConvoyStrip.tsx'
import { EChart, type ImageHandle } from './EChart.tsx'
import { RouteMap, type MapDot, type MapRoute } from './RouteMap.tsx'
import { SettingsPanel, type Company } from './SettingsPanel.tsx'
import { EVENT_COLOR, SpeedingSection, type ElevationState, type SpeedingHandle } from './SpeedingSection.tsx'
import { StopsSection } from './StopsSection.tsx'
import { EventsTable, PeaksTable, SummaryTable } from './Tables.tsx'

interface Props {
  report: ParsedReport
  fileName: string
  onReset: () => void
}

const NO_ELEVATION: ElevationState = { status: 'idle', error: null, profiles: new Map() }

export function Results({ report, fileName, onReset }: Props) {
  const { vehicles, meta } = report
  const plates = useMemo(() => vehicles.map((v) => v.plate), [vehicles])
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS)
  const [pairPlates, setPairPlates] = useState<[string, string] | null>(
    plates.length >= 2 ? [plates[0], plates[1]] : null,
  )
  const [company, setCompany] = useState<Company>({ name: '', logo: null })
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [elevation, setElevation] = useState<ElevationState>(NO_ELEVATION)

  const separationChart = useRef<ImageHandle>(null)
  const speedChart = useRef<ImageHandle>(null)
  const routeMap = useRef<ImageHandle>(null)
  const speedingSection = useRef<SpeedingHandle>(null)
  const stopsMap = useRef<ImageHandle>(null)

  const vehicleA = pairPlates ? vehicles.find((v) => v.plate === pairPlates[0]) : vehicles[0]
  const vehicleB = pairPlates ? vehicles.find((v) => v.plate === pairPlates[1]) : undefined
  /** Unidades con análisis detallado: el par elegido, o la única del reporte. */
  const analyzed = useMemo(() => [vehicleA, vehicleB].filter((v): v is Vehicle => v !== undefined), [vehicleA, vehicleB])

  const colorOf = useMemo(() => {
    const colors = new Map<string, string>()
    if (vehicleA) colors.set(vehicleA.plate, VEHICLE_COLORS.a)
    if (vehicleB) colors.set(vehicleB.plate, VEHICLE_COLORS.b)
    return (plate: string) => colors.get(plate) ?? VEHICLE_COLORS.other
  }, [vehicleA, vehicleB])

  const summaries = useMemo(
    () => vehicles.map((v) => summarizeVehicle(v, thresholds.speedLimitKmh)),
    [vehicles, thresholds.speedLimitKmh],
  )
  const pair = useMemo(
    () => (vehicleA && vehicleB ? analyzePair(vehicleA, vehicleB, thresholds) : null),
    [vehicleA, vehicleB, thresholds],
  )
  const speeding = useMemo(() => {
    const list = analyzed.map((v) => analyzeSpeeding(v, thresholds))
    if (list.length === 2) markSimultaneous(list[0], list[1])
    return list
  }, [analyzed, thresholds])

  /** Pendiente media de cada episodio, solo para las unidades cuya altitud ya se consultó. */
  const grades = useMemo(() => {
    if (elevation.status !== 'ready') return null
    const map = new Map<Episode, number>()
    for (const s of speeding) {
      const profile = elevation.profiles.get(s.plate)
      if (profile) for (const e of s.episodes) map.set(e, episodeGrade(profile, s, e))
    }
    return map
  }, [elevation, speeding])
  const slopes = useMemo(() => {
    if (!grades) return null
    const map = new Map<Episode, Slope>()
    for (const [episode, grade] of grades) map.set(episode, slopeOf(grade))
    return map
  }, [grades])

  const stops = useMemo(() => {
    const byVehicle = analyzed.map((v) => findStops(v, thresholds.minStopMin))
    return { byVehicle, all: numberPlaces(byVehicle) }
  }, [analyzed, thresholds.minStopMin])

  const findings = useMemo(
    () => buildFindings({ pair, summaries, speeding, stops: stops.byVehicle, thresholds, slopes }),
    [pair, summaries, speeding, stops, thresholds, slopes],
  )

  const routes = useMemo<MapRoute[]>(() => {
    const others = vehicles.filter((v) => v !== vehicleA && v !== vehicleB)
    return [
      ...others.map((vehicle) => ({ vehicle, color: VEHICLE_COLORS.other, width: 2 })),
      ...(vehicleA ? [{ vehicle: vehicleA, color: VEHICLE_COLORS.a, width: 7 }] : []),
      ...(vehicleB ? [{ vehicle: vehicleB, color: VEHICLE_COLORS.b, width: 2.5 }] : []),
    ]
  }, [vehicles, vehicleA, vehicleB])
  const peaks = useMemo(() => pair?.peaks ?? [], [pair])
  const eventDots = useMemo<MapDot[]>(
    () =>
      analyzed.flatMap((v) =>
        alertPoints(v).map((p) => ({
          lon: p.lon,
          lat: p.lat,
          color: EVENT_COLOR,
          text: `${v.plate}, ${fmtTime(p.t)}: ${p.event}`,
        })),
      ),
    [analyzed],
  )
  const eventTypes = useMemo(() => [...new Set(analyzed.flatMap((v) => alertPoints(v).map((p) => p.event)))], [analyzed])

  const separation = useMemo(() => (pair ? separationOption(pair, thresholds) : null), [pair, thresholds])
  const speed = useMemo(
    () => speedOption(analyzed.map((vehicle) => ({ vehicle, color: colorOf(vehicle.plate) })), thresholds),
    [analyzed, colorOf, thresholds],
  )

  const hasEvents = summaries.some((s) => s.events.length > 0)

  const onElevation = useCallback(async () => {
    setElevation((prev) => ({ ...prev, status: 'loading', error: null }))
    try {
      const profiles = new Map<string, ElevationProfile>()
      for (const s of speeding) {
        const vehicle = analyzed.find((v) => v.plate === s.plate)
        if (vehicle) profiles.set(s.plate, await fetchProfile(vehicle, s.cumKm))
      }
      setElevation({ status: 'ready', error: null, profiles })
    } catch (e) {
      setElevation({
        status: 'error',
        error: e instanceof ElevationError ? e.message : 'No se pudo obtener la altitud. Vuelve a intentarlo.',
        profiles: new Map(),
      })
    }
  }, [analyzed, speeding])

  const onPair = (next: [string, string]) => {
    setPairPlates(next)
    // Los perfiles de altitud son de las unidades anteriores.
    setElevation(NO_ELEVATION)
  }

  const onExport = () => {
    try {
      const speedingImages = speedingSection.current?.getImages() ?? { maps: [], elevation: [] }
      const omitted = exportPdf({
        meta,
        fileName,
        summaries,
        pair,
        thresholds,
        findings,
        speeding,
        grades,
        vehicles: analyzed,
        stops: stops.all,
        stopSummaries: stops.byVehicle,
        company: { name: company.name.trim(), logo: company.logo },
        images: {
          separation: separationChart.current?.getImage() ?? null,
          map: routeMap.current?.getImage() ?? null,
          speed: speedChart.current?.getImage() ?? null,
          stopsMap: stopsMap.current?.getImage() ?? null,
          speedMaps: speedingImages.maps,
          elevation: speedingImages.elevation,
        },
      })
      setStatus(
        omitted.length > 0
          ? { kind: 'error', text: `Reporte exportado, pero no se pudo incluir ${omitted.join(' ni ')}.` }
          : { kind: 'ok', text: 'Reporte exportado. Revisa tu carpeta de descargas.' },
      )
    } catch {
      setStatus({ kind: 'error', text: 'No se pudo generar el PDF. Vuelve a intentarlo.' })
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="brand">Reporte GPS</p>
          <p className="file">
            {fileName}
            {meta.from && meta.to && <span>Del {meta.from} al {meta.to}</span>}
          </p>
        </div>
        <div className="actions">
          {status && (
            <p className={status.kind === 'ok' ? 'notice' : 'error'} role="status">
              {status.text}
            </p>
          )}
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            Analizar otro archivo
          </button>
          <button type="button" className="btn btn-primary" onClick={onExport}>
            Exportar PDF
          </button>
        </div>
      </header>

      <div className="layout">
        <SettingsPanel
          plates={plates}
          pair={pairPlates}
          onPair={onPair}
          thresholds={thresholds}
          onThresholds={setThresholds}
          company={company}
          onCompany={setCompany}
        />

        <main className="sheet">
          {report.warnings.map((w) => (
            <p key={w} className="warning">
              {w}
            </p>
          ))}

          <section className="verdict">
            {pair ? (
              <h1>
                {pair.plateA} y {pair.plateB}{' '}
                {pair.deviation?.sameRoute ? 'siguieron la misma ruta' : 'no siguieron la misma ruta'}
              </h1>
            ) : (
              <h1>Recorrido de {vehicles[0].plate}</h1>
            )}
            {pair?.deviation && (
              <p className="lead">
                El 95% de las posiciones de una unidad quedó a menos de {fmtMeters(pair.deviation.p95M)} de la traza de
                la otra.
              </p>
            )}
            {!pair && (
              <p className="lead">El reporte tiene un solo vehículo, así que no hay convoy que comparar.</p>
            )}
            {findings.length > 0 && (
              <ul className="findings">
                {findings.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            )}
            {pair && (
              <>
                <ConvoyStrip pair={pair} thresholds={thresholds} />
                <dl className="stats">
                  <div>
                    <dt>Separación mediana</dt>
                    <dd>{fmtSeparation(pair.medianKm)}</dd>
                  </div>
                  <div>
                    <dt>Separación promedio</dt>
                    <dd>{fmtSeparation(pair.meanKm)}</dd>
                  </div>
                  <div>
                    <dt>Percentil 90</dt>
                    <dd>{fmtSeparation(pair.p90Km)}</dd>
                  </div>
                  <div>
                    <dt>Separación máxima</dt>
                    <dd>{fmtSeparation(pair.maxKm)}</dd>
                  </div>
                  <div>
                    <dt>Tiempo analizado</dt>
                    <dd>{fmtDuration(pair.movingMinutes * 60_000)}</dd>
                  </div>
                </dl>
              </>
            )}
          </section>

          <section>
            <h2>
              Resumen por vehículo <span>{vehicles.length} en el reporte</span>
            </h2>
            <SummaryTable summaries={summaries} colorOf={colorOf} speedLimit={thresholds.speedLimitKmh} />
          </section>

          <section>
            <h2>Recorrido</h2>
            <RouteMap ref={routeMap} routes={routes} peaks={peaks} dots={eventDots} />
            <ul className="map-legend">
              {vehicleA && (
                <li>
                  <i className="key-line" style={{ background: VEHICLE_COLORS.a }} />
                  {vehicleA.plate}
                </li>
              )}
              {vehicleB && (
                <li>
                  <i className="key-line" style={{ background: VEHICLE_COLORS.b }} />
                  {vehicleB.plate}
                </li>
              )}
              <li>
                <i className="key-ring" />
                Inicio
              </li>
              <li>
                <i className="key-disc" />
                Fin
              </li>
              {peaks.length > 0 && (
                <li>
                  <i className="peak-badge">1</i>
                  Punto de mayor separación
                </li>
              )}
              {eventTypes.map((type) => (
                <li key={type}>
                  <i className="key-dot" style={{ background: EVENT_COLOR }} />
                  Evento: {type}
                </li>
              ))}
            </ul>
          </section>

          {pair && separation && (
            <section>
              <h2>Separación entre unidades</h2>
              <p className="hint">
                Distancia en línea recta, minuto a minuto. La franja verde es la banda de convoy. Mantén Ctrl y gira la
                rueda para acercar.
              </p>
              <EChart ref={separationChart} option={separation} height={340} label="Separación entre unidades en el tiempo" />
            </section>
          )}

          {pair && (
            <section>
              <h2>Puntos de mayor separación</h2>
              {pair.peaks.length > 0 ? (
                <PeaksTable pair={pair} />
              ) : (
                <p className="hint">
                  La separación nunca superó la distancia de alerta de {fmtMeters(thresholds.alertM)}.
                </p>
              )}
            </section>
          )}

          <StopsSection
            mapRef={stopsMap}
            vehicles={analyzed}
            summaries={stops.byVehicle}
            stops={stops.all}
            colorOf={colorOf}
            minStopMin={thresholds.minStopMin}
          />

          <section>
            <h2>Velocidad</h2>
            <EChart ref={speedChart} option={speed} height={300} label="Velocidad de cada unidad en el tiempo" />
          </section>

          <SpeedingSection
            ref={speedingSection}
            vehicles={analyzed}
            speeding={speeding}
            colorOf={colorOf}
            thresholds={thresholds}
            elevation={elevation}
            grades={grades}
            onElevation={onElevation}
          />

          {hasEvents && (
            <section>
              <h2>Eventos registrados</h2>
              <EventsTable summaries={summaries} />
            </section>
          )}

          <section className="method">
            <h2>Cómo leer estos resultados</h2>
            <p>
              El equipo GPS reporta una posición cada varias decenas de segundos, así que la separación en movimiento
              tiene un margen de error de cientos de metros: sirve para detectar que el convoy se abrió, no para auditar
              distancias cortas. Los tramos con más de 15 minutos sin señal de alguna unidad se muestran como «Sin
              dato».
            </p>
            <p>
              La duración de un exceso de velocidad es el tiempo entre su primer y su último registro sobre el límite.
              Un exceso de un solo registro no tiene duración conocida. La clasificación por duración indica si un
              exceso es compatible con un adelantamiento, no que lo haya sido.
            </p>
          </section>
        </main>
      </div>
    </div>
  )
}
