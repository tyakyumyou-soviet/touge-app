import type { Coordinate, Course, RatingKey, Ratings } from '../types'

const EARTH_RADIUS_KM = 6371

export function distanceKm(a: Coordinate, b: Coordinate): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

export function routeDistanceKm(route: Coordinate[]): number {
  return route.slice(1).reduce((total, point, index) => total + distanceKm(route[index], point), 0)
}

export function overallRating(ratings: Ratings): number {
  const primary: RatingKey[] = ['curves', 'elevation', 'width']
  const secondary: RatingKey[] = ['scenery', 'surface', 'traffic', 'access']
  const primaryScore = primary.reduce((sum, key) => sum + ratings[key], 0) / primary.length
  const secondaryScore = secondary.reduce((sum, key) => sum + ratings[key], 0) / secondary.length
  return Number((primaryScore * 0.65 + secondaryScore * 0.35).toFixed(1))
}

export function googleMapsUrl(course: Course, includeCurrentLocation: boolean): string {
  const route = course.route
  const params = new URLSearchParams({ api: '1', travelmode: 'driving' })
  const format = ([lng, lat]: Coordinate) => `${lat},${lng}`
  if (!includeCurrentLocation) params.set('origin', format(route[0]))
  params.set('destination', format(route.at(-1)!))
  const via = includeCurrentLocation ? route.slice(0, -1) : route.slice(1, -1)
  if (via.length) {
    const count = Math.min(8, via.length)
    const sampled = Array.from({ length: count }, (_, index) => via[Math.round((index / Math.max(1, count - 1)) * (via.length - 1))])
    params.set('waypoints', sampled.map(format).join('|'))
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function approximateElevationProfile(route: Coordinate[]): number[] {
  if (route.length === 0) return []
  return route.map(([, lat], index) => Math.round(380 + (lat % 1) * 420 + Math.sin(index * 1.7) * 80))
}

export function emptyRatings(value = 3): Ratings {
  return { curves: value, elevation: value, width: value, scenery: value, surface: value, traffic: value, access: value }
}
