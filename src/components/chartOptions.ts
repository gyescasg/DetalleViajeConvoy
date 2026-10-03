import type { EChartsCoreOption } from 'echarts/core'
import { escapeHtml, fmtDateTime, fmtMeters, fmtNumber, fmtSeparation } from '../lib/format.ts'
import { STATE_COLORS, STATE_SHORT, VEHICLE_COLORS } from '../lib/states.ts'
import type { ElevationProfile } from '../lib/elevation.ts'
import { KIND_COLORS, KIND_SHORT, type SpeedingSummary } from '../lib/speeding.ts'
import type { PairAnalysis, Sample, Thresholds, Vehicle } from '../lib/types.ts'

const INK = '#16233b'
const INK_2 = '#4a5872'
const MUTED = '#7e8aa0'
const GRID = '#e6eaf0'
const AXIS = '#c5cdd9'
const FONT = 'Barlow, "Segoe UI", system-ui, sans-serif'
/** Hueco entre posiciones a partir del cual la línea se corta en lugar de unir los extremos. */
const GAP_MS = 15 * 60_000

const base = {
  // Las marcas de tiempo guardan la hora de reloj del reporte como UTC.
  useUTC: true,
  animation: false,
  textStyle: { fontFamily: FONT, color: INK_2 },
}

const timeAxis = {
  type: 'time',
  axisLine: { lineStyle: { color: AXIS } },
  axisTick: { lineStyle: { color: AXIS } },
  axisLabel: { color: MUTED, fontSize: 12, hideOverlap: true },
  splitLine: { show: false },
}

const valueAxis = (name: string) => ({
  type: 'value',
  name,
  nameLocation: 'end',
  nameGap: 14,
  nameTextStyle: { color: MUTED, fontSize: 12, align: 'left', padding: [0, 0, 0, -34] },
  axisLabel: { color: MUTED, fontSize: 12, formatter: (v: number) => fmtNumber(v, v % 1 === 0 ? 0 : 1) },
  splitLine: { lineStyle: { color: GRID } },
})

const tooltipBase = {
  trigger: 'axis',
  backgroundColor: '#ffffff',
  borderColor: '#dde3ec',
  borderWidth: 1,
  padding: [10, 12],
  textStyle: { fontFamily: FONT, color: INK, fontSize: 13 },
  axisPointer: { type: 'line', lineStyle: { color: AXIS, width: 1 } },
  extraCssText: 'box-shadow: 0 6px 20px rgba(22, 35, 59, 0.10); border-radius: 8px;',
}

const zoom = [{ type: 'inside', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: true, moveOnMouseWheel: false }]

const thresholdLine = (meters: number, name: string, color: string, position: string) => ({
  yAxis: meters / 1000,
  lineStyle: { color, width: 1, type: 'solid' },
  label: {
    formatter: `${name} ${fmtMeters(meters)}`,
    position,
    color: INK_2,
    fontSize: 12,
    fontFamily: FONT,
  },
})

export function separationOption(pair: PairAnalysis, th: Thresholds): EChartsCoreOption {
  const byTime = new Map<number, Sample>(pair.samples.map((s) => [s.t, s]))
  return {
    ...base,
    grid: { left: 44, right: 22, top: 38, bottom: 30 },
    xAxis: timeAxis,
    yAxis: valueAxis('Separación (km)'),
    dataZoom: zoom,
    tooltip: {
      ...tooltipBase,
      formatter: (params: { value: [number, number | null] }[]) => {
        const sample = byTime.get(params[0].value[0])
        if (!sample) return ''
        const speed = (v: number | null) => (v === null ? 'sin dato' : `${fmtNumber(v)} km/h`)
        const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${STATE_COLORS[sample.state]};border:1px solid rgba(22,35,59,.18)"></span>`
        return [
          `<div style="color:${MUTED};font-size:12px">${fmtDateTime(sample.t)}</div>`,
          `<div style="font-size:16px;font-weight:600;margin:2px 0 4px">${fmtSeparation(sample.km)}</div>`,
          `<div>${dot}${STATE_SHORT[sample.state]}</div>`,
          `<div style="color:${INK_2};margin-top:4px">${escapeHtml(pair.plateA)}: ${speed(sample.speedA)}<br>${escapeHtml(pair.plateB)}: ${speed(sample.speedB)}</div>`,
        ].join('')
      },
    },
    series: [
      {
        type: 'line',
        name: 'Separación',
        data: pair.samples.map((s) => [s.t, s.km]),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: VEHICLE_COLORS.a, width: 2, join: 'round', cap: 'round' },
        itemStyle: { color: VEHICLE_COLORS.a },
        areaStyle: { color: VEHICLE_COLORS.a, opacity: 0.1 },
        markArea: {
          silent: true,
          itemStyle: { color: STATE_COLORS.enBanda, opacity: 0.22 },
          data: [[{ yAxis: th.bandMinM / 1000 }, { yAxis: th.bandMaxM / 1000 }]],
        },
        markLine: {
          silent: true,
          symbol: 'none',
          // Una etiqueta a cada lado: con escalas grandes las dos líneas quedan casi juntas.
          data: [
            thresholdLine(th.alertM, 'Alerta', STATE_COLORS.alerta, 'insideStartTop'),
            thresholdLine(th.criticalM, 'Crítico', STATE_COLORS.critico, 'insideEndTop'),
          ],
        },
        // Solo se rotulan los tres picos mayores: un número en cada punto no se leería.
        markPoint: {
          symbol: 'circle',
          symbolSize: 11,
          itemStyle: { color: INK, borderColor: '#ffffff', borderWidth: 2 },
          label: {
            position: 'top',
            distance: 6,
            color: INK,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: FONT,
            formatter: (p: { data: { km: number } }) => fmtSeparation(p.data.km),
          },
          data: pair.peaks.slice(0, 3).map((p) => ({ coord: [p.t, p.km], km: p.km })),
        },
      },
    ],
  }
}

