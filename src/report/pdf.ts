import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { CapturedImage } from '../components/EChart.tsx'
import {
  fmtDateTime,
  fmtDuration,
  fmtGrade,
  fmtKm,
  fmtMeters,
  fmtNumber,
  fmtPercent,
  fmtSeparation,
  fmtShortDuration,
  fmtTime,
} from '../lib/format.ts'
import { alertPoints } from '../lib/analysis.ts'
import { FLAT_GRADE_PCT, slopeOf } from '../lib/elevation.ts'
import {
  EPISODE_KINDS,
  EPISODE_PREVIEW,
  KIND_COLORS,
  KIND_SHORT,
  drivingWindow,
  kindLabel,
  speedBands,
  type Episode,
  type SpeedingSummary,
} from '../lib/speeding.ts'
import { MOVING_STATES, STATE_COLORS, STATE_ORDER, stateLabel, stateRuns } from '../lib/states.ts'
import { OTHER_LABEL, type Stop, type StopSummary } from '../lib/stops.ts'
import type { PairAnalysis, ReportMeta, Thresholds, Vehicle, VehicleSummary } from '../lib/types.ts'

type PlateImage = { plate: string; image: CapturedImage | null }
const EVENT_RGB: [number, number, number] = [122, 79, 214]
const STOP_RGB: [number, number, number] = [68, 84, 111]

export interface ReportInput {
  meta: ReportMeta
  fileName: string
  summaries: VehicleSummary[]
  pair: PairAnalysis | null
  thresholds: Thresholds
  company: { name: string; logo: CapturedImage | null }
  findings: string[]
  /** Unidades con análisis de velocidad, en el mismo orden que `speeding`. */
  vehicles: Vehicle[]
  speeding: SpeedingSummary[]
  /** Pendiente media de cada episodio; null si no se consultó la altitud. */
  grades: Map<Episode, number> | null
  /** Paradas en orden cronológico, con su lugar numerado. */
  stops: Stop[]
  stopSummaries: StopSummary[]
  images: {
    stopsMap: CapturedImage | null
    separation: CapturedImage | null
    map: CapturedImage | null
    speed: CapturedImage | null
    speedMaps: PlateImage[]
    elevation: PlateImage[]
  }
}

const MARGIN = 14
const PAGE_W = 210
const PAGE_H = 297
const CONTENT_W = PAGE_W - MARGIN * 2
const INK: [number, number, number] = [22, 35, 59]
const INK_2: [number, number, number] = [74, 88, 114]
const MUTED: [number, number, number] = [126, 138, 160]
const LINE: [number, number, number] = [221, 227, 236]
const ACCENT: [number, number, number] = [31, 95, 209]

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

const tableStyle = {
  theme: 'plain' as const,
  margin: { left: MARGIN, right: MARGIN },
  styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: 1.8, lineColor: LINE, lineWidth: { bottom: 0.2 } },
  headStyles: { fillColor: [240, 243, 248] as [number, number, number], textColor: INK_2, fontStyle: 'bold' as const },
}

