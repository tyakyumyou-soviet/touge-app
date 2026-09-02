import type { Coordinate, Course, DraftPointRole } from '../types'

export interface EditableCourseStops {
  route: Coordinate[]
  labels: string[]
  roles: DraftPointRole[]
}

/**
 * A saved route is dense road geometry, not a list of user-created stops.
 * Reconstructing every geometry vertex as a stop makes editing impossible.
 * Newer courses retain the exact stops the driver added. Older courses did
 * not have that information, so recreate a small set of route anchors from
 * the road geometry. This keeps legacy courses editable without exposing
 * hundreds of OSRM geometry vertices as fake waypoints.
 */
export function editableStopsFromCourse(course: Course): EditableCourseStops {
  if (course.editorStops?.length && course.editorStops.some((stop) => stop.role === 'start') && course.editorStops.some((stop) => stop.role === 'goal')) {
    return {
      route: course.editorStops.map((stop) => stop.coordinate),
      labels: course.editorStops.map((stop) => stop.label),
      roles: course.editorStops.map((stop) => stop.role),
    }
  }
  if (course.route.length < 2) return { route: [], labels: [], roles: [] }
  const lastIndex = course.route.length - 1
  const landmarkLabels = new Map<number, string[]>()
  ;[...(course.landmarks ?? [])]
    .sort((left, right) => left.progress - right.progress)
    .forEach((landmark) => {
      const index = Math.max(1, Math.min(lastIndex - 1, Math.round(landmark.progress * lastIndex)))
      const labels = landmarkLabels.get(index) ?? []
      labels.push(landmark.name)
      landmarkLabels.set(index, labels)
    })

  // A legacy course should have enough anchors to retain its intended road
  // corridor when an edit causes the routing service to rebuild the line.
  // sqrt scales gently: short routes stay simple, long routes get up to 12
  // editable anchors rather than an unusable list of every geometry point.
  const automaticCount = Math.min(course.route.length, Math.min(12, Math.max(4, Math.ceil(Math.sqrt(course.route.length)))))
  const automaticIndices = Array.from({ length: automaticCount }, (_, position) =>
    Math.round((lastIndex * position) / Math.max(1, automaticCount - 1)),
  )
  const indices = [...new Set([...automaticIndices, ...landmarkLabels.keys()])].sort((left, right) => left - right)
  let anchorNumber = 0
  const stops = indices.map((index) => {
    if (index === 0) return { index, label: `${course.name}・始点`, role: 'start' as const }
    if (index === lastIndex) return { index, label: `${course.name}・終点`, role: 'goal' as const }
    const landmarkLabel = landmarkLabels.get(index)?.join('・')
    if (landmarkLabel) return { index, label: landmarkLabel, role: 'via' as const }
    anchorNumber += 1
    return { index, label: `経路維持点 ${anchorNumber}`, role: 'via' as const }
  })
  return {
    route: stops.map((stop) => course.route[stop.index]),
    labels: stops.map((stop) => stop.label),
    roles: stops.map((stop) => stop.role),
  }
}
