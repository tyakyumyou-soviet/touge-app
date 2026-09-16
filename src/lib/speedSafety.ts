import type { Coordinate } from '../types'

export interface SpeedCamera {
  id: string
  point: Coordinate
  type: 'fixed'
  directionDegrees?: number
  maxSpeedKph?: number
  roadName?: string
  sourceName: 'OpenStreetMap'
  sourceUrl: string
  lastVerifiedAt: string
}

interface OverpassNode {
  type: 'node'
  id: number
  lat: number
  lon: number
  tags?: Record<string, string>
}

export interface SpeedAlertCandidate {
  camera: SpeedCamera
  distanceM: number
  stage: 'early' | 'near'
}

const EARTH_RADIUS_M = 6_371_000

export function distanceMeters(left: Coordinate, right: Coordinate): number {
  const radians = Math.PI / 180
  const latitude = (left[1] + right[1]) / 2 * radians
  const x = (right[0] - left[0]) * radians * Math.cos(latitude)
  const y = (right[1] - left[1]) * radians
  return Math.hypot(x, y) * EARTH_RADIUS_M
}

/** Compass bearing in degrees, where north is 0 and east is 90. */
export function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const radians = Math.PI / 180
  const longitudeDelta = (to[0] - from[0]) * radians
  const fromLatitude = from[1] * radians
  const toLatitude = to[1] * radians
  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude)
  const x = Math.cos(fromLatitude) * Math.sin(toLatitude) - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

export function bearingDifference(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180)
}

export function earlyAlertDistance(speedKph: number | null): number {
  const metersPerSecond = Math.max(0, speedKph ?? 60) / 3.6
  return Math.max(300, Math.min(1200, metersPerSecond * 25))
}

export function nearAlertDistance(speedKph: number | null): number {
  const metersPerSecond = Math.max(0, speedKph ?? 60) / 3.6
  return Math.max(150, Math.min(500, metersPerSecond * 10))
}

export function nearbySpeedAlert(position: Coordinate, speedKph: number | null, headingDegrees: number | null, accuracyM: number | null, cameras: SpeedCamera[]): SpeedAlertCandidate | null {
  if (accuracyM !== null && accuracyM > 50) return null
  const candidates = cameras
    .map((camera) => ({ camera, distanceM: distanceMeters(position, camera.point) }))
    .filter(({ camera, distanceM }) => {
      if (distanceM > earlyAlertDistance(speedKph)) return false
      if (headingDegrees === null || camera.directionDegrees === undefined) return true
      // If a source has an explicit enforcement direction, ignore the
      // opposite carriageway. A permissive threshold avoids suppressing a
      // legitimate alert when consumer GPS headings fluctuate.
      return bearingDifference(headingDegrees, camera.directionDegrees) <= 60
    })
    .sort((left, right) => left.distanceM - right.distanceM)
  const closest = candidates[0]
  if (!closest) return null
  return { ...closest, stage: closest.distanceM <= nearAlertDistance(speedKph) ? 'near' : 'early' }
}

function parseDirection(value: string | undefined): number | undefined {
  if (!value) return undefined
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return (numeric % 360 + 360) % 360
  const compass: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 }
  return compass[value.toUpperCase()]
}

function parseMaxSpeed(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 200 ? parsed : undefined
}

export function speedCamerasFromOverpass(value: unknown): SpeedCamera[] {
  const elements = value && typeof value === 'object' && Array.isArray((value as { elements?: unknown[] }).elements)
    ? (value as { elements: unknown[] }).elements : []
  return elements.flatMap((item): SpeedCamera[] => {
    if (!item || typeof item !== 'object') return []
    const node = item as Partial<OverpassNode>
    if (node.type !== 'node' || !Number.isFinite(node.lat) || !Number.isFinite(node.lon) || !Number.isFinite(node.id)) return []
    const tags = node.tags ?? {}
    if (tags.highway !== 'speed_camera' && tags.enforcement !== 'maxspeed') return []
    return [{
      id: `osm-speed-camera-${node.id}`,
      point: [Number(node.lon), Number(node.lat)],
      type: 'fixed',
      directionDegrees: parseDirection(tags.direction),
      maxSpeedKph: parseMaxSpeed(tags.maxspeed),
      roadName: tags.name ?? tags.ref,
      sourceName: 'OpenStreetMap',
      sourceUrl: `https://www.openstreetmap.org/node/${node.id}`,
      lastVerifiedAt: new Date().toISOString(),
    }]
  })
}

export async function loadSpeedCameras(center: Coordinate, radiusKm = 35, signal?: AbortSignal): Promise<SpeedCamera[]> {
  const latitudeDelta = radiusKm / 110.574
  const longitudeDelta = radiusKm / Math.max(1, 111.32 * Math.cos(center[1] * Math.PI / 180))
  const params = new URLSearchParams({
    south: String(center[1] - latitudeDelta), west: String(center[0] - longitudeDelta),
    north: String(center[1] + latitudeDelta), east: String(center[0] + longitudeDelta),
  })
  const response = await fetch(`/api/speed-cameras?${params}`, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`速度注意情報を取得できませんでした (${response.status})`)
  return speedCamerasFromOverpass(await response.json())
}

export function speedCameraFeatureCollection(cameras: SpeedCamera[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cameras.map((camera) => ({
      type: 'Feature' as const,
      properties: { id: camera.id, type: camera.type, maxSpeedKph: camera.maxSpeedKph ?? '', roadName: camera.roadName ?? '' },
      geometry: { type: 'Point' as const, coordinates: camera.point },
    })),
  }
}
