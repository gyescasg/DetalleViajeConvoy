const EARTH_KM = 6371.0088
const RAD = Math.PI / 180

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD
  const p2 = lat2 * RAD
  const a =
    Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a))
}

/**
 * Distancia de un punto al segmento a-b, en km.
 * Usa una proyección plana local, suficiente para segmentos de pocos kilómetros.
 */
export function distToSegmentKm(
  lat: number,
  lon: number,
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): number {
  const kx = Math.cos(lat * RAD) * EARTH_KM * RAD
  const ky = EARTH_KM * RAD
  const ax = (lonA - lon) * kx
  const ay = (latA - lat) * ky
  const bx = (lonB - lon) * kx
  const by = (latB - lat) * ky
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const w = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
  return Math.hypot(ax + w * dx, ay + w * dy)
}
