import type { Coordinate } from '../types'

export interface RoutedCourse {
  route: Coordinate[]
  distanceKm: number
  durationMin: number
}

const routingBase = import.meta.env.VITE_ROUTING_API_URL || 'https://router.project-osrm.org'

export async function routeAlongRoads(waypoints: Coordinate[]): Promise<RoutedCourse> {
  if (waypoints.length < 2) throw new Error('始点と終点が必要です')
  if (waypoints.length > 25) throw new Error('経由点は25地点以下にしてください')
  const coordinates = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const response = await fetch(`${routingBase}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`)
  if (!response.ok) throw new Error('道路ルートを取得できませんでした')
  const data = await response.json() as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: Coordinate[] } }[] }
  const result = data.routes?.[0]
  if (data.code !== 'Ok' || !result) throw new Error('指定地点を道路で結べませんでした')
  return {
    route: result.geometry.coordinates,
    distanceKm: Number((result.distance / 1000).toFixed(1)),
    durationMin: Math.max(1, Math.round(result.duration / 60)),
  }
}
