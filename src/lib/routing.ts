import type { Coordinate } from '../types'

export interface RoutedCourse {
  route: Coordinate[]
  distanceKm: number
  durationMin: number
}

const routingBase = import.meta.env.VITE_ROUTING_API_URL || 'https://router.project-osrm.org'
// Keep individual OSRM requests within a conservative waypoint size while
// allowing the editor itself to contain any number of user-defined points.
const MAX_WAYPOINTS_PER_REQUEST = 25

export async function routeAlongRoads(waypoints: Coordinate[]): Promise<RoutedCourse> {
  if (waypoints.length < 2) throw new Error('始点と終点が必要です')
  const requestRoute = async (segment: Coordinate[]) => {
    const coordinates = segment.map(([lng, lat]) => `${lng},${lat}`).join(';')
    const response = await fetch(`${routingBase}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`)
    if (!response.ok) throw new Error('道路ルートを取得できませんでした')
    const data = await response.json() as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: Coordinate[] } }[] }
    const result = data.routes?.[0]
    if (data.code !== 'Ok' || !result) throw new Error('指定地点を道路で結べませんでした')
    return result
  }

  const segments: Coordinate[][] = []
  for (let start = 0; start < waypoints.length - 1; start += MAX_WAYPOINTS_PER_REQUEST - 1) {
    segments.push(waypoints.slice(start, Math.min(waypoints.length, start + MAX_WAYPOINTS_PER_REQUEST)))
  }
  const results = await Promise.all(segments.map(requestRoute))
  const routedCoordinates = results.flatMap((result, index) => index === 0 ? result.geometry.coordinates : result.geometry.coordinates.slice(1))
  const distance = results.reduce((sum, result) => sum + result.distance, 0)
  const duration = results.reduce((sum, result) => sum + result.duration, 0)
  return {
    route: routedCoordinates,
    distanceKm: Number((distance / 1000).toFixed(1)),
    durationMin: Math.max(1, Math.round(duration / 60)),
  }
}
