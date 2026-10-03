import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  LngLatBounds,
  Map as MapLibre,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection } from 'geojson'
import { fmtSeparation, fmtTime } from '../lib/format.ts'
import type { Peak, Vehicle } from '../lib/types.ts'
import type { ImageHandle } from './EChart.tsx'

// MapLibre busca su worker junto a su propio archivo; al empaquetar esa ruta cambia, así que se indica aquí.
setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const INK = '#16233b'

/** Fondo liso para cuando no hay internet: los recorridos se dibujan igual, sin calles. */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': '#eef1f5' } }],
}

/** El estilo del mapa base rotula en inglés; aquí se cambia a español, con el nombre local como respaldo. */
function inSpanish(style: StyleSpecification): StyleSpecification {
  for (const layer of style.layers) {
    if (layer.type !== 'symbol' || !layer.layout) continue
    // Los rótulos que no son nombres (número de ruta) se dejan como están.
    if (JSON.stringify(layer.layout['text-field'] ?? '').includes('name')) {
      layer.layout['text-field'] = ['coalesce', ['get', 'name:es'], ['get', 'name']]
    }
  }
  return style
}

export interface MapRoute {
  vehicle: Vehicle
  color: string
  /** Trazo ancho debajo y fino encima: así se ven ambas líneas cuando comparten la misma carretera. */
  width: number
}

/** Tramo resaltado sobre el recorrido, por ejemplo un exceso de velocidad. */
export interface MapSegment {
  coords: [number, number][]
  color: string
}

/** Punto suelto sobre el mapa, con un texto que aparece al pasar el cursor. */
export interface MapDot {
  lon: number
  lat: number
  color: string
  text: string
}

/** Marcador numerado, por ejemplo un lugar de parada. */
export interface MapMarker {
  lon: number
  lat: number
  n: number
  color: string
  text: string
}

interface Props {
  routes: MapRoute[]
  peaks?: Peak[]
  markers?: MapMarker[]
  segments?: MapSegment[]
  dots?: MapDot[]
  height?: number
  label?: string
  ref?: Ref<ImageHandle>
}

const NONE: never[] = []

const SOURCES = ['rutas', 'tramos', 'extremos', 'puntos', 'tramos-pico', 'picos', 'marcas'] as const

/** Marcador numerado dibujado en un lienzo: forma parte del mapa y por eso sale en el PDF. */
function peakIcon(n: number, color: string = INK): ImageData {
  const size = 52
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 24px Barlow, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(n), size / 2, size / 2 + 1)
  return ctx.getImageData(0, 0, size, size)
}

function draw(
  map: MapLibre,
  routes: MapRoute[],
  peaks: Peak[],
  segments: MapSegment[],
  dots: MapDot[],
  markers: MapMarker[],
) {
  const collection = (features: Feature[]): FeatureCollection => ({
    type: 'FeatureCollection',
    features,
  })

  const data: Record<(typeof SOURCES)[number], FeatureCollection> = {
    rutas: collection(
      routes.map((r) => ({
        type: 'Feature',
        properties: { color: r.color, width: r.width },
        geometry: { type: 'LineString', coordinates: r.vehicle.points.map((p) => [p.lon, p.lat]) },
      })),
    ),
    tramos: collection(
      segments.map((seg) => ({
        type: 'Feature',
        properties: { color: seg.color },
        geometry: { type: 'LineString', coordinates: seg.coords },
      })),
    ),
    puntos: collection(
      dots.map((d) => ({
        type: 'Feature',
        properties: { color: d.color, text: d.text },
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
      })),
    ),
    marcas: collection(
      markers.map((m) => ({
        type: 'Feature',
        properties: { icon: `marca-${m.color}-${m.n}`, text: m.text },
        geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
      })),
    ),
    extremos: collection(
      routes.flatMap((r) => {
        const pts = r.vehicle.points
        return [pts[0], pts[pts.length - 1]].map((p, i) => ({
          type: 'Feature' as const,
          properties: { color: r.color, end: i === 1 },
          geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        }))
      }),
    ),
    'tramos-pico': collection(
      peaks.map((p) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[p.lonA, p.latA], [p.lonB, p.latB]] },
      })),
    ),
    picos: collection(
      peaks.map((p, i) => ({
        type: 'Feature',
        properties: { icon: `pico-${i + 1}`, text: `Pico ${i + 1}: ${fmtSeparation(p.km)} a las ${fmtTime(p.t)}` },
        geometry: { type: 'Point', coordinates: [(p.lonA + p.lonB) / 2, (p.latA + p.latB) / 2] },
      })),
    ),
  }

  peaks.forEach((_, i) => {
    const id = `pico-${i + 1}`
    if (!map.hasImage(id)) map.addImage(id, peakIcon(i + 1), { pixelRatio: 2 })
  })
  for (const m of markers) {
    const id = `marca-${m.color}-${m.n}`
    if (!map.hasImage(id)) map.addImage(id, peakIcon(m.n, m.color), { pixelRatio: 2 })
  }

  if (map.getSource('rutas')) {
    for (const id of SOURCES) (map.getSource(id) as GeoJSONSource).setData(data[id])
  } else {
    for (const id of SOURCES) map.addSource(id, { type: 'geojson', data: data[id] })
    const round = { 'line-join': 'round', 'line-cap': 'round' } as const
    map.addLayer({
      id: 'rutas-borde',
      type: 'line',
      source: 'rutas',
      layout: round,
      paint: { 'line-color': '#ffffff', 'line-width': ['+', ['get', 'width'], 2.5] },
    })
    map.addLayer({
      id: 'rutas',
      type: 'line',
      source: 'rutas',
      layout: round,
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
    })
    map.addLayer({
      id: 'tramos',
      type: 'line',
      source: 'tramos',
      layout: round,
      paint: { 'line-color': ['get', 'color'], 'line-width': 5 },
    })
    map.addLayer({
      id: 'tramos-pico',
      type: 'line',
      source: 'tramos-pico',
      layout: round,
      paint: { 'line-color': INK, 'line-width': 2, 'line-dasharray': [1, 1.6] },
    })
    // Inicio: aro hueco. Fin: disco lleno.
    map.addLayer({
      id: 'extremos',
      type: 'circle',
      source: 'extremos',
      paint: {
        'circle-radius': 6,
        'circle-color': ['case', ['get', 'end'], ['get', 'color'], '#ffffff'],
        'circle-stroke-color': ['case', ['get', 'end'], '#ffffff', ['get', 'color']],
        'circle-stroke-width': 2.5,
      },
    })
    map.addLayer({
      id: 'puntos',
      type: 'circle',
      source: 'puntos',
      paint: {
        'circle-radius': 4.5,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    })
    map.addLayer({
      id: 'picos',
      type: 'symbol',
      source: 'picos',
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true },
    })
    map.addLayer({
      id: 'marcas',
      type: 'symbol',
      source: 'marcas',
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true },
    })
  }

  const bounds = new LngLatBounds()
  for (const r of routes) for (const p of r.vehicle.points) bounds.extend([p.lon, p.lat])
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 56, duration: 0, maxZoom: 15 })
}

