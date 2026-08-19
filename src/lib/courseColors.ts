import type { Coordinate, Course } from '../types'

const palette = ['#d69f35', '#2e9bd4', '#b568c5', '#df624a', '#38a978', '#7787de']
const adjacentMetres = 260

type Point = [number, number]

function sample(route: Coordinate[], count = 72) {
  if (route.length <= count) return route
  return Array.from({ length: count }, (_, index) => route[Math.round(index * (route.length - 1) / (count - 1))])
}

function bounds(route: Coordinate[]) {
  return route.reduce(([minLng, minLat, maxLng, maxLat], [lng, lat]) => [Math.min(minLng, lng), Math.min(minLat, lat), Math.max(maxLng, lng), Math.max(maxLat, lat)], [Infinity, Infinity, -Infinity, -Infinity])
}

function overlap(a: number[], b: number[], paddingDegrees: number) {
  return a[0] - paddingDegrees <= b[2] && a[2] + paddingDegrees >= b[0] && a[1] - paddingDegrees <= b[3] && a[3] + paddingDegrees >= b[1]
}

function project([lng, lat]: Coordinate, referenceLat: number): Point {
  return [lng * 111320 * Math.cos(referenceLat * Math.PI / 180), lat * 111320]
}

function orientation(a: Point, b: Point, c: Point) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) }

function pointSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0]; const dy = end[1] - start[1]
  const divisor = dx * dx + dy * dy
  const t = divisor ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / divisor)) : 0
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t))
}

function segmentsConflict(a0: Point, a1: Point, b0: Point, b1: Point) {
  const oa = orientation(a0, a1, b0); const ob = orientation(a0, a1, b1)
  const oc = orientation(b0, b1, a0); const od = orientation(b0, b1, a1)
  if ((oa === 0 || ob === 0 || Math.sign(oa) !== Math.sign(ob)) && (oc === 0 || od === 0 || Math.sign(oc) !== Math.sign(od))) return true
  return Math.min(pointSegmentDistance(a0, b0, b1), pointSegmentDistance(a1, b0, b1), pointSegmentDistance(b0, a0, a1), pointSegmentDistance(b1, a0, a1)) < adjacentMetres
}

/** Returns a stable graph colouring: only intersecting / near-parallel routes
 * are forced into different palette colours. */
export function assignCourseColors(courses: Pick<Course, 'id' | 'route'>[]) {
  const conflicts = new Map(courses.map((course) => [course.id, new Set<string>()]))
  for (let left = 0; left < courses.length; left += 1) for (let right = left + 1; right < courses.length; right += 1) {
    const a = courses[left]; const b = courses[right]
    if (a.route.length < 2 || b.route.length < 2 || !overlap(bounds(a.route), bounds(b.route), .003)) continue
    const referenceLat = (a.route[0][1] + b.route[0][1]) / 2
    const aPoints = sample(a.route).map((point) => project(point, referenceLat)); const bPoints = sample(b.route).map((point) => project(point, referenceLat))
    let conflict = false
    for (let ai = 1; ai < aPoints.length && !conflict; ai += 1) for (let bi = 1; bi < bPoints.length; bi += 1) {
      if (segmentsConflict(aPoints[ai - 1], aPoints[ai], bPoints[bi - 1], bPoints[bi])) { conflict = true; break }
    }
    if (conflict) { conflicts.get(a.id)?.add(b.id); conflicts.get(b.id)?.add(a.id) }
  }
  const colors = new Map<string, string>()
  const ordered = [...courses].sort((a, b) => (conflicts.get(b.id)?.size ?? 0) - (conflicts.get(a.id)?.size ?? 0) || a.id.localeCompare(b.id))
  ordered.forEach((course) => {
    const unavailable = new Set([...conflicts.get(course.id) ?? []].map((id) => colors.get(id)))
    colors.set(course.id, palette.find((color) => !unavailable.has(color)) ?? palette[colors.size % palette.length])
  })
  return colors
}
