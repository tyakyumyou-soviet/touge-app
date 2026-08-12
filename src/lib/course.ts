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

export function systemRatingsFor(course: Pick<Course, 'ratings' | 'systemRatings'>): Ratings {
  return course.systemRatings ?? course.ratings
}

export function userRatingCountFor(course: Pick<Course, 'ratingCount'>): number {
  return Math.max(0, course.ratingCount ?? 0)
}

/**
 * Blend the public-data baseline with real user submissions. Five baseline
 * votes prevent the first user review from completely replacing the system
 * score; the baseline disappears naturally as submissions accumulate.
 */
export function combinedRatings(course: Pick<Course, 'ratings' | 'systemRatings' | 'userRatings' | 'ratingCount'>): Ratings {
  const system = systemRatingsFor(course)
  const user = course.userRatings
  const count = userRatingCountFor(course)
  if (!user || count === 0) return system
  const baselineWeight = 5
  return Object.fromEntries((Object.keys(system) as RatingKey[]).map((key) => [
    key,
    Number(((system[key] * baselineWeight + user[key] * count) / (baselineWeight + count)).toFixed(1)),
  ])) as Ratings
}

export function userRatingAverage(sum: Ratings, count: number): Ratings {
  if (count <= 0) return emptyRatings(0)
  return Object.fromEntries((Object.keys(sum) as RatingKey[]).map((key) => [key, Number((sum[key] / count).toFixed(2))])) as Ratings
}

/** Build a transparent baseline for newly submitted routes from geometry and
 * public map/terrain attributes. It is deliberately labelled as a system
 * estimate until editorial data or user reviews are available. */
export function estimateSystemRatings(route: Coordinate[], elevation: number[], tags: string[] = []): Ratings {
  const km = Math.max(routeDistanceKm(route), 0.1)
  let turns = 0
  for (let index = 2; index < route.length; index += 1) {
    const a = route[index - 2]; const b = route[index - 1]; const c = route[index]
    const ab = [b[0] - a[0], b[1] - a[1]]; const bc = [c[0] - b[0], c[1] - b[1]]
    const angle = Math.abs(Math.atan2(ab[0] * bc[1] - ab[1] * bc[0], ab[0] * bc[0] + ab[1] * bc[1]))
    if (angle > 0.18) turns += 1
  }
  const curveDensity = turns / km
  const curves = Math.min(5, Math.max(1, 2.5 + curveDensity * 1.2))
  const range = elevation.length ? Math.max(...elevation) - Math.min(...elevation) : 0
  const elevationScore = Math.min(5, Math.max(1, 1.5 + range / 220))
  const sceneryBoost = tags.some((tag) => /展望|景色|高原|湖|富士|海|尾根/.test(tag)) ? 1 : 0
  return {
    curves: Number(curves.toFixed(1)), elevation: Number(elevationScore.toFixed(1)), width: 3,
    scenery: 3 + sceneryBoost, surface: 3, traffic: 3, access: 3,
  }
}

export function addUserRating(course: Course, rating: Ratings): Course {
  const count = userRatingCountFor(course)
  const previous = course.userRatings ?? emptyRatings(0)
  const userRatings = Object.fromEntries((Object.keys(previous) as RatingKey[]).map((key) => [
    key, Number(((previous[key] * count + rating[key]) / (count + 1)).toFixed(2)),
  ])) as Ratings
  const next = { ...course, userRatings, ratingCount: count + 1 }
  return { ...next, ratings: combinedRatings(next) }
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