export function RouteMap({
  routes,
  peaks = NONE,
  markers = NONE,
  segments = NONE,
  dots = NONE,
  height,
  label,
  ref,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const [ready, setReady] = useState(false)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let cancelled = false
    let instance: MapLibre | null = null

    async function init() {
      let style: StyleSpecification = BLANK_STYLE
      try {
        const response = await fetch(STYLE_URL)
        if (!response.ok) throw new Error(String(response.status))
        style = inSpanish(await response.json())
      } catch {
        if (!cancelled) setOffline(true)
      }
      if (cancelled || !host.current) return

      instance = new MapLibre({
        container: host.current,
        style,
        // Sin esto el lienzo se vacía tras cada cuadro y no se puede copiar al PDF.
        canvasContextAttributes: { preserveDrawingBuffer: true },
        attributionControl: { compact: true },
        cooperativeGestures: true,
      })
      map.current = instance

      const popup = new Popup({ closeButton: false, offset: 16 })
      for (const layer of ['picos', 'puntos', 'marcas']) {
        instance.on('mouseenter', layer, (e) => {
          const feature = e.features?.[0]
          if (!feature || !instance) return
          instance.getCanvas().style.cursor = 'pointer'
          popup.setLngLat(e.lngLat).setText(String(feature.properties.text)).addTo(instance)
        })
        instance.on('mouseleave', layer, () => {
          if (instance) instance.getCanvas().style.cursor = ''
          popup.remove()
        })
      }
      // Basta con que el estilo esté listo: esperar a 'load' dejaría el recorrido sin dibujar si las teselas tardan o fallan.
      instance.once('style.load', () => {
        if (!cancelled) setReady(true)
      })
    }

    init()
    return () => {
      cancelled = true
      instance?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (ready && map.current) draw(map.current, routes, peaks, segments, dots, markers)
  }, [ready, routes, peaks, segments, dots, markers])

  useImperativeHandle(ref, () => ({
    getImage() {
      const canvas = map.current?.getCanvas()
      if (!canvas || !ready) return null
      try {
        // JPEG: un mapa en PNG hace que el PDF pese varios megabytes.
        return { url: canvas.toDataURL('image/jpeg', 0.9), width: canvas.clientWidth, height: canvas.clientHeight }
      } catch {
        return null
      }
    },
  }))

  return (
    <div className="map-wrap">
      <div
        ref={host}
        className="map"
        style={height ? { height } : undefined}
        role="img"
        aria-label={label ?? 'Mapa con el recorrido de cada unidad'}
      />
      {offline && (
        <p className="map-note">Sin conexión al mapa base: se muestran los recorridos sin calles de fondo.</p>
      )}
    </div>
  )
}
