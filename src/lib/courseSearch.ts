import type { Coordinate, Course, TollStatus } from '../types'
import { courseTollStatus } from './toll'

const earthRadiusKm = 6371
const radians = (value: number) => value * Math.PI / 180

export function distanceKm(a: Coordinate, b: Coordinate) {
  const lat1 = radians(a[1]); const lat2 = radians(b[1])
  const dLat = lat2 - lat1; const dLng = radians(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Accurate enough for short Japanese driving routes and much less surprising
 * than using a course centroid: a route matches when any part passes nearby. */
export function distanceToRouteKm(point: Coordinate, route: Coordinate[]) {
  if (!route.length) return Infinity
  let closest = Math.min(...route.map((item) => distanceKm(point, item)))
  const latitudeScale = 111.32
  const longitudeScale = latitudeScale * Math.cos(radians(point[1]))
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1]; const b = route[index]
    const ax = (a[0] - point[0]) * longitudeScale; const ay = (a[1] - point[1]) * latitudeScale
    const bx = (b[0] - point[0]) * longitudeScale; const by = (b[1] - point[1]) * latitudeScale
    const dx = bx - ax; const dy = by - ay
    const denominator = dx * dx + dy * dy
    const t = denominator ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0
    closest = Math.min(closest, Math.hypot(ax + dx * t, ay + dy * t))
  }
  return closest
}

export interface CourseSearchFilters {
  text?: string
  prefecture?: string
  toll?: 'all' | TollStatus
  center?: Coordinate | null
  radiusKm?: number
}

export function courseMatchesSearch(course: Course, filters: CourseSearchFilters) {
  if (filters.prefecture && filters.prefecture !== 'すべて' && course.prefecture !== filters.prefecture) return false
  if (filters.toll && filters.toll !== 'all' && courseTollStatus(course) !== filters.toll) return false
  const terms = (filters.text ?? '').trim().toLocaleLowerCase('ja').split(/[\s\u3000]+/).filter(Boolean)
  const searchable = [course.name, course.area, course.description, course.authorName, ...course.tags, ...(course.landmarks?.map((item) => item.name) ?? [])].join(' ').toLocaleLowerCase('ja')
  if (terms.some((term) => !searchable.includes(term))) return false
  if (filters.center && filters.radiusKm && distanceToRouteKm(filters.center, course.route) > filters.radiusKm) return false
  return true
}