/** Velocidad de cada unidad, cortando la línea donde no hubo señal. */
function speedSeries(vehicle: Vehicle): [number, number | null][] {
  const data: [number, number | null][] = []
  vehicle.points.forEach((p, i) => {
    const prev = vehicle.points[i - 1]
    if (prev && p.t - prev.t > GAP_MS) data.push([prev.t + 1, null])
    data.push([p.t, p.speed])
  })
  return data
}

export function speedOption(vehicles: { vehicle: Vehicle; color: string }[], th: Thresholds): EChartsCoreOption {
  return {
    ...base,
    grid: { left: 44, right: 22, top: vehicles.length > 1 ? 58 : 38, bottom: 30 },
    xAxis: timeAxis,
    yAxis: valueAxis('Velocidad (km/h)'),
    dataZoom: zoom,
    legend: {
      show: vehicles.length > 1,
      top: 0,
      left: 0,
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 3,
      textStyle: { color: INK_2, fontFamily: FONT, fontSize: 13 },
    },
    tooltip: { ...tooltipBase, valueFormatter: (v: number | null) => (v === null ? 'sin dato' : `${fmtNumber(v)} km/h`) },
    series: vehicles.map(({ vehicle, color }, i) => ({
      type: 'line',
      name: vehicle.plate,
      data: speedSeries(vehicle),
      showSymbol: false,
      connectNulls: false,
      sampling: 'lttb',
      lineStyle: { color, width: 2, join: 'round', cap: 'round' },
      itemStyle: { color },
      markLine:
        i === 0
          ? {
              silent: true,
              symbol: 'none',
              data: [
                {
                  yAxis: th.speedLimitKmh,
                  lineStyle: { color: STATE_COLORS.critico, width: 1, type: 'solid' },
                  label: {
                    formatter: `Límite ${fmtNumber(th.speedLimitKmh)} km/h`,
                    position: 'insideEndTop',
                    color: INK_2,
                    fontSize: 12,
                    fontFamily: FONT,
                  },
                },
              ],
            }
          : undefined,
    })),
  }
}

/**
 * Perfil de altitud sobre los kilómetros recorridos. Los excesos de más de un registro se marcan
 * como franjas; `maxMeters` fija la misma escala vertical para todas las unidades.
 */
export function elevationOption(profile: ElevationProfile, summary: SpeedingSummary, maxMeters: number): EChartsCoreOption {
  const SLATE = '#5d6f8c'
  return {
    ...base,
    grid: { left: 52, right: 22, top: 34, bottom: 44 },
    xAxis: {
      type: 'value',
      name: 'Kilómetro del recorrido',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: MUTED, fontSize: 12 },
      min: 0,
      max: Math.ceil(profile.km[profile.km.length - 1]),
      axisLine: { lineStyle: { color: AXIS } },
      axisTick: { lineStyle: { color: AXIS } },
      axisLabel: { color: MUTED, fontSize: 12, formatter: (v: number) => fmtNumber(v) },
      splitLine: { show: false },
    },
    yAxis: { ...valueAxis('Altitud (m)'), min: 0, max: Math.max(100, Math.ceil(maxMeters / 100) * 100) },
    tooltip: {
      ...tooltipBase,
      formatter: (params: { value: [number, number] }[]) => {
        const [km, meters] = params[0].value
        const episode = summary.episodes.find(
          (e) => e.records > 1 && km >= summary.cumKm[e.startIdx] && km <= summary.cumKm[e.endIdx],
        )
        return [
          `<div style="color:${MUTED};font-size:12px">Km ${fmtNumber(km, 1)}</div>`,
          `<div style="font-size:16px;font-weight:600;margin:2px 0 4px">${fmtNumber(meters)} m</div>`,
          episode
            ? `<div style="color:${INK_2}">Exceso ${KIND_SHORT[episode.kind].toLowerCase()}, máximo ${fmtNumber(episode.maxSpeed)} km/h</div>`
            : '',
        ].join('')
      },
    },
    series: [
      {
        type: 'line',
        name: 'Altitud',
        data: profile.km.map((km, i) => [km, profile.meters[i]]),
        showSymbol: false,
        lineStyle: { color: SLATE, width: 2, join: 'round', cap: 'round' },
        itemStyle: { color: SLATE },
        areaStyle: { color: SLATE, opacity: 0.1 },
        markArea: {
          silent: true,
          data: summary.episodes
            .filter((e) => e.records > 1)
            .map((e) => [
              { xAxis: summary.cumKm[e.startIdx], itemStyle: { color: KIND_COLORS[e.kind], opacity: 0.45 } },
              { xAxis: summary.cumKm[e.endIdx] },
            ]),
        },
      },
    ],
  }
}