export function exportPdf(input: ReportInput): string[] {
  const { meta, summaries, pair, thresholds: th, company, images, findings, speeding, grades, vehicles, stops, stopSummaries } = input
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const omitted: string[] = []
  let y = MARGIN

  const ensure = (height: number) => {
    if (y + height > PAGE_H - MARGIN - 8) {
      doc.addPage()
      y = MARGIN
    }
  }
  const afterTable = () => {
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  }
  const heading = (text: string) => {
    ensure(16)
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK)
    doc.text(text, MARGIN, y + 4)
    y += 8
  }
  const paragraph = (text: string, color = INK_2, size = 9) => {
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...color)
    const lines = doc.splitTextToSize(text, CONTENT_W) as string[]
    ensure(lines.length * size * 0.42 + 2)
    doc.text(lines, MARGIN, y + 3)
    y += lines.length * size * 0.42 + 3
  }
  /** Título e imagen van juntos: un título suelto al pie de la página no sirve. */
  const figure = (title: string, img: CapturedImage | null, name: string) => {
    if (!img) {
      heading(title)
      omitted.push(name)
      paragraph(`No se pudo incluir ${name} en este reporte.`, MUTED)
      return
    }
    const height = Math.min((CONTENT_W * img.height) / img.width, 120)
    const width = (height * img.width) / img.height
    ensure(height + 14)
    heading(title)
    const format = img.url.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG'
    doc.addImage(img.url, format, MARGIN, y, width, height, undefined, 'FAST')
    doc.setDrawColor(...LINE).setLineWidth(0.2).rect(MARGIN, y, width, height)
    y += height + 6
  }

  // Encabezado
  let textX = MARGIN
  if (company.logo) {
    const h = Math.min(16, (42 * company.logo.height) / company.logo.width)
    const w = (h * company.logo.width) / company.logo.height
    doc.addImage(company.logo.url, 'PNG', MARGIN, y, w, h)
    textX = MARGIN + w + 6
  }
  if (company.name) {
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK_2)
    doc.text(company.name, textX, y + 4)
  }
  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...INK)
  doc.text('Reporte de recorrido GPS y convoy', textX, y + (company.name ? 12 : 8))
  y += 20
  doc.setDrawColor(...ACCENT).setLineWidth(0.8).line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 6

  const period = meta.from && meta.to ? `${meta.from} a ${meta.to}` : 'No indicado en el archivo'
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    styles: { ...tableStyle.styles, lineWidth: 0 },
    columnStyles: { 0: { textColor: MUTED, cellWidth: 38 } },
    body: [
      ['Periodo analizado', period],
      ['Archivo de origen', input.fileName],
      ['Vehículos en el reporte', summaries.map((s) => s.plate).join(', ')],
      ['Reporte generado', fmtDateTime(Date.now() - new Date().getTimezoneOffset() * 60_000)],
    ],
  })
  afterTable()

  if (findings.length > 0) {
    heading('Hallazgos principales')
    for (const text of findings) {
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK)
      const lines = doc.splitTextToSize(text, CONTENT_W - 5) as string[]
      ensure(lines.length * 4.2 + 2)
      doc.setFillColor(...ACCENT).circle(MARGIN + 1, y + 2, 0.7, 'F')
      doc.text(lines, MARGIN + 5, y + 3)
      y += lines.length * 4.2 + 2
    }
    y += 4
  }

  heading('Resumen por vehículo')
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    styles: { ...tableStyle.styles, fontSize: 8 },
    // Las columnas cortas no se parten en dos líneas; el ancho sobrante va a las fechas y al exceso.
    columnStyles: Object.fromEntries([0, 3, 4, 5, 6, 7].map((i) => [i, { cellWidth: 'wrap' as const }])),
    head: [['Vehículo', 'Inicio', 'Fin', 'Recorrido', 'En movimiento', 'Detenido', 'Vel. máx.', 'Vel. prom.', 'Exceso de velocidad']],
    body: summaries.map((s) => [
      s.plate,
      fmtDateTime(s.startT),
      fmtDateTime(s.endT),
      fmtKm(s.gpsKm),
      fmtDuration(s.movingMs),
      fmtDuration(s.stoppedMs),
      `${fmtNumber(s.maxSpeed)} km/h`,
      `${fmtNumber(s.avgMovingSpeed)} km/h`,
      s.speedingPoints > 0 ? `${fmtDuration(s.speedingMs)} (${s.speedingPoints} registros)` : 'Sin excesos',
    ]),
  })
  afterTable()
  paragraph(
    `Recorrido calculado con las posiciones GPS. Exceso de velocidad: registros por encima de ${fmtNumber(th.speedLimitKmh)} km/h.`,
    MUTED,
    8,
  )
  y += 2

  if (pair) {
    heading(`Convoy ${pair.plateA} y ${pair.plateB}`)
    if (pair.deviation) {
      paragraph(
        pair.deviation.sameRoute
          ? `Ambas unidades siguieron la misma ruta: el 95% de las posiciones de una quedó a menos de ${fmtMeters(pair.deviation.p95M)} de la traza de la otra.`
          : `Las unidades no siguieron la misma ruta: el desvío entre trazas llegó a ${fmtMeters(pair.deviation.maxM)}.`,
        INK,
      )
    }
    paragraph(
      `Banda de convoy: de ${fmtMeters(th.bandMinM)} a ${fmtMeters(th.bandMaxM)}. Alerta: más de ${fmtMeters(th.alertM)}. Crítico: más de ${fmtMeters(th.criticalM)}.`,
    )
    y += 1

    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Separación mediana', 'Separación promedio', 'Percentil 90', 'Separación máxima', 'Tiempo analizado']],
      body: [
        [
          fmtSeparation(pair.medianKm),
          fmtSeparation(pair.meanKm),
          fmtSeparation(pair.p90Km),
          fmtSeparation(pair.maxKm),
          fmtDuration(pair.movingMinutes * 60_000),
        ],
      ],
    })
    afterTable()

    // Tira de convoy: el estado minuto a minuto a lo largo del periodo.
    const runs = stateRuns(pair.samples)
    const total = pair.samples.length
    if (total > 0) {
      ensure(34)
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK_2)
      doc.text('Estado del convoy a lo largo del periodo', MARGIN, y + 3)
      y += 5
      let x = MARGIN
      for (const run of runs) {
        const w = (run.count / total) * CONTENT_W
        doc.setFillColor(...rgb(STATE_COLORS[run.state])).rect(x, y, w, 7, 'F')
        x += w
      }
      doc.setDrawColor(...LINE).setLineWidth(0.2).rect(MARGIN, y, CONTENT_W, 7)
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
      doc.text(fmtTime(pair.samples[0].t), MARGIN, y + 10.5)
      doc.text(fmtTime(pair.samples[total - 1].t), PAGE_W - MARGIN, y + 10.5, { align: 'right' })
      y += 14
      let col = 0
      for (const state of STATE_ORDER) {
        const lx = MARGIN + (col % 2) * (CONTENT_W / 2)
        doc.setFillColor(...rgb(STATE_COLORS[state])).setDrawColor(...LINE).rect(lx, y - 2.4, 3, 3, 'FD')
        const share = MOVING_STATES.includes(state) ? `: ${fmtPercent(pair.share[state])}` : ''
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK)
        doc.text(`${stateLabel(state, th)}${share}`, lx + 5, y)
        if (col % 2 === 1) y += 4.6
        col++
      }
      y += col % 2 === 1 ? 8 : 4
      paragraph('Los porcentajes se calculan sobre el tiempo con al menos una unidad en movimiento.', MUTED, 8)
    }

    figure('Separación entre unidades', images.separation, 'el gráfico de separación')
  }

  figure('Recorrido', images.map, 'el mapa de recorrido')
  if (pair) {
    paragraph(
      `Azul: ${pair.plateA}. Naranja: ${pair.plateB}. Aro: inicio. Disco: fin. Los números señalan los puntos de mayor separación.` +
        (vehicles.some((v) => alertPoints(v).length > 0) ? ' Los puntos violetas son eventos registrados por el equipo GPS.' : ''),
      MUTED,
      8,
    )
  }

  if (pair) {
    heading('Puntos de mayor separación')
    if (pair.peaks.length === 0) {
      paragraph(`La separación nunca superó la distancia de alerta de ${fmtMeters(th.alertM)}.`)
    } else {
      autoTable(doc, {
        ...tableStyle,
        startY: y,
        head: [['N.º', 'Hora', 'Separación', `${pair.plateA}`, `${pair.plateB}`]],
        body: pair.peaks.map((p, i) => [
          String(i + 1),
          fmtDateTime(p.t),
          fmtSeparation(p.km),
          `${p.refA || 'Sin referencia'} (${fmtNumber(p.speedA)} km/h)`,
          `${p.refB || 'Sin referencia'} (${fmtNumber(p.speedB)} km/h)`,
        ]),
      })
      afterTable()
    }
  }

  const minStop = `${fmtNumber(th.minStopMin)} min`
  heading(`Paradas en ruta de ${minStop} o más`)
  paragraph(
    'Detenciones entre la salida y la llegada. No se cuenta el tiempo estacionado antes de salir ni después de llegar. El reporte indica dónde y cuánto se detuvo cada unidad, no el motivo.',
    MUTED,
    8,
  )
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [['Vehículo', 'Salida', 'Llegada', 'Paradas', 'Tiempo detenido en ruta', 'Parada más larga']],
    body: stopSummaries.map((s) => [
      s.plate,
      s.departureT === null ? 'No se movió' : fmtDateTime(s.departureT),
      s.arrivalT === null ? '' : fmtDateTime(s.arrivalT),
      String(s.stops.length),
      fmtDuration(s.totalMs),
      s.longest ? `${fmtDuration(s.longest.durationMs)} a las ${fmtTime(s.longest.startT)}` : 'Sin paradas prolongadas',
    ]),
  })
  afterTable()

  if (stops.length > 0) {
    const span = drivingWindow(vehicles)
    if (span) {
      const [from, to] = span
      const labelW = 20
      const trackW = CONTENT_W - labelW
      ensure(stopSummaries.length * 8 + 10)
      for (const s of stopSummaries) {
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK)
        doc.text(s.plate, MARGIN, y + 3.8)
        doc.setFillColor(240, 243, 248).rect(MARGIN + labelW, y, trackW, 6, 'F')
        for (const stop of s.stops) {
          const x = MARGIN + labelW + ((stop.startT - from) / (to - from)) * trackW
          const w = Math.max(0.6, (stop.durationMs / (to - from)) * trackW)
          doc.setFillColor(...STOP_RGB).rect(x, y, w, 6, 'F')
          if (w >= 3) {
            doc.setFontSize(7.5).setTextColor(255, 255, 255)
            doc.text(String(stop.place), x + w / 2, y + 4.1, { align: 'center' })
          }
        }
        y += 8
      }
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
      doc.text(fmtTime(from), MARGIN + labelW, y + 1)
      doc.text(fmtTime(to), PAGE_W - MARGIN, y + 1, { align: 'right' })
      y += 7
    }

    figure('Dónde pararon', images.stopsMap, 'el mapa de paradas')
    paragraph(
      'Cada número es un lugar de parada, en orden cronológico. Marcador oscuro: pararon las dos unidades. Marcador del color de una unidad: paró solo esa unidad.',
      MUTED,
      8,
    )
    y += 1

    heading(`Detalle de paradas: ${stops.length} en total`)
    const paired = stopSummaries.length === 2
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      columnStyles: Object.fromEntries([0, 1, 2, 3, 4].map((i) => [i, { cellWidth: 'wrap' as const }])),
      head: [['Lugar', 'Vehículo', 'Desde', 'Hasta', 'Duración', ...(paired ? ['La otra unidad'] : []), 'Dónde']],
      body: stops.map((stop) => [
        String(stop.place),
        stop.plate,
        fmtDateTime(stop.startT),
        fmtTime(stop.endT),
        fmtDuration(stop.durationMs),
        ...(paired ? [stop.other ? OTHER_LABEL[stop.other] : ''] : []),
        stop.ref || 'Sin referencia',
      ]),
    })
    afterTable()
  }

  figure('Velocidad', images.speed, 'el gráfico de velocidad')

  const episodes = speeding.flatMap((s) => s.episodes).sort((a, b) => b.durationMs - a.durationMs || b.maxSpeed - a.maxSpeed)
  if (episodes.length > 0) {
    const limit = `${fmtNumber(th.speedLimitKmh)} km/h`
    heading(`Excesos de velocidad sobre ${limit}`)
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Vehículo', 'Episodios', ...EPISODE_KINDS.map((k) => KIND_SHORT[k]), 'Distancia en exceso', 'Parte del recorrido', 'Exceso más largo']],
      body: speeding.map((s) => [
        s.plate,
        String(s.episodes.length),
        ...EPISODE_KINDS.map((k) => String(s.byKind[k])),
        fmtKm(s.kmOver),
        fmtPercent((s.kmOver / (s.routeKm || 1)) * 100),
        s.longest && s.longest.records > 1
          ? `${fmtShortDuration(s.longest.durationMs)} a las ${fmtTime(s.longest.startT)}`
          : 'Solo registros sueltos',
      ]),
    })
    afterTable()
    paragraph(
      `${EPISODE_KINDS.map((k) => kindLabel(k, th)).join('. ')}. Un exceso breve es compatible con un adelantamiento; uno prolongado no. El archivo no indica el motivo: la clasificación es por duración.`,
      MUTED,
      8,
    )
    y += 2

    const LABEL_W = 20
    const TRACK_W = CONTENT_W - LABEL_W
    const legend = (items: { color: [number, number, number]; text: string }[]) => {
      ensure(8)
      let x = MARGIN
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK)
      for (const item of items) {
        const w = doc.getTextWidth(item.text) + 9
        if (x + w > PAGE_W - MARGIN) {
          x = MARGIN
          y += 4.6
        }
        doc.setFillColor(...item.color).rect(x, y - 2.4, 3, 3, 'F')
        doc.text(item.text, x + 4.5, y)
        x += w
      }
      y += 7
    }

    // Línea de tiempo: cada exceso como una barra del ancho que duró.
    const window = drivingWindow(vehicles)
    if (window) {
      const [from, to] = window
      const xAt = (t: number) => MARGIN + LABEL_W + ((t - from) / (to - from)) * TRACK_W
      ensure(speeding.length * 11 + 22)
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK_2)
      doc.text('Cuándo ocurrieron', MARGIN, y + 3)
      y += 6
      const eventTypes = new Set<string>()
      speeding.forEach((s, i) => {
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK)
        doc.text(s.plate, MARGIN, y + 3.6)
        doc.setFillColor(240, 243, 248).rect(MARGIN + LABEL_W, y, TRACK_W, 5.5, 'F')
        for (const e of s.episodes) {
          const w = Math.max(0.45, (e.durationMs / (to - from)) * TRACK_W)
          doc.setFillColor(...rgb(KIND_COLORS[e.kind])).rect(xAt(e.startT), y, w, 5.5, 'F')
        }
        y += 6.3
        for (const p of alertPoints(vehicles[i])) {
          eventTypes.add(p.event)
          doc.setFillColor(...EVENT_RGB).rect(xAt(p.t), y, 0.35, 1.8, 'F')
        }
        y += 4
      })
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
      doc.text(fmtTime(from), MARGIN + LABEL_W, y + 1)
      doc.text(fmtTime(to), PAGE_W - MARGIN, y + 1, { align: 'right' })
      y += 6
      legend([
        ...EPISODE_KINDS.map((k) => ({ color: rgb(KIND_COLORS[k]), text: KIND_SHORT[k] })),
        ...[...eventTypes].map((type) => ({ color: EVENT_RGB, text: `Evento: ${type}` })),
      ])
    }

    // Distribución: parte del tiempo en movimiento en cada rango de velocidad.
    const bands = speedBands(th.speedLimitKmh)
    ensure(speeding.length * 9 + 20)
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK_2)
    doc.text('A qué velocidad se condujo (porcentaje del tiempo en movimiento)', MARGIN, y + 3)
    y += 6
    for (const s of speeding) {
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK)
      doc.text(s.plate, MARGIN, y + 4)
      let x = MARGIN + LABEL_W
      bands.forEach((band, i) => {
        const w = (s.bandShare[i] / 100) * TRACK_W
        if (w <= 0) return
        doc.setFillColor(...rgb(band.color)).rect(x, y, Math.max(0.2, w - 0.5), 6, 'F')
        if (s.bandShare[i] >= 7) {
          doc.setFontSize(7.5).setTextColor(...(i >= 3 ? ([255, 255, 255] as [number, number, number]) : INK))
          doc.text(fmtPercent(s.bandShare[i]), x + 1.5, y + 4.1)
        }
        x += w
      })
      y += 8.5
    }
    y += 2
    legend(bands.map((band) => ({ color: rgb(band.color), text: band.label })))
    // Los porcentajes exactos: en la barra solo caben los de los rangos anchos.
    autoTable(doc, {
      ...tableStyle,
      startY: y - 2,
      head: [['Vehículo', ...bands.map((band) => band.label)]],
      body: speeding.map((s) => [s.plate, ...s.bandShare.map((share) => fmtPercent(share))]),
    })
    afterTable()

    // Mapas de excesos, uno por unidad, lado a lado.
    const maps = images.speedMaps.filter((m): m is { plate: string; image: CapturedImage } => m.image !== null)
    if (maps.length < images.speedMaps.length) omitted.push('algún mapa de excesos')
    if (maps.length > 0) {
      const gap = 4
      const w = (CONTENT_W - gap * (maps.length - 1)) / maps.length
      const h = Math.min(...maps.map((m) => (w * m.image.height) / m.image.width), 110)
      ensure(h + 16)
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK_2)
      doc.text('Dónde ocurrieron', MARGIN, y + 3)
      y += 6
      maps.forEach((m, i) => {
        const x = MARGIN + i * (w + gap)
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK)
        doc.text(m.plate, x, y + 2.5)
        doc.addImage(m.image.url, 'JPEG', x, y + 4, w, h, undefined, 'FAST')
        doc.setDrawColor(...LINE).setLineWidth(0.2).rect(x, y + 4, w, h)
      })
      y += h + 9
      legend([
        { color: [180, 191, 207], text: 'Dentro del límite' },
        ...bands.slice(2).map((band) => ({ color: rgb(band.color), text: band.label })),
      ])
    }

    for (const chart of images.elevation) {
      figure(`Perfil de altitud y excesos de ${chart.plate}`, chart.image, `el perfil de altitud de ${chart.plate}`)
    }
    if (images.elevation.length > 0) {
      paragraph(
        `Las franjas marcan los excesos de más de un registro. Se considera bajada o subida una pendiente media de ${FLAT_GRADE_PCT}% o más. Altitud obtenida de Open-Meteo.`,
        MUTED,
        8,
      )
    }

    heading(
      episodes.length > EPISODE_PREVIEW
        ? `Los ${EPISODE_PREVIEW} excesos más largos, de ${episodes.length} en total`
        : `Detalle de excesos: ${episodes.length} en total`,
    )
    const hasPair = speeding.length === 2
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      styles: { ...tableStyle.styles, fontSize: 8 },
      columnStyles: Object.fromEntries([0, 2, 3, 4, 5].map((i) => [i, { cellWidth: 'wrap' as const }])),
      head: [[
        'Vehículo', 'Inicio', 'Duración', 'Vel. máx.', 'Distancia', 'Tipo',
        ...(hasPair ? ['La otra unidad'] : []),
        ...(grades ? ['Pendiente'] : []),
        'Lugar',
      ]],
      body: episodes.slice(0, EPISODE_PREVIEW).map((e) => {
        const grade = grades?.get(e)
        return [
          e.plate,
          fmtDateTime(e.startT),
          e.records === 1 ? 'Un registro' : fmtShortDuration(e.durationMs),
          `${fmtNumber(e.maxSpeed)} km/h`,
          e.records === 1 ? '' : fmtKm(e.km),
          KIND_SHORT[e.kind],
          ...(hasPair ? [e.withOther ? 'También en exceso' : 'Dentro del límite'] : []),
          ...(grades ? [grade === undefined ? 'Sin dato' : `${slopeOf(grade)} (${fmtGrade(grade)})`] : []),
          e.ref || 'Sin referencia',
        ]
      }),
    })
    afterTable()
  }

  const events = summaries.flatMap((s) => s.events.map((e) => ({ plate: s.plate, ...e })))
  if (events.length > 0) {
    // Tabla corta: mejor entera en la página siguiente que partida en dos.
    ensure(20 + events.length * 8)
    heading('Eventos registrados')
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Vehículo', 'Evento', 'Cantidad', 'Primero', 'Último', 'Lugar del primero']],
      body: events.map((e) => [
        e.plate,
        e.type,
        String(e.count),
        fmtDateTime(e.firstT),
        fmtDateTime(e.lastT),
        e.firstRef || 'Sin referencia',
      ]),
    })
    afterTable()
  }

  heading('Cómo leer este reporte')
  paragraph(
    'La separación es la distancia en línea recta entre las dos unidades, calculada cada minuto interpolando entre posiciones GPS consecutivas. ' +
      'Como el equipo GPS reporta una posición cada varias decenas de segundos, la separación en movimiento tiene un margen de error de cientos de metros: ' +
      'sirve para detectar que el convoy se abrió, no para auditar distancias cortas. ' +
      'Los tramos con más de 15 minutos sin señal de alguna unidad se informan como "Sin dato". ' +
      'La duración de un exceso de velocidad es el tiempo entre su primer y su último registro sobre el límite; un exceso de un solo registro no tiene duración conocida.',
  )

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
    doc.text(`Página ${i} de ${pages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' })
    if (company.name) doc.text(company.name, MARGIN, PAGE_H - 8)
  }

  doc.save(`reporte-gps-${input.fileName.replace(/\.[^.]+$/, '').slice(0, 60)}.pdf`)
  return omitted
}
