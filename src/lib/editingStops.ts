import type { Coordinate, Course, DraftPointRole } from '../types'

export interface EditableCourseStops {
  route: Coordinate[]
  labels: string[]
  roles: DraftPointRole[]
}

/**
 * A saved route is dense road geometry, not a list of user-created stops.
 * Reconstructing every geometry vertex as a stop makes editing impossible.
 * Keep only its named landmarks plus START and GOAL; the routing service will
 * rebuild the road-following geometry when the edited course is saved.
 */
export function editableStopsFromCourse(course: Course): EditableCourseStops {
  if (course.route.length < 2) return { route: [], labels: [], roles: [] }
  const lastIndex = course.route.length - 1
  const used = new Set([0, lastIndex])
  const landmarks = [...(course.landmarks ?? [])]
    .sort((left, right) => left.progress - right.progress)
    .flatMap((landmark) => {
      const index = Math.max(1, Math.min(lastIndex - 1, Math.round(landmark.progress * lastIndex)))
      if (used.has(index)) return []
      used.add(index)
      return [{ index, label: landmark.name }]
    })

  const stops = [
    { index: 0, label: `${course.name}・始点`, role: 'start' as const },
    ...landmarks.map((landmark) => ({ ...landmark, role: 'via' as const })),
    { index: lastIndex, label: `${course.name}・終点`, role: 'goal' as const },
  ]
  return {
    route: stops.map((stop) => course.route[stop.index]),
    labels: stops.map((stop) => stop.label),
    roles: stops.map((stop) => stop.role),
  }
}
